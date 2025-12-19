import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPatch } from "diff";
import { formatNewFileDiff } from "./diff-renderer.js";
import type { ApprovalContext, ApprovalContextProvider } from "./types.js";

/**
 * Formats a universal gadget summary: GadgetName(param1=value1, param2=value2)
 * Used by all context providers for consistent approval prompts.
 * Shows full parameter values so users know exactly what they're approving.
 */
export function formatGadgetSummary(gadgetName: string, params: Record<string, unknown>): string {
  const paramEntries = Object.entries(params);

  if (paramEntries.length === 0) {
    return `${gadgetName}()`;
  }

  const paramStr = paramEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");

  return `${gadgetName}(${paramStr})`;
}

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
        summary: formatGadgetSummary(this.gadgetName, params),
        details: formatNewFileDiff(filePath, newContent),
      };
    }

    const oldContent = readFileSync(resolvedPath, "utf-8");
    const diff = createPatch(filePath, oldContent, newContent, "original", "modified");

    return {
      summary: formatGadgetSummary(this.gadgetName, params),
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
          summary: formatGadgetSummary(this.gadgetName, params),
          details: formatNewFileDiff(filePath, newContent),
        };
      }

      const oldContent = readFileSync(resolvedPath, "utf-8");
      const diff = createPatch(filePath, oldContent, newContent, "original", "modified");

      return {
        summary: formatGadgetSummary(this.gadgetName, params),
        details: diff,
      };
    }

    // For ed-style commands, show the commands themselves
    if ("commands" in params) {
      const commands = String(params.commands);
      return {
        summary: formatGadgetSummary(this.gadgetName, params),
        details: `Commands:\n${commands}`,
      };
    }

    // Fallback
    return {
      summary: formatGadgetSummary(this.gadgetName, params),
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
    return {
      summary: formatGadgetSummary(this.gadgetName, params),
    };
  }
}

/**
 * Built-in context providers for common gadgets.
 * These provide custom details (diffs) while using universal summary format.
 */
export const builtinContextProviders: ApprovalContextProvider[] = [
  new WriteFileContextProvider(),
  new EditFileContextProvider(),
  // Note: RunCommand uses DefaultContextProvider - no custom details needed
];
