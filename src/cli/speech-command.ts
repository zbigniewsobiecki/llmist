import { writeFileSync } from "node:fs";
import type { Command } from "commander";

import type { SpeechConfig } from "./config.js";
import { COMMANDS, OPTION_DESCRIPTIONS, OPTION_FLAGS, SUMMARY_PREFIX } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { formatCost } from "./ui/formatters.js";
import { executeAction, resolvePrompt } from "./utils.js";

/**
 * Default speech generation model.
 */
const DEFAULT_SPEECH_MODEL = "tts-1";

/**
 * Default voice for speech generation.
 */
const DEFAULT_VOICE = "nova";

/**
 * Options for the speech command.
 */
export interface SpeechCommandOptions {
  model: string;
  voice?: string;
  format?: string;
  speed?: string;
  output?: string;
  quiet?: boolean;
}

/**
 * Executes the speech command.
 * Generates speech audio from text using the specified model and voice.
 *
 * @param textArg - Text from command line argument (optional if using stdin)
 * @param options - Speech command options
 * @param env - CLI environment for I/O operations
 */
export async function executeSpeech(
  textArg: string | undefined,
  options: SpeechCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const text = await resolvePrompt(textArg, env);
  const client = env.createClient();

  const model = options.model;
  const voice = options.voice ?? DEFAULT_VOICE;
  const speed = options.speed ? Number.parseFloat(options.speed) : undefined;

  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;

  if (!options.quiet && stderrTTY) {
    env.stderr.write(`${SUMMARY_PREFIX} Generating speech with ${model} (voice: ${voice})...\n`);
  }

  const result = await client.speech.generate({
    model,
    input: text,
    voice,
    responseFormat: options.format as "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm" | undefined,
    speed,
  });

  // Get the audio data as a Buffer
  const audioBuffer = Buffer.from(result.audio);

  // Handle output
  if (options.output) {
    // Save to file
    writeFileSync(options.output, audioBuffer);
    if (!options.quiet) {
      env.stderr.write(`${SUMMARY_PREFIX} Audio saved to ${options.output}\n`);
    }
  } else {
    // Output raw audio to stdout (for piping)
    env.stdout.write(audioBuffer);
  }

  // Show summary
  if (!options.quiet && stderrTTY) {
    const parts = [
      `${result.usage.characterCount} characters`,
      `format: ${result.format}`,
    ];
    if (result.cost !== undefined) {
      parts.push(`cost: ${formatCost(result.cost)}`);
    }
    env.stderr.write(`${SUMMARY_PREFIX} ${parts.join(" | ")}\n`);
  }
}

/**
 * Registers the speech command with the CLI program.
 *
 * @param program - Commander program to register the command with
 * @param env - CLI environment for dependencies and I/O
 * @param config - Optional configuration defaults from config file
 */
export function registerSpeechCommand(
  program: Command,
  env: CLIEnvironment,
  config?: SpeechConfig,
): void {
  program
    .command(COMMANDS.speech)
    .description("Generate speech audio from text.")
    .argument("[text]", "Text to convert to speech. If omitted, stdin is used when available.")
    .option(
      OPTION_FLAGS.model,
      OPTION_DESCRIPTIONS.model,
      config?.model ?? DEFAULT_SPEECH_MODEL,
    )
    .option(OPTION_FLAGS.voice, OPTION_DESCRIPTIONS.voice, config?.voice ?? DEFAULT_VOICE)
    .option(OPTION_FLAGS.speechFormat, OPTION_DESCRIPTIONS.speechFormat, config?.format)
    .option(OPTION_FLAGS.speechSpeed, OPTION_DESCRIPTIONS.speechSpeed, config?.speed?.toString())
    .option(OPTION_FLAGS.speechOutput, OPTION_DESCRIPTIONS.speechOutput, config?.output)
    .option(OPTION_FLAGS.quiet, OPTION_DESCRIPTIONS.quiet, config?.quiet ?? false)
    .action((text, options) =>
      executeAction(() => executeSpeech(text, options as SpeechCommandOptions, env), env),
    );
}
