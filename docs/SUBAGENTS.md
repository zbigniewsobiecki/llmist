# Subagents

Subagents are gadgets that run their own internal agent loops. Instead of executing a simple function and returning a result, a subagent launches a complete AI agent that can use multiple tools, make decisions, and accomplish complex multi-step tasks autonomously.

## Why Subagents?

Traditional gadgets excel at single operations: "read this file", "call this API", "run this command". But some tasks require **autonomous decision-making**:

| Task Type | Traditional Gadgets | Subagent |
|-----------|---------------------|----------|
| "Navigate to apple.com" | Single Navigate call | - |
| "Find iPhone 16 price" | Multiple calls orchestrated by parent | Single BrowseWeb call |
| "Research competitors" | Parent coordinates 20+ calls | BrowseWeb handles it internally |

Subagents encapsulate complexity. The parent agent doesn't need to understand browser automation, cookie consent, or anti-bot detection - it just asks `BrowseWeb(task="Find the price")`.

## Using Subagents

### From the CLI

```bash
# Load BrowseWeb subagent from webasto package
llmist agent "Find iPhone 16 Pro price on apple.com" -g webasto/BrowseWeb

# Combine with other gadgets
llmist agent "Research topic and save to file" \
  -g webasto:subagent \
  -g builtin:WriteFile
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

By default, subagents **inherit the parent agent's model**. This ensures consistent behavior and cost management:

```bash
# Parent uses gemini-2.5-flash → BrowseWeb also uses gemini-2.5-flash
llmist agent "Find pricing info" -m gemini-2.5-flash -g webasto/BrowseWeb
```

### Inheritance Chain

```
Parent Agent (gemini-2.5-flash)
    └── BrowseWeb (inherits → gemini-2.5-flash)
            └── Navigate, Click, Fill... (no model, just tools)
```

## Configuration

Subagents can be configured at three levels, with later levels overriding earlier ones:

1. **Package defaults** - Hardcoded in the subagent (fallback only)
2. **Global config** - `[subagents]` section in cli.toml
3. **Profile config** - `[profile.subagents]` section
4. **Runtime params** - Explicit parameters in the gadget call

### Global Subagent Configuration

Configure defaults for all profiles in `~/.llmist/cli.toml`:

```toml
# Global subagent configuration
[subagents]
default-model = "inherit"              # Default for all subagents

# Per-subagent global configuration
[subagents.BrowseWeb]
model = "inherit"                      # Use parent agent's model
maxIterations = 20                     # More iterations than default (15)
headless = true                        # Run browser headless
```

### Profile-Level Overrides

Override subagent settings for specific profiles:

```toml
# Research profile - uses fast model, subagent inherits it
[research]
inherits = "profile-research"
model = "gemini-2.5-flash"

[research.subagents.BrowseWeb]
maxIterations = 30                     # More iterations for thorough research
headless = true

# Development profile - shows browser for debugging
[develop]
inherits = "profile-readwrite"
model = "sonnet"

[develop.subagents.BrowseWeb]
model = "haiku"                        # Override: use cheaper model
headless = false                       # Show browser for debugging
```

### Resolution Priority

Configuration is resolved in this order (highest priority first):

1. **Runtime params** - `BrowseWeb(model="opus", maxIterations=5)`
2. **Profile subagent config** - `[research.subagents.BrowseWeb]`
3. **Global subagent config** - `[subagents.BrowseWeb]`
4. **Global default** - `[subagents] default-model = "inherit"`
5. **Parent agent model** - When any level specifies `"inherit"`
6. **Package default** - Hardcoded fallback (e.g., "sonnet")

### The "inherit" Keyword

Use `"inherit"` to explicitly inherit from the parent agent:

```toml
# Even if global default is "haiku", research profile inherits parent
[research.subagents.BrowseWeb]
model = "inherit"                      # Inherits research profile's model
```

## Available Subagents

### BrowseWeb (webasto)

High-level browser automation subagent:

```bash
# Install/use from webasto package
llmist agent "Find product info" -g webasto/BrowseWeb

# Or use the subagent preset (just BrowseWeb)
llmist agent "Research topic" -g webasto:subagent
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `task` | string | The task to accomplish |
| `url` | string | Starting URL |
| `model` | string? | Model override (default: inherit) |
| `maxIterations` | number? | Max steps (default: 15) |
| `headless` | boolean? | Headless mode (default: true) |

