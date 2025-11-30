import type { ILogObj, Logger } from "tslog";
import { createLogger } from "../logging/logger.js";
import { GadgetErrorFormatter, type ErrorFormatterOptions } from "./error-formatter.js";
import { BreakLoopException, HumanInputException, TimeoutException } from "./exceptions.js";
import type { GadgetRegistry } from "./registry.js";
import type { GadgetExecutionResult, ParsedGadgetCall } from "./types.js";

export class GadgetExecutor {
  private readonly logger: Logger<ILogObj>;
  private readonly errorFormatter: GadgetErrorFormatter;

  constructor(
    private readonly registry: GadgetRegistry,
    private readonly onHumanInputRequired?: (question: string) => Promise<string>,
    logger?: Logger<ILogObj>,
    private readonly defaultGadgetTimeoutMs?: number,
    errorFormatterOptions?: ErrorFormatterOptions,
  ) {
    this.logger = logger ?? createLogger({ name: "llmist:executor" });
    this.errorFormatter = new GadgetErrorFormatter(errorFormatterOptions);
  }

  /**
   * Creates a promise that rejects with a TimeoutException after the specified timeout.
   */
  private createTimeoutPromise(gadgetName: string, timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutException(gadgetName, timeoutMs));
      }, timeoutMs);
    });
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

      if (gadget.parameterSchema) {
        const validationResult = gadget.parameterSchema.safeParse(rawParameters);
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
            parameters: rawParameters,
            error: validationError,
            executionTimeMs: Date.now() - startTime,
          };
        }

        validatedParameters = validationResult.data as Record<string, unknown>;
      }

      // Determine the timeout for this gadget
      // Priority: gadget's own timeoutMs > defaultGadgetTimeoutMs > no timeout
      const timeoutMs = gadget.timeoutMs ?? this.defaultGadgetTimeoutMs;

      // Execute gadget (handle both sync and async)
      let result: string;
      if (timeoutMs && timeoutMs > 0) {
        // Execute with timeout
        this.logger.debug("Executing gadget with timeout", {
          gadgetName: call.gadgetName,
          timeoutMs,
        });
        result = await Promise.race([
          Promise.resolve(gadget.execute(validatedParameters)),
          this.createTimeoutPromise(call.gadgetName, timeoutMs),
        ]);
      } else {
        // Execute without timeout
        result = await Promise.resolve(gadget.execute(validatedParameters));
      }

      const executionTimeMs = Date.now() - startTime;
      this.logger.info("Gadget executed successfully", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        executionTimeMs,
      });

      this.logger.debug("Gadget result", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: validatedParameters,
        result,
        executionTimeMs,
      });

      return {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: validatedParameters,
        result,
        executionTimeMs,
      };
    } catch (error) {
      // Check if this is a BreakLoopException
      if (error instanceof BreakLoopException) {
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

      // Check if this is a HumanInputException
      if (error instanceof HumanInputException) {
        this.logger.info("Gadget requested human input", {
          gadgetName: call.gadgetName,
          question: error.question,
        });

        // If callback is provided, call it and wait for answer
        if (this.onHumanInputRequired) {
          try {
            const answer = await this.onHumanInputRequired(error.question);
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
}
