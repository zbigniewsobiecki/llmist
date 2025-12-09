import { type Command } from "commander";
import chalk from "chalk";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { executeAction } from "./utils.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { ImageModelSpec, SpeechModelSpec } from "../core/media-types.js";
import { MODEL_ALIASES } from "../core/model-shortcuts.js";

interface ModelsCommandOptions {
  provider?: string;
  format?: "table" | "json";
  verbose?: boolean;
  text?: boolean;
  image?: boolean;
  speech?: boolean;
  all?: boolean;
}

async function handleModelsCommand(
  options: ModelsCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const client = env.createClient();

  // Determine which model types to show
  // Default: text models if no specific flag is set
  const showText = options.all || options.text || (!options.image && !options.speech);
  const showImage = options.all || options.image;
  const showSpeech = options.all || options.speech;

  // Collect models
  const textModels = showText ? client.modelRegistry.listModels(options.provider) : [];
  const imageModels = showImage
    ? client.image.listModels().filter((m) => !options.provider || m.provider === options.provider)
    : [];
  const speechModels = showSpeech
    ? client.speech.listModels().filter((m) => !options.provider || m.provider === options.provider)
    : [];

  if (options.format === "json") {
    renderJSON(textModels, imageModels, speechModels, env.stdout);
  } else {
    renderAllTables(textModels, imageModels, speechModels, options.verbose || false, env.stdout);
  }
}

/**
 * Main rendering orchestrator for all model types.
 */
function renderAllTables(
  textModels: ModelSpec[],
  imageModels: ImageModelSpec[],
  speechModels: SpeechModelSpec[],
  verbose: boolean,
  stream: NodeJS.WritableStream,
): void {
  const hasAnyModels = textModels.length > 0 || imageModels.length > 0 || speechModels.length > 0;

  if (!hasAnyModels) {
    stream.write(chalk.yellow("\nNo models found matching the specified criteria.\n\n"));
    return;
  }

  stream.write(chalk.bold.cyan("\nAvailable Models\n"));
  stream.write(chalk.cyan("=".repeat(80)) + "\n\n");

  // Text models
  if (textModels.length > 0) {
    renderTextTable(textModels, verbose, stream);
  }

  // Image models
  if (imageModels.length > 0) {
    renderImageTable(imageModels, verbose, stream);
  }

  // Speech models
  if (speechModels.length > 0) {
    renderSpeechTable(speechModels, verbose, stream);
  }

  // Display shortcuts (only if showing text models)
  if (textModels.length > 0) {
    stream.write(chalk.bold.magenta("Model Shortcuts\n"));
    stream.write(chalk.dim("─".repeat(80)) + "\n");

    const shortcuts = Object.entries(MODEL_ALIASES).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [shortcut, fullName] of shortcuts) {
      stream.write(chalk.cyan(`  ${shortcut.padEnd(15)}`) + chalk.dim(" → ") + chalk.white(fullName) + "\n");
    }
    stream.write("\n");
  }
}

/**
 * Render text/LLM models grouped by provider.
 */
function renderTextTable(models: ModelSpec[], verbose: boolean, stream: NodeJS.WritableStream): void {
  // Group models by provider
  const grouped = new Map<string, ModelSpec[]>();
  for (const model of models) {
    const provider = model.provider;
    if (!grouped.has(provider)) {
      grouped.set(provider, []);
    }
    grouped.get(provider)!.push(model);
  }

  stream.write(chalk.bold.blue("📝 Text/LLM Models\n"));
  stream.write(chalk.dim("─".repeat(80)) + "\n\n");

  // Display each provider's models
  const providers = Array.from(grouped.keys()).sort();
  for (const provider of providers) {
    const providerModels = grouped.get(provider)!;
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

    stream.write(chalk.bold.yellow(`${providerName}\n`));

    if (verbose) {
      renderVerboseTable(providerModels, stream);
    } else {
      renderCompactTable(providerModels, stream);
    }

    stream.write("\n");
  }
}

