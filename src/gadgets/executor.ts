import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import { GADGET_ARG_PREFIX } from "../core/constants.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import { createLogger } from "../logging/logger.js";
import { parseBlockParams } from "./block-params.js";
import { CostReportingLLMistWrapper } from "./cost-reporting-client.js";
import { type ErrorFormatterOptions, GadgetExecutionErrorFormatter } from "./error-formatter.js";
import {
  AbortException,
  HumanInputRequiredException,
  TaskCompletionSignal,
  TimeoutException,
} from "./exceptions.js";
import type { MediaStore } from "./media-store.js";
import { stripMarkdownFences } from "./parser.js";
import type { GadgetRegistry } from "./registry.js";
import type {
  AgentContextConfig,
  ExecutionContext,
  GadgetExecuteResult,
  GadgetExecuteResultWithMedia,
  GadgetExecutionResult,
  GadgetMediaOutput,
  ParsedGadgetCall,
  SubagentConfigMap,
  SubagentEvent,
} from "./types.js";

export class GadgetExecutor {
  private readonly logger: Logger<ILogObj>;
  private readonly errorFormatter: GadgetExecutionErrorFormatter;
  private readonly argPrefix: string;

  constructor(
    private readonly registry: GadgetRegistry,
    private readonly requestHumanInput?: (question: string) => Promise<string>,
    logger?: Logger<ILogObj>,
    private readonly defaultGadgetTimeoutMs?: number,
    errorFormatterOptions?: ErrorFormatterOptions,
    private readonly client?: LLMist,
    private readonly mediaStore?: MediaStore,
    private readonly agentConfig?: AgentContextConfig,
    private readonly subagentConfig?: SubagentConfigMap,
    private readonly onSubagentEvent?: (event: SubagentEvent) => void,
    // Execution Tree context for gadget execution
    private readonly tree?: ExecutionTree,
    private readonly parentNodeId?: NodeId | null,
    private readonly baseDepth?: number,
  ) {
    this.logger = logger ?? createLogger({ name: "llmist:executor" });
    this.errorFormatter = new GadgetExecutionErrorFormatter(errorFormatterOptions);
    this.argPrefix = errorFormatterOptions?.argPrefix ?? GADGET_ARG_PREFIX;
  }

