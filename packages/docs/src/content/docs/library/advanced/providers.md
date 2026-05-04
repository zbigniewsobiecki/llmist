---
title: Providers
description: Multi-provider LLM support
---

llmist supports multiple LLM providers out of the box.

## Supported Providers

| Provider | Env Variable | Prefix | Reasoning | Pricing |
|----------|--------------|--------|-----------|---------|
| OpenAI | `OPENAI_API_KEY` | `openai:` | ✓ `reasoning.effort` | Paid |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic:` | ✓ Extended thinking | Paid |
| Google Gemini | `GEMINI_API_KEY` | `gemini:` | ✓ Thinking config | Paid |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter:` or `or:` | ✓ (model-dependent) | Paid |
| HuggingFace | `HF_TOKEN` | `huggingface:` or `hf:` | — | **Free** |

## Auto-Discovery

llmist automatically discovers providers based on environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
export HF_TOKEN="hf_..."
```

```typescript
const client = new LLMist();

.withModel('gpt-5')                                    // OpenAI (auto-detected)
.withModel('claude-sonnet-4-5')                        // Anthropic (auto-detected)
.withModel('gemini-2.5-flash')                         // Gemini (auto-detected)
.withModel('meta-llama/Llama-3.1-8B-Instruct')         // HuggingFace (auto-detected)
```

## Explicit Provider Prefix

Use `provider:model` format:

```typescript
.withModel('openai:gpt-5')
.withModel('anthropic:claude-sonnet-4-5-20250929')
.withModel('gemini:gemini-2.5-flash')
.withModel('huggingface:deepseek-ai/DeepSeek-V3.2')
.withModel('hf:Qwen/Qwen2.5-72B-Instruct:fastest')  // With routing
```

## Manual Provider Setup

```typescript
import { LLMist, OpenAIChatProvider, AnthropicMessagesProvider, OpenRouterProvider } from 'llmist';
import OpenAI from 'openai';

const client = new LLMist({
  autoDiscoverProviders: false,
  adapters: [
    new OpenAIChatProvider({ apiKey: 'sk-...' }),
    new AnthropicMessagesProvider({ apiKey: 'sk-ant-...' }),
  ],
  defaultProvider: 'openai',
});
```

### OpenRouterProvider

`OpenRouterProvider` provides access to 400+ models from dozens of providers through a single unified gateway. It supports prompt caching, model routing strategies, and reasoning models.

```typescript
import { LLMist, OpenRouterProvider } from 'llmist';
import OpenAI from 'openai';

const openrouterClient = new OpenAI({
  apiKey: 'sk-or-...',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://myapp.com',  // Optional: for analytics
    'X-Title': 'My App',                  // Optional: for analytics
  },
});

const client = new LLMist({
  autoDiscoverProviders: false,
  adapters: [
    new OpenRouterProvider(openrouterClient, {
      siteUrl: 'https://myapp.com',   // Optional
      appName: 'My App',              // Optional
    }),
  ],
});
```

Use the `openrouter:` or `or:` prefix to route to specific models, with optional routing strategy:

```typescript
.withModel('openrouter:anthropic/claude-sonnet-4-5')
.withModel('or:meta-llama/llama-3.1-70b-instruct:fastest')  // Route to fastest provider
.withModel('or:mistralai/mistral-large:cheapest')             // Route to cheapest provider
```

## Creating Custom Providers

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  readonly priority?: number;

  supports(model: ModelDescriptor): boolean;
  stream(options: LLMGenerationOptions, descriptor: ModelDescriptor): LLMStream;
  getModelSpecs?(): ModelSpec[];
  countTokens?(messages: LLMMessage[], descriptor: ModelDescriptor): Promise<number>;
}
```

## See Also

- [Model Catalog](/library/advanced/model-catalog/) - Query available models
- [Custom Models](/library/advanced/custom-models/) - Register fine-tuned models
- [Reasoning Models](/library/guides/reasoning-models/) - Provider-specific reasoning support
