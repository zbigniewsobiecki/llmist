import type { Command } from "commander";

import { LLMMessageBuilder } from "../core/messages.js";
import type { TokenUsage } from "../core/options.js";
import { FALLBACK_CHARS_PER_TOKEN } from "../providers/constants.js";
import { COMMANDS, DEFAULT_MODEL, OPTION_DESCRIPTIONS, OPTION_FLAGS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import {
  createNumericParser,
  executeAction,
  renderSummary,
  resolvePrompt,
  StreamPrinter,
  StreamProgress,
} from "./utils.js";

/**
 * Configuration options for the complete command.
 */
interface CompleteCommandOptions {
  model: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Handles the complete command execution.
 * Streams a single LLM response without agent loop or gadgets.
 *
 * @param promptArg - User prompt from command line argument (optional if using stdin)
 * @param options - Complete command options (model, system prompt, temperature, etc.)
 * @param env - CLI environment for I/O operations
 */
async function handleCompleteCommand(
  promptArg: string | undefined,
  options: CompleteCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const prompt = await resolvePrompt(promptArg, env);
  const client = env.createClient();

  const builder = new LLMMessageBuilder();
  if (options.system) {
    builder.addSystem(options.system);
  }
  builder.addUser(prompt);

  const stream = client.stream({
    model: options.model,
    messages: builder.build(),
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });

  const printer = new StreamPrinter(env.stdout);
  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
  const progress = new StreamProgress(env.stderr, stderrTTY, client.modelRegistry);

  // Start call with model and estimate based on prompt length
  const estimatedInputTokens = Math.round(prompt.length / FALLBACK_CHARS_PER_TOKEN);
  progress.startCall(options.model, estimatedInputTokens);

  let finishReason: string | null | undefined;
  let usage: TokenUsage | undefined;
  let totalChars = 0;

  for await (const chunk of stream) {
    // Capture actual usage from stream
    if (chunk.usage) {
      usage = chunk.usage;
      if (chunk.usage.inputTokens) {
        progress.setInputTokens(chunk.usage.inputTokens, false);
      }
      if (chunk.usage.outputTokens) {
        progress.setOutputTokens(chunk.usage.outputTokens, false);
      }
    }
    if (chunk.text) {
      progress.pause(); // Must pause to avoid stderr/stdout interleaving
      totalChars += chunk.text.length;
      progress.update(totalChars); // Update token estimate from chars
      printer.write(chunk.text);
    }
    if (chunk.finishReason !== undefined) {
      finishReason = chunk.finishReason;
    }
  }

  progress.complete();
  printer.ensureNewline();

  const summary = renderSummary({ finishReason, usage });
  if (summary) {
    env.stderr.write(`${summary}\n`);
  }
}

/**
 * Registers the complete command with the CLI program.
 * Configures options for model, system prompt, temperature, and max tokens.
 *
 * @param program - Commander program to register the command with
 * @param env - CLI environment for dependencies and I/O
 */
export function registerCompleteCommand(program: Command, env: CLIEnvironment): void {
  program
    .command(COMMANDS.complete)
    .description("Stream a single completion from a specified model.")
    .argument("[prompt]", "Prompt to send to the LLM. If omitted, stdin is used when available.")
    .option(OPTION_FLAGS.model, OPTION_DESCRIPTIONS.model, DEFAULT_MODEL)
    .option(OPTION_FLAGS.systemPrompt, OPTION_DESCRIPTIONS.systemPrompt)
    .option(
      OPTION_FLAGS.temperature,
      OPTION_DESCRIPTIONS.temperature,
      createNumericParser({ label: "Temperature", min: 0, max: 2 }),
    )
    .option(
      OPTION_FLAGS.maxTokens,
      OPTION_DESCRIPTIONS.maxTokens,
      createNumericParser({ label: "Max tokens", integer: true, min: 1 }),
    )
    .action((prompt, options) =>
      executeAction(
        () => handleCompleteCommand(prompt, options as CompleteCommandOptions, env),
        env,
      ),
    );
}
