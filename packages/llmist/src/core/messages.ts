import type { AbstractGadget } from "../gadgets/gadget.js";
import type { GadgetMediaOutput } from "../gadgets/types.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
import type {
  AudioMimeType,
  ContentPart,
  ImageMimeType,
  TextContentPart,
} from "./input-content.js";
import {
  audioFromBase64,
  audioFromBuffer,
  detectImageMimeType,
  imageFromBase64,
  imageFromBuffer,
  imageFromUrl,
  text,
  toBase64,
} from "./input-content.js";
import type { PromptTemplateConfig } from "./prompt-config.js";
import { DEFAULT_PROMPTS, resolvePromptTemplate, resolveRulesTemplate } from "./prompt-config.js";

export type MessageRole = "system" | "user" | "assistant";

/**
 * Message content can be a simple string (text only) or an array of content parts (multimodal).
 * Using a string is simpler for text-only messages, while arrays support images and audio.
 */
export type MessageContent = string | ContentPart[];

export interface LLMMessage {
  role: MessageRole;
  content: MessageContent;
  name?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Normalize message content to an array of content parts.
 * Converts string content to a single text part.
 *
 * @param content - Message content (string or ContentPart[])
 * @returns Array of content parts
 */
export function normalizeMessageContent(content: MessageContent): ContentPart[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/**
 * Extract text from message content.
 * Concatenates all text parts in the content.
 *
 * @param content - Message content (string or ContentPart[])
 * @returns Combined text from all text parts
 */
export function extractMessageText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is TextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export class LLMMessageBuilder {
  private readonly messages: LLMMessage[] = [];
  private startPrefix: string = GADGET_START_PREFIX;
  private endPrefix: string = GADGET_END_PREFIX;
  private argPrefix: string = GADGET_ARG_PREFIX;
  private promptConfig: PromptTemplateConfig;

  constructor(promptConfig?: PromptTemplateConfig) {
    this.promptConfig = promptConfig ?? {};
  }

  /**
   * Set custom prefixes for gadget markers.
   * Used to configure history builder to match system prompt markers.
   */
  withPrefixes(startPrefix: string, endPrefix: string, argPrefix?: string): this {
    this.startPrefix = startPrefix;
    this.endPrefix = endPrefix;
    if (argPrefix) {
      this.argPrefix = argPrefix;
    }
    return this;
  }

  addSystem(content: string, metadata?: Record<string, unknown>): this {
    this.messages.push({ role: "system", content, metadata });
    return this;
  }

  addGadgets(
    gadgets: AbstractGadget[],
    options?: { startPrefix?: string; endPrefix?: string; argPrefix?: string },
  ): this {
    // Store custom prefixes for later use in addGadgetCall
    if (options?.startPrefix) {
      this.startPrefix = options.startPrefix;
    }
    if (options?.endPrefix) {
      this.endPrefix = options.endPrefix;
    }
    if (options?.argPrefix) {
      this.argPrefix = options.argPrefix;
    }

    const context = {
      startPrefix: this.startPrefix,
      endPrefix: this.endPrefix,
      argPrefix: this.argPrefix,
      gadgetCount: gadgets.length,
      gadgetNames: gadgets.map((g) => g.name ?? g.constructor.name),
    };

    const parts: string[] = [];

    // Use configurable main instruction
    const mainInstruction = resolvePromptTemplate(
      this.promptConfig.mainInstruction,
      DEFAULT_PROMPTS.mainInstruction,
      context,
    );
    parts.push(mainInstruction);

    parts.push(this.buildGadgetsSection(gadgets));
    parts.push(this.buildUsageSection(context));

    this.messages.push({ role: "system", content: parts.join("") });
    return this;
  }

  private buildGadgetsSection(gadgets: AbstractGadget[]): string {
    const parts: string[] = [];
    parts.push("\n\nAVAILABLE GADGETS");
    parts.push("\n=================\n");

    for (const gadget of gadgets) {
      const gadgetName = gadget.name ?? gadget.constructor.name;
      const instruction = gadget.getInstruction(this.argPrefix);

      // Parse instruction to separate description and schema
      const schemaMarker = "\n\nInput Schema (BLOCK):";
      const schemaIndex = instruction.indexOf(schemaMarker);

      const description = (
        schemaIndex !== -1 ? instruction.substring(0, schemaIndex) : instruction
      ).trim();
      const schema =
        schemaIndex !== -1 ? instruction.substring(schemaIndex + schemaMarker.length).trim() : "";

      parts.push(`\nGADGET: ${gadgetName}`);
      parts.push(`\n${description}`);
      if (schema) {
        parts.push(`\n\nPARAMETERS (BLOCK):\n${schema}`);
      }
      parts.push("\n\n---");
    }

    return parts.join("");
  }

  private buildUsageSection(context: {
    startPrefix: string;
    endPrefix: string;
    argPrefix: string;
    gadgetCount: number;
    gadgetNames: string[];
  }): string {
    const parts: string[] = [];

    // Use configurable format description
    const formatDescription = resolvePromptTemplate(
      this.promptConfig.formatDescription,
      DEFAULT_PROMPTS.formatDescription,
      context,
    );

    parts.push("\n\nHOW TO INVOKE GADGETS");
    parts.push("\n=====================\n");

    // Use configurable critical usage instruction
    const criticalUsage = resolvePromptTemplate(
      this.promptConfig.criticalUsage,
      DEFAULT_PROMPTS.criticalUsage,
      context,
    );
    parts.push(`\nCRITICAL: ${criticalUsage}\n`);

    // Format section
    parts.push("\nFORMAT:");
    parts.push(`\n  1. Start marker: ${this.startPrefix}gadget_name`);
    parts.push(`\n     With ID: ${this.startPrefix}gadget_name:my_id`);
    parts.push(`\n     With dependencies: ${this.startPrefix}gadget_name:my_id:dep1,dep2`);
    parts.push(`\n  2. ${formatDescription}`);
    parts.push(`\n  3. End marker: ${this.endPrefix}`);

    parts.push(this.buildExamplesSection(context));
    parts.push(this.buildRulesSection(context));

    parts.push("\n");

    return parts.join("");
  }

  private buildExamplesSection(context: {
    startPrefix: string;
    endPrefix: string;
    argPrefix: string;
    gadgetCount: number;
    gadgetNames: string[];
  }): string {
    // Allow custom examples to completely replace default examples
    if (this.promptConfig.customExamples) {
      return this.promptConfig.customExamples(context);
    }

    const parts: string[] = [];

    // Single gadget example
    const singleExample = `${this.startPrefix}translate
${this.argPrefix}from
English
${this.argPrefix}to
Polish
${this.argPrefix}content
Paris is the capital of France: a beautiful city.
${this.endPrefix}`;

    parts.push(`\n\nEXAMPLE (Single Gadget):\n\n${singleExample}`);

    // Multiple gadget example with multiline content
    const multipleExample = `${this.startPrefix}translate
${this.argPrefix}from
English
${this.argPrefix}to
Polish
${this.argPrefix}content
Paris is the capital of France: a beautiful city.
${this.endPrefix}
${this.startPrefix}analyze
${this.argPrefix}type
economic_analysis
${this.argPrefix}matter
Polish Economy
${this.argPrefix}question
Analyze the following:
- Polish arms exports 2025
- Economic implications
${this.endPrefix}`;

    parts.push(`\n\nEXAMPLE (Multiple Gadgets):\n\n${multipleExample}`);

    // Dependency example
    const dependencyExample = `${this.startPrefix}fetch_data:fetch_1
${this.argPrefix}url
https://api.example.com/users
${this.endPrefix}
${this.startPrefix}fetch_data:fetch_2
${this.argPrefix}url
https://api.example.com/orders
${this.endPrefix}
${this.startPrefix}merge_data:merge_1:fetch_1,fetch_2
${this.argPrefix}format
json
${this.endPrefix}`;

    parts.push(`\n\nEXAMPLE (With Dependencies):
merge_1 waits for fetch_1 AND fetch_2 to complete.
If either fails, merge_1 is automatically skipped.

${dependencyExample}`);

    // Block format syntax guide
    parts.push(`

BLOCK FORMAT SYNTAX:
Block format uses ${this.argPrefix}name markers. Values are captured verbatim until the next marker.

${this.argPrefix}filename
calculator.ts
${this.argPrefix}code
class Calculator {
  private history: string[] = [];

  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(\`\${a} + \${b} = \${result}\`);
    return result;
  }
}

BLOCK FORMAT RULES:
- Each parameter starts with ${this.argPrefix}parameterName on its own line
- The value starts on the NEXT line after the marker
- Value ends when the next ${this.argPrefix} or ${this.endPrefix} appears
- NO escaping needed - write values exactly as they should appear
- Perfect for code, JSON, markdown, or any content with special characters

NESTED OBJECTS (use / separator):
${this.argPrefix}config/timeout
30
${this.argPrefix}config/retries
3
Produces: { "config": { "timeout": "30", "retries": "3" } }

ARRAYS (use numeric indices):
${this.argPrefix}items/0
first
${this.argPrefix}items/1
second
Produces: { "items": ["first", "second"] }`);

    return parts.join("");
  }

  private buildRulesSection(context: {
    startPrefix: string;
    endPrefix: string;
    argPrefix: string;
    gadgetCount: number;
    gadgetNames: string[];
  }): string {
    const parts: string[] = [];
    parts.push("\n\nRULES:");

    // Use configurable rules
    const rules = resolveRulesTemplate(this.promptConfig.rules, context);

    for (const rule of rules) {
      parts.push(`\n  - ${rule}`);
    }

    return parts.join("");
  }

  /**
   * Add a user message.
   * Content can be a string (text only) or an array of content parts (multimodal).
   *
   * @param content - Message content
   * @param metadata - Optional metadata
   *
   * @example
   * ```typescript
   * // Text only
   * builder.addUser("Hello!");
   *
   * // Multimodal
   * builder.addUser([
   *   text("What's in this image?"),
   *   imageFromBuffer(imageData),
   * ]);
   * ```
   */
  addUser(content: MessageContent, metadata?: Record<string, unknown>): this {
    this.messages.push({ role: "user", content, metadata });
    return this;
  }

  addAssistant(content: string, metadata?: Record<string, unknown>): this {
    this.messages.push({ role: "assistant", content, metadata });
    return this;
  }

  /**
   * Add a user message with an image attachment.
   *
   * @param textContent - Text prompt
   * @param imageData - Image data (Buffer, Uint8Array, or base64 string)
   * @param mimeType - Optional MIME type (auto-detected if not provided)
   *
   * @example
   * ```typescript
   * builder.addUserWithImage(
   *   "What's in this image?",
   *   await fs.readFile("photo.jpg"),
   *   "image/jpeg"  // Optional - auto-detected
   * );
   * ```
   */
  addUserWithImage(
    textContent: string,
    imageData: Buffer | Uint8Array | string,
    mimeType?: ImageMimeType,
  ): this {
    const imageBuffer =
      typeof imageData === "string" ? Buffer.from(imageData, "base64") : imageData;
    const detectedMime = mimeType ?? detectImageMimeType(imageBuffer);

    if (!detectedMime) {
      throw new Error(
        "Could not detect image MIME type. Please provide the mimeType parameter explicitly.",
      );
    }

    const content: ContentPart[] = [
      text(textContent),
      {
        type: "image",
        source: {
          type: "base64",
          mediaType: detectedMime,
          data: toBase64(imageBuffer),
        },
      },
    ];

    this.messages.push({ role: "user", content });
    return this;
  }

  /**
   * Add a user message with an image URL (OpenAI only).
   *
   * @param textContent - Text prompt
   * @param imageUrl - URL to the image
   *
   * @example
   * ```typescript
   * builder.addUserWithImageUrl(
   *   "What's in this image?",
   *   "https://example.com/image.jpg"
   * );
   * ```
   */
  addUserWithImageUrl(textContent: string, imageUrl: string): this {
    const content: ContentPart[] = [text(textContent), imageFromUrl(imageUrl)];
    this.messages.push({ role: "user", content });
    return this;
  }

  /**
   * Add a user message with an audio attachment (Gemini only).
   *
   * @param textContent - Text prompt
   * @param audioData - Audio data (Buffer, Uint8Array, or base64 string)
   * @param mimeType - Optional MIME type (auto-detected if not provided)
   *
   * @example
   * ```typescript
   * builder.addUserWithAudio(
   *   "Transcribe this audio",
   *   await fs.readFile("recording.mp3"),
   *   "audio/mp3"  // Optional - auto-detected
   * );
   * ```
   */
  addUserWithAudio(
    textContent: string,
    audioData: Buffer | Uint8Array | string,
    mimeType?: AudioMimeType,
  ): this {
    const audioBuffer =
      typeof audioData === "string" ? Buffer.from(audioData, "base64") : audioData;

    const content: ContentPart[] = [text(textContent), audioFromBuffer(audioBuffer, mimeType)];
    this.messages.push({ role: "user", content });
    return this;
  }

  /**
   * Add a user message with multiple content parts.
   * Provides full flexibility for complex multimodal messages.
   *
   * @param parts - Array of content parts
   *
   * @example
   * ```typescript
   * builder.addUserMultimodal([
   *   text("Compare these images:"),
   *   imageFromBuffer(image1),
   *   imageFromBuffer(image2),
   * ]);
   * ```
   */
  addUserMultimodal(parts: ContentPart[]): this {
    this.messages.push({ role: "user", content: parts });
    return this;
  }

  /**
   * Record a gadget execution result in the message history.
   * Creates an assistant message with the gadget invocation and a user message with the result.
   *
   * The invocationId is shown to the LLM so it can reference previous calls when building dependencies.
   *
   * @param gadget - Name of the gadget that was executed
   * @param parameters - Parameters that were passed to the gadget
   * @param result - Text result from the gadget execution
   * @param invocationId - Invocation ID (shown to LLM so it can reference for dependencies)
   * @param media - Optional media outputs from the gadget
   * @param mediaIds - Optional IDs for the media outputs
   */
  addGadgetCallResult(
    gadget: string,
    parameters: Record<string, unknown>,
    result: string,
    invocationId: string,
    media?: GadgetMediaOutput[],
    mediaIds?: string[],
  ) {
    const paramStr = this.formatBlockParameters(parameters, "");

    // Assistant message with gadget markers and invocation ID
    this.messages.push({
      role: "assistant",
      content: `${this.startPrefix}${gadget}:${invocationId}\n${paramStr}\n${this.endPrefix}`,
    });

    // User message with result, including invocation ID so LLM can reference it
    if (media && media.length > 0 && mediaIds && mediaIds.length > 0) {
      // Build text with ID references (include kind for clarity)
      const idRefs = media.map((m, i) => `[Media: ${mediaIds[i]} (${m.kind})]`).join("\n");
      const textWithIds = `Result (${invocationId}): ${result}\n${idRefs}`;

      // Build multimodal content: text + media content parts
      const parts: ContentPart[] = [text(textWithIds)];
      for (const item of media) {
        // Convert based on media kind
        if (item.kind === "image") {
          parts.push(imageFromBase64(item.data, item.mimeType as ImageMimeType));
        } else if (item.kind === "audio") {
          parts.push(audioFromBase64(item.data, item.mimeType as AudioMimeType));
        }
        // Note: video and file types are stored but not included in LLM context
        // as most providers don't support them yet
      }
      this.messages.push({ role: "user", content: parts });
    } else {
      // Simple text result
      this.messages.push({
        role: "user",
        content: `Result (${invocationId}): ${result}`,
      });
    }

    return this;
  }

  /**
   * Format parameters as Block format with JSON Pointer paths.
   * Uses the configured argPrefix for consistency with system prompt.
   */
  private formatBlockParameters(params: Record<string, unknown>, prefix: string): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(params)) {
      const fullPath = prefix ? `${prefix}/${key}` : key;

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const itemPath = `${fullPath}/${index}`;
          if (typeof item === "object" && item !== null) {
            lines.push(this.formatBlockParameters(item as Record<string, unknown>, itemPath));
          } else {
            lines.push(`${this.argPrefix}${itemPath}`);
            lines.push(String(item));
          }
        });
      } else if (typeof value === "object" && value !== null) {
        lines.push(this.formatBlockParameters(value as Record<string, unknown>, fullPath));
      } else {
        lines.push(`${this.argPrefix}${fullPath}`);
        lines.push(String(value));
      }
    }

    return lines.join("\n");
  }

  build(): LLMMessage[] {
    return [...this.messages];
  }
}

export const isLLMMessage = (value: unknown): value is LLMMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Partial<LLMMessage>;
  const validRole =
    message.role === "system" || message.role === "user" || message.role === "assistant";
  const validContent = typeof message.content === "string" || Array.isArray(message.content);

  return validRole && validContent;
};
