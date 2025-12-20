---
title: Providers
description: Multi-provider LLM support
---

llmist supports multiple LLM providers out of the box.

## Supported Providers

| Provider | Env Variable | Prefix |
|----------|--------------|--------|
| OpenAI | `OPENAI_API_KEY` | `openai:` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic:` |
| Google Gemini | `GEMINI_API_KEY` | `gemini:` |

## Auto-Discovery

llmist automatically discovers providers based on environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

```typescript
const client = new LLMist();

.withModel('gpt-5')              // OpenAI (auto-detected)
.withModel('claude-sonnet-4-5')  // Anthropic (auto-detected)
.withModel('gemini-2.5-flash')   // Gemini (auto-detected)
```

## Explicit Provider Prefix

Use `provider:model` format:

```typescript
.withModel('openai:gpt-5')
.withModel('anthropic:claude-sonnet-4-5-20250929')
.withModel('gemini:gemini-2.5-flash')
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

- [Model Catalog](/advanced/model-catalog/) - Query available models
- [Custom Models](/advanced/custom-models/) - Register fine-tuned models
