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

## Retry Pattern

Implement retries with a controller:

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

### BreakLoopException

Gracefully terminate the agent loop:

```typescript
import { BreakLoopException } from 'llmist';

class Done extends Gadget({ ... }) {
  execute(params: this['params']): string {
    throw new BreakLoopException('Task completed successfully');
  }
}
```

### HumanInputException

Pause for user input:

```typescript
import { HumanInputException } from 'llmist';

class AskUser extends Gadget({ ... }) {
  execute(params: this['params']): string {
    throw new HumanInputException(params.question);
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

### AbortError

Thrown by gadgets when they detect the abort signal. Typically thrown via the `BaseGadget.throwIfAborted(ctx)` helper method:

```typescript
import { AbortError } from 'llmist';

class LongRunningGadget extends Gadget({ ... }) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    // Check at key points - throws AbortError if aborted
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

### Register Cleanup Handlers

For gadgets that open resources (browsers, connections, etc.), register cleanup on the abort signal:

```typescript
class BrowserGadget extends Gadget({
  description: 'Uses Playwright browser',
  schema: z.object({ url: z.string() }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    const browser = await chromium.launch();

    // Register cleanup - fires immediately if already aborted
    ctx.signal.addEventListener('abort', () => {
      browser.close().catch(() => {});
    }, { once: true });

    try {
      const page = await browser.newPage();
      await page.goto(params.url);
      return await page.content();
    } finally {
      await browser.close();
    }
  }
}
```

### Pass Signal to fetch()

For HTTP requests, pass the signal directly to fetch for automatic cancellation:

```typescript
class ApiGadget extends Gadget({
  description: 'Calls external API',
  schema: z.object({ endpoint: z.string() }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    // fetch() will automatically abort when signal is triggered
    const response = await fetch(params.endpoint, {
      signal: ctx.signal,
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
