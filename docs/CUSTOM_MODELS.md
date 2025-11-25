# Custom Models

Register fine-tuned models, new models, or custom deployments.

## Quick Start

```typescript
const client = new LLMist({
  customModels: [{
    provider: 'openai',
    modelId: 'ft:gpt-5:my-org:custom:abc123',
    displayName: 'My Fine-tuned GPT-5',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    pricing: { input: 2.5, output: 20.0 },
    knowledgeCutoff: '2024-09',
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
  }],
});
```

## Register at Runtime

```typescript
const client = new LLMist();

client.modelRegistry.registerModel({
  provider: 'openai',
  modelId: 'gpt-5-preview',
  displayName: 'GPT-5 Preview',
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  pricing: { input: 15.0, output: 60.0 },
  knowledgeCutoff: '2025-01',
  features: {
    streaming: true,
    functionCalling: true,
    vision: true,
    reasoning: true,
  },
});

// Now use it
.withModel('openai:gpt-5-preview')
```

## Register Multiple Models

```typescript
client.modelRegistry.registerModels([
  {
    provider: 'openai',
    modelId: 'ft:gpt-5:my-org:v1',
    displayName: 'Custom v1',
    // ...
  },
  {
    provider: 'openai',
    modelId: 'ft:gpt-5:my-org:v2',
    displayName: 'Custom v2',
    // ...
  },
]);
```

## ModelSpec Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | Yes | Provider ID (`openai`, `anthropic`, `gemini`) |
| `modelId` | `string` | Yes | Full model identifier |
| `displayName` | `string` | Yes | Human-readable name |
| `contextWindow` | `number` | Yes | Max context tokens |
| `maxOutputTokens` | `number` | Yes | Max output tokens |
| `pricing.input` | `number` | Yes | Cost per 1M input tokens |
| `pricing.output` | `number` | Yes | Cost per 1M output tokens |
| `pricing.cachedInput` | `number` | No | Cached input pricing |
| `knowledgeCutoff` | `string` | Yes | Knowledge cutoff date |
| `features.streaming` | `boolean` | Yes | Supports streaming |
| `features.functionCalling` | `boolean` | Yes | Supports tools |
| `features.vision` | `boolean` | Yes | Supports images |
| `features.reasoning` | `boolean` | No | Extended reasoning |
| `features.structuredOutputs` | `boolean` | No | Native JSON mode |
| `features.fineTuning` | `boolean` | No | Can be fine-tuned |
| `metadata.family` | `string` | No | Model family |
| `metadata.releaseDate` | `string` | No | Release date |

## Fine-Tuned Model Example

```typescript
// OpenAI fine-tuned model with custom pricing
client.modelRegistry.registerModel({
  provider: 'openai',
  modelId: 'ft:gpt-5-mini:my-org:customer-support:abc123',
  displayName: 'Customer Support Bot',
  contextWindow: 272_000,
  maxOutputTokens: 32_768,
  pricing: {
    input: 0.50,   // Fine-tuned models often have higher prices
    output: 4.00,
  },
  knowledgeCutoff: '2024-06',
  features: {
    streaming: true,
    functionCalling: true,
    vision: false,  // Vision not supported for this fine-tune
  },
  metadata: {
    family: 'gpt-5-mini',
    releaseDate: '2025-09',
  },
});
```

## Azure OpenAI Deployment

```typescript
client.modelRegistry.registerModel({
  provider: 'openai', // Uses OpenAI adapter
  modelId: 'my-azure-deployment',
  displayName: 'Azure GPT-4',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  pricing: { input: 30.0, output: 60.0 }, // Azure pricing
  knowledgeCutoff: '2024-04',
  features: {
    streaming: true,
    functionCalling: true,
    vision: true,
  },
});
```

## Overwriting Existing Models

Registering a model with an existing ID will overwrite it (with a warning):

```typescript
// Update pricing for an existing model
client.modelRegistry.registerModel({
  provider: 'openai',
  modelId: 'gpt-5', // Already exists
  displayName: 'GPT-5 (Updated)',
  // ... new specs
});
// Warning: Overwriting existing model spec for "gpt-5"
```

## Verify Registration

```typescript
const spec = client.modelRegistry.getModelSpec('ft:gpt-5:my-org:v1');
console.log(spec.displayName);

const cost = client.modelRegistry.estimateCost('ft:gpt-5:my-org:v1', 10_000, 2_000);
console.log(`Estimated: $${cost.totalCost.toFixed(4)}`);
```

## See Also

- **[Model Catalog](./MODEL_CATALOG.md)** - Query models and costs
- **[Providers Guide](./PROVIDERS.md)** - Provider configuration
