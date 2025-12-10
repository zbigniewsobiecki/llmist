/**
 * StreamProcessor: The heart of the new hooks architecture.
 *
 * Replaces the complex wiring between Agent, ResponseProcessor, and GadgetRuntime.
 * Owns ALL stream processing and hook coordination with a clean, predictable flow.
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import type { LLMStreamChunk, TokenUsage } from "../core/options.js";
import { GadgetExecutor } from "../gadgets/executor.js";
import { StreamParser } from "../gadgets/parser.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type {
  GadgetExecutionResult,
  GadgetSkippedEvent,
  ParsedGadgetCall,
  StreamEvent,
} from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import {
  validateAfterGadgetExecutionAction,
  validateBeforeGadgetExecutionAction,
} from "./hook-validators.js";
import type {
  AfterGadgetExecutionAction,
  AfterGadgetExecutionControllerContext,
  AgentHooks,
  BeforeGadgetExecutionAction,
  ChunkInterceptorContext,
  DependencySkipAction,
  DependencySkipControllerContext,
  GadgetExecutionControllerContext,
  GadgetParameterInterceptorContext,
  GadgetResultInterceptorContext,
  MessageInterceptorContext,
  ObserveChunkContext,
  ObserveGadgetCompleteContext,
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
} from "./hooks.js";

/**
 * Configuration for the StreamProcessor.
 */
export interface StreamProcessorOptions {
  /** Current iteration number */
  iteration: number;

  /** Gadget registry for execution */
  registry: GadgetRegistry;

  /** Custom gadget start prefix */
  gadgetStartPrefix?: string;

  /** Custom gadget end prefix */
  gadgetEndPrefix?: string;

  /** Custom argument prefix for block format */
  gadgetArgPrefix?: string;

  /** Hooks for lifecycle events */
  hooks?: AgentHooks;

  /** Logger instance */
  logger?: Logger<ILogObj>;

  /** Callback for human input */
  onHumanInputRequired?: (question: string) => Promise<string>;

  /** Whether to stop on gadget errors */
  stopOnGadgetError?: boolean;

  /** Custom error continuation logic */
  shouldContinueAfterError?: (context: {
    error: string;
    gadgetName: string;
    errorType: "parse" | "validation" | "execution";
    parameters?: Record<string, unknown>;
  }) => boolean | Promise<boolean>;

  /** Default gadget timeout */
  defaultGadgetTimeoutMs?: number;

  /** LLMist client for ExecutionContext.llmist */
  client?: LLMist;
}

/**
 * Result of stream processing.
 */
export interface StreamProcessingResult {
  /** All emitted events */
  outputs: StreamEvent[];

  /** Whether the loop should break */
  shouldBreakLoop: boolean;

  /** Whether any gadgets were executed */
  didExecuteGadgets: boolean;

  /** LLM finish reason */
  finishReason: string | null;

  /** Token usage (including cached token counts when available) */
  usage?: TokenUsage;

  /** The raw accumulated response text */
  rawResponse: string;

  /** The final message (after interceptors) */
  finalMessage: string;
}

/**
 * StreamProcessor: Coordinates all stream processing and hook execution.
 *
 * Execution order:
 * 1. Raw chunk arrives from LLM
 * 2. Interceptor: interceptRawChunk (transform raw text)
 * 3. Observer: onStreamChunk (logging)
 * 4. Parse for gadgets
 * 5. If gadget found:
 *    a. Interceptor: interceptGadgetParameters (transform params)
 *    b. Controller: beforeGadgetExecution (can skip)
 *    c. Observer: onGadgetExecutionStart
 *    d. Execute gadget
 *    e. Interceptor: interceptGadgetResult (transform result)
 *    f. Controller: afterGadgetExecution (can provide fallback)
 *    g. Observer: onGadgetExecutionComplete
 * 6. If text chunk:
 *    a. Interceptor: interceptTextChunk (transform display text)
 *    b. Yield to user
 * 7. Stream complete
 * 8. Interceptor: interceptAssistantMessage (transform final message)
 */
