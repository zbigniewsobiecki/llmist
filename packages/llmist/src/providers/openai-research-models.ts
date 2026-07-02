/**
 * OpenAI research model catalog (Responses API deep research).
 *
 * Research capability is catalog-driven — nothing outside this file should
 * test OpenAI model-id strings for research support.
 *
 * ⚠️ `o3-deep-research` and `o4-mini-deep-research` (and their dated
 * snapshots) are deprecated upstream with shutdown on 2026-07-23; the
 * namespace warns/throws based on the metadata below. `gpt-5.5-pro` is the
 * durable research path (background + poll only — no streaming).
 *
 * Pricing verified 2026-07-02 against developers.openai.com/api/docs/pricing.
 */

import type { ResearchModelSpec } from "../research/model-spec.js";

/** All four data-source/auxiliary tool types are accepted by DR models. */
const DEEP_RESEARCH_TOOLS: ResearchModelSpec["capabilities"]["tools"] = [
  "web_search",
  "file_search",
  "mcp",
  "code_interpreter",
];

const DEEP_RESEARCH_SHUTDOWN = {
  deprecationDate: "2026-04-22",
  shutdownDate: "2026-07-23",
  replacement: "gpt-5.5-pro",
} as const;

function o3DeepResearch(modelId: string): ResearchModelSpec {
  return {
    provider: "openai",
    modelId,
    kind: "model",
    displayName: "o3 Deep Research",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { input: 10, cachedInput: 2.5, output: 40, perThousandSearches: 10 },
    capabilities: {
      streaming: true,
      background: true,
      resumable: true,
      tools: DEEP_RESEARCH_TOOLS,
    },
    requiredTools: [{ type: "web_search" }],
    metadata: { releaseDate: "2025-06-26", ...DEEP_RESEARCH_SHUTDOWN },
  };
}

function o4MiniDeepResearch(modelId: string): ResearchModelSpec {
  return {
    provider: "openai",
    modelId,
    kind: "model",
    displayName: "o4-mini Deep Research",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { input: 2, cachedInput: 0.5, output: 8, perThousandSearches: 10 },
    capabilities: {
      streaming: true,
      background: true,
      resumable: true,
      tools: DEEP_RESEARCH_TOOLS,
    },
    requiredTools: [{ type: "web_search" }],
    metadata: { releaseDate: "2025-06-26", ...DEEP_RESEARCH_SHUTDOWN },
  };
}

export const openaiResearchModels: ResearchModelSpec[] = [
  o3DeepResearch("o3-deep-research"),
  o3DeepResearch("o3-deep-research-2025-06-26"),
  o4MiniDeepResearch("o4-mini-deep-research"),
  o4MiniDeepResearch("o4-mini-deep-research-2025-06-26"),
  {
    provider: "openai",
    modelId: "gpt-5.5-pro",
    kind: "model",
    displayName: "GPT-5.5 Pro (research)",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    pricing: { input: 30, output: 180, perThousandSearches: 10 },
    capabilities: {
      // No live streaming — runs execute via background create + poll.
      streaming: false,
      background: true,
      // Resumable in the attach sense: the poll loop re-attaches by job id.
      resumable: true,
      tools: DEEP_RESEARCH_TOOLS,
    },
    requiredTools: [{ type: "web_search" }],
    metadata: {
      releaseDate: "2026-04-24",
      notes: "Designated replacement for the o3/o4-mini deep research models.",
    },
  },
];

const byId = new Map(openaiResearchModels.map((spec) => [spec.modelId, spec]));

export function getOpenAIResearchModelSpec(modelId: string): ResearchModelSpec | undefined {
  return byId.get(modelId);
}

export function isOpenAIResearchModel(modelId: string): boolean {
  return byId.has(modelId);
}
