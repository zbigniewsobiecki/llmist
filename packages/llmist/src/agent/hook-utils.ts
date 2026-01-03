/**
 * Utility functions for hook manipulation.
 */

import type { Observers } from "./hooks.js";

/**
 * Merge two observer objects into one.
 * When both have the same hook, creates a composite that calls both.
 * Child observers are called first, then parent observers.
 *
 * This enables proper observer inheritance in subagent chains:
 * - Parent agent defines onGadgetExecutionStart for tracking
 * - Subagent defines onLLMCallReady for page state refresh
 * - Both should work together, not replace each other
 *
 * @param child - Child agent's observers (called first)
 * @param parent - Parent agent's observers (called after child)
 * @returns Merged observers object, or undefined if both are undefined
 */
export function mergeObservers(child?: Observers, parent?: Observers): Observers | undefined {
  if (!child && !parent) return undefined;
  if (!child) return parent;
  if (!parent) return child;

  // Start with parent's observers as base
  const merged: Observers = { ...parent };

  // For each key in child, either add it or create composite
  for (const key of Object.keys(child) as (keyof Observers)[]) {
    const childFn = child[key];
    const parentFn = parent[key];

    if (!childFn) continue;

    if (!parentFn) {
      // Only child has this hook - use it directly
      (merged as Record<string, unknown>)[key] = childFn;
    } else {
      // Both have this hook - create composite that calls both
      // Child runs first (can modify state), parent runs after (for logging/tracking)
      (merged as Record<string, unknown>)[key] = async (ctx: unknown) => {
        await (childFn as (ctx: unknown) => void | Promise<void>)(ctx);
        await (parentFn as (ctx: unknown) => void | Promise<void>)(ctx);
      };
    }
  }

  return merged;
}
