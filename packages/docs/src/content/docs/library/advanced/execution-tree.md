---
title: Execution Tree
description: Track costs, tokens, and execution hierarchy
---

The Execution Tree tracks all LLM calls, gadget executions, and their hierarchical relationships.

## Overview

```
ExecutionTree
├── LLM Call #1 (sonnet, 1,200 tokens, $0.003)
│   ├── Gadget: ReadFile
│   └── Gadget: BrowseWeb (subagent)
│       ├── LLM Call #1 (haiku, 800 tokens)
│       └── LLM Call #2 (haiku, 600 tokens)
└── LLM Call #2 (sonnet, 900 tokens, $0.002)
```

## Quick Start

```typescript
const result = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(ReadFile, WriteFile)
  .withHooks({
    observers: {
      onAgentComplete: (ctx) => {
        const tree = ctx.tree;
        console.log(`Total cost: $${tree.getTotalCost().toFixed(4)}`);
        console.log(`Total tokens: ${JSON.stringify(tree.getTotalTokens())}`);
      },
    },
  })
  .askAndCollect('Read config.json');
```

## Query Methods

```typescript
// Total metrics
const totalCost = tree.getTotalCost();
const tokens = tree.getTotalTokens();
// { input: 5000, output: 1200, cached: 800 }

// Subtree metrics (for subagents)
const subtreeCost = tree.getSubtreeCost(gadgetNodeId);
const subtreeTokens = tree.getSubtreeTokens(gadgetNodeId);
const media = tree.getSubtreeMedia(gadgetNodeId);

// Navigation
const node = tree.getNode("llm_1");
const children = tree.getChildren("llm_1");
const ancestors = tree.getAncestors("gadget_xyz");
```

## Event Subscription

```typescript
tree.on("gadget_complete", (event) => {
  console.log(`${event.name} completed in ${event.executionTimeMs}ms`);
});

// Or iterate
for await (const event of tree.events()) {
  if (event.type === 'llm_call_complete') {
    console.log(`LLM #${event.iteration}: ${event.usage?.totalTokens} tokens`);
  }
}
```

## Subagent Integration

When subagents use `withParentContext(ctx)`, they share the parent's tree:

```typescript
const agent = new AgentBuilder()
  .withParentContext(ctx!)  // Shares tree
  .withModel('haiku')
  .ask(params.task);

// After completion
const subtreeCost = ctx?.tree?.getSubtreeCost(ctx.nodeId!);
```

## See Also

- [Subagents](/library/advanced/subagents/) - Creating nested agent gadgets
- [Hooks](/library/guides/hooks/) - Lifecycle monitoring
