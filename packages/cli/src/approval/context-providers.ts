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
 * Shows search/replace preview for the new layered matching approach.
 */
export class EditFileContextProvider implements ApprovalContextProvider {
  readonly gadgetName = "EditFile";

  async getContext(params: Record<string, unknown>): Promise<ApprovalContext> {
    const filePath = String(params.filePath ?? params.path ?? "");
    const search = String(params.search ?? "");
    const replace = String(params.replace ?? "");

    // Format as a search/replace preview
    const details = [
      `File: ${filePath}`,
      "",
      "SEARCH:",
      "```",
      search,
      "```",
      "",
      "REPLACE:",
      "```",
      replace || "(delete)",
      "```",
    ].join("\n");

    return {
      summary: formatGadgetSummary(this.gadgetName, params),
      details,
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
