/**
 * Hugging Face Model Specifications
 *
 * Curated list of trending and popular open-source models available on Hugging Face,
 * with verified specifications and pricing.
 *
 * Pricing: Free tier via serverless inference (router.huggingface.co)
 * Dedicated endpoints have separate pricing: https://huggingface.co/pricing#endpoints
 *
 * Model specs sourced from:
 * - Trending models on https://huggingface.co/models
 * - HF Inference Providers documentation
 * - Model cards and specifications
 *
 * Last updated: 2026-01-02 (based on current HF trending models)
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const HUGGINGFACE_MODELS: ModelSpec[] = [
  // ==========================================================================
  // DeepSeek Models (Top Trending - January 2026)
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-V3.2",
    displayName: "DeepSeek V3.2",
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-12",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "DeepSeek V3",
      releaseDate: "2025-12",
      notes:
        "685B MoE model optimized for faster, lower-cost inference with strong general reasoning and tool use.",
    },
  },

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-R1",
    displayName: "DeepSeek R1",
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-11",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
    },
    metadata: {
      family: "DeepSeek",
      releaseDate: "2025-01",
      notes:
        "MoE reasoning model that excels at math, logic, and coding with step-by-step reasoning.",
    },
  },

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-V3",
    displayName: "DeepSeek V3",
    contextWindow: 64_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-11",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "DeepSeek",
      releaseDate: "2024-12",
      notes: "Mixture-of-experts model with strong coding and reasoning capabilities.",
    },
  },

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-Coder-V2-Instruct",
    displayName: "DeepSeek Coder V2 Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-06",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "DeepSeek Coder",
      releaseDate: "2024-06",
      notes: "Specialized for code generation and programming tasks. Supports 338 languages.",
    },
  },

  // ==========================================================================
  // Meta Llama Models (Most Widely Supported)
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "meta-llama/Llama-3.1-8B-Instruct",
    displayName: "Llama 3.1 8B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-12",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Llama 3.1",
      releaseDate: "2024-07",
      notes:
        "Most widely supported and downloaded model on HF. Multi-provider support. Efficient 8B model with strong instruction following.",
    },
  },

  {
    provider: "huggingface",
    modelId: "meta-llama/Llama-3.3-70B-Instruct",
    displayName: "Llama 3.3 70B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-12",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Llama 3.3",
      releaseDate: "2024-12",
      notes: "Multilingual LLM with strong performance across benchmarks.",
    },
  },

  {
    provider: "huggingface",
    modelId: "meta-llama/Llama-3.2-11B-Vision-Instruct",
    displayName: "Llama 3.2 11B Vision Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: false,
      vision: true, // Vision support will be enabled in Phase 2
    },
    metadata: {
      family: "Llama 3.2",
      releaseDate: "2024-09",
      notes:
        "Multimodal model with vision capabilities. Vision support in llmist coming in Phase 2.",
    },
  },

  // ==========================================================================
  // Mistral Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "mistralai/Mistral-7B-Instruct-v0.3",
    displayName: "Mistral 7B Instruct v0.3",
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-09",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Mistral",
      releaseDate: "2024-05",
      notes: "Fast and efficient 7B model with extended context window.",
    },
  },

  {
    provider: "huggingface",
    modelId: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    displayName: "Mixtral 8x7B Instruct v0.1",
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-12",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Mixtral",
      releaseDate: "2023-12",
      notes: "Mixture-of-experts model with 8 experts, only 2 active per token for efficiency.",
    },
  },

  {
    provider: "huggingface",
    modelId: "mistralai/Mistral-Nemo-Instruct-2407",
    displayName: "Mistral Nemo Instruct 2407",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-04",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Mistral Nemo",
      releaseDate: "2024-07",
      notes: "12B model with 128k context, developed in partnership with NVIDIA.",
    },
  },

  // ==========================================================================
  // Qwen Models (Fast Inference, Top Tier)
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen3-Next-80B-A3B-Instruct",
    displayName: "Qwen 3 Next 80B Instruct",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-12",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Qwen 3",
      releaseDate: "2025-12",
      notes:
        "Instruction-tuned Qwen with enhanced multilingual reasoning, coding, and long context capabilities.",
    },
  },

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-7B-Instruct",
    displayName: "Qwen 2.5 7B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 2.5",
      releaseDate: "2024-09",
      notes:
        "Fast inference with tool calling support. Efficient 7B model with strong multilingual support.",
    },
  },

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-72B-Instruct",
    displayName: "Qwen 2.5 72B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 2.5",
      releaseDate: "2024-09",
      notes: "Multilingual model with excellent coding and math capabilities.",
    },
  },

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen3-4B-Instruct-2507",
    displayName: "Qwen 3 4B Instruct",
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2025-06",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 3",
      releaseDate: "2025-07",
      notes:
        "Ultra-lightweight model optimized for mobile and edge deployment with tool calling support.",
    },
  },

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
    displayName: "Qwen 2.5 Coder 32B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 2.5 Coder",
      releaseDate: "2024-11",
      notes: "Specialized coding model with support for 92 programming languages.",
    },
  },

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-7B-Instruct",
    displayName: "Qwen 2.5 7B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 2.5",
      releaseDate: "2024-09",
      notes: "Efficient 7B model with strong multilingual support.",
    },
  },

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen2-VL-72B-Instruct",
    displayName: "Qwen 2 VL 72B Instruct",
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-06",
    features: {
      streaming: true,
      functionCalling: false,
      vision: true, // Vision support coming in Phase 2
    },
    metadata: {
      family: "Qwen 2 VL",
      releaseDate: "2024-08",
      notes: "Multimodal vision-language model. Vision support in llmist coming in Phase 2.",
    },
  },

  // ==========================================================================
  // DeepSeek Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-V3",
    displayName: "DeepSeek V3",
    contextWindow: 64_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-11",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "DeepSeek",
      releaseDate: "2024-12",
      notes: "Mixture-of-experts model with strong coding and reasoning capabilities.",
    },
  },

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-R1",
    displayName: "DeepSeek R1",
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-11",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
    },
    metadata: {
      family: "DeepSeek",
      releaseDate: "2025-01",
      notes: "Reasoning-focused model with chain-of-thought capabilities.",
    },
  },

  {
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-Coder-V2-Instruct",
    displayName: "DeepSeek Coder V2 Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-06",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "DeepSeek Coder",
      releaseDate: "2024-06",
      notes: "Specialized for code generation and programming tasks. Supports 338 languages.",
    },
  },

  // ==========================================================================
  // Google Gemma Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "google/gemma-2-9b-it",
    displayName: "Gemma 2 9B Instruct",
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-02",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Gemma 2",
      releaseDate: "2024-06",
      notes: "Lightweight model from Google, efficient for edge deployment.",
    },
  },

  {
    provider: "huggingface",
    modelId: "google/gemma-2-27b-it",
    displayName: "Gemma 2 27B Instruct",
    contextWindow: 8_192,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-02",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Gemma 2",
      releaseDate: "2024-06",
      notes: "Larger Gemma variant with improved capabilities.",
    },
  },

  // ==========================================================================
  // Microsoft Phi Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "microsoft/Phi-3-mini-4k-instruct",
    displayName: "Phi-3 Mini 4K Instruct",
    contextWindow: 4_096,
    maxOutputTokens: 2_048,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-10",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Phi-3",
      releaseDate: "2024-04",
      notes: "Small language model (3.8B) optimized for mobile and edge devices.",
    },
  },

  {
    provider: "huggingface",
    modelId: "microsoft/Phi-3-medium-4k-instruct",
    displayName: "Phi-3 Medium 4K Instruct",
    contextWindow: 4_096,
    maxOutputTokens: 2_048,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-10",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "Phi-3",
      releaseDate: "2024-04",
      notes: "14B parameter model balancing size and performance.",
    },
  },

  // ==========================================================================
  // Cohere Command Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "CohereForAI/c4ai-command-r-plus-08-2024",
    displayName: "Command R+ (Aug 2024)",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-06",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Command R",
      releaseDate: "2024-08",
      notes: "RAG-optimized model with strong multilingual capabilities (23 languages).",
    },
  },

  {
    provider: "huggingface",
    modelId: "CohereForAI/c4ai-command-r-08-2024",
    displayName: "Command R (Aug 2024)",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-06",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Command R",
      releaseDate: "2024-08",
      notes: "Efficient model optimized for retrieval-augmented generation (RAG) tasks.",
    },
  },

  // ==========================================================================
  // Alibaba Qwen Models (Additional)
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
    displayName: "Qwen 2.5 Coder 32B Instruct",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 2.5 Coder",
      releaseDate: "2024-11",
      notes: "Specialized coding model with support for 92 programming languages.",
    },
  },

  // ==========================================================================
  // NousResearch Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "NousResearch/Hermes-3-Llama-3.1-8B",
    displayName: "Hermes 3 Llama 3.1 8B",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2024-07",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Hermes",
      releaseDate: "2024-08",
      notes:
        "Fine-tuned Llama 3.1 with enhanced function calling and structured output capabilities.",
    },
  },

  // ==========================================================================
  // StabilityAI Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "stabilityai/stablelm-2-12b-chat",
    displayName: "StableLM 2 12B Chat",
    contextWindow: 4_096,
    maxOutputTokens: 2_048,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-11",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "StableLM 2",
      releaseDate: "2024-01",
      notes: "Efficient chat model with multilingual support.",
    },
  },

  // ==========================================================================
  // Databricks Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "databricks/dbrx-instruct",
    displayName: "DBRX Instruct",
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-12",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "DBRX",
      releaseDate: "2024-03",
      notes: "Mixture-of-experts model (132B params, 36B active) optimized for efficiency.",
    },
  },

  // ==========================================================================
  // OpenAI Community Models
  // ==========================================================================

  {
    provider: "huggingface",
    modelId: "openai/gpt-oss-120b",
    displayName: "GPT OSS 120B",
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    pricing: {
      input: 0.0,
      output: 0.0,
    },
    knowledgeCutoff: "2023-09",
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
    },
    metadata: {
      family: "GPT OSS",
      releaseDate: "2024-12",
      notes: "Open-source GPT-style model from OpenAI research.",
    },
  },
];
