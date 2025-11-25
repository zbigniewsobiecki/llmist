# Testing

Mock LLM responses for zero-cost, deterministic tests.

## Quick Start

```typescript
import { mockLLM, createMockClient, LLMist } from 'llmist';

// Register a mock
mockLLM()
  .forModel('gpt-5')
  .returns('Hello, world!')
  .register();

// Use mock client
const client = createMockClient();
const answer = await client.complete('Hi');

console.log(answer); // "Hello, world!" - no API call made!
```

## MockBuilder API

### Matching

```typescript
// By model (partial match)
mockLLM().forModel('gpt-5')
mockLLM().forModel('claude')

// By provider
mockLLM().forProvider('openai')
mockLLM().forProvider('anthropic')

// Match any
mockLLM().forAnyModel()
mockLLM().forAnyProvider()

// By message content
mockLLM().whenMessageContains('hello')
mockLLM().whenLastMessageContains('goodbye')
mockLLM().whenMessageMatches(/calculate \d+/)
mockLLM().whenRoleContains('system', 'You are helpful')

// By conversation length
mockLLM().whenMessageCount((count) => count > 5)

// Custom matcher
mockLLM().when((ctx) => ctx.options.temperature > 0.8)
```

### Responses

```typescript
// Simple text
mockLLM().returns('Hello!')

// Dynamic response
mockLLM().returns((ctx) => `You said: ${ctx.messages[0].content}`)

// With gadget calls
mockLLM()
  .returns('Let me calculate that...')
  .returnsGadgetCall('calculator', { op: 'add', a: 5, b: 3 })

// Multiple gadget calls
mockLLM().returnsGadgetCalls([
  { gadgetName: 'calculator', parameters: { op: 'add', a: 1, b: 2 } },
  { gadgetName: 'logger', parameters: { message: 'Done!' } },
])

// Full response control
mockLLM().withResponse({
  text: 'Hello',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  finishReason: 'stop',
})
```

### Options

```typescript
// Token usage
mockLLM().withUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })

// Finish reason
mockLLM().withFinishReason('stop')
mockLLM().withFinishReason('length')

// Simulate delays
mockLLM().withDelay(100)        // 100ms initial delay
mockLLM().withStreamDelay(10)   // 10ms between chunks

// Labels (for debugging)
mockLLM().withLabel('greeting mock')

// Custom ID
mockLLM().withId('my-mock-id')
```

### One-Time Mocks

```typescript
// First call uses this mock, then it's removed
mockLLM()
  .forModel('gpt-5')
  .returns('First response')
  .once()
  .register();

// Subsequent calls use this mock
mockLLM()
  .forModel('gpt-5')
  .returns('Default response')
  .register();
```

## Testing with Agents

```typescript
import { mockLLM, createMockClient, LLMist, Gadget, z } from 'llmist';

class Calculator extends Gadget({
  description: 'Adds numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
}) {
  execute(params: this['params']): string {
    return String(params.a + params.b);
  }
}

test('agent uses calculator', async () => {
  // Mock LLM to call the calculator
  mockLLM()
    .forAnyModel()
    .returns('Let me calculate...')
    .returnsGadgetCall('Calculator', { a: 5, b: 3 })
    .register();

  // Mock follow-up response
  mockLLM()
    .forAnyModel()
    .whenMessageContains('Result: 8')  // After gadget executes
    .returns('The answer is 8!')
    .register();

  const client = createMockClient();
  const answer = await client.createAgent()
    .withModel('mock:test')
    .withGadgets(Calculator)
    .askAndCollect('What is 5 + 3?');

  expect(answer).toContain('8');
});
```

## Clearing Mocks

```typescript
import { getMockManager } from 'llmist';

beforeEach(() => {
  getMockManager().clear();
});

// Or unregister specific mock
const mockId = mockLLM().forModel('gpt-5').returns('Hi').register();
getMockManager().unregister(mockId);
```

## Complete Test Example

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { mockLLM, createMockClient, getMockManager, LLMist, Gadget, z } from 'llmist';

class Weather extends Gadget({
  description: 'Gets weather',
  schema: z.object({ city: z.string() }),
}) {
  execute(params: this['params']): string {
    return `${params.city}: 72°F, Sunny`;
  }
}

describe('Weather Agent', () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  test('asks for weather', async () => {
    mockLLM()
      .forAnyModel()
      .whenMessageContains('weather')
      .returnsGadgetCall('Weather', { city: 'Paris' })
      .register();

    mockLLM()
      .forAnyModel()
      .returns('The weather in Paris is 72°F and sunny!')
      .register();

    const client = createMockClient();
    const answer = await client.createAgent()
      .withGadgets(Weather)
      .askAndCollect("What's the weather in Paris?");

    expect(answer).toContain('Paris');
    expect(answer).toContain('72');
  });

  test('handles multiple cities', async () => {
    mockLLM()
      .forAnyModel()
      .returnsGadgetCalls([
        { gadgetName: 'Weather', parameters: { city: 'Paris' } },
        { gadgetName: 'Weather', parameters: { city: 'London' } },
      ])
      .once()
      .register();

    mockLLM()
      .forAnyModel()
      .returns('Paris: 72°F, London: 65°F')
      .register();

    const client = createMockClient();
    const answer = await client.createAgent()
      .withGadgets(Weather)
      .askAndCollect('Weather in Paris and London?');

    expect(answer).toContain('Paris');
    expect(answer).toContain('London');
  });
});
```

## Integration Testing

For real API testing, use environment variables:

```typescript
const isIntegration = process.env.RUN_INTEGRATION === 'true';

