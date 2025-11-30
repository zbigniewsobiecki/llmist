import type { BaseGadget } from "../gadgets/gadget.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
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

  /**
   * Set custom prefixes for gadget markers.
   * Used to configure history builder to match system prompt markers.
   */
  withPrefixes(startPrefix: string, endPrefix: string): this {
    this.startPrefix = startPrefix;
    this.endPrefix = endPrefix;
    return this;
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
        xml: "\n\nInput Schema (XML):",
        block: "\n\nInput Schema (BLOCK):",
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
      xml: {
        config: this.promptConfig.formatDescriptionXml,
        defaultValue: DEFAULT_PROMPTS.formatDescriptionXml,
      },
      block: {
        config: this.promptConfig.formatDescriptionBlock,
        defaultValue: DEFAULT_PROMPTS.formatDescriptionBlock,
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
      xml: `${this.startPrefix}translate
<from>English</from>
<to>Polish</to>
<content>Paris is the capital of France: a beautiful city.</content>
${this.endPrefix}`,
      block: `${this.startPrefix}translate
${GADGET_ARG_PREFIX}from
English
${GADGET_ARG_PREFIX}to
Polish
${GADGET_ARG_PREFIX}content
Paris is the capital of France: a beautiful city.
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
question: <<<EOF
Analyze the following:
- Polish arms exports 2025
- Economic implications
EOF
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
question = <<<EOF
Analyze the following:
- Polish arms exports 2025
- Economic implications
EOF
${this.endPrefix}`,
      xml: `${this.startPrefix}translate
<from>English</from>
<to>Polish</to>
<content>Paris is the capital of France: a beautiful city.</content>
${this.endPrefix}
${this.startPrefix}analyze
<type>economic_analysis</type>
<matter>Polish Economy</matter>
<question><![CDATA[Analyze the following:
- Polish arms exports 2025
- Economic implications]]></question>
${this.endPrefix}`,
      block: `${this.startPrefix}translate
${GADGET_ARG_PREFIX}from
English
${GADGET_ARG_PREFIX}to
Polish
${GADGET_ARG_PREFIX}content
Paris is the capital of France: a beautiful city.
${this.endPrefix}
${this.startPrefix}analyze
${GADGET_ARG_PREFIX}type
economic_analysis
${GADGET_ARG_PREFIX}matter
Polish Economy
${GADGET_ARG_PREFIX}question
Analyze the following:
- Polish arms exports 2025
- Economic implications
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

YAML HEREDOC SYNTAX:
For string values with multiple lines, use heredoc syntax (<<<DELIMITER...DELIMITER):

filePath: "README.md"
content: <<<EOF
# Project Title

This content can contain:
- Markdown lists
- Special characters: # : -
- Multiple paragraphs
EOF

The delimiter (EOF) can be any identifier. The closing delimiter must be on its own line.
No indentation is required for the content.`);
    } else if (parameterFormat === "toml") {
      parts.push(`

TOML HEREDOC SYNTAX:
For string values with multiple lines, use heredoc syntax (<<<DELIMITER...DELIMITER):

filePath = "README.md"
content = <<<EOF
# Project Title

This content can contain:
- Markdown lists
- Special characters: # : -
- Multiple paragraphs
EOF

The delimiter (EOF) can be any identifier. The closing delimiter must be on its own line.
IMPORTANT: Content inside heredoc is LITERAL - do NOT escape backticks, dollar signs, or any characters.
NEVER use TOML triple-quote strings ("""). ALWAYS use heredoc syntax (<<<EOF...EOF) for multiline content.`);
    } else if (parameterFormat === "xml") {
      parts.push(`

XML PARAMETER SYNTAX:

Basic parameters - use XML tags:
<from>English</from>
<to>Polish</to>
<count>42</count>
<enabled>true</enabled>

Arrays - use repeated child tags:
<items>
  <item>first</item>
  <item>second</item>
</items>

Nested objects - nest the tags:
<config>
  <timeout>30</timeout>
  <retries>3</retries>
</config>

⚠️ CRITICAL FOR CODE AND MULTILINE CONTENT:
ALWAYS wrap code, scripts, or multiline text in CDATA:

<code><![CDATA[
class Calculator {
  private history: string[] = [];

  constructor() {
    // Initialize calculator
  }

  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(\`\${a} + \${b} = \${result}\`);
    return result;
  }

  subtract(a: number, b: number): number {
    const result = a - b;
    this.history.push(\`\${a} - \${b} = \${result}\`);
    return result;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) throw new Error("Division by zero");
    return a / b;
  }

  getHistory(): string[] {
    return [...this.history];
  }
}
]]></code>

CDATA rules:
- Start with: <![CDATA[
- End with: ]]>
- Everything inside is LITERAL - quotes, backticks, <, >, & are preserved exactly
- NEVER escape anything inside CDATA
- NEVER try to embed code without CDATA wrapper`);
    } else if (parameterFormat === "block") {
      parts.push(`

BLOCK FORMAT SYNTAX:
Block format uses ${GADGET_ARG_PREFIX}name markers. Values are captured verbatim until the next marker.

${GADGET_ARG_PREFIX}filename
calculator.ts
${GADGET_ARG_PREFIX}code
class Calculator {
  private history: string[] = [];

  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(\`\${a} + \${b} = \${result}\`);
    return result;
  }
}

BLOCK FORMAT RULES:
- Each parameter starts with ${GADGET_ARG_PREFIX}parameterName on its own line
- The value starts on the NEXT line after the marker
- Value ends when the next ${GADGET_ARG_PREFIX} or ${this.endPrefix} appears
- NO escaping needed - write values exactly as they should appear
- Perfect for code, JSON, markdown, or any content with special characters

NESTED OBJECTS (use / separator):
${GADGET_ARG_PREFIX}config/timeout
30
${GADGET_ARG_PREFIX}config/retries
3
Produces: { "config": { "timeout": "30", "retries": "3" } }

ARRAYS (use numeric indices):
${GADGET_ARG_PREFIX}items/0
first
${GADGET_ARG_PREFIX}items/1
second
Produces: { "items": ["first", "second"] }`);
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
            // Use heredoc syntax to avoid teaching model to use triple-quotes
            return `${key} = <<<EOF\n${value}\nEOF`;
          }
          return `${key} = ${JSON.stringify(value)}`;
        })
        .join("\n");
    }
    if (format === "block") {
      return this.formatBlockParameters(parameters, "");
    }
    return JSON.stringify(parameters);
  }

  /**
   * Format parameters as Block format with JSON Pointer paths.
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
            lines.push(`${GADGET_ARG_PREFIX}${itemPath}`);
            lines.push(String(item));
          }
        });
      } else if (typeof value === "object" && value !== null) {
        lines.push(this.formatBlockParameters(value as Record<string, unknown>, fullPath));
      } else {
        lines.push(`${GADGET_ARG_PREFIX}${fullPath}`);
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
