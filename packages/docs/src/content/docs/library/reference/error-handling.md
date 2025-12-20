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
