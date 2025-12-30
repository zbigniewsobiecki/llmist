/**
 * Timing utilities for gadget authors.
 *
 * Provides common timing functions for:
 * - Random delays (human-like timing)
 * - Timeout handling
 * - Retry logic with backoff
 *
 * @module utils/timing
 *
 * @example
 * ```typescript
 * import { timing } from "llmist";
 *
 * // Human-like delays for browser automation
 * await timing.humanDelay(50, 150);
 *
 * // Add timeout to async operations
 * const result = await timing.withTimeout(
 *   () => fetchData(),
 *   5000,
 *   signal
 * );
 *
 * // Retry with exponential backoff
 * const data = await timing.withRetry(
 *   () => unreliableApi(),
 *   { maxRetries: 3, delay: 1000, backoff: "exponential" }
 * );
 * ```
 */

/**
 * Generate a random delay within a range.
 *
 * @param min - Minimum delay in milliseconds
 * @param max - Maximum delay in milliseconds
 * @returns Random integer between min and max (inclusive)
 *
 * @example
 * ```typescript
 * const delay = randomDelay(50, 150);  // e.g., 87
 * ```
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a random duration (for human-like timing).
 *
 * Useful for browser automation to appear more human-like.
 *
 * @param min - Minimum delay in milliseconds (default: 50)
 * @param max - Maximum delay in milliseconds (default: 150)
 * @returns Promise that resolves after the random delay
 *
 * @example
 * ```typescript
 * // Default human-like delay (50-150ms)
 * await humanDelay();
 *
 * // Custom range for slower actions
 * await humanDelay(100, 300);
 * ```
 */
export async function humanDelay(min = 50, max = 150): Promise<void> {
  const delay = randomDelay(min, max);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Execute an async function with a timeout.
 *
 * @param fn - Async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param signal - Optional AbortSignal for early cancellation
 * @returns Promise that resolves with the function result or rejects on timeout
 * @throws Error with "Operation timed out" message if timeout is exceeded
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   () => fetch("https://api.example.com/data"),
 *   5000
 * );
 *
 * // With abort signal
 * const controller = new AbortController();
 * const result = await withTimeout(
 *   () => longRunningTask(),
 *   30000,
 *   controller.signal
 * );
 * ```
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Check if already aborted
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    let settled = false;

    // Handle external abort - use { once: true } to auto-remove on fire
    const abortHandler = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error("Operation aborted"));
      }
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener("abort", abortHandler);
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    fn()
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", abortHandler);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          signal?.removeEventListener("abort", abortHandler);
          reject(error);
        }
      });
  });
}

/**
 * Options for retry logic.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds (default: 1000) */
  delay?: number;
  /** Backoff strategy: "linear" adds delay, "exponential" doubles it (default: "exponential") */
  backoff?: "linear" | "exponential";
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Optional function to determine if error is retryable (default: all errors) */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional callback on each retry attempt */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

/**
 * Execute an async function with retry logic.
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Promise that resolves with the function result or rejects after all retries exhausted
 *
 * @example
 * ```typescript
 * // Basic retry with defaults (3 retries, exponential backoff)
 * const result = await withRetry(() => unreliableApi());
 *
 * // Custom retry configuration
 * const result = await withRetry(
 *   () => fetchWithErrors(),
 *   {
 *     maxRetries: 5,
 *     delay: 500,
 *     backoff: "exponential",
 *     shouldRetry: (error) => error.status === 429 || error.status >= 500,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms`);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    delay = 1000,
    backoff = "exponential",
    maxDelay = 30000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: unknown;
  let currentDelay = delay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate delay for next attempt
      const waitTime = Math.min(currentDelay, maxDelay);

      // Call onRetry callback
      onRetry?.(error, attempt + 1, waitTime);

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Update delay for next iteration
      if (backoff === "exponential") {
        currentDelay *= 2;
      } else {
        currentDelay += delay;
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Timing namespace object for convenient access.
 *
 * @example
 * ```typescript
 * import { timing } from "llmist";
 *
 * await timing.humanDelay();
 * const result = await timing.withTimeout(() => fetch(url), 5000);
 * const data = await timing.withRetry(() => api.call(), { maxRetries: 3 });
 * ```
 */
export const timing = {
  randomDelay,
  humanDelay,
  withTimeout,
  withRetry,
} as const;
