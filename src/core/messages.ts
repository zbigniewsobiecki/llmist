import type { BaseGadget } from "../gadgets/gadget.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
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
  private promptConfig: PromptConfig;

  constructor(promptConfig?: PromptConfig) {
    this.promptConfig = promptConfig ?? {};
  }

  addSystem(content: string, metadata?: Record<string, unknown>): this {
    this.messages.push({ role: "system", content, metadata });
    return this;
  }

  addGadgets(
    gadgets: BaseGadget[],
    parameterFormat: ParameterFormat = "json",
    options?: { startPrefix?: string; endPrefix?: string },
  ): this {
    // Store custom prefixes for later use in addGadgetCall
    if (options?.startPrefix) {
      this.startPrefix = options.startPrefix;
    }
    if (options?.endPrefix) {
      this.endPrefix = options.endPrefix;
    }

    const context = {
      parameterFormat,
      startPrefix: this.startPrefix,
      endPrefix: this.endPrefix,
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

    parts.push(this.buildGadgetsXmlSection(gadgets, parameterFormat));
    parts.push(this.buildUsageSection(parameterFormat, context));

    this.messages.push({ role: "system", content: parts.join("") });
    return this;
  }

  private buildGadgetsXmlSection(gadgets: BaseGadget[], parameterFormat: ParameterFormat): string {
    const parts: string[] = [];
    parts.push("<GADGETS>");

    for (const gadget of gadgets) {
      const gadgetName = gadget.name ?? gadget.constructor.name;
      const instruction = gadget.getInstruction(parameterFormat);

      // Parse instruction to separate description and schema
      const schemaMarker =
        parameterFormat === "yaml" ? "\n\nInput Schema (YAML):" : "\n\nInput Schema (JSON):";
      const schemaIndex = instruction.indexOf(schemaMarker);

      const description = (
        schemaIndex !== -1 ? instruction.substring(0, schemaIndex) : instruction
      ).trim();
      const schema =
        schemaIndex !== -1 ? instruction.substring(schemaIndex + schemaMarker.length).trim() : "";

      parts.push("\n  <gadget>");
      parts.push(`\n    <name>${gadgetName}</name>`);
      parts.push(`\n    <description>${description}</description>`);
      if (schema) {
        parts.push(`\n    <schema format="${parameterFormat}">\n${schema}\n    </schema>`);
      }
      parts.push("\n  </gadget>");
    }

    return parts.join("");
  }

  private buildUsageSection(
    parameterFormat: ParameterFormat,
    context: {
      parameterFormat: ParameterFormat;
      startPrefix: string;
      endPrefix: string;
      gadgetCount: number;
      gadgetNames: string[];
    },
  ): string {
    const parts: string[] = [];

    // Use configurable format description
    const formatDescription =
      parameterFormat === "yaml"
        ? resolvePromptTemplate(
            this.promptConfig.formatDescriptionYaml,
            DEFAULT_PROMPTS.formatDescriptionYaml,
            context,
          )
        : resolvePromptTemplate(
            this.promptConfig.formatDescriptionJson,
            DEFAULT_PROMPTS.formatDescriptionJson,
            context,
          );

    parts.push("<usage>");

    // Use configurable critical usage instruction
    const criticalUsage = resolvePromptTemplate(
      this.promptConfig.criticalUsage,
      DEFAULT_PROMPTS.criticalUsage,
      context,
    );
    parts.push(`\n  <critical>${criticalUsage}</critical>`);

    // Format section
    parts.push("\n  <format>");
    parts.push(`\n    <step>Start marker: ${this.startPrefix}gadget_name</step>`);
    parts.push(`\n    <step>${formatDescription}</step>`);
    parts.push(`\n    <step>End marker: ${this.endPrefix}</step>`);
    parts.push("\n  </format>");

    parts.push(this.buildExamplesSection(parameterFormat, context));
    parts.push(this.buildRulesSection(context));

    parts.push("\n</usage>");
    parts.push("\n</GADGETS>\n\n");

    return parts.join("");
  }

  private buildExamplesSection(
    parameterFormat: ParameterFormat,
    context: {
      parameterFormat: ParameterFormat;
      startPrefix: string;
      endPrefix: string;
      gadgetCount: number;
      gadgetNames: string[];
    },
  ): string {
    // Allow custom examples to completely replace default examples
    if (this.promptConfig.customExamples) {
      return this.promptConfig.customExamples(context);
    }

    const parts: string[] = [];
    parts.push("\n  <examples>");

    // Single gadget example
    const singleExample =
      parameterFormat === "yaml"
        ? `${this.startPrefix}translate
from: English
to: Polish
content: Paris is the capital of France.
${this.endPrefix}`
        : `${this.startPrefix}translate
{"from": "English", "to": "Polish", "content": "Paris is the capital of France."}
${this.endPrefix}`;

    parts.push(`\n    <example title="Single Gadget">\n${singleExample}\n    </example>`);

    // Multiple gadgets example
    const multipleExample =
      parameterFormat === "yaml"
        ? `${this.startPrefix}translate
from: English
to: Polish
content: Paris is the capital of France.
${this.endPrefix}
${this.startPrefix}analyze
type: economic_analysis
matter: "Polish Economy"
question: Polish arms exports 2025.
${this.endPrefix}`
        : `${this.startPrefix}translate
{"from": "English", "to": "Polish", "content": "Paris is the capital of France."}
${this.endPrefix}
${this.startPrefix}analyze
{"type": "economic_analysis", "matter": "Polish Economy", "question": "Polish arms exports 2025."}
${this.endPrefix}`;

    parts.push(`\n    <example title="Multiple Gadgets">\n${multipleExample}\n    </example>`);
    parts.push("\n  </examples>");

    return parts.join("");
  }

  private buildRulesSection(context: {
    parameterFormat: ParameterFormat;
    startPrefix: string;
    endPrefix: string;
    gadgetCount: number;
    gadgetNames: string[];
  }): string {
    const parts: string[] = [];
    parts.push("\n  <rules>");

    // Use configurable rules
    const rules = resolveRulesTemplate(this.promptConfig.rules, context);

    for (const rule of rules) {
      parts.push(`\n    <rule>${rule}</rule>`);
    }

    parts.push("\n  </rules>");

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

  addGadgetCall(
    gadget: string,
    parameters: Record<string, unknown>,
    result: string,
    parameterFormat: ParameterFormat = "json",
  ) {
    const paramStr = this.formatParameters(parameters, parameterFormat);

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

  private formatParameters(parameters: Record<string, unknown>, format: ParameterFormat): string {
    if (format === "yaml") {
      return Object.entries(parameters)
        .map(([key, value]) => {
          if (typeof value === "string") {
            return `${key}: ${value}`;
          }
          return `${key}: ${JSON.stringify(value)}`;
        })
        .join("\n");
    }
    return JSON.stringify(parameters);
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
