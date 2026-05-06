/**
 * Wraps an MCP tool descriptor as a native llmist gadget so the existing
 * gadget executor consumes it without any awareness of MCP.
 *
 * @module mcp/tool-adapter
 */

import { z } from "zod";
import { createGadget } from "../gadgets/create-gadget.js";
import type { AbstractGadget } from "../gadgets/gadget.js";
import { resultWithImage } from "../gadgets/helpers.js";
import type { GadgetExecuteReturn } from "../gadgets/types.js";
import type { McpClient } from "./client.js";
import { type JSONSchemaLike, jsonSchemaToZod } from "./json-schema-to-zod.js";
import type { McpContentBlock, McpToolDescriptor, McpToolResult } from "./types.js";

export interface McpToolAdapterOptions {
  /** Prefix prepended to the gadget name. Used for multi-server name conflict resolution (plan 2). */
  prefix?: string;
}

/**
 * Convert an MCP tool descriptor into a native gadget that delegates to the
 * supplied MCP client.
 */
export function mcpToolToGadget(
  tool: McpToolDescriptor,
  client: McpClient,
  opts?: McpToolAdapterOptions,
): AbstractGadget {
  const gadgetName = (opts?.prefix ?? "") + tool.name;
  const schema = buildSchema(tool.inputSchema as JSONSchemaLike | undefined);
  const description =
    tool.description ?? `MCP tool "${tool.name}" from server "${client.serverName}"`;

  return createGadget({
    name: gadgetName,
    description,
    schema,
    execute: async (params) => {
      const result = await client.callTool(tool.name, params);
      return mcpResultToGadgetReturn(result, tool.name);
    },
  });
}

function buildSchema(inputSchema: JSONSchemaLike | undefined) {
  if (!inputSchema) {
    return z.object({});
  }
  // The MCP spec mandates inputSchema is an object schema, but be defensive:
  // if a server returns a non-object, fall back to an open record.
  const converted = jsonSchemaToZod(inputSchema);
  // If the converted schema is not an object, wrap so createGadget gets an
  // object shape (which the gadget executor expects).
  if (!(converted instanceof z.ZodObject) && !(converted instanceof z.ZodRecord)) {
    return z.object({}).passthrough();
  }
  return converted as unknown as z.ZodObject<z.ZodRawShape>;
}

/**
 * Convert an MCP tools/call result into the gadget's expected return shape.
 *
 * - Pure-text content: returns the joined text as a string.
 * - Mixed text + media: returns an object with `result` (text) and `media`.
 * - Unknown content kinds: round-tripped as JSON in the text result.
 * - isError: throws so the gadget executor surfaces it as a tool error.
 */
function mcpResultToGadgetReturn(result: McpToolResult, toolName: string): GadgetExecuteReturn {
  const blocks = result.content ?? [];
  const textParts: string[] = [];
  const media: Array<{ kind: "image" | "audio"; data: string; mimeType: string }> = [];

  for (const block of blocks) {
    const kind = (block as McpContentBlock).type;
    if (kind === "text" && typeof (block as { text?: unknown }).text === "string") {
      textParts.push((block as { text: string }).text);
    } else if (kind === "image") {
      const b = block as { data: string; mimeType: string };
      media.push({ kind: "image", data: b.data, mimeType: b.mimeType });
    } else if (kind === "audio") {
      const b = block as { data: string; mimeType: string };
      media.push({ kind: "audio", data: b.data, mimeType: b.mimeType });
    } else {
      // Unknown content kind — preserve as JSON in text so the LLM can see it.
      try {
        textParts.push(JSON.stringify(block));
      } catch {
        textParts.push(String(block));
      }
    }
  }

  const text = textParts.join("\n");

  if (result.isError) {
    throw new Error(
      text ? text : `MCP tool "${toolName}" returned an error result with no text content`,
    );
  }

  if (media.length === 0) {
    return text;
  }

  // Mixed media + text. Use the existing media helpers for images; for audio,
  // construct the result-with-media shape directly since detection helpers
  // can't recover from a base64-only audio payload without seeking.
  if (media.length === 1 && media[0]!.kind === "image") {
    const img = media[0]!;
    return resultWithImage(text, Buffer.from(img.data, "base64"), {
      mimeType: img.mimeType,
    });
  }

  return {
    result: text,
    media: media.map((m) => ({
      kind: m.kind,
      data: m.data,
      mimeType: m.mimeType,
    })),
  };
}
