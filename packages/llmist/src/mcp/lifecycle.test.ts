/**
 * Tests for the basic MCP lifecycle helper that tracks spawned clients and
 * tears them all down when the agent's run completes.
 */

import { describe, expect, it, vi } from "vitest";

import { McpLifecycle } from "./lifecycle.js";

interface FakeClient {
  close: ReturnType<typeof vi.fn>;
  serverName: string;
}

function fakeClient(name: string, throws = false): FakeClient {
  return {
    serverName: name,
    close: vi.fn(async () => {
      if (throws) throw new Error(`close failed for ${name}`);
    }),
  };
}

describe("McpLifecycle", () => {
  it("registers clients and reports size", () => {
    const lc = new McpLifecycle();
    expect(lc.size).toBe(0);
    lc.register(fakeClient("a") as never);
    lc.register(fakeClient("b") as never);
    expect(lc.size).toBe(2);
  });

  it("closeAll calls close on every registered client", async () => {
    const lc = new McpLifecycle();
    const a = fakeClient("a");
    const b = fakeClient("b");
    lc.register(a as never);
    lc.register(b as never);
    await lc.closeAll();
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it("closeAll swallows individual close errors so teardown completes", async () => {
    const lc = new McpLifecycle();
    const a = fakeClient("a", true); // throws on close
    const b = fakeClient("b");
    lc.register(a as never);
    lc.register(b as never);
    await expect(lc.closeAll()).resolves.toBeUndefined();
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it("closeAll empties the tracked set", async () => {
    const lc = new McpLifecycle();
    lc.register(fakeClient("a") as never);
    expect(lc.size).toBe(1);
    await lc.closeAll();
    expect(lc.size).toBe(0);
  });

  it("closeAll is idempotent across rapid double-shutdown", async () => {
    const lc = new McpLifecycle();
    const a = fakeClient("a");
    lc.register(a as never);
    await Promise.all([lc.closeAll(), lc.closeAll()]);
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it("installSignalHandlers + removeSignalHandlers attaches and removes listeners", () => {
    const lc = new McpLifecycle();
    const before = process.listenerCount("SIGTERM") + process.listenerCount("SIGINT");
    lc.installSignalHandlers();
    const during = process.listenerCount("SIGTERM") + process.listenerCount("SIGINT");
    expect(during).toBeGreaterThan(before);
    lc.removeSignalHandlers();
    const after = process.listenerCount("SIGTERM") + process.listenerCount("SIGINT");
    expect(after).toBe(before);
  });

  it("removeSignalHandlers without prior install is safe", () => {
    const lc = new McpLifecycle();
    expect(() => lc.removeSignalHandlers()).not.toThrow();
  });

  it("double install does not stack listeners", () => {
    const lc = new McpLifecycle();
    const baseline = process.listenerCount("SIGTERM");
    lc.installSignalHandlers();
    lc.installSignalHandlers();
    const after = process.listenerCount("SIGTERM");
    expect(after).toBe(baseline + 1);
    lc.removeSignalHandlers();
  });
});
