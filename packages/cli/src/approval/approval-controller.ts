/**
 * Factory for the gadget approval controller.
 *
 * Extracts the `beforeGadgetExecution` controller logic from `tui-hooks.ts`
 * into a focused, testable module. The controller enforces gadget approval
 * rules (allowed / denied / approval-required) for every gadget call,
 * delegating to TUI modal dialogs when available.
 *
 * @example
 * ```typescript
 * const controller = createApprovalController({
 *   gadgetApprovals,
 *   approvalConfig,
 *   tui,
 *   env,
 * });
 *
 * // Use directly in a hooks object:
 * builder.withHooks({
 *   controllers: { beforeGadgetExecution: controller },
 * });
 * ```
 */

import type { Controllers, GadgetExecutionControllerContext } from "llmist";
import type { CLIEnvironment } from "../environment.js";
import type { TUIApp } from "../tui/index.js";
import { isInteractive } from "../utils.js";
import type { ApprovalConfig } from "./types.js";

/**
 * Options accepted by {@link createApprovalController}.
 */
export interface ApprovalControllerOptions {
  /**
   * Mutable gadget approval map shared with the caller.
   * The controller mutates this object to persist "always allow" / "always deny"
   * choices within a session when the user responds "always" or "deny".
   */
  gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required">;

  /** Approval configuration providing the default approval mode. */
  approvalConfig: ApprovalConfig;

  /**
   * The TUI application instance. May be null in piped (non-TTY) mode.
   * When non-null, approval prompts are shown as modal dialogs.
   */
  tui: TUIApp | null;

  /** CLI environment providing stdin/stderr streams for TTY detection. */
  env: CLIEnvironment;
}

/**
 * Creates a `beforeGadgetExecution` controller that enforces gadget approval rules.
 *
 * The controller handles four scenarios:
 * 1. **Allowed** — gadget proceeds immediately without prompting
 * 2. **Denied** — gadget is skipped with a denial message returned to the LLM
 * 3. **Approval-required (TUI)** — user is shown a modal dialog; "always"/"deny"
 *    responses persist into `gadgetApprovals` for the remainder of the session
 * 4. **Approval-required (non-interactive)** — gadget is skipped with a message
 *    instructing the user to run in a terminal
 *
 * @param options - See {@link ApprovalControllerOptions}
 * @returns An async `beforeGadgetExecution` controller function
 */
export function createApprovalController(
  options: ApprovalControllerOptions,
): NonNullable<Controllers["beforeGadgetExecution"]> {
  const { gadgetApprovals, approvalConfig, tui, env } = options;

  return async (ctx: GadgetExecutionControllerContext) => {
    // Get approval mode from config (case-insensitive lookup)
    const normalizedGadgetName = ctx.gadgetName.toLowerCase();
    const configuredMode = Object.entries(gadgetApprovals).find(
      ([key]) => key.toLowerCase() === normalizedGadgetName,
    )?.[1];
    const mode = configuredMode ?? approvalConfig.defaultMode;

    // Fast path: allowed gadgets proceed immediately
    if (mode === "allowed") {
      return { action: "proceed" } as const;
    }

    // Check if we can prompt (interactive mode required for approval-required)
    const stdinTTY = isInteractive(env.stdin);
    const stderrTTY = (env.stderr as NodeJS.WriteStream).isTTY === true;
    const canPrompt = stdinTTY && stderrTTY;

    // Non-interactive mode handling
    if (!canPrompt) {
      if (mode === "approval-required") {
        return {
          action: "skip",
          syntheticResult: `status=denied\n\n${ctx.gadgetName} requires interactive approval. Run in a terminal to approve.`,
        } as const;
      }
      if (mode === "denied") {
        return {
          action: "skip",
          syntheticResult: `status=denied\n\n${ctx.gadgetName} is denied by configuration.`,
        } as const;
      }
      return { action: "proceed" } as const;
    }

    // TUI mode: use TUI's modal approval dialog
    if (tui) {
      const response = await tui.showApproval({
        gadgetName: ctx.gadgetName,
        parameters: ctx.parameters,
      });

      // Persist "always" and "deny" responses for future calls in this session
      if (response === "always") {
        gadgetApprovals[ctx.gadgetName] = "allowed";
      } else if (response === "deny") {
        gadgetApprovals[ctx.gadgetName] = "denied";
      }

      if (response === "yes" || response === "always") {
        return { action: "proceed" } as const;
      }
      return {
        action: "skip",
        syntheticResult: "status=denied\n\nDenied by user",
      } as const;
    }

    // Piped mode with terminal available but TUI disabled (e.g., stdout redirected)
    // Suggest adjusting config or enabling full interactive mode
    return {
      action: "skip",
      syntheticResult: `status=denied\n\n${ctx.gadgetName} requires interactive approval. Enable TUI mode or adjust 'gadget-approval' in your config to allow this gadget.`,
    } as const;
  };
}
