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
llmist agent "Find iPhone 16 Pro price on apple.com" -g webasto/BrowseWeb
```

### From Code

```typescript
import { LLMist } from 'llmist';
import { BrowseWeb } from 'webasto';

const result = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(new BrowseWeb())
  .askAndCollect('Find iPhone 16 Pro price on apple.com');
```

## Model Inheritance

By default, subagents **inherit the parent agent's model**:

```bash
# Parent uses gemini-2.5-flash → BrowseWeb also uses it
llmist agent "Find pricing" -m gemini-2.5-flash -g webasto/BrowseWeb
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

```typescript
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
    const { AgentBuilder } = getHostExports(ctx!);

    const agent = new AgentBuilder()
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

- [Execution Tree](/advanced/execution-tree/) - Cost and hierarchy tracking
- [Gadgets Guide](/guides/gadgets/) - Creating gadgets
