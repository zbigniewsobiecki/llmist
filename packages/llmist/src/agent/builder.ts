/**
 * Fluent builder for creating agents with delightful DX.
 */

import { readFileSync } from "node:fs";
import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import type { ContentPart, ImageMimeType } from "../core/input-content.js";
import { resolveModel } from "../core/model-shortcuts.js";
import type { CachingConfig, ReasoningConfig, ReasoningEffort } from "../core/options.js";
import type { PromptTemplateConfig } from "../core/prompt-config.js";
import type { RateLimitConfig } from "../core/rate-limit.js";
import type { RetryConfig } from "../core/retry.js";
import type { GadgetOrClass } from "../gadgets/registry.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type {
  ExecutionContext,
  GadgetExecutionMode,
  SubagentConfigMap,
  TextOnlyHandler,
} from "../gadgets/types.js";
import { resolveInstructions } from "../skills/activation.js";
import { loadSkillsFromDirectory } from "../skills/loader.js";
import { parseFrontmatter } from "../skills/parser.js";
import { SkillRegistry } from "../skills/registry.js";
import { createUseSkillGadget } from "../skills/use-skill-gadget.js";
import { Agent, type AgentOptions } from "./agent.js";
import { AGENT_INTERNAL_KEY } from "./agent-internal-key.js";
import type {
  CoreState,
  GadgetState,
  HistoryMessage,
  PolicyState,
  RetryState,
  SkillState,
  SubagentState,
} from "./builder-types.js";
import {
  buildMultimodalContent,
  extractMessagesFromAgent,
  formatGadgetCall,
  normalizeHistory,
} from "./builder-utils.js";
import type { CompactionConfig } from "./compaction/config.js";
import { collectText, type EventHandlers } from "./event-handlers.js";
import { HookComposer, type TrailingMessage } from "./hook-composer.js";
import type { AgentHooks } from "./hooks.js";

export type { HistoryMessage } from "./builder-types.js";

/**
 * Fluent builder for creating agents.
 *
 * Provides a chainable API for configuring and creating agents,
 * making the code more expressive and easier to read.
 */
export class AgentBuilder {
  private core: CoreState;
  private gadgets: GadgetState;
  private retry: RetryState;
  private subagents: SubagentState;
  private policies: PolicyState;
  private skills: SkillState;

  constructor(client?: LLMist) {
    this.core = { client, initialMessages: [] };
    this.gadgets = { gadgets: [] };
    this.retry = {};
    this.subagents = {};
    this.policies = {};
    this.skills = { preActivated: [], skillDirs: [] };
  }

  /** Set the model to use. Supports aliases like "sonnet", "flash". */
  withModel(model: string): this {
    this.core.model = resolveModel(model);
    return this;
  }

  /** Set the system prompt. */
  withSystem(prompt: string): this {
    this.core.systemPrompt = prompt;
    return this;
  }

  /** Set the temperature (0-1). */
  withTemperature(temperature: number): this {
    this.core.temperature = temperature;
    return this;
  }

  /** Set maximum iterations. */
  withMaxIterations(max: number): this {
    this.core.maxIterations = max;
    return this;
  }

  /** Set the budget limit in USD. */
  withBudget(amountUSD: number): this {
    this.core.budget = amountUSD;
    return this;
  }

  /** Set logger instance. */
  withLogger(logger: Logger<ILogObj>): this {
    this.core.logger = logger;
    return this;
  }

  /** Add hooks for agent lifecycle events. */
  withHooks(hooks: AgentHooks): this {
    this.core.hooks = hooks;
    return this;
  }

  /** Configure custom prompts for gadget system messages. */
  withPromptTemplateConfig(config: PromptTemplateConfig): this {
    this.core.promptConfig = config;
    return this;
  }

  /** Add gadgets (classes or instances). */
  withGadgets(...gadgets: GadgetOrClass[]): this {
    this.gadgets.gadgets.push(...gadgets);
    return this;
  }

  /** Add conversation history messages. */
  withHistory(messages: HistoryMessage[]): this {
    this.core.initialMessages.push(...normalizeHistory(messages));
    return this;
  }

  /** Add a single message to the conversation history. */
  addMessage(message: HistoryMessage): this {
    return this.withHistory([message]);
  }

  /** Clear any previously set conversation history. */
  clearHistory(): this {
    this.core.initialMessages = [];
    return this;
  }

  /** Continue conversation from a previous agent's history. */
  continueFrom(agent: Agent): this {
    this.clearHistory();
    this.core.initialMessages.push(...extractMessagesFromAgent(agent));
    return this;
  }

