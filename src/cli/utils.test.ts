import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { ModelRegistry } from "../core/model-registry.js";
import { StreamProgress, createEscKeyListener, createSigintListener } from "./utils.js";
import { formatCost } from "./ui/formatters.js";

/**
 * Mock writable stream that captures output for testing.
 */
class MockWritableStream extends Writable {
  public output = "";

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = "";
  }
}

/**
 * Mock model registry for testing cost calculations.
 */
class MockModelRegistry implements Partial<ModelRegistry> {
  private costs: Record<string, { inputCost: number; outputCost: number }> = {};
  private shouldThrow = false;

  setCost(model: string, inputCost: number, outputCost: number): void {
    this.costs[model] = { inputCost, outputCost };
  }

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ):
    | { inputCost: number; outputCost: number; totalCost: number }
    | undefined {
    if (this.shouldThrow) {
      throw new Error("Model not found");
    }

    const costs = this.costs[model];
    if (!costs) {
      return undefined;
    }

    const inputCost = (inputTokens / 1_000_000) * costs.inputCost;
    const outputCost = (outputTokens / 1_000_000) * costs.outputCost;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }
}

describe("StreamProgress", () => {
  describe("cost formatting", () => {
    test("formats very small costs with 5 decimal places", () => {
      // Now testing the formatCost function from formatters.ts
      expect(formatCost(0.00001)).toBe("0.00001");
      expect(formatCost(0.0005)).toBe("0.00050");
      expect(formatCost(0.00099)).toBe("0.00099");
    });

    test("formats small costs with 4 decimal places", () => {
      expect(formatCost(0.001)).toBe("0.0010");
      expect(formatCost(0.005)).toBe("0.0050");
      expect(formatCost(0.0099)).toBe("0.0099");
    });

    test("formats medium costs with 3 decimal places", () => {
      expect(formatCost(0.01)).toBe("0.010");
      expect(formatCost(0.123)).toBe("0.123");
      expect(formatCost(0.999)).toBe("0.999");
    });

    test("formats large costs with 2 decimal places", () => {
      expect(formatCost(1.0)).toBe("1.00");
      expect(formatCost(5.5)).toBe("5.50");
      expect(formatCost(123.456)).toBe("123.46");
    });
  });

  describe("cost calculation", () => {
    test("accumulates costs across multiple calls", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60); // $30/1M input, $60/1M output

      const progress = new StreamProgress(stream, false, registry as any);

      // First call: 1000 input, 500 output tokens
      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Second call: 2000 input, 1000 output tokens
      progress.startCall("gpt-4", 2000);
      progress.endCall({ inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 });

      // Expected costs:
      // Call 1: (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      // Call 2: (2000/1M * $30) + (1000/1M * $60) = $0.06 + $0.06 = $0.12
      // Total: $0.18

      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBeCloseTo(0.18, 5);
    });

    test("handles missing model registry gracefully", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false); // No registry

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Should not throw and cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("handles unknown model gracefully", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // Use a model not in the registry
      progress.startCall("unknown-model", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Should not throw and cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("handles model registry errors gracefully", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setShouldThrow(true);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      // Should not throw even when registry throws
      expect(() => {
        progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      }).not.toThrow();

      // Cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("does not calculate cost when usage is missing", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      progress.endCall(); // No usage provided

      // Cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });
  });

  describe("cost display", () => {
    test("includes cost in formatPrompt when cost > 0", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = progress.formatPrompt();
      expect(prompt).toContain("$"); // Cost should be displayed
      expect(prompt).toMatch(/\$0\.0\d+/); // Should match cost format
    });

    test("does not include cost in formatPrompt when cost = 0", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false); // No registry

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = progress.formatPrompt();
      expect(prompt).not.toContain("$"); // Cost should not be displayed
    });

    test("displays cost in cumulative mode with proper formatting", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 10, 20);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = progress.formatPrompt();
      // Cost should be displayed between separators (using | not │)
      expect(prompt).toMatch(/\|.*\$\d+\.\d+.*\|/); // Cost between separators
      // Verify the actual cost value
      expect(prompt).toContain("$0.020");
    });
  });

  describe("integration", () => {
    test("tracks tokens and costs together correctly", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // Make multiple calls with different token counts
      progress.startCall("gpt-4", 500);
      progress.endCall({ inputTokens: 500, outputTokens: 250, totalTokens: 750 });

      progress.startCall("gpt-4", 1500);
      progress.endCall({ inputTokens: 1500, outputTokens: 750, totalTokens: 2250 });

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Verify total tokens
      const totalTokens = (progress as any).totalTokens;
      expect(totalTokens).toBe(750 + 2250 + 1500); // 4500

      // Verify total cost
      // Call 1: (500/1M * $30) + (250/1M * $60) = $0.015 + $0.015 = $0.03
      // Call 2: (1500/1M * $30) + (750/1M * $60) = $0.045 + $0.045 = $0.09
      // Call 3: (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      // Total: $0.18
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBeCloseTo(0.18, 5);

      // Verify iterations
      const iterations = (progress as any).iterations;
      expect(iterations).toBe(3);
    });

    test("resets state correctly for new call in streaming mode", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // First call
      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Second call with different model
      progress.startCall("gpt-3.5-turbo", 500);

      // Verify call state was reset
      const model = (progress as any).model;
      expect(model).toBe("gpt-3.5-turbo");

      const callInputTokens = (progress as any).callInputTokens;
      expect(callInputTokens).toBe(500);

      // But cumulative stats should be preserved
      const totalTokens = (progress as any).totalTokens;
      expect(totalTokens).toBe(1500); // From first call
    });

    test("uses real counts when available, not estimates", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // Start call with initial token count
      progress.startCall("gpt-4", 1000);

      // Simulate receiving real input tokens from provider (not estimated)
      progress.setInputTokens(896, false);

      // Simulate streaming output
      progress.update(500); // 500 chars

      // Simulate receiving real output tokens from provider (not estimated)
      progress.setOutputTokens(118, false);

      const prompt = progress.formatPrompt();

      // Should NOT contain ~ since we have real counts
      expect(prompt).not.toContain("~");
      // Should contain the real token counts
      expect(prompt).toContain("896");
      expect(prompt).toContain("118");
    });
  });
});

