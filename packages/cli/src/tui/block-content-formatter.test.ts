import { describe, expect, it } from "vitest";
import {
  abbreviateToLines,
  formatBlockContent,
  formatGadgetAsText,
  getSystemMessageColor,
  getSystemMessageIcon,
  isNodeVisibleInFilterMode,
  shouldRenderAsText,
} from "./block-content-formatter.js";
import type {
  GadgetNode,
  LLMCallNode,
  SystemMessageNode,
  TextNode,
  ThinkingNode,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeLLMCallNode(overrides: Partial<LLMCallNode> = {}): LLMCallNode {
  return {
    id: "llm_1",
    type: "llm_call",
    depth: 0,
    parentId: null,
    sessionId: 0,
    iteration: 1,
    model: "test-model",
    isComplete: false,
    children: [],
    ...overrides,
  };
}

function makeGadgetNode(overrides: Partial<GadgetNode> = {}): GadgetNode {
  return {
    id: "gadget_1",
    type: "gadget",
    depth: 0,
    parentId: null,
    sessionId: 0,
    invocationId: "inv1",
    name: "Calculator",
    isComplete: false,
    children: [],
    ...overrides,
  };
}

function makeTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "text_1",
    type: "text",
    depth: 0,
    parentId: null,
    sessionId: 0,
    content: "Hello world",
    children: [] as never[],
    ...overrides,
  };
}

function makeThinkingNode(overrides: Partial<ThinkingNode> = {}): ThinkingNode {
  return {
    id: "thinking_1",
    type: "thinking",
    depth: 0,
    parentId: null,
    sessionId: 0,
    content: "I am thinking...",
    thinkingType: "thinking",
    isComplete: false,
    children: [] as never[],
    ...overrides,
  };
}

