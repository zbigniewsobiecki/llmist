# @llmist/testing

<p align="center">
  <a href="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml"><img src="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@llmist/testing"><img src="https://img.shields.io/npm/v/@llmist/testing.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
</p>

**Testing utilities for llmist - mock LLM responses and test agents deterministically.**

## Installation

```bash
npm install -D @llmist/testing
```

Requires `llmist` as a peer dependency.

## Quick Start

### Testing Gadgets

Test gadgets in isolation without any LLM calls:

```typescript
import { testGadget } from '@llmist/testing';
import { Calculator } from './gadgets';

const result = await testGadget(new Calculator(), {
  operation: 'add',
  a: 5,
  b: 3,
});

expect(result.result).toBe('8');
expect(result.error).toBeUndefined();
```

### Mocking LLM Responses

Use the fluent MockBuilder API to script LLM responses:

```typescript
import { mockLLM, createMockClient, resetMocks } from '@llmist/testing';
import { LLMist } from 'llmist';

// Set up mock responses
mockLLM()
  .whenMessageContains('hello')
  .returns('Hi there! How can I help?')
  .register();

mockLLM()
  .whenMessageContains('calculate')
  .returnsGadgetCall('Calculator', { operation: 'add', a: 1, b: 2 })
  .register();

// Create agent with mock client
const agent = LLMist.createAgent()
  .withClient(createMockClient())
  .withGadgets(Calculator);

const response = await agent.askAndCollect('hello');
// Returns "Hi there! How can I help?" - no API calls made

// Clean up after tests
resetMocks();
```

### Conditional Mocking

Match responses based on model, provider, or custom conditions:

```typescript
mockLLM()
  .forModel('gpt-4o')
  .forProvider('openai')
  .whenMessageContains('complex task')
  .returns('Handled by GPT-4o')
  .register();

mockLLM()
  .forModel('haiku')
  .whenMessageContains('complex task')
  .returns('Handled by Haiku')
  .register();
```

### One-Time Responses

Use `.once()` for responses that should only match once:

```typescript
mockLLM()
  .whenMessageContains('first')
  .returns('First response')
  .once()
  .register();

mockLLM()
  .whenMessageContains('first')
  .returns('Second response')
  .register();

// First call returns "First response"
// Subsequent calls return "Second response"
```

## API Reference

### `testGadget(gadget, params, options?)`

Test a gadget with given parameters.

### `mockLLM()`

Create a new mock builder with fluent API.

### `createMockClient()`

Create a mock LLMist client that uses registered mocks.

### `resetMocks()`

Clear all registered mocks (call in `afterEach`).

## Documentation

Full documentation at [llmist.dev/testing](https://llmist.dev/testing/getting-started/introduction/)

- [Mocking Overview](https://llmist.dev/testing/mocking/overview/)
- [Testing Gadgets](https://llmist.dev/testing/gadgets/test-gadget/)
- [Testing Agents](https://llmist.dev/testing/agents/testing-agents/)

## Related Packages

- [`llmist`](https://www.npmjs.com/package/llmist) - Core library
- [`@llmist/cli`](https://www.npmjs.com/package/@llmist/cli) - Command-line interface

## License

MIT