**Example call by the LLM:**

```
!!!GADGET_START:BrowseWeb
!!!ARG:task
Find the current price of iPhone 16 Pro 256GB
!!!ARG:url
https://apple.com
!!!GADGET_END
```

**Returns:**

```typescript
{
  result: "The iPhone 16 Pro 256GB is priced at $999...",
  media: [{ type: "image/png", data: "...", description: "Screenshot" }]
}
```

## ExecutionTree Integration

**New in v6.1.0:** Subagents now use the ExecutionTree as the single source of truth for execution tracking. When you use `withParentContext(ctx)`, the subagent shares the parent's tree, enabling:

- **Automatic cost aggregation** - No manual `reportCost()` needed
- **Unified progress tracking** - Parent's TUI shows nested subagent activity
- **Media collection** - Screenshots and files from subagents automatically bubble up

### How Tree Sharing Works

```typescript
// Inside your subagent's execute() method:
const builder = new AgentBuilder(client)
  .withModel(model)
  .withGadgets(...this.internalGadgets)
  .withParentContext(ctx);  // Shares parent's ExecutionTree

const agent = builder.ask(params.task);
```

When `withParentContext(ctx)` is called:
1. The subagent receives the parent's `ExecutionTree` via `ctx.tree`
2. All subagent LLM calls and gadgets become children of the parent gadget node
3. Costs are automatically tracked in the tree
4. Parent can query `tree.getSubtreeCost(nodeId)` to get total subagent cost

### Querying Subagent Metrics

After a subagent completes, use tree methods to get aggregated data:

```typescript
async execute(params: this['params'], ctx?: ExecutionContext) {
  // Run subagent...
  for await (const event of agent.run()) {
    // Process events
  }

  // Get aggregated metrics from tree
  const totalCost = ctx?.tree?.getSubtreeCost(ctx.nodeId!);
  const allMedia = ctx?.tree?.getSubtreeMedia(ctx.nodeId!);
  const tokenUsage = ctx?.tree?.getSubtreeTokens(ctx.nodeId!);

  return {
    result: finalResult,
    media: allMedia,  // Return collected media to parent
    // Note: cost is already tracked in tree, no need to report manually
  };
}
```

### Parent Hook Example

```typescript
const result = await LLMist.createAgent()
  .withGadgets(BrowseWeb)
  .withHooks({
    observers: {
      onLLMCallStart: (ctx) => {
        const depth = ctx.tree?.getNode(ctx.nodeId)?.depth ?? 0;
        const indent = '  '.repeat(depth);
        console.log(`${indent}LLM #${ctx.iteration} starting...`);
      },
      onGadgetExecutionComplete: (ctx) => {
        const node = ctx.tree?.getNode(ctx.nodeId);
        if (node?.type === 'gadget' && node.isSubagent) {
          const subtreeCost = ctx.tree?.getSubtreeCost(ctx.nodeId);
          console.log(`Subagent ${ctx.gadgetName} cost: $${subtreeCost?.toFixed(4)}`);
        }
      },
    },
  })
  .askAndCollect("Find pricing info");
```

### Nesting Depth

The `depth` field indicates nesting level:
- `depth = 0`: Root level (main agent's LLM calls and gadgets)
- `depth = 1`: Direct child (subagent's LLM calls, gadgets inside subagent)
- `depth = 2+`: Deeper nesting (subagent within subagent)

## Creating a Subagent

Subagents are gadgets that spawn an internal `AgentBuilder`:

```typescript
import { Gadget, z, AgentBuilder, LLMist } from 'llmist';
import type { ExecutionContext, GadgetMediaOutput } from 'llmist';

