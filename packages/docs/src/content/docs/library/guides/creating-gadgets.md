---
title: Creating Gadgets
description: Complete guide to building custom tools for LLM agents
---

This guide walks you through creating gadgets (tools) for llmist agents, from simple functions to production-ready implementations with error handling, testing, and best practices.

## Gadget Basics

Gadgets are functions that LLMs can call. llmist provides two ways to create them:

### Class-Based (Recommended)

Best for complex gadgets with state, dependencies, or multiple methods:

```typescript
import { Gadget, z } from 'llmist';

class Tamagotchi extends Gadget({
  description: 'Check on your virtual pet and perform care actions',
  schema: z.object({
    action: z.enum(['feed', 'play', 'sleep', 'status']),
    petName: z.string().describe('Name of your digital companion'),
  }),
}) {
  execute(params: this['params']): string {
    const { action, petName } = params;  // Fully typed!
    switch (action) {
      case 'feed': return `${petName} ate the food. Happiness +10.`;
      case 'play': return `${petName} played ball. Energy -5, Happiness +15.`;
      case 'sleep': return `${petName} is sleeping. Zzz... Energy restored.`;
      case 'status': return `${petName}: Hunger 3/10, Happiness 8/10, Energy 6/10`;
    }
  }
}
```

### Function-Based

Simpler for one-off gadgets without state:

```typescript
import { createGadget, z } from 'llmist';

const coinFlip = createGadget({
  name: 'CoinFlip',
  description: 'Flip a coin to make important life decisions',
  schema: z.object({
    question: z.string().describe('The decision you need help with'),
    bestOf: z.number().int().min(1).max(5).default(1),
  }),
  execute: ({ question, bestOf }) => {
    const flips = Array.from({ length: bestOf }, () =>
      Math.random() > 0.5 ? 'heads' : 'tails'
    );
    const heads = flips.filter(f => f === 'heads').length;
    return `${question}: ${heads > bestOf/2 ? 'Yes (heads)' : 'No (tails)'} [${flips.join(', ')}]`;
  },
});
```

## Schema Design

### Import Zod from llmist

Always import `z` from llmist for best compatibility:

```typescript
import { z } from 'llmist';  // ✅ Recommended

// NOT from 'zod' directly - descriptions may be lost
```

### Field Descriptions

Use `.describe()` to help the LLM understand parameters:

```typescript
schema: z.object({
  query: z.string().describe('Search query - supports wildcards like * and ?'),
  limit: z.number().min(1).max(100).describe('Maximum results to return'),
  format: z.enum(['json', 'csv']).describe('Output format'),
})
```

### Common Patterns

```typescript
// Required vs optional
z.object({
  required: z.string(),
  optional: z.string().optional(),
  withDefault: z.string().default('default value'),
})

// Enums with clear options
z.enum(['create', 'read', 'update', 'delete'])

// Constrained numbers
z.number().min(1).max(100).int()

// Arrays
z.array(z.string()).min(1).max(10)

// Nested objects
z.object({
  user: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
})
```

## Async Gadgets

Most real-world gadgets need async operations:

```typescript
class WebSearch extends Gadget({
  description: 'Search the web for information',
  schema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().default(5),
  }),
  timeoutMs: 30000,  // 30 second timeout
}) {
  async execute(params: this['params']): Promise<string> {
    const { query, maxResults } = params;

    const response = await fetch(
      `https://api.search.com?q=${encodeURIComponent(query)}&limit=${maxResults}`
    );

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const results = await response.json();
    return JSON.stringify(results, null, 2);
  }
}
```

## Execution Context

The `execute` method receives an `ExecutionContext` as the second parameter:

```typescript
execute: async (params, ctx) => {
  // Abort signal for cancellation
  const response = await fetch(url, { signal: ctx.signal });

  // Report costs for paid APIs
  ctx.reportCost(0.001);  // $0.001 per call

  // Access gadget metadata
  console.log(`Gadget: ${ctx.gadgetName}`);

  return result;
}
```

### Cancellation Support

Always pass the abort signal to cancellable operations:

```typescript
class FileDownloader extends Gadget({
  description: 'Download a file from URL',
  schema: z.object({ url: z.string().url() }),
  timeoutMs: 60000,
}) {
  async execute(params: this['params'], ctx): Promise<string> {
    const response = await fetch(params.url, {
      signal: ctx.signal,  // Respect cancellation
    });

    if (ctx.signal.aborted) {
      throw new Error('Download cancelled');
    }

    return await response.text();
  }
}
```

### Cost Reporting

For gadgets that call paid APIs:

```typescript
const paidApi = createGadget({
  description: 'Call external paid API',
  schema: z.object({ query: z.string() }),
  execute: async ({ query }, ctx) => {
    const response = await callExternalApi(query);

    // Report the cost
    ctx.reportCost(0.01);  // $0.01 per call

    return JSON.stringify(response);
  },
});
```

Costs appear in the [ExecutionTree](/library/advanced/execution-tree/) and [Cost Tracking](/library/guides/cost-tracking/).

## Providing Examples

Help LLMs use your gadget correctly with examples:

```typescript
class DatabaseQuery extends Gadget({
  description: 'Execute SQL queries against the database',
  schema: z.object({
    query: z.string().describe('SQL query to execute'),
    params: z.array(z.unknown()).optional().describe('Query parameters'),
  }),
  examples: [
    {
      params: { query: 'SELECT * FROM users WHERE id = ?', params: [123] },
      output: '[{"id": 123, "name": "John"}]',
      comment: 'Query with parameter binding',
    },
    {
      params: { query: 'SELECT COUNT(*) FROM orders' },
      output: '[{"count": 42}]',
      comment: 'Simple count query',
    },
  ],
}) {
  async execute(params: this['params']): Promise<string> {
    // Implementation
  }
}
```

## Special Exceptions

### TaskCompletionSignal

Stop the agent loop from within a gadget:

```typescript
import { Gadget, TaskCompletionSignal, z } from 'llmist';

