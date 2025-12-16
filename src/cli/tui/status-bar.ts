/**
 * TUI status bar for displaying real-time metrics.
 *
 * Shows accumulated token counts, elapsed time, and cost.
 * Updates on LLM call lifecycle events.
 */

import type { Box } from "@unblessed/node";
import type { TUIMetrics } from "./types.js";
import { formatTokens, formatCost } from "../ui/formatters.js";

/** Rough estimate: ~4 characters per token for English text */
const CHARS_PER_TOKEN = 4;

/**
 * Manages the status bar display and metrics tracking.
 */
export class StatusBar {
  private metrics: TUIMetrics;
  private statusBox: Box;
  private renderCallback: () => void;
  private renderNowCallback: () => void;

  /** Current call's streaming input tokens (estimate) */
  private streamingInputTokens = 0;
  /** Current call's streaming output tokens (estimate) */
  private streamingOutputTokens = 0;
  /** Whether we're currently streaming */
  private isStreaming = false;

  constructor(
    statusBox: Box,
    model: string,
    renderCallback: () => void,
    renderNowCallback?: () => void,
  ) {
    this.statusBox = statusBox;
    this.renderCallback = renderCallback;
    this.renderNowCallback = renderNowCallback ?? renderCallback;
    this.metrics = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
      startTime: Date.now(),
      iteration: 0,
      model,
    };

    // Initial render
    this.render();
  }

  /**
   * Called when a new LLM call starts.
   * @param model - Model name
   * @param estimatedInputTokens - Estimated input tokens for this call
   */
  startCall(model: string, estimatedInputTokens: number): void {
    this.metrics.model = model;
    this.metrics.iteration++;
    // Track streaming estimates separately
    this.streamingInputTokens = estimatedInputTokens;
    this.streamingOutputTokens = 0;
    this.isStreaming = true;
    this.render();
  }

  /**
   * Called during streaming to update output token estimate.
   * Uses immediate rendering for real-time feedback.
   * @param estimatedOutputTokens - Estimated output tokens so far
   */
  updateStreaming(estimatedOutputTokens: number): void {
    this.streamingOutputTokens = estimatedOutputTokens;
    this.render(true); // immediate render for streaming updates
  }

  /**
   * Called when an LLM call completes.
   * Replaces streaming estimates with actual values.
   */
  endCall(
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    cost: number,
  ): void {
    // Add actual values to accumulated totals
    this.metrics.inputTokens += inputTokens;
    this.metrics.outputTokens += outputTokens;
    this.metrics.cachedTokens += cachedTokens;
    this.metrics.cost += cost;
    // Clear streaming state
    this.streamingInputTokens = 0;
    this.streamingOutputTokens = 0;
    this.isStreaming = false;
    this.render();
  }

  /**
   * Add cost from gadget execution (e.g., subagent costs).
   */
  addGadgetCost(cost: number): void {
    if (cost > 0) {
      this.metrics.cost += cost;
      this.render();
    }
  }

  /**
   * Get current metrics for external use.
   */
  getMetrics(): Readonly<TUIMetrics> {
    return { ...this.metrics };
  }

  /**
   * Get elapsed time in seconds.
   */
  getElapsedSeconds(): number {
    return (Date.now() - this.metrics.startTime) / 1000;
  }

  /**
   * Render the status bar content.
   * @param immediate - If true, render immediately without debouncing
   */
  private render(immediate = false): void {
    const elapsed = this.getElapsedSeconds().toFixed(1);

    // ANSI color codes
    const YELLOW = "\x1b[33m";
    const GREEN = "\x1b[32m";
    const BLUE = "\x1b[34m";
    const CYAN = "\x1b[36m";
    const GRAY = "\x1b[90m";
    const RESET = "\x1b[0m";

    // Calculate display values: accumulated + current streaming
    const displayInputTokens = this.metrics.inputTokens + this.streamingInputTokens;
    const displayOutputTokens = this.metrics.outputTokens + this.streamingOutputTokens;

    // Build status line using ANSI codes
    // Format: ↑ 12.5k | ↓ 3.2k | 45.2s | $0.0234
    const parts: string[] = [];

    // Input tokens (yellow) - show ~ prefix during streaming to indicate estimate
    const inputPrefix = this.isStreaming && this.streamingInputTokens > 0 ? "~" : "";
    parts.push(`${YELLOW}↑ ${inputPrefix}${formatTokens(displayInputTokens)}${RESET}`);

    // Cached tokens (blue) - only show if present
    if (this.metrics.cachedTokens > 0) {
      parts.push(`${BLUE}⤿ ${formatTokens(this.metrics.cachedTokens)}${RESET}`);
    }

    // Output tokens (green) - show ~ prefix during streaming to indicate estimate
    const outputPrefix = this.isStreaming ? "~" : "";
    parts.push(`${GREEN}↓ ${outputPrefix}${formatTokens(displayOutputTokens)}${RESET}`);

    // Elapsed time (gray)
    parts.push(`${GRAY}${elapsed}s${RESET}`);

    // Cost (cyan)
    parts.push(`${CYAN}$${formatCost(this.metrics.cost)}${RESET}`);

    // Iteration count
    parts.push(`${CYAN}#${this.metrics.iteration}${RESET}`);

    this.statusBox.setContent(parts.join(` ${GRAY}|${RESET} `));

    // Use immediate render for streaming updates, debounced for others
    if (immediate) {
      this.renderNowCallback();
    } else {
      this.renderCallback();
    }
  }

  /**
   * Estimate tokens from text length.
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
