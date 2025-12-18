# Error Handling

Configure how the agent handles gadget errors and LLM failures.

## Error Types

| Type | Description | When |
|------|-------------|------|
| `parse` | Failed to parse gadget call from LLM output | Malformed block format |
| `validation` | Parameters don't match schema | Zod validation failed |
| `execution` | Gadget threw an error | Runtime error in execute() |

## Default Behavior

By default, when a gadget fails:
1. Subsequent gadgets in the same response are skipped
2. LLM stream is cancelled (saves costs)
3. Error is added to context for next iteration
4. Agent loop continues

## Stop on Error

```typescript
// Default: true - stop on first error
.withStopOnGadgetError(true)

// Continue executing all gadgets even if some fail
.withStopOnGadgetError(false)
```

## Custom Error Handler

Fine-grained control over error recovery:

```typescript
.withErrorHandler((context) => {
  const { error, gadgetName, errorType, parameters } = context;

  // Log all errors
  console.error(`[${gadgetName}] ${errorType}: ${error}`);

  // Stop on parse errors (likely prompt issue)
  if (errorType === 'parse') {
    return false; // Stop execution
  }

  // Stop on critical errors
  if (error.includes('CRITICAL') || error.includes('FATAL')) {
    return false;
  }

  // Continue on validation/execution errors
  return true;
})
```

### Handler Context

```typescript
interface ErrorHandlerContext {
  error: string;                              // Error message
  gadgetName: string;                         // Which gadget failed
  errorType: 'parse' | 'validation' | 'execution';
  parameters?: Record<string, unknown>;       // Parsed parameters (if available)
}
```

## Gadget Timeouts

Set default timeout for all gadgets:

```typescript
.withDefaultGadgetTimeout(5000) // 5 seconds
```

Or per-gadget:

```typescript
class SlowGadget extends Gadget({
  description: 'Makes a slow API call',
  schema: z.object({ ... }),
  timeoutMs: 30000, // 30 seconds for this gadget
}) {
  // ...
}
```

## Hook-Based Error Recovery

Use controllers for advanced error handling:

```typescript
.withHooks({
  controllers: {
    // Recover from LLM errors
    afterLLMError: async (ctx) => {
      if (ctx.error.message.includes('rate limit')) {
        await sleep(1000);
        return { action: 'recover', fallbackResponse: 'Please try again.' };
      }
      return { action: 'rethrow' };
    },

    // Recover from gadget errors
    afterGadgetExecution: async (ctx) => {
      if (ctx.error) {
        console.warn(`Gadget ${ctx.gadgetName} failed: ${ctx.error}`);
        return { action: 'recover', fallbackResult: 'Operation failed' };
      }
      return { action: 'continue' };
    },
  },
})
```

## Error Logging Hook

Quick start with HookPresets for instant error visibility:

```typescript
import { HookPresets } from 'llmist';

// Built-in error logging preset
.withHooks(HookPresets.errorLogging())

// Or combine with other monitoring
.withHooks(HookPresets.merge(
  HookPresets.errorLogging(),
  HookPresets.logging({ verbose: true })
))

// Full monitoring includes error logging
.withHooks(HookPresets.monitoring())
```

**Output format:**

```
❌ LLM Error (iteration 1): Rate limit exceeded
   Model: gpt-5-nano
   Recovered: true

❌ Gadget Error: Database
   Error: Connection timeout
   Parameters: {"query": "SELECT * FROM users"}
```

**Pattern 1: Error Logging + Analytics**

Send errors to external monitoring service:

```typescript
async function sendErrorToMonitoring(error: any) {
  await fetch('https://monitoring.example.com/errors', {
    method: 'POST',
    body: JSON.stringify(error),
  });
}

.withHooks(HookPresets.merge(
  HookPresets.errorLogging(),
  {
    observers: {
      onLLMCallError: async (ctx) => {
        await sendErrorToMonitoring({
          type: 'llm_error',
          message: ctx.error.message,
          model: ctx.options.model,
          recovered: ctx.recovered,
          timestamp: new Date().toISOString(),
        });
      },
      onGadgetExecutionComplete: async (ctx) => {
        if (ctx.error) {
          await sendErrorToMonitoring({
            type: 'gadget_error',
            gadget: ctx.gadgetName,
            error: ctx.error,
            parameters: ctx.parameters,
            timestamp: new Date().toISOString(),
          });
        }
      },
    },
  }
))
```

**Pattern 2: Error Alerting**

