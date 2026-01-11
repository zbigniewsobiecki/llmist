import { createLogger } from "llmist";
import type { ILogObj, Logger } from "tslog";
import type {
  MockMatcherContext,
  MockOptions,
  MockRegistration,
  MockResponse,
  MockStats,
} from "./mock-types.js";

/**
 * Global singleton instance for managing LLM mocks.
 * This allows mocks to be registered once and used across the application.
 */
export class MockManager {
  private static instance: MockManager | null = null;
  private mocks: Map<string, MockRegistration> = new Map();
  private stats: Map<string, MockStats> = new Map();
  private options: Required<MockOptions>;
  private logger: Logger<ILogObj>;
  private nextId = 1;

  private constructor(options: MockOptions = {}) {
    this.options = {
      strictMode: options.strictMode ?? false,
      debug: options.debug ?? false,
      recordStats: options.recordStats ?? true,
    };
    this.logger = createLogger({ name: "MockManager", minLevel: this.options.debug ? 2 : 3 });
  }

  /**
   * Get the global MockManager instance.
   * Creates one if it doesn't exist.
   */
  static getInstance(options?: MockOptions): MockManager {
    if (!MockManager.instance) {
      MockManager.instance = new MockManager(options);
    } else if (options) {
      // Warn if options are provided after initialization
      console.warn(
        "MockManager.getInstance() called with options, but instance already exists. " +
          "Options are ignored. Use setOptions() to update options or reset() to reinitialize.",
      );
    }
    return MockManager.instance;
  }

  /**
   * Reset the global instance (useful for testing).
   */
  static reset(): void {
    MockManager.instance = null;
  }

  /**
   * Register a new mock.
   *
   * @param registration - The mock registration configuration
   * @returns The ID of the registered mock
   *
   * @example
   * const manager = MockManager.getInstance();
   * const mockId = manager.register({
   *   label: 'GPT-4 mock',
   *   matcher: (ctx) => ctx.modelName.includes('gpt-4'),
   *   response: { text: 'Mocked response' }
   * });
   */
  register(registration: Omit<MockRegistration, "id"> & { id?: string }): string {
    const id = registration.id ?? `mock-${this.nextId++}`;
    const mock: MockRegistration = {
      id,
      matcher: registration.matcher,
      response: registration.response,
      label: registration.label,
      once: registration.once,
    };

    this.mocks.set(id, mock);

    if (this.options.recordStats) {
      this.stats.set(id, { matchCount: 0 });
    }

    this.logger.debug(
      `Registered mock: ${id}${mock.label ? ` (${mock.label})` : ""}${mock.once ? " [once]" : ""}`,
    );

    return id;
  }

  /**
   * Unregister a mock by ID.
   */
  unregister(id: string): boolean {
    const deleted = this.mocks.delete(id);
    if (deleted) {
      this.stats.delete(id);
      this.logger.debug(`Unregistered mock: ${id}`);
    }
    return deleted;
  }

  /**
   * Clear all registered mocks.
   */
  clear(): void {
    this.mocks.clear();
    this.stats.clear();
    this.logger.debug("Cleared all mocks");
  }

  /**
   * Find and return a matching mock for the given context.
   * Returns the mock response if found, null otherwise.
   */
  async findMatch(context: MockMatcherContext): Promise<MockResponse | null> {
    this.logger.debug(
      `Finding match for: ${context.provider}:${context.modelName} (${this.mocks.size} mocks registered)`,
    );

    for (const [id, mock] of this.mocks.entries()) {
      let matches = false;

      try {
        matches = await Promise.resolve(mock.matcher(context));
      } catch (error) {
        // Matcher errors are caught - a matcher that throws simply doesn't match
        this.logger.warn(`Error in matcher ${id}:`, error);
        // In strict mode, re-throw matcher errors to help catch bugs
        if (this.options.strictMode) {
          throw new Error(`Matcher error in mock ${id}: ${error}`);
        }
        continue; // Skip to next mock
      }

      if (matches) {
        this.logger.debug(`Mock matched: ${id}${mock.label ? ` (${mock.label})` : ""}`);

        // Record stats
        if (this.options.recordStats) {
          const stats = this.stats.get(id);
          if (stats) {
            stats.matchCount++;
            stats.lastUsed = new Date();
          }
        }

        // Remove if once
        if (mock.once) {
          this.mocks.delete(id);
          this.stats.delete(id);
          this.logger.debug(`Removed one-time mock: ${id}`);
        }

        // Resolve response (could be a function)
        // Response errors are NOT caught - they should propagate to the caller
        const response =
          typeof mock.response === "function"
            ? await Promise.resolve(mock.response(context))
            : mock.response;

        return response;
      }
    }

    // No match found
    this.logger.debug("No mock matched");

    if (this.options.strictMode) {
      throw new Error(
        `No mock registered for ${context.provider}:${context.modelName}. ` +
          `Register a mock using MockManager.getInstance().register() or disable strictMode.`,
      );
    }

    // Return empty response in non-strict mode
    return {
      text: "",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  }

  /**
   * Get statistics for a specific mock.
   */
  getStats(id: string): MockStats | undefined {
    return this.stats.get(id);
  }

  /**
   * Get all registered mock IDs.
   */
  getMockIds(): string[] {
    return Array.from(this.mocks.keys());
  }

  /**
   * Get the number of registered mocks.
   */
  getCount(): number {
    return this.mocks.size;
  }

  /**
   * Update the mock manager options.
   */
  setOptions(options: Partial<MockOptions>): void {
    this.options = { ...this.options, ...options };
    this.logger = createLogger({ name: "MockManager", minLevel: this.options.debug ? 2 : 3 });
  }
}

/**
 * Helper function to get the global mock manager instance.
 */
export function getMockManager(options?: MockOptions): MockManager {
  return MockManager.getInstance(options);
}
