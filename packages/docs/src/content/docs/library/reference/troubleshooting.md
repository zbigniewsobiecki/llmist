---
title: Troubleshooting
description: Common issues and solutions
---

Common issues and solutions.

## Provider Issues

### "No LLM providers available"

Set API keys:
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

### Rate Limits / 429 Errors

Use built-in retry:
```typescript
.withRetry({ retries: 5, minTimeout: 2000 })
```

## Gadget Issues

### Gadget Not Being Called

Improve description:
```typescript
description: 'ALWAYS use this for ANY math calculation.',
```

Add to system prompt:
```typescript
.withSystem('Use FloppyDisk to calculate disk requirements.')
```

### Parameter Validation Failed

Add `.describe()` to schema:
```typescript
schema: z.object({
  number: z.number().describe('Must be a number'),
})
```

### Gadget Timeout

Increase timeout:
```typescript
class SlowGadget extends Gadget({
  timeoutMs: 60000,
}) {}

// Or globally
.withDefaultGadgetTimeout(30000)
```

## Agent Loop Issues

### Agent Stuck in Loop

Increase iterations:
```typescript
.withMaxIterations(20)
```

Add termination gadget:
```typescript
class Done extends Gadget({
  description: 'Call when task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params) {
    throw new TaskCompletionSignal(params.summary);
  }
}
```

### Human Input Not Working

Register handler:
```typescript
.onHumanInput(async (question) => {
  return await getUserInput(question);
})
```

## Streaming Issues

### No Output / Empty Response

Consume the stream:
```typescript
// Wrong
const agent = builder.ask('prompt');

// Right
const answer = await builder.askAndCollect('prompt');

// Or
for await (const event of agent.run()) {}
```

## Testing Issues

### Mock Not Matching

Use broader matchers:
```typescript
mockLLM().forAnyModel()
```

### Mocks Persisting

Clear in beforeEach:
```typescript
beforeEach(() => {
  getMockManager().clear();
});
```

## Still Stuck?

1. Enable monitoring:
```typescript
.withHooks(HookPresets.monitoring())
```

2. Check the [Debugging Guide](/reference/debugging/)

3. [Open an issue](https://github.com/zbigniewsobiecki/llmist/issues)
