# Execution Tree

The Execution Tree is a first-class model for tracking all LLM calls, gadget executions, and their hierarchical relationships. It provides the single source of truth for execution state, enabling automatic cost aggregation, media collection, and real-time progress tracking—especially valuable when working with nested subagents.

## Overview

When you run an agent, llmist creates an `ExecutionTree` that records:

- **LLM calls** - Each iteration of the agent loop
- **Gadget executions** - Tools called by the LLM
- **Hierarchical relationships** - Which gadgets spawned subagent LLM calls
- **Metrics** - Costs, token usage, execution times, media outputs

```
ExecutionTree
├── LLM Call #1 (sonnet, 1,200 tokens, $0.003)
│   ├── Gadget: ReadFile (/foo.txt, 12ms)
│   └── Gadget: BrowseWeb (subagent)
│       ├── LLM Call #1 (haiku, 800 tokens, $0.001)
│       │   ├── Gadget: Navigate (apple.com)
│       │   └── Gadget: Screenshot
│       └── LLM Call #2 (haiku, 600 tokens, $0.0008)
│           └── Gadget: Click (Buy button)
└── LLM Call #2 (sonnet, 900 tokens, $0.002)
    └── Gadget: WriteFile (result.txt)
```

## Quick Start

The tree is automatically created and managed by the agent. Access it through hooks or after completion:

```typescript
import { LLMist } from 'llmist';

const result = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(ReadFile, WriteFile)
  .withHooks({
    observers: {
      onAgentComplete: (ctx) => {
        // Access the tree after agent completes
        const tree = ctx.tree;

        console.log(`Total cost: $${tree.getTotalCost().toFixed(4)}`);
        console.log(`Total tokens: ${JSON.stringify(tree.getTotalTokens())}`);
        console.log(`Node count: ${JSON.stringify(tree.getNodeCount())}`);
      },
    },
  })
  .askAndCollect('Read config.json and summarize it');
```

## Node Types

### LLMCallNode

Represents a single LLM API call:

```typescript
interface LLMCallNode {
  id: NodeId;
  type: "llm_call";
  parentId: NodeId | null;      // Parent gadget (for subagents)
  depth: number;                 // 0 = root, 1 = inside subagent, etc.
  path: NodeId[];               // Path from root to this node

  iteration: number;            // Agent loop iteration (1-indexed)
  model: string;                // Model identifier
  request?: LLMMessage[];       // Request messages
  response: string;             // Accumulated response text
  usage?: TokenUsage;           // Token counts (input, output, cached)
  finishReason?: string;        // "stop", "tool_use", etc.
  cost?: number;                // Cost in USD

  children: NodeId[];           // Child gadget nodes
  createdAt: number;            // Timestamp
  completedAt: number | null;   // Null while in progress
}
```

### GadgetNode

Represents a gadget execution:

```typescript
interface GadgetNode {
  id: NodeId;
  type: "gadget";
  parentId: NodeId | null;      // Parent LLM call
  depth: number;
  path: NodeId[];

  invocationId: string;         // LLM-generated or auto ID
  name: string;                 // Gadget name
  parameters: Record<string, unknown>;
  dependencies: string[];       // IDs of gadgets this depends on
  state: GadgetState;           // "pending" | "running" | "completed" | "failed" | "skipped"
  result?: string;              // Result string (if completed)
  error?: string;               // Error message (if failed/skipped)
  executionTimeMs?: number;     // Execution time
  cost?: number;                // Cost in USD
  media?: GadgetMediaOutput[];  // Images, audio, etc.

  children: NodeId[];           // Child LLM calls (for subagents)
  isSubagent: boolean;          // True if has nested LLM calls
  createdAt: number;
  completedAt: number | null;
}
```

## Query Methods

### Basic Queries

```typescript
// Get a specific node
const node = tree.getNode("llm_1");

// Get gadget by invocation ID
const gadget = tree.getNodeByInvocationId("gc_readfile_1");

// Get all root nodes
const roots = tree.getRoots();

// Get children of a node
const children = tree.getChildren("llm_1");

// Get ancestors (root to parent)
const ancestors = tree.getAncestors("gadget_xyz");

// Get all descendants
const descendants = tree.getDescendants("llm_1");

// Get only gadget descendants
const gadgets = tree.getDescendants("llm_1", "gadget");
```

### Aggregation Methods

These are particularly useful for subagent cost tracking:

```typescript
// Total cost for entire tree
const totalCost = tree.getTotalCost();

// Cost for a subtree (node + all descendants)
// Perfect for getting a subagent gadget's total cost
const subtreeCost = tree.getSubtreeCost(gadgetNodeId);

// Total tokens for entire tree
const tokens = tree.getTotalTokens();
// { input: 5000, output: 1200, cached: 800 }

// Tokens for a subtree
const subtreeTokens = tree.getSubtreeTokens(gadgetNodeId);

// Collect all media from a subtree
const media = tree.getSubtreeMedia(gadgetNodeId);

// Check if a subtree is complete
const isDone = tree.isSubtreeComplete(gadgetNodeId);

// Get node counts
const counts = tree.getNodeCount();
// { llmCalls: 5, gadgets: 12 }
```

## Event Subscription

Subscribe to tree changes in real-time:

```typescript
// Subscribe to specific event type
const unsubscribe = tree.on("gadget_complete", (event) => {
  if (event.type === "gadget_complete") {
    console.log(`${event.name} completed in ${event.executionTimeMs}ms`);
    if (event.cost) {
      console.log(`  Cost: $${event.cost.toFixed(4)}`);
    }
  }
});

// Subscribe to all events
tree.onAll((event) => {
  console.log(`[${event.type}] depth=${event.depth}`);
});

// Unsubscribe when done
unsubscribe();
```

