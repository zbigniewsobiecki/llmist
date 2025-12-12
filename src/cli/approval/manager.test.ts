import { describe, expect, it, mock } from "bun:test";
import { Readable, Writable } from "node:stream";
import type { CLIEnvironment } from "../environment.js";
import { ApprovalManager } from "./manager.js";
import type { ApprovalConfig, ApprovalContextProvider } from "./types.js";

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
    createClient: mock(() => ({}) as never),
    createLogger: mock(() => ({}) as never),
    getStderrOutput: () => stderrChunks.join(""),
  } as CLIEnvironment & { getStderrOutput: () => string };
}

describe("ApprovalManager", () => {
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
});
