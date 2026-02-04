---
title: Reasoning Models
description: First-class support for reasoning/thinking models across all providers
sidebar:
  order: 55
---

llmist provides first-class, provider-agnostic support for reasoning models — models that "think" before responding, producing higher-quality answers for complex tasks.

## Overview

Reasoning models (OpenAI o3, Claude with extended thinking, Gemini with thinking) can spend extra compute on internal reasoning before producing a final response. llmist abstracts this behind a unified API:

```typescript
const answer = await LLMist.createAgent()
  .withModel('o3')
  .withReasoning('high')
  .askAndCollect('Prove that √2 is irrational.');
```

### Supported Providers

| Provider | Models | Native Mechanism |
|----------|--------|------------------|
| **OpenAI** | o3, o4-mini, gpt-5 family | `reasoning.effort` parameter |
| **Anthropic** | Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 | Extended thinking (`thinking.budget_tokens`) |
| **Gemini** | Gemini 2.5 Pro/Flash, Gemini 3 Pro/Flash | `thinkingConfig` (budget or level) |

## Builder API

### `withReasoning()`

Enable reasoning in three ways:

```typescript
// 1. No args — enables at "medium" effort (default)
.withReasoning()

// 2. Effort string — one of "none", "low", "medium", "high", "maximum"
.withReasoning('high')

// 3. Full config object — fine-grained control
.withReasoning({
  enabled: true,
  effort: 'high',
  budgetTokens: 10000,       // Explicit token budget (Anthropic/Gemini 2.5)
  includeThinking: true,      // Surface thinking in stream (default: true)
  interleaved: true,          // Interleaved thinking for tool use (Anthropic only)
})
```

### `withoutReasoning()`

Explicitly disable reasoning, even for models that would auto-enable it:

```typescript
const agent = LLMist.createAgent()
  .withModel('o3')
  .withoutReasoning()  // Override auto-enable
  .ask('Just say hello briefly.');
```

## Auto-Enable Behavior

Models registered with `features.reasoning: true` in the model catalog **automatically enable reasoning at `"medium"` effort** when no explicit reasoning config is provided.

```typescript
// o3 has features.reasoning: true, so this auto-enables reasoning at "medium"
const agent = LLMist.createAgent()
  .withModel('o3')
  .ask('What is 2+2?');

// Equivalent to:
const agent = LLMist.createAgent()
  .withModel('o3')
  .withReasoning('medium')
  .ask('What is 2+2?');
```

**Priority order:** explicit `.withReasoning()` / `.withoutReasoning()` config → auto-enable for reasoning models → no reasoning.

## Provider Mapping

Each `ReasoningEffort` level maps to provider-specific native parameters:

### OpenAI

Maps to the `reasoning.effort` parameter:

| Effort | OpenAI Value |
|--------|-------------|
| `"none"` | `"none"` |
| `"low"` | `"low"` |
| `"medium"` | `"medium"` |
| `"high"` | `"high"` |
| `"maximum"` | `"xhigh"` |

### Anthropic

Maps to `thinking.budget_tokens` (minimum 1024, enforced by Anthropic):

| Effort | Budget Tokens |
|--------|--------------|
| `"none"` | 1024 (minimum) |
| `"low"` | 2048 |
| `"medium"` | 8192 |
| `"high"` | 16384 |
| `"maximum"` | 32768 |

You can override with an explicit budget:

```typescript
.withReasoning({ enabled: true, budgetTokens: 10000 })
// → thinking.budget_tokens: 10000 (clamped to min 1024)
```

:::note[Anthropic Behavior]
- **Temperature is stripped** when thinking is enabled (Anthropic forbids it)
- Set `interleaved: true` for multi-turn tool use conversations where the model should think between tool calls
:::

### Gemini 2.5 (Pro/Flash)

Maps to `thinkingConfig.thinkingBudget` (numeric token count):

| Effort | Thinking Budget |
|--------|----------------|
| `"none"` | 0 |
| `"low"` | 2048 |
| `"medium"` | 8192 |
| `"high"` | 16384 |
| `"maximum"` | 24576 |

