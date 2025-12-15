import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { Command } from "commander";
import { AgentBuilder } from "../agent/builder.js";
import { isAbortError } from "../core/errors.js";
import type { ContentPart } from "../core/input-content.js";
import { text } from "../core/input-content.js";
import type { LLMMessage } from "../core/messages.js";
import type { TokenUsage } from "../core/options.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type { LLMCallInfo } from "../gadgets/types.js";
import { FALLBACK_CHARS_PER_TOKEN } from "../providers/constants.js";
import { type ApprovalConfig, ApprovalManager } from "./approval/index.js";
import { builtinGadgets } from "./builtin-gadgets.js";
import type { AgentConfig, GlobalSubagentConfig } from "./config.js";
import { buildSubagentConfigMap } from "./subagent-config.js";
import { COMMANDS } from "./constants.js";
import {
  createDockerContext,
  type DockerOptions,
  DockerSkipError,
  executeInDocker,
  resolveDockerEnabled,
} from "./docker/index.js";
import type { CLIEnvironment } from "./environment.js";
import { readAudioFile, readImageFile } from "./file-utils.js";
import { loadGadgets } from "./gadgets.js";
import {
  createSessionDir,
  formatCallNumber,
  formatLlmRequest,
  resolveLogDir,
  writeLogFile,
} from "./llm-logging.js";
import { type CLIAgentOptions, addAgentOptions } from "./option-helpers.js";
import {
  formatGadgetStarted,
  formatGadgetSummary,
  renderMarkdownWithSeparators,
  renderOverallSummary,
} from "./ui/formatters.js";
import {
  createEscKeyListener,
  createSigintListener,
  executeAction,
  isInteractive,
  renderSummary,
  resolvePrompt,
  StreamPrinter,
  StreamProgress,
} from "./utils.js";

/**
 * Keyboard/signal listener management for ESC key and Ctrl+C (SIGINT) handling.
 * Allows pausing and restoring the ESC listener during readline operations.
 */
interface KeyboardManager {
  cleanupEsc: (() => void) | null;
  cleanupSigint: (() => void) | null;
  restore: () => void;
}

/**
 * Creates a human input handler for interactive mode.
 * Only returns a handler if stdin is a TTY (terminal), not a pipe.
 *
 * @param env - CLI environment
 * @param progress - Progress indicator to pause during input
 * @param keyboard - Keyboard listener manager for ESC handling
 * @returns Human input handler function or undefined if not interactive
 */
function createHumanInputHandler(
  env: CLIEnvironment,
  progress: StreamProgress,
  keyboard: KeyboardManager,
): ((question: string) => Promise<string>) | undefined {
  const stdout = env.stdout as NodeJS.WriteStream;
  if (!isInteractive(env.stdin) || typeof stdout.isTTY !== "boolean" || !stdout.isTTY) {
    return undefined;
  }

  return async (question: string): Promise<string> => {
    progress.pause(); // Pause progress indicator during human input

    // Temporarily disable ESC listener for readline (raw mode conflict)
    if (keyboard.cleanupEsc) {
      keyboard.cleanupEsc();
      keyboard.cleanupEsc = null;
    }

    const rl = createInterface({ input: env.stdin, output: env.stdout });
    try {
      // Display question on first prompt only (with markdown rendering and separators)
      const questionLine = question.trim()
        ? `\n${renderMarkdownWithSeparators(question.trim())}`
        : "";
      let isFirst = true;

      // Loop until non-empty input (like a REPL)
      while (true) {
        const statsPrompt = progress.formatPrompt();
        const prompt = isFirst ? `${questionLine}\n${statsPrompt}` : statsPrompt;
        isFirst = false;

        const answer = await rl.question(prompt);
        const trimmed = answer.trim();
        if (trimmed) {
          return trimmed;
        }
        // Empty input - show prompt again (no question repeat)
      }
    } finally {
      rl.close();
      // Restore ESC listener after readline closes
      keyboard.restore();
    }
  };
}

// formatGadgetSummary is now imported from ./ui/formatters.js
// This demonstrates clean code organization and reusability

