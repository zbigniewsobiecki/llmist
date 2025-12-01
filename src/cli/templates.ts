import { Eta } from "eta";

/**
 * Configuration for reusable prompt templates.
 * Each key is a prompt name, value is the template string.
 */
export interface PromptsConfig {
  [name: string]: string;
}

/**
 * Error thrown when template processing fails.
 */
export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly promptName?: string,
    public readonly configPath?: string,
  ) {
    super(promptName ? `[prompts.${promptName}]: ${message}` : message);
    this.name = "TemplateError";
  }
}

/**
 * Creates an Eta instance configured with prompts as named templates.
 * Templates are registered with an @ prefix (e.g., @base-assistant).
 *
 * @param prompts - Map of prompt names to template strings
 * @param configPath - Path to config file for error messages
 * @returns Configured Eta instance
 * @throws TemplateError if a template has invalid syntax
 */
export function createTemplateEngine(prompts: PromptsConfig, configPath?: string): Eta {
  const eta = new Eta({
    views: "/", // Required but we use named templates
    autoEscape: false, // Don't escape - these are prompts, not HTML
    autoTrim: false, // Preserve whitespace in prompts
  });

  // Register all prompts as named templates with @ prefix
  // loadTemplate parses the template and will throw on syntax errors
  for (const [name, template] of Object.entries(prompts)) {
    try {
      eta.loadTemplate(`@${name}`, template);
    } catch (error) {
      throw new TemplateError(
        error instanceof Error ? error.message : String(error),
        name,
        configPath,
      );
    }
  }

  return eta;
}

/**
 * Resolves a template string using the configured Eta engine.
 * Injects environment variables into the context.
 *
 * @param eta - Configured Eta instance
 * @param template - Template string to resolve
 * @param context - Additional context variables
 * @param configPath - Path to config file for error messages
 * @returns Resolved template string
 */
export function resolveTemplate(
  eta: Eta,
  template: string,
  context: Record<string, unknown> = {},
  configPath?: string,
): string {
  try {
    // Merge env vars and built-in variables into context
    const fullContext = {
      ...context,
      env: process.env,
      date: new Date().toISOString().split("T")[0], // "2025-12-01"
    };
    return eta.renderString(template, fullContext);
  } catch (error) {
    throw new TemplateError(
      error instanceof Error ? error.message : String(error),
      undefined,
      configPath,
    );
  }
}

/**
 * Validates that all prompts can be compiled and references exist.
 * This is called at config load time to fail fast on errors.
 *
 * @param prompts - Map of prompt names to template strings
 * @param configPath - Path to config file for error messages
 * @throws TemplateError if validation fails
 */
export function validatePrompts(prompts: PromptsConfig, configPath?: string): void {
  // createTemplateEngine will throw TemplateError on syntax errors during loadTemplate
  const eta = createTemplateEngine(prompts, configPath);

  // Also try to render each template to catch missing includes
  for (const [name, template] of Object.entries(prompts)) {
    try {
      // Try to render with empty context to catch missing includes
      // (references to undefined prompts)
      eta.renderString(template, { env: {} });
    } catch (error) {
      throw new TemplateError(
        error instanceof Error ? error.message : String(error),
        name,
        configPath,
      );
    }
  }
}

/**
 * Validates that all environment variables referenced in a template are defined.
 *
 * @param template - Template string to check
 * @param promptName - Name of the prompt for error messages
 * @param configPath - Path to config file for error messages
 * @throws TemplateError if an undefined env var is referenced
 */
export function validateEnvVars(
  template: string,
  promptName?: string,
  configPath?: string,
): void {
  // Match <%= it.env.VAR_NAME %> patterns
  const envVarPattern = /<%=\s*it\.env\.(\w+)\s*%>/g;
  const matches = template.matchAll(envVarPattern);

  for (const match of matches) {
    const varName = match[1] as string;
    if (process.env[varName] === undefined) {
      throw new TemplateError(
        `Environment variable '${varName}' is not set`,
        promptName,
        configPath,
      );
    }
  }
}

/**
 * Checks if a string contains Eta template syntax.
 * Used to determine if a system prompt needs template resolution.
 *
 * @param str - String to check
 * @returns true if the string contains template syntax
 */
export function hasTemplateSyntax(str: string): boolean {
  return str.includes("<%");
}
