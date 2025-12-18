# Gadgets (Tools)

Gadgets are functions that LLMs can call. llmist uses a simple block format with `!!!ARG:` markers that works with any text model - no native tool calling required. See **[Block Format Reference](./BLOCK_FORMAT.md)** for detailed syntax documentation.

## Quick Start

```typescript
import { Gadget, createGadget, z } from 'llmist';

// Class-based (recommended for complex gadgets)
class Calculator extends Gadget({
  description: 'Performs arithmetic',
  schema: z.object({
    operation: z.enum(['add', 'subtract']),
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(params: this['params']): string {
    const { operation, a, b } = params; // Fully typed!
    return operation === 'add' ? String(a + b) : String(a - b);
  }
}

// Function-based (simpler for one-off gadgets)
const calculator = createGadget({
  description: 'Performs arithmetic',
  schema: z.object({
    operation: z.enum(['add', 'subtract']),
    a: z.number(),
    b: z.number(),
  }),
  execute: ({ operation, a, b }) => {
    return operation === 'add' ? String(a + b) : String(a - b);
  },
});
```

## Class-Based Gadgets

Full type safety with `this['params']`:

```typescript
class Weather extends Gadget({
  description: 'Get weather for a city',
  schema: z.object({
    city: z.string().min(1).describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  timeoutMs: 10000, // Optional timeout
}) {
  async execute(params: this['params']): Promise<string> {
    const { city, units = 'celsius' } = params;
    const data = await fetchWeather(city);
    return `${city}: ${data.temp}°${units === 'celsius' ? 'C' : 'F'}`;
  }
}
```

## Function-Based Gadgets

For simpler use cases:

```typescript
const weather = createGadget({
  name: 'weather', // Optional custom name
  description: 'Get weather for a city',
  schema: z.object({
    city: z.string(),
  }),
  timeoutMs: 10000,
  execute: async ({ city }) => {
    const data = await fetchWeather(city);
    return `${city}: ${data.temp}°C`;
  },
});
```

## Schema Patterns

### Importing Zod

For best results with `.describe()` metadata, import `z` from llmist:

```typescript
import { z, createGadget } from 'llmist';

const gadget = createGadget({
  description: 'Search for items',
  schema: z.object({
    query: z.string().describe('Search query'),  // ✅ Description preserved
  }),
  execute: ({ query }) => `Results for: ${query}`,
});
```

If you import from `"zod"` directly, descriptions may be lost due to Zod instance mismatch. llmist will warn and attempt recovery, but importing from llmist is recommended.

### Basic Types

```typescript
z.string()
z.number()
z.boolean()
z.enum(['option1', 'option2'])
```

### Optional Fields

```typescript
z.object({
  required: z.string(),
  optional: z.string().optional(),
  withDefault: z.string().default('default'),
})
```

### Arrays

```typescript
z.object({
  items: z.array(z.string()),
  numbers: z.array(z.number()),
})
```

### Nested Objects

```typescript
z.object({
  user: z.object({
    name: z.string(),
    age: z.number(),
  }),
  settings: z.object({
    theme: z.enum(['light', 'dark']),
  }),
})
```

### Field Descriptions

Use `.describe()` to help the LLM understand what each parameter expects. Descriptions are automatically included in the JSON Schema sent to the model, improving parameter accuracy:

```typescript
z.object({
  query: z.string().describe('Search query - supports wildcards like * and ?'),
  limit: z.number().min(1).max(100).describe('Maximum number of results to return'),
  format: z.enum(['json', 'csv', 'xml']).describe('Output format for results'),
})
```

**Best Practices:**
- Describe non-obvious parameters (what format? what units? what values?)
- Clarify enum values when not self-explanatory
- Mention constraints, valid ranges, or expected patterns
- Use descriptions on nested objects to explain their purpose

**Nested Object Descriptions:**

```typescript
z.object({
  user: z.object({
    name: z.string().describe('Full name of the user'),
    email: z.string().email().describe('Contact email address'),
  }).describe('User information to create'),
  options: z.object({
    notify: z.boolean().describe('Whether to send welcome email'),
    role: z.enum(['admin', 'user', 'guest']).describe('Permission level'),
  }).describe('Account creation options'),
})
```