class FinishTask extends Gadget({
  description: 'Call when the task is complete',
  schema: z.object({
    summary: z.string().describe('Summary of what was accomplished'),
    success: z.boolean().default(true),
  }),
}) {
  execute(params: this['params']): never {
    throw new TaskCompletionSignal(params.summary);
  }
}
```

### HumanInputRequiredException

Request user input during execution:

```typescript
import { Gadget, HumanInputRequiredException, z } from 'llmist';

class AskUser extends Gadget({
  description: 'Ask the user a question and wait for response',
  schema: z.object({
    question: z.string().describe('Question to ask the user'),
  }),
}) {
  execute(params: this['params']): never {
    throw new HumanInputRequiredException(params.question);
  }
}
```

Handle responses with `.onHumanInput()`:

```typescript
await LLMist.createAgent()
  .withGadgets(AskUser)
  .onHumanInput(async (question) => {
    return await promptUser(question);
  })
  .askAndCollect('Help me plan my vacation');
```

## Gadgets with Dependencies

### Constructor Injection

```typescript
class DatabaseGadget extends Gadget({
  description: 'Query the database',
  schema: z.object({ query: z.string() }),
}) {
  private db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  async execute(params: this['params']): Promise<string> {
    const results = await this.db.query(params.query);
    return JSON.stringify(results);
  }
}

// Usage - pass instance, not class
const db = new Database(connectionString);
const agent = LLMist.createAgent()
  .withGadgets(new DatabaseGadget(db))  // Instance!
  .ask('...');
```

### Shared State

```typescript
class CounterGadget extends Gadget({
  description: 'Increment and get a counter',
  schema: z.object({
    action: z.enum(['increment', 'get', 'reset']),
  }),
}) {
  private counter = 0;

  execute(params: this['params']): string {
    switch (params.action) {
      case 'increment':
        return String(++this.counter);
      case 'get':
        return String(this.counter);
      case 'reset':
        this.counter = 0;
        return '0';
    }
  }
}
```

## Error Handling

### Graceful Errors

Return error messages as strings for the LLM to handle:

```typescript
class FileReader extends Gadget({
  description: 'Read file contents',
  schema: z.object({ path: z.string() }),
}) {
  async execute(params: this['params']): Promise<string> {
    try {
      const content = await fs.readFile(params.path, 'utf-8');
      return content.slice(0, 10000);  // Limit output size
    } catch (error) {
      if (error.code === 'ENOENT') {
        return `Error: File not found: ${params.path}`;
      }
      if (error.code === 'EACCES') {
        return `Error: Permission denied: ${params.path}`;
      }
      return `Error reading file: ${error.message}`;
    }
  }
}
```

### Fatal Errors

Throw exceptions for unrecoverable errors:

```typescript
async execute(params: this['params']): Promise<string> {
  if (!this.apiKey) {
    throw new Error('API key not configured');
  }
  // ...
}
```

Configure agent behavior with `.withStopOnGadgetError()`:

```typescript
// Stop on first error (default)
.withStopOnGadgetError(true)

// Continue despite errors
.withStopOnGadgetError(false)

// Custom error handling
.withErrorHandler((ctx) => {
  console.error(`Error in ${ctx.gadgetName}:`, ctx.error);
  return ctx.errorType !== 'execution';  // Continue unless execution error
})
```

## Best Practices

### 1. Clear Descriptions

```typescript
// ❌ Vague
description: 'Does stuff with games'

