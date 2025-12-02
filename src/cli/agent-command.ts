import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { Command } from "commander";
import { AgentBuilder } from "../agent/builder.js";
import { isAbortError } from "../core/errors.js";
import type { LLMMessage } from "../core/messages.js";
import type { TokenUsage } from "../core/options.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { FALLBACK_CHARS_PER_TOKEN } from "../providers/constants.js";
import { ApprovalManager, type ApprovalConfig } from "./approval/index.js";
import { builtinGadgets } from "./builtin-gadgets.js";
import type { AgentConfig } from "./config.js";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { loadGadgets } from "./gadgets.js";
import { formatLlmRequest, resolveLogDir, writeLogFile } from "./llm-logging.js";
import { addAgentOptions, type AgentCommandOptions } from "./option-helpers.js";
import {
  createEscKeyListener,
  executeAction,
  isInteractive,
  renderSummary,
  resolvePrompt,
  StreamPrinter,
  StreamProgress,
} from "./utils.js";
import {
  formatGadgetSummary,
  renderMarkdownWithSeparators,
  renderOverallSummary,
} from "./ui/formatters.js";

/**
 * Keyboard listener management for ESC key handling.
 * Allows pausing and restoring the listener during readline operations.
 */
interface KeyboardManager {
  cleanup: (() => void) | null;
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
    if (keyboard.cleanup) {
      keyboard.cleanup();
      keyboard.cleanup = null;
    }

    const rl = createInterface({ input: env.stdin, output: env.stdout });
    try {
      // Display question on first prompt only (with markdown rendering and separators)
      const questionLine = question.trim() ? `\n${renderMarkdownWithSeparators(question.trim())}` : "";
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
  options: AgentCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
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
      if (gadget.name === "AskUser" && (options.builtinInteraction === false || !stdinIsInteractive)) {
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

  const printer = new StreamPrinter(env.stdout);
  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
  const progress = new StreamProgress(env.stderr, stderrTTY, client.modelRegistry);

  // Set up cancellation support for ESC key handling
  const abortController = new AbortController();
  let wasCancelled = false;
  const stdinStream = env.stdin as NodeJS.ReadStream;

  // Create keyboard manager for ESC listener coordination with readline
  const keyboard: KeyboardManager = {
    cleanup: null,
    restore: () => {
      // Restore ESC listener if it was previously active
      if (stdinIsInteractive && stdinStream.isTTY && !wasCancelled) {
        keyboard.cleanup = createEscKeyListener(stdinStream, () => {
          if (!abortController.signal.aborted) {
            wasCancelled = true;
            abortController.abort();
            progress.pause();
            env.stderr.write(chalk.yellow(`\n[Cancelled] ${progress.formatStats()}\n`));
          }
        });
      }
    },
  };

  // Set up ESC key listener if in interactive TTY mode
  if (stdinIsInteractive && stdinStream.isTTY) {
    keyboard.cleanup = createEscKeyListener(stdinStream, () => {
      if (!abortController.signal.aborted) {
        wasCancelled = true;
        abortController.abort();
        progress.pause();
        env.stderr.write(chalk.yellow(`\n[Cancelled] ${progress.formatStats()}\n`));
      }
    });
  }

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
  const approvalManager = new ApprovalManager(approvalConfig, env, progress);

  let usage: TokenUsage | undefined;
  let iterations = 0;

  // Resolve LLM debug log directories (if enabled)
  const llmRequestsDir = resolveLogDir(options.logLlmRequests, "requests");
  const llmResponsesDir = resolveLogDir(options.logLlmResponses, "responses");
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
  const countGadgetOutputTokens = async (output: string | undefined): Promise<number | undefined> => {
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
  const builder = new AgentBuilder(client)
    .withModel(options.model)
    .withLogger(env.createLogger("llmist:cli:agent"))
    .withHooks({
      observers: {
        // onLLMCallStart: Start progress indicator for each LLM call
        // This showcases how to react to agent lifecycle events
        onLLMCallStart: async (context) => {
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

          // Write LLM request to debug log if enabled
          if (llmRequestsDir) {
            const filename = `${Date.now()}_call_${llmCallCounter}.request.txt`;
            const content = formatLlmRequest(context.options.messages);
            await writeLogFile(llmRequestsDir, filename, content);
          }
        },
        // onStreamChunk: Real-time updates as LLM generates tokens
        // This enables responsive UIs that show progress during generation
        onStreamChunk: async (context) => {
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
        onLLMCallComplete: async (context) => {
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
          // Skip summaries in quiet mode
          if (!options.quiet) {
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
          if (llmResponsesDir) {
            const filename = `${Date.now()}_call_${llmCallCounter}.response.txt`;
            await writeLogFile(llmResponsesDir, filename, context.rawResponse);
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

  // Build and start the agent
  const agent = builder.ask(prompt);

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
        progress.pause();
        textBuffer += event.content;
      } else if (event.type === "gadget_result") {
        // Flush any accumulated text before showing gadget result
        flushTextBuffer();
        // Show gadget execution feedback on stderr
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
          env.stderr.write(`${formatGadgetSummary({ ...event.result, tokenCount })}\n`);
        }
        // Progress automatically resumes on next LLM call (via onLLMCallStart hook)
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
    // Always cleanup keyboard listener
    if (keyboard.cleanup) {
      keyboard.cleanup();
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
): void {
  const cmd = program
    .command(COMMANDS.agent)
    .description("Run the llmist agent loop with optional gadgets.")
    .argument("[prompt]", "Prompt for the agent loop. Falls back to stdin when available.");

  addAgentOptions(cmd, config);

  cmd.action((prompt, options) =>
    executeAction(() => {
      // Merge config-only options (no CLI flags) into command options
      const mergedOptions: AgentCommandOptions = {
        ...(options as AgentCommandOptions),
        gadgetApproval: config?.["gadget-approval"],
      };
      return executeAgent(prompt, mergedOptions, env);
    }, env),
  );
}
