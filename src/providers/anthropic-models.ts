/**
 * Anthropic Claude Model Specifications
 *
 * Model data for Anthropic Claude models including Sonnet and Opus variants
 * with their specifications, pricing, and capabilities.
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const ANTHROPIC_MODELS: ModelSpec[] = [
  {
    provider: "anthropic",
    modelId: "claude-opus-4-5-20251124",
    displayName: "Claude Opus 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 5.0,
      output: 25.0,
      cachedInput: 0.5,
    },
    knowledgeCutoff: "2025-03",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      releaseDate: "2025-11-24",
      notes:
        "Most powerful model. 80.9% SWE-bench Verified, 66.3% OSWorld. Best for coding and computer use.",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5-20250929",
    displayName: "Claude Sonnet 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 3.0,
      output: 15.0,
      cachedInput: 0.3,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      releaseDate: "2025-09-29",
      notes: "Smartest model for complex agents and coding. Extended thinking. 1M context in beta.",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 1.0,
      output: 5.0,
      cachedInput: 0.1,
    },
    knowledgeCutoff: "2025-02",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      releaseDate: "2025-10-01",
      notes:
        "Fastest model with near-frontier intelligence. Excellent for coding (73.3% SWE-bench).",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 3.0,
      output: 15.0,
      cachedInput: 0.3,
    },
    knowledgeCutoff: "2025-03",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      releaseDate: "2025-05-14",
      notes: "High performance with vision and extended thinking",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-3-7-sonnet-20250219",
    displayName: "Claude Sonnet 3.7",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 3.0,
      output: 15.0,
      cachedInput: 0.3,
    },
    knowledgeCutoff: "2024-11",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 3",
      releaseDate: "2025-02-19",
      notes: "Legacy model - consider upgrading to Claude 4 family",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-1-20250805",
    displayName: "Claude Opus 4.1",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    pricing: {
      input: 15.0,
      output: 75.0,
      cachedInput: 1.5,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      releaseDate: "2025-08-05",
      notes: "Exceptional for specialized reasoning tasks. Extended thinking support.",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-20250514",
    displayName: "Claude Opus 4",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    pricing: {
      input: 15.0,
      output: 75.0,
      cachedInput: 1.5,
    },
    knowledgeCutoff: "2025-03",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    metadata: {
      family: "Claude 4",
      releaseDate: "2025-05-14",
      notes: "Legacy Opus model - consider Opus 4.1 for improved reasoning",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-3-5-haiku-20241022",
    displayName: "Claude Haiku 3.5",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.8,
      output: 4.0,
      cachedInput: 0.08,
    },
    knowledgeCutoff: "2024-07",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    metadata: {
      family: "Claude 3",
      releaseDate: "2024-10-22",
      notes: "Legacy model - upgrade to Haiku 4.5 for better performance",
    },
  },
  {
    provider: "anthropic",
    modelId: "claude-3-haiku-20240307",
    displayName: "Claude Haiku 3",
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.25,
      output: 1.25,
      cachedInput: 0.025,
    },
    knowledgeCutoff: "2023-08",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    metadata: {
      family: "Claude 3",
      releaseDate: "2024-03-07",
      notes: "Legacy model - upgrade to Haiku 4.5 for better performance",
    },
  },
];