### Event Types

| Event Type | Description |
|------------|-------------|
| `llm_call_start` | LLM call begins |
| `llm_call_stream` | Text chunk received |
| `llm_call_complete` | LLM call finished |
| `llm_call_error` | LLM call failed |
| `gadget_call` | Gadget parsed from stream |
| `gadget_start` | Gadget execution begins |
| `gadget_complete` | Gadget finished successfully |
| `gadget_error` | Gadget failed |
| `gadget_skipped` | Gadget skipped (dependency failed) |
| `text` | Text content emitted |

### Async Event Iteration

```typescript
// Iterate over events as they occur
for await (const event of tree.events()) {
  switch (event.type) {
    case "llm_call_complete":
      console.log(`LLM #${event.iteration}: ${event.usage?.totalTokens} tokens`);
      break;
    case "gadget_complete":
      console.log(`${event.name}: ${event.result?.slice(0, 50)}...`);
      break;
  }
}
```

## Subagent Integration

The ExecutionTree enables seamless subagent support through tree sharing. When a subagent gadget uses `withParentContext(ctx)`, it shares the parent's tree:

```typescript
class BrowseWeb extends Gadget({
  description: 'Browse websites autonomously',
  schema: z.object({
    task: z.string(),
    url: z.string(),
  }),
}) {
  async execute(params: this['params'], ctx?: ExecutionContext) {
    const { AgentBuilder } = getHostExports(ctx!);

    // Create subagent that shares parent's tree
    const agent = new AgentBuilder()
      .withParentContext(ctx!)  // <-- Key: shares tree automatically
      .withModel('haiku')
      .withGadgets(Navigate, Click, Screenshot)
      .ask(`${params.task} starting at ${params.url}`);

    let result = '';
    for await (const event of agent.run()) {
      if (event.type === 'text') {
        result = event.content;
      }
    }

    // After subagent completes, get aggregated metrics from tree
    const subtreeCost = ctx?.tree?.getSubtreeCost(ctx.nodeId!);
    const subtreeMedia = ctx?.tree?.getSubtreeMedia(ctx.nodeId!);

    return {
      result,
      media: subtreeMedia,
      // Cost is automatically tracked in tree, no need to report manually
    };
  }
}
```

### How Tree Sharing Works

1. **Parent creates tree** - When the main agent starts, it creates an ExecutionTree
2. **Gadget receives context** - The gadget's `execute()` gets an `ExecutionContext` with `tree` and `nodeId`
3. **Subagent shares tree** - `withParentContext(ctx)` passes the tree to the subagent
4. **Nodes are nested** - Subagent LLM calls become children of the gadget node
5. **Costs aggregate** - `getSubtreeCost(nodeId)` includes all nested costs

## Example: Custom Progress Display

Build a real-time progress display using tree events:

```typescript
import { LLMist, HookPresets } from 'llmist';

async function runWithProgress(prompt: string) {
  let currentLLMCall = '';
  let gadgetCount = 0;
  let totalCost = 0;

  const result = await LLMist.createAgent()
    .withModel('sonnet')
    .withGadgets(ReadFile, WriteFile, BrowseWeb)
    .withHooks({
      observers: {
        onLLMCallStart: (ctx) => {
          currentLLMCall = `LLM #${ctx.iteration}`;
          const depth = ctx.tree?.getNode(ctx.nodeId)?.depth ?? 0;
          const indent = '  '.repeat(depth);
          console.log(`${indent}→ ${currentLLMCall} starting...`);
        },
        onLLMCallComplete: (ctx) => {
          const depth = ctx.tree?.getNode(ctx.nodeId)?.depth ?? 0;
          const indent = '  '.repeat(depth);
          const cost = ctx.tree?.getNode(ctx.nodeId)?.cost ?? 0;
          totalCost += cost;
          console.log(`${indent}✓ ${currentLLMCall} (${ctx.usage?.totalTokens} tokens, $${cost.toFixed(4)})`);
        },
        onGadgetExecutionStart: (ctx) => {
          const depth = ctx.tree?.getNode(ctx.nodeId)?.depth ?? 0;
          const indent = '  '.repeat(depth);
          console.log(`${indent}  ⚡ ${ctx.gadgetName}...`);
        },
        onGadgetExecutionComplete: (ctx) => {
          gadgetCount++;
          const depth = ctx.tree?.getNode(ctx.nodeId)?.depth ?? 0;
          const indent = '  '.repeat(depth);
          const node = ctx.tree?.getNode(ctx.nodeId);
          const isSubagent = node?.type === 'gadget' && node.isSubagent;

          if (isSubagent) {
            const subtreeCost = ctx.tree?.getSubtreeCost(ctx.nodeId) ?? 0;
            console.log(`${indent}  ✓ ${ctx.gadgetName} (subagent, $${subtreeCost.toFixed(4)} total)`);
          } else {
            console.log(`${indent}  ✓ ${ctx.gadgetName} (${ctx.executionTimeMs}ms)`);
          }
        },
        onAgentComplete: (ctx) => {
          console.log('\n─────────────────────────');
          console.log(`Total: ${gadgetCount} gadgets, $${ctx.tree?.getTotalCost().toFixed(4)}`);
          console.log(`Tokens: ${JSON.stringify(ctx.tree?.getTotalTokens())}`);
        },
      },
    })
    .askAndCollect(prompt);

  return result;
}
```

## See Also

- **[Subagents](./SUBAGENTS.md)** - Creating gadgets that run internal agent loops
- **[Gadgets](./GADGETS.md)** - ExecutionContext fields (`tree`, `nodeId`, `depth`)
- **[Hooks](./HOOKS.md)** - Lifecycle hooks for monitoring execution
- **[Streaming](./STREAMING.md)** - Event handling patterns
