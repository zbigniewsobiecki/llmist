/**
 * CLI command for testing and inspecting gadgets outside the agent loop.
 * Provides `gadget run`, `gadget info`, and `gadget validate` subcommands.
 *
 * @module cli/gadget-command
 */

import type { Command } from "commander";
import chalk from "chalk";

import type { BaseGadget } from "../gadgets/gadget.js";
import { schemaToJSONSchema } from "../gadgets/schema-to-json.js";
import { validateGadgetSchema } from "../gadgets/schema-validator.js";

import type { CLIEnvironment } from "./environment.js";
import { loadGadgets } from "./gadgets.js";
import { promptForParameters, readStdinJson } from "./gadget-prompts.js";
import { executeAction } from "./utils.js";

/**
 * Result of selecting a gadget from a file.
 */
interface GadgetSelection {
  gadget: BaseGadget;
  name: string;
}

/**
 * Options for the `gadget run` subcommand.
 */
interface GadgetRunOptions {
  name?: string;
  json?: boolean;
  raw?: boolean;
}

/**
 * Options for the `gadget info` subcommand.
 */
interface GadgetInfoOptions {
  name?: string;
  json?: boolean;
}

/**
 * Loads and selects a gadget from a file.
 * - Single gadget: returns it directly
 * - Multiple gadgets without --name: throws error listing available names
 * - Multiple gadgets with --name: finds matching gadget
 *
 * @param file - Path to gadget file
 * @param nameOption - Optional gadget name for selection
 * @param cwd - Current working directory
 * @returns Selected gadget with its name
 */
async function selectGadget(
  file: string,
  nameOption: string | undefined,
  cwd: string,
): Promise<GadgetSelection> {
  const gadgets = await loadGadgets([file], cwd);

  if (gadgets.length === 0) {
    throw new Error(
      `No gadgets found in '${file}'.\n` +
        "Ensure the file exports a Gadget class or instance.",
    );
  }

  // Single gadget - return it
  if (gadgets.length === 1) {
    const gadget = gadgets[0];
    const name = gadget.name ?? gadget.constructor.name;
    return { gadget, name };
  }

  // Multiple gadgets - need --name selection
  const names = gadgets.map((g) => g.name ?? g.constructor.name);

  if (!nameOption) {
    throw new Error(
      `File '${file}' exports ${gadgets.length} gadgets.\n` +
        `Use --name to select one:\n` +
        names.map((n) => `  - ${n}`).join("\n"),
    );
  }

  // Find by name (case-sensitive)
  const found = gadgets.find((g) => (g.name ?? g.constructor.name) === nameOption);

  if (!found) {
    throw new Error(
      `Gadget '${nameOption}' not found in '${file}'.\n` +
        `Available gadgets:\n` +
        names.map((n) => `  - ${n}`).join("\n"),
    );
  }

  return { gadget: found, name: nameOption };
}

/**
 * Executes the `gadget run` subcommand.
 * Loads a gadget, prompts for parameters (or reads from stdin), and executes it.
 */
