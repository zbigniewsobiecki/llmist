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

```bash
# Interactive mode - user can respond
llmist agent "Interview me" --gadget ./ask-user.ts
```

## Break Loop Gadget

Stop the agent loop:

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

## External Gadgets (npm/git)

Load gadgets from npm packages or git repositories. Packages are auto-installed to `~/.llmist/gadget-cache/`.

### npm Packages

```bash
# All gadgets from package
llmist agent "Navigate to apple.com" -g webasto

# Specific version
llmist agent "Screenshot google.com" -g webasto@2.0.0

# Preset (subset of gadgets)
llmist agent "Browse the web" -g webasto:minimal

# Single gadget
llmist agent "Go to example.com" -g webasto/Navigate

# Version + preset
llmist agent "Take screenshots" -g webasto@2.0.0:readonly
```

### git URLs

```bash
# Clone and use gadgets from git
llmist agent "task" -g git+https://github.com/user/repo.git

# With specific ref (tag, branch, commit)
llmist agent "task" -g git+https://github.com/user/repo.git#v1.0.0
```

### Combining Sources

```bash
# Mix local files, npm packages, git URLs, and builtins
llmist agent "Complex task" \
  -g ./local-gadget.ts \
  -g webasto:minimal \
  -g builtin:ReadFile \
  -g git+https://github.com/user/my-gadgets.git
```

### Presets

External packages can define presets - named subsets of gadgets for common use cases:

```bash
# webasto presets:
# - all: All 26+ browser automation gadgets
# - minimal: Navigate, Screenshot, GetFullPageContent
# - readonly: Navigation and read-only operations
# - subagent: BrowseWeb (high-level autonomous browser)

llmist agent "Research task" -g webasto:subagent
```

### Subagents

Some packages export **subagents** - gadgets that run their own agent loop internally:

```bash
# BrowseWeb is a subagent that handles web browsing autonomously
llmist agent "Find iPhone 16 Pro price on apple.com" -g webasto/BrowseWeb
```

The subagent launches its own browser, navigates, clicks, and extracts data without requiring you to orchestrate individual browser operations.

### Subagent Configuration

Subagents like `BrowseWeb` can be configured via `cli.toml`. By default, subagents **inherit the parent agent's model** - no configuration needed!

#### Global Subagent Defaults

Configure subagent behavior for all profiles:

```toml
# ~/.llmist/cli.toml

# Global subagent configuration
[subagents]
default-model = "inherit"              # Default: inherit from parent agent

# Per-subagent configuration
[subagents.BrowseWeb]
model = "inherit"                      # Use parent agent's model
maxIterations = 20                     # More iterations than default (15)
headless = true                        # Run browser headless
```

#### Profile-Specific Overrides

Override subagent settings per profile:

```toml
[research]
inherits = "profile-research"
model = "gemini-2.5-flash"             # Parent model for this profile

# BrowseWeb will inherit gemini-2.5-flash
[research.subagents.BrowseWeb]
maxIterations = 30                     # More iterations for research
headless = true

[develop]
inherits = "profile-readwrite"
model = "sonnet"

# Override: use cheaper model for dev browsing
[develop.subagents.BrowseWeb]
model = "haiku"                        # Explicit model (doesn't inherit)
headless = false                       # Show browser for debugging
```

#### Resolution Priority

Subagent configuration resolves in this order (highest to lowest):

1. **Runtime params** - Explicit gadget call: `BrowseWeb(model="opus", ...)`
2. **Profile subagent config** - `[profile.subagents.BrowseWeb]`
3. **Global subagent config** - `[subagents.BrowseWeb]`
4. **Global default** - `[subagents] default-model`
5. **Parent agent model** - If any level specifies `"inherit"`
6. **Package default** - Hardcoded in the subagent

### Cache Management

External packages are cached in `~/.llmist/gadget-cache/`:

```
~/.llmist/gadget-cache/
├── npm/
│   └── webasto@latest/
└── git/
    └── github.com-user-repo-v1.0.0/
```

To force reinstallation, delete the cached directory.

### Creating External Gadget Packages

To publish your own gadget package, add an `llmist` field to `package.json`:

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

See **[External Gadgets Example](../examples/20-external-gadgets.ts)** for more details.

## See Also

- **[CLI Reference](./CLI.md)** - Full CLI docs
- **[Gadgets Guide](./GADGETS.md)** - Library gadget docs
- **[Human-in-the-Loop](./HUMAN_IN_LOOP.md)** - Interactive workflows
- **[External Gadgets Example](../examples/20-external-gadgets.ts)** - Detailed examples