export class StreamProcessor {
  private readonly iteration: number;
  private readonly registry: GadgetRegistry;
  private readonly hooks: AgentHooks;
  private readonly logger: Logger<ILogObj>;
  private readonly parser: StreamParser;
  private readonly executor: GadgetExecutor;
  private readonly stopOnGadgetError: boolean;
  private readonly shouldContinueAfterError?: (context: {
    error: string;
    gadgetName: string;
    errorType: "parse" | "validation" | "execution";
    parameters?: Record<string, unknown>;
  }) => boolean | Promise<boolean>;

  private accumulatedText = "";
  private shouldStopExecution = false;
  private observerFailureCount = 0;

  // Dependency tracking for gadget execution DAG
  /** Gadgets waiting for their dependencies to complete */
  private pendingGadgets: Map<string, ParsedGadgetCall> = new Map();
  /** Completed gadget results, keyed by invocation ID */
  private completedResults: Map<string, GadgetExecutionResult> = new Map();
  /** Invocation IDs of gadgets that have failed (error or skipped due to dependency) */
  private failedInvocations: Set<string> = new Set();

  constructor(options: StreamProcessorOptions) {
    this.iteration = options.iteration;
    this.registry = options.registry;
    this.hooks = options.hooks ?? {};
    this.logger = options.logger ?? createLogger({ name: "llmist:stream-processor" });
    this.stopOnGadgetError = options.stopOnGadgetError ?? true;
    this.shouldContinueAfterError = options.shouldContinueAfterError;

    this.parser = new StreamParser({
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
      argPrefix: options.gadgetArgPrefix,
    });

    this.executor = new GadgetExecutor(
      options.registry,
      options.onHumanInputRequired,
      this.logger.getSubLogger({ name: "executor" }),
      options.defaultGadgetTimeoutMs,
      { argPrefix: options.gadgetArgPrefix },
      options.client,
    );
  }

  /**
   * Process an LLM stream and return structured results.
   */
  async process(stream: AsyncIterable<LLMStreamChunk>): Promise<StreamProcessingResult> {
    const outputs: StreamEvent[] = [];
    let finishReason: string | null = null;
    let usage: TokenUsage | undefined;
    let didExecuteGadgets = false;
    let shouldBreakLoop = false;

    // Process stream chunks
    for await (const chunk of stream) {
      // Capture metadata
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.usage) usage = chunk.usage;

      // Process text content if present
      let processedChunk = "";
      if (chunk.text) {
        // Step 1: Interceptor - Transform raw chunk
        processedChunk = chunk.text;
        if (this.hooks.interceptors?.interceptRawChunk) {
          const context: ChunkInterceptorContext = {
            iteration: this.iteration,
            accumulatedText: this.accumulatedText,
            logger: this.logger,
          };
          const intercepted = this.hooks.interceptors.interceptRawChunk(processedChunk, context);
          if (intercepted === null) {
            // Chunk suppressed
            processedChunk = "";
          } else {
            processedChunk = intercepted;
          }
        }

        // Accumulate text
        if (processedChunk) {
          this.accumulatedText += processedChunk;
        }
      }

      // Step 2: Observer - Observe chunk (called for text OR usage updates)
      if (this.hooks.observers?.onStreamChunk && (processedChunk || chunk.usage)) {
        const chunkObservers: Array<() => void | Promise<void>> = [];
        chunkObservers.push(async () => {
          const context: ObserveChunkContext = {
            iteration: this.iteration,
            rawChunk: processedChunk,
            accumulatedText: this.accumulatedText,
            usage,
            logger: this.logger,
          };
          await this.hooks.observers!.onStreamChunk!(context);
        });
        await this.runObserversInParallel(chunkObservers);
      }

      // Skip further processing if no text
      if (!processedChunk) {
        continue;
      }

      // Step 3: Parse and process events
      for (const event of this.parser.feed(processedChunk)) {
        const processedEvents = await this.processEvent(event);
        outputs.push(...processedEvents);

        // Check if any gadget was executed
        if (processedEvents.some((e) => e.type === "gadget_result")) {
          didExecuteGadgets = true;
        }

        // Check for loop termination signals
        for (const evt of processedEvents) {
          if (evt.type === "gadget_result" && evt.result.breaksLoop) {
            shouldBreakLoop = true;
          }
        }
      }

      // Break if we should stop execution
      if (this.shouldStopExecution) {
        this.logger.info("Breaking from LLM stream due to gadget error");
        break;
      }
    }

