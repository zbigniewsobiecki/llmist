# Providers

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
# Set one or more API keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

```typescript
// Providers are auto-discovered
const client = new LLMist();

// Use any available provider
.withModel('gpt-5')              // OpenAI (auto-detected)
.withModel('claude-sonnet-4-5')  // Anthropic (auto-detected)
.withModel('gemini-2.5-flash')   // Gemini (auto-detected)
```

## Explicit Provider Prefix

Use `provider:model` format for explicit selection:

```typescript
.withModel('openai:gpt-5')
.withModel('anthropic:claude-sonnet-4-5-20250929')
.withModel('gemini:gemini-2.5-flash')
```

## Manual Provider Setup

Disable auto-discovery and register providers manually:

```typescript
import { LLMist, OpenAIChatProvider, AnthropicMessagesProvider } from 'llmist';

const client = new LLMist({
  autoDiscoverProviders: false,
  adapters: [
    new OpenAIChatProvider({ apiKey: 'sk-...' }),
    new AnthropicMessagesProvider({ apiKey: 'sk-ant-...' }),
  ],
  defaultProvider: 'openai', // Default when model has no prefix
});
```

## Provider Priority

When multiple providers are available, they're checked in order:

1. Explicit prefix (`openai:gpt-5`) - uses specified provider
2. Auto-detection (`gpt-5`) - detects provider from model name
3. Default provider - fallback for unknown models

```typescript
new LLMist({
  defaultProvider: 'anthropic', // Unknown models default to Anthropic
});
```

## LLMist Constructor Options

```typescript
interface LLMistOptions {
  adapters?: ProviderAdapter[];       // Manual adapters
  defaultProvider?: string;           // Default provider prefix
  autoDiscoverProviders?: boolean;    // Default: true
  customModels?: ModelSpec[];         // Register custom models
}
```

## Provider-Specific Features

### OpenAI

```typescript
// Models
.withModel('gpt-5')
.withModel('gpt-5-mini')
.withModel('gpt-5.1')      // Latest model
.withModel('gpt-5-nano')

// Token counting uses tiktoken
const tokens = await client.countTokens('openai:gpt-5', messages);
```

### Anthropic

```typescript
// Models
.withModel('claude-sonnet-4-5-20250929')
.withModel('claude-haiku-4-5-20251001')
.withModel('claude-opus-4-5-20251124')

// Native token counting API
const tokens = await client.countTokens('anthropic:claude-sonnet-4-5-20250929', messages);
```

### Google Gemini

```typescript
// Models
.withModel('gemini-2.5-flash')
.withModel('gemini-2.5-pro')
.withModel('gemini-3-pro-preview')

// SDK token counting
const tokens = await client.countTokens('gemini:gemini-2.5-flash', messages);
```

## Creating Custom Providers

Implement the `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  readonly priority?: number;  // Higher = checked first

  supports(model: ModelDescriptor): boolean;
  stream(options: LLMGenerationOptions, descriptor: ModelDescriptor): LLMStream;
  getModelSpecs?(): ModelSpec[];
  countTokens?(messages: LLMMessage[], descriptor: ModelDescriptor): Promise<number>;
}
```

```typescript
class MyProvider implements ProviderAdapter {
  providerId = 'my-provider';
  priority = 10; // High priority

  supports(model: ModelDescriptor): boolean {
    return model.provider === 'my-provider';
  }

  async *stream(options: LLMGenerationOptions): LLMStream {
    // Implement streaming
    yield { text: 'Response', finishReason: 'stop' };
  }
}

const client = new LLMist({
  adapters: [new MyProvider()],
});
```

## See Also

- **[Model Catalog](./MODEL_CATALOG.md)** - Query available models
- **[Custom Models](./CUSTOM_MODELS.md)** - Register fine-tuned models
- **[Configuration](./CONFIGURATION.md)** - All options
