import type { ZodTypeAny } from "zod";

import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { AbortException } from "./exceptions.js";
import { schemaToJSONSchema } from "./schema-to-json.js";
import { validateGadgetSchema } from "./schema-validator.js";
import type { ExecutionContext, GadgetExample, GadgetExecuteReturn } from "./types.js";

/**
 * Format parameters object as Block format for use in examples.
 * Uses JSON Pointer paths for nested structures.
 *
 * @param params - The parameters object to format
 * @param prefix - Path prefix for nested structures (internal use)
 * @param argPrefix - The argument prefix marker (defaults to GADGET_ARG_PREFIX)
 */
function formatParamsForBlockExample(
  params: Record<string, unknown>,
  prefix: string = "",
  argPrefix: string = GADGET_ARG_PREFIX,
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const fullPath = prefix ? `${prefix}/${key}` : key;

    if (Array.isArray(value)) {
      // Arrays: use numeric indices
      value.forEach((item, index) => {
        const itemPath = `${fullPath}/${index}`;
        if (typeof item === "object" && item !== null) {
          // Nested object in array
          lines.push(formatParamsForBlockExample(item as Record<string, unknown>, itemPath, argPrefix));
        } else {
          lines.push(`${argPrefix}${itemPath}`);
          lines.push(String(item));
        }
      });
    } else if (typeof value === "object" && value !== null) {
      // Nested objects: recurse with path prefix
      lines.push(formatParamsForBlockExample(value as Record<string, unknown>, fullPath, argPrefix));
    } else {
      // Simple values
      lines.push(`${argPrefix}${fullPath}`);
      lines.push(String(value));
    }
  }

  return lines.join("\n");
}

/**
 * Format a single parameter line with type info and description.
 * Helper function for formatSchemaAsPlainText.
 */
function formatParamLine(
  key: string,
  propObj: Record<string, unknown>,
  isRequired: boolean,
  indent = "",
): string {
  const type = propObj.type as string;
  const description = propObj.description as string | undefined;
  const enumValues = propObj.enum as string[] | undefined;

  let line = `${indent}- ${key}`;

  // Add type info
  if (type === "array") {
    const items = propObj.items as Record<string, unknown> | undefined;
    const itemType = items?.type || "any";
    line += ` (array of ${itemType})`;
  } else if (type === "object" && propObj.properties) {
    line += " (object)";
  } else {
    line += ` (${type})`;
  }

  // Add required marker only for nested objects (not at root level where sections indicate this)
  if (isRequired && indent !== "") {
    line += " [required]";
  }

  // Add description
  if (description) {
    line += `: ${description}`;
  }

  // Add enum values if present
  if (enumValues) {
    line += ` - one of: ${enumValues.map((v) => `"${v}"`).join(", ")}`;
  }

  return line;
}

/**
 * Format JSON Schema as plain text description.
 * This presents parameters in a neutral, human-readable format
 * that complements the block format used for gadget invocation.
 */
function formatSchemaAsPlainText(
  schema: Record<string, unknown>,
  indent = "",
  atRoot = true,
): string {
  const lines: string[] = [];
  const properties = (schema.properties || {}) as Record<string, unknown>;
  const required = (schema.required || []) as string[];

  // At root level: split required/optional
  if (atRoot && indent === "") {
    const requiredProps: [string, unknown][] = [];
    const optionalProps: [string, unknown][] = [];

    for (const [key, prop] of Object.entries(properties)) {
      if (required.includes(key)) {
        requiredProps.push([key, prop]);
      } else {
        optionalProps.push([key, prop]);
      }
    }

    const reqCount = requiredProps.length;
    const optCount = optionalProps.length;

    // Add count summary
    if (reqCount > 0 || optCount > 0) {
      const parts: string[] = [];
      if (reqCount > 0) parts.push(`${reqCount} required`);
      if (optCount > 0) parts.push(`${optCount} optional`);
      lines.push(parts.join(", "));
      lines.push(""); // Blank line
    }

    // Render REQUIRED section
    if (reqCount > 0) {
      lines.push("REQUIRED Parameters:");
      for (const [key, prop] of requiredProps) {
        lines.push(formatParamLine(key, prop as Record<string, unknown>, true, ""));
        // Handle nested objects
        const propObj = prop as Record<string, unknown>;
        if (propObj.type === "object" && propObj.properties) {
          lines.push(formatSchemaAsPlainText(propObj, "  ", false));
        }
      }
    }

    // Render OPTIONAL section
    if (optCount > 0) {
      if (reqCount > 0) lines.push(""); // Blank line between sections
      lines.push("OPTIONAL Parameters:");
      for (const [key, prop] of optionalProps) {
        lines.push(formatParamLine(key, prop as Record<string, unknown>, false, ""));
        // Handle nested objects
        const propObj = prop as Record<string, unknown>;
        if (propObj.type === "object" && propObj.properties) {
          lines.push(formatSchemaAsPlainText(propObj, "  ", false));
        }
      }
    }

    return lines.join("\n");
  }

  // Nested objects: use current behavior (no split)
  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    lines.push(formatParamLine(key, prop as Record<string, unknown>, isRequired, indent));

    const propObj = prop as Record<string, unknown>;
    if (propObj.type === "object" && propObj.properties) {
      lines.push(formatSchemaAsPlainText(propObj, indent + "  ", false));
    }
  }

  return lines.join("\n");
}

