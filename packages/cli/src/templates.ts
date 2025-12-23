import { Eta } from "eta";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/** Maximum file size for prompt files (1MB) */
export const MAX_PROMPT_FILE_SIZE = 1024 * 1024;

/**
 * Configuration for reusable prompt templates.
 * Each key is a prompt name, value is the template string.
 */
export interface PromptsConfig {
  [name: string]: string;
}

/**
 * Extended Eta instance with includeFile support.
 */
interface EtaWithFileSupport extends Eta {
  __includeFileImpl?: (path: string) => string;
}

/**
 * Expands ~ to the user's home directory.
 */
function expandHomePath(input: string): string {
  if (!input.startsWith("~")) {
    return input;
  }
  return input.replace("~", homedir());
}

/**
 * Resolves a file path relative to the config file directory.
 *
 * @param filePath - The file path from the template
 * @param configDir - Directory of the config file for resolving relative paths
 * @returns Absolute path to the file
 */
function resolvePromptFilePath(filePath: string, configDir?: string): string {
  const expanded = expandHomePath(filePath);
  if (expanded.startsWith("/")) {
    return expanded;
  }
  return resolve(configDir ?? process.cwd(), expanded);
}

/**
 * Loads contents from a file for inclusion in templates.
 *
 * @param filePath - Path to the file (can be relative, absolute, or use ~)
 * @param configDir - Directory of the config file for resolving relative paths
 * @returns File contents as string
 * @throws Error if file not found, too large, or unreadable
 */
function loadFileContents(filePath: string, configDir?: string): string {
  const absolutePath = resolvePromptFilePath(filePath, configDir);

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = statSync(absolutePath);
  if (stats.size > MAX_PROMPT_FILE_SIZE) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File too large: ${filePath} (${sizeMB}MB, max 1MB)`);
  }

  return readFileSync(absolutePath, "utf-8");
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
 * Also provides the includeFile() function for loading external file contents.
 *
 * @param prompts - Map of prompt names to template strings
 * @param configPath - Path to config file for error messages and relative path resolution
 * @returns Configured Eta instance with includeFile support
 * @throws TemplateError if a template has invalid syntax
 */
export function createTemplateEngine(
  prompts: PromptsConfig,
  configPath?: string,
): EtaWithFileSupport {
  // Derive config directory for relative path resolution in includeFile
  const configDir = configPath ? dirname(configPath) : undefined;

  const eta: EtaWithFileSupport = new Eta({
    views: "/", // Required but we use named templates
    autoEscape: false, // Don't escape - these are prompts, not HTML
    autoTrim: false, // Preserve whitespace in prompts
    // Inject includeFile function into compiled templates
    functionHeader: "const includeFile = (path) => it.__includeFile(path);",
  });

  // Track files being included to detect circular references
  const includeStack: string[] = [];

  // Store the includeFile implementation that recursively renders included files
  eta.__includeFileImpl = (path: string): string => {
    // Check for circular includes
    if (includeStack.includes(path)) {
      throw new Error(
        `Circular include detected: ${[...includeStack, path].join(" -> ")}`,
      );
    }

    includeStack.push(path);
    try {
      const content = loadFileContents(path, configDir);

      // If the content contains template syntax, render it recursively
      if (hasTemplateSyntax(content)) {
        const context = {
          env: process.env,
          date: new Date().toISOString().split("T")[0],
          __includeFile: eta.__includeFileImpl,
        };
        return eta.renderString(content, context);
      }

      return content;
    } finally {
      includeStack.pop();
    }
  };

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
 * Injects environment variables, includeFile function, and other built-ins into the context.
 *
 * @param eta - Configured Eta instance (with includeFile support)
 * @param template - Template string to resolve
 * @param context - Additional context variables
 * @param configPath - Path to config file for error messages
 * @returns Resolved template string
 */
export function resolveTemplate(
  eta: EtaWithFileSupport,
  template: string,
  context: Record<string, unknown> = {},
  configPath?: string,
): string {
  try {
    // Merge env vars, includeFile, and built-in variables into context
    const fullContext = {
      ...context,
      env: process.env,
      date: new Date().toISOString().split("T")[0], // "2025-12-01"
      __includeFile: eta.__includeFileImpl ?? (() => ""),
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
      // Provide __includeFile for templates that use includeFile()
      eta.renderString(template, {
        env: {},
        __includeFile: eta.__includeFileImpl ?? (() => ""),
      });
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
export function validateEnvVars(template: string, promptName?: string, configPath?: string): void {
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
