---
title: Cost Tracking
description: Monitor token usage and estimate costs
---

llmist provides comprehensive cost tracking through the ExecutionTree and ModelRegistry APIs.

## Quick Start

Track costs after an agent run:

```typescript
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator)
  .withHooks({
    observers: {
      onAgentComplete: (ctx) => {
        const tree = ctx.tree;
        console.log(`Total cost: $${tree.getTotalCost().toFixed(4)}`);
        console.log(`Total tokens:`, tree.getTotalTokens());
      },
    },
  })
  .askAndCollect('Calculate 15 * 23');
```

Output:
```
Total cost: $0.0032
Total tokens: { input: 850, output: 120, cached: 0 }
```

## Cost Estimation (Before Calls)

Estimate costs before making API calls:

```typescript
const client = new LLMist();
const registry = client.modelRegistry;

// Estimate for known token counts
const cost = registry.estimateCost('gpt-5', 10_000, 2_000);
console.log(`Estimated: $${cost.totalCost.toFixed(4)}`);

// Estimate from messages
const messages = [
  { role: 'system', content: 'You are helpful' },
  { role: 'user', content: 'Explain quantum computing in detail...' },
];
const inputTokens = await client.countTokens('openai:gpt-5', messages);
const estimatedCost = registry.estimateCost('gpt-5', inputTokens, 1000);
```

### Cost Breakdown

```typescript
const cost = registry.estimateCost('sonnet', 10_000, 2_000);

console.log(cost.inputCost);   // Cost for input tokens
console.log(cost.outputCost);  // Cost for output tokens
console.log(cost.totalCost);   // Combined total
```

## Real-Time Tracking (ExecutionTree)

The ExecutionTree tracks all costs during agent execution:

```typescript
const result = await LLMist.createAgent()
  .withModel('sonnet')
  .withHooks({
    observers: {
      onLLMCallComplete: (ctx) => {
        const iterationCost = ctx.tree.getTotalCost();
        console.log(`Running total: $${iterationCost.toFixed(4)}`);
      },
    },
  })
  .askAndCollect('Research task');
```

### Token Breakdown

```typescript
const tokens = tree.getTotalTokens();

console.log(tokens.input);   // Total input tokens
console.log(tokens.output);  // Total output tokens
console.log(tokens.cached);  // Cached tokens (if supported by provider)
```

## Subagent Costs

Track costs for nested agents (subagents):

```typescript
// Get costs for a specific subtree
const subtreeCost = tree.getSubtreeCost(gadgetNodeId);
const subtreeTokens = tree.getSubtreeTokens(gadgetNodeId);

console.log(`Subagent cost: $${subtreeCost.toFixed(4)}`);
```

Example with BrowseWeb subagent:
```
ExecutionTree
├── LLM Call #1 (sonnet, 1,200 tokens, $0.003)
│   ├── Gadget: ReadFile
│   └── Gadget: BrowseWeb (subagent)
│       ├── LLM Call #1 (haiku, 800 tokens, $0.001)
│       └── LLM Call #2 (haiku, 600 tokens, $0.001)
└── LLM Call #2 (sonnet, 900 tokens, $0.002)

Total: $0.007
```

## Model Pricing

Look up model pricing:

```typescript
const client = new LLMist();
const spec = client.modelRegistry.getModelSpec('gpt-5');

console.log(spec.pricing.input);   // $ per 1M input tokens
console.log(spec.pricing.output);  // $ per 1M output tokens
```

### Find Cheapest Model

```typescript
const cheapest = client.modelRegistry.getCheapestModel(10_000, 2_000);
console.log(`Cheapest: ${cheapest.modelId}`);
```

## Cost-Aware Patterns

### Monitor High Costs

```typescript
const agent = LLMist.createAgent()
  .withModel('opus')
  .withHooks({
    controllers: {
      beforeLLMCall: async (ctx) => {
        const currentCost = ctx.tree.getTotalCost();
        if (currentCost > 0.10) {
          console.warn('⚠️ Cost exceeds $0.10, switching to cheaper model');
          return {
            action: 'proceed',
            modifiedOptions: { model: 'haiku' },
          };
        }
        return { action: 'proceed' };
      },
    },
  });
```

### Token Tracking Preset

```typescript
import { HookPresets } from 'llmist';

await LLMist.createAgent()
  .withModel('sonnet')
  .withHooks(HookPresets.tokenTracking())
  .askAndCollect('Your prompt');

// Logs cumulative token usage after each call
```

### Cost Logging

```typescript
.withHooks({
  observers: {
    onAgentComplete: (ctx) => {
      const cost = ctx.tree.getTotalCost();
      const tokens = ctx.tree.getTotalTokens();

      // Log to your analytics system
      analytics.track('agent_complete', {
        cost,
        tokens,
        model: ctx.options.model,
        iterations: ctx.iteration,
      });
    },
  },
})
```

## Cost Optimization Tips

1. **Use model shortcuts strategically**
   - `haiku` for simple tasks
   - `sonnet` for complex reasoning
   - `opus` only when needed

2. **Leverage caching** (Anthropic)
   - System prompts are cached automatically
   - Repeated context reduces costs

3. **Monitor with hooks**
   - Use `HookPresets.tokenTracking()` in development
   - Set cost alerts in production

4. **Batch operations**
   - Combine related queries into single prompts
   - Use subagents for parallel work

## See Also

- [Execution Tree](/advanced/execution-tree/) - Tree structure and navigation
- [Model Catalog](/advanced/model-catalog/) - Model specs and features
- [Hooks Guide](/guides/hooks/) - Lifecycle monitoring
