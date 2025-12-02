import type { GadgetApprovalMode } from "../config.js";

/**
 * Re-export for convenience.
 */
export type ApprovalMode = GadgetApprovalMode;

/**
 * Configuration for the approval system.
 */
export interface ApprovalConfig {
  /**
   * Per-gadget approval modes.
   * Keys are gadget names (case-insensitive), "*" is wildcard for defaults.
   */
  gadgetApprovals: Record<string, ApprovalMode>;

  /**
   * Default mode when a gadget is not explicitly configured.
   */
  defaultMode: ApprovalMode;
}

/**
 * Context information displayed to the user during approval prompts.
 */
export interface ApprovalContext {
  /**
   * Brief summary of the operation (e.g., "Modify src/index.ts").
   */
  summary: string;

  /**
   * Detailed information (e.g., unified diff for file operations).
   */
  details?: string;
}

/**
 * Result of an approval request.
 */
export interface ApprovalResult {
  /**
   * Whether the operation was approved.
   */
  approved: boolean;

  /**
   * User's reason for rejection (when approved=false).
   */
  reason?: string;
}

/**
 * Interface for providing gadget-specific approval context.
 * Implementations can read files, generate diffs, or provide any relevant context.
 */
export interface ApprovalContextProvider {
  /**
   * The gadget name this provider handles.
   */
  readonly gadgetName: string;

  /**
   * Generate approval context from gadget parameters.
   *
   * @param params - The gadget's execution parameters
   * @returns Context to display during approval prompt
   */
  getContext(params: Record<string, unknown>): Promise<ApprovalContext>;
}
