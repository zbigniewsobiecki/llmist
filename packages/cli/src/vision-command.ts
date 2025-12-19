/**
 * Vision command for image analysis.
 *
 * Provides a dedicated CLI for one-shot image analysis using vision-capable models.
 *
 * @example
 * ```bash
 * llmist vision photo.jpg -p "Describe this image"
 * llmist vision screenshot.png --model gpt-4o -p "Extract all text from this image"
 * ```
 */

import type { Command } from "commander";
import { resolveModel } from "llmist";
import { COMMANDS, OPTION_DESCRIPTIONS, OPTION_FLAGS, SUMMARY_PREFIX } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { readFileBuffer } from "./file-utils.js";
import { createNumericParser, executeAction } from "./utils.js";

/**
 * Options for the vision command.
 */
export interface VisionCommandOptions {
  /** Model to use for vision analysis */
  model: string;
  /** Analysis prompt */
  prompt?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Suppress progress output */
  quiet?: boolean;
}

/**
 * Execute vision analysis on an image.
 *
 * @param imagePath - Path to the image file
 * @param options - Vision command options
 * @param env - CLI environment
 */
export async function executeVision(
  imagePath: string,
  options: VisionCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const client = env.createClient();
  const model = resolveModel(options.model);

  // Read image file
  const imageBuffer = await readFileBuffer(imagePath);

  // Default prompt for vision analysis
  const prompt = options.prompt ?? "Describe this image in detail.";

  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;

  if (!options.quiet && stderrTTY) {
    env.stderr.write(`${SUMMARY_PREFIX} Analyzing image with ${model}...\n`);
  }

  // Use vision namespace for one-shot analysis
  const result = await client.vision.analyze({
    model,
    image: imageBuffer,
    prompt,
    maxTokens: options.maxTokens,
  });

  // Output result
  env.stdout.write(result);
  env.stdout.write("\n");
}

/**
 * Register the vision command with the CLI program.
 *
 * @param program - Commander program instance
 * @param env - CLI environment
 */
export function registerVisionCommand(program: Command, env: CLIEnvironment): void {
  program
    .command(COMMANDS.vision ?? "vision")
    .description("Analyze an image using vision-capable models")
    .argument("<image>", "Path to image file to analyze")
    .option(
      OPTION_FLAGS.model,
      OPTION_DESCRIPTIONS.model,
      "gpt-4o", // Default to a vision-capable model
    )
    .option("-p, --prompt <prompt>", "Analysis prompt describing what to extract or describe")
    .option(
      OPTION_FLAGS.maxTokens,
      OPTION_DESCRIPTIONS.maxTokens,
      createNumericParser({ label: "Max tokens", integer: true, min: 1 }),
    )
    .option(OPTION_FLAGS.quiet, OPTION_DESCRIPTIONS.quiet)
    .action((imagePath: string, options: VisionCommandOptions) =>
      executeAction(() => executeVision(imagePath, options, env), env),
    );
}
