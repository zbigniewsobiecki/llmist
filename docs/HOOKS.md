# Hooks

Monitor, transform, and control agent execution with three hook categories:

- **Observers** - Read-only logging/metrics (run in parallel)
- **Interceptors** - Synchronous transformations (run in sequence)
- **Controllers** - Async lifecycle control (can short-circuit)

## Quick Start: Presets

```typescript
import { HookPresets } from 'llmist';

// Basic logging
.withHooks(HookPresets.logging())

// Verbose logging with parameters/results
.withHooks(HookPresets.logging({ verbose: true }))

// Full monitoring suite
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
| `logging()` | LLM calls and gadget execution |
| `logging({ verbose: true })` | + parameters and results |
| `timing()` | Execution time for LLM/gadgets |
| `tokenTracking()` | Cumulative token usage |
| `errorLogging()` | Detailed error information |
| `monitoring()` | All of the above combined |
| `silent()` | No output (for testing) |

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
      console.log(`Response: ${ctx.finalMessage}`);
    },
    onLLMCallError: async (ctx) => {
      console.error(`Error: ${ctx.error.message}`);
      console.log(`Recovered: ${ctx.recovered}`);
    },
    onGadgetExecutionStart: async (ctx) => {
      console.log(`Executing ${ctx.gadgetName}`);
    },
    onGadgetExecutionComplete: async (ctx) => {
      console.log(`${ctx.gadgetName} took ${ctx.executionTimeMs}ms`);
      if (ctx.error) console.error(ctx.error);
    },
    onStreamChunk: async (ctx) => {
      // Called for each streaming chunk
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

    // Transform assistant message before storing
    interceptAssistantMessage: (message, ctx) => {
      return `[Modified] ${message}`;
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
      // or: { action: 'modify_and_continue', modifiedMessage: '...' }
      // or: { action: 'append_messages', messages: [...] }
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

    // After gadget - can recover from errors
    afterGadgetExecution: async (ctx) => {
      if (ctx.error) {
        return { action: 'recover', fallbackResult: 'fallback' };
      }
      return { action: 'continue' };
    },
  },
})
```

## Observer Context Reference

| Hook | Context Properties |
|------|-------------------|
| `onLLMCallStart` | `iteration`, `options`, `logger` |
| `onLLMCallComplete` | `iteration`, `options`, `finishReason`, `usage`, `rawResponse`, `finalMessage`, `logger` |
| `onLLMCallError` | `iteration`, `options`, `error`, `recovered`, `logger` |
| `onGadgetExecutionStart` | `iteration`, `gadgetName`, `invocationId`, `parameters`, `logger` |
| `onGadgetExecutionComplete` | `iteration`, `gadgetName`, `invocationId`, `parameters`, `originalResult`, `finalResult`, `error`, `executionTimeMs`, `breaksLoop`, `logger` |
| `onStreamChunk` | `iteration`, `rawChunk`, `accumulatedText`, `logger` |

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

// All onLLMCallComplete handlers run in sequence
.withHooks(myHooks)
```

**Merge behavior:**
- Observers: Composed (all handlers run)
- Interceptors: Last one wins
- Controllers: Last one wins

## See Also

- **[Streaming Guide](./STREAMING.md)** - Event handling
- **[Debugging Guide](./DEBUGGING.md)** - Using hooks for debugging
- **[Error Handling](./ERROR_HANDLING.md)** - Recovery strategies