    // Finalize parsing
    if (!this.shouldStopExecution) {
      for (const event of this.parser.finalize()) {
        const processedEvents = await this.processEvent(event);
        outputs.push(...processedEvents);

        if (processedEvents.some((e) => e.type === "gadget_result")) {
          didExecuteGadgets = true;
        }

        for (const evt of processedEvents) {
          if (evt.type === "gadget_result" && evt.result.breaksLoop) {
            shouldBreakLoop = true;
          }
        }
      }

      // Final pass to process any remaining pending gadgets
      // This handles cases where the last gadgets in the stream have dependencies
      const finalPendingEvents = await this.processPendingGadgets();
      outputs.push(...finalPendingEvents);

      if (finalPendingEvents.some((e) => e.type === "gadget_result")) {
        didExecuteGadgets = true;
      }

      for (const evt of finalPendingEvents) {
        if (evt.type === "gadget_result" && evt.result.breaksLoop) {
          shouldBreakLoop = true;
        }
      }
    }

    // Step 4: Interceptor - Transform final message
    let finalMessage = this.accumulatedText;
    if (this.hooks.interceptors?.interceptAssistantMessage) {
      const context: MessageInterceptorContext = {
        iteration: this.iteration,
        rawResponse: this.accumulatedText,
        logger: this.logger,
      };
      finalMessage = this.hooks.interceptors.interceptAssistantMessage(finalMessage, context);
    }

