import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { CLIEnvironment } from "../environment.js";
import type { StreamProgress } from "../utils.js";
import { builtinContextProviders, DefaultContextProvider } from "./context-providers.js";
import { renderColoredDiff } from "./diff-renderer.js";
import type {
  ApprovalConfig,
  ApprovalContextProvider,
  ApprovalMode,
  ApprovalResult,
} from "./types.js";

/**
 * Manages gadget approval flows.
 *
 * The ApprovalManager determines whether a gadget execution should:
 * - Proceed automatically ("allowed")
 * - Be rejected automatically ("denied")
 * - Require user approval ("approval-required")
 *
 * For approval-required gadgets, it displays relevant context (like diffs for
 * file operations) and prompts the user interactively.
 */
export class ApprovalManager {
  private providers = new Map<string, ApprovalContextProvider>();

  /**
   * Creates a new ApprovalManager.
   *
   * @param config - Approval configuration with per-gadget modes
   * @param env - CLI environment for I/O operations
   * @param progress - Optional progress indicator to pause during prompts
   */
  constructor(
    private readonly config: ApprovalConfig,
    private readonly env: CLIEnvironment,
    private readonly progress?: StreamProgress,
  ) {
    // Register built-in context providers
    for (const provider of builtinContextProviders) {
      this.registerProvider(provider);
    }
  }

  /**
   * Registers a custom context provider for a gadget.
   *
   * @param provider - The context provider to register
   */
  registerProvider(provider: ApprovalContextProvider): void {
    // Case-insensitive registration
    this.providers.set(provider.gadgetName.toLowerCase(), provider);
  }

  /**
   * Gets the approval mode for a gadget.
   *
   * Resolution order:
   * 1. Explicit configuration for the gadget name
   * 2. Wildcard "*" configuration
   * 3. Default mode from config
   *
   * @param gadgetName - Name of the gadget
   * @returns The approval mode to use
   */
  getApprovalMode(gadgetName: string): ApprovalMode {
    const normalizedName = gadgetName.toLowerCase();

    // Check explicit configuration (case-insensitive)
    for (const [configName, mode] of Object.entries(this.config.gadgetApprovals)) {
      if (configName.toLowerCase() === normalizedName) {
        return mode;
      }
    }

    // Check wildcard
    if ("*" in this.config.gadgetApprovals) {
      return this.config.gadgetApprovals["*"];
    }

    // Return default
    return this.config.defaultMode;
  }

  /**
   * Requests approval for a gadget execution.
   *
   * Behavior depends on the gadget's approval mode:
   * - "allowed": Returns approved immediately
   * - "denied": Returns denied with configuration message
   * - "approval-required": Prompts user interactively
   *
   * @param gadgetName - Name of the gadget
   * @param params - The gadget's execution parameters
   * @returns Approval result indicating whether to proceed
   */
  async requestApproval(
    gadgetName: string,
    params: Record<string, unknown>,
  ): Promise<ApprovalResult> {
    const mode = this.getApprovalMode(gadgetName);

    if (mode === "allowed") {
      return { approved: true };
    }

    if (mode === "denied") {
      return {
        approved: false,
        reason: `${gadgetName} is denied by configuration`,
      };
    }

    // mode === "approval-required"
    return this.promptForApproval(gadgetName, params);
  }

  /**
   * Prompts the user for approval interactively.
   */
  private async promptForApproval(
    gadgetName: string,
    params: Record<string, unknown>,
  ): Promise<ApprovalResult> {
    // Get context provider (case-insensitive lookup, or default)
    const provider =
      this.providers.get(gadgetName.toLowerCase()) ?? new DefaultContextProvider(gadgetName);

    const context = await provider.getContext(params);

    // Pause progress indicator if available
    this.progress?.pause();

    // Render approval UI
    this.env.stderr.write(`\n${chalk.yellow("🔒 Approval required:")} ${context.summary}\n`);

    if (context.details) {
      this.env.stderr.write(`\n${renderColoredDiff(context.details)}\n`);
    }

    // Prompt user
    const response = await this.prompt("   ⏎ approve, or type to reject: ");

    // Empty input or "y"/"Y" = approved
    const isApproved = response === "" || response.toLowerCase() === "y";

    if (isApproved) {
      this.env.stderr.write(`   ${chalk.green("✓ Approved")}\n\n`);
      return { approved: true };
    }

    this.env.stderr.write(`   ${chalk.red("✗ Denied")}\n\n`);
    return { approved: false, reason: response || "Rejected by user" };
  }

  /**
   * Prompts for user input.
   */
  private async prompt(message: string): Promise<string> {
    const rl = createInterface({
      input: this.env.stdin,
      output: this.env.stderr,
    });
    try {
      const answer = await rl.question(message);
      return answer.trim();
    } finally {
      rl.close();
    }
  }
}
