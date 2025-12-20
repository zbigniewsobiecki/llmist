---
title: Custom Models
description: Register fine-tuned models and custom deployments
---

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

.withModel('openai:gpt-5-preview')
```

## ModelSpec Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | Yes | Provider ID |
| `modelId` | `string` | Yes | Full model identifier |
| `displayName` | `string` | Yes | Human-readable name |
| `contextWindow` | `number` | Yes | Max context tokens |
| `maxOutputTokens` | `number` | Yes | Max output tokens |
| `pricing.input` | `number` | Yes | Cost per 1M input tokens |
| `pricing.output` | `number` | Yes | Cost per 1M output tokens |
| `knowledgeCutoff` | `string` | Yes | Knowledge cutoff date |
| `features.streaming` | `boolean` | Yes | Supports streaming |
| `features.functionCalling` | `boolean` | Yes | Supports tools |
| `features.vision` | `boolean` | Yes | Supports images |

## See Also

- [Model Catalog](/library/advanced/model-catalog/) - Query models and costs
- [Providers Guide](/library/advanced/providers/) - Provider configuration
