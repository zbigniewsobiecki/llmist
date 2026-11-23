/**
 * Skill activation logic.
 *
 * Handles $ARGUMENTS substitution and !`command` shell preprocessing
 * to resolve skill instructions before injection into agent context.
 *
 * @module skills/activation
 */

import { execSync } from "node:child_process";

const ARGUMENT = /\$ARGUMENTS(?:\[(\d+)\])?|\$(\d+)/g;
const VARIABLE = /\$\{(\w+)\}/g;
const SHELL_DIRECTIVE = /!`[^`]+`/g;
const PLACEHOLDERS = new RegExp(`${ARGUMENT.source}|${VARIABLE.source}`, "g");
const TRUSTED_TEMPLATE_TOKENS = new RegExp(`${PLACEHOLDERS.source}|${SHELL_DIRECTIVE.source}`, "g");

function argumentReplacer(args = "") {
  const parts = splitArguments(args);
  return (_token: string, indexed?: string, positional?: string): string => {
    const index = indexed ?? positional;
    return index === undefined ? args : (parts[Number(index)] ?? "");
  };
}

/** Substitute argument placeholders once, preserving caller-supplied text literally. */
export function substituteArguments(instructions: string, args?: string): string {
  return instructions.replace(ARGUMENT, argumentReplacer(args));
}

type ShellOptions = { cwd?: string; shell?: "bash" | "powershell"; timeoutMs?: number };

function executeTemplateCommand(
  command: string,
  { cwd, shell = "bash", timeoutMs = 10_000 }: ShellOptions = {},
): string {
  try {
    return execSync(command, {
      cwd,
      shell: shell === "powershell" ? "powershell" : "/bin/bash",
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `[Error executing \`${command}\`: ${msg}]`;
  }
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
  return instructions.replace(VARIABLE, (_match, name: string) => variableValue(variables, name));
}

function variableValue(variables: Record<string, string>, name: string): string {
  return Object.hasOwn(variables, name) ? variables[name] : "";
}

/** Render only tokens present in the original skill template. */
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
  const replaceArgument = argumentReplacer(options?.arguments);
  const tokens =
    options?.enableShellPreprocessing === true ? TRUSTED_TEMPLATE_TOKENS : PLACEHOLDERS;
  // One pass keeps arguments, variables and command output out of the template grammar.
  return instructions.replace(tokens, (token, indexed, positional, variable) => {
    if (token.startsWith("!")) {
      return executeTemplateCommand(token.slice(2, -1), {
        cwd: options?.cwd,
        shell: options?.shell,
        timeoutMs: options?.shellTimeoutMs,
      });
    }
    if (variable !== undefined) {
      return options?.variables ? variableValue(options.variables, variable) : token;
    }
    return replaceArgument(token, indexed, positional);
  });
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
