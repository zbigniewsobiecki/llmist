/**
 * Shared safeObserve utility for consistent observer error handling across the agent module.
 *
 * Observers are non-critical — errors should be logged but must not crash the system.
 */

import type { ILogObj, Logger } from "tslog";

/**
 * Safely execute an observer function, catching and logging any errors.
 * Observers are non-critical, so errors are logged but don't crash the system.
 *
 * @param fn - The observer function to execute
 * @param logger - Logger instance for error reporting
 * @param label - Optional label for contextualizing the error message
 */
export async function safeObserve(
  fn: () => void | Promise<void>,
  logger: Logger<ILogObj>,
  label?: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = label ? `Observer error in ${label}:` : "Observer threw error (ignoring)";
    logger.error(message, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
