---
title: Error Handling
description: Build resilient agents with proper error handling, recovery strategies, and graceful degradation
sidebar:
  order: 8
---

This guide covers practical error handling patterns for llmist agents. You'll learn how to handle errors at different levels, from individual gadgets to the entire agent, and how to build resilient applications that gracefully handle failures.

## Why Error Handling Matters in LLM Applications

LLM applications have multiple potential failure points:

- **Provider errors**: Rate limits, authentication failures, service outages
- **Gadget errors**: External API failures, invalid data, timeouts
- **Parsing errors**: LLM produces malformed gadget calls
- **Validation errors**: Parameters don't match the schema

Good error handling ensures your application degrades gracefully and provides useful feedback to both the LLM and end users.

## Gadget-Level Error Handling

### Response Helpers

Use the built-in helpers to return structured error responses that LLMs can understand:

```typescript
import { gadgetSuccess, gadgetError, withErrorHandling } from 'llmist';

class ApiGadget extends Gadget({
  description: 'Call an external API',
  schema: z.object({ url: z.string() }),
}) {
  async execute(params: this['params']): Promise<string> {
    try {
      const response = await fetch(params.url);

      if (!response.ok) {
        // Structured error - LLM can understand and adapt
        return gadgetError(`HTTP ${response.status}`, {
          url: params.url,
          suggestion: 'Try a different endpoint',
        });
      }

      return gadgetSuccess({ data: await response.json() });
    } catch (error) {
      return gadgetError(error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
```

The output format is JSON:
- Success: `{"success": true, "data": {...}}`
- Error: `{"error": "message", "suggestion": "..."}`

### withErrorHandling Wrapper

For simpler cases, wrap your execute function to automatically catch and format errors:

```typescript
import { withErrorHandling, gadgetSuccess } from 'llmist';

class FileGadget extends Gadget({
  description: 'Read a file',
  schema: z.object({ path: z.string() }),
}) {
  // Any thrown error is automatically caught and returned as gadgetError()
  execute = withErrorHandling(async (params: this['params']) => {
    const content = await fs.readFile(params.path, 'utf-8');
    return gadgetSuccess({ content });
  });
}
```

### Best Practice: Let Errors Inform the LLM

Return informative errors instead of throwing:

```typescript
// ❌ Bad - LLM can't recover
throw new Error('File not found');

// ✅ Good - LLM can try something else
return gadgetError('File not found', {
  path: params.path,
  suggestion: 'Check if the file exists or try a different path',
  availableFiles: await fs.readdir(dirname(params.path)),
});
```

## Agent-Level Error Observation

### Observer Hooks

Use observers to monitor errors without affecting execution:

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(MyGadget)
  .withHooks({
    observers: {
      onGadgetExecutionComplete: (ctx) => {
        if (ctx.error) {
          console.error(`Gadget ${ctx.gadgetName} failed:`, ctx.error);
          metrics.increment('gadget.error', { name: ctx.gadgetName });
        }
      },

      onLLMCallComplete: (ctx) => {
        if (ctx.error) {
          console.error('LLM call failed:', ctx.error);
          alerting.notify('LLM Error', ctx.error.message);
        }
      },
    },
  });
```

Observer hooks are **read-only** - they can't modify the execution flow. Use them for:
- Logging and debugging
- Metrics and monitoring
- Alerting

## LLM Error Recovery

### Controller Hooks

Controllers can intercept errors and provide fallback responses:

```typescript
.withHooks({
  controllers: {
    // Recover from LLM API errors
    afterLLMError: async (ctx) => {
      // Don't retry auth errors
      if (ctx.error.message.includes('401')) {
        return { action: 'fail', error: new Error('Invalid API key') };
      }

      // Provide fallback for other errors
      return {
        action: 'recover',
        fallbackResponse: 'I apologize, but I encountered an issue. Please try again.',
      };
    },

    // Recover from gadget errors
    afterGadgetExecution: async (ctx) => {
      if (ctx.error) {
        return {
          action: 'recover',
          fallbackResult: gadgetError('Gadget failed', {
            gadgetName: ctx.gadgetName,
            message: ctx.error.message,
          }),
        };
      }
      return { action: 'proceed' };
    },
  },
})
```

### Controller Actions

| Action | Effect |
|--------|--------|
| `proceed` | Continue normally |
| `recover` | Use the provided fallback response/result |
| `fail` | Stop with the provided error |
| `rethrow` | Re-throw the original error |

## Retry Configuration

### Automatic Retry for Transient Failures

Configure retry behavior for rate limits and server errors:

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withRetry({
    enabled: true,
    retries: 3,            // Max retry attempts
    minTimeout: 1000,      // Start with 1s delay
    maxTimeout: 30000,     // Max 30s delay
    factor: 2,             // Exponential backoff

    // Called before each retry
    onRetry: (error, attempt) => {
      console.log(`Retry ${attempt}: ${error.message}`);
    },

    // Called when all retries exhausted
    onRetriesExhausted: (error, attempts) => {
      alerting.critical(`LLM failed after ${attempts} retries`);
    },
  });
```

