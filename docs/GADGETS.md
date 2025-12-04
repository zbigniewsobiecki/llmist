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

### Basic Cost Reporting

Return an object with `result` and `cost` instead of a plain string:

```typescript
const paidApiGadget = createGadget({
  name: 'PaidAPI',
  description: 'Calls a paid external API',
  schema: z.object({
    query: z.string().describe('Query to send to the API'),
  }),
  execute: async ({ query }) => {
    const response = await callExternalApi(query);

    // Return { result, cost } instead of just string
    return {
      result: JSON.stringify(response),
      cost: 0.001, // $0.001 per API call
    };
  },
});
```

### Class-Based Cost Reporting

```typescript
class PremiumCalculator extends Gadget({
  description: 'Premium calculator service ($0.0005 per calculation)',
  schema: z.object({
    expression: z.string().describe('Math expression to evaluate'),
  }),
}) {
  execute(params: this['params']) {
    const result = evaluateExpression(params.expression);

    return {
      result: String(result),
      cost: 0.0005, // $0.0005 per calculation
    };
  }
}
```

### Tracking Total Costs

Use `HookPresets.progressTracking()` to track combined LLM and gadget costs:

```typescript
import { LLMist, HookPresets, ModelRegistry } from 'llmist';

let finalCost = 0;
const modelRegistry = new ModelRegistry();

await LLMist.createAgent()
  .withModel('haiku')
  .withGadgets(paidApiGadget, PremiumCalculator)
  .withHooks(
    HookPresets.progressTracking({
      modelRegistry,
      onProgress: (stats) => {
        finalCost = stats.totalCost; // Includes LLM + gadget costs
      },
    }),
  )
  .askAndCollect('Calculate something and query the API');

console.log(`Total cost: $${finalCost.toFixed(6)}`);
```

### Return Type Reference

| Return Type | Cost | Example |
|-------------|------|---------|
| `string` | $0 (free) | `return "result"` |
| `{ result: string }` | $0 (free) | `return { result: "data" }` |
| `{ result: string, cost: number }` | Reported cost | `return { result: "data", cost: 0.001 }` |

**Notes:**
- Cost is in USD (e.g., `0.001` = $0.001)
- Existing gadgets returning strings continue to work (free by default)
- Costs are accumulated in real-time via the `onGadgetExecutionComplete` observer

### Advanced: LLM-Powered Gadgets

When a gadget internally calls an LLM (e.g., for summarization, translation, or specialized reasoning), you can pass through the LLM costs as gadget costs:

```typescript
import { LLMist, Gadget, ModelRegistry, z } from 'llmist';

const modelRegistry = new ModelRegistry();

class Summarizer extends Gadget({
  description: 'Summarizes text using a fast LLM',
  schema: z.object({
    text: z.string().describe('Text to summarize'),
    maxLength: z.number().optional().describe('Max summary length in words'),
  }),
}) {
  private client = new LLMist();

  async execute(params: this['params']) {
    const { text, maxLength = 100 } = params;

    // Track tokens for cost calculation
    let inputTokens = 0;
    let outputTokens = 0;
    let summary = '';

    // Use LLMist.complete() for the internal LLM call
    for await (const chunk of this.client.complete({
      model: 'haiku', // Use a fast, cheap model
      messages: [
        {
          role: 'user',
          content: `Summarize in ${maxLength} words or less:\n\n${text}`,
        },
      ],
    })) {
      summary += chunk.text;
      if (chunk.usage) {
        inputTokens = chunk.usage.inputTokens;
        outputTokens = chunk.usage.outputTokens;
      }
    }

    // Calculate cost using ModelRegistry
    const costEstimate = modelRegistry.estimateCost(
      'claude-3-5-haiku-20241022',
      inputTokens,
      outputTokens,
    );

    // Return result with the LLM cost
    return {
      result: summary.trim(),
      cost: costEstimate?.totalCost ?? 0,
    };
  }
}
```

This pattern is useful for:
- **Specialized sub-agents** - Using different models for different tasks
- **Chunked processing** - Breaking large inputs into smaller LLM calls
- **Multi-step reasoning** - Chain-of-thought with cost tracking
- **Translation/summarization** - Dedicated models for specific tasks

The gadget's cost will be included in the parent agent's total cost tracked by `progressTracking()`.

## Special Exceptions

### Break Loop

Stop the agent loop from within a gadget:

```typescript
import { BreakLoopException } from 'llmist';

class FinishTask extends Gadget({
  description: 'Call when task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new BreakLoopException(params.summary);
  }
}
```

### Human Input

Request user input mid-execution:

```typescript
import { HumanInputException } from 'llmist';

class AskUser extends Gadget({
  description: 'Ask the user a question',
  schema: z.object({ question: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new HumanInputException(params.question);
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
```

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

## See Also

- **[Testing Guide](./TESTING.md)** - Test gadgets and mock utilities
- **[Streaming Guide](./STREAMING.md)** - Handle gadget events
- **[Error Handling](./ERROR_HANDLING.md)** - Gadget error strategies
- **[Human-in-the-Loop](./HUMAN_IN_LOOP.md)** - Interactive workflows
