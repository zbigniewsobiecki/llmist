/**
 * Validation utilities for gadget parameters.
 *
 * Provides standalone validation with Zod schema support, including
 * default application and formatted error output.
 *
 * @module gadgets/validation
 */

import type { ZodTypeAny } from "zod";
import type { BaseGadget } from "./gadget.js";

/**
 * Individual validation issue with path and message.
 */
export interface ValidationIssue {
  /** Dot-separated path to the invalid field (e.g., "user.email") */
  path: string;
  /** Human-readable error message */
  message: string;
}

/**
 * Result of parameter validation.
 * Discriminated union based on `success` field.
 */
export type ValidationResult<T = Record<string, unknown>> =
  | {
      success: true;
      /** Validated and transformed data with defaults applied */
      data: T;
    }
  | {
      success: false;
      /** Formatted error message */
      error: string;
      /** Individual validation issues */
      issues: ValidationIssue[];
    };

/**
 * Validate parameters against a Zod schema and apply defaults/transformations.
 *
 * This replicates the validation behavior from GadgetExecutor, making it
 * available for direct use in tests and other contexts.
 *
 * @param schema - Zod schema to validate against
 * @param params - Raw parameters to validate
 * @returns ValidationResult with either validated data or error details
 *
 * @example
 * ```typescript
 * import { validateAndApplyDefaults } from 'llmist';
 * import { z } from 'zod';
 *
 * const schema = z.object({
 *   delay: z.number().default(100),
 *   retries: z.number().int().min(0).default(3),
 * });
 *
 * const result = validateAndApplyDefaults(schema, { delay: 50 });
 * if (result.success) {
 *   console.log(result.data); // { delay: 50, retries: 3 }
 * }
 * ```
 */
export function validateAndApplyDefaults<T = Record<string, unknown>>(
  schema: ZodTypeAny,
  params: Record<string, unknown>,
): ValidationResult<T> {
  const result = schema.safeParse(params);

  if (result.success) {
    return {
      success: true,
      data: result.data as T,
    };
  }

  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "root",
    message: issue.message,
  }));

  const formattedError = `Invalid parameters: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`;

  return {
    success: false,
    error: formattedError,
    issues,
  };
}

/**
 * Validate gadget parameters using the gadget's schema.
 *
 * Convenience wrapper that extracts the schema from a gadget instance.
 * If the gadget has no schema, validation always succeeds with the
 * original parameters.
 *
 * @param gadget - Gadget instance with optional parameterSchema
 * @param params - Raw parameters to validate
 * @returns ValidationResult with either validated data or error details
 *
 * @example
 * ```typescript
 * import { validateGadgetParams, createGadget } from 'llmist';
 * import { z } from 'zod';
 *
 * const calculator = createGadget({
 *   description: 'Add numbers',
 *   schema: z.object({
 *     a: z.number(),
 *     b: z.number().default(0),
 *   }),
 *   execute: ({ a, b }) => String(a + b),
 * });
 *
 * const result = validateGadgetParams(calculator, { a: 5 });
 * if (result.success) {
 *   console.log(result.data); // { a: 5, b: 0 }
 * }
 * ```
 */
export function validateGadgetParams(
  gadget: BaseGadget,
  params: Record<string, unknown>,
): ValidationResult {
  if (!gadget.parameterSchema) {
    return {
      success: true,
      data: params,
    };
  }

  return validateAndApplyDefaults(gadget.parameterSchema, params);
}
