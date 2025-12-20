---
title: Hooks
description: Monitor, transform, and control agent execution
---

Monitor, transform, and control agent execution with three hook categories:

- **Observers** - Read-only logging/metrics (run in parallel)
- **Interceptors** - Synchronous transformations (run in sequence)
- **Controllers** - Async lifecycle control (can short-circuit)

## Quick Start: Presets

HookPresets provide ready-to-use hook configurations for common monitoring and debugging tasks.

```typescript
import { HookPresets } from 'llmist';

// Basic logging
.withHooks(HookPresets.logging())

// Verbose logging with parameters/results
.withHooks(HookPresets.logging({ verbose: true }))

// Full monitoring suite (logging + timing + tokens + errors)
.withHooks(HookPresets.monitoring())

// Combine presets
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  HookPresets.timing(),
  HookPresets.tokenTracking(),
))
```

## Available Presets

| Preset | Description |
|--------|-------------|
| `logging(options?)` | Logs LLM calls and gadget execution |
| `timing()` | Measures execution time |
| `tokenTracking()` | Tracks cumulative token usage |
| `errorLogging()` | Logs detailed error information |
| `silent()` | No output (for testing) |
| `monitoring(options?)` | All-in-one: logging + timing + tokens + errors |
| `merge(...hookSets)` | Combines multiple hook configurations |

## Custom Hooks

### Observers (Read-Only)

For logging, metrics, analytics:

```typescript
.withHooks({
  observers: {
    onLLMCallStart: async (ctx) => {
      console.log(`Iteration ${ctx.iteration} starting`);
    },
    onLLMCallComplete: async (ctx) => {
      console.log(`Tokens: ${ctx.usage?.totalTokens}`);
    },
    onLLMCallError: async (ctx) => {
      console.error(`Error: ${ctx.error.message}`);
    },
    onGadgetExecutionStart: async (ctx) => {
      console.log(`Executing ${ctx.gadgetName}`);
    },
    onGadgetExecutionComplete: async (ctx) => {
      console.log(`${ctx.gadgetName} took ${ctx.executionTimeMs}ms`);
    },
  },
})
```

### Interceptors (Transform)

Synchronous transformations:

```typescript
.withHooks({
  interceptors: {
    // Transform text chunks before display
    interceptTextChunk: (chunk, ctx) => {
      return chunk.toUpperCase(); // or null to suppress
    },

    // Transform gadget parameters before execution
    interceptGadgetParameters: (params, ctx) => {
      return { ...params, modified: true };
    },

    // Transform gadget result before LLM sees it
    interceptGadgetResult: (result, ctx) => {
      return `Result: ${result}`;
    },
  },
})
```

### Controllers (Lifecycle)

Async control with short-circuit capability:

```typescript
.withHooks({
  controllers: {
    // Before LLM call - can skip or modify
    beforeLLMCall: async (ctx) => {
      if (shouldCache(ctx)) {
        return { action: 'skip', syntheticResponse: cachedResponse };
      }
      return { action: 'proceed', modifiedOptions: { temperature: 0.5 } };
    },

    // After LLM call - can modify or append
    afterLLMCall: async (ctx) => {
      return { action: 'continue' };
    },

    // Error recovery
    afterLLMError: async (ctx) => {
      if (isRetryable(ctx.error)) {
        return { action: 'recover', fallbackResponse: 'Fallback text' };
      }
      return { action: 'rethrow' };
    },

    // Before gadget - can skip
    beforeGadgetExecution: async (ctx) => {
      if (shouldMock(ctx.gadgetName)) {
        return { action: 'skip', syntheticResult: 'mocked' };
      }
      return { action: 'proceed' };
    },
  },
})
```

## Common Patterns

### Development vs Production

```typescript
const isDev = process.env.NODE_ENV === 'development';
const hooks = isDev
  ? HookPresets.monitoring({ verbose: true })
  : HookPresets.merge(
      HookPresets.errorLogging(),
      HookPresets.tokenTracking()
    );

await LLMist.createAgent()
  .withHooks(hooks)
  .ask("Your prompt");
```

### Cost Monitoring

```typescript
const BUDGET_TOKENS = 10_000;
let totalTokens = 0;

await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.tokenTracking(),
    {
      observers: {
        onLLMCallComplete: async (ctx) => {
          totalTokens += ctx.usage?.totalTokens ?? 0;
          console.log(`💰 Tokens used: ${totalTokens}/${BUDGET_TOKENS}`);
        },
      },
    }
  ))
  .ask("Your prompt");
```

### Silent Mode for Tests

```typescript
describe('Agent tests', () => {
  it('should calculate floppy disk requirements', async () => {
    const result = await LLMist.createAgent()
      .withHooks(HookPresets.silent())
      .withGadgets(FloppyDisk)
      .askAndCollect("How many floppies for a 10MB file?");

    expect(result).toContain("7");
  });
});
```

## Subagent Events

When using subagent gadgets, check `ctx.subagentContext` to distinguish events:

```typescript
observers: {
  onLLMCallStart: (ctx) => {
    if (ctx.subagentContext) {
      console.log(`↳ Subagent LLM call at depth ${ctx.subagentContext.depth}`);
    } else {
      console.log(`Main agent LLM call #${ctx.iteration}`);
    }
  },
}
```

## Merging Hooks

Combine multiple hook configurations:

```typescript
const myHooks = HookPresets.merge(
  HookPresets.logging({ verbose: true }),
  HookPresets.timing(),
  {
    observers: {
      onLLMCallComplete: async (ctx) => {
        await saveToDatabase(ctx.usage);
      },
    },
  },
);

.withHooks(myHooks)
```

**Merge behavior:**
- Observers: Composed (all handlers run)
- Interceptors: Last one wins
- Controllers: Last one wins

## Observer Context Reference

| Hook | Context Properties |
|------|-------------------|
| `onLLMCallStart` | `iteration`, `options`, `logger`, `subagentContext?` |
| `onLLMCallComplete` | `iteration`, `options`, `finishReason`, `usage`, `rawResponse`, `finalMessage`, `logger` |
| `onLLMCallError` | `iteration`, `options`, `error`, `recovered`, `logger` |
| `onGadgetExecutionStart` | `iteration`, `gadgetName`, `invocationId`, `parameters`, `logger` |
| `onGadgetExecutionComplete` | `iteration`, `gadgetName`, `invocationId`, `parameters`, `originalResult`, `finalResult`, `error`, `executionTimeMs`, `breaksLoop`, `logger` |

## See Also

- [Streaming Guide](/library/guides/streaming/) - Event handling
- [Debugging Guide](/library/reference/debugging/) - Using hooks for debugging
- [Error Handling](/library/reference/error-handling/) - Recovery strategies
