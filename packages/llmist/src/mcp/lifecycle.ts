/**
 * Tracks spawned MCP clients for an agent run and closes them all on
 * teardown. Plan 1 ships the basics: register, closeAll, idempotent. Signal
 * handling and graceful shutdown windows are added in plan 2.
 *
 * @module mcp/lifecycle
 */

import { defaultLogger } from "../logging/logger.js";
import type { McpClient } from "./client.js";

export class McpLifecycle {
  private clients: McpClient[] = [];
  private closing: Promise<void> | null = null;
  private signalHandlersInstalled = false;
  private sigtermHandler: (() => void) | null = null;
  private sigintHandler: (() => void) | null = null;

  get size(): number {
    return this.clients.length;
  }

  register(client: McpClient): void {
    this.clients.push(client);
  }

  /**
   * Attach SIGTERM/SIGINT handlers that close every registered client when
   * the parent process is asked to exit. Idempotent (double install is a
   * no-op) and removable via `removeSignalHandlers()`.
   */
  installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;
    this.sigtermHandler = () => {
      void this.closeAll();
    };
    this.sigintHandler = () => {
      void this.closeAll();
    };
    process.on("SIGTERM", this.sigtermHandler);
    process.on("SIGINT", this.sigintHandler);
  }

  removeSignalHandlers(): void {
    if (!this.signalHandlersInstalled) return;
    if (this.sigtermHandler) process.off("SIGTERM", this.sigtermHandler);
    if (this.sigintHandler) process.off("SIGINT", this.sigintHandler);
    this.sigtermHandler = null;
    this.sigintHandler = null;
    this.signalHandlersInstalled = false;
  }

  /**
   * Close every registered client in parallel. Errors from individual close()
   * calls are swallowed (logged via console.warn) — a teardown path must not
   * throw because that would mask the original reason the agent is shutting
   * down. Idempotent: concurrent calls all return the same in-flight promise.
   */
  async closeAll(): Promise<void> {
    if (this.closing) return this.closing;

    const toClose = this.clients;
    this.clients = [];

    this.closing = (async () => {
      const results = await Promise.allSettled(toClose.map((c) => c.close()));
      for (const r of results) {
        if (r.status === "rejected") {
          // Best-effort log; never re-throw on a teardown path.
          defaultLogger.debug("MCP client close failed during teardown:", r.reason);
        }
      }
    })();

    try {
      await this.closing;
    } finally {
      this.closing = null;
      this.removeSignalHandlers();
    }
  }
}
