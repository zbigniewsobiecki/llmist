/**
 * Context provided to prompt template functions for rendering dynamic content.
 */
export interface PromptContext {
  /** Custom gadget start prefix */
  startPrefix: string;
  /** Custom gadget end prefix */
  endPrefix: string;
  /** Custom argument prefix for block format */
  argPrefix: string;
  /** Number of gadgets being registered */
  gadgetCount: number;
  /** Names of all gadgets */
  gadgetNames: string[];
}

/**
 * Context provided to hint template functions for rendering dynamic hints.
 */
export interface HintContext {
  /** Current iteration (1-based for readability) */
  iteration: number;
  /** Maximum iterations allowed */
  maxIterations: number;
  /** Iterations remaining (maxIterations - iteration) */
  remaining: number;
  /** Number of gadget calls in the current response */
  gadgetCallCount?: number;
}

/**
 * Template that can be either a static string or a function that renders based on context.
 */
export type PromptTemplate = string | ((context: PromptContext) => string);

/**
 * Template for hints that can be either a static string or a function that renders based on hint context.
 */
export type HintTemplate = string | ((context: HintContext) => string);

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
   * Format description for the block parameter format.
   * Default uses the configured argPrefix dynamically.
   */
  formatDescription?: PromptTemplate;

  /**
   * Rules that appear in the rules section.
   * Can be an array of strings or a function that returns an array.
   * Default includes rules about not using function calling.
   */
  rules?: PromptTemplate | string[] | ((context: PromptContext) => string[]);

  /**
   * Custom examples to show in the examples section.
   * If provided, replaces the default examples entirely.
   * Should be a function that returns formatted example strings.
   */
  customExamples?: (context: PromptContext) => string;

  // ============================================================================
  // HINT TEMPLATES
  // ============================================================================

  /**
   * Hint shown when LLM uses only one gadget per response.
   * Encourages parallel gadget usage for efficiency.
   */
  parallelGadgetsHint?: HintTemplate;

  /**
   * Template for iteration progress hint.
   * Informs the LLM about remaining iterations to help plan work.
   *
   * When using a string template, supports placeholders:
   * - {iteration}: Current iteration (1-based)
   * - {maxIterations}: Maximum iterations allowed
   * - {remaining}: Iterations remaining
   */
  iterationProgressHint?: HintTemplate;
}

/**
 * Default hint templates used by llmist.
 */
export const DEFAULT_HINTS = {
  parallelGadgetsHint:
    "Tip: You can call multiple gadgets in a single response for efficiency.",

  iterationProgressHint:
    "[Iteration {iteration}/{maxIterations}] Plan your actions accordingly.",
} as const;

/**
 * Default prompt templates used by llmist.
 */
export const DEFAULT_PROMPTS: Required<
  Omit<PromptConfig, "rules" | "customExamples" | "parallelGadgetsHint" | "iterationProgressHint"> & {
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

  formatDescription: (ctx) =>
    `Parameters using ${ctx.argPrefix}name markers (value on next line(s), no escaping needed)`,

  rules: () => [
    "Output ONLY plain text with the exact markers - never use function/tool calling",
    "You can invoke multiple gadgets in a single response",
    "For dependent gadgets, invoke the first one and wait for the result",
  ],

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

/**
 * Resolve a hint template to a string using the given context.
 * Supports both function templates and string templates with placeholders.
 *
 * @param template - The hint template to resolve
 * @param defaultValue - Default value if template is undefined
 * @param context - Context for rendering the template
 * @returns The resolved hint string
 */
export function resolveHintTemplate(
  template: HintTemplate | undefined,
  defaultValue: string,
  context: HintContext,
): string {
  const resolved = template ?? defaultValue;

  if (typeof resolved === "function") {
    return resolved(context);
  }

  // Replace placeholders in string template
  return resolved
    .replace(/\{iteration\}/g, String(context.iteration))
    .replace(/\{maxIterations\}/g, String(context.maxIterations))
    .replace(/\{remaining\}/g, String(context.remaining));
}
