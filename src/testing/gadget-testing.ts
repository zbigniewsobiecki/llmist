/**
 * Testing utilities for gadgets.
 *
 * Provides helpers for testing gadgets with schema validation without
 * requiring full executor setup.
 *
 * @module testing/gadget-testing
 */

import type { BaseGadget } from "../gadgets/gadget.js";
import { type ValidationResult, validateGadgetParams } from "../gadgets/validation.js";

/**
 * Result of testing a gadget.
 */
export interface TestGadgetResult {
  /** Result string if execution succeeded */
  result?: string;
  /** Error message if validation or execution failed */
  error?: string;
  /** Parameters after validation and default application */
  validatedParams?: Record<string, unknown>;
}

/**
 * Options for testGadget.
 */
export interface TestGadgetOptions {
  /**
   * If true, skip schema validation.
   * Useful for testing gadget behavior with invalid parameters.
   */
  skipValidation?: boolean;
}

/**
 * Test a gadget with schema validation and default application.
 *
 * This helper replicates the validation behavior from GadgetExecutor.execute(),
 * making it easy to test gadgets in isolation without setting up a full
 * registry and executor.
 *
 * @param gadget - Gadget instance to test
 * @param params - Raw parameters (before validation)
 * @param options - Test options
 * @returns Promise resolving to test result
 *
 * @example
 * ```typescript
 * import { testGadget } from 'llmist/testing';
 * import { createGadget } from 'llmist';
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
 * // Test with defaults applied
 * const result = await testGadget(calculator, { a: 5 });
 * expect(result.result).toBe('5');
 * expect(result.validatedParams).toEqual({ a: 5, b: 0 });
 *
 * // Test validation errors
 * const invalid = await testGadget(calculator, { a: 'not a number' });
 * expect(invalid.error).toContain('Invalid parameters');
 *
 * // Test with validation skipped
 * const skipped = await testGadget(calculator, { a: 5 }, { skipValidation: true });
 * expect(skipped.validatedParams).toEqual({ a: 5 }); // No defaults applied
 * ```
 */
export async function testGadget(
  gadget: BaseGadget,
  params: Record<string, unknown>,
  options?: TestGadgetOptions,
): Promise<TestGadgetResult> {
  let validatedParams = params;

  // Apply validation if schema exists and not skipped
  if (!options?.skipValidation) {
    const validationResult: ValidationResult = validateGadgetParams(gadget, params);

    if (!validationResult.success) {
      return {
        error: validationResult.error,
        validatedParams: params,
      };
    }

    validatedParams = validationResult.data;
  }

  // Execute the gadget
  try {
    const result = await Promise.resolve(gadget.execute(validatedParams));
    return {
      result,
      validatedParams,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      validatedParams,
    };
  }
}

/**
 * Test multiple parameter sets against a gadget.
 *
 * Convenience helper for running the same gadget with different inputs.
 *
 * @param gadget - Gadget instance to test
 * @param paramSets - Array of parameter sets to test
 * @param options - Test options applied to all tests
 * @returns Promise resolving to array of test results
 *
 * @example
 * ```typescript
 * const results = await testGadgetBatch(calculator, [
 *   { a: 1, b: 2 },
 *   { a: 5 },
 *   { a: 'invalid' },
 * ]);
 *
 * expect(results[0].result).toBe('3');
 * expect(results[1].result).toBe('5');
 * expect(results[2].error).toBeDefined();
 * ```
 */
export async function testGadgetBatch(
  gadget: BaseGadget,
  paramSets: Record<string, unknown>[],
  options?: TestGadgetOptions,
): Promise<TestGadgetResult[]> {
  return Promise.all(paramSets.map((params) => testGadget(gadget, params, options)));
}