async function executeGadgetRun(
  file: string,
  options: GadgetRunOptions,
  env: CLIEnvironment,
): Promise<void> {
  const cwd = process.cwd();
  const { gadget, name } = await selectGadget(file, options.name, cwd);

  env.stderr.write(chalk.cyan.bold(`\n🔧 Running gadget: ${name}\n`));

  // Get parameters - either interactive or from stdin
  let params: Record<string, unknown>;

  if (env.isTTY) {
    // Interactive mode: prompt for each parameter
    params = await promptForParameters(gadget.parameterSchema, {
      stdin: env.stdin,
      stdout: env.stderr, // Prompts go to stderr to keep stdout clean
    });
  } else {
    // Non-TTY mode: read JSON from stdin
    env.stderr.write(chalk.dim("Reading parameters from stdin...\n"));
    const stdinParams = await readStdinJson(env.stdin);

    // Validate through Zod if schema exists
    if (gadget.parameterSchema) {
      const result = gadget.parameterSchema.safeParse(stdinParams);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        throw new Error(`Invalid parameters:\n${issues}`);
      }
      params = result.data as Record<string, unknown>;
    } else {
      params = stdinParams;
    }
  }

  env.stderr.write(chalk.dim("\nExecuting...\n"));

  // Execute with timeout if configured
  const startTime = Date.now();
  let result: string;

  try {
    let rawResult: string | { result: string; cost?: number };
    if (gadget.timeoutMs && gadget.timeoutMs > 0) {
      rawResult = await Promise.race([
        Promise.resolve(gadget.execute(params)),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Gadget timed out after ${gadget.timeoutMs}ms`)),
            gadget.timeoutMs,
          ),
        ),
      ]);
    } else {
      rawResult = await Promise.resolve(gadget.execute(params));
    }
    // Normalize result: handle both string and { result, cost } return types
    result = typeof rawResult === "string" ? rawResult : rawResult.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Execution failed: ${message}`);
  }

  const elapsed = Date.now() - startTime;
  env.stderr.write(chalk.green(`\n✓ Completed in ${elapsed}ms\n\n`));

  // Output result
  formatOutput(result, options, env.stdout);
}

/**
 * Formats and writes the gadget execution result to stdout.
 */
function formatOutput(
  result: string,
  options: GadgetRunOptions,
  stdout: NodeJS.WritableStream,
): void {
  // Raw mode: output as-is
  if (options.raw) {
    stdout.write(result);
    if (!result.endsWith("\n")) stdout.write("\n");
    return;
  }

  // JSON mode or auto-detect JSON
  if (options.json || looksLikeJson(result)) {
    try {
      const parsed = JSON.parse(result);
      stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      return;
    } catch {
      // Not valid JSON, output as-is
    }
  }

  // Default: output as-is with trailing newline
  stdout.write(result);
  if (!result.endsWith("\n")) stdout.write("\n");
}

/**
 * Checks if a string looks like JSON (starts with { or [).
 */
function looksLikeJson(str: string): boolean {
  const trimmed = str.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

/**
 * Executes the `gadget info` subcommand.
 * Displays gadget description, schema, and examples.
 */
async function executeGadgetInfo(
  file: string,
  options: GadgetInfoOptions,
  env: CLIEnvironment,
): Promise<void> {
  const cwd = process.cwd();
  const { gadget, name } = await selectGadget(file, options.name, cwd);

  if (options.json) {
    // JSON output for programmatic use
    const info = buildGadgetInfo(gadget, name);
    env.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }

  // Pretty-printed output
  env.stdout.write("\n");
  env.stdout.write(chalk.cyan.bold(`${name}\n`));
  env.stdout.write(chalk.cyan("═".repeat(name.length)) + "\n\n");

  // Description
  env.stdout.write(chalk.bold("Description:\n"));
  env.stdout.write(`  ${gadget.description}\n\n`);

  // Parameters
  if (gadget.parameterSchema) {
    env.stdout.write(chalk.bold("Parameters:\n"));
    const jsonSchema = schemaToJSONSchema(gadget.parameterSchema, { target: "draft-7" });
    env.stdout.write(formatSchemaAsText(jsonSchema, "  ") + "\n\n");
  } else {
    env.stdout.write(chalk.dim("No parameters required.\n\n"));
  }

  // Timeout
  if (gadget.timeoutMs) {
    env.stdout.write(chalk.bold("Timeout:\n"));
    env.stdout.write(`  ${gadget.timeoutMs}ms\n\n`);
  }

  // Examples
  if (gadget.examples && gadget.examples.length > 0) {
    env.stdout.write(chalk.bold("Examples:\n"));
    for (const example of gadget.examples) {
      if (example.comment) {
        env.stdout.write(chalk.dim(`  # ${example.comment}\n`));
      }
      env.stdout.write(`  Input: ${chalk.cyan(JSON.stringify(example.params))}\n`);
      if (example.output !== undefined) {
        env.stdout.write(`  Output: ${chalk.green(example.output)}\n`);
      }
      env.stdout.write("\n");
    }
  }
}

/**
 * Builds a JSON-serializable info object for a gadget.
 */
function buildGadgetInfo(gadget: BaseGadget, name: string): Record<string, unknown> {
  const info: Record<string, unknown> = {
    name,
    description: gadget.description,
  };

  if (gadget.parameterSchema) {
    info.schema = schemaToJSONSchema(gadget.parameterSchema, { target: "draft-7" });
  }

  if (gadget.timeoutMs) {
    info.timeoutMs = gadget.timeoutMs;
  }

  if (gadget.examples && gadget.examples.length > 0) {
    info.examples = gadget.examples;
  }

  return info;
}

/**
 * Formats a JSON Schema as readable text with indentation.
 */
function formatSchemaAsText(schema: Record<string, unknown>, indent = ""): string {
  const lines: string[] = [];
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required || []) as string[];

  for (const [key, prop] of Object.entries(properties)) {
    const type = prop.type as string;
    const description = prop.description as string | undefined;
    const isRequired = required.includes(key);
    const enumValues = prop.enum as string[] | undefined;
    const defaultValue = prop.default;

    // Build the line
    let line = `${indent}${chalk.cyan(key)}`;

    // Required marker
    if (isRequired) {
      line += chalk.red("*");
    }

    // Type info
    if (type === "array") {
      const items = prop.items as Record<string, unknown> | undefined;
      const itemType = items?.type || "any";
      line += chalk.dim(` (${itemType}[])`);
    } else if (type === "object" && prop.properties) {
      line += chalk.dim(" (object)");
    } else {
      line += chalk.dim(` (${type})`);
    }

    // Default value
    if (defaultValue !== undefined) {
      line += chalk.dim(` [default: ${JSON.stringify(defaultValue)}]`);
    }

    // Description
    if (description) {
      line += `: ${description}`;
    }

    // Enum values
    if (enumValues) {
      line += chalk.yellow(` - one of: ${enumValues.join(", ")}`);
    }

    lines.push(line);

    // Recurse for nested objects
    if (type === "object" && prop.properties) {
      lines.push(formatSchemaAsText(prop, indent + "  "));
    }
  }

  return lines.join("\n");
}

/**
 * Executes the `gadget validate` subcommand.
 * Checks if a file exports valid gadget(s).
 */
async function executeGadgetValidate(file: string, env: CLIEnvironment): Promise<void> {
  const cwd = process.cwd();

  try {
    const gadgets = await loadGadgets([file], cwd);

    if (gadgets.length === 0) {
      throw new Error(
        "No gadgets exported from file.\n" +
          "A valid gadget must have:\n" +
          "  - execute() method\n" +
          "  - description property\n" +
          "  - parameterSchema (optional)",
      );
    }

    // Validate each gadget's structure and schema
    const issues: string[] = [];

    for (const gadget of gadgets) {
      const name = gadget.name ?? gadget.constructor.name;

      // Check required fields
      if (!gadget.description) {
        issues.push(`${name}: Missing 'description' property.`);
      }

      // Validate schema if present
      if (gadget.parameterSchema) {
        try {
          validateGadgetSchema(gadget.parameterSchema, name);
        } catch (schemaError) {
          const message = schemaError instanceof Error ? schemaError.message : String(schemaError);
          issues.push(`${name}: ${message}`);
        }
      }

      // Check execute method
      if (typeof gadget.execute !== "function") {
        issues.push(`${name}: Missing 'execute()' method.`);
      }
    }

    if (issues.length > 0) {
      throw new Error(`Validation issues:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    }

    // Success output
    env.stdout.write(chalk.green.bold("\n✓ Valid\n\n"));
    env.stdout.write(chalk.bold("Gadgets found:\n"));

    for (const gadget of gadgets) {
      const name = gadget.name ?? gadget.constructor.name;
      const schemaInfo = gadget.parameterSchema
        ? chalk.cyan("(with schema)")
        : chalk.dim("(no schema)");
      env.stdout.write(`  ${chalk.bold(name)} ${schemaInfo}\n`);
      env.stdout.write(chalk.dim(`    ${gadget.description}\n`));
    }

    env.stdout.write("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    env.stdout.write(chalk.red.bold(`\n✗ Invalid\n\n`));
    env.stdout.write(`${message}\n\n`);
    env.setExitCode(1);
  }
}

/**
 * Registers the `gadget` command group with run/info/validate subcommands.
 *
 * @param program - Commander program to register on
 * @param env - CLI environment for I/O
 */
export function registerGadgetCommand(program: Command, env: CLIEnvironment): void {
  const gadgetCmd = program
    .command("gadget")
    .description("Test and inspect gadgets outside the agent loop.");

  // Subcommand: run
  gadgetCmd
    .command("run <file>")
    .description("Execute a gadget with interactive prompts or stdin JSON.")
    .option("--name <gadget>", "Select gadget by name (required if file exports multiple)")
    .option("--json", "Format output as pretty-printed JSON")
    .option("--raw", "Output result as raw string without formatting")
    .action((file: string, options: GadgetRunOptions) =>
      executeAction(() => executeGadgetRun(file, options, env), env),
    );

  // Subcommand: info
  gadgetCmd
    .command("info <file>")
    .description("Display gadget description, schema, and examples.")
    .option("--name <gadget>", "Select gadget by name (required if file exports multiple)")
    .option("--json", "Output as JSON instead of formatted text")
    .action((file: string, options: GadgetInfoOptions) =>
      executeAction(() => executeGadgetInfo(file, options, env), env),
    );

  // Subcommand: validate
  gadgetCmd
    .command("validate <file>")
    .description("Check if file exports valid gadget(s).")
    .action((file: string) =>
      executeAction(() => executeGadgetValidate(file, env), env),
    );
}
