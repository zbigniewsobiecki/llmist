/**
 * Skill activation logic.
 *
 * Handles $ARGUMENTS substitution and !`command` shell preprocessing
 * to resolve skill instructions before injection into agent context.
 *
 * @module skills/activation
 */

import { execSync } from "node:child_process";

/**
 * Substitute $ARGUMENTS and positional $0, $1, etc. in skill instructions.
 */
export function substituteArguments(instructions: string, args?: string): string {
  if (!args) {
    // Replace all argument placeholders with empty string.
    // Order: indexed forms first, then bare $ARGUMENTS, then positional $N.
    return instructions
      .replace(/\$ARGUMENTS\[\d+\]/g, "")
      .replace(/\$ARGUMENTS/g, "")
      .replace(/\$\d+/g, "");
  }

  const parts = splitArguments(args);

  // Replace indexed forms first (more specific), then bare $ARGUMENTS
  let result = instructions.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, index) => {
    const i = Number.parseInt(index, 10);
    return parts[i] ?? "";
  });

  result = result.replace(/\$ARGUMENTS/g, args);

  result = result.replace(/\$(\d+)/g, (_match, index) => {
    const i = Number.parseInt(index, 10);
    return parts[i] ?? "";
  });

  return result;
}

/**
 * Execute !`command` shell preprocessing directives in skill instructions.
 *
 * Commands enclosed in !`...` are executed synchronously and their stdout
 * replaces the directive. This happens before the LLM sees the instructions.
 */
export function preprocessShellCommands(
  instructions: string,
  options?: { cwd?: string; shell?: "bash" | "powershell"; timeoutMs?: number },
): string {
  const { cwd, shell = "bash", timeoutMs = 10_000 } = options ?? {};

  return instructions.replace(/!`([^`]+)`/g, (_match, command: string) => {
    try {
      const output = execSync(command, {
        cwd,
        shell: shell === "powershell" ? "powershell" : "/bin/bash",
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return output.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `[Error executing \`${command}\`: ${msg}]`;
    }
  });
}

/**
 * Substitute ${VARIABLE} environment-style variables in skill instructions.
 *
 * Supported variables:
 * - ${CLAUDE_SKILL_DIR} / ${SKILL_DIR} - directory containing SKILL.md
 * - ${CLAUDE_SESSION_ID} / ${SESSION_ID} - current session ID (if provided)
 */
export function substituteVariables(
  instructions: string,
  variables: Record<string, string>,
): string {
  return instructions.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    return variables[varName] ?? "";
  });
}

/**
 * Full activation pipeline: variables -> arguments -> shell preprocessing.
 */
export function resolveInstructions(
  instructions: string,
  options?: {
    arguments?: string;
    variables?: Record<string, string>;
    cwd?: string;
    shell?: "bash" | "powershell";
    shellTimeoutMs?: number;
    enableShellPreprocessing?: boolean;
  },
): string {
  let resolved = instructions;

  // Step 1: Variable substitution
  if (options?.variables) {
    resolved = substituteVariables(resolved, options.variables);
  }

  // Step 2: Argument substitution
  resolved = substituteArguments(resolved, options?.arguments);

  // Step 3: Shell preprocessing (opt-in, since it executes commands)
  if (options?.enableShellPreprocessing !== false) {
    resolved = preprocessShellCommands(resolved, {
      cwd: options?.cwd,
      shell: options?.shell,
      timeoutMs: options?.shellTimeoutMs,
    });
  }

  return resolved;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Split argument string into positional parts, respecting quotes.
 */
function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const char of args) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) parts.push(current);
  return parts;
}
