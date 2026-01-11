import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSession, initSession, resetSession, SESSION_LOGS_BASE } from "./session.js";

describe("session", () => {
  let createdLogDirs: string[] = [];

  beforeEach(() => {
    resetSession();
    createdLogDirs = [];
  });

  afterEach(async () => {
    resetSession();
    // Clean up any created directories
    for (const dir of createdLogDirs) {
      try {
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("SESSION_LOGS_BASE", () => {
    it("points to ~/.llmist/logs", () => {
      expect(SESSION_LOGS_BASE).toBe(join(homedir(), ".llmist", "logs"));
    });
  });

  describe("initSession", () => {
    it("creates session with memorable name", async () => {
      const session = await initSession();
      createdLogDirs.push(session.logDir);

      // Format: adjective-noun or adjective-noun-N (when collision)
      expect(session.name).toMatch(/^[a-z]+-[a-z]+(-\d+)?$/);
      expect(session.logDir).toBe(join(SESSION_LOGS_BASE, session.name));
    });

    it("creates the log directory", async () => {
      const session = await initSession();
      createdLogDirs.push(session.logDir);

      expect(existsSync(session.logDir)).toBe(true);
    });

    it("returns same session on subsequent calls", async () => {
      const session1 = await initSession();
      createdLogDirs.push(session1.logDir);

      const session2 = await initSession();

      expect(session2).toBe(session1);
      expect(session2.name).toBe(session1.name);
      expect(session2.logDir).toBe(session1.logDir);
    });
  });

  describe("getSession", () => {
    it("returns undefined before initialization", () => {
      expect(getSession()).toBeUndefined();
    });

    it("returns session after initialization", async () => {
      const initialized = await initSession();
      createdLogDirs.push(initialized.logDir);

      const retrieved = getSession();

      expect(retrieved).toBe(initialized);
    });
  });

  describe("resetSession", () => {
    it("clears the session", async () => {
      const session = await initSession();
      createdLogDirs.push(session.logDir);

      expect(getSession()).toBeDefined();

      resetSession();

      expect(getSession()).toBeUndefined();
    });

    it("allows new session to be created after reset", async () => {
      const session1 = await initSession();
      createdLogDirs.push(session1.logDir);

      resetSession();

      const session2 = await initSession();
      createdLogDirs.push(session2.logDir);

      expect(session2.name).not.toBe(session1.name);
      expect(session2.logDir).not.toBe(session1.logDir);
    });
  });
});
