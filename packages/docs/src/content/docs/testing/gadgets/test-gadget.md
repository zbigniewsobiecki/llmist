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
import { FloppyDisk } from './floppy';

test('calculates floppy disks correctly', async () => {
  const result = await testGadget(FloppyDisk, {
    filename: 'DOOM.ZIP',
    megabytes: 50,
  });

  expect(result.result).toContain('35 floppy disk(s)');
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
  const result = await testGadget(FloppyDisk, {
    filename: 'DOOM.ZIP',
    megabytes: 'not a number', // Invalid!
  });

  expect(result.error).toBeDefined();
  expect(result.error?.message).toContain('validation');
});
```

### Testing Async Gadgets

```typescript
test('async gadget completes', async () => {
  const result = await testGadget(BBSFetch, {
    url: 'bbs://local-bbs.net/files',
  });

  expect(result.result).toContain('files');
});
```

## Mock Gadgets

Use `createMockGadget()` when testing agents to avoid executing real gadgets:

```typescript
import { createMockGadget, mockLLM, createMockClient } from '@llmist/testing';

test('agent handles arcade gadget', async () => {
  // Create a mock that returns canned response
  const mockArcade = createMockGadget({
    name: 'ArcadeHighScore',
    result: 'New high score! AAA - 999,999',
  });

  mockLLM()
    .forAnyModel()
    .returnsGadgetCall('ArcadeHighScore', { initials: 'AAA', score: 999999, game: 'pac-man' })
    .register();

  mockLLM()
    .forAnyModel()
    .whenMessageContains('999,999')
    .returns('Incredible! A new PAC-MAN world record!')
    .register();

  const client = createMockClient();
  const answer = await client.createAgent()
    .withGadgets(mockArcade)
    .askAndCollect('Record my perfect PAC-MAN score!');

  expect(answer).toContain('world record');
});
```

### Dynamic Mock Results

```typescript
const mockDialUp = createMockGadget({
  name: 'DialUpModem',
  execute: (params) => {
    if (params.baud >= 56000) return 'Connected at 56k! Lightning fast!';
    if (params.baud >= 28800) return 'Connected at 28.8k. Acceptable.';
    return 'Connected at 14.4k. Time for an upgrade.';
  },
});
```

### Mock with Validation

```typescript
const mockArcade = createMockGadget({
  name: 'ArcadeHighScore',
  schema: z.object({
    initials: z.string().length(3),
    score: z.number().positive(),
  }),
  result: 'High score recorded!',
});
```

## Testing Gadget Side Effects

For gadgets with side effects, use spies or mocks:

```typescript
import { vi } from 'vitest';

test('WriteFile calls fs.writeFile', async () => {
  const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

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
    .returnsGadgetCall('FloppyDisk', { filename: 'QUAKE.ZIP', megabytes: 100 })
    .register();

  mockLLM()
    .forAnyModel()
    .whenMessageContains('70 floppy disk(s)')
    .returns('You need 70 floppy disks for QUAKE. Start labeling!')
    .register();

  const client = createMockClient();

  // Use the REAL FloppyDisk gadget, but mock the LLM
  const answer = await client.createAgent()
    .withGadgets(FloppyDisk) // Real implementation
    .askAndCollect('How many floppies for QUAKE at 100MB?');

  expect(answer).toBe('You need 70 floppy disks for QUAKE. Start labeling!');
});
```

## See Also

- [Quick Start](/testing/getting-started/quick-start/) - Introduction to testing
- [Mocking LLM Responses](/testing/mocking/overview/) - Mock LLM calls
- [Gadgets Guide](/library/guides/gadgets/) - Creating gadgets