/**
 * Mock readable stream that simulates stdin with TTY capabilities.
 * Extends EventEmitter to support on/removeListener for data events.
 */
class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = mock(() => this);
  resume = mock(() => this);
  pause = mock(() => this);

  /**
   * Simulates pressing a key by emitting a data event with the key's byte sequence.
   */
  pressKey(bytes: number[]): void {
    this.emit("data", Buffer.from(bytes));
  }
}

describe("createEscKeyListener", () => {
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;
  let timeoutCallbacks: Map<number, () => void>;
  let timeoutCounter: number;

  beforeEach(() => {
    // Store original timer functions
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    timeoutCallbacks = new Map();
    timeoutCounter = 0;

    // Mock setTimeout to capture callbacks
    globalThis.setTimeout = ((callback: () => void, _delay?: number) => {
      const id = ++timeoutCounter;
      timeoutCallbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    // Mock clearTimeout to remove callbacks
    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      timeoutCallbacks.delete(id as unknown as number);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    // Restore original timer functions
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  /**
   * Manually fire all pending timeouts (simulates time passing).
   */
  function flushTimeouts(): void {
    for (const callback of timeoutCallbacks.values()) {
      callback();
    }
    timeoutCallbacks.clear();
  }

  describe("TTY detection", () => {
    test("returns null when stdin is not a TTY", () => {
      const stdin = new MockStdin();
      stdin.isTTY = false;

      const onEsc = mock();
      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      expect(cleanup).toBeNull();
      expect(stdin.setRawMode).not.toHaveBeenCalled();
    });

    test("returns null when setRawMode is not a function", () => {
      const stdin = {
        isTTY: true,
        setRawMode: undefined, // Missing setRawMode function
        resume: mock(),
        on: mock(),
      };

      const onEsc = mock();
      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      expect(cleanup).toBeNull();
    });

    test("returns cleanup function when stdin is valid TTY", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      expect(cleanup).toBeInstanceOf(Function);
      expect(stdin.setRawMode).toHaveBeenCalledWith(true);
      expect(stdin.resume).toHaveBeenCalled();

      // Clean up
      cleanup?.();
    });
  });

  describe("ESC key detection", () => {
    test("calls onEsc callback when standalone ESC key is pressed", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press ESC (0x1B) as a single byte
      stdin.pressKey([0x1b]);

      // Callback should not be called immediately (timeout not fired yet)
      expect(onEsc).not.toHaveBeenCalled();

      // Fire the timeout
      flushTimeouts();

      // Now callback should be called
      expect(onEsc).toHaveBeenCalledTimes(1);

      cleanup?.();
    });

    test("does NOT call onEsc when escape sequence is detected (arrow key up)", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press up arrow: ESC [ A (0x1B 0x5B 0x41) - arrives as multi-byte sequence
      stdin.pressKey([0x1b, 0x5b, 0x41]);

      // Fire any pending timeouts
      flushTimeouts();

      // Callback should NOT be called because it was part of escape sequence
      expect(onEsc).not.toHaveBeenCalled();

      cleanup?.();
    });

    test("does NOT call onEsc when another key arrives after ESC", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press ESC alone
      stdin.pressKey([0x1b]);
      expect(timeoutCallbacks.size).toBe(1);

      // Then press 'a' before timeout fires
      stdin.pressKey([0x61]);

      // Timeout should have been cancelled
      expect(timeoutCallbacks.size).toBe(0);

      // Fire any remaining timeouts (should be none)
      flushTimeouts();

      // Callback should NOT be called
      expect(onEsc).not.toHaveBeenCalled();

      cleanup?.();
    });

    test("handles multiple standalone ESC presses", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // First ESC
      stdin.pressKey([0x1b]);
      flushTimeouts();

      // Second ESC
      stdin.pressKey([0x1b]);
      flushTimeouts();

      // Both should trigger
      expect(onEsc).toHaveBeenCalledTimes(2);

      cleanup?.();
    });
  });

  describe("cleanup function", () => {
    test("removes data listener from stdin", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Verify listener was added
      expect(stdin.listenerCount("data")).toBe(1);

      // Run cleanup
      cleanup?.();

      // Verify listener was removed
      expect(stdin.listenerCount("data")).toBe(0);
    });

    test("restores raw mode to false", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Raw mode was enabled
      expect(stdin.setRawMode).toHaveBeenCalledWith(true);
      stdin.setRawMode.mockClear();

      // Run cleanup
      cleanup?.();

      // Raw mode should be disabled
      expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    });

    test("pauses stdin", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);
      stdin.pause.mockClear();

      // Run cleanup
      cleanup?.();

      // Stdin should be paused
      expect(stdin.pause).toHaveBeenCalled();
    });

    test("clears pending timeout", () => {
      const stdin = new MockStdin();
      const onEsc = mock();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press ESC to start a timeout
      stdin.pressKey([0x1b]);
      expect(timeoutCallbacks.size).toBe(1);

      // Run cleanup before timeout fires
      cleanup?.();

      // Timeout should be cleared
      expect(timeoutCallbacks.size).toBe(0);

      // Callback should NOT be called
      expect(onEsc).not.toHaveBeenCalled();
    });
  });
});

