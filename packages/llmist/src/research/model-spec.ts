/**
 * Research model catalog types.
 *
 * Research-capable models get their own catalog (mirroring the image/speech
 * media catalogs) instead of overloading `ModelSpec`: Gemini research "agents"
 * have no chat/context-window semantics, and research pricing has dimensions
 * (`perThousandSearches`, `internalReasoning`) that `ModelPricing` lacks.
 *
 * Research capability is **catalog-driven** — nothing outside a catalog file
 * should test model-id strings.
 */

import type { ResearchToolConfig, ResearchToolType } from "./types.js";

/**
 * Research pricing. Token rates are USD per 1M tokens.
 */
export interface ResearchPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens (defaults to `input` when omitted). */
  cachedInput?: number;
  /**
   * USD per 1M internal reasoning tokens, when the provider prices them
   * separately from output (Perplexity sonar-deep-research: 3.0). When set,
   * reasoning tokens are billed at this rate and excluded from `output`.
   */
  internalReasoning?: number;
  /**
   * USD per 1,000 web searches (OpenAI web search: 10, Perplexity
   * sonar-deep-research: 5, sonar-pro-search: 18, Gemini: 14 post-free-tier).
   */
  perThousandSearches?: number;
}

/** Capability flags for a research model/agent. */
export interface ResearchCapabilities {
  /** Whether live event streaming is supported (gpt-5.5-pro: false → create+poll). */
  streaming: boolean;
  /** Whether server-side background jobs are supported. */
  background: boolean;
  /** Whether a dropped stream can resume from a cursor. */
  resumable: boolean;
  /** Whether follow-up runs can reference a previous job (Gemini). */
  followUps?: boolean;
  /** Tool types accepted by this model (empty = tools are provider-managed). */
  tools: ResearchToolType[];
}

/** Lifecycle metadata for a research model/agent. */
export interface ResearchModelMetadata {
  releaseDate?: string;
  /** Date the provider announced deprecation. */
  deprecationDate?: string;
  /**
   * Date the provider removes the model (ISO date). Starting a run past this
   * date throws `ResearchDeprecatedModelError`; within the warning window a
   * warning is logged.
   */
  shutdownDate?: string;
  /** Recommended replacement model id, surfaced in deprecation errors. */
  replacement?: string;
  notes?: string;
}

/**
 * A research-capable model, agent, or preset.
 */
export interface ResearchModelSpec {
  /** Provider adapter id (e.g. "openai", "gemini", "openrouter"). */
  provider: string;
  /** Model id, agent id, or preset id (unprefixed). */
  modelId: string;
  /**
   * - `"model"` — a regular model doing research via tools (OpenAI, OpenRouter)
   * - `"agent"` — a provider-managed research agent (Gemini Interactions)
   * - `"preset"` — an llmist-orchestrated research preset (reserved; future Anthropic track)
   */
  kind: "model" | "agent" | "preset";
  displayName: string;
  /** Context window in tokens (undefined for agents/presets). */
  contextWindow?: number;
  /** Max output tokens (undefined for agents/presets). */
  maxOutputTokens?: number;
  pricing: ResearchPricing;
  capabilities: ResearchCapabilities;
  /**
   * Tools injected when the caller supplies none (e.g. OpenAI research
   * requires at least one data source → `[{type: "web_search"}]`).
   */
  requiredTools?: ResearchToolConfig[];
  /** Provider-enforced maximum run duration (Gemini: 60 minutes). */
  maxDurationMs?: number;
  metadata?: ResearchModelMetadata;
}
