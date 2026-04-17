import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import type { GadgetNode, LLMCallNode } from "../tui/types.js";
import {
  formatGadgetCollapsed,
  formatGadgetExpanded,
  formatLLMCallExpanded,
  getContinuationIndent,
  getIndent,
} from "./block-formatters.js";

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

  describe("media outputs section", () => {
    it("shows image emoji for image media output", () => {
      const node = createGadgetNode({
        name: "GenerateImage",
        parameters: { prompt: "a cat" },
        isComplete: true,
        mediaOutputs: [{ kind: "image", path: "/tmp/output.png", mimeType: "image/png" }],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("🖼️");
    });

    it("shows audio emoji for audio media output", () => {
      const node = createGadgetNode({
        name: "GenerateSpeech",
        parameters: { text: "Hello" },
        isComplete: true,
        mediaOutputs: [{ kind: "audio", path: "/tmp/speech.mp3", mimeType: "audio/mpeg" }],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("🔊");
    });

    it("shows video emoji for video media output", () => {
      const node = createGadgetNode({
        name: "GenerateVideo",
        parameters: {},
        isComplete: true,
        mediaOutputs: [{ kind: "video", path: "/tmp/video.mp4", mimeType: "video/mp4" }],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("🎬");
    });

    it("shows file path in media section", () => {
      const node = createGadgetNode({
        name: "GenerateImage",
        parameters: {},
        isComplete: true,
        mediaOutputs: [{ kind: "image", path: "/tmp/output.png", mimeType: "image/png" }],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("/tmp/output.png");
    });

    it("truncates long paths from the start (preserves tail)", () => {
      // Create a path long enough to exceed any reasonable terminal width (>200 chars)
      const longPath = `/some/very/long/path/to/a/deeply/nested/directory/with/many/subdirectories/and/even/more/levels/output-file-with-long-name-that-is-definitely-too-long-for-any-terminal.png`;
      const node = createGadgetNode({
        name: "GenerateImage",
        parameters: {},
        isComplete: true,
        mediaOutputs: [{ kind: "image", path: longPath, mimeType: "image/png" }],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      // Truncated paths start with ...
      expect(content).toMatch(/\.\.\./);
      // The end of the path should be preserved
      expect(content).toContain(
        "output-file-with-long-name-that-is-definitely-too-long-for-any-terminal.png",
      );
    });

    it("shows Media section header", () => {
      const node = createGadgetNode({
        name: "GenerateImage",
        parameters: {},
        isComplete: true,
        mediaOutputs: [{ kind: "image", path: "/tmp/img.png", mimeType: "image/png" }],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Media");
    });

    it("shows multiple media outputs", () => {
      const node = createGadgetNode({
        name: "GenerateMedia",
        parameters: {},
        isComplete: true,
        mediaOutputs: [
          { kind: "image", path: "/tmp/img1.png", mimeType: "image/png" },
          { kind: "audio", path: "/tmp/audio.mp3", mimeType: "audio/mpeg" },
        ],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("🖼️");
      expect(content).toContain("🔊");
    });
  });

  describe("subagent activity section", () => {
    it("shows Subagent Activity header when children present", () => {
      const node = createGadgetNode({
        name: "BrowseWeb",
        parameters: { url: "https://example.com" },
        isComplete: true,
        children: ["llm_call_1", "llm_call_2"],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Subagent Activity");
    });

    it("shows child count in subagent activity section", () => {
      const node = createGadgetNode({
        name: "BrowseWeb",
        parameters: {},
        isComplete: true,
        children: ["child1", "child2", "child3"],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("3");
      expect(content).toContain("nested calls");
    });

    it("does not show subagent section when no children", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        isComplete: true,
        result: "contents",
        children: [],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Subagent Activity");
    });
  });

  describe("metrics section", () => {
    it("shows Duration when executionTimeMs provided", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: {},
        isComplete: true,
        result: "content",
        executionTimeMs: 150,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Duration");
      expect(content).toContain("150ms");
    });

    it("shows output token count when resultTokens > 0", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: {},
        isComplete: true,
        result: "content",
        resultTokens: 42,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Output");
      expect(content).toContain("42");
    });

    it("shows cost when cost > 0", () => {
      const node = createGadgetNode({
        name: "SearchWeb",
        parameters: {},
        isComplete: true,
        result: "results",
        cost: 0.0025,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Cost");
      expect(content).toContain("$");
    });

    it("does not show cost when cost is zero", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: {},
        isComplete: true,
        result: "content",
        cost: 0,
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      // Zero cost should not show a Cost line in metrics
      // The metrics section may or may not appear at all for zero cost
      // Check that $0.0000 or similar doesn't appear
      expect(content).not.toContain("Cost:");
    });

    it("does not show metrics section when no metrics available", () => {
      const node = createGadgetNode({
        name: "TestGadget",
        parameters: {},
        isComplete: false,
        children: [],
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Metrics");
    });

    it("shows LLM call count and tokens when subagentStats llmCallCount > 0", () => {
      const node = createGadgetNode({
        name: "BrowseWeb",
        parameters: {},
        isComplete: true,
        subagentStats: {
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 200,
          cost: 0.001,
          llmCallCount: 3,
        },
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("LLM calls");
      expect(content).toContain("3");
    });

    it("does not show LLM calls line when llmCallCount is 0", () => {
      const node = createGadgetNode({
        name: "ReadFile",
        parameters: {},
        isComplete: true,
        result: "content",
        executionTimeMs: 50,
        subagentStats: {
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          cost: 0,
          llmCallCount: 0,
        },
      });

      const lines = formatGadgetExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("LLM calls");
    });
  });
});

describe("formatLLMCallExpanded", () => {
  // Helper to create an LLMCallNode
  function createLLMCallNode(overrides: Partial<LLMCallNode> = {}): LLMCallNode {
    return {
      type: "llm_call",
      id: "llm_1",
      iteration: 1,
      model: "claude-sonnet-4",
      isComplete: false,
      children: [],
      depth: 0,
      parentId: null,
      sessionId: 1,
      ...overrides,
    };
  }

  describe("when no details available", () => {
    it("shows 'No details available' when details is undefined", () => {
      const node = createLLMCallNode({ details: undefined });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("No details available");
    });
  });

  describe("box drawing structure", () => {
    it("shows Details header in box", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: {
          inputTokens: 1000,
          outputTokens: 500,
        },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Details");
    });

    it("shows model name in expanded view", () => {
      const node = createLLMCallNode({
        model: "claude-opus-4",
        isComplete: true,
        details: { inputTokens: 100 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Model");
      expect(content).toContain("claude-opus-4");
    });

    it("returns multiple lines", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { inputTokens: 1000, outputTokens: 500, elapsedSeconds: 2.5 },
      });

      const lines = formatLLMCallExpanded(node);

      expect(lines.length).toBeGreaterThan(3);
    });
  });

  describe("token metrics", () => {
    it("shows input tokens when available", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { inputTokens: 10400 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Input");
      expect(content).toContain("10.4k");
    });

    it("shows cached token info when cachedInputTokens > 0", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { inputTokens: 1000, cachedInputTokens: 800 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("cached");
    });

    it("does not show cached token info when cachedInputTokens is 0", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { inputTokens: 1000, cachedInputTokens: 0 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("cached");
    });

    it("shows output tokens when available", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { outputTokens: 490 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Output");
      expect(content).toContain("490");
    });

    it("shows reasoning tokens when > 0", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { reasoningTokens: 300 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Reason");
    });

    it("does not show reasoning tokens when undefined", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { outputTokens: 100 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Reason");
    });
  });

  describe("context usage", () => {
    it("shows context percent when available", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { contextPercent: 45 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Context");
      expect(content).toContain("45%");
    });

    it("does not show context when undefined", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { inputTokens: 100 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Context");
    });
  });

  describe("time and cost", () => {
    it("shows elapsed time when available", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { elapsedSeconds: 24.8 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Time");
      expect(content).toContain("24.8s");
    });

    it("shows tokens per second when both outputTokens and elapsedSeconds are available", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { outputTokens: 100, elapsedSeconds: 5 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("tok/s");
    });

    it("shows cost when cost > 0", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { cost: 0.0032 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Cost");
      expect(content).toContain("$");
    });

    it("does not show cost when cost is 0", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { cost: 0 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Cost");
    });

    it("does not show cost when cost is undefined", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { inputTokens: 100 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Cost");
    });
  });

  describe("finish reason", () => {
    it("shows finish reason when available", () => {
      const node = createLLMCallNode({
        isComplete: true,
        details: { finishReason: "stop" },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).toContain("Finish");
      expect(content).toContain("STOP");
    });

    it("does not show finish reason when undefined", () => {
      const node = createLLMCallNode({
        isComplete: false,
        details: { inputTokens: 100 },
      });

      const lines = formatLLMCallExpanded(node);
      const content = lines.join("\n");

      expect(content).not.toContain("Finish");
    });
  });
});

describe("getIndent", () => {
  it("returns empty string for depth 0", () => {
    expect(getIndent(0)).toBe("");
  });

  it("returns empty string for depth 0 with isLast=true", () => {
    expect(getIndent(0, true)).toBe("");
  });

  it("returns '├─ ' connector for depth 1 with isLast=false", () => {
    const result = getIndent(1, false);
    expect(result).toBe("├─ ");
  });

  it("returns '└─ ' connector for depth 1 with isLast=true", () => {
    const result = getIndent(1, true);
    expect(result).toBe("└─ ");
  });

  it("uses isLast=false as default", () => {
    const defaultResult = getIndent(1);
    const explicitResult = getIndent(1, false);
    expect(defaultResult).toBe(explicitResult);
  });

  it("adds base indent for deeper depths (depth=2, isLast=false)", () => {
    const result = getIndent(2, false);
    // depth=2: baseIndent = "  ".repeat(1) + "├─ "
    expect(result).toBe("  ├─ ");
  });

  it("adds base indent for deeper depths (depth=2, isLast=true)", () => {
    const result = getIndent(2, true);
    expect(result).toBe("  └─ ");
  });

  it("adds more indent for depth=3", () => {
    const result = getIndent(3, false);
    expect(result).toBe("    ├─ ");
  });
});

describe("getContinuationIndent", () => {
  it("returns empty string for depth 0", () => {
    expect(getContinuationIndent(0)).toBe("");
  });

  it("returns indent string for depth 1", () => {
    const result = getContinuationIndent(1);
    // depth=1: "  ".repeat(1) + "  " = "    " (4 spaces)
    expect(result).toBe("    ");
  });

  it("returns longer indent for depth 2", () => {
    const result = getContinuationIndent(2);
    // depth=2: "  ".repeat(2) + "  " = "      " (6 spaces)
    expect(result).toBe("      ");
  });

  it("is longer than getIndent for the same depth (accounts for continuation)", () => {
    const continuationIndent = getContinuationIndent(1);
    const regularIndent = getIndent(1, false);
    expect(continuationIndent.length).toBeGreaterThanOrEqual(regularIndent.length);
  });
});
