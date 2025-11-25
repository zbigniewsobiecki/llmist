# Model Catalog

Query model specs, estimate costs, and find the right model for your needs.

## Model Shortcuts

Use short aliases for common models:

| Alias | Full Model |
|-------|------------|
| `gpt5` | `openai:gpt-5` |
| `gpt5.1` | `openai:gpt-5.1` |
| `gpt5-mini` | `openai:gpt-5-mini` |
| `gpt5-nano` | `openai:gpt-5-nano` |
| `sonnet` | `anthropic:claude-sonnet-4-5-20250929` |
| `claude-sonnet` | `anthropic:claude-sonnet-4-5-20250929` |
| `haiku` | `anthropic:claude-haiku-4-5-20251001` |
| `claude-haiku` | `anthropic:claude-haiku-4-5-20251001` |
| `opus` | `anthropic:claude-opus-4-5-20251124` |
| `claude-opus` | `anthropic:claude-opus-4-5-20251124` |
| `flash` | `gemini:gemini-2.5-flash` |
| `gemini-flash` | `gemini:gemini-2.5-flash` |
| `pro` | `gemini:gemini-3-pro-preview` |
| `gemini-pro` | `gemini:gemini-3-pro-preview` |

## Model Registry API

```typescript
const client = new LLMist();
const registry = client.modelRegistry;
```

### Get Model Spec

```typescript
const spec = registry.getModelSpec('gpt-5');

console.log(spec.displayName);      // "GPT-5"
console.log(spec.contextWindow);    // 272000
console.log(spec.maxOutputTokens);  // 128000
console.log(spec.pricing.input);    // 1.25 (per 1M tokens)
console.log(spec.pricing.output);   // 10.0 (per 1M tokens)
```

### List Models

```typescript
// All models
const all = registry.listModels();

// By provider
const openai = registry.listModels('openai');
const anthropic = registry.listModels('anthropic');
const gemini = registry.listModels('gemini');
```

### Get Model Limits

```typescript
const limits = registry.getModelLimits('gpt-5');

console.log(limits.contextWindow);    // 272000
console.log(limits.maxOutputTokens);  // 128000
```

### Validate Configuration

```typescript
const isValid = registry.validateModelConfig('gpt-5', 300000);
// false - exceeds context window
```

## Cost Estimation

```typescript
// Estimate cost for 10K input, 2K output tokens
const cost = registry.estimateCost('gpt-5', 10_000, 2_000);

console.log(cost.inputCost);   // $0.0125
console.log(cost.outputCost);  // $0.020
console.log(cost.totalCost);   // $0.0325
console.log(cost.currency);    // "USD"
```

### With Cached Input

```typescript
// Use cached input pricing (Anthropic)
const cost = registry.estimateCost(
  'claude-sonnet-4-5-20250929',
  10_000,
  2_000,
  true  // useCachedInput
);
```

## Token Counting

```typescript
const messages = [
  { role: 'system', content: 'You are helpful' },
  { role: 'user', content: 'Hello!' },
];

// Provider-specific counting
const tokens = await client.countTokens('openai:gpt-5', messages);

// Combine with cost estimation
const cost = registry.estimateCost('gpt-5', tokens, 1000);
console.log(`Estimated cost: $${cost.totalCost.toFixed(4)}`);
```

## Feature Queries

```typescript
// Check single feature
const hasVision = registry.supportsFeature('gpt-5', 'vision');
const hasTools = registry.supportsFeature('gpt-5', 'functionCalling');

// Get models by feature
const visionModels = registry.getModelsByFeature('vision');
const reasoningModels = registry.getModelsByFeature('reasoning');
```

### Available Features

| Feature | Description |
|---------|-------------|
| `streaming` | Supports streaming responses |
| `functionCalling` | Supports function/tool calling |
| `vision` | Can process images |
| `reasoning` | Extended reasoning (o1, etc.) |
| `structuredOutputs` | Native JSON mode |
| `fineTuning` | Supports fine-tuning |

## Find Cheapest Model

```typescript
// Find cheapest model for your token usage
const cheapest = registry.getCheapestModel(10_000, 2_000);
console.log(cheapest.modelId);  // Likely a mini/haiku model

// By provider
const cheapestOpenAI = registry.getCheapestModel(10_000, 2_000, 'openai');
```

## ModelSpec Interface

```typescript
interface ModelSpec {
  provider: string;           // 'openai', 'anthropic', 'gemini'
  modelId: string;            // Full model ID
  displayName: string;        // Human-readable name
  contextWindow: number;      // Max context tokens
  maxOutputTokens: number;    // Max output tokens
  pricing: {
    input: number;            // Per 1M input tokens
    output: number;           // Per 1M output tokens
    cachedInput?: number;     // Cached input pricing
  };
  knowledgeCutoff: string;
  features: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    reasoning?: boolean;
    structuredOutputs?: boolean;
    fineTuning?: boolean;
  };
  metadata?: {
    family?: string;
    releaseDate?: string;
  };
}
```

## See Also

- **[Custom Models](./CUSTOM_MODELS.md)** - Register your own models
- **[Providers Guide](./PROVIDERS.md)** - Provider configuration
- **[Configuration](./CONFIGURATION.md)** - All options
