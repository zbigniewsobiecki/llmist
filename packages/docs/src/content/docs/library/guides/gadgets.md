---
title: Gadgets (Tools)
description: Create custom functions that LLMs can call
---

Gadgets are functions that LLMs can call. llmist uses a simple block format with `!!!ARG:` markers that works with any text model - no native tool calling required. See [Block Format Reference](/reference/block-format/) for detailed syntax documentation.

## Quick Start

```typescript
import { Gadget, createGadget, z } from 'llmist';

// Class-based (recommended for complex gadgets)
class FloppyDisk extends Gadget({
  description: 'Calculates how many 1.44MB floppy disks are needed',
  schema: z.object({
    filename: z.string(),
    megabytes: z.number().positive(),
  }),
}) {
  execute(params: this['params']): string {
    const { filename, megabytes } = params; // Fully typed!
    const disks = Math.ceil(megabytes / 1.44);
    return `${filename} requires ${disks} floppy disk(s)`;
  }
}

// Function-based (simpler for one-off gadgets)
const floppyDisk = createGadget({
  description: 'Calculates how many 1.44MB floppy disks are needed',
  schema: z.object({
    filename: z.string(),
    megabytes: z.number().positive(),
  }),
  execute: ({ filename, megabytes }) => {
    const disks = Math.ceil(megabytes / 1.44);
    return `${filename} requires ${disks} floppy disk(s)`;
  },
});
```

## Class-Based Gadgets

Full type safety with `this['params']`:

```typescript
class DialUpModem extends Gadget({
  description: 'Connect to the internet via dial-up modem',
  schema: z.object({
    phoneNumber: z.string().min(1).describe('ISP phone number'),
    baud: z.enum(['14400', '28800', '33600', '56000']).optional(),
  }),
  timeoutMs: 30000, // Connection can be slow!
}) {
  async execute(params: this['params']): Promise<string> {
    const { phoneNumber, baud = '56000' } = params;
    await simulateHandshake();
    return `ATDT ${phoneNumber}... CONNECT ${baud}. You've got mail!`;
  }
}
```

## Function-Based Gadgets

For simpler use cases:

```typescript
const screenSaver = createGadget({
  name: 'ScreenSaver', // Optional custom name
  description: 'Activate a Windows 98 screensaver',
  schema: z.object({
    style: z.enum(['pipes', 'starfield', 'maze', 'flying-toasters']),
  }),
  timeoutMs: 5000,
  execute: async ({ style }) => {
    await activateScreenSaver(style);
    return `Activating ${style} screensaver. Move mouse to exit.`;
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
const highScore = createGadget({
  description: 'Record a high score on the arcade leaderboard',
  schema: z.object({
    game: z.enum(['pac-man', 'galaga', 'donkey-kong']),
    initials: z.string().length(3).describe('Player initials'),
    score: z.number().int().positive().describe('Points scored'),
  }),
  examples: [
    {
      params: { game: 'pac-man', initials: 'AAA', score: 999999 },
      output: 'AAA: 999,999 points on pac-man - NEW HIGH SCORE!',
      comment: 'Record a new high score'
    }
  ],
  execute: ({ game, initials, score }) => { /* ... */ },
});
```

## Async Gadgets

```typescript
class BBSFetch extends Gadget({
  description: 'Fetch content from a BBS or web server',
  schema: z.object({ url: z.string().url() }),
  timeoutMs: 30000, // 30 second timeout (dial-up is slow!)
}) {
  async execute(params: this['params']): Promise<string> {
    const response = await fetch(params.url);
    const data = await response.text();
    return data.slice(0, 10000); // Limit for context size
  }
}
```

## Cost Reporting

Gadgets that call paid APIs can report their costs:

```typescript
const longDistanceCall = createGadget({
  name: 'LongDistanceCall',
  description: 'Make a long distance phone call (charges apply!)',
  schema: z.object({
    phoneNumber: z.string().describe('Phone number to call'),
    minutes: z.number().int().positive().describe('Duration in minutes'),
  }),
  execute: async ({ phoneNumber, minutes }, ctx) => {
    const response = await makeCall(phoneNumber, minutes);

    // Report cost: $0.25 per minute for long distance
    ctx.reportCost(minutes * 0.25);

    return `Call to ${phoneNumber} complete. Duration: ${minutes} min.`;
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

- [Creating Gadgets Guide](/library/guides/creating-gadgets/) - Complete gadget development tutorial
- [Testing Gadgets](/testing/gadgets/test-gadget/) - Test gadgets and mock utilities
- [Streaming Guide](/library/guides/streaming/) - Handle gadget events
- [Error Handling](/library/reference/error-handling/) - Gadget error strategies
- [Human-in-the-Loop](/library/guides/human-in-loop/) - Interactive workflows