  /** Set the human input handler for interactive conversations. */
  onHumanInput(handler: (question: string) => Promise<string>): this {
    this.core.requestHumanInput = handler;
    return this;
  }

  /** Set custom gadget marker prefix. */
  withGadgetStartPrefix(prefix: string): this {
    this.gadgets.gadgetStartPrefix = prefix;
    return this;
  }

  /** Set custom gadget marker suffix. */
  withGadgetEndPrefix(suffix: string): this {
    this.gadgets.gadgetEndPrefix = suffix;
    return this;
  }

  /** Set custom argument prefix for block format parameters. */
  withGadgetArgPrefix(prefix: string): this {
    this.gadgets.gadgetArgPrefix = prefix;
    return this;
  }

  /** Set the text-only handler strategy. */
  withTextOnlyHandler(handler: TextOnlyHandler): this {
    this.gadgets.textOnlyHandler = handler;
    return this;
  }

  /** Set the handler for text content that appears alongside gadget calls. */
  withTextWithGadgetsHandler(handler: {
    gadgetName: string;
    parameterMapping: (text: string) => Record<string, unknown>;
    resultMapping?: (text: string) => string;
  }): this {
    this.gadgets.textWithGadgetsHandler = handler;
    return this;
  }

  /** Set default timeout for gadget execution. */
  withDefaultGadgetTimeout(timeoutMs: number): this {
    if (timeoutMs < 0) throw new Error("Timeout must be a non-negative number");
    this.gadgets.defaultGadgetTimeoutMs = timeoutMs;
    return this;
  }

  /** Set the gadget execution mode ('parallel' or 'sequential'). */
  withGadgetExecutionMode(mode: GadgetExecutionMode): this {
    this.gadgets.gadgetExecutionMode = mode;
    return this;
  }

  /** Set the maximum number of gadgets to execute per LLM response. */
  withMaxGadgetsPerResponse(max: number): this {
    if (max < 0) throw new Error("maxGadgetsPerResponse must be a non-negative number");
    if (!Number.isInteger(max)) throw new Error("maxGadgetsPerResponse must be an integer");
    this.gadgets.maxGadgetsPerResponse = max;
    return this;
  }

  /** Enable or disable gadget output limiting. */
  withGadgetOutputLimit(enabled: boolean): this {
    this.gadgets.gadgetOutputLimit = enabled;
    return this;
  }

  /** Set the maximum gadget output as a percentage of the context window. */
  withGadgetOutputLimitPercent(percent: number): this {
    if (percent < 1 || percent > 100)
      throw new Error("Output limit percent must be between 1 and 100");
    this.gadgets.gadgetOutputLimitPercent = percent;
    return this;
  }

  /** Configure context compaction. */
  withCompaction(config: CompactionConfig): this {
    this.policies.compactionConfig = { ...config, enabled: config.enabled ?? true };
    return this;
  }

  /** Disable context compaction. */
  withoutCompaction(): this {
    this.policies.compactionConfig = { enabled: false };
    return this;
  }

  // ─── Skills ──────────────────────────────────────────────────────────────────

  /** Register a skill registry for this agent. */
  withSkills(registry: SkillRegistry): this {
    this.skills.registry = registry;
    return this;
  }

  /**
   * Pre-activate a specific skill before the agent starts.
   * Instructions are injected into the system prompt.
   *
   * Note: each call replaces (not appends) the pre-activated skill for that name.
   * This is safe for REPL loops where the same builder is reused.
   */
  withSkill(name: string, args?: string): this {
    // Deduplicate: replace existing entry for same skill name
    const existing = this.skills.preActivated.findIndex((s) => s.name === name);
    if (existing !== -1) {
      this.skills.preActivated[existing] = { name, args };
    } else {
      this.skills.preActivated.push({ name, args });
    }
    return this;
  }

  /** Clear all pre-activated skills. Call between REPL iterations. */
  clearPreActivatedSkills(): this {
    this.skills.preActivated = [];
    return this;
  }

  /** Add a directory to scan for skills. */
  withSkillsFrom(dir: string): this {
    this.skills.skillDirs.push(dir);
    return this;
  }

  /** Configure retry behavior for LLM API calls. */
  withRetry(config: RetryConfig): this {
    this.retry.retryConfig = { ...config, enabled: config.enabled ?? true };
    return this;
  }

  /** Disable automatic retry for LLM API calls. */
  withoutRetry(): this {
    this.retry.retryConfig = { enabled: false };
    return this;
  }

  /** Configure proactive rate limiting to prevent rate limit errors. */
  withRateLimits(config: RateLimitConfig): this {
    this.subagents.rateLimitConfig = config;
    return this;
  }

