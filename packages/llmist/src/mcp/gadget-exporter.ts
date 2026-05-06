/**
 * Convert native llmist gadgets into MCP tool descriptors and run them on
 * behalf of an MCP server. The inverse of `tool-adapter.ts` (which converts
 * MCP tools into native gadgets).
 *
 * @module mcp/gadget-exporter
 */

import type { AbstractGadget } from "../gadgets/gadget.js";
import { schemaToJSONSchema } from "../gadgets/schema-to-json.js";
import type {
  GadgetExecuteResultWithMedia,
  GadgetExecuteReturn,
  GadgetMediaOutput,
} from "../gadgets/types.js";
import { validateAndApplyDefaults } from "../gadgets/validation.js";
import type { McpContentBlock, McpToolDescriptor, McpToolResult } from "./types.js";

/** Convert a native gadget into an MCP tool descriptor. */
export function gadgetToMcpTool(gadget: AbstractGadget): McpToolDescriptor {
  const description =
    gadget.description && gadget.description.length > 0
      ? gadget.description
      : `Native llmist gadget "${gadget.name ?? "unnamed"}"`;
  let inputSchema: Record<string, unknown>;
  if (gadget.parameterSchema) {
    inputSchema = schemaToJSONSchema(gadget.parameterSchema);
  } else {
    inputSchema = { type: "object", properties: {} };
  }
  return {
    name: gadget.name ?? "unnamed-gadget",
    description,
    inputSchema,
  };
}

/**
 * Convert a gadget's execute() return value into MCP content blocks.
 *
 * Shapes handled:
 *  - string → single `text` block
 *  - { result, media[] } → `text` block + per-media block
 *  - other (object) → JSON-stringified `text` block
 */
export function gadgetResultToMcpContent(
  ret: GadgetExecuteReturn,
): McpContentBlock[] {
  if (typeof ret === "string") {
    return [{ type: "text", text: ret }];
  }
  if (ret && typeof ret === "object" && "result" in ret) {
    const r = ret as GadgetExecuteResultWithMedia;
    const blocks: McpContentBlock[] = [];
    if (typeof r.result === "string") {
      blocks.push({ type: "text", text: r.result });
    } else {
      blocks.push({ type: "text", text: JSON.stringify(r.result) });
    }
    if (r.media) {
      for (const m of r.media as GadgetMediaOutput[]) {
        if (m.kind === "image" || m.kind === "audio") {
          blocks.push({
            type: m.kind,
            data: m.data,
            mimeType: m.mimeType,
          });
        }
      }
    }
    return blocks;
  }
  // Plain object or primitive — stringify.
  return [{ type: "text", text: JSON.stringify(ret) }];
}

/**
 * Validate params and run the gadget, converting both the success and error
 * paths into MCP tool result shapes.
 *
 * Used by the McpServer's `tools/call` handler.
 */
export async function runGadgetForMcp(
  gadget: AbstractGadget,
  rawParams: unknown,
): Promise<McpToolResult> {
  // Validate input against the gadget's Zod schema (if any).
  if (gadget.parameterSchema) {
    const validation = validateAndApplyDefaults(
      gadget.parameterSchema,
      (rawParams as Record<string, unknown>) ?? {},
    );
    if (!validation.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid arguments for gadget "${gadget.name}": ${validation.error}`,
          },
        ],
      };
    }
    rawParams = validation.data;
  }

  try {
    const result = await gadget.execute(rawParams as Record<string, unknown>);
    return {
      content: gadgetResultToMcpContent(result),
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Gadget "${gadget.name}" failed: ${(err as Error).message}`,
        },
      ],
    };
  }
}
