/**
 * Agent builder configuration helper.
 *
 * Extracts the builder wiring sequence from agent-command.ts into a
 * reusable, testable pure function. Follows the same pattern as
 * rate-limit-resolver.ts — a focused module with a single responsibility.
 */

import type {
  AgentBuilder,
  AgentHooks,
  GadgetRegistry,
  ReasoningEffort,
  SkillRegistry,
  SubagentConfigMap,
} from "llmist";
import type { CLIConfig } from "./config.js";
import type { CLIEnvironment } from "./environment.js";
import { readSystemPromptFile } from "./file-utils.js";
import type { CLIAgentOptions } from "./option-helpers.js";
import { resolveRateLimitConfig, resolveRetryConfig } from "./rate-limit-resolver.js";
import type { TUIApp } from "./tui/index.js";

/**
 * Configuration context passed to configureAgentBuilder.
 * Contains all resolved, pre-computed values the builder wiring needs.
 */
export interface AgentBuilderConfig {
  /** Resolved subagent configuration map (from buildSubagentConfigMap). */
  resolvedSubagentConfig: SubagentConfigMap;
  /** Fully resolved agent hooks (TUI + optional file logging merged). */
  finalHooks: AgentHooks;
  /** Skill registry with all loaded skills (may be empty). */
  skillRegistry: SkillRegistry;
  /** Gadget registry with all registered gadgets (may be empty). */
  gadgetRegistry: GadgetRegistry;
  /** TUI app instance (null in piped mode). */
  tui: TUIApp | null;
  /** AbortController used for ESC key / SIGINT cancellation. */
  abortController: AbortController;
  /** Full parsed CLI config (null if no config file was found). */
  fullConfig: CLIConfig | null;
  /** CLI environment for I/O and logger creation. */
  env: CLIEnvironment;
}

/**
 * Configures an AgentBuilder with all settings derived from CLI options and
 * the resolved configuration context.
 *
 * This function is the single source-of-truth for builder wiring in the CLI.
 * It covers:
 *   - Model, subagent config, logger, hooks
 *   - Rate limiting and retry
 *   - System prompt (inline or from file)
 *   - Max iterations, budget, temperature
 *   - Skills
 *   - Reasoning (enabled/disabled/effort/budget)
 *   - Human-input handler (TUI mode only)
 *   - Abort signal
 *   - Gadgets
 *   - MCP servers (TOML + CLI flags)
 *   - Gadget block markers (start/end/arg prefixes)
 *   - Synthetic gadget calls (TellUser greeting + initial-gadgets)
 *   - Text-only and text-with-gadgets handlers
 *   - Trailing message
 *
 * @param builder - AgentBuilder instance to configure (mutated in place via fluent API).
 * @param options - Resolved CLI agent options.
 * @param config  - Pre-computed context values (hooks, registries, tui, etc.).
 */
