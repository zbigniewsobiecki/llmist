# Hooks

Monitor, transform, and control agent execution with three hook categories:

- **Observers** - Read-only logging/metrics (run in parallel)
- **Interceptors** - Synchronous transformations (run in sequence)
- **Controllers** - Async lifecycle control (can short-circuit)

## Quick Start: Presets

HookPresets provide ready-to-use hook configurations for common monitoring and debugging tasks. They're the fastest way to add observability to your agents without writing custom hooks.

**When to use presets:**
- During development for instant debugging and visibility
- In production for monitoring, metrics, and error tracking
- As building blocks for custom monitoring solutions

**Quick tip:** Start with `monitoring()` during development for full visibility, then customize with `merge()` for production to combine presets with your custom hooks.

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

## API Reference

### HookPresets.logging(options?)

Logs LLM calls and gadget execution to console with optional verbosity.

**Signature:**
```typescript
HookPresets.logging(options?: { verbose?: boolean }): AgentHooks
```

**Parameters:**
- `options.verbose` (boolean, optional): Include full parameters and results. Default: `false`

**Output:**
- Basic mode: Event names, iteration numbers, and token counts
- Verbose mode: + full parameters (for gadgets) and results (for both LLM and gadgets)

**Use cases:**
- Basic development debugging and execution flow visibility
- Understanding agent decision-making and tool usage
- Troubleshooting gadget invocations

**Example - Basic logging:**
```typescript
await LLMist.createAgent()
  .withHooks(HookPresets.logging())
  .withGadgets(Calculator)
  .ask("What is 15 times 23?");
```

**Output:**
```
[LLM] Starting call (iteration 1)
[GADGET] Executing Calculator
[GADGET] Completed Calculator
[LLM] Completed (tokens: 245)
```

**Example - Verbose logging:**
```typescript
await LLMist.createAgent()
  .withHooks(HookPresets.logging({ verbose: true }))
  .withGadgets(Calculator)
  .ask("What is 15 times 23?");
```

**Output:**
```
[LLM] Starting call (iteration 1)
[GADGET] Executing Calculator
[GADGET] Parameters: {
  "operation": "multiply",
  "a": 15,
  "b": 23
}
[GADGET] Completed Calculator
[GADGET] Result: 345
[LLM] Completed (tokens: 245)
[LLM] Response: 15 times 23 equals 345
```

**Example - Environment-based verbosity:**
```typescript
const isDev = process.env.NODE_ENV === 'development';
.withHooks(HookPresets.logging({ verbose: isDev }))
```

**Performance:** Minimal overhead. Console writes are synchronous but fast.

---

### HookPresets.timing()

Measures and logs execution time for LLM calls and gadgets.

**Signature:**
```typescript
HookPresets.timing(): AgentHooks
```

**Output:**
Logs duration in milliseconds with ⏱️ emoji for each operation.

**Use cases:**
- Performance profiling and optimization
- Identifying slow operations (LLM calls vs gadget execution)
- Monitoring response times in production

**Example:**
```typescript
await LLMist.createAgent()
  .withHooks(HookPresets.timing())
  .withGadgets(Weather, Database)
  .ask("What's the weather in NYC?");
```

**Output:**
```
⏱️ [LLM] Iteration 1 took 1234ms
⏱️ [GADGET] Weather took 567ms
⏱️ [LLM] Iteration 2 took 890ms
```

**Example - Combined with logging:**
```typescript
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  HookPresets.timing()
))
```

**Performance:** Negligible overhead. Uses `Date.now()` for timing.

**Tip:** Combine with `tokenTracking()` to correlate cost with performance.

---

### HookPresets.tokenTracking()

Tracks cumulative token usage across all LLM calls.

**Signature:**
```typescript
HookPresets.tokenTracking(): AgentHooks
```

**Output:**
Logs per-call and cumulative token stats with 📊 emoji.

**Use cases:**
- Cost monitoring and budget tracking
- Optimizing prompts to reduce token usage
- Comparing token efficiency across different approaches

