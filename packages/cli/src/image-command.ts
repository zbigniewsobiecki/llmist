import { writeFileSync } from "node:fs";
import type { Command } from "commander";

import type { ImageConfig } from "./config.js";
import { COMMANDS, OPTION_DESCRIPTIONS, OPTION_FLAGS, SUMMARY_PREFIX } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { formatCost } from "./ui/formatters.js";
import { executeAction, resolvePrompt } from "./utils.js";

/**
 * Default image generation model.
 */
const DEFAULT_IMAGE_MODEL = "dall-e-3";

/**
 * Options for the image command.
 */
export interface ImageCommandOptions {
  model: string;
  size?: string;
  quality?: string;
  count?: string;
  output?: string;
  quiet?: boolean;
}

/**
 * Executes the image command.
 * Generates images from a text prompt using the specified model.
 *
 * @param promptArg - Prompt from command line argument (optional if using stdin)
 * @param options - Image command options
 * @param env - CLI environment for I/O operations
 */
export async function executeImage(
  promptArg: string | undefined,
  options: ImageCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const prompt = await resolvePrompt(promptArg, env);
  const client = env.createClient();

  const model = options.model;
  const n = options.count ? Number.parseInt(options.count, 10) : 1;

  const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;

  if (!options.quiet && stderrTTY) {
    env.stderr.write(`${SUMMARY_PREFIX} Generating image with ${model}...\n`);
  }

  const result = await client.image.generate({
    model,
    prompt,
    size: options.size,
    quality: options.quality,
    n,
    responseFormat: options.output ? "b64_json" : "url",
  });

  // Handle output
  if (options.output) {
    // Save to file
    const imageData = result.images[0];
    if (imageData.b64Json) {
      const buffer = Buffer.from(imageData.b64Json, "base64");
      writeFileSync(options.output, buffer);
      if (!options.quiet) {
        env.stderr.write(`${SUMMARY_PREFIX} Image saved to ${options.output}\n`);
      }
    } else if (imageData.url) {
      // If we got URL but requested file, write the URL
      env.stdout.write(`${imageData.url}\n`);
    }
  } else {
    // Output URLs to stdout
    for (const image of result.images) {
      if (image.url) {
        env.stdout.write(`${image.url}\n`);
      } else if (image.b64Json) {
        // For base64, output the raw data (can be piped to file)
        env.stdout.write(image.b64Json);
      }
    }
  }

  // Show summary
  if (!options.quiet && stderrTTY) {
    const parts = [
      `${result.images.length} image(s)`,
      `size: ${result.usage.size}`,
      `quality: ${result.usage.quality}`,
    ];
    if (result.cost !== undefined) {
      parts.push(`cost: ${formatCost(result.cost)}`);
    }
    env.stderr.write(`${SUMMARY_PREFIX} ${parts.join(" | ")}\n`);
  }
}

/**
 * Registers the image command with the CLI program.
 *
 * @param program - Commander program to register the command with
 * @param env - CLI environment for dependencies and I/O
 * @param config - Optional configuration defaults from config file
 */
export function registerImageCommand(
  program: Command,
  env: CLIEnvironment,
  config?: ImageConfig,
): void {
  program
    .command(COMMANDS.image)
    .description("Generate images from a text prompt.")
    .argument("[prompt]", "Image generation prompt. If omitted, stdin is used when available.")
    .option(OPTION_FLAGS.model, OPTION_DESCRIPTIONS.model, config?.model ?? DEFAULT_IMAGE_MODEL)
    .option(OPTION_FLAGS.imageSize, OPTION_DESCRIPTIONS.imageSize, config?.size)
    .option(OPTION_FLAGS.imageQuality, OPTION_DESCRIPTIONS.imageQuality, config?.quality)
    .option(OPTION_FLAGS.imageCount, OPTION_DESCRIPTIONS.imageCount, config?.count?.toString())
    .option(OPTION_FLAGS.imageOutput, OPTION_DESCRIPTIONS.imageOutput, config?.output)
    .option(OPTION_FLAGS.quiet, OPTION_DESCRIPTIONS.quiet, config?.quiet ?? false)
    .action((prompt, options) =>
      executeAction(() => executeImage(prompt, options as ImageCommandOptions, env), env),
    );
}
