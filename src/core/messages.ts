import type { BaseGadget } from "../gadgets/gadget.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
import type { PromptConfig, PromptTemplate } from "./prompt-config.js";
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

    parts.push(this.buildGadgetsSection(gadgets, parameterFormat));
    parts.push(this.buildUsageSection(parameterFormat, context));

    this.messages.push({ role: "system", content: parts.join("") });
    return this;
  }

  private buildGadgetsSection(gadgets: BaseGadget[], parameterFormat: ParameterFormat): string {
    const parts: string[] = [];
    parts.push("\n\nAVAILABLE GADGETS");
    parts.push("\n=================\n");

    for (const gadget of gadgets) {
      const gadgetName = gadget.name ?? gadget.constructor.name;
      const instruction = gadget.getInstruction(parameterFormat);

      // Parse instruction to separate description and schema
      const schemaMarkers: Record<ParameterFormat, string> = {
        yaml: "\n\nInput Schema (YAML):",
        json: "\n\nInput Schema (JSON):",
        toml: "\n\nInput Schema (TOML):",
        auto: "\n\nInput Schema (JSON):", // auto defaults to JSON schema display
      };
      const schemaMarker = schemaMarkers[parameterFormat];
      const schemaIndex = instruction.indexOf(schemaMarker);

      const description = (
        schemaIndex !== -1 ? instruction.substring(0, schemaIndex) : instruction
      ).trim();
      const schema =
        schemaIndex !== -1 ? instruction.substring(schemaIndex + schemaMarker.length).trim() : "";

      parts.push(`\nGADGET: ${gadgetName}`);
      parts.push(`\n${description}`);
      if (schema) {
        parts.push(`\n\nPARAMETERS (${parameterFormat.toUpperCase()}):\n${schema}`);
      }
      parts.push("\n\n---");
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
    const formatDescriptionMap: Record<
      ParameterFormat,
      { config?: PromptTemplate; defaultValue: PromptTemplate }
    > = {
      yaml: {
        config: this.promptConfig.formatDescriptionYaml,
        defaultValue: DEFAULT_PROMPTS.formatDescriptionYaml,
      },
      json: {
        config: this.promptConfig.formatDescriptionJson,
        defaultValue: DEFAULT_PROMPTS.formatDescriptionJson,
      },
      toml: {
        config: this.promptConfig.formatDescriptionToml,
        defaultValue: DEFAULT_PROMPTS.formatDescriptionToml,
      },
      auto: {
        config: this.promptConfig.formatDescriptionJson,
        defaultValue: DEFAULT_PROMPTS.formatDescriptionJson,
      },
    };
    const { config, defaultValue } = formatDescriptionMap[parameterFormat];
    const formatDescription = resolvePromptTemplate(config, defaultValue, context);

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

    parts.push(this.buildExamplesSection(parameterFormat, context));
    parts.push(this.buildRulesSection(context));

    parts.push("\n");

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

    // Format-specific single gadget examples
    const singleExamples: Record<ParameterFormat, string> = {
      yaml: `${this.startPrefix}translate
from: English
to: Polish
content: "Paris is the capital of France: a beautiful city."
${this.endPrefix}`,
      json: `${this.startPrefix}translate
{"from": "English", "to": "Polish", "content": "Paris is the capital of France: a beautiful city."}
${this.endPrefix}`,
      toml: `${this.startPrefix}translate
from = "English"
to = "Polish"
content = "Paris is the capital of France: a beautiful city."
${this.endPrefix}`,
      auto: `${this.startPrefix}translate
{"from": "English", "to": "Polish", "content": "Paris is the capital of France: a beautiful city."}
${this.endPrefix}`,
    };

    parts.push(`\n\nEXAMPLE (Single Gadget):\n\n${singleExamples[parameterFormat]}`);

    // Format-specific multiple gadget examples (with multiline content)
    const multipleExamples: Record<ParameterFormat, string> = {
      yaml: `${this.startPrefix}translate
from: English
to: Polish
content: "Paris is the capital of France: a beautiful city."
${this.endPrefix}
${this.startPrefix}analyze
type: economic_analysis
matter: "Polish Economy"
question: |
  Analyze the following:
  - Polish arms exports 2025
  - Economic implications
${this.endPrefix}`,
      json: `${this.startPrefix}translate
{"from": "English", "to": "Polish", "content": "Paris is the capital of France: a beautiful city."}
${this.endPrefix}
${this.startPrefix}analyze
{"type": "economic_analysis", "matter": "Polish Economy", "question": "Analyze the following: Polish arms exports 2025, economic implications"}
${this.endPrefix}`,
      toml: `${this.startPrefix}translate
from = "English"
to = "Polish"
content = "Paris is the capital of France: a beautiful city."
${this.endPrefix}
${this.startPrefix}analyze
type = "economic_analysis"
matter = "Polish Economy"
question = """
Analyze the following:
- Polish arms exports 2025
- Economic implications
"""
${this.endPrefix}`,
      auto: `${this.startPrefix}translate
{"from": "English", "to": "Polish", "content": "Paris is the capital of France: a beautiful city."}
${this.endPrefix}
${this.startPrefix}analyze
{"type": "economic_analysis", "matter": "Polish Economy", "question": "Analyze the following: Polish arms exports 2025, economic implications"}
${this.endPrefix}`,
    };

    parts.push(`\n\nEXAMPLE (Multiple Gadgets):\n\n${multipleExamples[parameterFormat]}`);

    // Add format-specific syntax guides
    if (parameterFormat === "yaml") {
      parts.push(`

YAML MULTILINE SYNTAX:
For string values with special characters (colons, dashes, quotes) or multiple lines,
use the pipe (|) syntax. ALL content lines MUST be indented with 2 spaces:

CORRECT - all lines indented:
question: |
  Which option do you prefer?
  - Option A: fast processing
  - Option B: thorough analysis
  Please choose one.

WRONG - inconsistent indentation breaks YAML:
question: |
  Which option do you prefer?
  - Option A: fast
Please choose one.    <-- ERROR: not indented, breaks out of the block`);
    } else if (parameterFormat === "toml") {
      parts.push(`

TOML MULTILINE SYNTAX:
For string values with multiple lines or special characters, use triple-quotes ("""):

filePath = "README.md"
content = """
# Project Title

This content can contain:
- Markdown lists
- Special characters: # : -
- Multiple paragraphs
"""`);
    }

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
    if (format === "toml") {
      return Object.entries(parameters)
        .map(([key, value]) => {
          if (typeof value === "string" && value.includes("\n")) {
            return `${key} = """\n${value}\n"""`;
          }
          return `${key} = ${JSON.stringify(value)}`;
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
