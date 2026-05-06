/**
 * Unit tests for createApprovalController factory.
 *
 * Each scenario is tested by calling the returned controller directly,
 * without spinning up a full agent. Follows the patterns established in
 * tui-hooks.test.ts.
 */

import { createMockTUIApp } from "@llmist/testing";
import { describe, expect, test } from "vitest";
import type { CLIEnvironment } from "../environment.js";
import { createApprovalController } from "./approval-controller.js";
import type { ApprovalConfig } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockEnv(options: { stdinTTY?: boolean; stderrTTY?: boolean } = {}): CLIEnvironment {
  const { stdinTTY = true, stderrTTY = true } = options;
  return {
    argv: ["node", "llmist"],
    stdin: { isTTY: stdinTTY } as any,
    stdout: { isTTY: true, write: () => true } as any,
    stderr: { isTTY: stderrTTY, write: () => true } as any,
    createClient: (() => {}) as any,
    setExitCode: () => {},
    createLogger: (() => {}) as any,
    isTTY: stdinTTY,
    prompt: (() => Promise.resolve("")) as any,
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
  const approvalConfig: ApprovalConfig = { gadgetApprovals, defaultMode };

  const controller = createApprovalController({
    gadgetApprovals,
    approvalConfig,
    tui,
    env,
  });

  return { controller, mockTUI, tui, env, gadgetApprovals };
}

function makeCtx(gadgetName: string, parameters: Record<string, unknown> = {}) {
  return { gadgetName, parameters } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode: allowed
// ─────────────────────────────────────────────────────────────────────────────

describe("createApprovalController — allowed mode", () => {
  test("returns proceed immediately for explicitly allowed gadgets", async () => {
    const { controller } = setup({ gadgetApprovals: { MyGadget: "allowed" } });
    const result = await controller(makeCtx("MyGadget"));
    expect(result.action).toBe("proceed");
  });

  test("returns proceed when defaultMode is 'allowed' and gadget is unknown", async () => {
    const { controller } = setup({ defaultMode: "allowed" });
    const result = await controller(makeCtx("UnknownGadget"));
    expect(result.action).toBe("proceed");
  });

  test("lookup is case-insensitive — 'writefile' entry matches 'WriteFile' call", async () => {
    const { controller } = setup({ gadgetApprovals: { writefile: "allowed" } });
    const result = await controller(makeCtx("WriteFile"));
    expect(result.action).toBe("proceed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode: denied
// ─────────────────────────────────────────────────────────────────────────────

describe("createApprovalController — denied mode", () => {
  test("skips with denied message in non-interactive mode", async () => {
    const { controller } = setup({
      gadgetApprovals: { DangerousGadget: "denied" },
      stdinTTY: false,
      stderrTTY: false,
      tuiEnabled: false,
    });

    const result = await controller(makeCtx("DangerousGadget"));

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("status=denied");
      expect(result.syntheticResult).toContain("denied by configuration");
    }
  });

  test("skips denied gadgets even when TUI is available (non-interactive)", async () => {
    const { controller } = setup({
      gadgetApprovals: { BadGadget: "denied" },
      stdinTTY: false,
      stderrTTY: false,
    });

    const result = await controller(makeCtx("BadGadget"));
    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("BadGadget");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode: approval-required — non-interactive
// ─────────────────────────────────────────────────────────────────────────────

describe("createApprovalController — approval-required (non-interactive)", () => {
  test("skips with 'requires interactive approval' message", async () => {
    const { controller } = setup({
      gadgetApprovals: { RunCommand: "approval-required" },
      stdinTTY: false,
      stderrTTY: false,
      tuiEnabled: false,
    });

    const result = await controller(makeCtx("RunCommand"));

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("requires interactive approval");
      expect(result.syntheticResult).toContain("RunCommand");
    }
  });

  test("skips when only stderr is not a TTY", async () => {
    const { controller } = setup({
      gadgetApprovals: { RunCommand: "approval-required" },
      stdinTTY: true,
      stderrTTY: false,
      tuiEnabled: false,
    });

    const result = await controller(makeCtx("RunCommand"));
    expect(result.action).toBe("skip");
  });

  test("skips when only stdin is not a TTY", async () => {
    const { controller } = setup({
      gadgetApprovals: { RunCommand: "approval-required" },
      stdinTTY: false,
      stderrTTY: true,
      tuiEnabled: false,
    });

    const result = await controller(makeCtx("RunCommand"));
    expect(result.action).toBe("skip");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode: approval-required — TUI
// ─────────────────────────────────────────────────────────────────────────────

describe("createApprovalController — approval-required (TUI)", () => {
  test("proceeds when user responds 'yes'", async () => {
    const { controller, mockTUI } = setup({
      gadgetApprovals: { WriteFile: "approval-required" },
    });
    mockTUI.showApproval.mockResolvedValueOnce("yes");

    const result = await controller(makeCtx("WriteFile", { path: "/tmp/test" }));

    expect(mockTUI.showApproval).toHaveBeenCalledWith({
      gadgetName: "WriteFile",
      parameters: { path: "/tmp/test" },
    });
    expect(result.action).toBe("proceed");
  });

  test("proceeds when user responds 'always'", async () => {
    const { controller, mockTUI } = setup({
      gadgetApprovals: { WriteFile: "approval-required" },
    });
    mockTUI.showApproval.mockResolvedValueOnce("always");

    const result = await controller(makeCtx("WriteFile"));
    expect(result.action).toBe("proceed");
  });

  test("skips with denied message when user responds 'no'", async () => {
    const { controller, mockTUI } = setup({
      gadgetApprovals: { WriteFile: "approval-required" },
    });
    mockTUI.showApproval.mockResolvedValueOnce("no");

    const result = await controller(makeCtx("WriteFile"));

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("Denied by user");
    }
  });

  test("skips with denied message when user responds 'deny'", async () => {
    const { controller, mockTUI } = setup({
      gadgetApprovals: { WriteFile: "approval-required" },
    });
    mockTUI.showApproval.mockResolvedValueOnce("deny");

    const result = await controller(makeCtx("WriteFile"));

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("Denied by user");
    }
  });

  test("persists 'always' response as 'allowed' in gadgetApprovals", async () => {
    const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
      WriteFile: "approval-required",
    };
    const { controller, mockTUI } = setup({ gadgetApprovals });
    mockTUI.showApproval.mockResolvedValueOnce("always");

    await controller(makeCtx("WriteFile"));

    expect(gadgetApprovals.WriteFile).toBe("allowed");
  });

  test("persists 'deny' response as 'denied' in gadgetApprovals", async () => {
    const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
      WriteFile: "approval-required",
    };
    const { controller, mockTUI } = setup({ gadgetApprovals });
    mockTUI.showApproval.mockResolvedValueOnce("deny");

    await controller(makeCtx("WriteFile"));

    expect(gadgetApprovals.WriteFile).toBe("denied");
  });

  test("does NOT mutate gadgetApprovals for 'yes' response", async () => {
    const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
      WriteFile: "approval-required",
    };
    const { controller, mockTUI } = setup({ gadgetApprovals });
    mockTUI.showApproval.mockResolvedValueOnce("yes");

    await controller(makeCtx("WriteFile"));

    expect(gadgetApprovals.WriteFile).toBe("approval-required");
  });

  test("does NOT mutate gadgetApprovals for 'no' response", async () => {
    const gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required"> = {
      WriteFile: "approval-required",
    };
    const { controller, mockTUI } = setup({ gadgetApprovals });
    mockTUI.showApproval.mockResolvedValueOnce("no");

    await controller(makeCtx("WriteFile"));

    expect(gadgetApprovals.WriteFile).toBe("approval-required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode: approval-required — piped mode with TTY but no TUI
// ─────────────────────────────────────────────────────────────────────────────

describe("createApprovalController — approval-required (piped, TTY available, no TUI)", () => {
  test("skips with message suggesting to enable TUI or adjust config", async () => {
    const { controller } = setup({
      gadgetApprovals: { RunCommand: "approval-required" },
      tuiEnabled: false,
      stdinTTY: true,
      stderrTTY: true,
    });

    const result = await controller(makeCtx("RunCommand"));

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("requires interactive approval");
      expect(result.syntheticResult).toContain("RunCommand");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultMode fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("createApprovalController — defaultMode fallback", () => {
  test("uses defaultMode 'denied' when gadget is not in approvals map (non-interactive)", async () => {
    const { controller } = setup({
      defaultMode: "denied",
      stdinTTY: false,
      stderrTTY: false,
      tuiEnabled: false,
    });

    const result = await controller(makeCtx("AnyGadget"));

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.syntheticResult).toContain("denied by configuration");
    }
  });

  test("uses defaultMode 'approval-required' when gadget is not configured (TUI)", async () => {
    const { controller, mockTUI } = setup({ defaultMode: "approval-required" });
    mockTUI.showApproval.mockResolvedValueOnce("yes");

    const result = await controller(makeCtx("SomeGadget"));

    expect(mockTUI.showApproval).toHaveBeenCalled();
    expect(result.action).toBe("proceed");
  });
});
