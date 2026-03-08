import type { ModelRegistry, TokenUsage } from "llmist";
import { CallStatsTracker } from "./progress/call-stats-tracker.js";
import { GadgetTracker } from "./progress/gadget-tracker.js";
import { NestedOperationTracker } from "./progress/nested-operation-tracker.js";
import { ProgressRenderer } from "./progress/progress-renderer.js";

export type ProgressMode = "streaming" | "cumulative";

/**
 * Progress indicator shown while waiting for LLM response.
 * Two modes:
 * - streaming: Shows current LLM call stats (out/in tokens, call time)
 * - cumulative: Shows total stats across all calls (total tokens, iterations, total time)
 * Only displays on TTY (interactive terminal), silent when piped.
 */
export class StreamProgress {
  // LLM call stats tracker (single responsibility for all call metrics)
  private callStatsTracker: CallStatsTracker;

  // In-flight gadget tracking for concurrent status display
  private gadgetTracker = new GadgetTracker();

  // Nested agent + gadget tracking for hierarchical subagent display
  private nestedOperationTracker: NestedOperationTracker;

  // Renderer handles all animation state and rendering logic
  private renderer: ProgressRenderer;

  constructor(target: NodeJS.WritableStream, isTTY: boolean, modelRegistry?: ModelRegistry) {
    this.callStatsTracker = new CallStatsTracker(modelRegistry);
    this.nestedOperationTracker = new NestedOperationTracker(modelRegistry);
    this.renderer = new ProgressRenderer(
      target,
      isTTY,
      this.callStatsTracker,
      this.gadgetTracker,
      this.nestedOperationTracker,
    );
  }

  // ===== Delegating accessors for test compatibility =====
  // Tests access these via (progress as any).fieldName

  private get mode(): ProgressMode {
    return this.callStatsTracker.mode;
  }

  private get model(): string {
    return this.callStatsTracker.model;
  }

  private get callStartTime(): number {
    return this.callStatsTracker.callStartTime;
  }

  private get callInputTokens(): number {
    return this.callStatsTracker.callInputTokens;
  }

  private get callInputTokensEstimated(): boolean {
    return this.callStatsTracker.callInputTokensEstimated;
  }

  private get callOutputTokens(): number {
    return this.callStatsTracker.callOutputTokens;
  }

  private get callOutputTokensEstimated(): boolean {
    return this.callStatsTracker.callOutputTokensEstimated;
  }

  private get callOutputChars(): number {
    return this.callStatsTracker.callOutputChars;
  }

  private set callOutputChars(value: number) {
    this.callStatsTracker.callOutputChars = value;
  }

  private get totalStartTime(): number {
    return this.callStatsTracker.totalStartTime;
  }

  private get totalTokens(): number {
    return this.callStatsTracker.totalTokens;
  }

  private get totalCost(): number {
    return this.callStatsTracker.totalCost;
  }

  private get iterations(): number {
    return this.callStatsTracker.iterations;
  }

  private get currentIteration(): number {
    return this.callStatsTracker.currentIteration;
  }

  // ===== End delegating accessors =====

  /**
   * Expose the underlying in-flight gadgets map for compatibility.
   * @internal Used by tests to access gadget state directly via (progress as any).inFlightGadgets
   */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed in tests via (progress as any)
  private get inFlightGadgets() {
    return this.gadgetTracker.getMap();
  }

  /**
   * Add a gadget to the in-flight tracking (called when gadget_call event received).
   * Triggers re-render to show the gadget in the status display.
   */
  addGadget(invocationId: string, name: string, params?: Record<string, unknown>): void {
    this.gadgetTracker.addGadget(invocationId, name, params);
    // Re-render immediately to show the new gadget
    this.renderer.triggerRender();
  }

  /**
   * Remove a gadget from in-flight tracking (called when gadget_result event received).
   * Triggers re-render to update the status display.
   */
  removeGadget(invocationId: string): void {
    this.gadgetTracker.removeGadget(invocationId);
    // Re-render immediately to remove the gadget from display
    this.renderer.triggerRender();
  }

  /**
   * Check if there are any gadgets currently in flight.
   */
  hasInFlightGadgets(): boolean {
    return this.gadgetTracker.hasInFlightGadgets();
  }