// ✅ Clear and specific
description: 'Load a saved game from a memory card slot. Returns save data as JSON, or error if slot is empty.'
```

### 2. Validate Input

```typescript
schema: z.object({
  slot: z.number()
    .int()
    .min(1)
    .max(15)
    .describe('Memory card slot (1-15)'),
  saveName: z.string().max(8).regex(/^[A-Z0-9]+$/, 'Only uppercase letters and numbers'),
})
```

### 3. Limit Output Size

```typescript
async execute(params: this['params']): Promise<string> {
  const levelData = await loadDOOMWad(params.wadFile);
  return levelData.slice(0, 50_000);  // Don't blow up context
}
```

### 4. Use Timeouts

```typescript
class BBSConnection extends Gadget({
  description: 'Connect to a bulletin board system over 2400 baud',
  schema: z.object({ phoneNumber: z.string(), handle: z.string() }),
  timeoutMs: 30000,  // Always set timeouts for network calls
}) { /* ... */ }
```

### 5. Idempotent When Possible

Design gadgets that can be safely retried:

```typescript
// ✅ Idempotent - safe to retry
class CheckHighScore extends Gadget({
  description: 'Check if a score would make the leaderboard',
  schema: z.object({ game: z.string(), score: z.number() }),
}) { /* ... */ }

// ⚠️ Not idempotent - be careful
class InsertCoin extends Gadget({
  description: 'Insert a coin to start the game',
  schema: z.object({ quarters: z.number().int().positive() }),
}) { /* ... */ }
```

## Testing Gadgets

### Unit Testing

```typescript
import { testGadget } from '@llmist/testing';

describe('Tamagotchi', () => {
  it('feeds the pet correctly', async () => {
    const result = await testGadget(Tamagotchi, {
      action: 'feed',
      petName: 'PixelPal',
    });

    expect(result).toContain('Happiness +10');
  });

  it('reports status', async () => {
    const result = await testGadget(Tamagotchi, {
      action: 'status',
      petName: 'BitBuddy',
    });

    expect(result).toContain('BitBuddy:');
    expect(result).toContain('Hunger');
  });
});
```

### Integration Testing

```typescript
import { mockLLM, createMockClient } from '@llmist/testing';

describe('Agent with Tamagotchi', () => {
  it('uses tamagotchi for pet care', async () => {
    mockLLM()
      .forAnyModel()
      .whenMessageContains('care for')
      .returns('!!!GADGET_START:Tamagotchi\n!!!ARG:action\nstatus\n!!!ARG:petName\nPixelPal\n!!!GADGET_END')
      .register();

    const client = createMockClient();
    const result = await client.createAgent()
      .withGadgets(Tamagotchi)
      .askAndCollect('How is my pet PixelPal doing?');

    // Verify gadget was called
  });
});
```

See [Testing Guide](/testing/getting-started/quick-start/) for more testing patterns.

## Common Gadget Patterns

### File Operations

```typescript
class SaveGame extends Gadget({
  description: 'Save game state to a file on the memory card',
  schema: z.object({
    slot: z.string().describe('Save slot path'),
    saveData: z.string().describe('Serialized game state'),
    append: z.boolean().default(false),
  }),
}) {
  async execute(params: this['params']): Promise<string> {
    const flag = params.append ? 'a' : 'w';
    await fs.writeFile(params.slot, params.saveData, { flag });
    return `Saved ${params.saveData.length} bytes to ${params.slot}`;
  }
}
```

### HTTP Requests

```typescript
class GopherFetch extends Gadget({
  description: 'Fetch content from a Gopher or HTTP server',
  schema: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    url: z.string().url(),
    body: z.string().optional(),
    headers: z.record(z.string()).optional(),
  }),
  timeoutMs: 30000,
}) {
  async execute(params: this['params'], ctx): Promise<string> {
    const response = await fetch(params.url, {
      method: params.method,
      body: params.body,
      headers: params.headers,
      signal: ctx.signal,
    });

    const text = await response.text();
    return JSON.stringify({
      status: response.status,
      body: text.slice(0, 10000),
    });
  }
}
```

### Shell Commands

```typescript
class DOSCommand extends Gadget({
  description: 'Execute commands in the DOS shell',
  schema: z.object({
    command: z.string().describe('Command to execute (e.g., DIR, COPY, DEL)'),
    cwd: z.string().optional().describe('Working directory'),
  }),
  timeoutMs: 60000,
}) {
  async execute(params: this['params']): Promise<string> {
    const { stdout, stderr } = await exec(params.command, {
      cwd: params.cwd,
      timeout: 55000,
    });

    return JSON.stringify({ stdout, stderr });
  }
}
```

## See Also

- [Gadget Examples](/reference/gadget-examples/) - More example patterns
- [Block Format](/reference/block-format/) - How LLMs call gadgets
- [Testing Gadgets](/testing/gadgets/test-gadget/) - Testing utilities
- [CLI Gadgets](/cli/gadgets/local-gadgets/) - Using gadgets with the CLI
- [Human-in-the-Loop](/library/guides/human-in-loop/) - Interactive workflows
