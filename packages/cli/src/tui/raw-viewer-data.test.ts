import { describe, expect, test } from "vitest";
import { createRawViewerData, isRawViewerNode } from "./raw-viewer-data.js";
import type { GadgetNode, LLMCallNode, TextNode } from "./types.js";

describe("raw-viewer-data", () => {
  test("maps llm_call nodes to raw viewer data", () => {
    const node: LLMCallNode = {
      id: "llm-1",
      type: "llm_call",
      depth: 0,
      parentId: null,
      sessionId: 1,
      iteration: 2,
      model: "gpt-4o",
      isComplete: true,
      children: [],
      rawRequest: [{ role: "user", content: "Hello" }],
      rawResponse: "Hi",
    };

    expect(createRawViewerData(node, "request")).toEqual({
      mode: "request",
      request: node.rawRequest,
      response: node.rawResponse,
      iteration: 2,
      model: "gpt-4o",
    });
  });

  test("maps gadget nodes to raw viewer data", () => {
    const node: GadgetNode = {
      id: "gadget-1",
      type: "gadget",
      depth: 1,
      parentId: "llm-1",
      sessionId: 1,
      invocationId: "invoke-1",
      name: "ReadFile",
      isComplete: true,
      parameters: { path: "test.txt" },
      result: "contents",
      error: undefined,
      children: [],
    };

    expect(createRawViewerData(node, "response")).toEqual({
      mode: "response",
      gadgetName: "ReadFile",
      parameters: { path: "test.txt" },
      result: "contents",
      error: undefined,
    });
  });

  test("identifies llm_call nodes as raw-viewer compatible", () => {
    const node = {
      id: "llm-1",
      type: "llm_call",
      depth: 0,
      parentId: null,
      sessionId: 1,
      iteration: 1,
      model: "sonnet",
      isComplete: false,
      children: [],
    } as LLMCallNode;

    expect(isRawViewerNode(node)).toBe(true);
  });

  test("identifies gadget nodes as raw-viewer compatible", () => {
    const node = {
      id: "gadget-1",
      type: "gadget",
      depth: 0,
      parentId: null,
      sessionId: 1,
      invocationId: "invoke-1",
      name: "WriteFile",
      isComplete: false,
      children: [],
    } as GadgetNode;

    expect(isRawViewerNode(node)).toBe(true);
  });

  test("rejects non-viewer nodes", () => {
    const node: TextNode = {
      id: "text-1",
      type: "text",
      depth: 0,
      parentId: null,
      sessionId: 1,
      content: "hello",
      children: [],
    };

    expect(isRawViewerNode(node)).toBe(false);
  });
});