describe("createSigintListener", () => {
  // Store original process methods
  let originalProcessOn: typeof process.on;
  let originalProcessRemoveListener: typeof process.removeListener;
  let sigintHandlers: Array<() => void>;
  let mockStderr: MockWritableStream;

  beforeEach(() => {
    // Store originals
    originalProcessOn = process.on;
    originalProcessRemoveListener = process.removeListener;
    sigintHandlers = [];
    mockStderr = new MockWritableStream();

    // Mock process.on to capture SIGINT handlers
    process.on = ((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        sigintHandlers.push(handler);
      }
      return process;
    }) as typeof process.on;

    // Mock process.removeListener to remove SIGINT handlers
    process.removeListener = ((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        const index = sigintHandlers.indexOf(handler);
        if (index !== -1) {
          sigintHandlers.splice(index, 1);
        }
      }
      return process;
    }) as typeof process.removeListener;
  });

  afterEach(() => {
    // Restore originals
    process.on = originalProcessOn;
    process.removeListener = originalProcessRemoveListener;
  });

  /**
   * Simulate a SIGINT signal by calling all registered handlers.
   */
  function simulateSigint(): void {
    for (const handler of sigintHandlers) {
      handler();
    }
  }

  describe("operation active behavior", () => {
    test("calls onCancel when operation is active and SIGINT received", () => {
      const onCancel = mock();
      const onQuit = mock();
      const isOperationActive = () => true;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      simulateSigint();

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onQuit).not.toHaveBeenCalled();

      cleanup();
    });

    test("does NOT call onQuit when operation is active (even on double press)", () => {
      const onCancel = mock();
      const onQuit = mock();
      const isOperationActive = () => true;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // First SIGINT
      simulateSigint();
      // Second SIGINT immediately
      simulateSigint();

      expect(onCancel).toHaveBeenCalledTimes(2);
      expect(onQuit).not.toHaveBeenCalled();

      cleanup();
    });
  });

  describe("operation inactive behavior", () => {
    test("shows hint message when no operation active and first SIGINT", () => {
      const onCancel = mock();
      const onQuit = mock();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      simulateSigint();

      expect(onCancel).not.toHaveBeenCalled();
      expect(onQuit).not.toHaveBeenCalled();
      expect(mockStderr.output).toContain("Press Ctrl+C again to quit");

      cleanup();
    });

    test("calls onQuit on double SIGINT within timeout window", () => {
      const onCancel = mock();
      const onQuit = mock();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // First SIGINT
      simulateSigint();

      // Second SIGINT immediately (within 1 second window)
      simulateSigint();

      expect(onCancel).not.toHaveBeenCalled();
      expect(onQuit).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });

  describe("cleanup function", () => {
    test("removes SIGINT listener", () => {
      const onCancel = mock();
      const onQuit = mock();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // Verify handler was registered
      expect(sigintHandlers.length).toBe(1);

      // Run cleanup
      cleanup();

      // Verify handler was removed
      expect(sigintHandlers.length).toBe(0);
    });

    test("SIGINT has no effect after cleanup", () => {
      const onCancel = mock();
      const onQuit = mock();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);
      cleanup();

      // Simulate SIGINT after cleanup
      simulateSigint();

      // Nothing should happen
      expect(onCancel).not.toHaveBeenCalled();
      expect(onQuit).not.toHaveBeenCalled();
    });
  });

  describe("state transitions", () => {
    test("resets double-press timer after cancelling an operation", () => {
      const onCancel = mock();
      const onQuit = mock();
      let operationActive = true;
      const isOperationActive = () => operationActive;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // First SIGINT while operation active - cancels it
      simulateSigint();
      expect(onCancel).toHaveBeenCalledTimes(1);

      // Operation now inactive
      operationActive = false;

      // Second SIGINT - should show hint (not quit, because timer was reset)
      simulateSigint();
      expect(mockStderr.output).toContain("Press Ctrl+C again to quit");
      expect(onQuit).not.toHaveBeenCalled();

      // Third SIGINT - should quit (double-press)
      simulateSigint();
      expect(onQuit).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });
});