  /**
   * Get a gadget by ID (for accessing name, params, etc.).
   */
  getGadget(invocationId: string) {
    return this.gadgetTracker.getGadget(invocationId);
  }

  /**
   * Mark a gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   * The gadget and its nested operations remain visible until clearCompletedGadgets() is called.
   */
  completeGadget(invocationId: string): void {
    const found = this.gadgetTracker.completeGadget(invocationId);
    if (found) {
      this.renderer.triggerRender();
    }
  }

  /**
   * Clear all completed gadgets from the display.
   * Called when new text output arrives to clean up the finished gadget section.
   */
  clearCompletedGadgets(): void {
    const clearedIds = this.gadgetTracker.clearCompletedGadgets();
    // Also clean up nested operations for each cleared gadget
    for (const id of clearedIds) {
      this.nestedOperationTracker.clearByParentInvocationId(id);
    }
    this.renderer.triggerRender();
  }

  /**
   * Add a nested agent LLM call (called when nested llm_call_start event received).
   * Used to display hierarchical progress for subagent gadgets.
   * @param parentCallNumber - Top-level call number for hierarchical display (e.g., #1.2)
   * @param gadgetInvocationId - Gadget invocation ID for unique subagent identification
   */
  addNestedAgent(
    id: string,
    parentInvocationId: string,
    depth: number,
    model: string,
    iteration: number,
    info?: {
      inputTokens?: number;
      cachedInputTokens?: number;
    },
    parentCallNumber?: number,
    gadgetInvocationId?: string,
  ): void {
    this.nestedOperationTracker.addNestedAgent(
      id,
      parentInvocationId,
      depth,
      model,
      iteration,
      info,
      parentCallNumber,
      gadgetInvocationId,
    );
    this.renderer.triggerRender();
  }

