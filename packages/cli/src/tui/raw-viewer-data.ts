import type { LLMMessage } from "llmist";
import type { RawViewerMode } from "./raw-viewer.js";
import type { BlockNode, GadgetNode, LLMCallNode } from "./types.js";

export interface RawViewerData {
  mode: RawViewerMode;
  request?: LLMMessage[];
  response?: string;
  iteration?: number;
  model?: string;
  gadgetName?: string;
  parameters?: Record<string, unknown>;
  result?: string;
  error?: string;
}

export type RawViewerNode = LLMCallNode | GadgetNode;

export function isRawViewerNode(node: BlockNode): node is RawViewerNode {
  return node.type === "llm_call" || node.type === "gadget";
}

export function createRawViewerData(node: RawViewerNode, mode: RawViewerMode): RawViewerData {
  if (node.type === "llm_call") {
    return {
      mode,
      request: node.rawRequest,
      response: node.rawResponse,
      iteration: node.iteration,
      model: node.model,
    };
  }

  return {
    mode,
    gadgetName: node.name,
    parameters: node.parameters,
    result: node.result,
    error: node.error,
  };
}
