/**
 * Tracks in-flight gadget calls for the progress display.
 * Single responsibility: manage CRUD operations for gadget tracking state.
 */

export interface InFlightGadget {
  name: string;
  params?: Record<string, unknown>;
  startTime: number;
  completed?: boolean;
  completedTime?: number;
}

export class GadgetTracker {
  private inFlightGadgets: Map<string, InFlightGadget> = new Map();

  /**
   * Add a gadget to the in-flight tracking (called when gadget_call event received).
   */
  addGadget(invocationId: string, name: string, params?: Record<string, unknown>): void {
    this.inFlightGadgets.set(invocationId, { name, params, startTime: Date.now() });
  }

  /**
   * Remove a gadget from in-flight tracking (called when gadget_result event received).
   */
  removeGadget(invocationId: string): void {
    this.inFlightGadgets.delete(invocationId);
  }

  /**
   * Check if there are any gadgets currently in flight.
   */
  hasInFlightGadgets(): boolean {
    return this.inFlightGadgets.size > 0;
  }

  /**
   * Get a gadget by ID (for accessing name, params, etc.).
   */
  getGadget(invocationId: string): InFlightGadget | undefined {
    return this.inFlightGadgets.get(invocationId);
  }

  /**
   * Mark a gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   * Returns true if the gadget was found and marked complete.
   */
  completeGadget(invocationId: string): boolean {
    const gadget = this.inFlightGadgets.get(invocationId);
    if (gadget) {
      gadget.completed = true;
      gadget.completedTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Clear all completed gadgets from tracking.
   * Returns the IDs of cleared gadgets so callers can clean up related state.
   */
  clearCompletedGadgets(): string[] {
    const clearedIds: string[] = [];
    for (const [id, gadget] of this.inFlightGadgets) {
      if (gadget.completed) {
        this.inFlightGadgets.delete(id);
        clearedIds.push(id);
      }
    }
    return clearedIds;
  }

  /**
   * Iterate over all in-flight gadgets.
   */
  entries(): IterableIterator<[string, InFlightGadget]> {
    return this.inFlightGadgets.entries();
  }

  /**
   * Expose the underlying Map for direct inspection (e.g., in tests).
   */
  getMap(): Map<string, InFlightGadget> {
    return this.inFlightGadgets;
  }
}