function renderCompactTable(models: ModelSpec[], stream: NodeJS.WritableStream): void {
  // Column widths
  const idWidth = 25;
  const nameWidth = 22;
  const contextWidth = 13;
  const inputWidth = 10;
  const outputWidth = 10;

  // Header
  stream.write(chalk.dim("─".repeat(idWidth + nameWidth + contextWidth + inputWidth + outputWidth + 8)) + "\n");
  stream.write(
    chalk.bold(
      "Model ID".padEnd(idWidth) +
      "  " + "Display Name".padEnd(nameWidth) +
      "  " + "Context".padEnd(contextWidth) +
      "  " + "Input".padEnd(inputWidth) +
      "  " + "Output".padEnd(outputWidth)
    ) + "\n"
  );
  stream.write(chalk.dim("─".repeat(idWidth + nameWidth + contextWidth + inputWidth + outputWidth + 8)) + "\n");

  // Rows
  for (const model of models) {
    const contextFormatted = formatTokens(model.contextWindow);
    const inputPrice = `$${model.pricing.input.toFixed(2)}`;
    const outputPrice = `$${model.pricing.output.toFixed(2)}`;

    stream.write(
      chalk.green(model.modelId.padEnd(idWidth)) +
      "  " + chalk.white(model.displayName.padEnd(nameWidth)) +
      "  " + chalk.yellow(contextFormatted.padEnd(contextWidth)) +
      "  " + chalk.cyan(inputPrice.padEnd(inputWidth)) +
      "  " + chalk.cyan(outputPrice.padEnd(outputWidth)) +
      "\n"
    );
  }

  stream.write(chalk.dim("─".repeat(idWidth + nameWidth + contextWidth + inputWidth + outputWidth + 8)) + "\n");
  stream.write(chalk.dim(`  * Prices are per 1M tokens\n`));
}

function renderVerboseTable(models: ModelSpec[], stream: NodeJS.WritableStream): void {
  for (const model of models) {
    stream.write(chalk.bold.green(`\n  ${model.modelId}\n`));
    stream.write(chalk.dim("  " + "─".repeat(60)) + "\n");
    stream.write(`  ${chalk.dim("Name:")}         ${chalk.white(model.displayName)}\n`);
    stream.write(`  ${chalk.dim("Context:")}      ${chalk.yellow(formatTokens(model.contextWindow))}\n`);
    stream.write(`  ${chalk.dim("Max Output:")}   ${chalk.yellow(formatTokens(model.maxOutputTokens))}\n`);
    stream.write(`  ${chalk.dim("Pricing:")}      ${chalk.cyan(`$${model.pricing.input.toFixed(2)} input`)} ${chalk.dim("/")} ${chalk.cyan(`$${model.pricing.output.toFixed(2)} output`)} ${chalk.dim("(per 1M tokens)")}\n`);

    if (model.pricing.cachedInput !== undefined) {
      stream.write(`  ${chalk.dim("Cached Input:")} ${chalk.cyan(`$${model.pricing.cachedInput.toFixed(2)} per 1M tokens`)}\n`);
    }

    if (model.knowledgeCutoff) {
      stream.write(`  ${chalk.dim("Knowledge:")}    ${model.knowledgeCutoff}\n`);
    }

    // Features
    const features: string[] = [];
    if (model.features.streaming) features.push("streaming");
    if (model.features.functionCalling) features.push("function-calling");
    if (model.features.vision) features.push("vision");
    if (model.features.reasoning) features.push("reasoning");
    if (model.features.structuredOutputs) features.push("structured-outputs");
    if (model.features.fineTuning) features.push("fine-tuning");

    if (features.length > 0) {
      stream.write(`  ${chalk.dim("Features:")}     ${chalk.blue(features.join(", "))}\n`);
    }

    // Metadata
    if (model.metadata) {
      if (model.metadata.family) {
        stream.write(`  ${chalk.dim("Family:")}       ${model.metadata.family}\n`);
      }
      if (model.metadata.releaseDate) {
        stream.write(`  ${chalk.dim("Released:")}     ${model.metadata.releaseDate}\n`);
      }
      if (model.metadata.notes) {
        stream.write(`  ${chalk.dim("Notes:")}        ${chalk.italic(model.metadata.notes)}\n`);
      }
    }
  }
  stream.write("\n");
}

/**
 * Render image generation models table.
 */
