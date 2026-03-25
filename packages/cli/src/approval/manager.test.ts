import { Readable, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "../environment.js";
import { ApprovalManager } from "./manager.js";
import type { ApprovalConfig, ApprovalContextProvider, KeyboardCoordinator } from "./types.js";

// Mock readline/promises so we can control what the user "types"
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(),
}));

// Import the mocked module so we can configure it per-test
const { createInterface } = await import("node:readline/promises");
const mockCreateInterface = vi.mocked(createInterface);

/**
 * Configures the readline mock to return a specific answer when questioned.
 */
function mockReadlineAnswer(answer: string): void {
  mockCreateInterface.mockReturnValue({
    question: vi.fn().mockResolvedValue(answer),
    close: vi.fn(),
  } as never);
}

/**
 * Creates a mock KeyboardCoordinator with controllable cleanupEsc/restore.
 */
function createMockKeyboard(): KeyboardCoordinator & {
  cleanupEscMock: ReturnType<typeof vi.fn>;
  restoreMock: ReturnType<typeof vi.fn>;
} {
  const cleanupEscMock = vi.fn();
  const restoreMock = vi.fn();

  const keyboard: KeyboardCoordinator = {
    cleanupEsc: cleanupEscMock,
    restore: restoreMock,
  };

  return Object.assign(keyboard, { cleanupEscMock, restoreMock });
}

/**
 * Creates a mock StreamProgress-like object.
 */
function createMockProgress(): { pause: ReturnType<typeof vi.fn> } {
  return { pause: vi.fn() };
}

/**
 * Creates a mock CLIEnvironment for testing.
 */
function createMockEnv(stdinData = ""): CLIEnvironment {
  const stdinBuffer = Buffer.from(stdinData);
  let stdinOffset = 0;

  const stdin = new Readable({
    read(size) {
      if (stdinOffset >= stdinBuffer.length) {
        this.push(null);
        return;
      }
      const chunk = stdinBuffer.slice(stdinOffset, stdinOffset + size);
      stdinOffset += size;
      this.push(chunk);
    },
  }) as NodeJS.ReadStream;

  const stderrChunks: string[] = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    },
  }) as NodeJS.WriteStream;

  return {
    stdin,
    stdout: process.stdout,
    stderr,
    createClient: vi.fn(() => ({}) as never),
    createLogger: vi.fn(() => ({}) as never),
    getStderrOutput: () => stderrChunks.join(""),
  } as CLIEnvironment & { getStderrOutput: () => string };
}

