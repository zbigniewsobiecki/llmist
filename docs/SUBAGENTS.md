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

## Event Forwarding

Subagents can forward their internal events (LLM calls, gadget executions) to the
parent agent using `withParentContext()`. This enables the parent to observe
subagent activity through its hooks.

### Enabling Event Forwarding

```typescript
// Inside your subagent's execute() method:
const builder = new AgentBuilder(client)
  .withModel(model)
  .withMaxIterations(maxIterations)
  .withGadgets(...this.internalGadgets)
  .withParentContext(ctx);  // Enable event forwarding

const agent = builder.ask(params.task);
```

### How It Works

1. Subagent's LLM calls and gadget executions fire hooks normally
2. `withParentContext()` intercepts these events and forwards them to the parent
3. Parent's hooks receive these events with `subagentContext` populated
4. Parent can distinguish subagent events by checking `ctx.subagentContext`

### Parent Hook Example

```typescript
const result = await LLMist.createAgent()
  .withGadgets(BrowseWeb)
  .withHooks({
    observers: {
      onLLMCallStart: (ctx) => {
        if (ctx.subagentContext) {
          // BrowseWeb's internal LLM call
          console.log(`↳ BrowseWeb LLM #${ctx.iteration}`);
        } else {
          // Main agent's LLM call
          console.log(`Main LLM #${ctx.iteration}`);
        }
      },
    },
  })
  .askAndCollect("Find pricing info");
```

### Nesting Depth

For deeply nested subagents (subagent within subagent), `depth` increments:
- Main agent events: `subagentContext` is `undefined`
- Direct child (BrowseWeb): `depth = 1`
- Grandchild (gadget inside BrowseWeb's subagent): `depth = 2`

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

  // Subagent-specific (added for subagent support)
  agentConfig?: {
    model: string;
    temperature?: number;
  };
  subagentConfig?: Record<string, Record<string, unknown>>;
}
```

## Cost Tracking

Subagents track costs at two levels:

1. **LLM calls** - Each internal completion
2. **Gadget costs** - Any paid tools used internally

These are aggregated and reported to the parent via `ctx.reportCost()`:

```typescript
// Inside subagent execution
.withHooks({
  observers: {
    onLLMCallComplete: (context) => {
      if (context.usage) {
        const inputCost = (context.usage.inputTokens || 0) * 0.000003;
        const outputCost = (context.usage.outputTokens || 0) * 0.000015;
        totalCost += inputCost + outputCost;
      }
    },
    onGadgetExecutionComplete: (context) => {
      if (context.cost && context.cost > 0) {
        totalCost += context.cost;
      }
    },
  },
})
```

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

- **[CLI Gadgets](./CLI_GADGETS.md)** - Loading gadgets from CLI
- **[Gadgets Guide](./GADGETS.md)** - Creating regular gadgets
- **[Configuration](./CONFIGURATION.md)** - CLI configuration reference
- **[Hooks Guide](./HOOKS.md)** - Tracking subagent costs with hooks
