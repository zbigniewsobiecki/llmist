/**
 * Gemini research agent catalog (Interactions API deep research).
 *
 * Deep research runs as provider-managed *agents* (`agent` field, not
 * `model`) — `kind: "agent"`, no chat/context-window semantics. Google
 * publishes no unversioned alias; these preview ids are the current set.
 *
 * Pricing: per-token at standard Gemini rates (base ≤200K-context tier)
 * plus Google Search at $14/1k queries after the free tier. Verified
 * 2026-07-02 against ai.google.dev/gemini-api/docs/pricing.
 */

import { GEMINI_RESEARCH_MAX_DURATION_MS } from "../research/constants.js";
import type { ResearchModelSpec } from "../research/model-spec.js";

function geminiResearchAgent(params: {
  agentId: string;
  displayName: string;
  notes?: string;
}): ResearchModelSpec {
  return {
    provider: "gemini",
    modelId: params.agentId,
    kind: "agent",
    displayName: params.displayName,
    // Gemini 3.1 Pro base-tier token rates; >200K-context tier is higher.
    pricing: { input: 2, output: 12, perThousandSearches: 14 },
    capabilities: {
      streaming: true,
      // The Interactions API requires background execution for deep research.
      background: true,
      resumable: true,
      followUps: true,
      // Research tools are agent-managed — the tools option is not accepted.
      tools: [],
    },
    // Interactions enforces a 60-minute research cap server-side.
    maxDurationMs: GEMINI_RESEARCH_MAX_DURATION_MS,
    metadata: params.notes ? { notes: params.notes } : undefined,
  };
}

export const geminiResearchModels: ResearchModelSpec[] = [
  geminiResearchAgent({
    agentId: "deep-research-preview-04-2026",
    displayName: "Gemini Deep Research (preview 04-2026)",
    notes: "Speed-optimized deep research agent on a Gemini 3.1 Pro core.",
  }),
  geminiResearchAgent({
    agentId: "deep-research-max-preview-04-2026",
    displayName: "Gemini Deep Research Max (preview 04-2026)",
    notes: "Maximum-comprehensiveness variant; roughly 2x the searches and tokens per run.",
  }),
  geminiResearchAgent({
    agentId: "deep-research-pro-preview-12-2025",
    displayName: "Gemini Deep Research Pro (preview 12-2025)",
    notes: "Original deep research agent (Gemini 3 Pro core); prefer the 04-2026 agents.",
  }),
];

const byId = new Map(geminiResearchModels.map((spec) => [spec.modelId, spec]));

export function getGeminiResearchModelSpec(agentId: string): ResearchModelSpec | undefined {
  return byId.get(agentId);
}

export function isGeminiResearchModel(agentId: string): boolean {
  return byId.has(agentId);
}
