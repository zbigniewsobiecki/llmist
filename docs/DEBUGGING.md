# Debugging

Capture raw prompts, responses, and troubleshoot issues.

## Quick Debug with Hooks

HookPresets provide instant debugging visibility without writing custom hooks:

```typescript
import { HookPresets } from 'llmist';

// Full monitoring suite (recommended starting point)
.withHooks(HookPresets.monitoring({ verbose: true }))
// Output: Logs + timing + tokens + errors with full details

// Or use specific presets for focused debugging
.withHooks(HookPresets.logging({ verbose: true }))  // Just logging
.withHooks(HookPresets.errorLogging())              // Only errors
```

**Preset Selection Guide:**

| Symptom | Recommended Preset | Why |
|---------|-------------------|-----|
| Agent not responding | `monitoring()` | See full execution flow + timing |
| Unexpected behavior | `logging({ verbose: true })` | See all parameters and results |
| High costs | `tokenTracking()` | Monitor token usage |
| Errors/crashes | `errorLogging()` | Capture error details |
| Slow performance | `timing()` | Identify bottlenecks |
| General debugging | `monitoring({ verbose: true })` | Everything in one place |

**Progressive Debugging Strategy:**

Start simple and add detail as needed:

```typescript
// 1. Start with basic logging
.withHooks(HookPresets.logging())

// 2. Add timing if performance is an issue
.withHooks(HookPresets.merge(
  HookPresets.logging(),
  HookPresets.timing()
))

// 3. Add verbose mode for full details
.withHooks(HookPresets.merge(
  HookPresets.logging({ verbose: true }),
  HookPresets.timing()
))

// 4. Use full monitoring for comprehensive view
.withHooks(HookPresets.monitoring({ verbose: true }))
```

**Scenario-Specific Patterns:**

```typescript
// Agent stuck or slow - timing + token tracking
.withHooks(HookPresets.merge(
  HookPresets.timing(),
  HookPresets.tokenTracking()
))

// Unexpected token costs - verbose logging + token tracking
.withHooks(HookPresets.merge(
  HookPresets.logging({ verbose: true }),
  HookPresets.tokenTracking()
))

// Gadget failures - verbose logging + error logging
.withHooks(HookPresets.merge(
  HookPresets.logging({ verbose: true }),
  HookPresets.errorLogging()
))

// Silent failures - full monitoring catches everything
.withHooks(HookPresets.monitoring({ verbose: true }))
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
# Complete with verbose output
llmist complete "test" --model haiku 2>&1 | tee debug.log

# Agent with gadget output
llmist agent "test" --gadget ./tool.ts 2>&1

# Check stderr for summaries
llmist complete "test" 2>/dev/null  # stdout only
llmist complete "test" >/dev/null   # stderr only
```

## See Also

- **[Hooks Guide](./HOOKS.md)** - All hook types
- **[Error Handling](./ERROR_HANDLING.md)** - Error recovery
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
