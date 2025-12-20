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

class Calculator extends Gadget({
  description: 'Performs arithmetic operations',
  schema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number().describe('First operand'),
    b: z.number().describe('Second operand'),
  }),
}) {
  execute(params: this['params']): string {
    const { operation, a, b } = params;  // Fully typed!
    switch (operation) {
      case 'add': return String(a + b);
      case 'subtract': return String(a - b);
      case 'multiply': return String(a * b);
      case 'divide': return b !== 0 ? String(a / b) : 'Error: Division by zero';
    }
  }
}
```

### Function-Based

Simpler for one-off gadgets without state:

```typescript
import { createGadget, z } from 'llmist';

const calculator = createGadget({
  name: 'Calculator',  // Optional - defaults to 'AnonymousGadget'
  description: 'Performs arithmetic operations',
  schema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  execute: ({ operation, a, b }) => {
    // Implementation
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

Costs appear in the [ExecutionTree](/advanced/execution-tree/) and [Cost Tracking](/guides/cost-tracking/).

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
description: 'Does stuff with files'

// ✅ Clear and specific
description: 'Read the contents of a text file. Returns the file content as a string, limited to first 10KB.'
```

### 2. Validate Input

```typescript
schema: z.object({
  path: z.string()
    .min(1)
    .refine(p => !p.includes('..'), 'Path traversal not allowed'),
  maxSize: z.number().min(1).max(1_000_000).default(10_000),
})
```

### 3. Limit Output Size

```typescript
async execute(params: this['params']): Promise<string> {
  const content = await fetchLargeContent();
  return content.slice(0, 50_000);  // Don't blow up context
}
```

### 4. Use Timeouts

```typescript
class SlowAPI extends Gadget({
  description: 'Call slow external API',
  schema: z.object({ query: z.string() }),
  timeoutMs: 30000,  // Always set timeouts for network calls
}) { /* ... */ }
```

### 5. Idempotent When Possible

Design gadgets that can be safely retried:

```typescript
// ✅ Idempotent - safe to retry
class GetUser extends Gadget({
  description: 'Get user by ID',
  schema: z.object({ id: z.string() }),
}) { /* ... */ }

// ⚠️ Not idempotent - be careful
class CreateUser extends Gadget({
  description: 'Create a new user',
  schema: z.object({ name: z.string(), email: z.string() }),
}) { /* ... */ }
```

## Testing Gadgets

### Unit Testing

```typescript
import { testGadget } from '@llmist/testing';

describe('Calculator', () => {
  it('adds numbers correctly', async () => {
    const result = await testGadget(Calculator, {
      operation: 'add',
      a: 15,
      b: 23,
    });

    expect(result).toBe('38');
  });

  it('handles division by zero', async () => {
    const result = await testGadget(Calculator, {
      operation: 'divide',
      a: 10,
      b: 0,
    });

    expect(result).toContain('Error');
  });
});
```

### Integration Testing

```typescript
import { mockLLM, createMockClient } from '@llmist/testing';

describe('Agent with Calculator', () => {
  it('uses calculator for math questions', async () => {
    mockLLM()
      .forAnyModel()
      .whenMessageContains('calculate')
      .returns('!!!GADGET_START[Calculator]\n!!!ARG[operation] add\n!!!ARG[a] 15\n!!!ARG[b] 23\n!!!GADGET_END')
      .register();

    const client = createMockClient();
    const result = await client.createAgent()
      .withGadgets(Calculator)
      .askAndCollect('Calculate 15 + 23');

    // Verify gadget was called
  });
});
```

See [Testing Guide](/testing/overview/) for more testing patterns.

## Common Gadget Patterns

### File Operations

```typescript
class WriteFile extends Gadget({
  description: 'Write content to a file',
  schema: z.object({
    path: z.string().describe('File path'),
    content: z.string().describe('Content to write'),
    append: z.boolean().default(false),
  }),
}) {
  async execute(params: this['params']): Promise<string> {
    const flag = params.append ? 'a' : 'w';
    await fs.writeFile(params.path, params.content, { flag });
    return `Written ${params.content.length} bytes to ${params.path}`;
  }
}
```

### HTTP Requests

```typescript
class HttpRequest extends Gadget({
  description: 'Make HTTP requests',
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
class ShellCommand extends Gadget({
  description: 'Execute shell commands',
  schema: z.object({
    command: z.string().describe('Command to execute'),
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

- [Gadgets Reference](/guides/gadgets/) - Quick reference for gadget syntax
- [Block Format](/guides/block-format/) - How LLMs call gadgets
- [Testing Gadgets](/testing/gadget-testing/) - Testing utilities
- [CLI Gadgets](/cli/gadgets/) - Using gadgets with the CLI
- [Human-in-the-Loop](/guides/human-in-loop/) - Interactive workflows
