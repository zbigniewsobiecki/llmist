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
import { LLMist, OpenAIChatProvider, AnthropicMessagesProvider } from 'llmist';

const client = new LLMist({
  autoDiscoverProviders: false,
  adapters: [
    new OpenAIChatProvider({ apiKey: 'sk-...' }),
    new AnthropicMessagesProvider({ apiKey: 'sk-ant-...' }),
  ],
  defaultProvider: 'openai',
});
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
