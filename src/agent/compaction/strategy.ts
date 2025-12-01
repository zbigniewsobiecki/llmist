/**
 * Strategy interface for context compaction.
 *
 * Strategies define how conversation history is compressed to fit within
 * context window limits. Different strategies trade off between:
 * - Speed (LLM calls vs local processing)
 * - Context preservation (summary quality vs simple truncation)
 * - Cost (summarization model usage)
 */

import type { LLMist } from "../../core/client.js";
import type { LLMMessage } from "../../core/messages.js";
import type { ModelLimits } from "../../core/model-catalog.js";
import type { ResolvedCompactionConfig } from "./config.js";

/**
 * Context provided to compaction strategies.
 */
export interface CompactionContext {
  /** Current token count of the conversation */
  currentTokens: number;
  /** Target token count after compaction */
  targetTokens: number;
  /** Model's context window limits */
  modelLimits: ModelLimits;
  /** LLMist client for summarization calls */
  client: LLMist;
  /** Model identifier for token counting and summarization */
  model: string;
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** Compacted messages to replace history with */
  messages: LLMMessage[];
  /** Summary text if summarization was used */
  summary?: string;
  /** Metadata about the compaction */
  metadata: {
    /** Number of messages before compaction */
    originalCount: number;
    /** Number of messages after compaction */
    compactedCount: number;
    /** Estimated tokens before compaction */
    tokensBefore: number;
    /** Estimated tokens after compaction */
    tokensAfter: number;
  };
}

/**
 * Interface for compaction strategy implementations.
 *
 * Strategies receive the conversation history (excluding base messages like
 * system prompt and gadget instructions) and must return a compacted version.
 *
 * @example
 * ```typescript
 * class MyCustomStrategy implements CompactionStrategy {
 *   readonly name = 'my-custom';
 *
 *   async compact(
 *     messages: LLMMessage[],
 *     config: ResolvedCompactionConfig,
 *     context: CompactionContext
 *   ): Promise<CompactionResult> {
 *     // Custom compaction logic
 *     return {
 *       messages: compactedMessages,
 *       metadata: { ... }
 *     };
 *   }
 * }
 * ```
 */
export interface CompactionStrategy {
  /** Human-readable name of the strategy */
  readonly name: string;

  /**
   * Compact the given messages to fit within target token count.
   *
   * @param messages - Conversation history messages (excludes system/gadget base)
   * @param config - Resolved compaction configuration
   * @param context - Context including token counts and LLM client
   * @returns Compacted messages with metadata
   */
  compact(
    messages: LLMMessage[],
    config: ResolvedCompactionConfig,
    context: CompactionContext,
  ): Promise<CompactionResult>;
}

/**
 * Utility to group messages into logical conversation turns.
 *
 * A "turn" is typically a user message followed by an assistant response.
 * Gadget calls are grouped with the preceding assistant message.
 */
export interface MessageTurn {
  /** Messages in this turn (user + assistant + any gadget results) */
  messages: LLMMessage[];
  /** Estimated token count for this turn */
  tokenEstimate: number;
}

/**
 * Groups messages into logical conversation turns.
 *
 * Rules:
 * - A turn starts with a user message
 * - A turn includes all subsequent assistant messages until the next user message
 * - The first message(s) before any user message are considered "preamble"
 *
 * @param messages - Array of conversation messages
 * @returns Array of message turns
 */
export function groupIntoTurns(messages: LLMMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let currentTurn: LLMMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && currentTurn.length > 0) {
      // Start new turn - save current one
      turns.push({
        messages: currentTurn,
        tokenEstimate: estimateTurnTokens(currentTurn),
      });
      currentTurn = [msg];
    } else {
      currentTurn.push(msg);
    }
  }

  // Don't forget the last turn
  if (currentTurn.length > 0) {
    turns.push({
      messages: currentTurn,
      tokenEstimate: estimateTurnTokens(currentTurn),
    });
  }

  return turns;
}

/**
 * Rough token estimation for a turn (4 chars per token).
 */
function estimateTurnTokens(messages: LLMMessage[]): number {
  return Math.ceil(messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0) / 4);
}

/**
 * Flattens turns back into a message array.
 */
export function flattenTurns(turns: MessageTurn[]): LLMMessage[] {
  return turns.flatMap((turn) => turn.messages);
}
