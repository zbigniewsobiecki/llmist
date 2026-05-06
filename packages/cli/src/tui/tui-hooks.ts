/**
 * Factory for TUI-specific agent hooks.
 *
 * Extracts the observer and controller hooks used by the CLI's TUI mode into a
 * typed, testable factory function. Follows the same pattern as
 * `packages/llmist/src/agent/hook-presets.ts`.
 *
 * The factory accepts mutable container objects for `iterations` and `usage` so
 * that the hooks can update state that callers depend on after the agent run.
 *
 * @example
 * ```typescript
 * const iterationsRef = { value: 0 };
 * const usageRef = { value: undefined };
 *
 * const hooks = createTUIHooks({
 *   tui,
 *   env,
 *   gadgetApprovals,
 *   approvalConfig,
 *   iterationsRef,
 *   usageRef,
 * });
 *
 * builder.withHooks(hooks);
 * ```
 */

import type {
  AgentHooks,
  GadgetExecutionControllerContext,
  ObserveChunkContext,
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveRateLimitThrottleContext,
  ObserveRetryAttemptContext,
  TokenUsage,
} from "llmist";
import type { ApprovalConfig } from "../approval/index.js";
import type { CLIEnvironment } from "../environment.js";
import { isInteractive } from "../utils.js";
import type { TUIApp } from "./index.js";
import { StatusBar } from "./status-bar.js";

/**
 * Options accepted by {@link createTUIHooks}.
 */
export interface TUIHooksOptions {
  /** The TUI application instance. May be null in piped (non-TTY) mode. */
  tui: TUIApp | null;
  /** CLI environment providing stdin/stderr streams for TTY detection. */
  env: CLIEnvironment;
  /**
   * Mutable gadget approval map shared with the caller.
   * The `beforeGadgetExecution` controller mutates this object to persist
   * "always allow" / "always deny" choices within a session.
   */
  gadgetApprovals: Record<string, "allowed" | "denied" | "approval-required">;
  /** Approval configuration providing the default approval mode. */
  approvalConfig: ApprovalConfig;
  /**
   * Mutable container for the current iteration count.
   * The `onLLMCallComplete` observer updates `value` so the caller can read
   * the final iteration count after the agent run.
   */
  iterationsRef: { value: number };
  /**
   * Mutable container for the latest token usage snapshot.
   * The `onLLMCallComplete` observer updates `value` on every successful LLM
   * call completion so the caller has access to the most recent usage data.
   */
  usageRef: { value: TokenUsage | undefined };
}

/**
 * Creates a set of TUI-specific agent hooks for progress tracking and gadget approval.
 *
 * Observers:
 * - `onLLMCallStart` — notifies TUI of a new LLM call iteration
 * - `onStreamChunk` — updates the status bar with real-time token estimate
 * - `onLLMCallComplete` — captures token usage / iteration metadata, clears retry indicator
 * - `onRateLimitThrottle` — shows throttle message in status bar and conversation
 * - `onRetryAttempt` — shows retry indicator in status bar and conversation
 *
 * Controllers:
 * - `beforeGadgetExecution` — enforces gadget approval rules (allowed / denied /
 *   approval-required), using TUI modal dialogs when available
 *
 * @param options - See {@link TUIHooksOptions}
 * @returns An {@link AgentHooks} object ready to pass to `AgentBuilder.withHooks()`
 */
export function createTUIHooks(options: TUIHooksOptions): AgentHooks {
  const { tui, env, gadgetApprovals, approvalConfig, iterationsRef, usageRef } = options;

  return {
    observers: {
      // Track iteration for status bar label formatting
      onLLMCallStart: async (context: ObserveLLMCallContext) => {
        if (context.subagentContext) return;

        if (tui) {
          // Only track iteration — tree subscription handles block creation
          tui.showLLMCallStart(iterationsRef.value + 1);
        }
      },

      // Update status bar with real-time output token estimate
      onStreamChunk: async (context: ObserveChunkContext) => {
        if (context.subagentContext) return;
        if (!tui) return;

        // Use accumulated text from context to estimate output tokens
        const estimatedOutputTokens = StatusBar.estimateTokens(context.accumulatedText);
        tui.updateStreamingTokens(estimatedOutputTokens);
      },

      // Capture metadata for final summary and clear retry indicator
      onLLMCallComplete: async (context: ObserveLLMCompleteContext) => {
        if (context.subagentContext) return;

        // Capture completion metadata for final summary
        usageRef.value = context.usage;
        iterationsRef.value = Math.max(iterationsRef.value, context.iteration + 1);

        // Clear retry indicator on successful LLM call completion
        if (tui) {
          tui.clearRetry();
        }
      },

      // Show throttling delay in status bar and conversation
      onRateLimitThrottle: async (context: ObserveRateLimitThrottleContext) => {
        if (context.subagentContext) return; // Only main agent

        if (tui) {
          const seconds = Math.ceil(context.delayMs / 1000);
          const { triggeredBy } = context.stats;

          // Status bar indicator (auto-cleared after delay via timer below)
          tui.showThrottling(context.delayMs, triggeredBy);

          // Format conversation message based on which limit triggered
          let message: string;
          if (triggeredBy?.daily) {
            // Daily limit: show token counts and wait until midnight
            const current = Math.round(triggeredBy.daily.current / 1000);
            const limit = Math.round(triggeredBy.daily.limit / 1000);
            message = `Daily token limit reached (${current}K/${limit}K), waiting until midnight UTC...`;
          } else {
            // RPM/TPM: show current stats and countdown
            const statsMsg: string[] = [];
            if (context.stats.rpm > 0) statsMsg.push(`${context.stats.rpm} RPM`);
            if (context.stats.tpm > 0)
              statsMsg.push(`${Math.round(context.stats.tpm / 1000)}K TPM`);
            const statsStr = statsMsg.length > 0 ? ` (${statsMsg.join(", ")})` : "";
            message = `Rate limit approaching${statsStr}, waiting ${seconds}s...`;
          }

          tui.addSystemMessage(message, "throttle");

          // Auto-clear status bar indicator after delay
          setTimeout(() => tui.clearThrottling(), context.delayMs);
        }
      },

      // Show retry attempt in status bar and conversation
      onRetryAttempt: async (context: ObserveRetryAttemptContext) => {
        if (context.subagentContext) return; // Only main agent

        if (tui) {
          const totalAttempts = context.attemptNumber + context.retriesLeft;

          // Status bar indicator (cleared on next successful LLM call or final failure)
          tui.showRetry(context.attemptNumber, context.retriesLeft);

          // Conversation log entry with retry details
          const retryAfterInfo = context.retryAfterMs
            ? ` (server requested ${Math.ceil(context.retryAfterMs / 1000)}s wait)`
            : "";

          tui.addSystemMessage(
            `Request failed (attempt ${context.attemptNumber}/${totalAttempts}), retrying...${retryAfterInfo}`,
            "retry",
          );
        }
      },
    },

    // SHOWCASE: Controller-based approval gating for gadgets
    //
    // This demonstrates how to add safety layers WITHOUT modifying gadgets.
    // The ApprovalManager handles approval flows externally via beforeGadgetExecution.
    // Approval modes are configurable via cli.toml:
    //   - "allowed": auto-proceed
    //   - "denied": auto-reject, return message to LLM
    //   - "approval-required": prompt user interactively
    //
    // Default: RunCommand, WriteFile, EditFile require approval unless overridden.
    controllers: {
      beforeGadgetExecution: async (ctx: GadgetExecutionControllerContext) => {
        // Get approval mode from config
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
      },
    },
  };
}
