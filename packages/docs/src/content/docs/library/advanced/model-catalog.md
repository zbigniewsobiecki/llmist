---
title: Model Catalog
description: Query model specs and estimate costs
---

Query model specs, estimate costs, and find the right model.

## Model Shortcuts

| Alias | Full Model |
|-------|------------|
| `gpt5` | `openai:gpt-5` |
| `gpt5-mini` | `openai:gpt-5-mini` |
| `sonnet` | `anthropic:claude-sonnet-4-5-20250929` |
| `haiku` | `anthropic:claude-haiku-4-5-20251001` |
| `opus` | `anthropic:claude-opus-4-5-20251124` |
| `flash` | `gemini:gemini-2.5-flash` |
| `pro` | `gemini:gemini-3-pro-preview` |

## Model Registry API

```typescript
const client = new LLMist();
const registry = client.modelRegistry;

// Get model spec
const spec = registry.getModelSpec('gpt-5');
console.log(spec.displayName);      // "GPT-5"
console.log(spec.contextWindow);    // 272000
console.log(spec.pricing.input);    // 1.25 (per 1M tokens)

// List models
const all = registry.listModels();
const openai = registry.listModels('openai');
```

## Cost Estimation

```typescript
const cost = registry.estimateCost('gpt-5', 10_000, 2_000);

console.log(cost.inputCost);   // $0.0125
console.log(cost.outputCost);  // $0.020
console.log(cost.totalCost);   // $0.0325
```

## Token Counting

```typescript
const messages = [
  { role: 'system', content: 'You are helpful' },
  { role: 'user', content: 'Hello!' },
];

const tokens = await client.countTokens('openai:gpt-5', messages);
const cost = registry.estimateCost('gpt-5', tokens, 1000);
```

## Feature Queries

```typescript
const hasVision = registry.supportsFeature('gpt-5', 'vision');
const visionModels = registry.getModelsByFeature('vision');
```

**Available features:** `streaming`, `functionCalling`, `vision`, `reasoning`, `structuredOutputs`, `fineTuning`

## Find Cheapest Model

```typescript
const cheapest = registry.getCheapestModel(10_000, 2_000);
console.log(cheapest.modelId);
```

## See Also

- [Custom Models](/advanced/custom-models/) - Register your own models
- [Providers Guide](/advanced/providers/) - Provider configuration
