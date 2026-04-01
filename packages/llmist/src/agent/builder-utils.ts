import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { ContentPart, ImageMimeType } from "../core/input-content.js";
import { detectImageMimeType, text, toBase64 } from "../core/input-content.js";
import type { LLMMessage, MessageContent } from "../core/messages.js";
import type { HistoryMessage } from "./builder-types.js";

/**
 * Format a complete gadget call block.
 */
export function formatGadgetCall(
  gadgetName: string,
  invocationId: string,
  parameters: Record<string, unknown>,
  prefixes?: {
    start?: string;
    end?: string;
    arg?: string;
  },
): string {
  const startPrefix = prefixes?.start ?? GADGET_START_PREFIX;
  const endPrefix = prefixes?.end ?? GADGET_END_PREFIX;
  const argPrefix = prefixes?.arg ?? GADGET_ARG_PREFIX;

  const paramStr = formatBlockParameters(parameters, "", argPrefix);

  return `${startPrefix}${gadgetName}:${invocationId}\n${paramStr}\n${endPrefix}`;
}

/**
 * Format parameters as block format with JSON Pointer paths.
 * Used internally by AgentBuilder and SystemMessageBuilder.
 */
export function formatBlockParameters(
  params: Record<string, unknown>,
  prefix: string,
  argPrefix: string = GADGET_ARG_PREFIX,
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const fullPath = prefix ? `${prefix}/${key}` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemPath = `${fullPath}/${index}`;
        if (typeof item === "object" && item !== null) {
          lines.push(formatBlockParameters(item as Record<string, unknown>, itemPath, argPrefix));
        } else {
          lines.push(`${argPrefix}${itemPath}`);
          lines.push(String(item));
        }
      });
    } else if (typeof value === "object" && value !== null) {
      lines.push(formatBlockParameters(value as Record<string, unknown>, fullPath, argPrefix));
    } else {
      lines.push(`${argPrefix}${fullPath}`);
      lines.push(String(value));
    }
  }

  return lines.join("\n");
}

/**
 * Normalize HistoryMessage objects into standard LLMMessage format.
 */
export function normalizeHistory(messages: HistoryMessage[]): Array<{
  role: "system" | "user" | "assistant";
  content: MessageContent;
}> {
  return messages.map((msg) => {
    if ("user" in msg) {
      return { role: "user", content: msg.user };
    }
    if ("assistant" in msg) {
      return { role: "assistant", content: msg.assistant };
    }
    if ("system" in msg) {
      return { role: "system", content: msg.system };
    }
    throw new Error("Invalid history message format");
  });
}

/**
 * Build multimodal content from image data.
 */
export function buildMultimodalContent(
  textPrompt: string,
  imageData: Buffer | Uint8Array | string,
  mimeType?: ImageMimeType,
): ContentPart[] {
  const imageBuffer = typeof imageData === "string" ? Buffer.from(imageData, "base64") : imageData;
  const detectedMime = mimeType ?? detectImageMimeType(imageBuffer);

  if (!detectedMime) {
    throw new Error(
      "Could not detect image MIME type. Please provide the mimeType parameter explicitly.",
    );
  }

  return [
    text(textPrompt),
    {
      type: "image",
      source: {
        type: "base64",
        mediaType: detectedMime,
        data: toBase64(imageBuffer),
      },
    },
  ];
}

/**
 * Extract messages from a previous agent's conversation.
 */
export function extractMessagesFromAgent(agent: {
  getConversation: () => { getConversationHistory: () => LLMMessage[] };
}): Array<{ role: "system" | "user" | "assistant"; content: MessageContent }> {
  const history = agent.getConversation().getConversationHistory();
  return history
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));
}
