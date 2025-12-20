---
title: Quick Start
description: Build your first AI agent in minutes
---

Build AI agents with any LLM provider in minutes.

## Your First Agent

```typescript
import { LLMist, Gadget, z } from 'llmist';

// 1. Define a tool (called "gadget" in llmist)
class Calculator extends Gadget({
  description: 'Performs arithmetic operations',
  schema: z.object({
    operation: z.enum(['add', 'multiply', 'subtract', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(params: this['params']): string {
    const { operation, a, b } = params;
    switch (operation) {
      case 'add': return String(a + b);
      case 'multiply': return String(a * b);
      case 'subtract': return String(a - b);
      case 'divide': return String(a / b);
    }
  }
}

// 2. Create and run agent
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withSystem('You are a helpful math assistant')
  .withGadgets(Calculator)
  .askAndCollect('What is 15 times 23?');

console.log(answer); // "15 times 23 equals 345"
```

## Model Shortcuts

Use short aliases instead of full model names:

| Alias | Model |
|-------|-------|
| `gpt5` | `openai:gpt-5` |
| `gpt5-mini` | `openai:gpt-5-mini` |
| `sonnet` | `anthropic:claude-sonnet-4-5-20250929` |
| `haiku` | `anthropic:claude-haiku-4-5-20251001` |
| `opus` | `anthropic:claude-opus-4-5-20251124` |
| `flash` | `gemini:gemini-2.5-flash` |
| `pro` | `gemini:gemini-3-pro-preview` |

```typescript
.withModel('sonnet')              // Alias
.withModel('gpt-5-mini')          // Auto-detects provider
.withModel('openai:gpt-5')        // Explicit provider
```

## Quick Methods (No Gadgets)

For simple completions without tools:

```typescript
// One-shot completion
const answer = await LLMist.complete('What is the capital of France?');

// Streaming
for await (const chunk of LLMist.stream('Tell me a story')) {
  process.stdout.write(chunk);
}
```

## Next Steps

- [Gadgets Guide](/guides/gadgets/) - Create custom tools
- [Hooks Guide](/guides/hooks/) - Monitor and customize execution
- [Streaming Guide](/guides/streaming/) - Handle real-time responses
- [Providers Guide](/advanced/providers/) - Multi-provider configuration
