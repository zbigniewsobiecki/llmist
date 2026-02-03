---
title: Model Catalog
description: Query model specs and estimate costs
---

Query model specs, estimate costs, and find the right model.

## Model Shortcuts

| Alias | Full Model |
|-------|------------|
| `gpt5` | `openai:gpt-5.2` (latest flagship) |
| `gpt5.2` | `openai:gpt-5.2` |
| `gpt5.1` | `openai:gpt-5.1` |
| `gpt5-mini` | `openai:gpt-5-mini` |
| `gpt5-nano` | `openai:gpt-5-nano` |
| `o1` | `openai:o1` |
| `o3` | `openai:o3` |
| `sonnet` | `anthropic:claude-sonnet-4-5` |
| `haiku` | `anthropic:claude-haiku-4-5` |
| `opus` | `anthropic:claude-opus-4-5` |
| `flash` | `gemini:gemini-2.5-flash` |
| `flash-lite` | `gemini:gemini-2.5-flash-lite` |
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

### Reasoning Feature

Models with `reasoning: true` support thinking/extended thinking. When selected, llmist **auto-enables reasoning at `"medium"` effort** unless you explicitly call `.withReasoning()` or `.withoutReasoning()`.

```typescript
// Query reasoning-capable models
const reasoningModels = registry.getModelsByFeature('reasoning');
console.log(reasoningModels);
// → ['openai:o3', 'openai:o4-mini', 'anthropic:claude-opus-4-5', 'gemini:gemini-3-pro-preview', ...]

// Check if a specific model supports reasoning
const hasReasoning = registry.supportsFeature('o3', 'reasoning');
// → true
```

See [Reasoning Models](/library/guides/reasoning-models/) for how effort maps to each provider.

## Find Cheapest Model

```typescript
const cheapest = registry.getCheapestModel(10_000, 2_000);
console.log(cheapest.modelId);
```

## See Also

- [Custom Models](/library/advanced/custom-models/) - Register your own models
- [Providers Guide](/library/advanced/providers/) - Provider configuration