export async function configureAgentBuilder(
  builder: AgentBuilder,
  options: CLIAgentOptions,
  config: AgentBuilderConfig,
): Promise<void> {
  const {
    resolvedSubagentConfig,
    finalHooks,
    skillRegistry,
    gadgetRegistry,
    tui,
    abortController,
    fullConfig,
    env,
  } = config;

  // ─── Core settings ────────────────────────────────────────────────────────
  builder
    .withModel(options.model)
    .withSubagentConfig(resolvedSubagentConfig)
    .withLogger(env.createLogger("llmist:cli:agent"))
    .withHooks(finalHooks);

  // ─── Rate limiting ─────────────────────────────────────────────────────────
  // Precedence: CLI flags > Profile config > Global config > Provider defaults
  const rateLimitConfig = resolveRateLimitConfig(
    options,
    options.globalRateLimits,
    options.profileRateLimits,
    options.model,
  );
  if (rateLimitConfig) {
    builder.withRateLimits(rateLimitConfig);
  }

  // ─── Retry ─────────────────────────────────────────────────────────────────
  // Precedence: CLI flags > Profile config > Global config > Defaults
  const retryConfig = resolveRetryConfig(options, options.globalRetry, options.profileRetry);
  if (retryConfig) {
    builder.withRetry(retryConfig);
  }

  // ─── System prompt ─────────────────────────────────────────────────────────
  let systemPrompt = options.system;
  if (options.systemFile) {
    if (options.system) {
      throw new Error("Cannot use both --system and --system-file options");
    }
    systemPrompt = await readSystemPromptFile(options.systemFile);
  }
  if (systemPrompt) {
    builder.withSystem(systemPrompt);
  }

  // ─── Iterations, budget, temperature ──────────────────────────────────────
  if (options.maxIterations !== undefined) {
    builder.withMaxIterations(options.maxIterations);
  }
  if (options.budget !== undefined) {
    builder.withBudget(options.budget);
  }
  if (options.temperature !== undefined) {
    builder.withTemperature(options.temperature);
  }

  // ─── Skills ────────────────────────────────────────────────────────────────
  if (skillRegistry.size > 0) {
    builder.withSkills(skillRegistry);
  }

  // ─── Reasoning ─────────────────────────────────────────────────────────────
  // Precedence: --no-reasoning > --reasoning/--reasoning-budget > config > auto-detect
  if (options.reasoning === false) {
    builder.withoutReasoning();
  } else if (options.reasoning !== undefined || options.reasoningBudget !== undefined) {
    const effort = typeof options.reasoning === "string" ? options.reasoning : undefined;
    builder.withReasoning({
      enabled: true,
      ...(effort && { effort: effort as ReasoningEffort }),
      ...(options.reasoningBudget && { budgetTokens: options.reasoningBudget }),
    });
  } else if (options.profileReasoning) {
    const cfg = options.profileReasoning;
    if (cfg.enabled === false) {
      builder.withoutReasoning();
    } else {
      builder.withReasoning({
        enabled: true,
        ...(cfg.effort && { effort: cfg.effort as ReasoningEffort }),
        ...(cfg["budget-tokens"] && { budgetTokens: cfg["budget-tokens"] }),
      });
    }
  }

  // ─── Human-input handler (TUI only) ────────────────────────────────────────
  // In piped mode, AskUser gadget is excluded from the registry, so no handler needed.
  if (tui) {
    builder.onHumanInput(async (question: string) => {
      return tui.waitForInput(question, "AskUser");
    });
  }

  // ─── Abort signal ──────────────────────────────────────────────────────────
  builder.withSignal(abortController.signal);

  // ─── Gadgets ───────────────────────────────────────────────────────────────
  const gadgets = gadgetRegistry.getAll();
  if (gadgets.length > 0) {
    builder.withGadgets(...gadgets);
  }

  // ─── MCP servers ───────────────────────────────────────────────────────────
  // TOML-defined first, then ad-hoc CLI flags (CLI flags override TOML on collision).
  const mcpFromToml = (await import("./mcp-toml.js")).mcpServersTomlToSpecs(fullConfig?.mcp);
  const mcpFromFlags =
    options.mcpServer && options.mcpServer.length > 0
      ? (await import("./mcp-options.js")).parseMcpServerFlags(
          options.mcpServer,
          options.mcpTrust ?? [],
        )
      : [];

  if (mcpFromToml.length > 0 || mcpFromFlags.length > 0) {
    const seen = new Set<string>();
    for (const spec of mcpFromToml) {
      builder.withMcpServer(spec);
      seen.add(spec.name);
    }
    for (const spec of mcpFromFlags) {
      if (seen.has(spec.name)) {
        env.stderr.write(
          `[mcp] --mcp-server "${spec.name}" overrides TOML mcp.servers.${spec.name}\n`,
        );
      }
      builder.withMcpServer(spec);
    }
  }

  // ─── Gadget block markers ──────────────────────────────────────────────────
  // Use custom prefixes if configured; otherwise fall back to library defaults.
  if (options.gadgetStartPrefix) {
    builder.withGadgetStartPrefix(options.gadgetStartPrefix);
  }
  if (options.gadgetEndPrefix) {
    builder.withGadgetEndPrefix(options.gadgetEndPrefix);
  }
  if (options.gadgetArgPrefix) {
    builder.withGadgetArgPrefix(options.gadgetArgPrefix);
  }

  // ─── Synthetic gadget calls ────────────────────────────────────────────────
  // Inject heredoc example for in-context learning (teaches the LLM gadget syntax).
  builder.withSyntheticGadgetCall(
    "TellUser",
    {
      message: "👋 Hello! I'm ready to help.\n\nWhat would you like me to work on?",
      done: false,
      type: "info",
    },
    "ℹ️  👋 Hello! I'm ready to help.\n\nWhat would you like me to work on?",
    "gc_init_1",
  );

  // Apply initial gadgets from config (pre-seeded conversation context).
  // These appear as if the agent already called these gadgets and received results.
  if (options.initialGadgets) {
    for (let i = 0; i < options.initialGadgets.length; i++) {
      const ig = options.initialGadgets[i];
      builder.withSyntheticGadgetCall(
        ig.gadget,
        ig.parameters,
        ig.result,
        `gc_init_${i + 2}`, // Start at 2 since gc_init_1 is TellUser greeting
      );
    }
  }

  // ─── Text handlers ─────────────────────────────────────────────────────────
  // Continue looping when LLM responds with just text (no gadget calls).
  builder.withTextOnlyHandler("acknowledge");

  // Wrap text that accompanies gadget calls as TellUser gadget calls.
  builder.withTextWithGadgetsHandler({
    gadgetName: "TellUser",
    parameterMapping: (text) => ({ message: text, done: false, type: "info" }),
    resultMapping: (text) => `ℹ️  ${text}`,
  });

  // ─── Trailing message ──────────────────────────────────────────────────────
  // Ephemeral message appended to each LLM request (NOT persisted in history).
  // Encourages parallel gadget invocations.
  builder.withTrailingMessage((ctx) =>
    [
      `[Iteration ${ctx.iteration + 1}/${ctx.maxIterations}${ctx.budget ? ` | Budget: $${ctx.totalCost.toFixed(4)}/$${ctx.budget}` : ""}]`,
      "Think carefully in two steps: 1. what gadget invocations we should be making next? 2. how do they depend on one another so we can run all of them in the right order? Then respond with all the gadget invocations you are able to do now.",
    ].join(" "),
  );
}