function renderImageTable(models: ImageModelSpec[], verbose: boolean, stream: NodeJS.WritableStream): void {
  stream.write(chalk.bold.green("🎨 Image Generation Models\n"));
  stream.write(chalk.dim("─".repeat(80)) + "\n\n");

  // Group by provider
  const grouped = new Map<string, ImageModelSpec[]>();
  for (const model of models) {
    if (!grouped.has(model.provider)) {
      grouped.set(model.provider, []);
    }
    grouped.get(model.provider)!.push(model);
  }

  for (const [provider, providerModels] of Array.from(grouped.entries()).sort()) {
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    stream.write(chalk.bold.yellow(`${providerName}\n`));

    if (verbose) {
      for (const model of providerModels) {
        stream.write(chalk.bold.green(`\n  ${model.modelId}\n`));
        stream.write(chalk.dim("  " + "─".repeat(60)) + "\n");
        stream.write(`  ${chalk.dim("Name:")}      ${chalk.white(model.displayName)}\n`);
        stream.write(`  ${chalk.dim("Sizes:")}     ${chalk.yellow(model.supportedSizes.join(", "))}\n`);
        if (model.supportedQualities) {
          stream.write(`  ${chalk.dim("Qualities:")} ${chalk.yellow(model.supportedQualities.join(", "))}\n`);
        }
        stream.write(`  ${chalk.dim("Max Images:")} ${chalk.yellow(model.maxImages.toString())}\n`);
        stream.write(`  ${chalk.dim("Pricing:")}   ${chalk.cyan(formatImagePrice(model))}\n`);
        if (model.features) {
          const features: string[] = [];
          if (model.features.textRendering) features.push("text-rendering");
          if (model.features.transparency) features.push("transparency");
          if (model.features.conversational) features.push("conversational");
          if (features.length > 0) {
            stream.write(`  ${chalk.dim("Features:")}  ${chalk.blue(features.join(", "))}\n`);
          }
        }
      }
    } else {
      const idWidth = 32;
      const nameWidth = 25;
      const sizesWidth = 20;
      const priceWidth = 15;

      stream.write(chalk.dim("─".repeat(idWidth + nameWidth + sizesWidth + priceWidth + 6)) + "\n");
      stream.write(
        chalk.bold(
          "Model ID".padEnd(idWidth) +
          "  " + "Display Name".padEnd(nameWidth) +
          "  " + "Sizes".padEnd(sizesWidth) +
          "  " + "Price".padEnd(priceWidth)
        ) + "\n"
      );
      stream.write(chalk.dim("─".repeat(idWidth + nameWidth + sizesWidth + priceWidth + 6)) + "\n");

      for (const model of providerModels) {
        const sizes = model.supportedSizes.length > 2
          ? model.supportedSizes.slice(0, 2).join(", ") + "..."
          : model.supportedSizes.join(", ");

        stream.write(
          chalk.green(model.modelId.padEnd(idWidth)) +
          "  " + chalk.white(model.displayName.substring(0, nameWidth - 1).padEnd(nameWidth)) +
          "  " + chalk.yellow(sizes.padEnd(sizesWidth)) +
          "  " + chalk.cyan(formatImagePrice(model).padEnd(priceWidth)) +
          "\n"
        );
      }
      stream.write(chalk.dim("─".repeat(idWidth + nameWidth + sizesWidth + priceWidth + 6)) + "\n");
    }

    stream.write("\n");
  }
}

/**
 * Render speech/TTS models table.
 */
function renderSpeechTable(models: SpeechModelSpec[], verbose: boolean, stream: NodeJS.WritableStream): void {
  stream.write(chalk.bold.magenta("🎤 Speech (TTS) Models\n"));
  stream.write(chalk.dim("─".repeat(80)) + "\n\n");

  // Group by provider
  const grouped = new Map<string, SpeechModelSpec[]>();
  for (const model of models) {
    if (!grouped.has(model.provider)) {
      grouped.set(model.provider, []);
    }
    grouped.get(model.provider)!.push(model);
  }

  for (const [provider, providerModels] of Array.from(grouped.entries()).sort()) {
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    stream.write(chalk.bold.yellow(`${providerName}\n`));

    if (verbose) {
      for (const model of providerModels) {
        stream.write(chalk.bold.green(`\n  ${model.modelId}\n`));
        stream.write(chalk.dim("  " + "─".repeat(60)) + "\n");
        stream.write(`  ${chalk.dim("Name:")}    ${chalk.white(model.displayName)}\n`);
        stream.write(`  ${chalk.dim("Voices:")}  ${chalk.yellow(model.voices.length.toString())} voices\n`);
        if (model.voices.length <= 6) {
          stream.write(`            ${chalk.dim(model.voices.join(", "))}\n`);
        } else {
          stream.write(`            ${chalk.dim(model.voices.slice(0, 6).join(", ") + "...")}\n`);
        }
        stream.write(`  ${chalk.dim("Formats:")} ${chalk.yellow(model.formats.join(", "))}\n`);
        stream.write(`  ${chalk.dim("Max Input:")} ${chalk.yellow(model.maxInputLength.toString())} chars\n`);
        stream.write(`  ${chalk.dim("Pricing:")} ${chalk.cyan(formatSpeechPrice(model))}\n`);
        if (model.features) {
          const features: string[] = [];
          if (model.features.multiSpeaker) features.push("multi-speaker");
          if (model.features.voiceInstructions) features.push("voice-instructions");
          if (model.features.languages) features.push(`${model.features.languages} languages`);
          if (features.length > 0) {
            stream.write(`  ${chalk.dim("Features:")} ${chalk.blue(features.join(", "))}\n`);
          }
        }
      }
    } else {
      const idWidth = 30;
      const nameWidth = 28;
      const voicesWidth = 12;
      const priceWidth = 18;

      stream.write(chalk.dim("─".repeat(idWidth + nameWidth + voicesWidth + priceWidth + 6)) + "\n");
      stream.write(
        chalk.bold(
          "Model ID".padEnd(idWidth) +
          "  " + "Display Name".padEnd(nameWidth) +
          "  " + "Voices".padEnd(voicesWidth) +
          "  " + "Price".padEnd(priceWidth)
        ) + "\n"
      );
      stream.write(chalk.dim("─".repeat(idWidth + nameWidth + voicesWidth + priceWidth + 6)) + "\n");

      for (const model of providerModels) {
        stream.write(
          chalk.green(model.modelId.padEnd(idWidth)) +
          "  " + chalk.white(model.displayName.substring(0, nameWidth - 1).padEnd(nameWidth)) +
          "  " + chalk.yellow(`${model.voices.length} voices`.padEnd(voicesWidth)) +
          "  " + chalk.cyan(formatSpeechPrice(model).padEnd(priceWidth)) +
          "\n"
        );
      }
      stream.write(chalk.dim("─".repeat(idWidth + nameWidth + voicesWidth + priceWidth + 6)) + "\n");
    }

    stream.write("\n");
  }
}

