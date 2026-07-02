/**
 * OpenRouter research model catalog.
 *
 * These models run deep research server-side (at Perplexity / OpenAI) over
 * OpenRouter's plain chat-completions surface: streaming is mandatory
 * (multi-minute runs hit 60s idle disconnects otherwise), there is no
 * background mode, no job id, and no resume — a dropped stream cannot be
 * re-attached and is never silently re-run (money-safety).
 *
 * Pricing verified 2026-07-02 against the live OpenRouter models API.
 */

import type { ResearchModelSpec } from "../research/model-spec.js";

/** Shared capability shape: stream-only, no background/resume, no tools param. */
const OPENROUTER_STREAM_ONLY: ResearchModelSpec["capabilities"] = {
  streaming: true,
  background: false,
  resumable: false,
  tools: [],
};

export const openrouterResearchModels: ResearchModelSpec[] = [
  {
    provider: "openrouter",
    modelId: "perplexity/sonar-deep-research",
    kind: "model",
    displayName: "Perplexity Sonar Deep Research",
    contextWindow: 128_000,
    pricing: {
      input: 2,
      output: 8,
      // Internal reasoning tokens are priced separately from output.
      internalReasoning: 3,
      perThousandSearches: 5,
    },
    capabilities: OPENROUTER_STREAM_ONLY,
    metadata: {
      notes:
        "R1-style think-then-write: expect a long reasoning stream (100k+ tokens) before report text.",
    },
  },
  {
    provider: "openrouter",
    modelId: "perplexity/sonar-pro-search",
    kind: "model",
    displayName: "Perplexity Sonar Pro Search",
    contextWindow: 200_000,
    pricing: { input: 3, output: 15, perThousandSearches: 18 },
    capabilities: OPENROUTER_STREAM_ONLY,
    metadata: { notes: "Agentic multi-step Pro Search — lighter than full deep research." },
  },
  {
    provider: "openrouter",
    modelId: "openai/o3-deep-research",
    kind: "model",
    displayName: "OpenAI o3 Deep Research (via OpenRouter)",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { input: 10, cachedInput: 2.5, output: 40, perThousandSearches: 10 },
    capabilities: OPENROUTER_STREAM_ONLY,
    metadata: {
      // Upstream OpenAI shutdown propagates through OpenRouter.
      deprecationDate: "2026-04-22",
      shutdownDate: "2026-07-23",
      replacement: "perplexity/sonar-deep-research",
      notes: "Tools are managed upstream — requests carry no tools param via OpenRouter.",
    },
  },
  {
    provider: "openrouter",
    modelId: "openai/o4-mini-deep-research",
    kind: "model",
    displayName: "OpenAI o4-mini Deep Research (via OpenRouter)",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { input: 2, cachedInput: 0.5, output: 8, perThousandSearches: 10 },
    capabilities: OPENROUTER_STREAM_ONLY,
    metadata: {
      deprecationDate: "2026-04-22",
      shutdownDate: "2026-07-23",
      replacement: "perplexity/sonar-deep-research",
      notes: "Tools are managed upstream — requests carry no tools param via OpenRouter.",
    },
  },
];

const byId = new Map(openrouterResearchModels.map((spec) => [spec.modelId, spec]));

export function getOpenRouterResearchModelSpec(modelId: string): ResearchModelSpec | undefined {
  return byId.get(modelId);
}

export function isOpenRouterResearchModel(modelId: string): boolean {
  return byId.has(modelId);
}
