---
title: Gadget Ecosystem
description: Third-party gadgets and creating your own packages
---

llmist supports loading gadgets from npm packages and git repositories, enabling a rich ecosystem of reusable tools.

## Dhalsim

**Dhalsim** is the official browser automation package for llmist, providing gadgets for web navigation, screenshots, and autonomous browsing.

### Installation

```bash
# Use directly (auto-installed)
llmist agent "Navigate to apple.com" -g dhalsim

# Specific version
llmist agent "Screenshot google.com" -g dhalsim@2.0.0
```

### Available Presets

| Preset | Description | Gadgets |
|--------|-------------|---------|
| `all` | All browser automation gadgets | Full suite |
| `minimal` | Basic navigation and capture | Navigate, Screenshot, GetFullPageContent |
| `readonly` | Navigation and read-only operations | No form filling or clicking |
| `subagent` | Autonomous browser agent | BrowseWeb |

```bash
# Use a preset
llmist agent "Research topic" -g dhalsim:subagent

# Combine presets with local gadgets
llmist agent "Complex task" \
  -g dhalsim:minimal \
  -g ./my-gadget.ts
```

### Individual Gadgets

When using `dhalsim:all` or `dhalsim`, you get:

| Gadget | Description |
|--------|-------------|
| `Navigate` | Navigate to a URL |
| `Screenshot` | Capture a screenshot |
| `GetFullPageContent` | Get full page text/HTML |
| `Click` | Click an element |
| `Type` | Type into an input |
| `ScrollPage` | Scroll the page |
| `WaitForElement` | Wait for element to appear |

### BrowseWeb Subagent

The `dhalsim:subagent` preset provides **BrowseWeb**, an autonomous browser agent:

```bash
llmist agent "Find the pricing for Anthropic's API" -g dhalsim:subagent
```

BrowseWeb spawns a nested agent that:
1. Opens a browser
2. Plans a browsing strategy
3. Navigates, clicks, and extracts information
4. Returns findings to the parent agent

Example usage in code:
```typescript
// The BrowseWeb gadget is a subagent
class BrowseWeb extends Gadget({
  description: 'Browse the web autonomously to complete a task',
  schema: z.object({
    task: z.string().describe('What to accomplish'),
    startUrl: z.string().url().optional(),
  }),
}) {
  async execute(params, ctx) {
    // Spawns a nested agent with browser gadgets
    const result = await new AgentBuilder()
      .withParentContext(ctx!)
      .withModel('haiku')
      .withGadgets(Navigate, Screenshot, Click, Type)
      .askAndCollect(params.task);
    return result;
  }
}
```

## Loading from Git

Load gadgets directly from git repositories:

```bash
# Public repository
llmist agent "task" -g git+https://github.com/user/my-gadgets.git

# Specific branch/tag
llmist agent "task" -g git+https://github.com/user/my-gadgets.git#v1.0.0

# Private repository (uses git credentials)
llmist agent "task" -g git+https://github.com/org/private-gadgets.git
```

### Repository Structure

Git gadget repositories should export gadgets from their entry point:

```
my-gadgets/
├── package.json
├── index.ts          # Exports gadgets
└── src/
    ├── floppy.ts
    └── arcade.ts
```

```typescript
// index.ts
export { FloppyDisk } from './src/floppy.js';
export { ArcadeHighScore } from './src/arcade.js';
```

## Creating Your Own Package

### Package Structure

```
my-gadget-package/
├── package.json
├── index.ts
├── src/
│   ├── gadget-a.ts
│   └── gadget-b.ts
└── presets.ts        # Optional: define presets
```

### package.json

```json
{
  "name": "my-gadget-package",
  "version": "1.0.0",
  "type": "module",
  "main": "index.ts",
  "peerDependencies": {
    "llmist": "^8.0.0"
  },
  "llmist": {
    "presets": {
      "all": ["GadgetA", "GadgetB"],
      "minimal": ["GadgetA"]
    }
  }
}
```

### Exporting Gadgets

```typescript
// index.ts
import { Gadget, z } from 'llmist';

export class GadgetA extends Gadget({
  description: 'Does something useful',
  schema: z.object({
    input: z.string(),
  }),
}) {
  async execute(params: this['params']): Promise<string> {
    return `Processed: ${params.input}`;
  }
}

export class GadgetB extends Gadget({
  description: 'Does something else',
  schema: z.object({
    value: z.number(),
  }),
}) {
  execute(params: this['params']): string {
    return `Result: ${params.value * 2}`;
  }
}
```

### Defining Presets

Add presets to `package.json`:

```json
{
  "llmist": {
    "presets": {
      "all": ["GadgetA", "GadgetB", "GadgetC"],
      "core": ["GadgetA"],
      "advanced": ["GadgetB", "GadgetC"]
    }
  }
}
```

Users can then:
```bash
llmist agent "task" -g my-package:core
llmist agent "task" -g my-package:advanced
```

### Publishing to npm

```bash
npm publish
```

Users install with:
```bash
llmist agent "task" -g my-package
```

## Security Considerations

When using third-party gadgets:

1. **Review the source** - Check the repository before using
2. **Pin versions** - Use specific versions in production: `-g package@1.0.0`
3. **Use gadget approval** - Enable approval for dangerous operations:
   ```toml
   [agent]
   gadget-approval = { "*" = "approval-required" }
   ```
4. **Sandbox execution** - Consider running in isolated environments

## Combining Sources

Mix local, npm, git, and built-in gadgets:

```bash
llmist agent "Complex research task" \
  -g ./local-gadget.ts \
  -g dhalsim:minimal \
  -g builtin:ReadFile \
  -g git+https://github.com/user/my-gadgets.git
```

## See Also

- [CLI Gadgets](/cli/gadgets/local-gadgets/) - Creating local gadgets
- [CLI Configuration](/cli/configuration/toml-reference/) - Gadget approval settings
- [Subagents](/library/advanced/subagents/) - Building subagent gadgets
