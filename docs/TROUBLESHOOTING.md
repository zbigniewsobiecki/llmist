# Troubleshooting

Common issues and solutions.

## Provider Issues

### "No LLM providers available"

**Cause:** No API keys set.

**Solution:**
```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export GEMINI_API_KEY="..."
```

### "No adapter registered for provider X"

**Cause:** Requesting provider without API key.

**Solution:** Set the API key for the provider, or use explicit prefix:
```typescript
.withModel('openai:gpt-5')  // Explicitly use OpenAI
```

### Rate Limits / 429 Errors

**Cause:** Too many API requests.

**Solution:** Add retry logic:
```typescript
.withHooks({
  controllers: {
    afterLLMError: async (ctx) => {
      if (ctx.error.message.includes('429')) {
        await sleep(5000);
        return { action: 'recover', fallbackResponse: 'Rate limited, please retry.' };
      }
      return { action: 'rethrow' };
    },
  },
})
```

## Model Issues

### "Unknown model 'X'"

**Cause:** Typo or unknown model name.

**Solution:** Use correct model name or alias:
```typescript
// These all work
.withModel('haiku')           // Alias
.withModel('claude-haiku-4-5-20251001')  // Full name
.withModel('anthropic:claude-haiku-4-5-20251001')  // With prefix
```

### Model Shortcut Not Working

**Cause:** Using wrong alias.

**Valid aliases:**
| Alias | Model |
|-------|-------|
| `gpt5` | OpenAI GPT-5 |
| `gpt5-mini` | OpenAI GPT-5-mini |
| `sonnet` | Claude Sonnet 4.5 |
| `haiku` | Claude Haiku 4.5 |
| `opus` | Claude Opus 4.5 |
| `flash` | Gemini 2.5 Flash |

## Gadget Issues

### Gadget Not Being Called

**Cause:** LLM not recognizing gadget or wrong description.

**Solutions:**
1. Make description clearer:
```typescript
class Calculator extends Gadget({
  description: 'ALWAYS use this for ANY math calculation. Supports add, subtract, multiply, divide.',
  // ...
})
```

2. Add to system prompt:
```typescript
.withSystem('You have access to a Calculator gadget. Use it for ALL arithmetic.')
```

### Parameter Validation Failed

**Cause:** LLM sent wrong parameter types.

**Solution:** Add `.describe()` to schema fields:
```typescript
schema: z.object({
  number: z.number().describe('Must be a number, not a string'),
  operation: z.enum(['add', 'subtract']).describe('One of: add, subtract'),
})
```

### Gadget Timeout

**Cause:** Gadget execution too slow.

**Solution:** Increase timeout:
```typescript
class SlowGadget extends Gadget({
  // ...
  timeoutMs: 60000, // 60 seconds
}) { }

// Or globally
.withDefaultGadgetTimeout(30000)
```

## Agent Loop Issues

### Agent Stuck in Loop

**Cause:** Max iterations reached or LLM not terminating.

**Solutions:**
1. Increase iterations:
```typescript
.withMaxIterations(20)
```

2. Add termination gadget:
```typescript
class Done extends Gadget({
  description: 'Call when task is complete',
  schema: z.object({ summary: z.string() }),
}) {
  execute(params) { throw new TaskCompletionSignal(params.summary); }
}
```

3. Add to system prompt:
```typescript
.withSystem('When finished, call the Done gadget.')
```

### Human Input Not Working

**Cause:** No handler registered.

**Solution:**
```typescript
.onHumanInput(async (question) => {
  return await getUserInput(question);
})
```

## Streaming Issues

### No Output / Empty Response

**Cause:** Stream not consumed or error swallowed.

**Solution:** Ensure you consume the stream:
```typescript
// Wrong - not consuming
const agent = builder.ask('prompt');

// Right - consume with askAndCollect
const answer = await builder.askAndCollect('prompt');

// Right - consume with for-await
for await (const event of agent.run()) { }
```

### Events Not Firing

**Cause:** Using wrong event handler.

**Check event types:**
```typescript
for await (const event of agent.run()) {
  console.log('Event type:', event.type);
  // text, gadget_call, gadget_result, human_input_required
}
```

## Testing Issues

### Mock Not Matching

**Cause:** Matcher too specific.

**Solution:** Use broader matchers:
```typescript
// Too specific
mockLLM().forModel('gpt-5-2025-08-07')

// Better
mockLLM().forModel('gpt-5')  // Partial match
mockLLM().forAnyModel()       // Match all
```

### Mocks Persisting Between Tests

**Solution:** Clear mocks in beforeEach:
```typescript
import { getMockManager } from 'llmist';

beforeEach(() => {
  getMockManager().clear();
});
```

## TypeScript Issues

### Type Error in execute()

**Cause:** Not using `this['params']` type.

**Solution:**
```typescript
class MyGadget extends Gadget({
  schema: z.object({ x: z.number() }),
}) {
  // Use this['params'] for type safety
  execute(params: this['params']): string {
    return String(params.x);  // x is typed as number
  }
}
```

## CLI Issues

### stdin Not Working

**Cause:** Need to pipe input.

**Solution:**
```bash
# Pipe from file
cat prompt.txt | llmist complete

# Pipe from command
echo "Hello" | llmist complete

# Here document
llmist complete <<< "Hello"
```

### Gadget File Not Found

**Cause:** Wrong path or not TypeScript.

**Solution:**
```bash
# Use relative path from current directory
llmist agent "test" --gadget ./tools/calculator.ts

# Check file exists
ls -la ./tools/calculator.ts
```

## Still Stuck?

1. Enable verbose logging:
```typescript
.withHooks(HookPresets.monitoring())
```

2. Check the [Debugging Guide](./DEBUGGING.md)

3. [Open an issue](https://github.com/zbigniewsobiecki/llmist/issues)