/**
 * Abstract base class for gadgets. Most users should use the `Gadget()` factory
 * or `createGadget()` function instead, as they provide better type safety
 * and simpler APIs.
 *
 * Extend this class directly only when you need advanced control over gadget behavior.
 */
export abstract class AbstractGadget {
  /**
   * The name of the gadget. Used for identification when LLM calls it.
   * If not provided, defaults to the class name.
   */
  name?: string;

  /**
   * Human-readable description of what the gadget does.
   */
  abstract description: string;

  /**
   * Optional Zod schema describing the expected input payload. When provided,
   * it will be validated before execution and transformed into a JSON Schema
   * representation that is surfaced to the LLM as part of the instructions.
   */
  parameterSchema?: ZodTypeAny;

  /**
   * Optional timeout in milliseconds for gadget execution.
   * If execution exceeds this timeout, a TimeoutException will be thrown.
   * If not set, the global defaultGadgetTimeoutMs from runtime options will be used.
   * Set to 0 or undefined to disable timeout for this gadget.
   */
  timeoutMs?: number;

  /**
   * Optional usage examples to help LLMs understand proper invocation.
   * Examples are rendered in getInstruction() alongside the schema.
   *
   * Note: Uses broader `unknown` type to allow typed examples from subclasses
   * while maintaining runtime compatibility.
   */
  examples?: GadgetExample<unknown>[];

  /**
   * Execute the gadget with the given parameters.
   * Can be synchronous or asynchronous.
   *
   * @param params - Parameters passed from the LLM
   * @param ctx - Optional execution context for cost reporting and LLM access
   * @returns Result as a string, or an object with result and optional cost
   *
   * @example
   * ```typescript
   * // Simple string return (free gadget)
   * execute(params) {
   *   return "result";
   * }
   *
   * // Object return with cost tracking
   * execute(params) {
   *   return { result: "data", cost: 0.001 };
   * }
   *
   * // Using context for callback-based cost reporting
   * execute(params, ctx) {
   *   ctx.reportCost(0.001);
   *   return "result";
   * }
   *
   * // Using wrapped LLMist for automatic cost tracking
   * async execute(params, ctx) {
   *   const summary = await ctx.llmist.complete('Summarize: ' + params.text);
   *   return summary;
   * }
   * ```
   */
  abstract execute(
    params: Record<string, unknown>,
    ctx?: ExecutionContext,
  ): GadgetExecuteReturn | Promise<GadgetExecuteReturn>;

  /**
   * Throws an AbortException if the execution has been aborted.
   *
   * Call this at key checkpoints in long-running gadgets to allow early exit
   * when the gadget has been cancelled (e.g., due to timeout). This enables
   * resource cleanup and prevents unnecessary work after cancellation.
   *
   * @param ctx - The execution context containing the abort signal
   * @throws AbortException if ctx.signal.aborted is true
   *
   * @example
   * ```typescript
   * class DataProcessor extends Gadget({
   *   description: 'Processes data in multiple steps',
   *   schema: z.object({ items: z.array(z.string()) }),
   * }) {
   *   async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
   *     const results: string[] = [];
   *
   *     for (const item of params.items) {
   *       // Check before each expensive operation
   *       this.throwIfAborted(ctx);
   *
   *       results.push(await this.processItem(item));
   *     }
   *
   *     return results.join(', ');
   *   }
   * }
   * ```
   */
  throwIfAborted(ctx?: ExecutionContext): void {
    if (ctx?.signal?.aborted) {
      throw new AbortException();
    }
  }

