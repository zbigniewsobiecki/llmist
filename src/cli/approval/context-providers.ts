import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPatch } from "diff";
import type { ApprovalContext, ApprovalContextProvider } from "./types.js";
import { formatNewFileDiff } from "./diff-renderer.js";

/**
 * Context provider for WriteFile gadget.
 * Generates a unified diff when modifying existing files,
 * or shows "new file" content for file creation.
 */
export class WriteFileContextProvider implements ApprovalContextProvider {
  readonly gadgetName = "WriteFile";

  async getContext(params: Record<string, unknown>): Promise<ApprovalContext> {
    const filePath = String(params.filePath ?? params.path ?? "");
    const newContent = String(params.content ?? "");
    const resolvedPath = resolve(process.cwd(), filePath);

    if (!existsSync(resolvedPath)) {
      return {
        summary: `Create new file: ${filePath}`,
        details: formatNewFileDiff(filePath, newContent),
      };
    }

    const oldContent = readFileSync(resolvedPath, "utf-8");
    const diff = createPatch(filePath, oldContent, newContent, "original", "modified");

    return {
      summary: `Modify: ${filePath}`,
      details: diff,
    };
  }
}

/**
 * Context provider for EditFile gadget.
 * Similar to WriteFile but handles edit-specific parameters.
 */
export class EditFileContextProvider implements ApprovalContextProvider {
  readonly gadgetName = "EditFile";

  async getContext(params: Record<string, unknown>): Promise<ApprovalContext> {
    const filePath = String(params.filePath ?? params.path ?? "");
    const resolvedPath = resolve(process.cwd(), filePath);

    // EditFile typically receives the full new content or edits
    // Handle both content-based and patch-based edits
    if ("content" in params) {
      const newContent = String(params.content);

      if (!existsSync(resolvedPath)) {
        return {
          summary: `Create new file: ${filePath}`,
          details: formatNewFileDiff(filePath, newContent),
        };
      }

      const oldContent = readFileSync(resolvedPath, "utf-8");
      const diff = createPatch(filePath, oldContent, newContent, "original", "modified");

      return {
        summary: `Modify: ${filePath}`,
        details: diff,
      };
    }

    // For ed-style commands, show the commands themselves
    if ("commands" in params) {
      const commands = String(params.commands);
      return {
        summary: `Edit: ${filePath}`,
        details: `Commands:\n${commands}`,
      };
    }

    // Fallback
    return {
      summary: `Edit: ${filePath}`,
    };
  }
}

/**
 * Context provider for RunCommand gadget.
 * Shows the command that will be executed.
 */
export class RunCommandContextProvider implements ApprovalContextProvider {
  readonly gadgetName = "RunCommand";

  async getContext(params: Record<string, unknown>): Promise<ApprovalContext> {
    const command = String(params.command ?? "");
    const cwd = params.cwd ? ` (in ${params.cwd})` : "";

    return {
      summary: `Execute: ${command}${cwd}`,
    };
  }
}

/**
 * Default context provider for any gadget without a specific provider.
 * Shows gadget name and parameters.
 */
export class DefaultContextProvider implements ApprovalContextProvider {
  constructor(public readonly gadgetName: string) {}

  async getContext(params: Record<string, unknown>): Promise<ApprovalContext> {
    const paramEntries = Object.entries(params);

    if (paramEntries.length === 0) {
      return {
        summary: `${this.gadgetName}()`,
      };
    }

    // Truncate long parameter values
    const formatValue = (value: unknown): string => {
      const str = JSON.stringify(value);
      return str.length > 50 ? `${str.slice(0, 47)}...` : str;
    };

    const paramStr = paramEntries.map(([k, v]) => `${k}=${formatValue(v)}`).join(", ");

    return {
      summary: `${this.gadgetName}(${paramStr})`,
    };
  }
}

/**
 * Built-in context providers for common gadgets.
 */
export const builtinContextProviders: ApprovalContextProvider[] = [
  new WriteFileContextProvider(),
  new EditFileContextProvider(),
  new RunCommandContextProvider(),
];
