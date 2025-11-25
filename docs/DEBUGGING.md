# Debugging

Capture raw prompts, responses, and troubleshoot issues.

## Quick Debug with Hooks

```typescript
import { HookPresets } from 'llmist';

// Verbose logging shows everything
.withHooks(HookPresets.logging({ verbose: true }))
```

## Capture Raw Requests/Responses

```typescript
.withHooks({
  observers: {
    onLLMCallStart: async (ctx) => {
      console.log('=== REQUEST ===');
      console.log('Model:', ctx.options.model);
      console.log('Messages:');
      ctx.options.messages.forEach((m, i) => {
        console.log(`  [${i}] ${m.role}:`);
        console.log(`      ${m.content?.slice(0, 200)}...`);
      });
    },

    onLLMCallComplete: async (ctx) => {
      console.log('=== RESPONSE ===');
      console.log('Finish reason:', ctx.finishReason);
      console.log('Tokens:', ctx.usage);
      console.log('Raw response:');
      console.log(ctx.rawResponse);
    },
  },
})
```

## Debug Gadget Execution

```typescript
.withHooks({
  observers: {
    onGadgetExecutionStart: async (ctx) => {
      console.log(`[${ctx.gadgetName}] Starting`);
      console.log('Parameters:', JSON.stringify(ctx.parameters, null, 2));
    },

    onGadgetExecutionComplete: async (ctx) => {
      console.log(`[${ctx.gadgetName}] Completed in ${ctx.executionTimeMs}ms`);
      if (ctx.error) {
        console.error('Error:', ctx.error);
      } else {
        console.log('Result:', ctx.finalResult);
      }
    },
  },
})
```

## Custom Logger

```typescript
import { createLogger } from 'llmist';

const logger = createLogger({
  minLevel: 'debug', // debug, info, warn, error, fatal
});

.withLogger(logger)
.withHooks({
  observers: {
    onLLMCallStart: async (ctx) => {
      ctx.logger.debug('LLM call starting', { iteration: ctx.iteration });
    },
    onLLMCallComplete: async (ctx) => {
      ctx.logger.info('LLM call complete', { tokens: ctx.usage });
    },
  },
})
```

## Stream Chunk Debugging

```typescript
.withHooks({
  observers: {
    onStreamChunk: async (ctx) => {
      console.log(`Chunk [${ctx.iteration}]: "${ctx.rawChunk}"`);
      console.log(`Accumulated: ${ctx.accumulatedText.length} chars`);
    },
  },
})
```

## Debug Without Running

Build agent without executing to inspect configuration:

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator)
  .ask('prompt');

// Inspect agent state before running
console.log('Agent created, ready to run');
```

## Environment Debug

Check which providers are available:

```typescript
const client = new LLMist();

// List registered models
const models = client.modelRegistry.listModels();
console.log('Available models:', models.length);

// By provider
['openai', 'anthropic', 'gemini'].forEach(p => {
  const count = client.modelRegistry.listModels(p).length;
  console.log(`  ${p}: ${count} models`);
});
```

## Mock Debugging

Debug mock matching:

```typescript
import { mockLLM, getMockManager } from 'llmist';

// Add labels to mocks
mockLLM()
  .forModel('gpt-5')
  .returns('Hello')
  .withLabel('greeting mock')
  .register();

// Check registered mocks
const manager = getMockManager();
console.log('Registered mocks:', manager.getAll());
```

## Common Debug Patterns

### Token Usage Tracking

```typescript
let totalTokens = 0;

.withHooks({
  observers: {
    onLLMCallComplete: async (ctx) => {
      totalTokens += ctx.usage?.totalTokens ?? 0;
      console.log(`Call tokens: ${ctx.usage?.totalTokens}, Total: ${totalTokens}`);
    },
  },
})
```

### Iteration Tracking

```typescript
.withHooks({
  observers: {
    onLLMCallStart: async (ctx) => {
      console.log(`--- Iteration ${ctx.iteration + 1} ---`);
    },
  },
})
```

### Error Tracking

```typescript
const errors: Error[] = [];

.withHooks({
  observers: {
    onLLMCallError: async (ctx) => {
      errors.push(ctx.error);
      console.error(`LLM Error [${ctx.iteration}]:`, ctx.error.message);
    },
    onGadgetExecutionComplete: async (ctx) => {
      if (ctx.error) {
        console.error(`Gadget Error [${ctx.gadgetName}]:`, ctx.error);
      }
    },
  },
})
```

## CLI Debugging

```bash
# Chat with verbose output
llmist chat "test" --model haiku 2>&1 | tee debug.log

# Agent with gadget output
llmist agent "test" --gadget ./tool.ts 2>&1

# Check stderr for summaries
llmist chat "test" 2>/dev/null  # stdout only
llmist chat "test" >/dev/null   # stderr only
```

## See Also

- **[Hooks Guide](./HOOKS.md)** - All hook types
- **[Error Handling](./ERROR_HANDLING.md)** - Error recovery
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
