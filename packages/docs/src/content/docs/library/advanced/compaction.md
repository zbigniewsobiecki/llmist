---
title: Context Compaction
description: Automatic context management for long-running conversations
---

Context compaction prevents context window overflow in long-running agent conversations. As conversations grow, token counts accumulate and can exceed model limits. Compaction intelligently reduces conversation history while preserving important context.

## Quick Start

Compaction is **enabled by default** with sensible settings:

```typescript
// Default behavior - compaction runs automatically
const agent = await LLMist.createAgent()
  .withModel('sonnet')
  .ask('Help me with a long multi-step task...');
```

To customize or disable:

```typescript
// Custom configuration
.withCompaction({
  triggerThresholdPercent: 70,  // Trigger at 70% context usage
  targetPercent: 40,             // Reduce to 40%
  preserveRecentTurns: 10,       // Keep 10 recent turns verbatim
})

// Disable compaction
.withoutCompaction()
```

## How It Works

Compaction runs automatically before each LLM call:

1. **Monitor** - Check if token usage exceeds threshold (default: 80%)
2. **Compact** - Execute the configured strategy to reduce history
3. **Verify** - Emit events and update statistics

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Iteration Loop                      │
├─────────────────────────────────────────────────────────────┤
│  1. Check token count                                        │
│  2. If > threshold → Run compaction strategy                 │
│  3. Prepare LLM call                                         │
│  4. Stream response                                          │
│  5. Process gadget calls                                     │
│  6. Repeat...                                                │
└─────────────────────────────────────────────────────────────┘
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable compaction |
| `strategy` | `string` | `'hybrid'` | Compaction strategy |
| `triggerThresholdPercent` | `number` | `80` | Context usage % that triggers compaction |
| `targetPercent` | `number` | `50` | Target context usage % after compaction |
| `preserveRecentTurns` | `number` | `5` | Recent turns to keep verbatim |
| `summarizationModel` | `string` | Agent's model | Model for summarization |
| `summarizationPrompt` | `string` | Default | Custom summarization prompt |
| `onCompaction` | `function` | none | Callback when compaction occurs |

## Compaction Strategies

### Hybrid (Default)

Intelligently combines summarization and sliding-window:

```typescript
.withCompaction({
  strategy: 'hybrid',  // Default - recommended
})
```

- If fewer than 3 turns need compaction → uses sliding-window (fast)
- Otherwise → uses summarization (preserves context)
- Best of both worlds for production use

### Summarization

Uses an LLM to compress older turns into a concise summary:

```typescript
.withCompaction({
  strategy: 'summarization',
})
```

**Pros:**
- Preserves important context via intelligent summary
- Better for complex multi-step reasoning

**Cons:**
- Slower - requires additional LLM call
- Additional cost for summarization

**What gets summarized:**
- Key decisions and their rationale
- Important facts and data discovered
- Errors encountered and resolutions
- Current task context and goals

### Sliding-Window

Simple truncation - keeps only the most recent turns:

```typescript
.withCompaction({
  strategy: 'sliding-window',
})
```

**Pros:**
- Very fast - no LLM calls needed
- Zero additional cost

**Cons:**
- Loses all historical context beyond the window
- May cause agent to "forget" earlier decisions

**Best for:**
- Long-running conversations where old context is irrelevant
- Speed-critical scenarios
- Fallback when summarization is too slow

## Usage Patterns

### Aggressive Compaction for Long Conversations

```typescript
const agent = await LLMist.createAgent()
  .withModel('sonnet')
  .withCompaction({
    triggerThresholdPercent: 70,  // Trigger earlier
    targetPercent: 40,             // More aggressive reduction
    preserveRecentTurns: 15,       // But keep more recent context
  })
  .ask('...');
```

### Fast Mode with Sliding-Window

```typescript
const agent = await LLMist.createAgent()
  .withModel('sonnet')
  .withCompaction({
    strategy: 'sliding-window',
    preserveRecentTurns: 20,
  })
  .ask('...');
```

### Custom Summarization Model

Use a faster/cheaper model for summarization:

```typescript
const agent = await LLMist.createAgent()
  .withModel('sonnet')  // Main model
  .withCompaction({
    strategy: 'summarization',
    summarizationModel: 'haiku',  // Cheaper model for summaries
  })
  .ask('...');
```

### Monitoring Compaction Events

```typescript
const agent = await LLMist.createAgent()
  .withModel('sonnet')
  .withCompaction({
    onCompaction: (event) => {
      console.log(`Strategy: ${event.strategy}`);
      console.log(`Tokens: ${event.tokensBefore} → ${event.tokensAfter}`);
      console.log(`Saved: ${event.tokensBefore - event.tokensAfter} tokens`);
    },
  })
  .ask('...');
```

## Observability

### Stream Events

When compaction occurs, a `compaction` event is emitted:

```typescript
for await (const event of agent.run()) {
  if (event.type === 'compaction') {
    console.log(`Strategy: ${event.strategy}`);
    console.log(`Tokens: ${event.tokensBefore} → ${event.tokensAfter}`);
    console.log(`Messages: ${event.messagesBefore} → ${event.messagesAfter}`);
    if (event.summary) {
      console.log(`Summary: ${event.summary}`);
    }
  }
}
```

### Hooks Integration

```typescript
.withHooks({
  observers: {
    onCompaction: (context) => {
      console.log('Compaction occurred:', context.event);
      console.log('Cumulative stats:', context.stats);

      // Send to analytics
      analytics.track('compaction', {
        strategy: context.event.strategy,
        tokensSaved: context.event.tokensBefore - context.event.tokensAfter,
        totalCompactions: context.stats.totalCompactions,
      });
    },
  },
})
```

### Compaction Statistics

The `CompactionStats` object tracks cumulative metrics:

```typescript
{
  totalCompactions: 3,        // How many times compaction ran
  totalTokensSaved: 12500,    // Cumulative tokens saved
  currentUsage: {
    tokens: 4500,             // Current token count
    percent: 45,              // % of context window
  },
  contextWindow: 10000,       // Model's context window size
}
```

## Message Categories

Compaction treats messages differently based on their role:

**Base Messages (never compacted):**
- System prompt
- Gadget instructions
- Initial setup messages

**History Messages (subject to compaction):**
- User messages
- Assistant responses
- Gadget call results

The target percentage applies to total context usage, accounting for both categories.

## When to Disable Compaction

Disable compaction when:

- **Short conversations** - Won't hit context limits
- **Context-sensitive tasks** - Every message matters
- **Manual management** - You handle context yourself
- **Debugging** - Need full conversation history

```typescript
const agent = await LLMist.createAgent()
  .withModel('sonnet')
  .withoutCompaction()  // Disable automatic compaction
  .ask('...');
```

## See Also

- [Cost Tracking](/library/guides/cost-tracking/) - Monitor token usage and costs
- [Hooks Guide](/library/guides/hooks/) - Full hooks reference
- [Streaming Guide](/library/guides/streaming/) - Handle all event types
