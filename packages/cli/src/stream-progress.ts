import type { ModelRegistry, TokenUsage } from "llmist";
import { CallStatsTracker, type ProgressMode } from "./progress/call-stats-tracker.js";
import { GadgetTracker } from "./progress/gadget-tracker.js";
import { NestedOperationTracker } from "./progress/nested-operation-tracker.js";
import { ProgressRenderer } from "./progress/progress-renderer.js";

export type { ProgressMode };

/**
 * Progress indicator shown while waiting for LLM response.
 * Coordinates 4 specialized trackers: callStatsTracker, gadgetTracker,
 * nestedOperationTracker, and renderer. Delegates all work to them.
 * Only displays on TTY (interactive terminal), silent when piped.
 */
export class StreamProgress {
  private callStatsTracker: CallStatsTracker;
  private gadgetTracker = new GadgetTracker();
  private nestedOperationTracker: NestedOperationTracker;
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

  addGadget(invocationId: string, name: string, params?: Record<string, unknown>): void {
    this.gadgetTracker.addGadget(invocationId, name, params);
    this.renderer.triggerRender();
  }

  removeGadget(invocationId: string): void {
    this.gadgetTracker.removeGadget(invocationId);
    this.renderer.triggerRender();
  }

  hasInFlightGadgets(): boolean {
    return this.gadgetTracker.hasInFlightGadgets();
  }

  getGadget(invocationId: string) {
    return this.gadgetTracker.getGadget(invocationId);
  }

  completeGadget(invocationId: string): void {
    const found = this.gadgetTracker.completeGadget(invocationId);
    if (found) {
      this.renderer.triggerRender();
    }
  }

  clearCompletedGadgets(): void {
    const clearedIds = this.gadgetTracker.clearCompletedGadgets();
    for (const id of clearedIds) {
      this.nestedOperationTracker.clearByParentInvocationId(id);
    }
    this.renderer.triggerRender();
  }

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

  removeNestedAgent(id: string): void {
    this.nestedOperationTracker.removeNestedAgent(id);
    this.renderer.triggerRender();
  }

  getNestedAgent(id: string) {
    return this.nestedOperationTracker.getNestedAgent(id);
  }

  getAggregatedSubagentMetrics(parentInvocationId: string): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cost: number;
    callCount: number;
  } {
    return this.nestedOperationTracker.getAggregatedSubagentMetrics(parentInvocationId);
  }

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

  removeNestedGadget(id: string): void {
    this.nestedOperationTracker.removeNestedGadget(id);
    this.renderer.triggerRender();
  }

  getNestedGadget(id: string) {
    return this.nestedOperationTracker.getNestedGadget(id);
  }

  completeNestedGadget(id: string): void {
    const hadGadget = this.nestedOperationTracker.getNestedGadget(id) !== undefined;
    this.nestedOperationTracker.completeNestedGadget(id);
    if (hadGadget) {
      this.renderer.triggerRender();
    }
  }

  startCall(model: string, estimatedInputTokens?: number): void {
    this.callStatsTracker.startCall(model, estimatedInputTokens);
    this.renderer.start();
  }

  endCall(usage?: TokenUsage): void {
    this.callStatsTracker.endCall(usage);
    this.renderer.pause();
  }

  addGadgetCost(cost: number): void {
    this.callStatsTracker.addGadgetCost(cost);
  }

  setInputTokens(tokens: number, estimated = false): void {
    this.callStatsTracker.setInputTokens(tokens, estimated);
  }

  setOutputTokens(tokens: number, estimated = false): void {
    this.callStatsTracker.setOutputTokens(tokens, estimated);
  }

  setCachedTokens(cachedInputTokens: number, cacheCreationInputTokens: number): void {
    this.callStatsTracker.setCachedTokens(cachedInputTokens, cacheCreationInputTokens);
  }

  setReasoningTokens(reasoningTokens: number): void {
    this.callStatsTracker.setReasoningTokens(reasoningTokens);
  }

  getTotalElapsedSeconds(): number {
    return this.callStatsTracker.getTotalElapsedSeconds();
  }

  getCallElapsedSeconds(): number {
    return this.callStatsTracker.getCallElapsedSeconds();
  }

  start(): void {
    this.renderer.start();
  }

  update(totalChars: number): void {
    this.callStatsTracker.callOutputChars = totalChars;
  }

  pause(): void {
    this.renderer.pause();
  }

  complete(): void {
    this.renderer.complete();
  }

  getTotalCost(): number {
    return this.callStatsTracker.totalCost;
  }

  formatStats(): string {
    return this.renderer.formatStats();
  }

  formatPrompt(): string {
    return this.renderer.formatPrompt();
  }

  clearAndReset(): void {
    this.renderer.clearAndReset();
  }
}