### Gemini 3 Pro

Maps to `thinkingConfig.thinkingLevel` — Pro only supports `"low"` and `"high"`:

| Effort | Thinking Level |
|--------|---------------|
| `"none"` | `"low"` |
| `"low"` | `"low"` |
| `"medium"` | `"high"` |
| `"high"` | `"high"` |
| `"maximum"` | `"high"` |

### Gemini 3 Flash

Maps to `thinkingConfig.thinkingLevel` — Flash supports the full range:

| Effort | Thinking Level |
|--------|---------------|
| `"none"` | `"minimal"` |
| `"low"` | `"low"` |
| `"medium"` | `"medium"` |
| `"high"` | `"high"` |
| `"maximum"` | `"high"` |

## Streaming Thinking Content

When reasoning is enabled and `includeThinking` is `true` (the default), the `run()` loop emits `thinking` events with the model's internal reasoning:

```typescript
const agent = LLMist.createAgent()
  .withModel('o3')
  .withReasoning('high')
  .ask('What is the sum of the first 100 prime numbers?');

for await (const event of agent.run()) {
  switch (event.type) {
    case 'thinking':
      // event.content: string — the thinking text
      // event.thinkingType: "thinking" | "redacted"
      process.stdout.write(`  💭 ${event.content}`);
      break;
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'llm_call_complete':
      if (event.usage?.reasoningTokens) {
        console.log(`\n📊 Reasoning tokens: ${event.usage.reasoningTokens}`);
      }
      break;
  }
}
```

The `thinkingType` field distinguishes between actual thinking content and redacted blocks (Anthropic may redact some thinking for safety reasons).

## Token Tracking

Reasoning tokens are tracked separately in the `TokenUsage` interface:

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;  // Reasoning/thinking tokens (subset of outputTokens)
}
```

Access via hooks or the execution tree:

```typescript
.withHooks({
  observers: {
    onLLMCallComplete: (ctx) => {
      console.log('Reasoning tokens:', ctx.usage?.reasoningTokens ?? 0);
      console.log('Output tokens:', ctx.usage?.outputTokens);
    },
  },
})
```

Cost estimation also includes reasoning costs as part of output token pricing, since reasoning tokens count toward the output token total.

## Examples

### OpenAI (o3)

```typescript
import { LLMist } from 'llmist';

const answer = await LLMist.createAgent()
  .withModel('o3')
  .withReasoning('high')
  .askAndCollect('What is the sum of the first 100 prime numbers?');
```

### Anthropic (Extended Thinking)

```typescript
import { LLMist } from 'llmist';

const answer = await LLMist.createAgent()
  .withModel('opus')
  .withReasoning({ enabled: true, budgetTokens: 10000 })
  .askAndCollect('Explain the Riemann hypothesis in simple terms.');
```

### Gemini

```typescript
import { LLMist } from 'llmist';

const answer = await LLMist.createAgent()
  .withModel('pro')  // gemini-3-pro-preview
  .withReasoning('medium')
  .askAndCollect('Solve this step by step: ∫ sin(x)cos(x) dx');
```

### Collecting Thinking Content

```typescript
import { LLMist } from 'llmist';

const thinkingChunks: string[] = [];

const agent = LLMist.createAgent()
  .withModel('o3')
  .withReasoning('high')
  .ask('Prove that there are infinitely many primes.');

for await (const event of agent.run()) {
  if (event.type === 'thinking') {
    thinkingChunks.push(event.content);
  }
  if (event.type === 'text') {
    process.stdout.write(event.content);
  }
}

console.log('\n\n--- Full thinking ---');
console.log(thinkingChunks.join(''));
```

## See Also

- [Streaming Guide](/library/guides/streaming/) — Event handling including thinking events
- [Cost Tracking](/library/guides/cost-tracking/) — Monitoring reasoning token costs
- [Model Catalog](/library/advanced/model-catalog/) — Querying reasoning-capable models
- [Example 25](/examples/#advanced-examples) — Runnable reasoning models example
