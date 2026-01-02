import { createAnthropicProviderFromEnv } from "./anthropic.js";
import { createGeminiProviderFromEnv } from "./gemini.js";
import { createHuggingFaceProviderFromEnv } from "./huggingface.js";
import { createOpenAIProviderFromEnv } from "./openai.js";
import type { ProviderAdapter } from "./provider.js";

export type ProviderDiscoverer = () => ProviderAdapter | null | undefined;

const DISCOVERERS: ProviderDiscoverer[] = [
  createOpenAIProviderFromEnv,
  createAnthropicProviderFromEnv,
  createGeminiProviderFromEnv,
  createHuggingFaceProviderFromEnv,
];

export function discoverProviderAdapters(): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];

  for (const discover of DISCOVERERS) {
    const adapter = discover();
    if (adapter) {
      adapters.push(adapter);
    }
  }

  return adapters;
}
