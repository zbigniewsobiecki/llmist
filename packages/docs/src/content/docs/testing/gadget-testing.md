---
title: Testing Gadgets
description: Test gadgets in isolation with testGadget and createMockGadget
sidebar:
  order: 3
---

Test gadgets independently of the agent loop using `testGadget()` and `createMockGadget()`.

## Testing Gadget Execution

Use `testGadget()` to test gadgets with automatic validation:

```typescript
import { testGadget } from '@llmist/testing';
import { Calculator } from './calculator';

test('calculator adds correctly', async () => {
  const result = await testGadget(Calculator, {
    operation: 'add',
    a: 5,
    b: 3,
  });

  expect(result.result).toBe('8');
  expect(result.error).toBeUndefined();
});
```

### testGadget Return Value

```typescript
interface TestGadgetResult {
  result: string;        // Gadget output
  error?: Error;         // Error if execution failed
  executionTimeMs: number;
}
```

### Testing Validation Errors

```typescript
test('rejects invalid parameters', async () => {
  const result = await testGadget(Calculator, {
    operation: 'add',
    a: 'not a number', // Invalid!
    b: 3,
  });

  expect(result.error).toBeDefined();
  expect(result.error?.message).toContain('validation');
});
```

### Testing Async Gadgets

```typescript
test('async gadget completes', async () => {
  const result = await testGadget(FetchData, {
    url: 'https://api.example.com/data',
  });

  expect(result.result).toContain('data');
});
```

## Mock Gadgets

Use `createMockGadget()` when testing agents to avoid executing real gadgets:

```typescript
import { createMockGadget, mockLLM, createMockClient } from '@llmist/testing';

test('agent handles weather gadget', async () => {
  // Create a mock that returns canned response
  const mockWeather = createMockGadget({
    name: 'Weather',
    result: 'Sunny, 72°F',
  });

  mockLLM()
    .forAnyModel()
    .returnsGadgetCall('Weather', { city: 'NYC' })
    .register();

  mockLLM()
    .forAnyModel()
    .whenMessageContains('72°F')
    .returns('The weather is nice!')
    .register();

  const client = createMockClient();
  const answer = await client.createAgent()
    .withGadgets(mockWeather)
    .askAndCollect('What\'s the weather in NYC?');

  expect(answer).toContain('nice');
});
```

### Dynamic Mock Results

```typescript
const mockWeather = createMockGadget({
  name: 'Weather',
  execute: (params) => {
    if (params.city === 'NYC') return 'Sunny, 72°F';
    if (params.city === 'London') return 'Rainy, 55°F';
    return 'Unknown city';
  },
});
```

### Mock with Validation

```typescript
const mockWeather = createMockGadget({
  name: 'Weather',
  schema: z.object({
    city: z.string().min(1),
  }),
  result: 'Sunny, 72°F',
});
```

## Testing Gadget Side Effects

For gadgets with side effects, use spies or mocks:

```typescript
import { mock, spyOn } from 'bun:test';

test('WriteFile calls fs.writeFile', async () => {
  const writeSpy = spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

  await testGadget(WriteFile, {
    path: '/tmp/test.txt',
    content: 'Hello',
  });

  expect(writeSpy).toHaveBeenCalledWith('/tmp/test.txt', 'Hello');
});
```

## Testing Error Handling

```typescript
test('gadget handles errors gracefully', async () => {
  // Create a gadget that always fails
  class FailingGadget extends Gadget({
    description: 'Always fails',
    schema: z.object({}),
  }) {
    execute() {
      throw new Error('Something went wrong');
    }
  }

  const result = await testGadget(FailingGadget, {});

  expect(result.error).toBeDefined();
  expect(result.error?.message).toBe('Something went wrong');
});
```

## Testing Timeouts

```typescript
test('slow gadget times out', async () => {
  class SlowGadget extends Gadget({
    description: 'Takes too long',
    schema: z.object({}),
    timeoutMs: 100, // 100ms timeout
  }) {
    async execute() {
      await new Promise(r => setTimeout(r, 1000)); // 1 second
      return 'Done';
    }
  }

  const result = await testGadget(SlowGadget, {});

  expect(result.error).toBeDefined();
  expect(result.error?.message).toContain('timeout');
});
```

## Integration Testing Pattern

Test gadgets within a full agent loop:

```typescript
test('full agent flow with real gadgets', async () => {
  mockLLM()
    .forAnyModel()
    .returnsGadgetCall('Calculator', { operation: 'add', a: 10, b: 20 })
    .register();

  mockLLM()
    .forAnyModel()
    .whenMessageContains('Result: 30')
    .returns('The sum is 30.')
    .register();

  const client = createMockClient();

  // Use the REAL Calculator gadget, but mock the LLM
  const answer = await client.createAgent()
    .withGadgets(Calculator) // Real implementation
    .askAndCollect('Add 10 and 20');

  expect(answer).toBe('The sum is 30.');
});
```

## See Also

- [Testing Overview](/testing/overview/) - Introduction to testing
- [Mocking LLM Responses](/testing/mocking/) - Mock LLM calls
- [Gadgets Guide](/guides/gadgets/) - Creating gadgets
