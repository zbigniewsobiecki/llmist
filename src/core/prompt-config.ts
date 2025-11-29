import type { ParameterFormat } from "../gadgets/parser.js";

/**
 * Context provided to prompt template functions for rendering dynamic content.
 */
export interface PromptContext {
  /** The parameter format being used (json or yaml) */
  parameterFormat: ParameterFormat;
  /** Custom gadget start prefix */
  startPrefix: string;
  /** Custom gadget end prefix */
  endPrefix: string;
  /** Number of gadgets being registered */
  gadgetCount: number;
  /** Names of all gadgets */
  gadgetNames: string[];
}

/**
 * Template that can be either a static string or a function that renders based on context.
 */
export type PromptTemplate = string | ((context: PromptContext) => string);

/**
 * Configuration for customizing all prompts used internally by llmist.
 *
 * Each field can be either a string (static text) or a function that receives
 * context and returns a string (for dynamic content).
 *
 * @example
 * ```typescript
 * const customConfig: PromptConfig = {
 *   mainInstruction: "USE ONLY THE GADGET MARKERS BELOW:",
 *   criticalUsage: "Important: Follow the exact format shown.",
 *   rules: (ctx) => [
 *     "Always use the markers to invoke gadgets",
 *     "Never use function calling",
 *     `You have ${ctx.gadgetCount} gadgets available`
 *   ]
 * };
 * ```
 */
export interface PromptConfig {
  /**
   * Main instruction block that appears at the start of the gadget system prompt.
   * Default emphasizes using text markers instead of function calling.
   */
  mainInstruction?: PromptTemplate;

  /**
   * Critical usage instruction that appears in the usage section.
   * Default emphasizes the exact format requirement.
   */
  criticalUsage?: PromptTemplate;

  /**
   * Format description for YAML parameter format.
   * Default: "Parameters in YAML format (one per line)"
   */
  formatDescriptionYaml?: PromptTemplate;

  /**
   * Format description for JSON parameter format.
   * Default: "Parameters in JSON format (valid JSON object)"
   */
  formatDescriptionJson?: PromptTemplate;

  /**
   * Format description for TOML parameter format.
   * Default: "Parameters in TOML format (key = value pairs, use heredoc for multiline: key = <<<EOF ... EOF)"
   */
  formatDescriptionToml?: PromptTemplate;

  /**
   * Rules that appear in the rules section.
   * Can be an array of strings or a function that returns an array.
   * Default includes 6 rules about not using function calling.
   */
  rules?: PromptTemplate | string[] | ((context: PromptContext) => string[]);

  /**
   * Schema label for JSON format.
   * Default: "\n\nInput Schema (JSON):"
   */
  schemaLabelJson?: PromptTemplate;

  /**
   * Schema label for YAML format.
   * Default: "\n\nInput Schema (YAML):"
   */
  schemaLabelYaml?: PromptTemplate;

  /**
   * Schema label for TOML format.
   * Default: "\n\nInput Schema (TOML):"
   */
  schemaLabelToml?: PromptTemplate;

  /**
   * Custom examples to show in the examples section.
   * If provided, replaces the default examples entirely.
   * Should be a function that returns formatted example strings.
   */
  customExamples?: (context: PromptContext) => string;
}

/**
 * Default prompt templates used by llmist.
 * These match the original hardcoded strings.
 */
export const DEFAULT_PROMPTS: Required<
  Omit<PromptConfig, "rules" | "customExamples"> & {
    rules: (context: PromptContext) => string[];
    customExamples: null;
  }
> = {
  mainInstruction: [
    "⚠️ CRITICAL: RESPOND ONLY WITH GADGET INVOCATIONS",
    "DO NOT use function calling or tool calling",
    "You must output the exact text markers shown below in plain text.",
    "EACH MARKER MUST START WITH A NEWLINE.",
  ].join("\n"),

  criticalUsage: "INVOKE gadgets using the markers - do not describe what you want to do.",

  formatDescriptionYaml: "Parameters in YAML format (one per line)",

  formatDescriptionJson: "Parameters in JSON format (valid JSON object)",

  formatDescriptionToml:
    "Parameters in TOML format (key = value pairs, use heredoc for multiline: key = <<<EOF ... EOF)",

  rules: () => [
    "Output ONLY plain text with the exact markers - never use function/tool calling",
    "You can invoke multiple gadgets in a single response",
    "For dependent gadgets, invoke the first one and wait for the result",
  ],

  schemaLabelJson: "\n\nInput Schema (JSON):",

  schemaLabelYaml: "\n\nInput Schema (YAML):",

  schemaLabelToml: "\n\nInput Schema (TOML):",

  customExamples: null,
};

/**
 * Resolve a prompt template to a string using the given context.
 */
export function resolvePromptTemplate(
  template: PromptTemplate | undefined,
  defaultValue: PromptTemplate,
  context: PromptContext,
): string {
  const resolved = template ?? defaultValue;
  return typeof resolved === "function" ? resolved(context) : resolved;
}

/**
 * Resolve rules template to an array of strings.
 */
export function resolveRulesTemplate(
  rules: PromptConfig["rules"] | undefined,
  context: PromptContext,
): string[] {
  const resolved = rules ?? DEFAULT_PROMPTS.rules;

  if (Array.isArray(resolved)) {
    return resolved;
  }

  if (typeof resolved === "function") {
    const result = resolved(context);
    return Array.isArray(result) ? result : [result];
  }

  return [resolved];
}
