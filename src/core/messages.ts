import type { BaseGadget } from "../gadgets/gadget.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
import type { PromptConfig } from "./prompt-config.js";
import { DEFAULT_PROMPTS, resolvePromptTemplate, resolveRulesTemplate } from "./prompt-config.js";

export type LLMRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: LLMRole;
  content: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export class LLMMessageBuilder {
  private readonly messages: LLMMessage[] = [];
  private startPrefix: string = GADGET_START_PREFIX;
  private endPrefix: string = GADGET_END_PREFIX;
  private argPrefix: string = GADGET_ARG_PREFIX;
  private promptConfig: PromptConfig;

  constructor(promptConfig?: PromptConfig) {
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
    gadgets: BaseGadget[],
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

  private buildGadgetsSection(gadgets: BaseGadget[]): string {
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

  addUser(content: string, metadata?: Record<string, unknown>): this {
    this.messages.push({ role: "user", content, metadata });
    return this;
  }

  addAssistant(content: string, metadata?: Record<string, unknown>): this {
    this.messages.push({ role: "assistant", content, metadata });
    return this;
  }

  addGadgetCall(gadget: string, parameters: Record<string, unknown>, result: string) {
    const paramStr = this.formatBlockParameters(parameters, "");

    // Assistant message with simplified gadget markers (no invocation ID)
    this.messages.push({
      role: "assistant",
      content: `${this.startPrefix}${gadget}\n${paramStr}\n${this.endPrefix}`,
    });

    // User message with result
    this.messages.push({
      role: "user",
      content: `Result: ${result}`,
    });

    return this;
  }

  /**
   * Format parameters as Block format with JSON Pointer paths.
   * Uses the configured argPrefix for consistency with system prompt.
   */
  private formatBlockParameters(
    params: Record<string, unknown>,
    prefix: string,
  ): string {
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
  return (
    (message.role === "system" || message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
};