**Why Descriptions Matter:**

Without descriptions, the LLM only sees parameter names and types. With descriptions, it understands:
- What values are expected (`'City name like "Paris" or "New York"'`)
- What units to use (`'Temperature in Celsius'`)
- What format to follow (`'Date in YYYY-MM-DD format'`)

## Examples

Provide usage examples to help LLMs understand how to call your gadget correctly. Examples are rendered alongside the schema in the instruction text:

### Basic Example

```typescript
const calculator = createGadget({
  description: 'Performs arithmetic operations',
  schema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  }),
  examples: [
    {
      params: { operation: 'add', a: 15, b: 23 },
      output: '38',
      comment: 'Add two numbers'
    }
  ],
  execute: ({ operation, a, b }) => { /* ... */ },
});
```

### Multiple Examples

```typescript
class StringProcessor extends Gadget({
  description: 'Processes strings',
  schema: z.object({
    text: z.string(),
    operation: z.enum(['reverse', 'uppercase', 'lowercase']),
  }),
  examples: [
    {
      params: { text: 'Hello', operation: 'reverse' },
      output: 'olleH',
      comment: 'Reverse a string'
    },
    {
      params: { text: 'hello', operation: 'uppercase' },
      output: 'HELLO',
      comment: 'Convert to uppercase'
    },
  ],
}) {
  execute(params: this['params']): string { /* ... */ }
}
```

### Example Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `params` | `TParams` | Yes | Example parameters (typed to match schema) |
| `output` | `string` | No | Expected result from the gadget |
| `comment` | `string` | No | Description of what this example demonstrates |

### Best Practices

- **Include at least one example** for complex gadgets with multiple parameters
- **Show edge cases** like optional parameters or different operation modes
- **Keep examples realistic** - use values an LLM might actually provide
- **Add comments** to explain non-obvious usage patterns

## Async Gadgets

```typescript
class APIGadget extends Gadget({
  description: 'Fetches data from API',
  schema: z.object({ endpoint: z.string() }),
  timeoutMs: 30000, // 30 second timeout
}) {
  async execute(params: this['params']): Promise<string> {
    const response = await fetch(params.endpoint);
    const data = await response.json();
    return JSON.stringify(data);
  }
}
```

## Cost Reporting

Gadgets that call paid APIs or consume resources can report their costs. These costs are tracked alongside LLM costs and included in the total cost reported by `HookPresets.progressTracking()`.

### Callback-Based Cost Reporting (Recommended)

Gadgets receive an optional `ExecutionContext` that provides `reportCost()` for incremental cost reporting:

```typescript
const multiStepApiGadget = createGadget({
  name: 'MultiStepAPI',
  description: 'Calls multiple paid APIs',
  schema: z.object({
    query: z.string().describe('Query to process'),
  }),
  execute: async ({ query }, ctx) => {
    // First API call
    const step1 = await callApi1(query);
    ctx.reportCost(0.001); // $0.001

    // Second API call
    const step2 = await callApi2(step1);
    ctx.reportCost(0.002); // $0.002

    return `Processed: ${step2}`;
    // Total: $0.003
  },
});
```

### Automatic LLM Cost Tracking

The execution context provides a wrapped LLMist client (`ctx.llmist`) that automatically reports LLM costs:

```typescript
const summarizer = createGadget({
  name: 'Summarizer',
  description: 'Summarizes text using an internal LLM',
  schema: z.object({
    text: z.string().describe('Text to summarize'),
  }),
  execute: async ({ text }, ctx) => {
    // ctx.llmist is optional - check availability first
    if (!ctx.llmist) {
      return 'LLM not available in this context';
    }

    // LLM costs are automatically reported!
    const summary = await ctx.llmist.complete(
      `Summarize briefly: ${text}`,
      { model: 'haiku' }
    );
    return summary;
  },
});
```

**Note:** `ctx.llmist` is optional and may be `undefined` when:
- The gadget is executed via CLI `gadget run` command
- The gadget is tested directly without agent context
- No LLMist client was provided to the executor

Always check for availability before use: `if (!ctx.llmist) { ... }`