(isIntegration ? test : test.skip)('real API call', async () => {
  const answer = await LLMist.createAgent()
    .withModel('haiku')
    .askAndCollect('Say hello');

  expect(answer).toBeTruthy();
});
```

## Gadget Testing Utilities

Test gadgets in isolation without the full agent loop. Import from `llmist/testing`:

```typescript
import { testGadget, testGadgetBatch, createMockGadget, mockGadget } from 'llmist/testing';
```

### testGadget

Execute a gadget with schema validation and default application:

```typescript
import { testGadget } from 'llmist/testing';
import { createGadget, z } from 'llmist';

const calculator = createGadget({
  description: 'Add numbers',
  schema: z.object({
    a: z.number(),
    b: z.number().default(0),
  }),
  execute: ({ a, b }) => String(a + b),
});

// Test with validation and defaults applied
const result = await testGadget(calculator, { a: 5 });
console.log(result.result);           // "5" (default b=0 applied)
console.log(result.validatedParams);  // { a: 5, b: 0 }
console.log(result.error);            // undefined

// Invalid parameters return errors
const invalid = await testGadget(calculator, { a: 'not a number' });
console.log(invalid.error);  // "Invalid parameters: a: Expected number..."
```

Skip validation for edge case testing:

```typescript
const result = await testGadget(gadget, rawParams, { skipValidation: true });
```

### testGadgetBatch

Test multiple parameter sets at once:

```typescript
import { testGadgetBatch } from 'llmist/testing';

const results = await testGadgetBatch(calculator, [
  { a: 1, b: 2 },
  { a: 5 },        // Uses default b=0
  { a: 10, b: -3 },
]);

// results[0].result === "3"
// results[1].result === "5"
// results[2].result === "7"
```

### Mock Gadgets

Create mock gadgets for testing agent interactions:

```typescript
import { createMockGadget, mockGadget } from 'llmist/testing';

// Simple mock with static result
const weatherMock = createMockGadget({
  name: 'Weather',
  result: 'Sunny, 72°F',
});

// Dynamic result based on parameters
const echoMock = createMockGadget({
  name: 'Echo',
  resultFn: (params) => `You said: ${params.message}`,
});

// Mock that throws an error
const failingMock = createMockGadget({
  name: 'Unstable',
  error: 'Service unavailable',
});

// With schema
const typedMock = createMockGadget({
  name: 'Search',
  schema: z.object({ query: z.string() }),
  result: 'Found 10 results',
});
```

**Fluent Builder API:**

```typescript
const mock = mockGadget()
  .withName('Weather')
  .withDescription('Get weather')
  .withSchema(z.object({ city: z.string() }))
  .returns('Sunny')
  .withDelay(100)      // Simulate latency
  .withTimeout(5000)
  .build();
```

**Call Tracking:**

```typescript
const mock = createMockGadget({ name: 'Tracker', result: 'done' });

await mock.execute({ city: 'Paris' });
await mock.execute({ city: 'London' });

mock.getCallCount();                    // 2
mock.getCalls();                        // [{ params: { city: 'Paris' }, ... }, ...]
mock.wasCalledWith({ city: 'Paris' });  // true
mock.getLastCall();                     // { params: { city: 'London' }, ... }
mock.resetCalls();                      // Clear history
```

### Parameter Validation

Standalone validation utilities (also exported from main `llmist`):

```typescript
import { validateAndApplyDefaults, validateGadgetParams, z } from 'llmist';

const schema = z.object({
  delay: z.number().default(100),
  retries: z.number().int().min(0).default(3),
});

const result = validateAndApplyDefaults(schema, { delay: 50 });
if (result.success) {
  console.log(result.data);  // { delay: 50, retries: 3 }
} else {
  console.log(result.error);   // "Invalid parameters: ..."
  console.log(result.issues);  // [{ path: 'field', message: '...' }]
}

// Validate against a gadget's schema
const gadgetResult = validateGadgetParams(calculator, { a: 5 });
```

### AgentBuilder.build()

Access the raw Agent instance without running for inspection/testing:

```typescript
import { LLMist } from 'llmist';

const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator, Weather)
  .build();  // Returns Agent without prompt

// Access gadget registry
const registry = agent.getRegistry();
registry.has('Calculator');  // true
registry.list();             // ['calculator', 'weather']

// Agent.run() throws without a prompt
// Use ask() or askAndCollect() for normal execution
```

## See Also

- **[Hooks Guide](./HOOKS.md)** - Mock with hooks
- **[Error Handling](./ERROR_HANDLING.md)** - Test error scenarios
- **[Debugging](./DEBUGGING.md)** - Debug mock issues