  /** Set an abort signal for cancelling requests mid-flight. */
  withSignal(signal: AbortSignal): this {
    this.core.signal = signal;
    return this;
  }

  /** Enable reasoning/thinking mode for reasoning-capable models. */
  withReasoning(config?: ReasoningConfig | ReasoningEffort): this {
    if (typeof config === "string") {
      this.core.reasoningConfig = { enabled: true, effort: config };
    } else if (config === undefined) {
      this.core.reasoningConfig = { enabled: true, effort: "medium" };
    } else {
      this.core.reasoningConfig = config;
    }
    return this;
  }

  /** Explicitly disable reasoning for this agent. */
  withoutReasoning(): this {
    this.core.reasoningConfig = { enabled: false };
    return this;
  }

  /** Enable context caching for supported providers. */
  withCaching(config?: CachingConfig): this {
    this.core.cachingConfig = config ?? { enabled: true };
    return this;
  }

  /** Explicitly disable context caching. */
  withoutCaching(): this {
    this.core.cachingConfig = { enabled: false };
    return this;
  }

  /** Set subagent configuration overrides. */
  withSubagentConfig(config: SubagentConfigMap): this {
    this.subagents.subagentConfig = config;
    return this;
  }

  /** Share parent agent's ExecutionTree for unified event visibility. */
  withParentContext(ctx: ExecutionContext, depth = 1): this {
    if (ctx.tree) {
      this.subagents.parentContext = { tree: ctx.tree, nodeId: ctx.nodeId, depth };
    }
    if (ctx.signal && !this.core.signal) this.core.signal = ctx.signal;
    if (ctx.logger && !this.core.logger) this.core.logger = ctx.logger;
    if (ctx.parentObservers && !this.subagents.parentObservers) {
      this.subagents.parentObservers = ctx.parentObservers;
    }
    if (ctx.rateLimitTracker && !this.subagents.sharedRateLimitTracker) {
      this.subagents.sharedRateLimitTracker = ctx.rateLimitTracker;
    }
    if (ctx.retryConfig && !this.retry.sharedRetryConfig) {
      this.retry.sharedRetryConfig = ctx.retryConfig;
    }
    return this;
  }

  /** Add an ephemeral trailing message that appears at the end of each LLM request. */
  withTrailingMessage(message: TrailingMessage): this {
    this.core.trailingMessage = message;
    return this;
  }

  /** Add a synthetic gadget call to the conversation history for in-context learning. */
  withSyntheticGadgetCall(
    gadgetName: string,
    parameters: Record<string, unknown>,
    result: string,
    invocationId: string,
  ): this {
    const content = formatGadgetCall(gadgetName, invocationId, parameters, {
      start: this.gadgets.gadgetStartPrefix,
      end: this.gadgets.gadgetEndPrefix,
      arg: this.gadgets.gadgetArgPrefix,
    });

    this.core.initialMessages.push({ role: "assistant", content });
    this.core.initialMessages.push({
      role: "user",
      content: `Result (${invocationId}): ${result}`,
    });
    return this;
  }

  private composeHooks(): AgentHooks | undefined {
    return HookComposer.compose(this.core.hooks, this.core.trailingMessage);
  }

  private resolveSkillRegistry(): SkillRegistry | undefined {
    if (this.skills.registry) {
      if (this.skills.skillDirs.length > 0) {
        for (const dir of this.skills.skillDirs) {
          const skills = loadSkillsFromDirectory(dir, { type: "directory", path: dir });
          this.skills.registry.registerMany(skills);
        }
      }
      return this.skills.registry;
    }

    if (this.skills.skillDirs.length > 0) {
      const reg = new SkillRegistry();
      for (const dir of this.skills.skillDirs) {
        const skills = loadSkillsFromDirectory(dir, { type: "directory", path: dir });
        reg.registerMany(skills);
      }
      return reg;
    }

    return undefined;
  }

  /**
   * Resolve pre-activated skill instructions synchronously.
   * Reads SKILL.md from disk via readFileSync (skills are local files).
   */
  private resolvePreActivatedInstructions(skillRegistry: SkillRegistry): string | undefined {
    if (this.skills.preActivated.length === 0) return undefined;

    const blocks: string[] = [];
    for (const { name, args } of this.skills.preActivated) {
      const skill = skillRegistry.get(name);
      if (!skill) continue;
      const content = readFileSync(skill.sourcePath, "utf-8");
      const { body } = parseFrontmatter(content);
      const resolved = resolveInstructions(body, {
        arguments: args,
        variables: { SKILL_DIR: skill.sourceDir, CLAUDE_SKILL_DIR: skill.sourceDir },
        cwd: skill.sourceDir,
        shell: skill.metadata.shell,
      });
      blocks.push(`## Skill: ${name}\n\n${resolved}`);
    }
    return blocks.length > 0 ? blocks.join("\n\n---\n\n") : undefined;
  }

