/**
 * Text-only response handler types.
 *
 * Defines the handler configuration for when the LLM returns a text-only response
 * (no gadget calls). Supports simple strategies, gadget triggers, and custom handlers.
 *
 * @module
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMMessage } from "../core/messages.js";

// Text-only response handler types
export type TextOnlyHandler =
  | TextOnlyStrategy // Simple string strategies
  | TextOnlyGadgetConfig // Trigger a gadget
  | TextOnlyCustomHandler; // Custom handler function

/**
 * Simple strategies for common cases
 * - 'terminate': End the loop (default behavior)
 * - 'acknowledge': Continue to next iteration
 * - 'wait_for_input': Request human input
 */
export type TextOnlyStrategy = "terminate" | "acknowledge" | "wait_for_input";

/**
 * Configuration for triggering a gadget when receiving text-only response
 */
export interface TextOnlyGadgetConfig {
  type: "gadget";
  name: string;
  /**
   * Optional function to map text to gadget parameters.
   * If not provided, text will be passed as { text: string }
   */
  parameterMapping?: (text: string) => Record<string, unknown>;
}

/**
 * Custom handler for complex text-only response scenarios
 */
export interface TextOnlyCustomHandler {
  type: "custom";
  handler: (context: TextOnlyContext) => Promise<TextOnlyAction> | TextOnlyAction;
}

/**
 * Context provided to custom text-only handlers
 */
export interface TextOnlyContext {
  /** The complete text response from the LLM */
  text: string;
  /** Current iteration number */
  iteration: number;
  /** Full conversation history */
  conversation: LLMMessage[];
  /** Logger instance */
  logger: Logger<ILogObj>;
}

/**
 * Actions that can be returned by text-only handlers
 */
export type TextOnlyAction =
  | { action: "continue" }
  | { action: "terminate" }
  | { action: "wait_for_input"; question?: string }
  | { action: "trigger_gadget"; name: string; parameters: Record<string, unknown> };
