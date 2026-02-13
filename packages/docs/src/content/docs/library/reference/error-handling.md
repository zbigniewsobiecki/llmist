---
title: Error Handling
description: Configure how the agent handles errors
---

Configure how the agent handles gadget errors and LLM failures.

## Error Types

| Type | Description |
|------|-------------|
| `parse` | Failed to parse gadget call from LLM output |
| `validation` | Parameters don't match schema |
| `execution` | Gadget threw an error |

## Stop on Error

```typescript
// Default: stop on first error
.withStopOnGadgetError(true)

// Continue executing all gadgets
.withStopOnGadgetError(false)
```

## Custom Error Handler

```typescript
.withErrorHandler((context) => {
  const { error, gadgetName, errorType } = context;

  if (errorType === 'parse') {
    return false; // Stop execution
  }

  return true; // Continue
})
```

## Built-in Retry

LLMist includes automatic retry for transient failures:

```typescript
.withRetry({
  retries: 5,
  minTimeout: 2000,
  maxTimeout: 60000,
  onRetry: (error, attempt) => console.log(`Retry ${attempt}`),
})

// Disable retry
.withoutRetry()
```

## Hook-Based Recovery

```typescript
.withHooks({
  controllers: {
    afterLLMError: async (ctx) => {
      if (ctx.error.message.includes('rate limit')) {
        await sleep(1000);
        return { action: 'recover', fallbackResponse: 'Try again.' };
      }
      return { action: 'rethrow' };
    },
  },
})
```

## BudgetPricingUnavailableError

Thrown at agent construction when `.withBudget()` is set but the model has no valid pricing information in the model registry.

**When it occurs:**
- The model is not registered in the model registry
- The model's pricing has both `input` and `output` set to `0`

**Fix:**

```typescript
// Option 1: Register pricing for the model
client.modelRegistry.registerModel({
  provider: 'custom',
  modelId: 'my-custom-model',
  displayName: 'My Custom Model',
  contextWindow: 128000,
  maxOutputTokens: 4096,
  pricing: { input: 5.0, output: 15.0 }, // per 1M tokens
  knowledgeCutoff: '2025-01',
  features: { streaming: true, functionCalling: true, vision: false },
});

// Option 2: Remove the budget constraint
const agent = LLMist.createAgent()
  .withModel('my-custom-model')
  // .withBudget(0.50)  // Remove if model lacks pricing
  .ask('Hello');
```

## Special Exceptions

| Exception | Purpose |
|-----------|---------|
| `TaskCompletionSignal` | Gracefully terminate the loop |
| `HumanInputRequiredException` | Pause for user input |
| `AbortException` | Gadget cancelled |

```typescript
// Terminate loop
throw new TaskCompletionSignal('Task completed');

// Request input
throw new HumanInputRequiredException('What is your preference?');
```

## Gadget Cancellation

Use `throwIfAborted()` to check cancellation:

```typescript
async execute(params, ctx) {
  this.throwIfAborted(ctx);
  await this.doWork();
  this.throwIfAborted(ctx);
  return 'done';
}
```

Register cleanup handlers with `onAbort()`:

```typescript
async execute(params, ctx) {
  const browser = await chromium.launch();
  this.onAbort(ctx, () => browser.close());
  // ...
}
```

## See Also

- [Hooks Guide](/library/guides/hooks/) - Lifecycle control
- [Gadgets Guide](/library/guides/gadgets/) - Creating gadgets