function makeSystemMessageNode(overrides: Partial<SystemMessageNode> = {}): SystemMessageNode {
  return {
    id: "system_1",
    type: "system_message",
    depth: 0,
    parentId: null,
    sessionId: 0,
    message: "Rate limit reached",
    category: "throttle",
    children: [] as never[],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// abbreviateToLines
// ─────────────────────────────────────────────────────────────────────────────

describe("abbreviateToLines", () => {
  it("returns full text when within limit", () => {
    const result = abbreviateToLines("line1\nline2", 5, false);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).not.toContain("...");
  });

  it("truncates text to maxLines and adds indicator", () => {
    const text = "line1\nline2\nline3\nline4\nline5";
    const result = abbreviateToLines(text, 2, false);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).not.toContain("line3");
    expect(result).toContain("...");
  });

  it("uses selection indicator when selected", () => {
    const text = "line1\nline2\nline3";
    const result = abbreviateToLines(text, 1, true);
    expect(result).toContain("▶ ...");
  });

  it("uses plain indicator when not selected", () => {
    const text = "line1\nline2\nline3";
    const result = abbreviateToLines(text, 1, false);
    expect(result).toContain("  ...");
  });

  it("skips leading empty lines", () => {
    const text = "\n\n\nline1\nline2";
    const result = abbreviateToLines(text, 5, false);
    expect(result).toContain("line1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSystemMessageIcon
// ─────────────────────────────────────────────────────────────────────────────

describe("getSystemMessageIcon", () => {
  it("returns correct icons for each category", () => {
    expect(getSystemMessageIcon("throttle")).toBe("⏸");
    expect(getSystemMessageIcon("retry")).toBe("🔄");
    expect(getSystemMessageIcon("info")).toBe("ℹ️");
    expect(getSystemMessageIcon("warning")).toBe("⚠️");
    expect(getSystemMessageIcon("error")).toBe("❌");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSystemMessageColor
// ─────────────────────────────────────────────────────────────────────────────

describe("getSystemMessageColor", () => {
  it("returns ANSI color codes for each category", () => {
    const throttleColor = getSystemMessageColor("throttle");
    const retryColor = getSystemMessageColor("retry");
    const infoColor = getSystemMessageColor("info");
    const warningColor = getSystemMessageColor("warning");
    const errorColor = getSystemMessageColor("error");

    // All should be non-empty strings starting with ESC[
    for (const color of [throttleColor, retryColor, infoColor, warningColor, errorColor]) {
      expect(color.startsWith("\x1b[")).toBe(true);
    }

    // throttle and warning should use the same yellow color
    expect(throttleColor).toBe(warningColor);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldRenderAsText
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldRenderAsText", () => {
  it("returns false in full mode", () => {
    const gadget = makeGadgetNode({ name: "TellUser" });
    expect(shouldRenderAsText(gadget, "full")).toBe(false);
  });

  it("returns true for TellUser/AskUser/Finish in focused mode", () => {
    for (const name of ["TellUser", "AskUser", "Finish"]) {
      const gadget = makeGadgetNode({ name });
      expect(shouldRenderAsText(gadget, "focused")).toBe(true);
    }
  });

  it("returns false for other gadgets in focused mode", () => {
    const gadget = makeGadgetNode({ name: "Calculator" });
    expect(shouldRenderAsText(gadget, "focused")).toBe(false);
  });

  it("returns false for non-gadget nodes in focused mode", () => {
    const llm = makeLLMCallNode();
    expect(shouldRenderAsText(llm, "focused")).toBe(false);
  });
});

describe("isNodeVisibleInFilterMode", () => {
  it("keeps text nodes visible in focused mode", () => {
    expect(isNodeVisibleInFilterMode(makeTextNode(), "focused")).toBe(true);
  });

  it("keeps TellUser, AskUser, and Finish visible in focused mode", () => {
    for (const name of ["TellUser", "AskUser", "Finish"]) {
      expect(isNodeVisibleInFilterMode(makeGadgetNode({ name }), "focused")).toBe(true);
    }
  });

  it("hides llm and non user-facing gadget nodes in focused mode", () => {
    expect(isNodeVisibleInFilterMode(makeLLMCallNode(), "focused")).toBe(false);
    expect(isNodeVisibleInFilterMode(makeGadgetNode({ name: "ReadFile" }), "focused")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatGadgetAsText
// ─────────────────────────────────────────────────────────────────────────────

describe("formatGadgetAsText", () => {
  it("formats TellUser message with markdown", () => {
    const gadget = makeGadgetNode({
      name: "TellUser",
      parameters: { message: "Hello **world**" },
    });
    const result = formatGadgetAsText(gadget);
    expect(result).toContain("Hello");
    expect(result.startsWith("\n")).toBe(true);
  });

  it("formats AskUser question with prompt indicator", () => {
    const gadget = makeGadgetNode({
      name: "AskUser",
      parameters: { question: "What is your name?" },
    });
    const result = formatGadgetAsText(gadget);
    expect(result).toContain("? What is your name?");
  });

  it("formats Finish message with completion indicator", () => {
    const gadget = makeGadgetNode({
      name: "Finish",
      parameters: { message: "Task complete!" },
    });
    const result = formatGadgetAsText(gadget);
    expect(result).toContain("✓");
    expect(result).toContain("Task complete!");
  });

  it("returns empty string for Finish with no/empty message", () => {
    const gadget = makeGadgetNode({
      name: "Finish",
      parameters: { message: "" },
    });
    expect(formatGadgetAsText(gadget)).toBe("");
  });

  it("returns empty string for unknown gadget names", () => {
    const gadget = makeGadgetNode({ name: "Calculator" });
    expect(formatGadgetAsText(gadget)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatBlockContent
// ─────────────────────────────────────────────────────────────────────────────

describe("formatBlockContent", () => {
  describe("LLM call nodes", () => {
    it("formats collapsed LLM call", () => {
      const node = makeLLMCallNode();
      const result = formatBlockContent(node, false, false);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("formats expanded LLM call with more lines", () => {
      const collapsedResult = formatBlockContent(makeLLMCallNode(), false, false);
      const expandedResult = formatBlockContent(makeLLMCallNode(), false, true);
      // Expanded should have at least as many lines as collapsed
      expect(expandedResult.split("\n").length).toBeGreaterThanOrEqual(
        collapsedResult.split("\n").length,
      );
    });
  });

  describe("gadget nodes", () => {
    it("formats collapsed gadget", () => {
      const node = makeGadgetNode();
      const result = formatBlockContent(node, false, false);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("text nodes", () => {
    it("formats user text with user message formatter (id starts with user_)", () => {
      const node = makeTextNode({ id: "user_1", content: "Hello!" });
      const result = formatBlockContent(node, false, false);
      // Should use formatUserMessage which adds an icon
      expect(typeof result).toBe("string");
    });

    it("formats regular text with markdown", () => {
      const node = makeTextNode({ content: "**Bold** text" });
      const result = formatBlockContent(node, false, true);
      expect(result).toContain("Bold");
    });

    it("abbreviates text when collapsed", () => {
      const longContent = Array(20).fill("a line of text").join("\n");
      const node = makeTextNode({ content: longContent });
      const collapsed = formatBlockContent(node, false, false);
      const expanded = formatBlockContent(node, false, true);
      // Collapsed should be shorter than expanded
      expect(collapsed.split("\n").length).toBeLessThan(expanded.split("\n").length);
    });
  });

  describe("thinking nodes", () => {
    it("formats collapsed thinking with abbreviated first line", () => {
      const node = makeThinkingNode({ content: "I think therefore I am" });
      const result = formatBlockContent(node, false, false);
      expect(result).toContain("💭");
    });

    it("formats redacted thinking with lock icon", () => {
      const node = makeThinkingNode({ thinkingType: "redacted" });
      const result = formatBlockContent(node, false, false);
      expect(result).toContain("🔒");
    });

    it("formats expanded thinking with full content", () => {
      const node = makeThinkingNode({ content: "My thoughts here" });
      const result = formatBlockContent(node, false, true);
      expect(result).toContain("▼");
      expect(result).toContain("My thoughts here");
    });
  });

  describe("system message nodes", () => {
    it("formats system message with icon and color", () => {
      const node = makeSystemMessageNode({ category: "throttle", message: "Rate limited" });
      const result = formatBlockContent(node, false, false);
      expect(result).toContain("⏸");
      expect(result).toContain("Rate limited");
    });

    it("formats error system message with error icon", () => {
      const node = makeSystemMessageNode({ category: "error", message: "Error occurred" });
      const result = formatBlockContent(node, false, false);
      expect(result).toContain("❌");
    });
  });

  describe("indentation", () => {
    it("applies indentation based on depth", () => {
      const shallow = makeLLMCallNode({ depth: 0 });
      const deep = makeLLMCallNode({ depth: 2 });

      const shallowResult = formatBlockContent(shallow, false, false);
      const deepResult = formatBlockContent(deep, false, false);

      // Deep result should have more leading whitespace
      expect(deepResult.length).toBeGreaterThan(shallowResult.length);
    });
  });
});