Real-time notifications for critical errors:

```typescript
.withHooks({
  observers: {
    onLLMCallError: async (ctx) => {
      // Alert on unrecovered errors
      if (!ctx.recovered) {
        await sendAlert({
          severity: 'critical',
          message: `LLM call failed: ${ctx.error.message}`,
          model: ctx.options.model,
        });
      }
    },
    onGadgetExecutionComplete: async (ctx) => {
      if (ctx.error) {
        await sendAlert({
          severity: 'high',
          message: `Gadget ${ctx.gadgetName} failed`,
          error: ctx.error,
        });
      }
    },
  },
})
```

**Pattern 3: Error Rate Tracking (Circuit Breaker)**

Track error frequency and implement circuit breaker:

```typescript
const errorWindow = {
  errors: [] as number[],
  windowMs: 60000, // 1 minute
  threshold: 5, // Max 5 errors per minute
};

function recordError() {
  const now = Date.now();
  errorWindow.errors = errorWindow.errors.filter(t => now - t < errorWindow.windowMs);
  errorWindow.errors.push(now);
  return errorWindow.errors.length;
}

.withHooks({
  observers: {
    onLLMCallError: async (ctx) => {
      const errorCount = recordError();
      ctx.logger.error(`Error rate: ${errorCount}/${errorWindow.threshold} in last minute`);

      if (errorCount >= errorWindow.threshold) {
        ctx.logger.fatal('Circuit breaker tripped - too many errors!');
        // Could throw to stop execution or implement backoff
      }
    },
  },
})
```

## Built-in Retry with Exponential Backoff

LLMist includes built-in retry logic for transient LLM API failures (rate limits, timeouts, server errors). **Retry is enabled by default** with conservative settings.

### Default Behavior

By default, all agents automatically retry failed LLM calls:
- **3 retries** with exponential backoff
- **1-30 second delays** between retries
- **Jitter** to prevent thundering herd
- Only retries on retryable errors (429, 5xx, timeouts, connection errors)

### Customize Retry Behavior

```typescript
import { LLMist } from 'llmist';

// Custom retry configuration
LLMist.createAgent()
  .withRetry({
    retries: 5,              // Max retry attempts
    minTimeout: 2000,        // Initial delay (2s)
    maxTimeout: 60000,       // Max delay (60s)
    factor: 2,               // Exponential multiplier
    randomize: true,         // Add jitter
  })
  .ask("Hello");
```

### Monitoring Retries

Add callbacks to monitor retry behavior:

```typescript
.withRetry({
  retries: 5,
  onRetry: (error, attempt) => {
    console.log(`Retry ${attempt}: ${error.message}`);
    metrics.increment('llm.retry', { attempt });
  },
  onRetriesExhausted: (error, attempts) => {
    console.error(`Failed after ${attempts} attempts`);
    alerting.warn(`LLM failed: ${error.message}`);
  },
})
```

### Custom Retry Logic

Override which errors are retryable:

```typescript
.withRetry({
  shouldRetry: (error) => {
    // Only retry rate limits
    return error.message.includes('429');
  },
})
```

### Disable Retry

```typescript
// Disable retry entirely
.withoutRetry()
```

### What's Retryable?

The built-in `isRetryableError()` function classifies errors:

| Retryable | Error Types |
|-----------|-------------|
| ✅ Yes | 429 rate limits, 5xx server errors, timeouts, connection errors, "overloaded" |
| ❌ No | 400 bad request, 401 auth, 403 forbidden, 404 not found, content policy |

You can import and use this helper:

```typescript
import { isRetryableError } from 'llmist';

if (isRetryableError(error)) {
  console.log('This error is safe to retry');
}
```

## Advanced: Hook-Based Retry (Custom)

For advanced scenarios requiring different retry behavior per error type, use controllers:

```typescript
.withHooks({
  controllers: {
    afterLLMError: async (ctx) => {
      const maxRetries = 3;
      const retryCount = ctx.options.metadata?.retryCount ?? 0;

      if (retryCount < maxRetries && isRetryable(ctx.error)) {
        // Wait with exponential backoff
        await sleep(Math.pow(2, retryCount) * 1000);

        return {
          action: 'proceed',
          modifiedOptions: {
            metadata: { retryCount: retryCount + 1 },
          },
        };
      }

      return { action: 'rethrow' };
    },
  },
})
```

## Gadget Exception Types

### TaskCompletionSignal

Gracefully terminate the agent loop:

