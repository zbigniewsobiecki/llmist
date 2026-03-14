import type { MockTUIApp } from "@llmist/testing";
import { createMockTUIApp } from "@llmist/testing";
import type { AgentHooks, LLMist } from "llmist";
import { isAbortError } from "llmist";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeAgent } from "./agent-command.js";
import type { CLIEnvironment } from "./environment.js";
import type { CLIAgentOptions } from "./option-helpers.js";
import { TUIApp } from "./tui/index.js";

vi.mock("./tui/index.js", () => ({
  TUIApp: {
    create: vi.fn(),
  },
  StatusBar: {
    estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
  },
}));

let lastBuilderInstance: any;

vi.mock("llmist", async (importOriginal) => {
  const mod = await importOriginal<any>();
  const originalAgentBuilder = mod.AgentBuilder;

  // Create a wrapper that captures the hooks
  class MockAgentBuilder extends originalAgentBuilder {
    constructor(client: LLMist) {
      super(client);
      lastBuilderInstance = this;
      vi.spyOn(this, "withHooks");
      vi.spyOn(this, "ask").mockImplementation(() => {
        return {
          run: async function* () {
            // Mock run that does nothing
          },
          getTree: () => ({
            onAll: vi.fn(() => () => {}),
          }),
        } as any;
      });
    }
  }

  return {
    ...mod,
    AgentBuilder: MockAgentBuilder,
  };
});

describe("executeAgent Rate Limit and Retry Hooks", () => {
  let mockTUI: MockTUIApp;
  let capturedHooks: AgentHooks;

  beforeEach(async () => {
    mockTUI = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTUI as any);

    // Mock waitForPrompt to break the loop immediately
    mockTUI.waitForPrompt.mockImplementation(async () => {
      const error = new Error("Abort");
      (error as any).name = "AbortError";
      throw error;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupAndGetHooks() {
    const mockClient = {
      modelRegistry: {
        getModelSpec: () => ({}),
        getModelLimits: () => ({}),
      },
      createLogger: () => ({}),
    } as unknown as LLMist;

    const env = {
      createClient: () => mockClient,
      stdin: { isTTY: true, on: vi.fn(), removeListener: vi.fn(), resume: vi.fn(), pause: vi.fn() },
      stdout: { isTTY: true, write: vi.fn() },
      stderr: { isTTY: true, write: vi.fn() },
      createLogger: () => ({
        getSubLogger: () => ({
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }),
      }),
    } as unknown as CLIEnvironment;

    const options = {
      model: "test-model",
      maxIterations: 1,
      builtins: false,
    } as unknown as CLIAgentOptions;

    try {
      await executeAgent("test prompt", options, env);
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }

    const builderInstance = lastBuilderInstance;
    capturedHooks = vi.mocked(builderInstance.withHooks).mock.calls[0][0];
    return capturedHooks;
  }

  test("onRateLimitThrottle calls tui.showThrottling and tui.addSystemMessage with stats", async () => {
    const hooks = await setupAndGetHooks();
    const onRateLimitThrottle = hooks.observers!.onRateLimitThrottle!;

    const context = {
      delayMs: 5000,
      stats: {
        rpm: 10,
        tpm: 50000,
        triggeredBy: {
          rpm: { current: 11, limit: 10 },
        },
      },
    };

    await onRateLimitThrottle(context);

    expect(mockTUI.showThrottling).toHaveBeenCalledWith(5000, context.stats.triggeredBy);
    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit approaching (10 RPM, 50K TPM), waiting 5s..."),
      "throttle",
    );
  });

  test("onRateLimitThrottle handles daily limit message", async () => {
    const hooks = await setupAndGetHooks();
    const onRateLimitThrottle = hooks.observers!.onRateLimitThrottle!;

    const context = {
      delayMs: 60000,
      stats: {
        rpm: 0,
        tpm: 0,
        triggeredBy: {
          daily: { current: 1000000, limit: 1000000, resetMs: 60000 },
        },
      },
    };

    await onRateLimitThrottle(context);

    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining(
        "Daily token limit reached (1000K/1000K), waiting until midnight UTC...",
      ),
      "throttle",
    );
  });

  test("onRetryAttempt calls tui.showRetry and tui.addSystemMessage", async () => {
    const hooks = await setupAndGetHooks();
    const onRetryAttempt = hooks.observers!.onRetryAttempt!;

    const context = {
      attemptNumber: 2,
      retriesLeft: 1,
      retryAfterMs: 3000,
    };

    await onRetryAttempt(context);

    expect(mockTUI.showRetry).toHaveBeenCalledWith(2, 1);
    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("attempt 2/3"),
      "retry",
    );
    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("server requested 3s wait"),
      "retry",
    );
  });

  test("onRateLimitThrottle auto-clears throttling indicator after delay", async () => {
    vi.useFakeTimers();
    const hooks = await setupAndGetHooks();
    const onRateLimitThrottle = hooks.observers!.onRateLimitThrottle!;

    const context = {
      delayMs: 2000,
      stats: { rpm: 0, tpm: 0 },
    };

    await onRateLimitThrottle(context);

    expect(mockTUI.clearThrottling).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    expect(mockTUI.clearThrottling).toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("onLLMCallComplete clears retry indicator", async () => {
    const hooks = await setupAndGetHooks();
    const onLLMCallComplete = hooks.observers!.onLLMCallComplete!;

    await onLLMCallComplete({ usage: {} });

    expect(mockTUI.clearRetry).toHaveBeenCalled();
  });
});
