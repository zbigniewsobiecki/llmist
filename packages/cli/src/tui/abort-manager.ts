/**
 * AbortManager - Encapsulates AbortController lifecycle for cancellation support.
 *
 * Provides a clean interface for managing abort signals across agent runs.
 * The controller is lazily initialized on first getSignal() call and can be
 * reset between REPL iterations.
 */

export class AbortManager {
	private controller: AbortController | null = null;

	/**
	 * Get the abort signal for cancellation support.
	 * Lazily creates the AbortController on first call.
	 */
	getSignal(): AbortSignal {
		if (!this.controller) {
			this.controller = new AbortController();
		}
		return this.controller.signal;
	}

	/**
	 * Reset the abort controller for a new agent run.
	 * Called at the start of each REPL iteration.
	 */
	reset(): void {
		this.controller = new AbortController();
	}

	/**
	 * Trigger the abort signal.
	 * Safe to call even if no controller exists yet.
	 */
	abort(): void {
		if (this.controller && !this.controller.signal.aborted) {
			this.controller.abort();
		}
	}

	/**
	 * Check if the abort signal has been triggered.
	 */
	isAborted(): boolean {
		return this.controller?.signal.aborted ?? false;
	}
}
