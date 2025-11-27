import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { type Command, InvalidArgumentError } from "commander";
import { AgentBuilder } from "../agent/builder.js";
import type { LLMMessage } from "../core/messages.js";
import type { TokenUsage } from "../core/options.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { FALLBACK_CHARS_PER_TOKEN } from "../providers/constants.js";
import { builtinGadgets } from "./builtin-gadgets.js";
import {
  COMMANDS,
  DEFAULT_MODEL,
  DEFAULT_PARAMETER_FORMAT,
  OPTION_DESCRIPTIONS,
  OPTION_FLAGS,
} from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { loadGadgets } from "./gadgets.js";
import {
  createNumericParser,
  executeAction,
  isInteractive,
  renderSummary,
  resolvePrompt,
  StreamPrinter,
  StreamProgress,
} from "./utils.js";
import { formatGadgetSummary, renderMarkdown, renderOverallSummary } from "./ui/formatters.js";

/**
 * Configuration options for the agent command.
 */
interface AgentCommandOptions {
  model: string;
  system?: string;
  temperature?: number;
  maxIterations?: number;
  gadget?: string[];
  parameterFormat: ParameterFormat;
  builtins: boolean; // --no-builtins sets this to false
  builtinInteraction: boolean; // --no-builtin-interaction sets this to false
}

const PARAMETER_FORMAT_VALUES: ParameterFormat[] = ["json", "yaml", "auto"];

/**
 * Parses and validates the parameter format option value.
 *
 * @param value - User-provided parameter format string
 * @returns Validated parameter format
 * @throws InvalidArgumentError if format is not one of: json, yaml, auto
 */
function parseParameterFormat(value: string): ParameterFormat {
  const normalized = value.toLowerCase() as ParameterFormat;
  if (!PARAMETER_FORMAT_VALUES.includes(normalized)) {
    throw new InvalidArgumentError("Parameter format must be one of 'json', 'yaml', or 'auto'.");
  }
  return normalized;
}

/**
 * Prompts the user for a simple yes/no approval.
 * Used by the gating controller to approve dangerous gadget executions.
 *
 * SHOWCASE: This demonstrates how to build approval workflows using llmist's
 * controller hooks. The CLI gates RunCommand executions, but the pattern
 * can be applied to any gadget that needs user approval.
 *
 * @param env - CLI environment for I/O operations
 * @param prompt - The prompt to display to the user
 * @returns true if user approved (answered y/yes), false otherwise
 */
