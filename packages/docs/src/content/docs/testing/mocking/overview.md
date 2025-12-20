---
title: Mocking LLM Responses
description: Configure mock LLM responses for deterministic tests
sidebar:
  order: 2
---

Use `mockLLM()` to configure how mock LLM calls should respond.

## MockBuilder API

### Model Matching

```typescript
// Match specific model (partial match)
mockLLM().forModel('gpt-5')

// Match full model name
mockLLM().forModel('openai:gpt-5-nano')

// Match any model
mockLLM().forAnyModel()
```

### Content Matching

```typescript
// Match message content
mockLLM().whenMessageContains('hello')

// Custom predicate
mockLLM().when((ctx) => ctx.options.temperature > 0.8)

// Combine matchers
mockLLM()
  .forModel('sonnet')
  .whenMessageContains('calculate')
```

### Response Types

```typescript
// Simple text response
mockLLM().returns('Hello!')

// Gadget call
mockLLM().returnsGadgetCall('FloppyDisk', { filename: 'DOOM.ZIP', megabytes: 50 })

// Multiple gadget calls
mockLLM()
  .returnsGadgetCall('FetchData', { url: '/api/users' })
  .returnsGadgetCall('FetchData', { url: '/api/orders' })

// Text with usage stats
mockLLM()
  .returns('Response text')
  .withUsage({ inputTokens: 100, outputTokens: 50 })
```

### Timing and Labels

```typescript
// Add delay (simulate network)
mockLLM().withDelay(100)

// Label for debugging
mockLLM().withLabel('auth-test')

// Use once then remove
mockLLM().once()
```

## Testing Agents

### Basic Agent Test

```typescript
test('agent calculates floppy disks', async () => {
  // First call: LLM requests FloppyDisk gadget
  mockLLM()
    .forAnyModel()
    .returnsGadgetCall('FloppyDisk', { filename: 'DOOM.ZIP', megabytes: 50 })
    .register();

  // Second call: LLM sees result and responds
  mockLLM()
    .forAnyModel()
    .whenMessageContains('35 floppy disk(s)')
    .returns('You need 35 floppy disks for DOOM.ZIP!')
    .register();

  const client = createMockClient();
  const answer = await client.createAgent()
    .withGadgets(FloppyDisk)
    .askAndCollect('How many floppies for DOOM.ZIP at 50MB?');

  expect(answer).toContain('35');
});
```

### Multi-Turn Conversations

```typescript
test('multi-turn conversation', async () => {
  // Turn 1
  mockLLM()
    .forAnyModel()
    .whenMessageContains('Hello')
    .returns('Hi there! Ready to dial up?')
    .register();

  // Turn 2
  mockLLM()
    .forAnyModel()
    .whenMessageContains('connect')
    .returnsGadgetCall('DialUpModem', { number: '555-1234', baud: 56000 })
    .register();

  // Turn 3
  mockLLM()
    .forAnyModel()
    .whenMessageContains('Connected at 56000 baud')
    .returns('You\'re connected at 56k! Welcome to the BBS.')
    .register();

  const client = createMockClient();
  const agent = client.createAgent()
    .withGadgets(DialUpModem)
    .ask('Hello, can you connect me to the BBS?');

  // Consume all turns
  const events = [];
  for await (const event of agent.run()) {
    events.push(event);
  }

  expect(events.some(e => e.type === 'text' && e.content.includes('56k'))).toBe(true);
});
```

### Testing Error Scenarios

```typescript
test('handles API errors gracefully', async () => {
  mockLLM()
    .forAnyModel()
    .throws(new Error('Rate limit exceeded'))
    .register();

  const client = createMockClient();

  await expect(
    client.complete('Test')
  ).rejects.toThrow('Rate limit exceeded');
});
```

## Clearing Mocks

```typescript
import { getMockManager } from '@llmist/testing';

// Clear all mocks
getMockManager().clear();

// Clear specific label
getMockManager().clear('auth-test');

// In beforeEach
beforeEach(() => {
  getMockManager().clear();
});
```

## Mock Order and Priority

Mocks are matched in registration order. First match wins:

```typescript
// This is checked first
mockLLM()
  .forModel('gpt-5')
  .whenMessageContains('special')
  .returns('Special response')
  .register();

// This catches remaining gpt-5 calls
mockLLM()
  .forModel('gpt-5')
  .returns('Default response')
  .register();
```

## Inspecting Mock Calls

```typescript
const manager = getMockManager();

// Get all registered mocks
const mocks = manager.getMocks();

// Check if any mocks matched
const stats = manager.getStats();
console.log(stats.matched);
console.log(stats.unmatched);
```

## See Also

- [Quick Start](/testing/getting-started/quick-start/) - Introduction to testing
- [Testing Gadgets](/testing/gadgets/test-gadget/) - Test gadgets in isolation