/**
 * Format image model pricing for display.
 */
function formatImagePrice(model: ImageModelSpec): string {
  if (model.pricing.perImage !== undefined) {
    return `$${model.pricing.perImage.toFixed(2)}/img`;
  }
  if (model.pricing.bySize) {
    const prices = Object.values(model.pricing.bySize);
    const minPrice = Math.min(...prices.flatMap(p => typeof p === "number" ? [p] : Object.values(p)));
    const maxPrice = Math.max(...prices.flatMap(p => typeof p === "number" ? [p] : Object.values(p)));
    if (minPrice === maxPrice) {
      return `$${minPrice.toFixed(2)}/img`;
    }
    return `$${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}`;
  }
  return "varies";
}

/**
 * Format speech model pricing for display.
 */
function formatSpeechPrice(model: SpeechModelSpec): string {
  if (model.pricing.perCharacter !== undefined) {
    const perMillion = model.pricing.perCharacter * 1_000_000;
    return `$${perMillion.toFixed(0)}/1M chars`;
  }
  if (model.pricing.perMinute !== undefined) {
    return `~$${model.pricing.perMinute.toFixed(2)}/min`;
  }
  return "varies";
}

function renderJSON(
  textModels: ModelSpec[],
  imageModels: ImageModelSpec[],
  speechModels: SpeechModelSpec[],
  stream: NodeJS.WritableStream,
): void {
  const output: Record<string, unknown> = {};

  if (textModels.length > 0) {
    output.textModels = textModels.map(model => ({
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      pricing: {
        input: model.pricing.input,
        output: model.pricing.output,
        cachedInput: model.pricing.cachedInput,
        currency: "USD",
        per: "1M tokens",
      },
      knowledgeCutoff: model.knowledgeCutoff,
      features: model.features,
      metadata: model.metadata,
    }));
    output.shortcuts = MODEL_ALIASES;
  }

  if (imageModels.length > 0) {
    output.imageModels = imageModels.map(model => ({
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName,
      supportedSizes: model.supportedSizes,
      supportedQualities: model.supportedQualities,
      maxImages: model.maxImages,
      pricing: model.pricing,
      features: model.features,
    }));
  }

  if (speechModels.length > 0) {
    output.speechModels = speechModels.map(model => ({
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName,
      voices: model.voices,
      formats: model.formats,
      maxInputLength: model.maxInputLength,
      pricing: model.pricing,
      features: model.features,
    }));
  }

  stream.write(JSON.stringify(output, null, 2) + "\n");
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M tokens`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K tokens`;
  } else {
    return `${count} tokens`;
  }
}

export function registerModelsCommand(program: Command, env: CLIEnvironment): void {
  program
    .command(COMMANDS.models)
    .description("List available models with pricing and capabilities.")
    .option("--provider <name>", "Filter by provider (openai, anthropic, gemini)")
    .option("--format <format>", "Output format: table or json", "table")
    .option("--verbose", "Show detailed model information", false)
    .option("--text", "Show text/LLM models (default if no type specified)")
    .option("--image", "Show image generation models")
    .option("--speech", "Show speech/TTS models")
    .option("--all", "Show all model types (text, image, speech)")
    .action((options) =>
      executeAction(
        () => handleModelsCommand(options as ModelsCommandOptions, env),
        env,
      ),
    );
}