    return {
      outputs,
      shouldBreakLoop,
      didExecuteGadgets,
      finishReason,
      usage,
      rawResponse: this.accumulatedText,
      finalMessage,
    };
  }

  /**
   * Process a single parsed event (text or gadget call).
   */
  private async processEvent(event: StreamEvent): Promise<StreamEvent[]> {
    if (event.type === "text") {
      return this.processTextEvent(event);
    } else if (event.type === "gadget_call") {
      return this.processGadgetCall(event.call);
    }
    return [event];
  }

  /**
   * Process a text event through interceptors.
   */
  private async processTextEvent(event: { type: "text"; content: string }): Promise<StreamEvent[]> {
    let content = event.content;

    // Interceptor: Transform text chunk
    if (this.hooks.interceptors?.interceptTextChunk) {
      const context: ChunkInterceptorContext = {
        iteration: this.iteration,
        accumulatedText: this.accumulatedText,
        logger: this.logger,
      };
      const intercepted = this.hooks.interceptors.interceptTextChunk(content, context);
      if (intercepted === null) {
        // Chunk suppressed
        return [];
      }
      content = intercepted;
    }

    return [{ type: "text", content }];
  }

  /**
   * Process a gadget call through the full lifecycle, handling dependencies.
   *
   * Gadgets without dependencies (or with all dependencies satisfied) execute immediately.
   * Gadgets with unsatisfied dependencies are queued for later execution.
   * After each execution, pending gadgets are checked to see if they can now run.
   */
  private async processGadgetCall(call: ParsedGadgetCall): Promise<StreamEvent[]> {
    // Check if we should skip due to previous error
    if (this.shouldStopExecution) {
      this.logger.debug("Skipping gadget execution due to previous error", {
        gadgetName: call.gadgetName,
      });
      return [];
    }

    const events: StreamEvent[] = [];

    // Emit gadget call event immediately (even if execution is deferred)
    events.push({ type: "gadget_call", call });

    // Check for dependencies
    if (call.dependencies.length > 0) {
      // Check if any dependency has failed
      const failedDep = call.dependencies.find((dep) => this.failedInvocations.has(dep));
      if (failedDep) {
        // Dependency failed - handle skip
        const skipEvents = await this.handleFailedDependency(call, failedDep);
        events.push(...skipEvents);
        return events;
      }

      // Check if all dependencies are satisfied
      const unsatisfied = call.dependencies.filter((dep) => !this.completedResults.has(dep));
      if (unsatisfied.length > 0) {
        // Queue for later execution
        this.logger.debug("Queueing gadget for later - waiting on dependencies", {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          waitingOn: unsatisfied,
        });
        this.pendingGadgets.set(call.invocationId, call);
        return events; // Return call event only, execution deferred
      }
    }

    // All dependencies satisfied (or no dependencies) - execute now
    const executeEvents = await this.executeGadgetWithHooks(call);
    events.push(...executeEvents);

    // Check if any pending gadgets can now execute
    const triggeredEvents = await this.processPendingGadgets();
    events.push(...triggeredEvents);

    return events;
  }

  /**
   * Execute a gadget through the full hook lifecycle.
   * This is the core execution logic, extracted from processGadgetCall.
   */
  private async executeGadgetWithHooks(call: ParsedGadgetCall): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];

    // Check for parse errors
    if (call.parseError) {
      this.logger.warn("Gadget has parse error", {
        gadgetName: call.gadgetName,
        error: call.parseError,
        rawParameters: call.parametersRaw,
      });

      const shouldContinue = await this.checkContinueAfterError(
        call.parseError,
        call.gadgetName,
        "parse",
        call.parameters,
      );

      if (!shouldContinue) {
        this.shouldStopExecution = true;
      }
    }

    // Step 1: Interceptor - Transform parameters
    let parameters = call.parameters ?? {};
    if (this.hooks.interceptors?.interceptGadgetParameters) {
      const context: GadgetParameterInterceptorContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        logger: this.logger,
      };
      parameters = this.hooks.interceptors.interceptGadgetParameters(parameters, context);
    }

    // Update call with intercepted parameters
    call.parameters = parameters;

    // Step 2: Controller - Before execution
    let shouldSkip = false;
    let syntheticResult: string | undefined;

    if (this.hooks.controllers?.beforeGadgetExecution) {
      const context: GadgetExecutionControllerContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters,
        logger: this.logger,
      };
      const action: BeforeGadgetExecutionAction =
        await this.hooks.controllers.beforeGadgetExecution(context);

      // Validate the action
      validateBeforeGadgetExecutionAction(action);

      if (action.action === "skip") {
        shouldSkip = true;
        syntheticResult = action.syntheticResult;
        this.logger.info("Controller skipped gadget execution", {
          gadgetName: call.gadgetName,
        });
      }
    }

    // Step 3: Observer - Execution start
    const startObservers: Array<() => void | Promise<void>> = [];
    if (this.hooks.observers?.onGadgetExecutionStart) {
      startObservers.push(async () => {
        const context: ObserveGadgetStartContext = {
          iteration: this.iteration,
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters,
          logger: this.logger,
        };
        await this.hooks.observers!.onGadgetExecutionStart!(context);
      });
    }
    await this.runObserversInParallel(startObservers);

    // Step 4: Execute or use synthetic result
    let result: GadgetExecutionResult;
    if (shouldSkip) {
      result = {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters,
        result: syntheticResult ?? "Execution skipped",
        executionTimeMs: 0,
      };
    } else {
      result = await this.executor.execute(call);
    }

    const originalResult = result.result;

    // Step 5: Interceptor - Transform result
    if (result.result && this.hooks.interceptors?.interceptGadgetResult) {
      const context: GadgetResultInterceptorContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        executionTimeMs: result.executionTimeMs,
        logger: this.logger,
      };
      result.result = this.hooks.interceptors.interceptGadgetResult(result.result, context);
    }

    // Step 6: Controller - After execution
    if (this.hooks.controllers?.afterGadgetExecution) {
      const context: AfterGadgetExecutionControllerContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        result: result.result,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
        logger: this.logger,
      };
      const action: AfterGadgetExecutionAction =
        await this.hooks.controllers.afterGadgetExecution(context);

      // Validate the action
      validateAfterGadgetExecutionAction(action);

      if (action.action === "recover" && result.error) {
        this.logger.info("Controller recovered from gadget error", {
          gadgetName: result.gadgetName,
          originalError: result.error,
        });
        result = {
          ...result,
          error: undefined,
          result: action.fallbackResult,
        };
      }
    }

    // Step 7: Observer - Execution complete
    const completeObservers: Array<() => void | Promise<void>> = [];
    if (this.hooks.observers?.onGadgetExecutionComplete) {
      completeObservers.push(async () => {
        const context: ObserveGadgetCompleteContext = {
          iteration: this.iteration,
          gadgetName: result.gadgetName,
          invocationId: result.invocationId,
          parameters,
          originalResult,
          finalResult: result.result,
          error: result.error,
          executionTimeMs: result.executionTimeMs,
          breaksLoop: result.breaksLoop,
          cost: result.cost,
          logger: this.logger,
        };
        await this.hooks.observers!.onGadgetExecutionComplete!(context);
      });
    }
    await this.runObserversInParallel(completeObservers);

    // Track completion for dependency resolution
    this.completedResults.set(result.invocationId, result);
    if (result.error) {
      this.failedInvocations.add(result.invocationId);
    }

    // Emit result event
    events.push({ type: "gadget_result", result });

    // Check if we should stop after error
    if (result.error) {
      const errorType = this.determineErrorType(call, result);
      const shouldContinue = await this.checkContinueAfterError(
        result.error,
        result.gadgetName,
        errorType,
        result.parameters,
      );

      if (!shouldContinue) {
        this.shouldStopExecution = true;
      }
    }

    return events;
  }

  /**
   * Handle a gadget that cannot execute because a dependency failed.
   * Calls the onDependencySkipped controller to allow customization.
   */
  private async handleFailedDependency(
    call: ParsedGadgetCall,
    failedDep: string,
  ): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    const depResult = this.completedResults.get(failedDep);
    const depError = depResult?.error ?? "Dependency failed";

    // Call controller to allow customization of skip behavior
    let action: DependencySkipAction = { action: "skip" };
    if (this.hooks.controllers?.onDependencySkipped) {
      const context: DependencySkipControllerContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        failedDependency: failedDep,
        failedDependencyError: depError,
        logger: this.logger,
      };
      action = await this.hooks.controllers.onDependencySkipped(context);
    }

    if (action.action === "skip") {
      // Mark as failed so downstream dependents also skip
      this.failedInvocations.add(call.invocationId);

      // Emit skip event
      const skipEvent: GadgetSkippedEvent = {
        type: "gadget_skipped",
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        failedDependency: failedDep,
        failedDependencyError: depError,
      };
      events.push(skipEvent);

      // Call observer
      if (this.hooks.observers?.onGadgetSkipped) {
        const observeContext: ObserveGadgetSkippedContext = {
          iteration: this.iteration,
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          failedDependency: failedDep,
          failedDependencyError: depError,
          logger: this.logger,
        };
        await this.safeObserve(() => this.hooks.observers!.onGadgetSkipped!(observeContext));
      }

      this.logger.info("Gadget skipped due to failed dependency", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        failedDependency: failedDep,
      });
    } else if (action.action === "execute_anyway") {
      // Execute despite failed dependency
      this.logger.info("Executing gadget despite failed dependency (controller override)", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        failedDependency: failedDep,
      });
      const executeEvents = await this.executeGadgetWithHooks(call);
      events.push(...executeEvents);
    } else if (action.action === "use_fallback") {
      // Use fallback result without executing
      const fallbackResult: GadgetExecutionResult = {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        result: action.fallbackResult,
        executionTimeMs: 0,
      };
      this.completedResults.set(call.invocationId, fallbackResult);
      events.push({ type: "gadget_result", result: fallbackResult });

      this.logger.info("Using fallback result for gadget with failed dependency", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        failedDependency: failedDep,
      });
    }

    return events;
  }

  /**
   * Process pending gadgets whose dependencies are now satisfied.
   * Executes ready gadgets in parallel and continues until no more can be triggered.
   */
  private async processPendingGadgets(): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    let progress = true;

    while (progress && this.pendingGadgets.size > 0) {
      progress = false;

      // Find all gadgets that are ready to execute
      const readyToExecute: ParsedGadgetCall[] = [];
      const readyToSkip: Array<{ call: ParsedGadgetCall; failedDep: string }> = [];

      for (const [invocationId, call] of this.pendingGadgets) {
        // Check for failed dependency
        const failedDep = call.dependencies.find((dep) => this.failedInvocations.has(dep));
        if (failedDep) {
          readyToSkip.push({ call, failedDep });
          continue;
        }

        // Check if all dependencies are satisfied
        const allSatisfied = call.dependencies.every((dep) => this.completedResults.has(dep));
        if (allSatisfied) {
          readyToExecute.push(call);
        }
      }

      // Handle skipped gadgets
      for (const { call, failedDep } of readyToSkip) {
        this.pendingGadgets.delete(call.invocationId);
        const skipEvents = await this.handleFailedDependency(call, failedDep);
        events.push(...skipEvents);
        progress = true;
      }

      // Execute ready gadgets in parallel
      if (readyToExecute.length > 0) {
        this.logger.debug("Executing ready gadgets in parallel", {
          count: readyToExecute.length,
          invocationIds: readyToExecute.map((c) => c.invocationId),
        });

        // Remove from pending before executing
        for (const call of readyToExecute) {
          this.pendingGadgets.delete(call.invocationId);
        }

        // Execute all ready gadgets in parallel
        const executePromises = readyToExecute.map((call) => this.executeGadgetWithHooks(call));
        const results = await Promise.all(executePromises);

        // Collect all events
        for (const executeEvents of results) {
          events.push(...executeEvents);
        }

        progress = true;
      }
    }

    // Warn about any remaining unresolved gadgets (circular or missing dependencies)
    if (this.pendingGadgets.size > 0) {
      for (const [invocationId, call] of this.pendingGadgets) {
        const missingDeps = call.dependencies.filter((dep) => !this.completedResults.has(dep));
        this.logger.warn("Gadget has unresolvable dependencies (possibly circular or missing)", {
          gadgetName: call.gadgetName,
          invocationId,
          missingDependencies: missingDeps,
        });

        // Mark as failed and emit skip event
        this.failedInvocations.add(invocationId);
        const skipEvent: GadgetSkippedEvent = {
          type: "gadget_skipped",
          gadgetName: call.gadgetName,
          invocationId,
          parameters: call.parameters ?? {},
          failedDependency: missingDeps[0],
          failedDependencyError: `Dependency "${missingDeps[0]}" was never executed (circular or missing)`,
        };
        events.push(skipEvent);
      }
      this.pendingGadgets.clear();
    }

    return events;
  }

  /**
   * Safely execute an observer, catching and logging any errors.
   * Observers are non-critical, so errors are logged but don't crash the system.
   */
  private async safeObserve(fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.observerFailureCount++;
      this.logger.error("Observer threw error (ignoring)", {
        error: error instanceof Error ? error.message : String(error),
        failureCount: this.observerFailureCount,
      });
    }
  }

  /**
   * Execute multiple observers in parallel.
   * All observers run concurrently and failures are tracked but don't crash.
   */
  private async runObserversInParallel(
    observers: Array<() => void | Promise<void>>,
  ): Promise<void> {
    if (observers.length === 0) return;

    const results = await Promise.allSettled(
      observers.map((observer) => this.safeObserve(observer)),
    );

    // All errors are already logged in safeObserve, no need to handle rejected promises
    // This just ensures we wait for all observers to complete
  }

  /**
   * Check if execution should continue after an error.
   *
   * Returns true if we should continue processing subsequent gadgets, false if we should stop.
   *
   * Logic:
   * - If custom shouldContinueAfterError is provided, use it
   * - Otherwise, use stopOnGadgetError config:
   *   - stopOnGadgetError=true → return false (stop execution)
   *   - stopOnGadgetError=false → return true (continue execution)
   */
  private async checkContinueAfterError(
    error: string,
    gadgetName: string,
    errorType: "parse" | "validation" | "execution",
    parameters?: Record<string, unknown>,
  ): Promise<boolean> {
    // Custom error continuation logic takes precedence
    if (this.shouldContinueAfterError) {
      return await this.shouldContinueAfterError({
        error,
        gadgetName,
        errorType,
        parameters,
      });
    }

    // Default behavior based on stopOnGadgetError config
    // If stopOnGadgetError=true, we want to STOP (return false to stop continuing)
    // If stopOnGadgetError=false, we want to CONTINUE (return true to keep going)
    const shouldContinue = !this.stopOnGadgetError;

    this.logger.debug("Checking if should continue after error", {
      error,
      gadgetName,
      errorType,
      stopOnGadgetError: this.stopOnGadgetError,
      shouldContinue,
    });

    return shouldContinue;
  }

  /**
   * Determine the type of error from a gadget execution.
   */
  private determineErrorType(
    call: ParsedGadgetCall,
    result: GadgetExecutionResult,
  ): "parse" | "validation" | "execution" {
    if (call.parseError) {
      return "parse";
    }
    if (result.error?.includes("Invalid parameters:")) {
      return "validation";
    }
    return "execution";
  }
}
