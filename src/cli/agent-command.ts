import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { type Command, InvalidArgumentError } from "commander";
import { AgentBuilder } from "../agent/builder.js";
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
      // Display question on first prompt only
      const questionLine = question.trim() ? `\n${question.trim()}` : "";
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

/**
 * Formats a gadget execution result for stderr output with colors.
 *
 * @param result - Gadget execution result with timing and output info
 * @returns Formatted summary string with ANSI colors
 */
function formatGadgetSummary(result: {
  gadgetName: string;
  executionTimeMs: number;
  error?: string;
  result?: string;
  breaksLoop?: boolean;
}): string {
  const gadgetLabel = chalk.magenta.bold(result.gadgetName);
  const timeLabel = chalk.dim(`${Math.round(result.executionTimeMs)}ms`);

  if (result.error) {
    return `${chalk.red("✗")} ${gadgetLabel} ${chalk.red("error:")} ${result.error} ${timeLabel}`;
  }

  if (result.breaksLoop) {
    return `${chalk.yellow("⏹")} ${gadgetLabel} ${chalk.yellow("finished:")} ${result.result} ${timeLabel}`;
  }

  // For TellUser, show full text without truncation since it's meant for user messages
  // For other gadgets, truncate long results for cleaner output
  const maxLen = 80;
  const shouldTruncate = result.gadgetName !== "TellUser";
  const resultText = result.result
    ? shouldTruncate && result.result.length > maxLen
      ? `${result.result.slice(0, maxLen)}...`
      : result.result
    : "";

  return `${chalk.green("✓")} ${gadgetLabel} ${chalk.dim("→")} ${resultText} ${timeLabel}`;
}

/**
 * Handles the agent command execution.
 * Runs the full agent loop with gadgets and streams output.
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

  const registry = new GadgetRegistry();

  // Register built-in gadgets by default (AskUser, TellUser)
  // --no-builtins sets options.builtins to false
  if (options.builtins !== false) {
    for (const gadget of builtinGadgets) {
      registry.registerByClass(gadget);
    }
  }

  // Load and register user-provided gadgets (can override built-ins)
  const gadgetSpecifiers = options.gadget ?? [];
  if (gadgetSpecifiers.length > 0) {
    const gadgets = await loadGadgets(gadgetSpecifiers, process.cwd());
    for (const gadget of gadgets) {
      registry.registerByClass(gadget);
    }
  }

  const printer = new StreamPrinter(env.stdout);
  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
  const progress = new StreamProgress(env.stderr, stderrTTY, client.modelRegistry);

  let finishReason: string | null | undefined;
  let usage: TokenUsage | undefined;
  let iterations = 0;

  // Estimate tokens from all messages
  const estimateMessagesTokens = (messages: Array<{ role: string; content: string }>) => {
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    return Math.round(totalChars / FALLBACK_CHARS_PER_TOKEN);
  };

  const builder = new AgentBuilder(client)
    .withModel(options.model)
    .withLogger(env.createLogger("llmist:cli:agent"))
    .withHooks({
      observers: {
        onLLMCallStart: async (context) => {
          // Start new call in streaming mode with model and estimated tokens from full messages
          const estimate = estimateMessagesTokens(context.options.messages);
          progress.startCall(context.options.model, estimate);
        },
        onStreamChunk: async (context) => {
          // Update output token estimate from accumulated text
          progress.update(context.accumulatedText.length);
          // Capture actual tokens when available from stream
          if (context.usage) {
            if (context.usage.inputTokens) {
              progress.setInputTokens(context.usage.inputTokens, false);
            }
            if (context.usage.outputTokens) {
              progress.setOutputTokens(context.usage.outputTokens, false);
            }
          }
        },
        onLLMCallComplete: async (context) => {
          finishReason = context.finishReason;
          usage = context.usage;
          iterations = Math.max(iterations, context.iteration + 1);
          // End call and switch to cumulative mode
          progress.endCall(context.usage);
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

  // Note: parameterFormat is not directly supported in AgentBuilder
  // This might need to be added to AgentBuilder API if needed

  const agent = builder.ask(prompt);

  for await (const event of agent.run()) {
    if (event.type === "text") {
      progress.pause(); // Must pause to avoid stderr/stdout interleaving
      printer.write(event.content);
    } else if (event.type === "gadget_result") {
      progress.pause(); // Clear progress before gadget output
      // Only show gadget summaries if stderr is a TTY (not redirected)
      if (stderrTTY) {
        env.stderr.write(`${formatGadgetSummary(event.result)}\n`);
      }
      // Note: progress.start() is called by onLLMCallStart hook
    }
    // Note: human_input_required event is not emitted - handled by callback in createHumanInputHandler
  }

  progress.complete();
  printer.ensureNewline();

  // Only show summary if stderr is a TTY (not redirected)
  if (stderrTTY) {
    const summary = renderSummary({
      finishReason,
      usage,
      iterations,
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
    .action((prompt, options) =>
      executeAction(() => handleAgentCommand(prompt, options as AgentCommandOptions, env), env),
    );
}