  private buildAgentOptions(userPrompt?: string | ContentPart[]): AgentOptions {
    if (!this.core.client) {
      const { LLMist: LLMistClass } = require("../core/client.js");
      this.core.client = new LLMistClass();
    }

    const registry = GadgetRegistry.from(this.gadgets.gadgets);

    // ─── Skills integration ────────────────────────────────────────────────
    let systemPrompt = this.core.systemPrompt;
    const skillRegistry = this.resolveSkillRegistry();

    if (skillRegistry && skillRegistry.size > 0) {
      if (skillRegistry.getModelInvocable().length > 0) {
        registry.registerByClass(createUseSkillGadget(skillRegistry));
      }

      const preActivatedBlock = this.resolvePreActivatedInstructions(skillRegistry);
      if (preActivatedBlock) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${preActivatedBlock}` : preActivatedBlock;
      }
    }

    return {
      client: this.core.client as LLMist,
      model: this.core.model ?? "openai:gpt-5-nano",
      systemPrompt,
      userPrompt,
      registry,
      maxIterations: this.core.maxIterations,
      budget: this.core.budget,
      temperature: this.core.temperature,
      logger: this.core.logger,
      hooks: this.composeHooks(),
      promptConfig: this.core.promptConfig,
      initialMessages: this.core.initialMessages,
      requestHumanInput: this.core.requestHumanInput,
      prefixConfig: {
        gadgetStartPrefix: this.gadgets.gadgetStartPrefix,
        gadgetEndPrefix: this.gadgets.gadgetEndPrefix,
        gadgetArgPrefix: this.gadgets.gadgetArgPrefix,
      },
      textOnlyHandler: this.gadgets.textOnlyHandler,
      textWithGadgetsHandler: this.gadgets.textWithGadgetsHandler,
      defaultGadgetTimeoutMs: this.gadgets.defaultGadgetTimeoutMs,
      gadgetExecutionMode: this.gadgets.gadgetExecutionMode,
      maxGadgetsPerResponse: this.gadgets.maxGadgetsPerResponse,
      outputLimitConfig: {
        enabled: this.gadgets.gadgetOutputLimit,
        limitPercent: this.gadgets.gadgetOutputLimitPercent,
      },
      compactionConfig: this.policies.compactionConfig,
      retryConfig: this.retry.retryConfig,
      rateLimitConfig: this.subagents.rateLimitConfig,
      signal: this.core.signal,
      reasoning: this.core.reasoningConfig,
      caching: this.core.cachingConfig,
      subagentConfig: this.subagents.subagentConfig,
      treeConfig: {
        tree: this.subagents.parentContext?.tree,
        parentNodeId: this.subagents.parentContext?.nodeId,
        baseDepth: this.subagents.parentContext ? (this.subagents.parentContext.depth ?? 0) + 1 : 0,
        parentObservers: this.subagents.parentObservers,
      },
      sharedRateLimitTracker: this.subagents.sharedRateLimitTracker,
      sharedRetryConfig: this.retry.sharedRetryConfig,
    };
  }

  /** Create agent and start with a user prompt. */
  ask(userPrompt: string): Agent {
    return new Agent(AGENT_INTERNAL_KEY, this.buildAgentOptions(userPrompt));
  }

  /** Create agent with multimodal input (text + image). */
  askWithImage(
    textPrompt: string,
    imageData: Buffer | Uint8Array | string,
    mimeType?: ImageMimeType,
  ): Agent {
    const content = buildMultimodalContent(textPrompt, imageData, mimeType);
    return new Agent(AGENT_INTERNAL_KEY, this.buildAgentOptions(content));
  }

  /** Create agent with flexible multimodal content parts. */
  askWithContent(content: ContentPart[]): Agent {
    return new Agent(AGENT_INTERNAL_KEY, this.buildAgentOptions(content));
  }

  /** Run agent and collect text response. */
  async askAndCollect(userPrompt: string): Promise<string> {
    return collectText(this.ask(userPrompt).run());
  }

  /** Run agent with event handlers. */
  async askWith(userPrompt: string, handlers: EventHandlers): Promise<void> {
    await this.ask(userPrompt).runWith(handlers);
  }

  /** Build agent without a prompt (useful for testing/inspection). */
  build(): Agent {
    return new Agent(AGENT_INTERNAL_KEY, this.buildAgentOptions());
  }
}
