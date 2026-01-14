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
timeoutMs = 600000      # 10 minute timeout (overrides gadget's default)

[develop.subagents.BrowseWeb]
model = "haiku"         # Override for dev
headless = false        # Show browser
timeoutMs = 0           # Disable timeout for debugging
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `model` | string | Model to use: `"inherit"` (parent's model), or a specific model ID |
| `maxIterations` | number | Maximum agent loop iterations |
| `timeoutMs` | number | Timeout in milliseconds. Overrides the gadget's hardcoded timeout. Set to `0` to disable. |
| `headless` | boolean | Browser-specific: run headless or visible |

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

:::tip[Timeout Configuration]
Subagent timeout is controlled via CLI config `[subagents.Name].timeoutMs`, not via `SubagentOptions`. The gadget's `timeoutMs` in the `Gadget({...})` config serves as the default, and can be overridden by users in their CLI config.
:::

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

With `withParentContext(ctx)`, subagents share the parent's ExecutionTree:

- **Unified event stream** - All subagent events (LLM calls, gadget executions) flow through the shared tree
- **Automatic cost aggregation** - No manual `reportCost()` needed
- **Unified progress tracking** - Parent's TUI shows nested activity in real-time
- **Hook observer support** - Parent's `onGadgetExecutionComplete` receives subagent events with `subagentContext`
- **Media collection** - Screenshots bubble up automatically
- **Logger inheritance** - Subagent uses parent's logger for consistent structured logging
- **Signal forwarding** - Abort signals propagate to nested agents

```typescript
// After subagent, get total cost
const totalCost = ctx?.tree?.getSubtreeCost(ctx.nodeId!);
```

:::tip[Subagent Events in Observers]
When a subagent runs, your parent agent's observers receive all events—both gadget and LLM calls—with `subagentContext` set:

```typescript
.withHooks({
  observers: {
    onLLMCallStart: (ctx) => {
      if (ctx.subagentContext) {
        console.log(`Subagent LLM call at depth ${ctx.subagentContext.depth}`);
      }
    },
    onGadgetExecutionComplete: (ctx) => {
      if (ctx.subagentContext) {
        console.log(`Subagent gadget: ${ctx.gadgetName} (depth ${ctx.subagentContext.depth})`);
      }
    },
  },
})
```
:::

:::note[How It Works]
The unified event flow is achieved through `tree-hook-bridge.ts`, which subscribes to ExecutionTree events and forwards them to hook observers. Both LLM events (`llm_call_start`, `llm_call_complete`, `llm_call_error`) and gadget events are bridged, ensuring identical event context (including `subagentContext`) reaches both the TUI and your custom hooks.
:::

## Human Input Inheritance

Subagents created with `createSubagent()` automatically inherit the parent's human input handler. This enables nested agents to request user input (e.g., 2FA codes, CAPTCHAs) that bubbles up to the CLI.

When the parent agent has `.onHumanInput()` configured, subagents can use gadgets that throw `HumanInputRequiredException` and the prompt will appear in the TUI:

```typescript
// In your subagent gadget (e.g., RequestUserInput)
import { Gadget, z, HumanInputRequiredException } from 'llmist';

class RequestUserAssistance extends Gadget({
  name: 'RequestUserAssistance',
  description: 'Ask user for 2FA code, CAPTCHA solution, etc.',
  schema: z.object({
    reason: z.enum(['captcha', '2fa_code', 'sms_code', 'other']),
    message: z.string(),
  }),
}) {
  execute(params: this['params']): string {
    // This bubbles up to the parent's TUI input handler
    throw new HumanInputRequiredException(
      `[${params.reason.toUpperCase()}] ${params.message}`
    );
  }
}
```

The flow works automatically:

1. Parent CLI sets `.onHumanInput()` → TUI input handler
2. `createSubagent()` sees `ctx.requestHumanInput` → calls `.onHumanInput()`
3. Nested gadget throws `HumanInputRequiredException`
4. Subagent's executor calls the inherited callback
5. User sees prompt in TUI, enters input
6. Answer returned to subagent, which continues execution

:::note
If you use the manual pattern with `getHostExports()`, you need to wire up human input explicitly:

```typescript
if (ctx?.requestHumanInput) {
  builder.onHumanInput(ctx.requestHumanInput);
}
```
:::

## Rate Limiting & Retry Inheritance

Subagents **share** rate limits and retry configuration with their parent agent. This ensures that the entire agent tree respects provider quotas.

### Shared Rate Limit Tracking

When you configure rate limits on the parent agent, all subagents share the same tracker:

```typescript
// Parent agent: 50 RPM limit
const parent = LLMist.createAgent()
  .withModel('sonnet')
  .withRateLimits({ requestsPerMinute: 50 })
  .withGadgets(BrowseWeb);

// BrowseWeb subagent shares the 50 RPM limit
// Total system throughput is capped at 50 RPM (parent + all subagents combined)
```

This ensures that your configured limits actually protect against provider rate limits, since API quotas apply to your API key—not to individual agent instances.

### How It Works

When a subagent is created via `withParentContext(ctx)` or `createSubagent()`:

1. The parent's `RateLimitTracker` instance is passed through `ExecutionContext`
2. All LLM calls from the subagent record usage to the shared tracker
3. Throttle delays are calculated based on combined parent + subagent activity
4. Retry configuration is also inherited for consistent backoff behavior

### Rate Limit Observers

When observing rate limit events, you can distinguish parent vs subagent throttling:

```typescript
.withHooks({
  observers: {
    onRateLimitThrottle: (ctx) => {
      if (ctx.subagentContext) {
        console.log(`↳ Subagent throttled (depth ${ctx.subagentContext.depth})`);
      } else {
        console.log('Main agent throttled');
      }
      console.log(`  Waiting ${ctx.delayMs}ms`);
    },
  },
})
```

### Shared Retry Configuration

Subagents inherit the parent's retry configuration automatically:

```typescript
// Parent configuration applies to all subagents
const parent = LLMist.createAgent()
  .withRetry({
    retries: 5,
    minTimeout: 2000,
    onRetry: (error, attempt) => {
      console.log(`Retry ${attempt}: ${error.message}`);
    },
  })
  .withGadgets(BrowseWeb);

// BrowseWeb subagent uses the same retry settings
// onRetry callbacks are called for both parent and subagent retries
```

## See Also

- [Execution Tree](/library/advanced/execution-tree/) - Cost and hierarchy tracking
- [Gadgets Guide](/library/guides/gadgets/) - Creating gadgets
