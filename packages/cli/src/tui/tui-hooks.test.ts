/**
 * Unit tests for createTUIHooks factory.
 *
 * Each observer hook is tested in isolation by calling the returned AgentHooks
 * directly, without spinning up a full agent. The pattern follows the existing
 * agent-command-throttle.test.ts approach.
 */

import type { MockTUIApp } from "@llmist/testing";
import { createMockTUIApp } from "@llmist/testing";
import type { TokenUsage } from "llmist";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ApprovalConfig } from "../approval/index.js";
import type { CLIEnvironment } from "../environment.js";
import { createTUIHooks } from "./tui-hooks.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock StatusBar to avoid blessed screen setup
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./status-bar.js", () => ({
  StatusBar: {
    estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockEnv(options: { stdinTTY?: boolean; stderrTTY?: boolean } = {}): CLIEnvironment {
  const { stdinTTY = true, stderrTTY = true } = options;
  return {
    argv: ["node", "llmist"],
    stdin: { isTTY: stdinTTY } as any,
    stdout: { isTTY: true, write: vi.fn() } as any,
    stderr: { isTTY: stderrTTY, write: vi.fn() } as any,
    createClient: vi.fn() as any,
    setExitCode: vi.fn(),
    createLogger: vi.fn() as any,
    isTTY: stdinTTY,
    prompt: vi.fn() as any,
  };
}

function createDefaultApprovalConfig(): ApprovalConfig {
  return {
    gadgetApprovals: {},
    defaultMode: "allowed",
  };
}

interface SetupOptions {
  tuiEnabled?: boolean;
  gadgetApprovals?: Record<string, "allowed" | "denied" | "approval-required">;
  defaultMode?: "allowed" | "denied" | "approval-required";
  stdinTTY?: boolean;
  stderrTTY?: boolean;
}

function setup(opts: SetupOptions = {}) {
  const {
    tuiEnabled = true,
    gadgetApprovals = {},
    defaultMode = "allowed",
    stdinTTY = true,
    stderrTTY = true,
  } = opts;

  const mockTUI = createMockTUIApp();
  const tui = tuiEnabled ? (mockTUI as unknown as any) : null;
  const env = createMockEnv({ stdinTTY, stderrTTY });
  const iterationsRef = { value: 0 };
  const usageRef: { value: TokenUsage | undefined } = { value: undefined };
  const approvalConfig: ApprovalConfig = { gadgetApprovals, defaultMode };

  const hooks = createTUIHooks({
    tui,
    env,
    gadgetApprovals,
    approvalConfig,
    iterationsRef,
    usageRef,
  });

  return { hooks, mockTUI, tui, env, iterationsRef, usageRef, gadgetApprovals };
}

// ─────────────────────────────────────────────────────────────────────────────
// onLLMCallStart
// ─────────────────────────────────────────────────────────────────────────────

describe("createTUIHooks — onLLMCallStart", () => {
  afterEach(() => vi.restoreAllMocks());

  test("calls tui.showLLMCallStart with iteration + 1", async () => {
    const { hooks, mockTUI, iterationsRef } = setup();
    iterationsRef.value = 2;

    await hooks.observers!.onLLMCallStart!({ iteration: 2 } as any);

    expect(mockTUI.showLLMCallStart).toHaveBeenCalledWith(3);
  });

  test("skips tui call for subagent events", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onLLMCallStart!({
      iteration: 0,
      subagentContext: { parentGadgetInvocationId: "x", depth: 1 },
    } as any);

    expect(mockTUI.showLLMCallStart).not.toHaveBeenCalled();
  });

  test("is a no-op when tui is null", async () => {
    const { hooks } = setup({ tuiEnabled: false });

    // Should not throw
    await expect(
      hooks.observers!.onLLMCallStart!({ iteration: 0 } as any),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onStreamChunk
// ─────────────────────────────────────────────────────────────────────────────

describe("createTUIHooks — onStreamChunk", () => {
  afterEach(() => vi.restoreAllMocks());

  test("calls tui.updateStreamingTokens with estimated token count", async () => {
    const { hooks, mockTUI } = setup();

    // StatusBar.estimateTokens is mocked as text.length / 4 (ceiling)
    await hooks.observers!.onStreamChunk!({
      iteration: 0,
      rawChunk: "",
      accumulatedText: "Hello world!",
    } as any);

    expect(mockTUI.updateStreamingTokens).toHaveBeenCalledWith(3); // ceil(12/4)
  });

  test("skips update for subagent events", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onStreamChunk!({
      iteration: 0,
      rawChunk: "",
      accumulatedText: "text",
      subagentContext: { parentGadgetInvocationId: "x", depth: 1 },
    } as any);

    expect(mockTUI.updateStreamingTokens).not.toHaveBeenCalled();
  });

  test("is a no-op when tui is null", async () => {
    const { hooks } = setup({ tuiEnabled: false });

    await expect(
      hooks.observers!.onStreamChunk!({ iteration: 0, rawChunk: "", accumulatedText: "hi" } as any),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onLLMCallComplete
// ─────────────────────────────────────────────────────────────────────────────

describe("createTUIHooks — onLLMCallComplete", () => {
  afterEach(() => vi.restoreAllMocks());

  test("updates usageRef with context usage", async () => {
    const { hooks, usageRef } = setup();
    const usage: TokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

    await hooks.observers!.onLLMCallComplete!({ iteration: 0, usage } as any);

    expect(usageRef.value).toEqual(usage);
  });

  test("updates iterationsRef to max(current, iteration + 1)", async () => {
    const { hooks, iterationsRef } = setup();
    iterationsRef.value = 1;

    await hooks.observers!.onLLMCallComplete!({ iteration: 2, usage: undefined } as any);

    expect(iterationsRef.value).toBe(3);
  });

  test("does not decrease iterationsRef when iteration + 1 is lower than current", async () => {
    const { hooks, iterationsRef } = setup();
    iterationsRef.value = 5;

    await hooks.observers!.onLLMCallComplete!({ iteration: 1, usage: undefined } as any);

    expect(iterationsRef.value).toBe(5);
  });

  test("calls tui.clearRetry on successful completion", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onLLMCallComplete!({ iteration: 0, usage: undefined } as any);

    expect(mockTUI.clearRetry).toHaveBeenCalled();
  });

  test("skips tui.clearRetry for subagent events", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onLLMCallComplete!({
      iteration: 0,
      usage: undefined,
      subagentContext: { parentGadgetInvocationId: "x", depth: 1 },
    } as any);

    expect(mockTUI.clearRetry).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onRateLimitThrottle
// ─────────────────────────────────────────────────────────────────────────────

describe("createTUIHooks — onRateLimitThrottle", () => {
  afterEach(() => vi.restoreAllMocks());

  test("calls showThrottling with delayMs and triggeredBy", async () => {
    const { hooks, mockTUI } = setup();
    const triggeredBy = { rpm: { current: 11, limit: 10 } };

    await hooks.observers!.onRateLimitThrottle!({
      delayMs: 5000,
      stats: { rpm: 10, tpm: 50000, triggeredBy },
    } as any);

    expect(mockTUI.showThrottling).toHaveBeenCalledWith(5000, triggeredBy);
  });

  test("shows RPM/TPM rate limit message", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRateLimitThrottle!({
      delayMs: 5000,
      stats: { rpm: 10, tpm: 50000, triggeredBy: { rpm: { current: 11, limit: 10 } } },
    } as any);

    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit approaching (10 RPM, 50K TPM), waiting 5s..."),
      "throttle",
    );
  });

  test("shows daily limit message with token counts", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRateLimitThrottle!({
      delayMs: 60000,
      stats: {
        rpm: 0,
        tpm: 0,
        triggeredBy: { daily: { current: 1000000, limit: 1000000, resetMs: 60000 } },
      },
    } as any);

    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining(
        "Daily token limit reached (1000K/1000K), waiting until midnight UTC...",
      ),
      "throttle",
    );
  });

  test("auto-clears throttling indicator after delayMs", async () => {
    vi.useFakeTimers();
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRateLimitThrottle!({
      delayMs: 2000,
      stats: { rpm: 0, tpm: 0 },
    } as any);

    expect(mockTUI.clearThrottling).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(mockTUI.clearThrottling).toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("skips tui calls for subagent events", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRateLimitThrottle!({
      delayMs: 1000,
      stats: { rpm: 0, tpm: 0 },
      subagentContext: { parentGadgetInvocationId: "x", depth: 1 },
    } as any);

    expect(mockTUI.showThrottling).not.toHaveBeenCalled();
    expect(mockTUI.addSystemMessage).not.toHaveBeenCalled();
  });

  test("is a no-op when tui is null", async () => {
    const { hooks } = setup({ tuiEnabled: false });

    await expect(
      hooks.observers!.onRateLimitThrottle!({
        delayMs: 1000,
        stats: { rpm: 0, tpm: 0 },
      } as any),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onRetryAttempt
// ─────────────────────────────────────────────────────────────────────────────

describe("createTUIHooks — onRetryAttempt", () => {
  afterEach(() => vi.restoreAllMocks());

  test("calls tui.showRetry with attemptNumber and retriesLeft", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRetryAttempt!({
      attemptNumber: 2,
      retriesLeft: 1,
    } as any);

    expect(mockTUI.showRetry).toHaveBeenCalledWith(2, 1);
  });

  test("adds system message with attempt info", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRetryAttempt!({
      attemptNumber: 2,
      retriesLeft: 1,
    } as any);

    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("attempt 2/3"),
      "retry",
    );
  });

  test("includes server-requested wait time when retryAfterMs is set", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRetryAttempt!({
      attemptNumber: 1,
      retriesLeft: 2,
      retryAfterMs: 3000,
    } as any);

    expect(mockTUI.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("server requested 3s wait"),
      "retry",
    );
  });

  test("omits wait time info when retryAfterMs is undefined", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRetryAttempt!({
      attemptNumber: 1,
      retriesLeft: 2,
    } as any);

    const call = mockTUI.addSystemMessage.mock.calls[0][0] as string;
    expect(call).not.toContain("server requested");
  });

  test("skips tui calls for subagent events", async () => {
    const { hooks, mockTUI } = setup();

    await hooks.observers!.onRetryAttempt!({
      attemptNumber: 1,
      retriesLeft: 1,
      subagentContext: { parentGadgetInvocationId: "x", depth: 1 },
    } as any);

    expect(mockTUI.showRetry).not.toHaveBeenCalled();
    expect(mockTUI.addSystemMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// beforeGadgetExecution controller
// ─────────────────────────────────────────────────────────────────────────────

describe("createTUIHooks — beforeGadgetExecution", () => {
  afterEach(() => vi.restoreAllMocks());

  test("returns proceed for allowed gadgets immediately", async () => {
    const { hooks } = setup({
      gadgetApprovals: { MyGadget: "allowed" },
    });

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "MyGadget",
      parameters: {},
    } as any);

    expect(result.action).toBe("proceed");
  });

  test("falls back to defaultMode when gadget not in approvals map", async () => {
    const { hooks } = setup({ defaultMode: "allowed" });

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "UnknownGadget",
      parameters: {},
    } as any);

    expect(result.action).toBe("proceed");
  });

  test("skips and returns denied message for 'denied' mode in non-interactive mode", async () => {
    const { hooks } = setup({
      gadgetApprovals: { DangerousGadget: "denied" },
      tuiEnabled: false,
      stdinTTY: false,
      stderrTTY: false,
    });

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "DangerousGadget",
      parameters: {},
    } as any);

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("status=denied");
      expect(result.syntheticResult).toContain("DangerousGadget");
    }
  });

  test("uses TUI modal approval dialog and proceeds on 'yes'", async () => {
    const { hooks, mockTUI } = setup({
      gadgetApprovals: { WriteFile: "approval-required" },
    });
    mockTUI.showApproval.mockResolvedValueOnce("yes");

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "WriteFile",
      parameters: { path: "/tmp/test" },
    } as any);

    expect(mockTUI.showApproval).toHaveBeenCalledWith({
      gadgetName: "WriteFile",
      parameters: { path: "/tmp/test" },
    });
    expect(result.action).toBe("proceed");
  });

  test("persists 'always' response as 'allowed' in gadgetApprovals", async () => {
    const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
      WriteFile: "approval-required",
    };
    const { hooks, mockTUI } = setup({ gadgetApprovals });
    mockTUI.showApproval.mockResolvedValueOnce("always");

    await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "WriteFile",
      parameters: {},
    } as any);

    expect(gadgetApprovals.WriteFile).toBe("allowed");
  });

  test("persists 'deny' response as 'denied' in gadgetApprovals", async () => {
    const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
      WriteFile: "approval-required",
    };
    const { hooks, mockTUI } = setup({ gadgetApprovals });
    mockTUI.showApproval.mockResolvedValueOnce("deny");

    await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "WriteFile",
      parameters: {},
    } as any);

    expect(gadgetApprovals.WriteFile).toBe("denied");
  });

  test("skips with denied message when user declines via TUI modal", async () => {
    const { hooks, mockTUI } = setup({
      gadgetApprovals: { WriteFile: "approval-required" },
    });
    mockTUI.showApproval.mockResolvedValueOnce("no");

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "WriteFile",
      parameters: {},
    } as any);

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("Denied by user");
    }
  });

  test("skips approval-required gadgets in non-interactive mode", async () => {
    const { hooks } = setup({
      gadgetApprovals: { RunCommand: "approval-required" },
      stdinTTY: false,
      stderrTTY: false,
      tuiEnabled: false,
    });

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "RunCommand",
      parameters: {},
    } as any);

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("requires interactive approval");
    }
  });

  test("skips denied gadgets in non-interactive mode with correct message", async () => {
    const { hooks } = setup({
      gadgetApprovals: { BadGadget: "denied" },
      stdinTTY: false,
      stderrTTY: false,
      tuiEnabled: false,
    });

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "BadGadget",
      parameters: {},
    } as any);

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("denied by configuration");
    }
  });

  test("is case-insensitive when looking up gadget approvals", async () => {
    const { hooks } = setup({
      gadgetApprovals: { writefile: "allowed" },
    });

    const result = await hooks.controllers!.beforeGadgetExecution!({
      gadgetName: "WriteFile",
      parameters: {},
    } as any);

    expect(result.action).toBe("proceed");
  });
});
