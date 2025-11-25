# CLI Gadgets

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
  --gadget ./weather.ts \
  --gadget ./utils.ts
```

Or export multiple from one file:

```typescript
// tools.ts
export class Calculator extends Gadget({ ... }) { ... }
export class Weather extends Gadget({ ... }) { ... }
export class Logger extends Gadget({ ... }) { ... }
```

```bash
llmist agent "Do stuff" --gadget ./tools.ts
```

## Async Gadgets

Async gadgets work normally:

```typescript
export class FetchData extends Gadget({
  description: 'Fetches data from URL',
  schema: z.object({ url: z.string().url() }),
  timeoutMs: 30000,
}) {
  async execute(params: this['params']): Promise<string> {
    const response = await fetch(params.url);
    const data = await response.text();
    return data.slice(0, 1000); // Truncate for LLM
  }
}
```

## Human Input Gadget

Create interactive gadgets:

```typescript
import { Gadget, HumanInputException, z } from 'llmist';

export class AskUser extends Gadget({
  description: 'Ask the user a question',
  schema: z.object({ question: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new HumanInputException(params.question);
  }
}
```

```bash
# Interactive mode - user can respond
llmist agent "Interview me" --gadget ./ask-user.ts
```

## Break Loop Gadget

Stop the agent loop:

```typescript
import { Gadget, BreakLoopException, z } from 'llmist';

export class Done extends Gadget({
  description: 'Call when task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params: this['params']): string {
    throw new BreakLoopException(params.summary);
  }
}
```

## File Paths

Relative and absolute paths work:

```bash
# Relative to current directory
llmist agent "task" --gadget ./tools/calculator.ts

# Absolute path
llmist agent "task" --gadget /home/user/gadgets/calculator.ts

# From node_modules (if published)
llmist agent "task" --gadget my-gadget-package
```

## Gadget Output

Gadget results appear on stderr:

```
[llmist] gadget=Calculator | time=2ms | result=345
```

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
    return content.slice(0, 5000); // Limit for LLM context
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

### Shell Command

```typescript
import { execSync } from 'child_process';

export class Shell extends Gadget({
  description: 'Execute shell command',
  schema: z.object({
    command: z.string().describe('Shell command to run'),
  }),
  timeoutMs: 60000,
}) {
  execute(params: this['params']): string {
    const output = execSync(params.command, {
      encoding: 'utf-8',
      timeout: 55000,
    });
    return output.slice(0, 10000);
  }
}
```

## See Also

- **[CLI Reference](./CLI.md)** - Full CLI docs
- **[Gadgets Guide](./GADGETS.md)** - Library gadget docs
- **[Human-in-the-Loop](./HUMAN_IN_LOOP.md)** - Interactive workflows
