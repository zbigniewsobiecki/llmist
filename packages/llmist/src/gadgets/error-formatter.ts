import type { ZodError } from "zod";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { AbstractGadget } from "./gadget.js";

export interface ErrorFormatterOptions {
  /** Custom argument prefix for block format examples. Default: "!!!ARG:" */
  argPrefix?: string;
  /** Custom start prefix for block format examples. Default: "!!!GADGET_START:" */
  startPrefix?: string;
  /** Custom end prefix for block format examples. Default: "!!!GADGET_END" */
  endPrefix?: string;
}

/**
 * Formats gadget execution errors with helpful context for LLM self-correction.
 *
 * This class generates error messages that include:
 * - Clear error description
 * - Full gadget usage instructions (via getInstruction())
 * - Block format reference for parse errors
 *
 * The goal is to help LLMs self-correct on subsequent invocation attempts.
 */
export class GadgetExecutionErrorFormatter {
  private readonly argPrefix: string;
  private readonly startPrefix: string;
  private readonly endPrefix: string;

  constructor(options: ErrorFormatterOptions = {}) {
    this.argPrefix = options.argPrefix ?? GADGET_ARG_PREFIX;
    this.startPrefix = options.startPrefix ?? GADGET_START_PREFIX;
    this.endPrefix = options.endPrefix ?? GADGET_END_PREFIX;
  }

  /**
   * Format a Zod validation error with full gadget instructions.
   *
   * @param gadgetName - Name of the gadget that was called
   * @param zodError - The Zod validation error
   * @param gadget - The gadget instance (for generating instructions)
   * @returns Formatted error message with usage instructions
   */
  formatValidationError(gadgetName: string, zodError: ZodError, gadget: AbstractGadget): string {
    const parts: string[] = [];

    // Error header
    parts.push(`Error: Invalid parameters for '${gadgetName}':`);

    // Format each validation issue
    for (const issue of zodError.issues) {
      const path = issue.path.join(".") || "root";
      parts.push(`  - ${path}: ${issue.message}`);
    }

    // Add gadget usage instructions
    parts.push("");
    parts.push("Gadget Usage:");
    parts.push(gadget.getInstruction(this.argPrefix));

    return parts.join("\n");
  }

  /**
   * Format a parse error with block format reference.
   *
   * @param gadgetName - Name of the gadget that was called
   * @param parseError - The parse error message
   * @param gadget - The gadget instance if found (for generating instructions)
   * @returns Formatted error message with format reference
   */
  formatParseError(
    gadgetName: string,
    parseError: string,
    gadget: AbstractGadget | undefined,
  ): string {
    const parts: string[] = [];

    // Error header
    parts.push(`Error: Failed to parse parameters for '${gadgetName}':`);
    parts.push(`  ${parseError}`);

    // Add gadget usage instructions if gadget exists
    if (gadget) {
      parts.push("");
      parts.push("Gadget Usage:");
      parts.push(gadget.getInstruction(this.argPrefix));
    }

    // Always add block format reference
    parts.push("");
    parts.push("Block Format Reference:");
    parts.push(`  ${this.startPrefix}${gadgetName}`);
    parts.push(`  ${this.argPrefix}parameterName`);
    parts.push("  parameter value here");
    parts.push(`  ${this.endPrefix}`);

    return parts.join("\n");
  }

  /**
   * Format a registry error (gadget not found) with available gadgets list.
   *
   * @param gadgetName - Name of the gadget that was not found
   * @param availableGadgets - List of available gadget names
   * @returns Formatted error message with available gadgets
   */
  formatRegistryError(gadgetName: string, availableGadgets: string[]): string {
    const parts: string[] = [];

    // Error header
    parts.push(`Error: Gadget '${gadgetName}' not found.`);

    // List available gadgets
    if (availableGadgets.length > 0) {
      parts.push("");
      parts.push(`Available gadgets: ${availableGadgets.join(", ")}`);
    } else {
      parts.push("");
      parts.push("No gadgets are currently registered.");
    }

    return parts.join("\n");
  }
}

/**
 * Create a pre-configured error formatter instance.
 *
 * @param options - Formatter options
 * @returns Configured GadgetExecutionErrorFormatter instance
 */
export function createErrorFormatter(
  options: ErrorFormatterOptions = {},
): GadgetExecutionErrorFormatter {
  return new GadgetExecutionErrorFormatter(options);
}