The wrapped client supports:
- `ctx.llmist.complete(prompt, options?)` - Quick completion
- `ctx.llmist.streamText(prompt, options?)` - Streaming text
- `ctx.llmist.stream(options)` - Low-level stream access
- `ctx.llmist.modelRegistry` - Access to model registry

### Combining All Cost Sources

You can combine callback-based, automatic LLM, and return-based costs:

```typescript
const complexGadget = createGadget({
  description: 'Complex processing with multiple cost sources',
  schema: z.object({ data: z.string() }),
  execute: async ({ data }, ctx) => {
    // Source 1: Manual callback
    await callExternalApi(data);
    ctx.reportCost(0.001);

    // Source 2: Automatic from wrapped LLMist (check availability)
    if (!ctx.llmist) {
      return { result: 'LLM not available', cost: 0.001 };
    }
    const analysis = await ctx.llmist.complete('Analyze: ' + data);

    // Source 3: Return value (all three are summed)
    return {
      result: analysis,
      cost: 0.0005, // Processing overhead
    };
  },
});
```

### Return-Based Cost Reporting

For simpler cases, return an object with `result` and `cost`:

```typescript
const paidApiGadget = createGadget({
  name: 'PaidAPI',
  description: 'Calls a paid external API',
  schema: z.object({
    query: z.string().describe('Query to send to the API'),
  }),
  execute: async ({ query }) => {
    const response = await callExternalApi(query);

    return {
      result: JSON.stringify(response),
      cost: 0.001, // $0.001 per API call
    };
  },
});
```

### Tracking Total Costs

Use `HookPresets.progressTracking()` to track combined LLM and gadget costs:

```typescript
import { LLMist, HookPresets, ModelRegistry } from 'llmist';

let finalCost = 0;
const modelRegistry = new ModelRegistry();

await LLMist.createAgent()
  .withModel('haiku')
  .withGadgets(paidApiGadget, summarizer)
  .withHooks(
    HookPresets.progressTracking({
      modelRegistry,
      onProgress: (stats) => {
        finalCost = stats.totalCost; // Includes LLM + gadget costs
      },
    }),
  )
  .askAndCollect('Process this data');

console.log(`Total cost: $${finalCost.toFixed(6)}`);
```

### Cost Reporting Methods

| Method | When to Use | Example |
|--------|-------------|---------|
| `ctx.reportCost(amount)` | Multiple cost events during execution | `ctx.reportCost(0.001)` |
| `ctx.llmist.complete()` | Internal LLM calls (auto-tracked) | `await ctx.llmist.complete(prompt)` |
| `return { result, cost }` | Single cost at end of execution | `return { result: "...", cost: 0.001 }` |

**Notes:**
- All three methods can be combined - costs are summed
- Cost is in USD (e.g., `0.001` = $0.001)
- The context parameter (`ctx`) is optional for backwards compatibility
- Existing gadgets returning strings continue to work (free by default)

## Cancellation Support

The `ExecutionContext` provides an `AbortSignal` for handling cancellation, especially when gadgets time out.

### ExecutionContext Properties

