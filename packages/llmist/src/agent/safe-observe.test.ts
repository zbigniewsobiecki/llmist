import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import { safeObserve } from "./safe-observe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    trace: vi.fn(() => {}),
    fatal: vi.fn(() => {}),
    silly: vi.fn(() => {}),
  } as unknown as Logger<ILogObj>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("safeObserve", () => {
  // =========================================================================
  // Success path
  // =========================================================================

  describe("success cases", () => {
    it("should call the observer function and resolve", async () => {
      const logger = createMockLogger();
      const fn = vi.fn().mockResolvedValue(undefined);

      await safeObserve(fn, logger);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should call a synchronous observer function", async () => {
      const logger = createMockLogger();
      const calls: string[] = [];
      const fn = vi.fn(() => {
        calls.push("called");
      });

      await safeObserve(fn, logger);

      expect(calls).toEqual(["called"]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should call an async observer function and await it", async () => {
      const logger = createMockLogger();
      const calls: string[] = [];

      const fn = vi.fn(async () => {
        await Promise.resolve();
        calls.push("async-called");
      });

      await safeObserve(fn, logger);

      expect(calls).toEqual(["async-called"]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should resolve to void (no return value)", async () => {
      const logger = createMockLogger();
      const result = await safeObserve(() => {}, logger);

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    it("should catch synchronous errors and log them", async () => {
      const logger = createMockLogger();
      const error = new Error("sync error");
      const fn = vi.fn(() => {
        throw error;
      });

      await expect(safeObserve(fn, logger)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("should catch async errors and log them", async () => {
      const logger = createMockLogger();
      const fn = vi.fn(async () => {
        throw new Error("async error");
      });

      await expect(safeObserve(fn, logger)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("should log error message when Error instance is thrown", async () => {
      const logger = createMockLogger();
      const error = new Error("something went wrong");

      await safeObserve(() => {
        throw error;
      }, logger);

      expect(logger.error).toHaveBeenCalledWith(
        "Observer threw error (ignoring)",
        expect.objectContaining({ error: "something went wrong" }),
      );
    });

    it("should convert non-Error thrown values to string", async () => {
      const logger = createMockLogger();

      await safeObserve(() => {
        throw "string error"; // eslint-disable-line no-throw-literal
      }, logger);

      expect(logger.error).toHaveBeenCalledWith(
        "Observer threw error (ignoring)",
        expect.objectContaining({ error: "string error" }),
      );
    });

    it("should convert thrown numbers to string", async () => {
      const logger = createMockLogger();

      await safeObserve(() => {
        throw 42; // eslint-disable-line no-throw-literal
      }, logger);

      expect(logger.error).toHaveBeenCalledWith(
        "Observer threw error (ignoring)",
        expect.objectContaining({ error: "42" }),
      );
    });

    it("should not rethrow the error", async () => {
      const logger = createMockLogger();

      // Should resolve cleanly, not reject
      await expect(
        safeObserve(() => {
          throw new Error("do not rethrow");
        }, logger),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Label behavior
  // =========================================================================

  describe("label parameter", () => {
    it("should use default message when no label is provided", async () => {
      const logger = createMockLogger();

      await safeObserve(() => {
        throw new Error("oops");
      }, logger);

      expect(logger.error).toHaveBeenCalledWith(
        "Observer threw error (ignoring)",
        expect.any(Object),
      );
    });

    it("should include label in error message when provided", async () => {
      const logger = createMockLogger();

      await safeObserve(
        () => {
          throw new Error("oops");
        },
        logger,
        "myHook",
      );

      expect(logger.error).toHaveBeenCalledWith("Observer error in myHook:", expect.any(Object));
    });

    it("should include the label but not the message without label in the context", async () => {
      const logger = createMockLogger();

      await safeObserve(
        () => {
          throw new Error("detailed error");
        },
        logger,
        "onGadgetComplete",
      );

      const [logMessage, logContext] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(logMessage).toBe("Observer error in onGadgetComplete:");
      expect(logContext).toEqual({ error: "detailed error" });
    });

    it("should not use label message when label is undefined", async () => {
      const logger = createMockLogger();

      await safeObserve(
        () => {
          throw new Error("err");
        },
        logger,
        undefined,
      );

      const [logMessage] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(logMessage).toBe("Observer threw error (ignoring)");
    });
  });

  // =========================================================================
  // Sequential execution
  // =========================================================================

  describe("sequential execution", () => {
    it("should await the observer before returning", async () => {
      const logger = createMockLogger();
      const order: string[] = [];

      await safeObserve(async () => {
        order.push("observer-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("observer-end");
      }, logger);

      order.push("after-safe-observe");

      expect(order).toEqual(["observer-start", "observer-end", "after-safe-observe"]);
    });

    it("should be callable multiple times for different observers", async () => {
      const logger = createMockLogger();
      const calls: string[] = [];

      await safeObserve(() => calls.push("first"), logger, "first");
      await safeObserve(() => calls.push("second"), logger, "second");
      await safeObserve(() => calls.push("third"), logger, "third");

      expect(calls).toEqual(["first", "second", "third"]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should handle error in first call and still allow subsequent calls to succeed", async () => {
      const logger = createMockLogger();
      const calls: string[] = [];

      await safeObserve(() => {
        throw new Error("first fails");
      }, logger);

      await safeObserve(() => calls.push("second succeeds"), logger);

      expect(calls).toEqual(["second succeeds"]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
