import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { humanDelay, randomDelay, timing, withRetry, withTimeout } from "./timing.js";

describe("randomDelay", () => {
  it("returns value within range", () => {
    for (let i = 0; i < 100; i++) {
      const result = randomDelay(50, 150);
      expect(result).toBeGreaterThanOrEqual(50);
      expect(result).toBeLessThanOrEqual(150);
    }
  });

  it("returns integer values", () => {
    for (let i = 0; i < 10; i++) {
      const result = randomDelay(1, 100);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it("handles equal min and max", () => {
    expect(randomDelay(100, 100)).toBe(100);
  });

  it("handles zero values", () => {
    expect(randomDelay(0, 0)).toBe(0);
    const result = randomDelay(0, 10);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe("humanDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays within default range", async () => {
    const promise = humanDelay();

    // Should not resolve immediately
    await vi.advanceTimersByTimeAsync(49);
    expect(vi.getTimerCount()).toBe(1);

    // Should resolve after max time
    await vi.advanceTimersByTimeAsync(102);
    await expect(promise).resolves.toBeUndefined();
  });

  it("delays within custom range", async () => {
    const promise = humanDelay(100, 200);

    // Should not resolve before min
    await vi.advanceTimersByTimeAsync(99);
    expect(vi.getTimerCount()).toBe(1);

    // Should resolve after max
    await vi.advanceTimersByTimeAsync(102);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves if function completes before timeout", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const promise = withTimeout(fn, 1000);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("success");
  });

  it("rejects with timeout error if function takes too long", async () => {
    const fn = () => new Promise((resolve) => setTimeout(resolve, 2000));

    let caughtError: Error | null = null;
    const promise = withTimeout(fn, 1000).catch((e) => {
      caughtError = e;
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(caughtError?.message).toBe("Operation timed out after 1000ms");
  });

  it("rejects if function throws before timeout", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Function error"));

    let caughtError: Error | null = null;
    const promise = withTimeout(fn, 1000).catch((e) => {
      caughtError = e;
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(caughtError?.message).toBe("Function error");
  });

  it("rejects immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn().mockResolvedValue("success");
    const promise = withTimeout(fn, 1000, controller.signal);

    await expect(promise).rejects.toThrow("Operation aborted");
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects when signal is aborted during execution", async () => {
    const controller = new AbortController();
    const fn = () => new Promise((resolve) => setTimeout(resolve, 5000));

    const promise = withTimeout(fn, 10000, controller.signal);

    // Abort after 500ms
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();

    await expect(promise).rejects.toThrow("Operation aborted");
  });

  it("clears timeout after successful completion", async () => {
    const fn = vi.fn().mockResolvedValue("done");

    const promise = withTimeout(fn, 1000);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const promise = withRetry(fn);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

    const promise = withRetry(fn, { delay: 100 });

    // First call fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    // Use catch to avoid unhandled rejection warning
    let caughtError: Error | null = null;
    const promise = withRetry(fn, { maxRetries: 2, delay: 100 }).catch((e) => {
      caughtError = e;
    });

    // Attempt 0, 1, 2 (3 total attempts with maxRetries: 2)
    await vi.runAllTimersAsync();
    await promise;

    expect(caughtError?.message).toBe("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff by default", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const onRetry = vi.fn();

    let rejected = false;
    const promise = withRetry(fn, { maxRetries: 3, delay: 100, onRetry }).catch(() => {
      rejected = true;
    });

    await vi.runAllTimersAsync();
    await promise;

    // Check onRetry was called with increasing delays
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 200);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 3, 400);
    expect(rejected).toBe(true);
  });

  it("uses linear backoff when specified", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const onRetry = vi.fn();

    let rejected = false;
    const promise = withRetry(fn, {
      maxRetries: 3,
      delay: 100,
      backoff: "linear",
      onRetry,
    }).catch(() => {
      rejected = true;
    });

    await vi.runAllTimersAsync();
    await promise;

    // Linear: 100, 200, 300
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 200);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 3, 300);
    expect(rejected).toBe(true);
  });

  it("respects maxDelay cap", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const onRetry = vi.fn();

    let rejected = false;
    const promise = withRetry(fn, {
      maxRetries: 5,
      delay: 1000,
      maxDelay: 2000,
      onRetry,
    }).catch(() => {
      rejected = true;
    });

    await vi.runAllTimersAsync();
    await promise;

    // Delays should be capped at 2000
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 1000);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 2000); // capped
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 3, 2000); // capped
    expect(rejected).toBe(true);
  });

  it("respects shouldRetry predicate", async () => {
    class HttpError extends Error {
      status: number;
      constructor(status: number) {
        super(`HTTP ${status}`);
        this.status = status;
      }
    }

    const fn = vi.fn().mockRejectedValue(new HttpError(400));

    let caughtError: Error | null = null;
    const promise = withRetry(fn, {
      maxRetries: 3,
      shouldRetry: (error: unknown) => {
        const e = error as HttpError;
        return e.status >= 500;
      },
    }).catch((e) => {
      caughtError = e;
    });

    await vi.runAllTimersAsync();
    await promise;

    // Should not retry 400 errors
    expect(caughtError?.message).toBe("HTTP 400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries when shouldRetry returns true", async () => {
    class HttpError extends Error {
      status: number;
      constructor(status: number) {
        super(`HTTP ${status}`);
        this.status = status;
      }
    }

    const fn = vi.fn().mockRejectedValueOnce(new HttpError(503)).mockResolvedValue("success");

    const promise = withRetry(fn, {
      delay: 100,
      shouldRetry: (error: unknown) => {
        const e = error as HttpError;
        return e.status >= 500;
      },
    });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry callback with correct arguments", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("first")).mockResolvedValue("success");

    const onRetry = vi.fn();
    const promise = withRetry(fn, { delay: 100, onRetry });

    await vi.runAllTimersAsync();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);

    await expect(promise).resolves.toBe("success");
  });
});

describe("timing namespace", () => {
  it("exports all timing functions", () => {
    expect(timing.randomDelay).toBe(randomDelay);
    expect(timing.humanDelay).toBe(humanDelay);
    expect(timing.withTimeout).toBe(withTimeout);
    expect(timing.withRetry).toBe(withRetry);
  });
});