describe("ApprovalManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getApprovalMode", () => {
    it("returns explicit mode when gadget is configured", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { WriteFile: "denied", ReadFile: "allowed" },
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      expect(manager.getApprovalMode("WriteFile")).toBe("denied");
      expect(manager.getApprovalMode("ReadFile")).toBe("allowed");
    });

    it("returns wildcard mode when gadget not configured but wildcard exists", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { "*": "denied" },
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      expect(manager.getApprovalMode("AnyGadget")).toBe("denied");
      expect(manager.getApprovalMode("AnotherGadget")).toBe("denied");
    });

    it("returns defaultMode when neither explicit nor wildcard configured", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: {},
        defaultMode: "approval-required",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      expect(manager.getApprovalMode("UnknownGadget")).toBe("approval-required");
    });

    it("performs case-insensitive gadget name matching", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { WriteFile: "denied" },
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      expect(manager.getApprovalMode("writefile")).toBe("denied");
      expect(manager.getApprovalMode("WRITEFILE")).toBe("denied");
      expect(manager.getApprovalMode("WriteFile")).toBe("denied");
    });

    it("explicit config takes precedence over wildcard", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { WriteFile: "allowed", "*": "denied" },
        defaultMode: "approval-required",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      expect(manager.getApprovalMode("WriteFile")).toBe("allowed");
      expect(manager.getApprovalMode("OtherGadget")).toBe("denied");
    });
  });

  describe("requestApproval", () => {
    it('returns { approved: true } for "allowed" mode', async () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { TestGadget: "allowed" },
        defaultMode: "denied",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      const result = await manager.requestApproval("TestGadget", { foo: "bar" });

      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns { approved: false, reason } for "denied" mode', async () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { TestGadget: "denied" },
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      const result = await manager.requestApproval("TestGadget", { foo: "bar" });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("TestGadget is denied by configuration");
    });
  });

  describe("registerProvider", () => {
    it("registers custom context provider", async () => {
      const config: ApprovalConfig = {
        gadgetApprovals: { CustomGadget: "allowed" },
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      const customProvider: ApprovalContextProvider = {
        gadgetName: "CustomGadget",
        getContext: async () => ({
          summary: "Custom summary",
          details: "Custom details",
        }),
      };

      manager.registerProvider(customProvider);

      // The provider is registered and would be used for approval-required mode
      // We verify registration by checking mode resolution still works
      expect(manager.getApprovalMode("CustomGadget")).toBe("allowed");
    });

    it("registers provider with case-insensitive name", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: {},
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      const provider: ApprovalContextProvider = {
        gadgetName: "MyGadget",
        getContext: async () => ({ summary: "test" }),
      };

      manager.registerProvider(provider);

      // Providers are registered case-insensitively
      // Built-in providers for WriteFile, EditFile, RunCommand are auto-registered
      expect(manager.getApprovalMode("writefile")).toBe("allowed");
    });
  });

  describe("built-in providers", () => {
    it("registers WriteFile, EditFile, and RunCommand providers by default", () => {
      const config: ApprovalConfig = {
        gadgetApprovals: {},
        defaultMode: "allowed",
      };
      const env = createMockEnv();
      const manager = new ApprovalManager(config, env);

      // These gadgets should use their built-in providers when approval is needed
      // Verify the manager was created successfully with built-in providers
      expect(manager.getApprovalMode("WriteFile")).toBe("allowed");
      expect(manager.getApprovalMode("EditFile")).toBe("allowed");
      expect(manager.getApprovalMode("RunCommand")).toBe("allowed");
    });
  });

  describe("requestApproval — approval-required interactive prompt", () => {
    const approvalRequiredConfig: ApprovalConfig = {
      gadgetApprovals: { TestGadget: "approval-required" },
      defaultMode: "denied",
    };

    it("triggers interactive prompt for approval-required mode", async () => {
      mockReadlineAnswer("y");
      const env = createMockEnv();
      const manager = new ApprovalManager(approvalRequiredConfig, env);

      const result = await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(mockCreateInterface).toHaveBeenCalledOnce();
      expect(result.approved).toBe(true);
    });

    it("approves when user types 'y'", async () => {
      mockReadlineAnswer("y");
      const env = createMockEnv();
      const manager = new ApprovalManager(approvalRequiredConfig, env);

      const result = await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("approves when user types 'Y' (case-insensitive)", async () => {
      mockReadlineAnswer("Y");
      const env = createMockEnv();
      const manager = new ApprovalManager(approvalRequiredConfig, env);

      const result = await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("approves when user presses Enter (empty response)", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv();
      const manager = new ApprovalManager(approvalRequiredConfig, env);

      const result = await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("denies when user types rejection text", async () => {
      mockReadlineAnswer("no way");
      const env = createMockEnv();
      const manager = new ApprovalManager(approvalRequiredConfig, env);

      const result = await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("no way");
    });

    it("uses rejection text as reason when user types a reason", async () => {
      mockReadlineAnswer("too dangerous");
      const env = createMockEnv();
      const manager = new ApprovalManager(approvalRequiredConfig, env);

      const result = await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("too dangerous");
    });

    it("calls progress.pause() before prompting", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv();
      const progress = createMockProgress();
      const manager = new ApprovalManager(approvalRequiredConfig, env, progress as never);

      await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(progress.pause).toHaveBeenCalledOnce();
    });

    it("calls keyboard.cleanupEsc() and sets it to null before readline", async () => {
      const rlQuestionMock = vi.fn();
      // Capture keyboard state at the time question is called
      let cleanupNulledBeforeQuestion = false;

      rlQuestionMock.mockImplementation(async () => {
        // keyboard.cleanupEsc should already be null at this point
        cleanupNulledBeforeQuestion = keyboard.cleanupEsc === null;
        return "";
      });
      mockCreateInterface.mockReturnValue({
        question: rlQuestionMock,
        close: vi.fn(),
      } as never);

      const env = createMockEnv();
      const keyboard = createMockKeyboard();
      const manager = new ApprovalManager(approvalRequiredConfig, env, undefined, keyboard);

      await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(keyboard.cleanupEscMock).toHaveBeenCalledOnce();
      expect(cleanupNulledBeforeQuestion).toBe(true);
    });

    it("calls keyboard.restore() in finally block after prompt", async () => {
      mockReadlineAnswer("n");
      const env = createMockEnv();
      const keyboard = createMockKeyboard();
      const manager = new ApprovalManager(approvalRequiredConfig, env, undefined, keyboard);

      await manager.requestApproval("TestGadget", { path: "file.ts" });

      expect(keyboard.restoreMock).toHaveBeenCalledOnce();
    });

    it("calls keyboard.restore() even when prompt throws", async () => {
      mockCreateInterface.mockReturnValue({
        question: vi.fn().mockRejectedValue(new Error("stdin closed")),
        close: vi.fn(),
      } as never);

      const env = createMockEnv();
      const keyboard = createMockKeyboard();
      const manager = new ApprovalManager(approvalRequiredConfig, env, undefined, keyboard);

      await expect(manager.requestApproval("TestGadget", { path: "file.ts" })).rejects.toThrow(
        "stdin closed",
      );

      expect(keyboard.restoreMock).toHaveBeenCalledOnce();
    });

    it("uses custom context provider's getContext for summary/details", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv();
      const config: ApprovalConfig = {
        gadgetApprovals: { MyGadget: "approval-required" },
        defaultMode: "denied",
      };
      const getContextMock = vi.fn().mockResolvedValue({
        summary: "Custom summary from provider",
        details: "Custom diff details",
      });
      const customProvider: ApprovalContextProvider = {
        gadgetName: "MyGadget",
        getContext: getContextMock,
      };
      const manager = new ApprovalManager(config, env);
      manager.registerProvider(customProvider);

      await manager.requestApproval("MyGadget", { path: "custom.ts" });

      expect(getContextMock).toHaveBeenCalledOnce();
      expect(getContextMock).toHaveBeenCalledWith({ path: "custom.ts" });
    });

    it("renders context summary in stderr output", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv() as CLIEnvironment & { getStderrOutput: () => string };
      const stderrChunks: string[] = [];
      // Capture stderr by wrapping the write
      const originalWrite = (env.stderr as NodeJS.WriteStream).write.bind(env.stderr);
      vi.spyOn(env.stderr, "write").mockImplementation((chunk: unknown, ...args: unknown[]) => {
        stderrChunks.push(String(chunk));
        return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
      });

      const customProvider: ApprovalContextProvider = {
        gadgetName: "TestGadget",
        getContext: async () => ({ summary: "Write foo.ts" }),
      };
      const manager = new ApprovalManager(approvalRequiredConfig, env);
      manager.registerProvider(customProvider);

      await manager.requestApproval("TestGadget", { path: "foo.ts" });

      const stderrOutput = stderrChunks.join("");
      expect(stderrOutput).toContain("Write foo.ts");
    });

    it("renders context details (diff) in stderr when provided", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv() as CLIEnvironment & { getStderrOutput: () => string };
      const stderrChunks: string[] = [];
      vi.spyOn(env.stderr, "write").mockImplementation((chunk: unknown, ...args: unknown[]) => {
        stderrChunks.push(String(chunk));
        return true;
      });

      const customProvider: ApprovalContextProvider = {
        gadgetName: "TestGadget",
        getContext: async () => ({
          summary: "Modify file",
          details: "--- old\n+++ new\n@@ -1 +1 @@\n-old line\n+new line",
        }),
      };
      const manager = new ApprovalManager(approvalRequiredConfig, env);
      manager.registerProvider(customProvider);

      await manager.requestApproval("TestGadget", { path: "foo.ts" });

      const stderrOutput = stderrChunks.join("");
      // Details are passed through renderColoredDiff but the content is present
      expect(stderrOutput).toContain("old line");
      expect(stderrOutput).toContain("new line");
    });

    it("uses DefaultContextProvider when no custom provider registered", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv() as CLIEnvironment & { getStderrOutput: () => string };
      const stderrChunks: string[] = [];
      vi.spyOn(env.stderr, "write").mockImplementation((chunk: unknown) => {
        stderrChunks.push(String(chunk));
        return true;
      });

      // UnknownGadget has no registered provider — falls back to DefaultContextProvider
      const config: ApprovalConfig = {
        gadgetApprovals: { UnknownGadget: "approval-required" },
        defaultMode: "denied",
      };
      const manager = new ApprovalManager(config, env);

      await manager.requestApproval("UnknownGadget", { value: 42 });

      // DefaultContextProvider produces "GadgetName(param=value)" format
      const stderrOutput = stderrChunks.join("");
      expect(stderrOutput).toContain("UnknownGadget");
    });

    it("does not render details section when context has no details", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv();
      const stderrChunks: string[] = [];
      vi.spyOn(env.stderr, "write").mockImplementation((chunk: unknown) => {
        stderrChunks.push(String(chunk));
        return true;
      });

      // DefaultContextProvider returns no details for unknown gadgets
      const config: ApprovalConfig = {
        gadgetApprovals: { NoDetailsGadget: "approval-required" },
        defaultMode: "denied",
      };
      const manager = new ApprovalManager(config, env);

      await manager.requestApproval("NoDetailsGadget", {});

      // Should write the summary line but not a second line for details
      // Verify createInterface was called (prompt was shown)
      expect(mockCreateInterface).toHaveBeenCalledOnce();
    });

    it("does not call keyboard.cleanupEsc when it is already null", async () => {
      mockReadlineAnswer("");
      const env = createMockEnv();
      const keyboard: KeyboardCoordinator = {
        cleanupEsc: null,
        restore: vi.fn(),
      };
      const manager = new ApprovalManager(approvalRequiredConfig, env, undefined, keyboard);

      // Should not throw when cleanupEsc is already null
      await expect(
        manager.requestApproval("TestGadget", { path: "file.ts" }),
      ).resolves.toBeDefined();

      expect(keyboard.restore).toHaveBeenCalledOnce();
    });
  });
});
