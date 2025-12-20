---
title: Gadgets (Tools)
description: Create custom functions that LLMs can call
---

Gadgets are functions that LLMs can call. llmist uses a simple block format with `!!!ARG:` markers that works with any text model - no native tool calling required. See [Block Format Reference](/guides/block-format/) for detailed syntax documentation.

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

## Examples

Provide usage examples to help LLMs understand how to call your gadget correctly:

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

Gadgets that call paid APIs can report their costs:

```typescript
const paidApiGadget = createGadget({
  name: 'PaidAPI',
  description: 'Calls a paid external API',
  schema: z.object({
    query: z.string().describe('Query to send to the API'),
  }),
  execute: async ({ query }, ctx) => {
    const response = await callExternalApi(query);

    // Report cost via callback
    ctx.reportCost(0.001); // $0.001

    return JSON.stringify(response);
  },
});
```

## Cancellation Support

The `ExecutionContext` provides an `AbortSignal` for handling cancellation:

```typescript
execute: async ({ url }, ctx) => {
  const response = await fetch(url, { signal: ctx.signal });
  return await response.text();
}
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
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `description` | `string` | required | What the gadget does |
| `schema` | `ZodType` | required | Parameter schema |
| `name` | `string` | class name | Custom gadget name |
| `timeoutMs` | `number` | none | Execution timeout |
| `examples` | `GadgetExample[]` | none | Usage examples for LLMs |

## See Also

- [Creating Gadgets Guide](/guides/creating-gadgets/) - Complete gadget development tutorial
- [Testing Gadgets](/testing/gadget-testing/) - Test gadgets and mock utilities
- [Streaming Guide](/guides/streaming/) - Handle gadget events
- [Error Handling](/reference/error-handling/) - Gadget error strategies
- [Human-in-the-Loop](/guides/human-in-loop/) - Interactive workflows