  /**
   * Creates a promise that rejects with a TimeoutException after the specified timeout.
   * Aborts the provided AbortController before rejecting, allowing gadgets to clean up.
   * Returns both the promise and a cancel function to clear the timeout when no longer needed.
   */
  private createTimeoutPromise(
    gadgetName: string,
    timeoutMs: number,
    abortController: AbortController,
  ): { promise: Promise<never>; cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout>;

    const promise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutError = new TimeoutException(gadgetName, timeoutMs);
        // Signal abort FIRST so gadgets can clean up before exception is thrown
        // Pass the timeout message as reason for better debugging context
        abortController.abort(timeoutError.message);
        reject(timeoutError);
      }, timeoutMs);
    });

    return {
      promise,
      cancel: () => clearTimeout(timeoutId),
    };
  }

  /**
   * Unify gadget execute result to consistent internal format.
   * Handles string returns (backwards compat), object returns with cost,
   * and object returns with media.
   */
  private unifyExecuteResult(
    raw: string | GadgetExecuteResult | GadgetExecuteResultWithMedia,
  ): { result: string; media?: GadgetMediaOutput[]; cost: number } {
    if (typeof raw === "string") {
      return { result: raw, cost: 0 };
    }
    // Check if it has media property (GadgetExecuteResultWithMedia)
    if ("media" in raw && raw.media) {
      return { result: raw.result, media: raw.media, cost: raw.cost ?? 0 };
    }
    return { result: raw.result, cost: raw.cost ?? 0 };
  }

  // Execute a gadget call asynchronously
  async execute(call: ParsedGadgetCall): Promise<GadgetExecutionResult> {
    const startTime = Date.now();

    this.logger.debug("Executing gadget", {
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      parameters: call.parameters,
    });

    const rawParameters: Record<string, unknown> = call.parameters ?? {};
    let validatedParameters: Record<string, unknown> = rawParameters;

    try {
      // Check if gadget exists
      const gadget = this.registry.get(call.gadgetName);
      if (!gadget) {
        this.logger.error("Gadget not found", { gadgetName: call.gadgetName });
        const availableGadgets = this.registry.getNames();
        return {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          error: this.errorFormatter.formatRegistryError(call.gadgetName, availableGadgets),
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Check for parse errors
      if (call.parseError || !call.parameters) {
        this.logger.error("Gadget parameter parse error", {
          gadgetName: call.gadgetName,
          parseError: call.parseError,
          rawParameters: call.parametersRaw,
        });
        const parseErrorMessage = call.parseError ?? "Failed to parse parameters";
        return {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: {},
          error: this.errorFormatter.formatParseError(call.gadgetName, parseErrorMessage, gadget),
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Re-parse parameters with schema for type-aware coercion (Approach B)
      // This allows the parser to use the schema to determine correct types
      // (e.g., keeping "1" as string when schema expects z.string())
      // Only re-parse if:
      // 1. The raw content is in block format (contains configured arg prefix)
      // 2. Parameters weren't modified by an interceptor (compare with initial parse)
      let schemaAwareParameters: Record<string, unknown> = rawParameters;
      const hasBlockFormat = call.parametersRaw?.includes(this.argPrefix);
      if (gadget.parameterSchema && hasBlockFormat) {
        try {
          const cleanedRaw = stripMarkdownFences(call.parametersRaw);

          // First, parse without schema to get what initial parse would produce
          const initialParse = parseBlockParams(cleanedRaw, { argPrefix: this.argPrefix });

          // Check if parameters were modified by an interceptor
          // by comparing current parameters with what initial parse produces
          const parametersWereModified = !this.deepEquals(rawParameters, initialParse);

          if (parametersWereModified) {
            // Parameters were modified by an interceptor - keep the modifications
            this.logger.debug("Parameters modified by interceptor, skipping re-parse", {
              gadgetName: call.gadgetName,
            });
            schemaAwareParameters = rawParameters;
          } else {
            // Re-parse with schema for type-aware coercion
            schemaAwareParameters = parseBlockParams(cleanedRaw, {
              argPrefix: this.argPrefix,
              schema: gadget.parameterSchema,
            });
            this.logger.debug("Re-parsed parameters with schema", {
              gadgetName: call.gadgetName,
              original: rawParameters,
              schemaAware: schemaAwareParameters,
            });
          }
        } catch (error) {
          // If re-parsing fails, fall back to original parameters
          // This shouldn't happen if initial parse succeeded, but be safe
          this.logger.warn("Schema-aware re-parsing failed, using original parameters", {
            gadgetName: call.gadgetName,
            error: error instanceof Error ? error.message : String(error),
          });
          schemaAwareParameters = rawParameters;
        }
      }

      if (gadget.parameterSchema) {
        const validationResult = gadget.parameterSchema.safeParse(schemaAwareParameters);
        if (!validationResult.success) {
          const validationError = this.errorFormatter.formatValidationError(
            call.gadgetName,
            validationResult.error,
            gadget,
          );
          this.logger.error("Gadget parameter validation failed", {
            gadgetName: call.gadgetName,
            issueCount: validationResult.error.issues.length,
          });

          return {
            gadgetName: call.gadgetName,
            invocationId: call.invocationId,
            parameters: schemaAwareParameters,
            error: validationError,
            executionTimeMs: Date.now() - startTime,
          };
        }

        validatedParameters = validationResult.data as Record<string, unknown>;
      } else {
        // No schema - use the schema-aware parameters (which are same as raw if no schema)
        validatedParameters = schemaAwareParameters;
      }

      // Determine the timeout for this gadget
      // Priority: gadget's own timeoutMs > defaultGadgetTimeoutMs > no timeout
      const timeoutMs = gadget.timeoutMs ?? this.defaultGadgetTimeoutMs;

      // Create AbortController for cancellation support
      // Signal is always provided to gadgets, even without timeout
      const abortController = new AbortController();

      // Create execution context with cost accumulator and abort signal
      let callbackCost = 0;
      const reportCost = (amount: number) => {
        if (amount > 0) {
          callbackCost += amount;
          this.logger.debug("Gadget reported cost via callback", {
            gadgetName: call.gadgetName,
            amount,
            totalCallbackCost: callbackCost,
          });
        }
      };

      // Build execution context with abort signal, agent config, and tree access
      // Look up the gadget's own node ID from the tree (not the parent LLM call's ID)
      const gadgetNodeId = this.tree?.getNodeByInvocationId(call.invocationId)?.id;
      const gadgetDepth = gadgetNodeId
        ? this.tree?.getNode(gadgetNodeId)?.depth ?? this.baseDepth
        : this.baseDepth;

      const ctx: ExecutionContext = {
        reportCost,
        llmist: this.client ? new CostReportingLLMistWrapper(this.client, reportCost) : undefined,
        signal: abortController.signal,
        agentConfig: this.agentConfig,
        subagentConfig: this.subagentConfig,
        invocationId: call.invocationId,
        onSubagentEvent: this.onSubagentEvent,
        // Tree context for subagent support - use gadget's own node ID
        tree: this.tree,
        nodeId: gadgetNodeId,
        depth: gadgetDepth,
      };

      // Execute gadget (handle both sync and async)
      let rawResult: string | GadgetExecuteResult;
      if (timeoutMs && timeoutMs > 0) {
        // Execute with timeout - abort signal will be triggered before timeout rejection
        this.logger.debug("Executing gadget with timeout", {
          gadgetName: call.gadgetName,
          timeoutMs,
        });
        const timeout = this.createTimeoutPromise(call.gadgetName, timeoutMs, abortController);
        try {
          rawResult = await Promise.race([
            Promise.resolve(gadget.execute(validatedParameters, ctx)),
            timeout.promise,
          ]);
        } finally {
          // Always cancel the timeout to prevent it from keeping the event loop alive
          timeout.cancel();
        }
      } else {
        // Execute without timeout
        rawResult = await Promise.resolve(gadget.execute(validatedParameters, ctx));
      }

      // Normalize result: handle string returns (legacy), object returns with cost, and media
      const { result, media, cost: returnCost } = this.unifyExecuteResult(rawResult);

      // Sum callback costs + return costs
      const totalCost = callbackCost + returnCost;

      // Store media in MediaStore if present
      let mediaIds: string[] | undefined;
      let storedMedia: import("./types.js").StoredMedia[] | undefined;
      if (media && media.length > 0 && this.mediaStore) {
        storedMedia = await Promise.all(
          media.map((item) => this.mediaStore!.store(item, call.gadgetName)),
        );
        mediaIds = storedMedia.map((m) => m.id);
        this.logger.debug("Stored media outputs", {
          gadgetName: call.gadgetName,
          mediaIds,
          count: media.length,
        });
      }

      const executionTimeMs = Date.now() - startTime;
      this.logger.info("Gadget executed successfully", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        executionTimeMs,
        cost: totalCost > 0 ? totalCost : undefined,
        callbackCost: callbackCost > 0 ? callbackCost : undefined,
        returnCost: returnCost > 0 ? returnCost : undefined,
        mediaCount: media?.length,
      });

      this.logger.debug("Gadget result", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: validatedParameters,
        result,
        cost: totalCost,
        executionTimeMs,
        mediaIds,
      });

      return {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: validatedParameters,
        result,
        executionTimeMs,
        cost: totalCost,
        media,
        mediaIds,
        storedMedia,
      };
    } catch (error) {
      // Check if this is a TaskCompletionSignal
      if (error instanceof TaskCompletionSignal) {
        this.logger.info("Gadget requested loop termination", {
          gadgetName: call.gadgetName,
          message: error.message,
        });
        return {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: validatedParameters,
          result: error.message,
          breaksLoop: true,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Check if this is a TimeoutException
      if (error instanceof TimeoutException) {
        this.logger.error("Gadget execution timed out", {
          gadgetName: call.gadgetName,
          timeoutMs: error.timeoutMs,
          executionTimeMs: Date.now() - startTime,
        });
        return {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: validatedParameters,
          error: error.message,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Check if this is an AbortException (thrown by gadgets when they detect abort signal)
      if (error instanceof AbortException) {
        this.logger.info("Gadget execution was aborted", {
          gadgetName: call.gadgetName,
          executionTimeMs: Date.now() - startTime,
        });
        return {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: validatedParameters,
          error: error.message,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Check if this is a HumanInputRequiredException
      if (error instanceof HumanInputRequiredException) {
        this.logger.info("Gadget requested human input", {
          gadgetName: call.gadgetName,
          question: error.question,
        });

        // If callback is provided, call it and wait for answer
        if (this.requestHumanInput) {
          try {
            const answer = await this.requestHumanInput(error.question);
            this.logger.debug("Human input received", {
              gadgetName: call.gadgetName,
              answerLength: answer.length,
            });
            return {
              gadgetName: call.gadgetName,
              invocationId: call.invocationId,
              parameters: validatedParameters,
              result: answer,
              executionTimeMs: Date.now() - startTime,
            };
          } catch (inputError) {
            this.logger.error("Human input callback error", {
              gadgetName: call.gadgetName,
              error: inputError instanceof Error ? inputError.message : String(inputError),
            });
            return {
              gadgetName: call.gadgetName,
              invocationId: call.invocationId,
              parameters: validatedParameters,
              error: inputError instanceof Error ? inputError.message : String(inputError),
              executionTimeMs: Date.now() - startTime,
            };
          }
        }

        // No callback - return error since we can't get human input
        this.logger.warn("Human input required but no callback provided", {
          gadgetName: call.gadgetName,
        });
        return {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: validatedParameters,
          error: "Human input required but not available (stdin is not interactive)",
          executionTimeMs: Date.now() - startTime,
        };
      }

      const executionTimeMs = Date.now() - startTime;
      this.logger.error("Gadget execution failed", {
        gadgetName: call.gadgetName,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
      });

      return {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: validatedParameters,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
      };
    }
  }

  // Execute multiple gadget calls in parallel
  async executeAll(calls: ParsedGadgetCall[]): Promise<GadgetExecutionResult[]> {
    return Promise.all(calls.map((call) => this.execute(call)));
  }

  /**
   * Deep equality check for objects/arrays.
   * Used to detect if parameters were modified by an interceptor.
   */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;

    if (typeof a !== "object") return a === b;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => this.deepEquals(val, b[i]));
    }

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every((key) => this.deepEquals(aObj[key], bObj[key]));
  }
}