async function promptApproval(env: CLIEnvironment, prompt: string): Promise<boolean> {
  const rl = createInterface({ input: env.stdin, output: env.stderr });
  try {
    const answer = await rl.question(prompt);
    return answer.toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

/**
 * Creates a human input handler for interactive mode.
 * Only returns a handler if stdin is a TTY (terminal), not a pipe.
 *
 * @param env - CLI environment
 * @param progress - Progress indicator to pause during input
 * @returns Human input handler function or undefined if not interactive
 */
function createHumanInputHandler(
  env: CLIEnvironment,
  progress: StreamProgress,
): ((question: string) => Promise<string>) | undefined {
  const stdout = env.stdout as NodeJS.WriteStream;
  if (!isInteractive(env.stdin) || typeof stdout.isTTY !== "boolean" || !stdout.isTTY) {
    return undefined;
  }

  return async (question: string): Promise<string> => {
    progress.pause(); // Pause progress indicator during human input
    const rl = createInterface({ input: env.stdin, output: env.stdout });
    try {
      // Display question on first prompt only (with markdown rendering)
      const questionLine = question.trim() ? `\n${renderMarkdown(question.trim())}` : "";
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
    }
  };
}

// formatGadgetSummary is now imported from ./ui/formatters.js
// This demonstrates clean code organization and reusability

/**
 * Handles the agent command execution.
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
async function handleAgentCommand(
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
  if (options.builtins !== false) {
    for (const gadget of builtinGadgets) {
      // Skip AskUser if --no-builtin-interaction is set
      // Useful for non-interactive environments (CI, pipes, etc.)
      if (options.builtinInteraction === false && gadget.name === "AskUser") {
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

  let usage: TokenUsage | undefined;
  let iterations = 0;

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

          // Calculate per-call cost for the summary
          let callCost: number | undefined;
          if (context.usage && client.modelRegistry) {
            try {
              const modelName = options.model.includes(":")
                ? options.model.split(":")[1]
                : options.model;
              const costResult = client.modelRegistry.estimateCost(
                modelName,
                context.usage.inputTokens,
                context.usage.outputTokens,
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
          if (stderrTTY) {
            const summary = renderSummary({
              iterations: context.iteration + 1,
              usage: context.usage,
              elapsedSeconds: callElapsed,
              cost: callCost,
              finishReason: context.finishReason,
            });
            if (summary) {
              env.stderr.write(`${summary}\n`);
            }
          }
        },
      },

      // SHOWCASE: Controller-based approval gating for dangerous gadgets
      //
      // This demonstrates how to add safety layers WITHOUT modifying gadgets.
      // The RunCommand gadget is simple - it just executes commands. The CLI
      // adds the approval flow externally via beforeGadgetExecution controller.
      //
      // This pattern is composable: you can apply the same gating logic to
      // any gadget (DeleteFile, SendEmail, etc.) without changing the gadgets.
      controllers: {
        beforeGadgetExecution: async (ctx) => {
          // Only gate RunCommand - let other gadgets through
          if (ctx.gadgetName !== "RunCommand") {
            return { action: "proceed" };
          }

          // Only prompt for approval in interactive mode
          const stdinTTY = isInteractive(env.stdin);
          const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
          if (!stdinTTY || !stderrTTY) {
            // Non-interactive mode: deny by default for safety
            return {
              action: "skip",
              syntheticResult:
                "status=denied\n\nRunCommand requires interactive approval. Run in a terminal to approve commands.",
            };
          }

          const command = ctx.parameters.command as string;

          // Pause progress indicator and prompt for approval
          progress.pause();
          env.stderr.write(`\n${chalk.yellow("🔒 Execute:")} ${command}\n`);

          const approved = await promptApproval(env, "   Approve? [y/n] ");

          if (!approved) {
            env.stderr.write(`   ${chalk.red("✗ Denied")}\n\n`);
            return {
              action: "skip",
              syntheticResult:
                "status=denied\n\nCommand denied by user. Ask what they'd like to do instead.",
            };
          }

          env.stderr.write(`   ${chalk.green("✓ Approved")}\n`);
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

  const humanInputHandler = createHumanInputHandler(env, progress);
  if (humanInputHandler) {
    builder.onHumanInput(humanInputHandler);
  }

  // Add gadgets from the registry
  const gadgets = registry.getAll();
  if (gadgets.length > 0) {
    builder.withGadgets(...gadgets);
  }

  // Set the parameter format for gadget invocations
  builder.withParameterFormat(options.parameterFormat);

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
  for await (const event of agent.run()) {
    if (event.type === "text") {
      // Stream LLM output to stdout
      // Pause progress indicator to avoid stderr/stdout interleaving
      progress.pause();
      printer.write(event.content);
    } else if (event.type === "gadget_result") {
      // Show gadget execution feedback on stderr
      // Only displayed in TTY mode (hidden when piped)
      progress.pause();
      if (stderrTTY) {
        // Count tokens for output using provider-specific API
        const tokenCount = await countGadgetOutputTokens(event.result.result);
        env.stderr.write(`${formatGadgetSummary({ ...event.result, tokenCount })}\n`);
      }
      // Progress automatically resumes on next LLM call (via onLLMCallStart hook)
    }
    // Note: human_input_required handled by callback (see createHumanInputHandler)
  }

  progress.complete();
  printer.ensureNewline();

  // SHOWCASE: Show overall summary only if there were multiple iterations
  // Single-iteration runs already showed per-call summary, no need to repeat
  if (stderrTTY && iterations > 1) {
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
 */
export function registerAgentCommand(program: Command, env: CLIEnvironment): void {
  program
    .command(COMMANDS.agent)
    .description("Run the llmist agent loop with optional gadgets.")
    .argument("[prompt]", "Prompt for the agent loop. Falls back to stdin when available.")
    .option(OPTION_FLAGS.model, OPTION_DESCRIPTIONS.model, DEFAULT_MODEL)
    .option(OPTION_FLAGS.systemPrompt, OPTION_DESCRIPTIONS.systemPrompt)
    .option(
      OPTION_FLAGS.temperature,
      OPTION_DESCRIPTIONS.temperature,
      createNumericParser({ label: "Temperature", min: 0, max: 2 }),
    )
    .option(
      OPTION_FLAGS.maxIterations,
      OPTION_DESCRIPTIONS.maxIterations,
      createNumericParser({ label: "Max iterations", integer: true, min: 1 }),
    )
    .option(
      OPTION_FLAGS.gadgetModule,
      OPTION_DESCRIPTIONS.gadgetModule,
      (value: string, previous: string[] = []) => [...previous, value],
      [] as string[],
    )
    .option(
      OPTION_FLAGS.parameterFormat,
      OPTION_DESCRIPTIONS.parameterFormat,
      parseParameterFormat,
      DEFAULT_PARAMETER_FORMAT,
    )
    .option(OPTION_FLAGS.noBuiltins, OPTION_DESCRIPTIONS.noBuiltins)
    .option(OPTION_FLAGS.noBuiltinInteraction, OPTION_DESCRIPTIONS.noBuiltinInteraction)
    .action((prompt, options) =>
      executeAction(() => handleAgentCommand(prompt, options as AgentCommandOptions, env), env),
    );
}