export class MySubagent extends Gadget({
  name: 'MySubagent',
  description: 'Accomplishes complex tasks autonomously',
  schema: z.object({
    task: z.string().describe('The task to accomplish'),
    model: z.string().optional().describe('Model override'),
    maxIterations: z.number().optional().describe('Max iterations'),
  }),
  timeoutMs: 300000, // 5 minutes
}) {
  async execute(
    params: this['params'],
    ctx?: ExecutionContext,
  ): Promise<{ result: string; media?: GadgetMediaOutput[] }> {
    // 1. Resolve configuration from context
    const subagentConfig = ctx?.subagentConfig?.MySubagent ?? {};
    const parentModel = ctx?.agentConfig?.model;

    const model = params.model
      ?? (subagentConfig.model as string | undefined)
      ?? parentModel
      ?? 'sonnet';

    const maxIterations = params.maxIterations
      ?? (subagentConfig.maxIterations as number | undefined)
      ?? 15;

    // 2. Create internal agent with resolved config
    const client = new LLMist();
    const builder = new AgentBuilder(client)
      .withModel(model)
      .withSystem('You are a helpful assistant...')
      .withMaxIterations(maxIterations)
      .withGadgets(...this.internalGadgets);

    // 3. Pass abort signal for cancellation support
    if (ctx?.signal) {
      builder.withSignal(ctx.signal);
    }

    const agent = builder.ask(params.task);

    // 4. Run the subagent loop
    let finalResult = '';
    const collectedMedia: GadgetMediaOutput[] = [];
    let totalCost = 0;

    for await (const event of agent.run()) {
      if (ctx?.signal?.aborted) break;

      if (event.type === 'text') {
        finalResult = event.content;
      } else if (event.type === 'gadget_result') {
        if (event.result.media) {
          collectedMedia.push(...event.result.media);
        }
      }
    }

    // 5. Report costs to parent
    if (totalCost > 0 && ctx?.reportCost) {
      ctx.reportCost(totalCost);
    }

    return {
      result: finalResult || 'Task completed',
      media: collectedMedia.length > 0 ? collectedMedia : undefined,
    };
  }

  private get internalGadgets() {
    // Return the gadgets this subagent uses internally
    return [/* your gadgets */];
  }
}
```

### Key Implementation Points

1. **Read from `ctx.subagentConfig`** - Contains resolved config from cli.toml
2. **Read from `ctx.agentConfig`** - Contains parent's model for inheritance
3. **Pass abort signal** - Enables graceful cancellation
4. **Report costs** - Use `ctx.reportCost()` for accurate cost tracking
5. **Return media** - Screenshots and other outputs are passed to parent

### ExecutionContext for Subagents

The `ExecutionContext` provides subagent-specific information:

```typescript
interface ExecutionContext {
  // Standard gadget context
  reportCost(amount: number): void;
  signal: AbortSignal;
  llmist?: CostReportingLLMist;

  // Subagent-specific
  agentConfig?: {
    model: string;
    temperature?: number;
  };
  subagentConfig?: Record<string, Record<string, unknown>>;

  // ExecutionTree integration (v6.1.0+)
  tree?: ExecutionTree;     // Shared execution tree
  nodeId?: NodeId;          // This gadget's node ID in the tree
  depth?: number;           // Nesting depth (0 = root)

  // External gadget support (v6.2.0+)
  hostExports?: HostExports; // Host llmist exports
}
```

## External Gadget Subagents

**New in v6.2.0:** External gadgets (from npm packages or git URLs) must use `getHostExports(ctx)` to access llmist classes. This solves the "dual-package problem" where external packages have their own `node_modules/llmist` that's incompatible with the host CLI's version.

### Why This Matters

When an external gadget imports `AgentBuilder` directly from `'llmist'`, it gets a different class instance than the CLI's `AgentBuilder`. This breaks tree sharing because `withParentContext(ctx)` can't properly link the trees.

### The Solution: getHostExports()

```typescript
import { getHostExports, Gadget, z } from 'llmist';
import type { ExecutionContext, GadgetMediaOutput } from 'llmist';

