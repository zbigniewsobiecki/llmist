---
title: CLI Gadgets
description: Write gadgets for use with llmist agent
---

Write gadgets (tools) for use with `llmist agent`.

## Quick Start

Create a file with gadget classes:

```typescript
// calculator.ts
import { Gadget, z } from 'llmist';

export class Calculator extends Gadget({
  description: 'Performs arithmetic',
  schema: z.object({
    a: z.number(),
    b: z.number(),
    op: z.enum(['add', 'subtract', 'multiply', 'divide']),
  }),
}) {
  execute(params: this['params']): string {
    const { a, b, op } = params;
    switch (op) {
      case 'add': return String(a + b);
      case 'subtract': return String(a - b);
      case 'multiply': return String(a * b);
      case 'divide': return String(a / b);
    }
  }
}
```

Use it:

```bash
llmist agent "What is 15 * 23?" --gadget ./calculator.ts
```

## File Requirements

Gadget files must:
1. Export one or more gadget classes
2. Use TypeScript or JavaScript
3. Be a valid ES module

```typescript
// Multiple exports work
export class Calculator extends Gadget({ ... }) { ... }
export class Weather extends Gadget({ ... }) { ... }

// Default exports work too
export default class MyGadget extends Gadget({ ... }) { ... }
```

## Multiple Gadgets

Pass multiple `--gadget` flags:

```bash
llmist agent "Calculate and get weather" \
  --gadget ./calculator.ts \
  --gadget ./weather.ts
```

Or export multiple from one file:

```typescript
// tools.ts
export class Calculator extends Gadget({ ... }) { ... }
export class Weather extends Gadget({ ... }) { ... }
```

## External Gadgets

Load gadgets from npm packages or git repositories:

```bash
# npm package (Dhalsim browser automation)
llmist agent "Navigate to apple.com" -g dhalsim

# Use a preset
llmist agent "Browse the web" -g dhalsim:minimal

# git URL
llmist agent "task" -g git+https://github.com/user/repo.git

# Combine sources
llmist agent "Complex task" \
  -g ./local-gadget.ts \
  -g dhalsim:minimal \
  -g builtin:ReadFile
```

📖 See [Gadget Ecosystem](/cli/ecosystem/) for detailed documentation on Dhalsim, presets, and creating your own packages.

## Example Gadgets

### File System

```typescript
import { Gadget, z } from 'llmist';
import * as fs from 'fs/promises';

export class ReadFile extends Gadget({
  description: 'Read contents of a file',
  schema: z.object({
    path: z.string().describe('File path'),
  }),
}) {
  async execute(params: this['params']): Promise<string> {
    const content = await fs.readFile(params.path, 'utf-8');
    return content.slice(0, 5000);
  }
}
```

### HTTP Request

```typescript
export class HttpGet extends Gadget({
  description: 'Make HTTP GET request',
  schema: z.object({
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
  timeoutMs: 30000,
}) {
  async execute(params: this['params']): Promise<string> {
    const response = await fetch(params.url, {
      headers: params.headers,
    });
    return await response.text();
  }
}
```

### Human Input

```typescript
import { Gadget, HumanInputRequiredException, z } from 'llmist';

export class AskUser extends Gadget({
  description: 'Ask the user a question',
  schema: z.object({ question: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new HumanInputRequiredException(params.question);
  }
}
```

### Break Loop

```typescript
import { Gadget, TaskCompletionSignal, z } from 'llmist';

export class Done extends Gadget({
  description: 'Call when task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new TaskCompletionSignal(params.summary);
  }
}
```

## Testing Gadgets

Use the `gadget` command to test in isolation:

```bash
# Run interactively
llmist gadget run ./calculator.ts

# View gadget info
llmist gadget info ./calculator.ts

# Validate structure
llmist gadget validate ./calculator.ts

# Pipe JSON input
echo '{"a": 5, "b": 3, "op": "add"}' | llmist gadget run ./calculator.ts
```

## Creating External Packages

Add an `llmist` field to `package.json`:

```json
{
  "name": "my-gadgets",
  "llmist": {
    "gadgets": "./dist/index.js",
    "presets": {
      "all": "*",
      "minimal": ["GadgetA", "GadgetB"]
    }
  }
}
```

## See Also

- [CLI Reference](/cli/reference/) - Full CLI docs
- [Gadget Ecosystem](/cli/ecosystem/) - Third-party gadgets and packages
- [CLI Configuration](/cli/configuration/) - TOML and gadget approval
- [Gadgets Guide](/guides/gadgets/) - Library gadget docs
- [Testing Gadgets](/testing/gadget-testing/) - Test gadgets in isolation
