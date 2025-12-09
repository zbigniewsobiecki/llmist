/**
 * Gadget approval module.
 *
 * This module provides configurable approval flows for gadget execution.
 * It supports three modes:
 * - "allowed": Auto-proceed without prompting
 * - "denied": Auto-reject, return denial message to LLM
 * - "approval-required": Prompt user interactively with context
 *
 * @example
 * ```typescript
 * import { ApprovalManager, type ApprovalConfig } from './approval/index.js';
 *
 * const config: ApprovalConfig = {
 *   gadgetApprovals: {
 *     WriteFile: 'approval-required',
 *     ReadFile: 'allowed',
 *   },
 *   defaultMode: 'allowed',
 * };
 *
 * const manager = new ApprovalManager(config, env, progress);
 * const result = await manager.requestApproval('WriteFile', { filePath: 'test.ts', content: '...' });
 *
 * if (!result.approved) {
 *   // Handle denial
 * }
 * ```
 */

// Types
export type {
  ApprovalConfig,
  ApprovalContext,
  ApprovalContextProvider,
  ApprovalMode,
  ApprovalResult,
  KeyboardCoordinator,
} from "./types.js";

// Manager
export { ApprovalManager } from "./manager.js";

// Context providers
export {
  builtinContextProviders,
  DefaultContextProvider,
  EditFileContextProvider,
  formatGadgetSummary,
  WriteFileContextProvider,
} from "./context-providers.js";

// Diff rendering
export { formatNewFileDiff, renderColoredDiff } from "./diff-renderer.js";