```typescript
import { TaskCompletionSignal } from 'llmist';

class Done extends Gadget({ ... }) {
  execute(params: this['params']): string {
    throw new TaskCompletionSignal('Task completed successfully');
  }
}
```

### HumanInputRequiredException

Pause for user input:

```typescript
import { HumanInputRequiredException } from 'llmist';

class AskUser extends Gadget({ ... }) {
  execute(params: this['params']): string {
    throw new HumanInputRequiredException(params.question);
  }
}
```

### TimeoutException

Thrown when a gadget exceeds its timeout:

```typescript
.withHooks({
  observers: {
    onGadgetExecutionComplete: async (ctx) => {
      if (ctx.error?.includes('timeout')) {
        console.warn(`${ctx.gadgetName} timed out after ${ctx.executionTimeMs}ms`);
      }
    },
  },
})
```

### AbortException

Thrown by gadgets when they detect the abort signal. Typically thrown via the `AbstractGadget.throwIfAborted(ctx)` helper method:

```typescript
import { AbortException } from 'llmist';

class LongRunningGadget extends Gadget({ ... }) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    // Check at key points - throws AbortException if aborted
    this.throwIfAborted(ctx);

    await this.doPartOne(params.data);

    this.throwIfAborted(ctx);

    await this.doPartTwo(params.data);

    return 'completed';
  }
}
```

## Gadget Cancellation

When a gadget times out, llmist signals cancellation via `AbortSignal` before throwing `TimeoutException`. Gadgets can use this to clean up resources like open browser sessions, database connections, or HTTP requests.

### Check for Abort at Checkpoints

Use `throwIfAborted()` to check for cancellation at key points:

```typescript
class DataProcessor extends Gadget({
  description: 'Processes data in multiple steps',
  schema: z.object({ items: z.array(z.string()) }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    const results: string[] = [];

    for (const item of params.items) {
      // Check before each expensive operation
      this.throwIfAborted(ctx);

      results.push(await this.processItem(item));
    }

    return results.join(', ');
  }
}
```

### Register Cleanup Handlers with `onAbort()`

For gadgets that open resources (browsers, connections, etc.), use the `onAbort()` helper to register cleanup handlers:

```typescript
class BrowserGadget extends Gadget({
  description: 'Uses Playwright browser',
  schema: z.object({ url: z.string() }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    const browser = await chromium.launch();
    this.onAbort(ctx, () => browser.close());  // One line!

    const page = await browser.newPage();
    this.onAbort(ctx, () => page.close());

    try {
      await page.goto(params.url);
      return await page.content();
    } finally {
      await browser.close();
    }
  }
}
```

**`onAbort()` features:**
- Handles `undefined` context gracefully (no-op)
- Runs cleanup immediately if already aborted
- Swallows errors from cleanup functions
- Supports both sync and async cleanup

### Create Linked Abort Controllers

Use `createLinkedAbortController()` to create child controllers that abort when the parent aborts:

```typescript
class MultiRequestGadget extends Gadget({
  description: 'Makes multiple API calls',
  schema: z.object({ urls: z.array(z.string()) }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    const controller = this.createLinkedAbortController(ctx);

    // All requests will abort if parent times out
    const responses = await Promise.all(
      params.urls.map(url => fetch(url, { signal: controller.signal }))
    );

    return responses.map(r => r.status).join(', ');
  }
}
```

**Benefits:**
- Linked controller aborts when parent signal aborts
- Can still abort independently if needed: `controller.abort('manual')`
- Works safely when `ctx` is undefined

### Pass Signal to fetch() (Alternative)

For simple cases, pass the signal directly to fetch:

```typescript
class ApiGadget extends Gadget({
  description: 'Calls external API',
  schema: z.object({ endpoint: z.string() }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    // fetch() will automatically abort when signal is triggered
    const response = await fetch(params.endpoint, {
      signal: ctx?.signal,
    });
    return await response.text();
  }
}
```

### Signal Properties

The `ExecutionContext.signal` is always provided (never undefined):

| Property | Description |
|----------|-------------|
| `signal.aborted` | `true` if execution has been cancelled |
| `signal.addEventListener('abort', fn)` | Register cleanup callback |
| `signal.reason` | Contains the timeout message when aborted due to timeout (useful for debugging) |

## See Also

- **[Hooks Guide](./HOOKS.md)** - Lifecycle control
- **[Gadgets Guide](./GADGETS.md)** - Creating gadgets
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
