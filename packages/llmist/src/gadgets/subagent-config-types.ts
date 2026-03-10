/**
 * Subagent configuration types.
 *
 * Simple config shapes passed to gadgets for subagent configuration.
 * No external dependencies — self-contained data shapes.
 *
 * @module
 */

// =============================================================================
// Subagent Configuration Types
// =============================================================================

/**
 * Parent agent configuration passed to gadgets.
 * Contains settings that subagents can inherit.
 */
export interface AgentContextConfig {
  /** Model identifier used by the parent agent */
  model: string;
  /** Temperature setting used by the parent agent */
  temperature?: number;
}

/**
 * Configuration for a single subagent.
 * Can be defined globally in `[subagents.Name]` or per-profile in `[profile.subagents.Name]`.
 *
 * @example
 * ```toml
 * [subagents.BrowseWeb]
 * model = "inherit"      # Use parent agent's model
 * maxIterations = 20
 * headless = true
 * ```
 */
export interface SubagentConfig {
  /**
   * Model to use for this subagent.
   * - "inherit": Use parent agent's model (default behavior)
   * - Any model ID: Use specific model (e.g., "sonnet", "haiku", "gpt-4o")
   */
  model?: string;
  /** Maximum iterations for the subagent loop */
  maxIterations?: number;
  /** Budget limit in USD for the subagent */
  budget?: number;
  /**
   * Timeout for the subagent gadget execution in milliseconds.
   * Overrides the gadget's hardcoded timeoutMs when set.
   * Set to 0 to disable timeout for this gadget.
   */
  timeoutMs?: number;
  /**
   * Maximum number of concurrent executions allowed for this gadget.
   * When the limit is reached, additional calls are queued and processed
   * as earlier executions complete (FIFO order).
   * Set to 0 or omit to allow unlimited concurrent executions (default).
   */
  maxConcurrent?: number;
  /** Additional subagent-specific options */
  [key: string]: unknown;
}

/**
 * Map of subagent names to their configurations.
 */
export type SubagentConfigMap = Record<string, SubagentConfig>;

/**
 * Gadget execution mode controlling how multiple gadgets are executed.
 *
 * - `'parallel'` (default): Gadgets without dependencies execute concurrently (fire-and-forget).
 *   This maximizes throughput but gadgets may complete in any order.
 *
 * - `'sequential'`: Gadgets execute one at a time, each awaiting completion before the next starts.
 *   Useful for:
 *   - Gadgets with implicit ordering dependencies (e.g., file operations)
 *   - Debugging and tracing execution flow
 *   - Resource-constrained environments
 *   - Ensuring deterministic execution order
 *
 * Note: Explicit `dependsOn` relationships are always respected regardless of mode.
 * Sequential mode effectively enforces a global `maxConcurrent: 1` for all gadgets.
 *
 * @example
 * ```typescript
 * const agent = LLMist.createAgent()
 *   .withModel("sonnet")
 *   .withGadgets(FileReader, FileWriter)
 *   .withGadgetExecutionMode('sequential')  // Execute one at a time
 *   .ask("Process files in order");
 * ```
 */
export type GadgetExecutionMode = "parallel" | "sequential";
