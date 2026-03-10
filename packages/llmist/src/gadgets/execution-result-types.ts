/**
 * Execution result types for gadget calls.
 *
 * Contains result types returned by gadget `execute()` methods and the
 * internal result type used after execution completes.
 *
 * @module
 */

import type { GadgetMediaOutput, StoredMedia } from "./media-types.js";

export type { GadgetMediaOutput, StoredMedia };

// Result of gadget execution
export interface GadgetExecutionResult {
  gadgetName: string;
  invocationId: string; // Still required in results for tracking
  parameters: Record<string, unknown>;
  result?: string;
  error?: string;
  executionTimeMs: number;
  breaksLoop?: boolean;
  /** Cost of gadget execution in USD. Defaults to 0 if not provided by gadget. */
  cost?: number;
  /** Media outputs from the gadget (images, audio, video, files) */
  media?: GadgetMediaOutput[];
  /** Abstract IDs for media outputs (e.g., ["media_a1b2c3"]) */
  mediaIds?: string[];
  /** Stored media with paths (for CLI display) */
  storedMedia?: StoredMedia[];
}

/**
 * Result returned by gadget execute() method.
 * Can be a simple string or an object with result and optional cost.
 *
 * @example
 * ```typescript
 * // Simple string return (free gadget)
 * execute: () => "result"
 *
 * // Object return with cost
 * execute: () => ({ result: "data", cost: 0.001 })
 * ```
 */
export interface GadgetExecuteResult {
  /** The execution result as a string */
  result: string;
  /** Optional cost in USD (e.g., 0.001 for $0.001) */
  cost?: number;
}

/**
 * Extended result type with media support.
 * Use this when gadget returns images, audio, video, or files.
 *
 * @example
 * ```typescript
 * // Return with image
 * execute: () => ({
 *   result: "Screenshot captured",
 *   media: [{
 *     kind: "image",
 *     data: base64EncodedPng,
 *     mimeType: "image/png",
 *     description: "Screenshot"
 *   }],
 *   cost: 0.001
 * })
 * ```
 */
export interface GadgetExecuteResultWithMedia {
  /** The execution result as a string */
  result: string;
  /** Media outputs (images, audio, video, files) */
  media?: GadgetMediaOutput[];
  /** Optional cost in USD (e.g., 0.001 for $0.001) */
  cost?: number;
}

/**
 * Union type for backwards-compatible execute() return type.
 * Gadgets can return:
 * - string (legacy, cost = 0)
 * - GadgetExecuteResult (result + optional cost)
 * - GadgetExecuteResultWithMedia (result + optional media + optional cost)
 */
export type GadgetExecuteReturn = string | GadgetExecuteResult | GadgetExecuteResultWithMedia;

// Parsed gadget call from LLM stream
export interface ParsedGadgetCall {
  gadgetName: string;
  invocationId: string; // Auto-generated internally if not provided
  parametersRaw: string;
  parameters?: Record<string, unknown>;
  parseError?: string;
  /** List of invocation IDs this gadget depends on. Empty array if no dependencies. */
  dependencies: string[];
}
