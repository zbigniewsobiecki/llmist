---
title: Subagents
description: Gadgets that run their own agent loops
---

Subagents are gadgets that run their own internal agent loops. Instead of a simple function, a subagent launches a complete AI agent that can use multiple tools and accomplish complex multi-step tasks autonomously.

## Why Subagents?

| Task Type | Traditional Gadgets | Subagent |
|-----------|---------------------|----------|
| "Navigate to apple.com" | Single call | - |
| "Find iPhone 16 price" | Parent coordinates 20+ calls | Single BrowseWeb call |

Subagents encapsulate complexity. The parent agent doesn't need to understand browser automation—it just asks `BrowseWeb(task="Find the price")`.

## Using Subagents

### From CLI

```bash
llmist agent "Find iPhone 16 Pro price on apple.com" -g dhalsim/BrowseWeb
```

### From Code

```typescript
import { LLMist } from 'llmist';
import { BrowseWeb } from 'dhalsim';

const result = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(new BrowseWeb())
  .askAndCollect('Find iPhone 16 Pro price on apple.com');
```

## Model Inheritance

By default, subagents **inherit the parent agent's model**:

```bash
# Parent uses gemini-2.5-flash → BrowseWeb also uses it
llmist agent "Find pricing" -m gemini-2.5-flash -g dhalsim/BrowseWeb
```

## Configuration

Configure in `~/.llmist/cli.toml`:

```toml
[subagents.BrowseWeb]
model = "inherit"       # Use parent's model
maxIterations = 20

[develop.subagents.BrowseWeb]
model = "haiku"         # Override for dev
headless = false        # Show browser
```

## Creating a Subagent

### Using createSubagent() Helper (Recommended)

The `createSubagent()` helper simplifies subagent creation by handling:
- Host exports resolution for tree sharing
- Model resolution with "inherit" support from CLI config
- Parent context sharing for cost tracking
- Logger forwarding

```typescript
import { createSubagent, Gadget, z } from 'llmist';
import type { ExecutionContext, GadgetMediaOutput } from 'llmist';

class MySubagent extends Gadget({
  name: 'MySubagent',
  description: 'Accomplishes tasks autonomously',
  schema: z.object({
    task: z.string(),
    model: z.string().optional(),
  }),
  timeoutMs: 300000,
}) {
  private internalGadgets = [Navigate, Click, Screenshot];

  async execute(
    params: this['params'],
    ctx?: ExecutionContext,
  ): Promise<{ result: string; media?: GadgetMediaOutput[] }> {
    const agent = createSubagent(ctx!, {
      name: 'MySubagent',
      gadgets: this.internalGadgets,
      model: params.model,      // Optional runtime override
      defaultModel: 'sonnet',   // Fallback if not inherited
      maxIterations: 15,
      systemPrompt: 'You are a helpful automation agent...',
    }).ask(params.task);

    let result = '';
    for await (const event of agent.run()) {
      if (event.type === 'text') result = event.content;
    }

    return {
      result,
      media: ctx?.tree?.getSubtreeMedia(ctx.nodeId!),
    };
  }
}
```

### SubagentOptions Reference

```typescript
interface SubagentOptions {
  name: string;                  // Subagent name (for config resolution)
  gadgets: AbstractGadget[];     // Gadgets to register
  systemPrompt?: string;         // System prompt
  model?: string;                // Runtime override
  defaultModel?: string;         // Fallback (default: "sonnet")
  maxIterations?: number;        // Runtime override
  defaultMaxIterations?: number; // Fallback (default: 15)
  hooks?: AgentHooks;            // Observer/interceptor hooks
  temperature?: number;          // LLM temperature
}
```

### Manual Pattern (Advanced)

For full control, use `getHostExports()` directly:

```typescript
import { getHostExports, Gadget, z } from 'llmist';
import type { ExecutionContext } from 'llmist';

class MySubagent extends Gadget({
  name: 'MySubagent',
  description: 'Accomplishes tasks autonomously',
  schema: z.object({
    task: z.string(),
    model: z.string().optional(),
  }),
  timeoutMs: 300000,
}) {
  async execute(params: this['params'], ctx?: ExecutionContext) {
    const { AgentBuilder, LLMist } = getHostExports(ctx!);
    const client = new LLMist();

    const agent = new AgentBuilder(client)
      .withParentContext(ctx!)  // Share tree for cost tracking
      .withModel(params.model ?? ctx?.agentConfig?.model ?? 'sonnet')
      .withGadgets(...this.internalGadgets)
      .ask(params.task);

    let result = '';
    for await (const event of agent.run()) {
      if (event.type === 'text') result = event.content;
    }

    return {
      result,
      media: ctx?.tree?.getSubtreeMedia(ctx.nodeId!),
    };
  }
}
```

### Checking Host Exports Availability

Use `hasHostExports()` for conditional logic when gadgets may run standalone:

```typescript
import { hasHostExports, createSubagent } from 'llmist';

async execute(params: this['params'], ctx?: ExecutionContext) {
  if (!hasHostExports(ctx)) {
    return 'Error: This gadget requires running via llmist agent';
  }

  const agent = createSubagent(ctx!, { ... });
  // ...
}
```

## ExecutionTree Integration

With `withParentContext(ctx)`, subagents share the parent's tree:

- **Automatic cost aggregation** - No manual `reportCost()` needed
- **Unified progress tracking** - Parent's TUI shows nested activity
- **Media collection** - Screenshots bubble up automatically

```typescript
// After subagent, get total cost
const totalCost = ctx?.tree?.getSubtreeCost(ctx.nodeId!);
```

## See Also

- [Execution Tree](/library/advanced/execution-tree/) - Cost and hierarchy tracking
- [Gadgets Guide](/library/guides/gadgets/) - Creating gadgets