export class BrowseWeb extends Gadget({
  name: 'BrowseWeb',
  description: 'Browse websites autonomously',
  schema: z.object({
    task: z.string().describe('The browsing task to accomplish'),
    url: z.string().describe('Starting URL'),
  }),
  timeoutMs: 300000,
}) {
  async execute(
    params: this['params'],
    ctx?: ExecutionContext,
  ): Promise<{ result: string; media?: GadgetMediaOutput[] }> {
    // IMPORTANT: Use host's AgentBuilder, not imported one!
    const { AgentBuilder } = getHostExports(ctx!);

    const agent = new AgentBuilder()
      .withParentContext(ctx!)  // Tree sharing works correctly
      .withModel(ctx?.agentConfig?.model ?? 'haiku')
      .withGadgets(Navigate, Click, Screenshot)
      .ask(params.task);

    let result = '';
    for await (const event of agent.run()) {
      if (event.type === 'text') {
        result = event.content;
      }
    }

    // Collect media from subtree (automatic with tree sharing)
    const media = ctx?.tree?.getSubtreeMedia(ctx.nodeId!);

    return { result, media };
  }
}
```

### What getHostExports() Returns

```typescript
interface HostExports {
  AgentBuilder: typeof AgentBuilder;  // For creating subagents
  Gadget: typeof Gadget;              // For defining gadgets
  createGadget: typeof createGadget;  // Functional gadget creation
  ExecutionTree: typeof ExecutionTree;// For tree operations
  LLMist: typeof LLMist;              // LLM client
  z: typeof z;                        // Zod schemas
}
```

### When to Use getHostExports()

| Context | Use getHostExports()? |
|---------|----------------------|
| External npm package gadget | **Yes** - Required |
| External git URL gadget | **Yes** - Required |
| Local file gadget (`-g ./my-gadget.ts`) | No - Uses same llmist instance |
| Gadget in same project as agent | No - Uses same llmist instance |

## Cost Tracking

**Automatic with ExecutionTree (v6.2.0+):** When using `withParentContext(ctx)`, costs are automatically tracked in the shared ExecutionTree. No manual aggregation needed.

```typescript
// After subagent completes, get total cost from tree:
const totalCost = ctx?.tree?.getSubtreeCost(ctx.nodeId!);
```

The tree automatically tracks:
- **LLM call costs** - Calculated using model registry pricing
- **Gadget costs** - From `ctx.reportCost()` or return values

### Legacy: Manual Cost Aggregation

For backwards compatibility, you can still manually aggregate costs:

```typescript
// Manual approach (no longer necessary with tree sharing)
let totalCost = 0;

const agent = new AgentBuilder()
  .withParentContext(ctx)
  .withHooks({
    observers: {
      onLLMCallComplete: (context) => {
        if (context.cost) totalCost += context.cost;
      },
      onGadgetExecutionComplete: (context) => {
        if (context.cost) totalCost += context.cost;
      },
    },
  })
  .ask(task);

// Then report to parent
ctx?.reportCost(totalCost);
```

**Note:** With ExecutionTree, this manual approach is redundant—the tree already tracks all costs.

## Best Practices

### When to Use Subagents

| Use Case | Example |
|----------|---------|
| Multi-step web interactions | Login, navigate, extract data |
| Complex research | Find info across multiple pages |
| Autonomous decision-making | Handle popups, errors, redirects |
| Domain expertise encapsulation | Browser automation, API orchestration |

### When NOT to Use Subagents

| Use Case | Better Alternative |
|----------|-------------------|
| Single API call | Regular gadget |
| File read/write | Builtin gadgets |
| Simple transformations | Regular gadget |
| Quick lookups | Regular gadget |

### Configuration Tips

```toml
# Good: Use inherit for flexibility
[subagents.BrowseWeb]
model = "inherit"
maxIterations = 20

# Good: Override for specific use cases
[research.subagents.BrowseWeb]
maxIterations = 50        # Deep research needs more iterations

# Avoid: Hardcoding expensive models globally
[subagents.BrowseWeb]
model = "opus"            # Will use opus even for simple tasks
```

### Performance Considerations

1. **Subagents add latency** - Multiple LLM round-trips
2. **Cost compounds** - Each iteration has LLM costs
3. **Set appropriate timeouts** - 5 minutes is typical for browser tasks
4. **Limit iterations** - Prevent runaway loops

## Debugging Subagents

### Enable Verbose Logging

```bash
llmist agent "task" -g webasto/BrowseWeb --log-level debug
```

### Non-Headless Mode

```toml
[develop.subagents.BrowseWeb]
headless = false          # Watch the browser
```

### Lower Iteration Limits

```toml
[develop.subagents.BrowseWeb]
maxIterations = 5         # Quick iteration during development
```

## See Also

- **[Execution Tree](./EXECUTION_TREE.md)** - Tracking costs and execution hierarchy
- **[Gadgets Guide](./GADGETS.md)** - Creating regular gadgets and ExecutionContext
- **[CLI Gadgets](./CLI_GADGETS.md)** - Loading gadgets from CLI
- **[Configuration](./CONFIGURATION.md)** - CLI configuration reference
- **[Hooks Guide](./HOOKS.md)** - Lifecycle hooks for monitoring