| Property | Type | Description |
|----------|------|-------------|
| `reportCost(amount)` | `function` | Report costs in USD |
| `llmist` | `CostReportingLLMist?` | Wrapped LLM client (optional) |
| `signal` | `AbortSignal` | Abort signal for cancellation (always provided) |
| `logger` | `Logger<ILogObj>?` | Structured logger (see [Logging in Gadgets](#logging-in-gadgets)) |

### Using the Abort Signal

When a gadget times out, the `signal` is aborted **before** the `TimeoutException` is thrown. This allows gadgets to clean up resources:

```typescript
class BrowserGadget extends Gadget({
  description: 'Fetches web page content',
  schema: z.object({ url: z.string() }),
  timeoutMs: 30000,
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    const browser = await chromium.launch();

    // Register cleanup handler
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

### throwIfAborted Helper

Use `throwIfAborted(ctx)` to check for cancellation at key checkpoints:

```typescript
class DataProcessor extends Gadget({
  description: 'Processes data in batches',
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

### Pass Signal to fetch()

HTTP requests can be automatically cancelled by passing the signal:

```typescript
execute: async ({ url }, ctx) => {
  const response = await fetch(url, { signal: ctx.signal });
  return await response.text();
}
```

**See Also:** [Error Handling - Gadget Cancellation](./ERROR_HANDLING.md#gadget-cancellation) for more patterns.

## Logging in Gadgets

The `ExecutionContext` provides a `logger` property for structured logging within gadgets. This logger respects the CLI's configured log level, format, and output destination (console or file).

### Basic Usage

```typescript
class APIGadget extends Gadget({
  description: 'Calls external API',
  schema: z.object({ endpoint: z.string() }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext): Promise<string> {
    ctx?.logger?.debug('[APIGadget] Starting request', { endpoint: params.endpoint });

    const response = await fetch(params.endpoint);

    ctx?.logger?.info('[APIGadget] Request completed', { status: response.status });

    return await response.text();
  }
}
```

### Why ctx.logger?

- **CLI integration** - Logs respect `--log-level` and `--log-file` CLI options
- **Consistent formatting** - Uses the same tslog instance as the agent
- **Zero configuration** - Just use `ctx?.logger?.debug(...)`, no setup needed
- **External gadget support** - Works correctly even for gadgets from npm packages

### Available Log Methods

The logger provides standard tslog methods:

```typescript
ctx?.logger?.trace('Detailed trace info');
ctx?.logger?.debug('Debug information');
ctx?.logger?.info('General information');
ctx?.logger?.warn('Warning message');
ctx?.logger?.error('Error occurred', { error: err });
ctx?.logger?.fatal('Critical failure');
```

### Structured Logging

Pass objects as additional arguments for structured logging:

```typescript
ctx?.logger?.debug('[MyGadget] Processing item', {
  itemId: params.id,
  timestamp: Date.now(),
  metadata: { source: 'api', priority: 'high' },
});
```

### For External Gadget Authors

External gadgets (npm packages) should use `ctx.logger` instead of importing `defaultLogger`. This ensures logs appear in the host CLI's configured log destination:

```typescript
// ✅ Correct - uses host's logger configuration
ctx?.logger?.debug('[MyGadget] Starting...');

// ❌ Avoid - creates separate logger instance
import { defaultLogger } from 'llmist';
defaultLogger.debug('[MyGadget] Starting...');  // May not appear in log file
```

### Testing Gadgets with Logger

When testing gadgets, the logger is optional - gadgets should handle its absence gracefully:

```typescript
import { testGadget } from 'llmist/testing';

// Logger is not provided in test context by default
const result = await testGadget(myGadget, { param: 'value' });

// Gadget should use optional chaining: ctx?.logger?.debug(...)
```

## Special Exceptions

### Break Loop

Stop the agent loop from within a gadget:

```typescript
import { TaskCompletionSignal } from 'llmist';

class FinishTask extends Gadget({
  description: 'Call when task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new TaskCompletionSignal(params.summary);
  }
}
```

### Human Input

Request user input mid-execution:

```typescript
import { HumanInputRequiredException } from 'llmist';

class AskUser extends Gadget({
  description: 'Ask the user a question',
  schema: z.object({ question: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new HumanInputRequiredException(params.question);
  }
}

// Handle in agent
await LLMist.createAgent()
  .withGadgets(AskUser)
  .onHumanInput(async (question) => {
    return await promptUser(question); // Your input function
  })
  .askAndCollect('Help me plan');
```

## Registering Multiple Gadgets

```typescript
// Pass classes or instances
.withGadgets(Calculator, Weather, Email)

// Mix class-based and functional
.withGadgets(Calculator, weather, createGadget({...}))
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `description` | `string` | required | What the gadget does |
| `schema` | `ZodType` | required | Parameter schema |
| `name` | `string` | class name | Custom gadget name |
| `timeoutMs` | `number` | none | Execution timeout |
| `examples` | `GadgetExample[]` | none | Usage examples for LLMs |

## Testing Gadgets

Test gadgets in isolation with validation and schema defaults:

```typescript
import { testGadget } from 'llmist/testing';

// Validates params and applies defaults before executing
const result = await testGadget(calculator, { a: 5 });
console.log(result.result);  // "5" (b=0 default applied)
console.log(result.error);   // undefined for valid params
console.log(result.cost);    // 0 (or reported cost if gadget returns { result, cost })
```

The `TestGadgetResult` includes:
- `result?: string` - The result string if execution succeeded
- `error?: string` - Error message if validation or execution failed
- `validatedParams?: Record<string, unknown>` - Parameters after validation
- `cost?: number` - Cost reported by the gadget in USD

For standalone validation without execution:

```typescript
import { validateGadgetParams } from 'llmist';

const result = validateGadgetParams(calculator, { a: 5 });
if (result.success) {
  console.log(result.data);  // { a: 5, b: 0 } with defaults
}
```

See **[Testing Guide](./TESTING.md#gadget-testing-utilities)** for full documentation.

## Gadget Output Limiting

When gadgets return large outputs (e.g., file searches, database queries), they can consume significant context window space. llmist automatically limits gadget output and provides tools to browse large results.

### How It Works

1. **Automatic limiting** - Enabled by default, limits output to 15% of the model's context window
2. **Output storage** - Large outputs are stored in memory with a unique ID
3. **Selective browsing** - Use `GadgetOutputViewer` to filter and view stored outputs

When a gadget exceeds the limit, the LLM sees:
```
[Gadget "Search" returned too much data: 31,337 bytes, 4,200 lines. Use GadgetOutputViewer with id "Search_d34db33f" to read it]
```

### GadgetOutputViewer

The `GadgetOutputViewer` gadget is automatically registered when output limiting is enabled. It provides grep-like filtering:

The LLM can call GadgetOutputViewer to browse stored output:

```
!!!GADGET_START:GadgetOutputViewer
!!!ARG:id
Search_d34db33f
!!!ARG:patterns/0/regex
TODO.*HIGH
!!!ARG:patterns/0/include
true
!!!ARG:patterns/0/before
2
!!!ARG:patterns/0/after
2
!!!ARG:limit
100-
!!!GADGET_END
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | ID from the truncation message |
| `patterns` | array | Filter patterns (applied in order, like piping through grep) |
| `patterns[].regex` | string | Regular expression to match |
| `patterns[].include` | boolean | `true` = keep matches, `false` = exclude matches |
| `patterns[].before` | number | Context lines before match (like `grep -B`) |
| `patterns[].after` | number | Context lines after match (like `grep -A`) |
| `limit` | string | Line range: `"100-"` (first 100), `"-25"` (last 25), `"50-100"` (range) |

**Order of operations:**
1. Apply all patterns in sequence (each filters the result of the previous)
2. Apply the `limit` to the final filtered result

### Configuration

```typescript
// Disable output limiting
await LLMist.createAgent()
  .withModel("sonnet")
  .withGadgetOutputLimit(false)
  .ask("...");

// Custom percentage (25% of context window)
await LLMist.createAgent()
  .withModel("sonnet")
  .withGadgetOutputLimitPercent(25)
  .ask("...");
```

### Calculation

The limit is calculated as:
```
charLimit = contextWindow × (percent / 100) × 4 chars/token
```

For Claude Sonnet (200K context) with default 15%:
- Token limit: 30,000 tokens
- Character limit: ~120,000 characters

## Dependencies

Gadgets can specify dependencies on other gadgets, enabling **DAG (Directed Acyclic Graph) execution**: independent gadgets run in parallel, dependent gadgets wait for their dependencies.

See **[Block Format - Dependencies](./BLOCK_FORMAT.md#dependencies)** for syntax details and examples.

### Controlling Skip Behavior

When a dependency fails, dependent gadgets are skipped by default. Customize with the `onDependencySkipped` controller:

```typescript
.withHooks({
  controllers: {
    onDependencySkipped: async (ctx) => {
      // Options: 'skip' (default), 'execute_anyway', or 'use_fallback'
      return { action: 'use_fallback', fallbackResult: '[]' };
    },
  },
})
```

## See Also

- **[Testing Guide](./TESTING.md)** - Test gadgets and mock utilities
- **[Streaming Guide](./STREAMING.md)** - Handle gadget events
- **[Error Handling](./ERROR_HANDLING.md)** - Gadget error strategies
- **[Human-in-the-Loop](./HUMAN_IN_LOOP.md)** - Interactive workflows