  /**
   * Register a cleanup function to run when execution is aborted (timeout or cancellation).
   * The cleanup function is called immediately if the signal is already aborted.
   * Errors thrown by the cleanup function are silently ignored.
   *
   * Use this to clean up resources like browser instances, database connections,
   * or child processes when the gadget is cancelled due to timeout.
   *
   * @param ctx - The execution context containing the abort signal
   * @param cleanup - Function to run on abort (can be sync or async)
   *
   * @example
   * ```typescript
   * class BrowserGadget extends Gadget({
   *   description: 'Fetches web page content',
   *   schema: z.object({ url: z.string() }),
   * }) {
   *   async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
   *     const browser = await chromium.launch();
   *     this.onAbort(ctx, () => browser.close());
   *
   *     const page = await browser.newPage();
   *     this.onAbort(ctx, () => page.close());
   *
   *     await page.goto(params.url);
   *     const content = await page.content();
   *
   *     await browser.close();
   *     return content;
   *   }
   * }
   * ```
   */
  onAbort(ctx: ExecutionContext | undefined, cleanup: () => void | Promise<void>): void {
    if (!ctx?.signal) return;

    const safeCleanup = () => {
      try {
        const result = cleanup();
        if (result && typeof result === "object" && "catch" in result) {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // Swallow synchronous errors
      }
    };

    if (ctx.signal.aborted) {
      // Already aborted, run cleanup immediately
      safeCleanup();
      return;
    }

    ctx.signal.addEventListener("abort", safeCleanup, { once: true });
  }

  /**
   * Create an AbortController linked to the execution context's signal.
   * When the parent signal aborts, the returned controller also aborts with the same reason.
   *
   * Useful for passing abort signals to child operations like fetch() while still
   * being able to abort them independently if needed.
   *
   * @param ctx - The execution context containing the parent abort signal
   * @returns A new AbortController linked to the parent signal
   *
   * @example
   * ```typescript
   * class FetchGadget extends Gadget({
   *   description: 'Fetches data from URL',
   *   schema: z.object({ url: z.string() }),
   * }) {
   *   async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
   *     const controller = this.createLinkedAbortController(ctx);
   *
   *     // fetch() will automatically abort when parent times out
   *     const response = await fetch(params.url, { signal: controller.signal });
   *     return response.text();
   *   }
   * }
   * ```
   */
  createLinkedAbortController(ctx?: ExecutionContext): AbortController {
    const controller = new AbortController();

    if (ctx?.signal) {
      if (ctx.signal.aborted) {
        controller.abort(ctx.signal.reason);
      } else {
        ctx.signal.addEventListener(
          "abort",
          () => {
            controller.abort(ctx.signal.reason);
          },
          { once: true },
        );
      }
    }

    return controller;
  }

  /**
   * Auto-generated instruction text for the LLM.
   * Combines name, description, and parameter schema into a formatted instruction.
   * @deprecated Use getInstruction() instead
   */
  get instruction(): string {
    return this.getInstruction();
  }

  /**
   * Generate instruction text for the LLM.
   * Combines name, description, and parameter schema into a formatted instruction.
   *
   * @param optionsOrArgPrefix - Optional custom prefixes for examples, or just argPrefix string for backwards compatibility
   * @returns Formatted instruction string
   */
  getInstruction(
    optionsOrArgPrefix?: string | { argPrefix?: string; startPrefix?: string; endPrefix?: string },
  ): string {
    // Handle backwards compatibility: if string is passed, treat it as argPrefix
    const options =
      typeof optionsOrArgPrefix === "string"
        ? { argPrefix: optionsOrArgPrefix }
        : optionsOrArgPrefix;
    const parts: string[] = [];

    // Add description
    parts.push(this.description);

    if (this.parameterSchema) {
      // Validate that the schema doesn't use z.unknown() and can be serialized
      const gadgetName = this.name ?? this.constructor.name;
      validateGadgetSchema(this.parameterSchema, gadgetName);

      const jsonSchema = schemaToJSONSchema(this.parameterSchema, {
        target: "draft-7",
      });

      // Use plain text schema description
      parts.push("\n\nParameters:");
      parts.push(formatSchemaAsPlainText(jsonSchema));
    }

    // Render examples if present
    if (this.examples && this.examples.length > 0) {
      parts.push("\n\nExamples:");

      // Use custom prefixes if provided, otherwise use defaults
      const effectiveArgPrefix = options?.argPrefix ?? GADGET_ARG_PREFIX;
      const effectiveStartPrefix = options?.startPrefix ?? GADGET_START_PREFIX;
      const effectiveEndPrefix = options?.endPrefix ?? GADGET_END_PREFIX;
      const gadgetName = this.name || this.constructor.name;

      this.examples.forEach((example, index) => {
        // Add horizontal rule between examples (but not before the first one)
        if (index > 0) {
          parts.push("");
          parts.push("---");
          parts.push("");
        }

        // Add comment if provided
        if (example.comment) {
          parts.push(`# ${example.comment}`);
        }

        // Add GADGET_START marker
        parts.push(`${effectiveStartPrefix}${gadgetName}`);

        // Render params in block format
        parts.push(
          formatParamsForBlockExample(example.params as Record<string, unknown>, "", effectiveArgPrefix),
        );

        // Add GADGET_END marker
        parts.push(effectiveEndPrefix);

        // Render output if provided
        if (example.output !== undefined) {
          parts.push(""); // Blank line before output
          parts.push("Expected Output:");
          parts.push(example.output);
        }
      });
    }

    return parts.join("\n");
  }
}

