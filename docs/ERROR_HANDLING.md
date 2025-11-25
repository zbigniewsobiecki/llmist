# Error Handling

Configure how the agent handles gadget errors and LLM failures.

## Error Types

| Type | Description | When |
|------|-------------|------|
| `parse` | Failed to parse gadget call from LLM output | Malformed YAML/JSON |
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

```typescript
import { HookPresets } from 'llmist';

// Built-in error logging
.withHooks(HookPresets.errorLogging())

// Or custom
.withHooks({
  observers: {
    onLLMCallError: async (ctx) => {
      console.error(`LLM Error: ${ctx.error.message}`);
      console.error(`Model: ${ctx.options.model}`);
      console.error(`Recovered: ${ctx.recovered}`);
    },
    onGadgetExecutionComplete: async (ctx) => {
      if (ctx.error) {
        console.error(`Gadget Error: ${ctx.gadgetName}`);
        console.error(`Parameters: ${JSON.stringify(ctx.parameters)}`);
        console.error(`Error: ${ctx.error}`);
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

## See Also

- **[Hooks Guide](./HOOKS.md)** - Lifecycle control
- **[Gadgets Guide](./GADGETS.md)** - Creating gadgets
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