  /**
   * Update a nested agent with completion info (called when nested llm_call_end event received).
   * Records completion time to freeze the elapsed timer.
   * @param info - Full LLM call info including tokens, cache details, and cost
   */
  updateNestedAgent(
    id: string,
    info: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
      reasoningTokens?: number;
      finishReason?: string;
      cost?: number;
    },
  ): void {
    const hadAgent = this.nestedOperationTracker.getNestedAgent(id) !== undefined;
    this.nestedOperationTracker.updateNestedAgent(id, info);
    if (hadAgent) {
      this.renderer.triggerRender();
    }
  }

  /**
   * Remove a nested agent (called when the nested LLM call completes).
   */
  removeNestedAgent(id: string): void {
    this.nestedOperationTracker.removeNestedAgent(id);
    this.renderer.triggerRender();
  }

  /**
   * Get a nested agent by ID (for accessing startTime, etc.).
   */
  getNestedAgent(id: string) {
    return this.nestedOperationTracker.getNestedAgent(id);
  }

  /**
   * Get aggregated metrics from all nested agents for a parent gadget.
   * Used to show total token counts and cost for subagent gadgets like BrowseWeb.
   */
  getAggregatedSubagentMetrics(parentInvocationId: string): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cost: number;
    callCount: number;
  } {
    return this.nestedOperationTracker.getAggregatedSubagentMetrics(parentInvocationId);
  }

  /**
   * Add a nested gadget call (called when nested gadget_call event received).
   */
  addNestedGadget(
    id: string,
    depth: number,
    parentInvocationId: string,
    name: string,
    parameters?: Record<string, unknown>,
  ): void {
    this.nestedOperationTracker.addNestedGadget(id, depth, parentInvocationId, name, parameters);
    this.renderer.triggerRender();
  }

  /**
   * Remove a nested gadget (called when nested gadget_result event received).
   */
  removeNestedGadget(id: string): void {
    this.nestedOperationTracker.removeNestedGadget(id);
    this.renderer.triggerRender();
  }

  /**
   * Get a nested gadget by ID (for accessing startTime, name, etc.).
   */
  getNestedGadget(id: string) {
    return this.nestedOperationTracker.getNestedGadget(id);
  }

  /**
   * Mark a nested gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   */
  completeNestedGadget(id: string): void {
    const hadGadget = this.nestedOperationTracker.getNestedGadget(id) !== undefined;
    this.nestedOperationTracker.completeNestedGadget(id);
    if (hadGadget) {
      this.renderer.triggerRender();
    }
  }

  /**
   * Starts a new LLM call. Switches to streaming mode.
   * @param model - Model name being used
   * @param estimatedInputTokens - Initial input token count. Should come from
   *   client.countTokens() for accuracy (provider-specific counting), not
   *   character-based estimation. Will be updated with provider-returned counts
   *   via setInputTokens() during streaming if available.
   */
  startCall(model: string, estimatedInputTokens?: number): void {
    this.callStatsTracker.startCall(model, estimatedInputTokens);
    this.renderer.start();
  }

  /**
   * Ends the current LLM call. Updates cumulative stats and switches to cumulative mode.
   * @param usage - Final token usage from the call (including cached tokens if available)
   */
  endCall(usage?: TokenUsage): void {
    this.callStatsTracker.endCall(usage);
    this.renderer.pause();
  }

  /**
   * Adds gadget execution cost to the total.
   * Called when gadgets complete to include their costs (direct + subagent) in the total.
   */
  addGadgetCost(cost: number): void {
    this.callStatsTracker.addGadgetCost(cost);
  }

  /**
   * Sets the input token count for current call (from stream metadata).
   * @param tokens - Token count from provider or client.countTokens()
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider API or client.countTokens().
   *   Display shows ~ prefix only when estimated=true.
   */
  setInputTokens(tokens: number, estimated = false): void {
    this.callStatsTracker.setInputTokens(tokens, estimated);
  }

  /**
   * Sets the output token count for current call (from stream metadata).
   * @param tokens - Token count from provider streaming response
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider's streaming metadata.
   *   Display shows ~ prefix only when estimated=true.
   */
  setOutputTokens(tokens: number, estimated = false): void {
    this.callStatsTracker.setOutputTokens(tokens, estimated);
  }

  /**
   * Sets cached token counts for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param cachedInputTokens - Number of tokens read from cache (cheaper)
   * @param cacheCreationInputTokens - Number of tokens written to cache (more expensive)
   */
  setCachedTokens(cachedInputTokens: number, cacheCreationInputTokens: number): void {
    this.callStatsTracker.setCachedTokens(cachedInputTokens, cacheCreationInputTokens);
  }

  /**
   * Sets reasoning token count for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param reasoningTokens - Number of reasoning/thinking tokens (subset of outputTokens)
   */
  setReasoningTokens(reasoningTokens: number): void {
    this.callStatsTracker.setReasoningTokens(reasoningTokens);
  }

  /**
   * Get total elapsed time in seconds since the first call started.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getTotalElapsedSeconds(): number {
    return this.callStatsTracker.getTotalElapsedSeconds();
  }

  /**
   * Get elapsed time in seconds for the current call.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getCallElapsedSeconds(): number {
    return this.callStatsTracker.getCallElapsedSeconds();
  }

  /**
   * Starts the progress indicator animation after a brief delay.
   */
  start(): void {
    this.renderer.start();
  }

  /**
   * Updates output character count for current call and marks streaming as active.
   * @param totalChars - Total accumulated character count
   */
  update(totalChars: number): void {
    this.callStatsTracker.callOutputChars = totalChars;
  }

  /**
   * Pauses the progress indicator and clears all rendered lines.
   * Can be resumed with start().
   */
  pause(): void {
    this.renderer.pause();
  }

  /**
   * Completes the progress indicator and clears the line.
   */
  complete(): void {
    this.renderer.complete();
  }

  /**
   * Returns the total accumulated cost across all calls.
   */
  getTotalCost(): number {
    return this.callStatsTracker.totalCost;
  }

  /**
   * Returns a formatted stats string for cancellation messages.
   * Format: "↑ 1.2k | ↓ 300 | 5.0s"
   */
  formatStats(): string {
    return this.renderer.formatStats();
  }

  /**
   * Returns a formatted prompt string with stats (like bash PS1).
   * Shows current call stats during streaming, cumulative stats otherwise.
   * Format: "out: 1.2k │ in: ~300 │ 5s > " or "3.6k │ i2 │ 34s > "
   */
  formatPrompt(): string {
    return this.renderer.formatPrompt();
  }

  /**
   * Clear rendered lines and reset counter.
   * Call this before printing static output that should remain visible
   * above the render zone (e.g., opening/closing lines for nested operations).
   */
  clearAndReset(): void {
    this.renderer.clearAndReset();
  }
}