### Custom Retry Logic

Control which errors should trigger retries:

```typescript
.withRetry({
  shouldRetry: (error) => {
    // Don't retry authentication errors
    if (error.message.includes('401')) return false;

    // Retry rate limits
    if (error.message.includes('429')) return true;

    // Retry server errors
    if (error.message.includes('500') || error.message.includes('503')) return true;

    // Retry network errors
    if (error.message.includes('ECONNRESET')) return true;

    return false;
  },
})
```

### Disable Retry

For testing or when you want immediate failure:

```typescript
.withoutRetry()
```

## Special Exceptions

### TaskCompletionSignal

Gracefully terminate the agent loop from a gadget:

```typescript
import { TaskCompletionSignal } from 'llmist';

class FinishGadget extends Gadget({
  description: 'Signal that the task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new TaskCompletionSignal(params.summary);
  }
}
```

### HumanInputRequiredException

Pause execution to get user input:

```typescript
import { HumanInputRequiredException } from 'llmist';

class ConfirmGadget extends Gadget({
  description: 'Ask user for confirmation',
  schema: z.object({ question: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new HumanInputRequiredException(params.question);
  }
}
```

Handle the exception in your application:

```typescript
const agent = LLMist.createAgent()
  .withGadgets(ConfirmGadget)
  .withRequestHumanInput(async (question) => {
    return await readline.question(question);
  });
```

### TimeoutException

Thrown automatically when gadget execution exceeds the timeout:

```typescript
class SlowGadget extends Gadget({
  description: 'Long-running operation',
  timeoutMs: 5000, // 5 second timeout
  schema: z.object({}),
}) {
  async execute(): Promise<string> {
    // If this takes > 5s, TimeoutException is thrown
    await longOperation();
    return 'done';
  }
}
```

### AbortException

Check for cancellation in long-running gadgets:

```typescript
async execute(params, ctx) {
  for (const item of items) {
    // Check if we should stop
    this.throwIfAborted(ctx);

    await processItem(item);
  }
  return 'done';
}
```

Register cleanup handlers:

```typescript
async execute(params, ctx) {
  const connection = await database.connect();

  // Clean up if aborted
  this.onAbort(ctx, () => connection.close());

  await doWork(connection);
  return 'done';
}
```

## Production Patterns

### Comprehensive Error Handling Setup

Combine all patterns for production-ready error handling:

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(ApiGadget, FileGadget)

  // Retry transient failures
  .withRetry({
    retries: 3,
    onRetry: (error, attempt) => logger.warn('Retry', { error, attempt }),
    onRetriesExhausted: (error) => alerting.error('Retries exhausted', error),
  })

  // Error observation
  .withHooks({
    observers: {
      onGadgetExecutionComplete: (ctx) => {
        if (ctx.error) {
          metrics.increment('gadget.error', { gadget: ctx.gadgetName });
        }
      },
      onLLMCallComplete: (ctx) => {
        if (ctx.error) {
          metrics.increment('llm.error');
        }
      },
    },

    // Error recovery
    controllers: {
      afterLLMError: async (ctx) => {
        if (isAuthError(ctx.error)) {
          return { action: 'fail', error: new Error('Auth failed') };
        }
        return {
          action: 'recover',
          fallbackResponse: 'Service temporarily unavailable.',
        };
      },
    },
  });
```

### Testing Error Paths

Use `@llmist/testing` to test error handling:

```typescript
import { mockLLM, createMockClient } from '@llmist/testing';

it('handles API errors gracefully', async () => {
  mockLLM()
    .whenMessageContains('fetch')
    .returnsGadgetCall('ApiGadget', { url: 'https://error.example.com' })
    .register();

  // ApiGadget will return gadgetError() for the bad URL
  const result = await agent
    .withClient(createMockClient())
    .askAndCollect('Fetch data from error.example.com');

  expect(result).toContain('error');
});
```

## See Also

- [Retry Strategies](/library/advanced/retry-strategies/) - Detailed retry and rate limiting configuration
- [Error Types Reference](/reference/errors/) - Complete list of error types
- [Hooks Guide](/library/guides/hooks/) - Deep dive into the hook system
- [Error Handling Example](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/12-error-handling.ts) - Runnable example
