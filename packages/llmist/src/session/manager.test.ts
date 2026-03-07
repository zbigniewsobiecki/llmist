import { describe, expect, it } from "vitest";

import { BaseSessionManager, SimpleSessionManager } from "./manager.js";

// Concrete subclass to test BaseSessionManager protected/abstract methods
class TestSessionManager extends BaseSessionManager<string> {
  async createSession(data?: string): Promise<string> {
    const id = this.generateId("t");
    if (data !== undefined) {
      this.sessions.set(id, data);
    }
    return id;
  }

  async closeSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  // Expose generateId for direct testing
  public testGenerateId(prefix: string): string {
    return this.generateId(prefix);
  }
}

describe("BaseSessionManager", () => {
  describe("generateId()", () => {
    it("returns id with correct prefix", () => {
      const manager = new TestSessionManager();
      const id = manager.testGenerateId("p");
      expect(id).toBe("p1");
    });

    it("increments counter sequentially", () => {
      const manager = new TestSessionManager();
      const id1 = manager.testGenerateId("p");
      const id2 = manager.testGenerateId("p");
      const id3 = manager.testGenerateId("p");
      expect(id1).toBe("p1");
      expect(id2).toBe("p2");
      expect(id3).toBe("p3");
    });

    it("uses provided prefix in generated id", () => {
      const manager = new TestSessionManager();
      const idA = manager.testGenerateId("abc");
      const idB = manager.testGenerateId("xyz");
      expect(idA).toBe("abc1");
      expect(idB).toBe("xyz2");
    });
  });

  describe("getSession()", () => {
    it("returns session when found", async () => {
      const manager = new TestSessionManager();
      const id = await manager.createSession("hello");
      expect(manager.getSession(id)).toBe("hello");
    });

    it("returns undefined when session not found", () => {
      const manager = new TestSessionManager();
      expect(manager.getSession("nonexistent")).toBeUndefined();
    });
  });

  describe("requireSession()", () => {
    it("returns session when found", async () => {
      const manager = new TestSessionManager();
      const id = await manager.createSession("world");
      expect(manager.requireSession(id)).toBe("world");
    });

    it("throws error when session not found", () => {
      const manager = new TestSessionManager();
      expect(() => manager.requireSession("missing")).toThrow("Session not found: missing");
    });

    it("throws an Error instance", () => {
      const manager = new TestSessionManager();
      expect(() => manager.requireSession("bad-id")).toThrow(Error);
    });
  });

  describe("listSessions()", () => {
    it("returns empty array when no sessions", () => {
      const manager = new TestSessionManager();
      expect(manager.listSessions()).toEqual([]);
    });

    it("returns all active session IDs", async () => {
      const manager = new TestSessionManager();
      const id1 = await manager.createSession("a");
      const id2 = await manager.createSession("b");
      const id3 = await manager.createSession("c");
      expect(manager.listSessions()).toEqual([id1, id2, id3]);
    });

    it("does not include closed sessions", async () => {
      const manager = new TestSessionManager();
      const id1 = await manager.createSession("a");
      const id2 = await manager.createSession("b");
      await manager.closeSession(id1);
      expect(manager.listSessions()).toEqual([id2]);
    });
  });

  describe("hasSession()", () => {
    it("returns true when session exists", async () => {
      const manager = new TestSessionManager();
      const id = await manager.createSession("data");
      expect(manager.hasSession(id)).toBe(true);
    });

    it("returns false when session does not exist", () => {
      const manager = new TestSessionManager();
      expect(manager.hasSession("nonexistent")).toBe(false);
    });

    it("returns false after session is closed", async () => {
      const manager = new TestSessionManager();
      const id = await manager.createSession("data");
      await manager.closeSession(id);
      expect(manager.hasSession(id)).toBe(false);
    });
  });

  describe("closeAll()", () => {
    it("closes all sessions", async () => {
      const manager = new TestSessionManager();
      const id1 = await manager.createSession("a");
      const id2 = await manager.createSession("b");
      const id3 = await manager.createSession("c");

      await manager.closeAll();

      expect(manager.hasSession(id1)).toBe(false);
      expect(manager.hasSession(id2)).toBe(false);
      expect(manager.hasSession(id3)).toBe(false);
      expect(manager.listSessions()).toEqual([]);
    });

    it("closes sessions in reverse order (most recent first)", async () => {
      const closeOrder: string[] = [];

      class OrderTrackingManager extends BaseSessionManager<string> {
        async createSession(data?: string): Promise<string> {
          const id = this.generateId("t");
          if (data !== undefined) {
            this.sessions.set(id, data);
          }
          return id;
        }

        async closeSession(id: string): Promise<void> {
          closeOrder.push(id);
          this.sessions.delete(id);
        }
      }

      const manager = new OrderTrackingManager();
      const id1 = await manager.createSession("a");
      const id2 = await manager.createSession("b");
      const id3 = await manager.createSession("c");

      await manager.closeAll();

      expect(closeOrder).toEqual([id3, id2, id1]);
    });

    it("swallows errors from individual closeSession calls", async () => {
      class ErroringManager extends BaseSessionManager<string> {
        async createSession(data?: string): Promise<string> {
          const id = this.generateId("t");
          if (data !== undefined) {
            this.sessions.set(id, data);
          }
          return id;
        }

        async closeSession(id: string): Promise<void> {
          this.sessions.delete(id);
          throw new Error(`Failed to close session: ${id}`);
        }
      }

      const manager = new ErroringManager();
      await manager.createSession("a");
      await manager.createSession("b");

      // Should not throw even though closeSession throws
      await expect(manager.closeAll()).resolves.toBeUndefined();
    });

    it("continues closing remaining sessions even after one fails", async () => {
      const closedIds: string[] = [];

      class PartialErrorManager extends BaseSessionManager<string> {
        async createSession(data?: string): Promise<string> {
          const id = this.generateId("t");
          if (data !== undefined) {
            this.sessions.set(id, data);
          }
          return id;
        }

        async closeSession(id: string): Promise<void> {
          this.sessions.delete(id);
          closedIds.push(id);
          if (id === "t2") {
            throw new Error("simulated failure");
          }
        }
      }

      const manager = new PartialErrorManager();
      await manager.createSession("a"); // t1
      await manager.createSession("b"); // t2 - this one will fail
      await manager.createSession("c"); // t3

      await manager.closeAll();

      // All three should have been attempted (in reverse: t3, t2, t1)
      expect(closedIds).toContain("t1");
      expect(closedIds).toContain("t2");
      expect(closedIds).toContain("t3");
    });

    it("resolves immediately when no sessions exist", async () => {
      const manager = new TestSessionManager();
      await expect(manager.closeAll()).resolves.toBeUndefined();
    });
  });
});

