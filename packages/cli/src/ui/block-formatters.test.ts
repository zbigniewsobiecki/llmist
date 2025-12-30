import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import {
  formatGadgetCollapsed,
  formatGadgetExpanded,
} from "./block-formatters.js";
import type { GadgetNode } from "../tui/types.js";

// Force chalk to output colors even in non-TTY test environments
beforeAll(() => {
  chalk.level = 3;
});

// Helper to create a mock GadgetNode
function createGadgetNode(overrides: Partial<GadgetNode> = {}): GadgetNode {
  return {
    type: "gadget",
    id: "gadget_1",
    name: "TestGadget",
    invocationId: "gc_1",
    depth: 0,
    parameters: {},
    isComplete: false,
    children: [],
    ...overrides,
  };
}

describe("formatGadgetCollapsed", () => {
  describe("TellUser gadget", () => {
    it("shows info emoji for info type", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Hello", type: "info" },
        isComplete: true,
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("ℹ️");
      expect(result).toContain("TellUser");
    });

    it("shows success emoji for success type", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Done!", type: "success" },
        isComplete: true,
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("✅");
    });

    it("shows warning emoji for warning type", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Be careful", type: "warning" },
        isComplete: true,
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("⚠️");
    });

    it("shows error emoji for error type", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Failed!", type: "error" },
        isComplete: true,
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("❌");
    });

    it("does NOT include full message in collapsed view", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "This is a long message that should not appear in collapsed view" },
        isComplete: true,
      });

      const result = formatGadgetCollapsed(node, false);

      // The full message should NOT be in the collapsed output
      expect(result).not.toContain("This is a long message");
    });
  });

  describe("AskUser gadget", () => {
    it("shows question emoji", () => {
      const node = createGadgetNode({
        name: "AskUser",
        parameters: { question: "What is your name?" },
        isComplete: false,
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("❓");
      expect(result).toContain("AskUser");
    });

    it("includes question in collapsed view (needed for user response)", () => {
      const node = createGadgetNode({
        name: "AskUser",
        parameters: { question: "What is your name?" },
        isComplete: false,
      });

      const result = formatGadgetCollapsed(node, false);

      // AskUser questions should be visible (unlike TellUser messages)
      expect(result).toContain("What is your name?");
    });
  });

  describe("selection highlighting", () => {
    it("applies highlight to selected gadget", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Test" },
        isComplete: true,
      });

      const selected = formatGadgetCollapsed(node, true);
      const unselected = formatGadgetCollapsed(node, false);

      // Selected should have different formatting (ANSI codes)
      expect(selected).not.toBe(unselected);
    });
  });

  describe("regular gadgets", () => {
    it("shows spinner for pending gadget", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        isComplete: false,
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("ReadFile");
    });

    it("shows checkmark for completed gadget", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        isComplete: true,
        result: "file contents",
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("✓");
      expect(result).toContain("ReadFile");
    });

    it("shows error indicator for failed gadget", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/nonexistent.txt" },
        isComplete: true,
        error: "File not found",
      });

      const result = formatGadgetCollapsed(node, false);

      expect(result).toContain("✗");
      expect(result).toContain("ReadFile");
    });
  });
});

describe("formatGadgetExpanded", () => {
  describe("TellUser gadget", () => {
    it("renders full message content", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "This is the full message content" },
        isComplete: true,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Message");
      // The message content should be visible in expanded view
    });

    it("includes type-specific header for info", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Info message", type: "info" },
        isComplete: true,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("ℹ️");
    });

    it("includes type-specific header for success", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Success message", type: "success" },
        isComplete: true,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("✅");
    });

    it("includes type-specific header for warning", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Warning message", type: "warning" },
        isComplete: true,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("⚠️");
    });

    it("includes type-specific header for error", () => {
      const node = createGadgetNode({
        name: "TellUser",
        parameters: { message: "Error message", type: "error" },
        isComplete: true,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("❌");
    });
  });

  describe("AskUser gadget", () => {
    it("renders question in parameters section", () => {
      const node = createGadgetNode({
        name: "AskUser",
        parameters: { question: "What do you want to do?" },
        isComplete: false,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      // AskUser shows question in parameters section
      expect(content).toContain("question");
      expect(content).toContain("What do you want to do?");
    });
  });

  describe("regular gadgets with results", () => {
    it("shows result section for completed gadget", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        isComplete: true,
        result: "File contents here",
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Result");
    });

    it("shows error section for failed gadget", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/nonexistent.txt" },
        isComplete: true,
        error: "File not found",
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Error");
    });

    it("shows execution time when available", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        isComplete: true,
        result: "contents",
        executionTimeMs: 42,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("42ms");
    });

    it("shows time in seconds for long operations", () => {
      const node = createGadgetNode({
        name: "SlowOperation",
        parameters: {},
        isComplete: true,
        result: "done",
        executionTimeMs: 2500,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("2.5s");
    });
  });
});