/**
 * Executes the agent command.
 *
 * SHOWCASE: This function demonstrates how to build a production-grade CLI
 * on top of llmist's core capabilities:
 *
 * 1. **Dynamic gadget loading** - GadgetRegistry for plugin-like extensibility
 * 2. **Observer hooks** - Custom progress tracking and real-time UI updates
 * 3. **Event-driven execution** - React to agent events (text, gadget results)
 * 4. **ModelRegistry integration** - Automatic cost estimation and tracking
 * 5. **Streaming support** - Display LLM output as it's generated
 * 6. **Human-in-the-loop** - Interactive prompts during agent execution
 * 7. **Clean separation** - stdout for content, stderr for metrics/progress
 *
 * The implementation showcases llmist's flexibility: from simple scripts to
 * polished CLIs with spinners, cost tracking, and real-time feedback.
 *
 * @param promptArg - User prompt from command line argument (optional if using stdin)
 * @param options - Agent command options (model, gadgets, max iterations, etc.)
 * @param env - CLI environment for I/O operations
 */
export async function executeAgent(
  promptArg: string | undefined,
  options: CLIAgentOptions,
  env: CLIEnvironment,
): Promise<void> {
  // Check if Docker sandboxing is enabled
  const dockerOptions: DockerOptions = {
    docker: options.docker ?? false,
    dockerRo: options.dockerRo ?? false,
    noDocker: options.noDocker ?? false,
  };

  const dockerEnabled = resolveDockerEnabled(
    env.dockerConfig,
    dockerOptions,
    options.docker, // Profile-level docker: true/false
  );

  if (dockerEnabled) {
    // Execute inside Docker container
    const ctx = createDockerContext(
      env.dockerConfig,
      dockerOptions,
      env.argv.slice(2), // Remove 'node' and script path
      process.cwd(),
      options.dockerCwdPermission, // Profile-level CWD permission override
    );

    try {
      await executeInDocker(ctx);
      // executeInDocker calls process.exit(), so we won't reach here
    } catch (error) {
      // DockerSkipError means we're already inside a container, continue normally
      if (error instanceof DockerSkipError) {
        // Continue with normal execution
      } else {
        throw error;
      }
    }
  }

  const prompt = await resolvePrompt(promptArg, env);
  const client = env.createClient();

  // SHOWCASE: llmist's GadgetRegistry for dynamic tool loading
  // This demonstrates how to build extensible CLIs with plugin-like functionality
  const registry = new GadgetRegistry();

  // Register built-in gadgets for basic agent interaction
  // SHOWCASE: Built-in gadgets enable conversation without any custom tools
  //
  // AskUser: Prompts user for input during agent execution
  // TellUser: Displays formatted messages and optionally ends the loop
  //
  // Flags control built-in behavior:
  // --no-builtins: Exclude all built-in gadgets
  // --no-builtin-interaction: Exclude only AskUser (keeps TellUser for output)
  //
  // AskUser is also auto-excluded when stdin is not interactive (piped input)
  const stdinIsInteractive = isInteractive(env.stdin);
  if (options.builtins !== false) {
    for (const gadget of builtinGadgets) {
      // Skip AskUser if:
      // 1. --no-builtin-interaction is set, OR
      // 2. stdin is not interactive (piped input) - AskUser can't work anyway
      if (
        gadget.name === "AskUser" &&
        (options.builtinInteraction === false || !stdinIsInteractive)
      ) {
        continue;
      }
      registry.registerByClass(gadget);
    }
  }

  // Load user-provided gadgets from file paths
  // SHOWCASE: Dynamic gadget loading enables custom tools without recompiling
  // Users can provide gadgets via -g/--gadget flag, supporting any TypeScript class
  const gadgetSpecifiers = options.gadget ?? [];
  if (gadgetSpecifiers.length > 0) {
    const gadgets = await loadGadgets(gadgetSpecifiers, process.cwd());
    for (const gadget of gadgets) {
      // Later registrations can override earlier ones
      // This allows users to customize built-in behavior
      registry.registerByClass(gadget);
    }
  }

  // Display all registered gadget names (built-ins + user-provided)
  if (!options.quiet) {
    const allNames = registry
      .getAll()
      .map((g) => g.name)
      .join(", ");
    env.stderr.write(chalk.dim(`Gadgets: ${allNames}\n`));
  }

  const printer = new StreamPrinter(env.stdout);
  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
  const progress = new StreamProgress(env.stderr, stderrTTY, client.modelRegistry);

  // Set up cancellation support for ESC key and Ctrl+C (SIGINT) handling
  const abortController = new AbortController();
  let wasCancelled = false;
  let isStreaming = false; // Track if LLM call is in progress
  const stdinStream = env.stdin as NodeJS.ReadStream;

  // Shared cancel handler for both ESC and Ctrl+C
  const handleCancel = () => {
    if (!abortController.signal.aborted) {
      wasCancelled = true;
      abortController.abort();
      progress.pause();
      env.stderr.write(chalk.yellow(`\n[Cancelled] ${progress.formatStats()}\n`));
    } else {
      // Already cancelled - treat as quit request (like double Ctrl+C)
      // This ensures the user can always exit even if the abort didn't fully propagate
      handleQuit();
    }
  };

  // Create keyboard manager for ESC/SIGINT listener coordination with readline
  const keyboard: KeyboardManager = {
    cleanupEsc: null,
    cleanupSigint: null,
    restore: () => {
      // Only restore ESC listener if not cancelled - when wasCancelled is true,
      // the executeAgent function is terminating and we don't need the listener.
      // This is called after readline closes to re-enable ESC key detection.
      if (stdinIsInteractive && stdinStream.isTTY && !wasCancelled) {
        keyboard.cleanupEsc = createEscKeyListener(stdinStream, handleCancel, handleCancel);
      }
    },
  };

  // Quit handler for double Ctrl+C - shows summary and exits
  const handleQuit = () => {
    // Clean up listeners
    keyboard.cleanupEsc?.();
    keyboard.cleanupSigint?.();

    progress.complete();
    printer.ensureNewline();

    // Show final summary
    const summary = renderOverallSummary({
      totalTokens: usage?.totalTokens,
      iterations,
      elapsedSeconds: progress.getTotalElapsedSeconds(),
      cost: progress.getTotalCost(),
    });

    if (summary) {
      env.stderr.write(`${chalk.dim("─".repeat(40))}\n`);
      env.stderr.write(`${summary}\n`);
    }

    env.stderr.write(chalk.dim("[Quit]\n"));
    process.exit(130); // SIGINT convention: 128 + signal number (2)
  };

  // Set up ESC key and Ctrl+C listener if in interactive TTY mode
  // Both ESC and Ctrl+C trigger handleCancel during streaming
  if (stdinIsInteractive && stdinStream.isTTY) {
    keyboard.cleanupEsc = createEscKeyListener(stdinStream, handleCancel, handleCancel);
  }

  // Set up SIGINT (Ctrl+C) listener - always active for graceful cancellation
  keyboard.cleanupSigint = createSigintListener(
    handleCancel,
    handleQuit,
    () => isStreaming && !abortController.signal.aborted,
    env.stderr,
  );

  // Set up gadget approval manager
  // Default: RunCommand, WriteFile, EditFile require approval unless overridden by config
  const DEFAULT_APPROVAL_REQUIRED = ["RunCommand", "WriteFile", "EditFile"];
  const userApprovals = options.gadgetApproval ?? {};

  // Apply defaults for dangerous gadgets if not explicitly configured
  const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
    ...userApprovals,
  };
  for (const gadget of DEFAULT_APPROVAL_REQUIRED) {
    const normalizedGadget = gadget.toLowerCase();
    const isConfigured = Object.keys(userApprovals).some(
      (key) => key.toLowerCase() === normalizedGadget,
    );
    if (!isConfigured) {
      gadgetApprovals[gadget] = "approval-required";
    }
  }

  const approvalConfig: ApprovalConfig = {
    gadgetApprovals,
    defaultMode: "allowed",
  };
  const approvalManager = new ApprovalManager(approvalConfig, env, progress, keyboard);

  let usage: TokenUsage | undefined;
  let iterations = 0;

  // Resolve LLM debug log directory (if enabled)
  const llmLogsBaseDir = resolveLogDir(options.logLlmRequests, "requests");
  let llmSessionDir: string | undefined;
  let llmCallCounter = 0;

  // Count tokens accurately using provider-specific methods
  const countMessagesTokens = async (model: string, messages: LLMMessage[]): Promise<number> => {
    try {
      return await client.countTokens(model, messages);
    } catch {
      // Fallback to character-based estimation if counting fails
      const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
      return Math.round(totalChars / FALLBACK_CHARS_PER_TOKEN);
    }
  };

  // Count tokens for gadget output text
  const countGadgetOutputTokens = async (
    output: string | undefined,
  ): Promise<number | undefined> => {
    if (!output) return undefined;
    try {
      // Wrap gadget output as assistant message for accurate token counting
      const messages: LLMMessage[] = [{ role: "assistant", content: output }];
      return await client.countTokens(options.model, messages);
    } catch {
      // Fallback: return undefined to trigger byte count fallback in formatter
      return undefined;
    }
  };

  // Build the agent with hooks for progress tracking
  // SHOWCASE: This demonstrates llmist's observer pattern for building custom UIs
  //
  // For simpler use cases, use HookPresets.progressTracking() instead:
  //   .withHooks(HookPresets.progressTracking({
  //     modelRegistry: client.modelRegistry,
  //     onProgress: (stats) => { /* update your UI */ }
  //   }))
  //
  // The CLI uses custom hooks for fine-grained control over the spinner animation
  // and real-time updates, showcasing llmist's flexibility for building polished UIs.
  // Build resolved subagent config map for subagent gadgets to inherit settings
  const resolvedSubagentConfig = buildSubagentConfigMap(
    options.model,
    options.subagents,
    options.globalSubagents,
  );

  const builder = new AgentBuilder(client)
    .withModel(options.model)
    .withSubagentConfig(resolvedSubagentConfig)
    .withLogger(env.createLogger("llmist:cli:agent"))
    .withHooks({
      observers: {
        // onLLMCallStart: Start progress indicator for each LLM call
        // This showcases how to react to agent lifecycle events
        // Skip for subagent events (tracked separately via nested display)
        onLLMCallStart: async (context) => {
          if (context.subagentContext) return; // Subagent calls handled via withSubagentEventCallback

          isStreaming = true; // Mark that we're actively streaming (for SIGINT handling)
          llmCallCounter++;

          // Count input tokens accurately using provider-specific methods
          // This ensures we never show ~ for input tokens
          const inputTokens = await countMessagesTokens(
            context.options.model,
            context.options.messages,
          );
          progress.startCall(context.options.model, inputTokens);
          // Mark input tokens as accurate (not estimated)
          progress.setInputTokens(inputTokens, false);
        },

        // onLLMCallReady: Log the exact request being sent to the LLM
        // This fires AFTER controller modifications (e.g., trailing messages)
        onLLMCallReady: async (context) => {
          if (llmLogsBaseDir) {
            if (!llmSessionDir) {
              llmSessionDir = await createSessionDir(llmLogsBaseDir);
            }
            if (llmSessionDir) {
              const filename = `${formatCallNumber(llmCallCounter)}.request`;
              const content = formatLlmRequest(context.options.messages);
              await writeLogFile(llmSessionDir, filename, content);
            }
          }
        },
        // onStreamChunk: Real-time updates as LLM generates tokens
        // This enables responsive UIs that show progress during generation
        // Skip for subagent events (tracked separately via nested display)
        onStreamChunk: async (context) => {
          if (context.subagentContext) return; // Subagent chunks handled via withSubagentEventCallback

          // Update estimated output tokens from accumulated text length
          progress.update(context.accumulatedText.length);

          // Use exact token counts when available from streaming response
          // SHOWCASE: Provider responses include token usage for accurate tracking
          if (context.usage) {
            if (context.usage.inputTokens) {
              progress.setInputTokens(context.usage.inputTokens, false);
            }
            if (context.usage.outputTokens) {
              progress.setOutputTokens(context.usage.outputTokens, false);
            }
            // Update cached token counts for live cost estimation
            progress.setCachedTokens(
              context.usage.cachedInputTokens ?? 0,
              context.usage.cacheCreationInputTokens ?? 0,
            );
          }
        },

        // onLLMCallComplete: Finalize metrics after each LLM call
        // This is where you'd typically log metrics or update dashboards
        // Skip progress updates for subagent events (tracked separately via nested display)
        onLLMCallComplete: async (context) => {
          if (context.subagentContext) return; // Subagent calls handled via withSubagentEventCallback

          isStreaming = false; // Mark that streaming is complete (for SIGINT handling)

          // Capture completion metadata for final summary
          usage = context.usage;
          iterations = Math.max(iterations, context.iteration + 1);

          // Update with final exact token counts from provider
          // SHOWCASE: llmist normalizes token usage across all providers
          if (context.usage) {
            if (context.usage.inputTokens) {
              progress.setInputTokens(context.usage.inputTokens, false);
            }
            if (context.usage.outputTokens) {
              progress.setOutputTokens(context.usage.outputTokens, false);
            }
          }

          // Calculate per-call cost for the summary (accounting for cached tokens)
          // Use context.options.model (resolved) instead of options.model (raw CLI input)
          // This ensures aliases like "sonnet" are resolved to "claude-sonnet-4-5"
          let callCost: number | undefined;
          if (context.usage && client.modelRegistry) {
            try {
              const modelName = context.options.model.includes(":")
                ? context.options.model.split(":")[1]
                : context.options.model;
              const costResult = client.modelRegistry.estimateCost(
                modelName,
                context.usage.inputTokens,
                context.usage.outputTokens,
                context.usage.cachedInputTokens ?? 0,
                context.usage.cacheCreationInputTokens ?? 0,
              );
              if (costResult) callCost = costResult.totalCost;
            } catch {
              // Ignore cost calculation errors
            }
          }

          // Get per-call elapsed time before endCall resets it
          const callElapsed = progress.getCallElapsedSeconds();

          // End this call's progress tracking and switch to cumulative mode
          progress.endCall(context.usage);

          // SHOWCASE: Print per-call summary after each LLM call
          // This gives users visibility into each iteration's metrics
          // Skip summaries in quiet mode or for subagent events (tracked separately via nested display)
          if (!options.quiet && !context.subagentContext) {
            const summary = renderSummary({
              iterations: context.iteration + 1,
              model: options.model,
              usage: context.usage,
              elapsedSeconds: callElapsed,
              cost: callCost,
              finishReason: context.finishReason,
            });
            if (summary) {
              env.stderr.write(`${summary}\n`);
            }
          }

          // Write LLM response to debug log if enabled
          if (llmSessionDir) {
            const filename = `${formatCallNumber(llmCallCounter)}.response`;
            await writeLogFile(llmSessionDir, filename, context.rawResponse);
          }
        },
      },

      // SHOWCASE: Controller-based approval gating for gadgets
      //
      // This demonstrates how to add safety layers WITHOUT modifying gadgets.
      // The ApprovalManager handles approval flows externally via beforeGadgetExecution.
      // Approval modes are configurable via cli.toml:
      //   - "allowed": auto-proceed
      //   - "denied": auto-reject, return message to LLM
      //   - "approval-required": prompt user interactively
      //
      // Default: RunCommand, WriteFile, EditFile require approval unless overridden.
      controllers: {
        beforeGadgetExecution: async (ctx) => {
          const mode = approvalManager.getApprovalMode(ctx.gadgetName);

          // Fast path: allowed gadgets proceed immediately
          if (mode === "allowed") {
            return { action: "proceed" };
          }

          // Check if we can prompt (interactive mode required for approval-required)
          const stdinTTY = isInteractive(env.stdin);
          const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
          const canPrompt = stdinTTY && stderrTTY;

          // Non-interactive mode handling
          if (!canPrompt) {
            if (mode === "approval-required") {
              return {
                action: "skip",
                syntheticResult: `status=denied\n\n${ctx.gadgetName} requires interactive approval. Run in a terminal to approve.`,
              };
            }
            if (mode === "denied") {
              return {
                action: "skip",
                syntheticResult: `status=denied\n\n${ctx.gadgetName} is denied by configuration.`,
              };
            }
            return { action: "proceed" };
          }

          // Interactive mode: use approval manager
          const result = await approvalManager.requestApproval(ctx.gadgetName, ctx.parameters);

          if (!result.approved) {
            return {
              action: "skip",
              syntheticResult: `status=denied\n\nDenied: ${result.reason ?? "by user"}`,
            };
          }

          return { action: "proceed" };
        },
      },
    });

  // Add optional configurations
  if (options.system) {
    builder.withSystem(options.system);
  }
  if (options.maxIterations !== undefined) {
    builder.withMaxIterations(options.maxIterations);
  }
  if (options.temperature !== undefined) {
    builder.withTemperature(options.temperature);
  }

  const humanInputHandler = createHumanInputHandler(env, progress, keyboard);
  if (humanInputHandler) {
    builder.onHumanInput(humanInputHandler);
  }

  // Pass abort signal for ESC key cancellation
  builder.withSignal(abortController.signal);

  // Add gadgets from the registry
  const gadgets = registry.getAll();
  if (gadgets.length > 0) {
    builder.withGadgets(...gadgets);
  }

  // Set custom gadget markers if configured, otherwise use library defaults
  if (options.gadgetStartPrefix) {
    builder.withGadgetStartPrefix(options.gadgetStartPrefix);
  }
  if (options.gadgetEndPrefix) {
    builder.withGadgetEndPrefix(options.gadgetEndPrefix);
  }
  if (options.gadgetArgPrefix) {
    builder.withGadgetArgPrefix(options.gadgetArgPrefix);
  }

  // Inject synthetic heredoc example for in-context learning
  // This teaches the LLM to use heredoc syntax (<<<EOF...EOF) for multiline strings
  // by showing what "past self" did correctly. LLMs mimic patterns in conversation history.
  builder.withSyntheticGadgetCall(
    "TellUser",
    {
      message:
        "👋 Hello! I'm ready to help.\n\nHere's what I can do:\n- Analyze your codebase\n- Execute commands\n- Answer questions\n\nWhat would you like me to work on?",
      done: false,
      type: "info",
    },
    "ℹ️  👋 Hello! I'm ready to help.\n\nHere's what I can do:\n- Analyze your codebase\n- Execute commands\n- Answer questions\n\nWhat would you like me to work on?",
  );

  // Continue looping when LLM responds with just text (no gadget calls)
  // This allows multi-turn conversations where the LLM may explain before acting
  builder.withTextOnlyHandler("acknowledge");

  // Wrap text that accompanies gadget calls as TellUser gadget calls
  // This keeps conversation history consistent and gadget-oriented
  builder.withTextWithGadgetsHandler({
    gadgetName: "TellUser",
    parameterMapping: (text) => ({ message: text, done: false, type: "info" }),
    resultMapping: (text) => `ℹ️  ${text}`,
  });

  // Inject ephemeral trailing message to encourage parallel gadget invocations
  // This message is appended to each LLM request but NOT persisted in history
  builder.withTrailingMessage((ctx) =>
    [
      `[Iteration ${ctx.iteration + 1}/${ctx.maxIterations}]`,
      "Think carefully: what gadget invocations can you make in parallel right now?",
      "Maximize efficiency by batching independent operations in a single response.",
    ].join(" "),
  );

  // Subagent events (from BrowseWeb, etc.) require callback-based handling
  // for REAL-TIME display. Stream-based events are delayed until the gadget completes
  // because flushPendingSubagentEvents() only runs after each stream processor yield.
  //
  // withSubagentEventCallback() fires IMMEDIATELY when events occur, enabling real-time
  // progress updates during long-running gadgets like BrowseWeb (45+ seconds).
  // The stream-based events (subagent_event) are still useful for simpler apps.
  if (!options.quiet) {
    builder.withSubagentEventCallback((subagentEvent) => {
      if (subagentEvent.type === "llm_call_start") {
        const info = subagentEvent.event as LLMCallInfo;
        const subagentId = `${subagentEvent.gadgetInvocationId}:${info.iteration}`;
        progress.addNestedAgent(
          subagentId,
          subagentEvent.gadgetInvocationId,
          subagentEvent.depth,
          info.model,
          info.iteration,
          info.inputTokens,
        );
      } else if (subagentEvent.type === "llm_call_end") {
        const info = subagentEvent.event as LLMCallInfo;
        const subagentId = `${subagentEvent.gadgetInvocationId}:${info.iteration}`;
        // Pass full metrics for first-class subagent display
        progress.updateNestedAgent(subagentId, {
          inputTokens: info.usage?.inputTokens ?? info.inputTokens,
          outputTokens: info.usage?.outputTokens ?? info.outputTokens,
          cachedInputTokens: info.usage?.cachedInputTokens,
          cacheCreationInputTokens: info.usage?.cacheCreationInputTokens,
          finishReason: info.finishReason,
          cost: info.cost,
        });
        // Note: No removal - nested agent stays visible with frozen timer and ✓ indicator
      } else if (subagentEvent.type === "gadget_call") {
        const gadgetEvent = subagentEvent.event as { call: { invocationId: string; gadgetName: string; parameters?: Record<string, unknown> } };
        progress.addNestedGadget(
          gadgetEvent.call.invocationId,
          subagentEvent.depth,
          subagentEvent.gadgetInvocationId,
          gadgetEvent.call.gadgetName,
          gadgetEvent.call.parameters,
        );
      } else if (subagentEvent.type === "gadget_result") {
        const resultEvent = subagentEvent.event as { result: { invocationId: string } };
        progress.completeNestedGadget(resultEvent.result.invocationId);
      }
    });
  }

  // Build and start the agent
  // Use multimodal content if --image or --audio flags are present
  let agent;
  if (options.image || options.audio) {
    const parts: ContentPart[] = [text(prompt)];

    if (options.image) {
      parts.push(await readImageFile(options.image));
    }
    if (options.audio) {
      parts.push(await readAudioFile(options.audio));
    }

    agent = builder.askWithContent(parts);
  } else {
    agent = builder.ask(prompt);
  }

  // SHOWCASE: llmist's event-driven agent execution
  // The agent emits events as it runs, enabling reactive UIs
  //
  // Event types:
  // - "text": LLM-generated text chunks (streaming or complete)
  // - "gadget_result": Results from gadget/tool executions
  // - "human_input_required": Agent needs user input (handled via callback)
  //
  // This pattern allows building:
  // - Real-time streaming UIs
  // - Progress indicators during tool execution
  // - Separation of business logic (agent) from presentation (UI)

  // Buffer for accumulating text chunks - markdown rendering requires complete content
  let textBuffer = "";
  const flushTextBuffer = () => {
    if (textBuffer) {
      // Use separators in normal mode, plain text in quiet mode
      const output = options.quiet ? textBuffer : renderMarkdownWithSeparators(textBuffer);
      printer.write(output);
      textBuffer = "";
    }
  };

  try {
    for await (const event of agent.run()) {
      if (event.type === "text") {
        // Accumulate text chunks - we'll render markdown when complete
        // Don't pause progress - it can continue showing while we buffer text
        textBuffer += event.content;
      } else if (event.type === "gadget_call") {
        // Flush any accumulated text before tracking gadget
        flushTextBuffer();

        if (!options.quiet) {
          // Add gadget to progress tracking - it will show in multi-line status
          progress.addGadget(
            event.call.invocationId,
            event.call.gadgetName,
            event.call.parameters,
          );
          // Ensure progress is running to show gadget execution in real-time
          // (flushTextBuffer may have paused it)
          progress.start();
        }
      } else if (event.type === "gadget_result") {
        // Flush any accumulated text before showing gadget result
        flushTextBuffer();

        if (!options.quiet) {
          // Remove gadget from in-flight tracking
          progress.removeGadget(event.result.invocationId);
        }

        // Pause progress to write the completion summary
        progress.pause();

        if (options.quiet) {
          // In quiet mode, only output TellUser messages (to stdout, plain unrendered text)
          if (event.result.gadgetName === "TellUser" && event.result.parameters?.message) {
            const message = String(event.result.parameters.message);
            env.stdout.write(`${message}\n`);
          }
        } else {
          // Normal mode: show full gadget summary on stderr
          const tokenCount = await countGadgetOutputTokens(event.result.result);
          env.stderr.write(
            `${formatGadgetSummary({ ...event.result, tokenCount, media: event.result.storedMedia })}\n`,
          );
        }

        // Resume progress if there are more gadgets in flight or LLM is still streaming
        if (progress.hasInFlightGadgets()) {
          progress.start();
        }
        // Otherwise, progress resumes on next LLM call (via onLLMCallStart hook)
      } else if (event.type === "subagent_event") {
        // Subagent events are handled by withSubagentEventCallback() for real-time updates.
        // Stream-based events arrive AFTER gadget completes (too late for progress display).
        // This branch exists for apps that prefer stream-based handling over callbacks.
        // CLI uses callback for immediate updates; nothing to do here.
      }
      // Note: human_input_required handled by callback (see createHumanInputHandler)
    }
  } catch (error) {
    // Handle abort gracefully - message already shown in ESC handler
    if (!isAbortError(error)) {
      throw error;
    }
    // Keep partial response in buffer for flushing below
  } finally {
    // Always cleanup keyboard and signal listeners
    isStreaming = false;
    keyboard.cleanupEsc?.();

    // Replace the complex SIGINT handler with a simple exit handler
    // This ensures Ctrl+C always works even if something keeps the event loop alive
    if (keyboard.cleanupSigint) {
      keyboard.cleanupSigint();
      process.once("SIGINT", () => process.exit(130)); // 130 = 128 + SIGINT (2)
    }
  }

  // Flush any remaining buffered text with markdown rendering (includes partial on cancel)
  flushTextBuffer();

  progress.complete();
  printer.ensureNewline();

  // SHOWCASE: Show overall summary only if there were multiple iterations
  // Single-iteration runs already showed per-call summary, no need to repeat
  // Skip summaries in quiet mode
  if (!options.quiet && iterations > 1) {
    // Separator line to distinguish from per-call summaries
    env.stderr.write(`${chalk.dim("─".repeat(40))}\n`);

    const summary = renderOverallSummary({
      totalTokens: usage?.totalTokens,
      iterations,
      elapsedSeconds: progress.getTotalElapsedSeconds(),
      cost: progress.getTotalCost(),
    });
    if (summary) {
      env.stderr.write(`${summary}\n`);
    }
  }
}

/**
 * Registers the agent command with the CLI program.
 * Configures options for model, gadgets, max iterations, temperature, and parameter format.
 *
 * @param program - Commander program to register the command with
 * @param env - CLI environment for dependencies and I/O
 * @param config - Optional configuration defaults from config file
 */
export function registerAgentCommand(
  program: Command,
  env: CLIEnvironment,
  config?: AgentConfig,
  globalSubagents?: GlobalSubagentConfig,
): void {
  const cmd = program
    .command(COMMANDS.agent)
    .description("Run the llmist agent loop with optional gadgets.")
    .argument("[prompt]", "Prompt for the agent loop. Falls back to stdin when available.");

  addAgentOptions(cmd, config);

  cmd.action((prompt, options) =>
    executeAction(() => {
      // Merge config-only options (no CLI flags) into command options
      const mergedOptions: CLIAgentOptions = {
        ...(options as CLIAgentOptions),
        gadgetApproval: config?.["gadget-approval"],
        subagents: config?.subagents,
        globalSubagents,
      };
      return executeAgent(prompt, mergedOptions, env);
    }, env),
  );
}