describe("SimpleSessionManager", () => {
  describe("createSession()", () => {
    it("generates an id with 's' prefix", async () => {
      const manager = new SimpleSessionManager<string>();
      const id = await manager.createSession("value");
      expect(id).toMatch(/^s\d+$/);
      expect(id).toBe("s1");
    });

    it("generates sequential ids with 's' prefix", async () => {
      const manager = new SimpleSessionManager<number>();
      const id1 = await manager.createSession(1);
      const id2 = await manager.createSession(2);
      const id3 = await manager.createSession(3);
      expect(id1).toBe("s1");
      expect(id2).toBe("s2");
      expect(id3).toBe("s3");
    });

    it("stores session data when provided", async () => {
      const manager = new SimpleSessionManager<string>();
      const id = await manager.createSession("hello");
      expect(manager.getSession(id)).toBe("hello");
    });

    it("does not store session when data is undefined", async () => {
      const manager = new SimpleSessionManager<string>();
      const id = await manager.createSession(undefined);
      expect(manager.getSession(id)).toBeUndefined();
      expect(manager.hasSession(id)).toBe(false);
    });

    it("stores complex object data", async () => {
      const manager = new SimpleSessionManager<{ value: number; name: string }>();
      const data = { value: 42, name: "test" };
      const id = await manager.createSession(data);
      expect(manager.getSession(id)).toEqual(data);
      expect(manager.getSession(id)).toBe(data); // Same reference
    });
  });

  describe("closeSession()", () => {
    it("removes session from store", async () => {
      const manager = new SimpleSessionManager<string>();
      const id = await manager.createSession("data");
      expect(manager.hasSession(id)).toBe(true);
      await manager.closeSession(id);
      expect(manager.hasSession(id)).toBe(false);
    });

    it("does not throw when closing non-existent session", async () => {
      const manager = new SimpleSessionManager<string>();
      await expect(manager.closeSession("nonexistent")).resolves.toBeUndefined();
    });

    it("only removes specified session", async () => {
      const manager = new SimpleSessionManager<string>();
      const id1 = await manager.createSession("a");
      const id2 = await manager.createSession("b");
      await manager.closeSession(id1);
      expect(manager.hasSession(id1)).toBe(false);
      expect(manager.hasSession(id2)).toBe(true);
    });
  });

  describe("setSession()", () => {
    it("sets session data for an id", async () => {
      const manager = new SimpleSessionManager<string>();
      const id = await manager.createSession();
      manager.setSession(id, "new-value");
      expect(manager.getSession(id)).toBe("new-value");
    });

    it("overwrites existing session data", async () => {
      const manager = new SimpleSessionManager<string>();
      const id = await manager.createSession("original");
      manager.setSession(id, "updated");
      expect(manager.getSession(id)).toBe("updated");
    });

    it("can create a session entry for an arbitrary id", () => {
      const manager = new SimpleSessionManager<number>();
      manager.setSession("custom-id", 100);
      expect(manager.getSession("custom-id")).toBe(100);
      expect(manager.hasSession("custom-id")).toBe(true);
    });

    it("updates listSessions after setting a new arbitrary id", () => {
      const manager = new SimpleSessionManager<number>();
      manager.setSession("custom-id", 42);
      expect(manager.listSessions()).toContain("custom-id");
    });
  });
});