**Example:**
```typescript
await LLMist.createAgent()
  .withHooks(HookPresets.tokenTracking())
  .ask("Summarize this document...");
```

**Output:**
```
📊 [TOKENS] Call 1: 1,234 tokens (Total: 1,234 across 1 calls)
📊 [TOKENS] Call 2: 567 tokens (Total: 1,801 across 2 calls)
📊 [TOKENS] Call 3: 890 tokens (Total: 2,691 across 3 calls)
```

**Example - Cost calculation:**
```typescript
let totalTokens = 0;
.withHooks(HookPresets.merge(
  HookPresets.tokenTracking(),
  {
    observers: {
      onLLMCallComplete: async (ctx) => {
        totalTokens += ctx.usage?.totalTokens ?? 0;
        const cost = (totalTokens / 1_000_000) * 3.0; // $3 per 1M tokens
        console.log(`💰 Estimated cost: $${cost.toFixed(4)}`);
      },
    },
  }
))
```

**Performance:** Minimal overhead. Simple counter increments.

**Note:** Token counts depend on the provider's response. Some providers may not include usage data.

---

### HookPresets.errorLogging()

Logs detailed error information for debugging.

**Signature:**
```typescript
HookPresets.errorLogging(): AgentHooks
```

**Output:**
Captures LLM errors (with recovery status) and gadget errors with full context.

**Use cases:**
- Troubleshooting production issues
- Understanding error patterns and frequency
- Debugging error recovery behavior

**Example:**
```typescript
await LLMist.createAgent()
  .withHooks(HookPresets.errorLogging())
  .withGadgets(Database)
  .ask("Fetch user data");
```

**Output (LLM error):**
```
❌ [LLM ERROR] Iteration 1 failed
   Model: gpt-5-nano
   Error: Rate limit exceeded
   Recovered: true
```

**Output (Gadget error):**
```
❌ [GADGET ERROR] Database execution failed
   Parameters: {"query": "SELECT * FROM users"}
   Error: Connection timeout
```

**Example - Error logging with analytics:**
```typescript
const errors: any[] = [];
.withHooks(HookPresets.merge(
  HookPresets.errorLogging(),
  {
    observers: {
      onLLMCallError: async (ctx) => {
        errors.push({ type: 'llm', error: ctx.error, recovered: ctx.recovered });
      },
      onGadgetExecutionComplete: async (ctx) => {
        if (ctx.error) {
          errors.push({ type: 'gadget', gadget: ctx.gadgetName, error: ctx.error });
        }
      },
    },
  }
))
```

**Performance:** Minimal overhead. Only logs when errors occur.

**Tip:** Combine with `monitoring()` for comprehensive error tracking with full context.

---

### HookPresets.silent()

Returns empty hook configuration for clean output.

**Signature:**
```typescript
HookPresets.silent(): AgentHooks
```

**Output:**
No output. Returns `{}`.

**Use cases:**
- Clean test output without console noise
- Production environments where logging is handled externally
- Baseline for custom hook development

**Example - Testing:**
```typescript
describe('Agent tests', () => {
  it('should calculate correctly', async () => {
    const result = await LLMist.createAgent()
      .withHooks(HookPresets.silent()) // No console output during tests
      .withGadgets(Calculator)
      .askAndCollect("What is 15 times 23?");

    expect(result).toContain("345");
  });
});
```

**Example - Conditional silence:**
```typescript
const isTesting = process.env.NODE_ENV === 'test';
.withHooks(isTesting ? HookPresets.silent() : HookPresets.monitoring())
```

**Performance:** Zero overhead. No-op hook configuration.

---

### HookPresets.monitoring(options?)

Composite preset combining logging, timing, tokenTracking, and errorLogging.

**Signature:**
```typescript
HookPresets.monitoring(options?: { verbose?: boolean }): AgentHooks
```

**Parameters:**
- `options.verbose` (boolean, optional): Passed to `logging()` preset. Default: `false`

**Output:**
Combined output from all four presets:
- Event logging (with optional verbosity)
- Execution timing
- Token usage tracking
- Error details

