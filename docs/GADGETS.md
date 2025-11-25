# Gadgets (Tools)

Gadgets are functions that LLMs can call. llmist uses a YAML/JSON grammar that works with any text model - no native tool calling required.

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

## See Also

- **[Testing Guide](./TESTING.md)** - Test gadgets and mock utilities
- **[Streaming Guide](./STREAMING.md)** - Handle gadget events
- **[Error Handling](./ERROR_HANDLING.md)** - Gadget error strategies
- **[Human-in-the-Loop](./HUMAN_IN_LOOP.md)** - Interactive workflows
