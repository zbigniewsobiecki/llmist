import { describe, expect, it, vi } from "vitest";
import { mergeObservers } from "./hook-utils.js";
import type { Observers } from "./hooks.js";

describe("mergeObservers", () => {
  it("should return undefined when both child and parent are undefined", () => {
    const result = mergeObservers(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it("should return child when parent is undefined", () => {
    const child: Observers = {
      onLLMCallStart: vi.fn(),
    };
    const result = mergeObservers(child, undefined);
    expect(result).toBe(child);
  });

  it("should return parent when child is undefined", () => {
    const parent: Observers = {
      onLLMCallComplete: vi.fn(),
    };
    const result = mergeObservers(undefined, parent);
    expect(result).toBe(parent);
  });

  it("should include both hooks when child and parent have non-overlapping hooks", async () => {
    const childFn = vi.fn();
    const parentFn = vi.fn();

    const child: Observers = {
      onLLMCallStart: childFn,
    };
    const parent: Observers = {
      onLLMCallComplete: parentFn,
    };

    const result = mergeObservers(child, parent);

    expect(result).toBeDefined();
    expect(result?.onLLMCallStart).toBe(childFn);
    expect(result?.onLLMCallComplete).toBe(parentFn);
  });

  it("should create a composite function when child and parent have overlapping hooks", async () => {
    const childFn = vi.fn();
    const parentFn = vi.fn();

    const child: Observers = {
      onLLMCallStart: childFn,
    };
    const parent: Observers = {
      onLLMCallStart: parentFn,
    };

    const result = mergeObservers(child, parent);

    expect(result).toBeDefined();
    expect(result?.onLLMCallStart).not.toBe(childFn);
    expect(result?.onLLMCallStart).not.toBe(parentFn);
    expect(typeof result?.onLLMCallStart).toBe("function");

    // Call the composite function and verify both were called
    await (result?.onLLMCallStart as (ctx: unknown) => Promise<void>)({} as never);
    expect(childFn).toHaveBeenCalledTimes(1);
    expect(parentFn).toHaveBeenCalledTimes(1);
  });

  it("should call child before parent for overlapping hooks", async () => {
    const callOrder: string[] = [];

    const child: Observers = {
      onGadgetExecutionStart: async () => {
        await Promise.resolve();
        callOrder.push("child");
      },
    };
    const parent: Observers = {
      onGadgetExecutionStart: async () => {
        await Promise.resolve();
        callOrder.push("parent");
      },
    };

    const result = mergeObservers(child, parent);

    await (result?.onGadgetExecutionStart as (ctx: unknown) => Promise<void>)({} as never);

    expect(callOrder).toEqual(["child", "parent"]);
  });

  it("should handle mixed overlapping and non-overlapping hooks correctly", async () => {
    const childStartFn = vi.fn();
    const parentStartFn = vi.fn();
    const parentCompleteFn = vi.fn();

    const child: Observers = {
      onLLMCallStart: childStartFn,
    };
    const parent: Observers = {
      onLLMCallStart: parentStartFn,
      onLLMCallComplete: parentCompleteFn,
    };

    const result = mergeObservers(child, parent);

    expect(result).toBeDefined();
    // Overlapping hook should be composite
    expect(result?.onLLMCallStart).not.toBe(childStartFn);
    expect(result?.onLLMCallStart).not.toBe(parentStartFn);
    // Non-overlapping hook should be the parent's function directly
    expect(result?.onLLMCallComplete).toBe(parentCompleteFn);

    // Composite should call both
    await (result?.onLLMCallStart as (ctx: unknown) => Promise<void>)({} as never);
    expect(childStartFn).toHaveBeenCalledTimes(1);
    expect(parentStartFn).toHaveBeenCalledTimes(1);
  });

  it("should not include child-only hooks that are undefined in the result", () => {
    const child: Observers = {
      onLLMCallStart: undefined,
    };
    const parent: Observers = {
      onLLMCallComplete: vi.fn(),
    };

    const result = mergeObservers(child, parent);

    expect(result).toBeDefined();
    expect(result?.onLLMCallStart).toBeUndefined();
    expect(result?.onLLMCallComplete).toBeDefined();
  });
});
