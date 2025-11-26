import { type Command } from "commander";
import chalk from "chalk";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { executeAction } from "./utils.js";
import type { ModelSpec } from "../core/model-catalog.js";
import { MODEL_ALIASES } from "../core/model-shortcuts.js";

interface ModelsCommandOptions {
  provider?: string;
  format?: "table" | "json";
  verbose?: boolean;
}

async function handleModelsCommand(
  options: ModelsCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const client = env.createClient();

  // Get models, optionally filtered by provider
  const models = client.modelRegistry.listModels(options.provider);

  if (options.format === "json") {
    renderJSON(models, env.stdout);
  } else {
    renderTable(models, options.verbose || false, env.stdout);
  }
}

function renderTable(models: ModelSpec[], verbose: boolean, stream: NodeJS.WritableStream): void {
  // Group models by provider
  const grouped = new Map<string, ModelSpec[]>();
  for (const model of models) {
    const provider = model.provider;
    if (!grouped.has(provider)) {
      grouped.set(provider, []);
    }
    grouped.get(provider)!.push(model);
  }

  // Header
  stream.write(chalk.bold.cyan("\nAvailable Models\n"));
  stream.write(chalk.cyan("=".repeat(80)) + "\n\n");

  // Display each provider's models
  const providers = Array.from(grouped.keys()).sort();
  for (const provider of providers) {
    const providerModels = grouped.get(provider)!;
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

    stream.write(chalk.bold.yellow(`${providerName} Models\n`));

    if (verbose) {
      renderVerboseTable(providerModels, stream);
    } else {
      renderCompactTable(providerModels, stream);
    }

    stream.write("\n");
  }

  // Display shortcuts
  stream.write(chalk.bold.magenta("Model Shortcuts\n"));
  stream.write(chalk.dim("─".repeat(80)) + "\n");

  const shortcuts = Object.entries(MODEL_ALIASES).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [shortcut, fullName] of shortcuts) {
    stream.write(chalk.cyan(`  ${shortcut.padEnd(15)}`) + chalk.dim(" → ") + chalk.white(fullName) + "\n");
  }
  stream.write("\n");
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

function renderJSON(models: ModelSpec[], stream: NodeJS.WritableStream): void {
  const output = {
    models: models.map(model => ({
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
    })),
    shortcuts: MODEL_ALIASES,
  };

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
    .description("List all available LLM models with pricing and capabilities.")
    .option("--provider <name>", "Filter by provider (openai, anthropic, gemini)")
    .option("--format <format>", "Output format: table or json", "table")
    .option("--verbose", "Show detailed model information", false)
    .action((options) =>
      executeAction(
        () => handleModelsCommand(options as ModelsCommandOptions, env),
        env,
      ),
    );
}