**Use cases:**
- Full observability during development
- Comprehensive monitoring in production
- One-liner for complete agent visibility

**Example:**
```typescript
await LLMist.createAgent()
  .withHooks(HookPresets.monitoring())
  .withGadgets(Calculator, Weather)
  .ask("What is 15 times 23, and what's the weather in NYC?");
```

**Output:**
```
[LLM] Starting call (iteration 1)
[GADGET] Executing Calculator
[GADGET] Completed Calculator
⏱️ [GADGET] Calculator took 12ms
[GADGET] Executing Weather
[GADGET] Completed Weather
⏱️ [GADGET] Weather took 345ms
[LLM] Completed (tokens: 1,234)
📊 [TOKENS] Call 1: 1,234 tokens (Total: 1,234 across 1 calls)
⏱️ [LLM] Iteration 1 took 1,456ms
```

**Example - Verbose monitoring:**
```typescript
.withHooks(HookPresets.monitoring({ verbose: true }))
```

**Performance:** Combined overhead of all four presets, but still minimal in practice.

**Tip:** This is the recommended preset for development and initial production deployments.

---

### HookPresets.merge(...hookSets)

Combines multiple hook configurations into one.

**Signature:**
```typescript
HookPresets.merge(...hookSets: AgentHooks[]): AgentHooks
```

**Parameters:**
- `...hookSets`: Variable number of `AgentHooks` objects to merge

**Returns:**
Single `AgentHooks` object with combined behavior.

**Merge behavior:**
- **Observers:** Composed - all handlers run sequentially in order
- **Interceptors:** Last one wins - only the last interceptor applies
- **Controllers:** Last one wins - only the last controller applies

**Use cases:**
- Combining multiple presets
- Adding custom hooks to presets
- Building modular monitoring configurations

**Example - Combine presets:**
```typescript
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  HookPresets.timing(),
  HookPresets.tokenTracking()
))
```

**Example - Preset + custom observer:**
```typescript
.withHooks(HookPresets.merge(
  HookPresets.timing(),
  {
    observers: {
      onLLMCallComplete: async (ctx) => {
        await saveMetrics({ tokens: ctx.usage?.totalTokens });
      },
    },
  }
))
```

**Example - Custom interceptor (last wins):**
```typescript
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  {
    interceptors: {
      interceptTextChunk: (chunk) => chunk.toUpperCase(), // This wins
    },
  },
  {
    interceptors: {
      interceptTextChunk: (chunk) => chunk.toLowerCase(), // This overwrites previous
    },
  }
))
// Result: text will be lowercase
```

**Performance:** Minimal overhead for merging. Runtime performance depends on merged hooks.

**Important:** Observers compose (all run), but interceptors and controllers don't - only the last one applies. Design your hook architecture accordingly.

**See also:** [Merging Hooks](#merging-hooks) section for more details.

---

## Cookbook: Common Patterns

This section provides practical recipes for real-world scenarios.

### Recipe 1: Development vs Production Hooks

**Problem:** You want verbose logging during development but minimal logging in production.

**Solution:**
```typescript
const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';

const hooks = isDev
  ? HookPresets.monitoring({ verbose: true }) // Full visibility in dev
  : isProd
  ? HookPresets.merge(
      HookPresets.errorLogging(), // Only errors in prod
      HookPresets.tokenTracking()  // Track costs
    )
  : HookPresets.silent(); // Silent in test

await LLMist.createAgent()
  .withHooks(hooks)
  .ask("Your prompt");
```

**When to use:** Every production application should adapt hooks to the environment.

---

### Recipe 2: Cost Monitoring & Budget Enforcement

**Problem:** You need to track token costs and stop execution if budget is exceeded.

**Solution:**
```typescript
const BUDGET_TOKENS = 10_000;
let totalTokens = 0;

await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.tokenTracking(),
    {
      controllers: {
        beforeLLMCall: async (ctx) => {
          if (totalTokens >= BUDGET_TOKENS) {
            console.log(`🛑 Budget exceeded: ${totalTokens} tokens used`);
            throw new Error('Token budget exceeded');
          }
          return { action: 'proceed' };
        },
      },
      observers: {
        onLLMCallComplete: async (ctx) => {
          totalTokens += ctx.usage?.totalTokens ?? 0;
          const remaining = BUDGET_TOKENS - totalTokens;
          console.log(`💰 Tokens remaining: ${remaining}/${BUDGET_TOKENS}`);
        },
      },
    }
  ))
  .ask("Your prompt");
```

**When to use:** Cost-sensitive applications, rate limiting, or budget constraints.

---

### Recipe 3: Request/Response Logging for Debugging

**Problem:** You need to capture full LLM interactions for debugging or auditing.

**Solution:**
```typescript
const interactions: any[] = [];

await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.logging({ verbose: true }),
    {
      observers: {
        onLLMCallStart: async (ctx) => {
          interactions.push({
            type: 'request',
            iteration: ctx.iteration,
            timestamp: new Date().toISOString(),
            options: ctx.options,
          });
        },
        onLLMCallComplete: async (ctx) => {
          interactions.push({
            type: 'response',
            iteration: ctx.iteration,
            timestamp: new Date().toISOString(),
            message: ctx.finalMessage,
            tokens: ctx.usage,
            finishReason: ctx.finishReason,
          });
        },
      },
    }
  ))
  .ask("Your prompt");

// Save for later analysis
await fs.writeFile('interactions.json', JSON.stringify(interactions, null, 2));
```

**When to use:** Debugging complex issues, compliance auditing, or training data collection.

---

### Recipe 4: Performance Profiling Suite

**Problem:** You need comprehensive performance metrics to identify bottlenecks.

**Solution:**
```typescript
const metrics = {
  llmCalls: [] as number[],
  gadgetCalls: new Map<string, number[]>(),
};

await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.timing(),
    {
      observers: {
        onLLMCallComplete: async (ctx) => {
          // Extract timing from context (set by timing preset)
          const duration = (ctx as any)._llmDuration;
          if (duration) metrics.llmCalls.push(duration);
        },
        onGadgetExecutionComplete: async (ctx) => {
          if (ctx.executionTimeMs) {
            if (!metrics.gadgetCalls.has(ctx.gadgetName)) {
              metrics.gadgetCalls.set(ctx.gadgetName, []);
            }
            metrics.gadgetCalls.get(ctx.gadgetName)!.push(ctx.executionTimeMs);
          }
        },
      },
    }
  ))
  .withGadgets(Weather, Database, Calculator)
  .ask("Your complex prompt");

// Analyze metrics
const avgLLM = metrics.llmCalls.reduce((a, b) => a + b, 0) / metrics.llmCalls.length;
console.log(`\n📊 Performance Report:`);
console.log(`Average LLM call: ${avgLLM.toFixed(0)}ms`);
metrics.gadgetCalls.forEach((times, name) => {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`Average ${name}: ${avg.toFixed(0)}ms (${times.length} calls)`);
});
```

**When to use:** Performance optimization, identifying slow operations, or capacity planning.

---

### Recipe 5: Analytics & Metrics Collection

**Problem:** You need to send telemetry data to an external monitoring service (e.g., DataDog, New Relic).

**Solution:**
```typescript
async function sendMetric(name: string, value: number, tags: Record<string, string> = {}) {
  // Non-blocking fire-and-forget
  void fetch('https://metrics.example.com/api/v1/metrics', {
    method: 'POST',
    body: JSON.stringify({ name, value, tags, timestamp: Date.now() }),
  }).catch(err => console.error('Metrics error:', err));
}

await LLMist.createAgent()
  .withHooks({
    observers: {
      onLLMCallComplete: async (ctx) => {
        await sendMetric('llm.tokens', ctx.usage?.totalTokens ?? 0, {
          model: ctx.options.model ?? 'unknown',
          iteration: String(ctx.iteration),
        });
      },
      onGadgetExecutionComplete: async (ctx) => {
        await sendMetric('gadget.duration', ctx.executionTimeMs ?? 0, {
          gadget: ctx.gadgetName,
          status: ctx.error ? 'error' : 'success',
        });
      },
      onLLMCallError: async (ctx) => {
        await sendMetric('llm.error', 1, {
          recovered: String(ctx.recovered),
        });
      },
    },
  })
  .ask("Your prompt");
```

**When to use:** Production monitoring, alerting, dashboards, or SLA tracking.

---

### Recipe 6: Structured Logging with tslog

**Problem:** You want to integrate with llmist's built-in logger for structured JSON logs.

**Solution:**
```typescript
import { Logger } from 'tslog';

const logger = new Logger({ type: 'json' });

await LLMist.createAgent()
  .withLogger(logger) // Use custom logger
  .withHooks({
    observers: {
      onLLMCallStart: async (ctx) => {
        ctx.logger.info('LLM call starting', {
          iteration: ctx.iteration,
          model: ctx.options.model,
        });
      },
      onLLMCallComplete: async (ctx) => {
        ctx.logger.info('LLM call completed', {
          iteration: ctx.iteration,
          tokens: ctx.usage?.totalTokens,
          finishReason: ctx.finishReason,
        });
      },
      onGadgetExecutionComplete: async (ctx) => {
        ctx.logger.info('Gadget executed', {
          gadget: ctx.gadgetName,
          duration: ctx.executionTimeMs,
          success: !ctx.error,
        });
      },
    },
  })
  .ask("Your prompt");
```

**When to use:** Centralized logging, log aggregation services, or structured log analysis.

---

### Recipe 7: Conditional Preset Loading

**Problem:** You want to enable/disable presets based on feature flags or configuration.

**Solution:**
```typescript
interface MonitoringConfig {
  enableLogging: boolean;
  enableTiming: boolean;
  enableTokenTracking: boolean;
  verboseMode: boolean;
}

function buildHooks(config: MonitoringConfig): AgentHooks {
  const hookSets: AgentHooks[] = [];

  if (config.enableLogging) {
    hookSets.push(HookPresets.logging({ verbose: config.verboseMode }));
  }
  if (config.enableTiming) {
    hookSets.push(HookPresets.timing());
  }
  if (config.enableTokenTracking) {
    hookSets.push(HookPresets.tokenTracking());
  }

  return hookSets.length > 0 ? HookPresets.merge(...hookSets) : HookPresets.silent();
}

// Load from config file or environment
const config: MonitoringConfig = {
  enableLogging: process.env.ENABLE_LOGGING === 'true',
  enableTiming: process.env.ENABLE_TIMING === 'true',
  enableTokenTracking: process.env.ENABLE_TOKEN_TRACKING === 'true',
  verboseMode: process.env.VERBOSE_MODE === 'true',
};

await LLMist.createAgent()
  .withHooks(buildHooks(config))
  .ask("Your prompt");
```

**When to use:** Multi-tenant systems, A/B testing, or gradual rollout of monitoring features.

---

### Recipe 8: Testing with Silent Mode

**Problem:** You want clean test output without console noise from hooks.

**Solution:**
```typescript
import { describe, it, expect } from 'bun:test';

describe('Agent calculations', () => {
  it('should multiply correctly', async () => {
    const result = await LLMist.createAgent()
      .withHooks(HookPresets.silent()) // Clean test output
      .withGadgets(Calculator)
      .askAndCollect("What is 15 times 23?");

    expect(result).toContain("345");
  });

  // For debugging specific tests, enable hooks conditionally
  it('should handle complex math (debug)', async () => {
    const DEBUG_TEST = process.env.DEBUG_TEST === 'true';

    const result = await LLMist.createAgent()
      .withHooks(DEBUG_TEST ? HookPresets.monitoring({ verbose: true }) : HookPresets.silent())
      .withGadgets(Calculator)
      .askAndCollect("What is (15 * 23) + (100 / 4)?");

    expect(result).toContain("370");
  });
});
```

**When to use:** All test suites to maintain clean output and fast test execution.

---

### Recipe 9: Multi-Stage Pipeline Monitoring

**Problem:** You have a multi-stage process and want different hooks for each stage.

**Solution:**
```typescript
// Stage 1: Data gathering (verbose logging)
const gatheredData = await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.logging({ verbose: true }),
    HookPresets.timing()
  ))
  .withGadgets(Database, API)
  .askAndCollect("Gather user data and preferences");

// Stage 2: Analysis (token tracking for cost)
const analysis = await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.logging(),
    HookPresets.tokenTracking()
  ))
  .withSystem("Analyze the data")
  .askAndCollect(gatheredData);

// Stage 3: Final output (error logging only)
const result = await LLMist.createAgent()
  .withHooks(HookPresets.errorLogging())
  .withSystem("Generate final report")
  .askAndCollect(analysis);
```

**When to use:** Multi-step workflows, pipelines, or agent chains with different monitoring needs.

---

### Recipe 10: Combining Presets with Custom Interceptors

**Problem:** You want preset monitoring but also need to redact sensitive data from logs.

**Solution:**
```typescript
function redactSensitive(text: string): string {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, 'XXX-XX-XXXX') // SSN
    .replace(/\b\d{16}\b/g, 'XXXX-XXXX-XXXX-XXXX') // Credit card
    .replace(/password["\s:=]+[^\s"]+/gi, 'password=REDACTED'); // Passwords
}

await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.monitoring({ verbose: true }), // Full monitoring
    {
      interceptors: {
        // Redact before displaying or logging
        interceptTextChunk: (chunk) => redactSensitive(chunk),
        interceptAssistantMessage: (message) => redactSensitive(message),
        interceptGadgetResult: (result) => redactSensitive(String(result)),
      },
    }
  ))
  .ask("Process user data");
```

**When to use:** Security-sensitive applications, compliance requirements (GDPR, HIPAA), or PII protection.

---

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

---

## Best Practices

### 1. Start with Presets, Customize Later

**Guideline:** Begin with built-in presets for quick setup, then add custom hooks as needs evolve.

**Why:** Presets provide battle-tested monitoring out of the box. Custom hooks should add domain-specific logic, not reinvent observability.

**Example:**
```typescript
// Start simple
.withHooks(HookPresets.monitoring())

// Later, add custom analytics
.withHooks(HookPresets.merge(
  HookPresets.monitoring(),
  { observers: { onLLMCallComplete: async (ctx) => sendToDataDog(ctx) } }
))
```

---

### 2. Use Silent Mode for Tests

**Guideline:** Always use `HookPresets.silent()` in automated tests to keep output clean.

**Why:** Console noise slows down test execution and makes it harder to spot actual test failures. Hooks are for runtime monitoring, not test validation.

**Example:**
```typescript
describe('Agent tests', () => {
  const createTestAgent = () =>
    LLMist.createAgent()
      .withHooks(HookPresets.silent()) // Clean output
      .withGadgets(Calculator);

  it('should calculate', async () => {
    const result = await createTestAgent().askAndCollect("15 * 23");
    expect(result).toContain("345");
  });
});
```

---

### 3. Combine Related Presets

**Guideline:** Group presets by monitoring concern (performance, cost, errors) rather than mixing everything.

**Why:** Focused hook sets are easier to debug, maintain, and selectively enable/disable.

**Example:**
```typescript
// Good: Focused on performance
const perfHooks = HookPresets.merge(
  HookPresets.timing(),
  HookPresets.logging()
);

// Good: Focused on cost
const costHooks = HookPresets.merge(
  HookPresets.tokenTracking(),
  customBudgetEnforcement
);

// Better: Compose at usage site
.withHooks(isPerfTest ? perfHooks : costHooks)
```

---

### 4. Leverage merge() for Modularity

**Guideline:** Build reusable hook sets with `merge()` and compose them for different environments.

**Why:** DRY principle - define once, reuse everywhere. Makes it easy to maintain consistent monitoring across services.

**Example:**
```typescript
// Shared hooks
const baseHooks = HookPresets.errorLogging();
const devHooks = HookPresets.merge(baseHooks, HookPresets.monitoring({ verbose: true }));
const prodHooks = HookPresets.merge(baseHooks, HookPresets.tokenTracking());

// Use based on environment
const hooks = process.env.NODE_ENV === 'production' ? prodHooks : devHooks;
```

---

### 5. Be Mindful of Performance

**Guideline:** Understand the performance characteristics of each preset, especially in high-throughput scenarios.

**Why:** Hooks run synchronously (observers, interceptors) or add latency (controllers). Expensive operations can slow down your agent.

**Performance characteristics:**
- `logging()`: Fast (console.log is synchronous)
- `timing()`: Negligible (Date.now() calls)
- `tokenTracking()`: Negligible (counter increments)
- `errorLogging()`: Fast, only on errors
- `monitoring()`: Combined overhead of all four (still minimal)

**Example - Async operations:**
```typescript
// Bad: Blocking observer
observers: {
  onLLMCallComplete: async (ctx) => {
    await slowDatabaseWrite(ctx); // Blocks agent execution!
  }
}

// Good: Fire-and-forget
observers: {
  onLLMCallComplete: async (ctx) => {
    void slowDatabaseWrite(ctx).catch(err => console.error(err)); // Non-blocking
  }
}
```

---

### 6. Don't Overuse Merge

**Guideline:** Avoid merging redundant presets or presets that provide overlapping functionality.

**Why:** Redundant hooks waste CPU cycles and create duplicate log output.

**Example:**
```typescript
// Bad: Redundant logging
HookPresets.merge(
  HookPresets.logging(),
  HookPresets.monitoring(), // Already includes logging!
)

// Good: Use monitoring alone
HookPresets.monitoring()

// Or: Combine non-overlapping presets
HookPresets.merge(
  HookPresets.timing(),
  HookPresets.tokenTracking()
)
```

---

### 7. Separate Concerns with Custom Hooks

**Guideline:** Keep monitoring (presets) separate from business logic (custom hooks). Don't mix concerns.

**Why:** Clean separation makes code easier to reason about, test, and modify.

**Example:**
```typescript
// Bad: Mixed concerns
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  {
    observers: {
      onLLMCallComplete: async (ctx) => {
        console.log(`Tokens: ${ctx.usage?.totalTokens}`); // Monitoring
        await updateUserCredits(ctx.usage?.totalTokens);  // Business logic
      }
    }
  }
))

// Good: Separate concerns
.withHooks(HookPresets.logging()) // Monitoring
.withHooks({
  observers: {
    onLLMCallComplete: async (ctx) => {
      await updateUserCredits(ctx.usage?.totalTokens); // Business logic only
    }
  }
})
```

---

### 8. Use Context Logger for Structured Logs

**Guideline:** Prefer `ctx.logger` over `console.log` for structured, production-ready logging.

**Why:** Context logger integrates with llmist's logging system, supports JSON output, and includes metadata automatically.

**Example:**
```typescript
// Good: Structured logging
.withHooks({
  observers: {
    onLLMCallComplete: async (ctx) => {
      ctx.logger.info('LLM call completed', {
        tokens: ctx.usage?.totalTokens,
        iteration: ctx.iteration,
        model: ctx.options.model,
      });
    },
  },
})

// Even better: Use tslog for JSON
import { Logger } from 'tslog';
const logger = new Logger({ type: 'json' });

await LLMist.createAgent()
  .withLogger(logger) // Structured JSON logs
  .withHooks(...) // ctx.logger is now tslog instance
```

---

## Troubleshooting HookPresets

### Issue 1: Hooks Not Firing

**Symptom:** Your hooks don't seem to be running - no console output, no side effects.

**Diagnosis:** Check that hooks are registered before calling `.ask()` or `.askAndCollect()`.

**Solution:**
```typescript
// Wrong: Hook added after ask()
const agent = LLMist.createAgent().withGadgets(Calculator);
await agent.ask("Calculate"); // Hooks not registered yet!
agent.withHooks(HookPresets.logging()); // Too late

// Correct: Hook added before ask()
const result = await LLMist.createAgent()
  .withGadgets(Calculator)
  .withHooks(HookPresets.logging()) // Register first
  .ask("Calculate"); // Now hooks will fire
```

**Prevention:** Always chain `.withHooks()` before execution methods.

---

### Issue 2: Duplicate Output

**Symptom:** You see duplicate log messages or hooks firing twice.

**Diagnosis:** You're registering the same preset multiple times, or calling `.withHooks()` repeatedly.

**Solution:**
```typescript
// Wrong: Multiple registrations
.withHooks(HookPresets.logging())
.withHooks(HookPresets.logging()) // Duplicate!

// Wrong: Redundant via monitoring
.withHooks(HookPresets.logging())
.withHooks(HookPresets.monitoring()) // Includes logging!

// Correct: Single registration
.withHooks(HookPresets.logging())

// Or: Merge if you need multiple presets
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  HookPresets.timing()
))
```

**Prevention:** Call `.withHooks()` once, use `merge()` for combinations.

---

### Issue 3: Missing Token Counts

**Symptom:** `tokenTracking()` preset shows "unknown" or `0` tokens.

**Diagnosis:** Some LLM providers don't include usage data in responses, or streaming is enabled without usage tracking.

**Solution:**
```typescript
// Check provider capabilities
.withHooks({
  observers: {
    onLLMCallComplete: async (ctx) => {
      if (!ctx.usage) {
        console.warn('Provider does not include usage data');
      }
    },
  },
})

// For streaming, usage is in the final event
.withHooks({
  observers: {
    onLLMCallComplete: async (ctx) => {
      // Only available after stream completes
      console.log(`Tokens: ${ctx.usage?.totalTokens ?? 'N/A'}`);
    },
  },
})
```

**Prevention:** Check your LLM provider's documentation for usage data support.

---

### Issue 4: Timing Seems Wrong

**Symptom:** `timing()` preset shows inconsistent or unexpected durations.

**Diagnosis:** Async operations or streaming can cause timing measurements to include wait time, not just processing time.

**Solution:**
```typescript
// Timing includes full iteration duration (LLM call + gadget execution)
.withHooks(HookPresets.timing())

// For fine-grained timing, add custom measurements
.withHooks(HookPresets.merge(
  HookPresets.timing(),
  {
    observers: {
      onGadgetExecutionComplete: async (ctx) => {
        if (ctx.executionTimeMs && ctx.executionTimeMs > 1000) {
          console.warn(`⚠️ Slow gadget: ${ctx.gadgetName} took ${ctx.executionTimeMs}ms`);
        }
      },
    },
  }
))
```

**Prevention:** Understand that timing includes all async waits and I/O operations.

---

### Issue 5: Merged Hooks Not Working as Expected

**Symptom:** When merging hooks, only some handlers seem to run, or behavior is unexpected.

**Diagnosis:** Remember the merge behavior - observers compose, but interceptors and controllers don't (last one wins).

**Solution:**
```typescript
// Problem: Multiple interceptors (only last wins)
HookPresets.merge(
  { interceptors: { interceptTextChunk: (c) => c.toUpperCase() } }, // Ignored
  { interceptors: { interceptTextChunk: (c) => c.toLowerCase() } }, // This wins
)
// Result: text will be lowercase

// Solution: Compose manually in a single interceptor
{
  interceptors: {
    interceptTextChunk: (chunk) => {
      let result = chunk;
      result = result.toUpperCase(); // First transformation
      result = result.trim();        // Second transformation
      return result;
    },
  },
}

// Observers compose correctly (all run)
HookPresets.merge(
  { observers: { onLLMCallComplete: async (ctx) => logToConsole(ctx) } },
  { observers: { onLLMCallComplete: async (ctx) => sendToAnalytics(ctx) } },
)
// Result: Both observers run
```

**Prevention:** Design your hook architecture knowing merge semantics - use observers for composable behavior, interceptors/controllers for single-responsibility.

---

## See Also

- **[Streaming Guide](./STREAMING.md)** - Event handling
- **[Debugging Guide](./DEBUGGING.md)** - Using hooks for debugging
- **[Error Handling](./ERROR_HANDLING.md)** - Recovery strategies
