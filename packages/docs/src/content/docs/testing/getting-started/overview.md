---
title: Testing Overview
description: Introduction to testing llmist agents with @llmist/testing
sidebar:
  order: 1
---

The `@llmist/testing` package provides utilities for testing llmist agents without making real API calls.

## Installation

```bash
bun add -D @llmist/testing
# or
npm install --save-dev @llmist/testing
```

## Why Mock?

Testing LLM-powered applications presents unique challenges:

| Challenge | Solution |
|-----------|----------|
| **Cost** | Mocks are free, no API charges |
| **Speed** | Instant responses, no network latency |
| **Determinism** | Same input → same output, every time |
| **Isolation** | Test logic without external dependencies |
| **CI/CD** | No API keys needed in test environment |

## Quick Start

```typescript
import { mockLLM, createMockClient } from '@llmist/testing';

// Define what the mock should return
mockLLM()
  .forModel('gpt-5')
  .returns('Hello, world!')
  .register();

// Create a mock client
const client = createMockClient();

// Use exactly like the real client
const answer = await client.complete('Hi');
console.log(answer); // "Hello, world!"
```

## When to Use Mocks

**Use mocks for:**
- Unit tests for agent logic
- Testing gadget interactions
- CI/CD pipelines
- Testing error handling paths
- Testing specific response scenarios

**Use real calls for:**
- Integration tests (sparingly)
- Prompt engineering validation
- E2E tests in staging environments

## Package Exports

| Export | Purpose |
|--------|---------|
| `mockLLM()` | Create mock LLM response builders |
| `createMockClient()` | Create an LLMist client that uses mocks |
| `getMockManager()` | Access mock registry for clearing/inspection |
| `testGadget()` | Test gadget execution directly |
| `createMockGadget()` | Create mock gadgets for agent tests |

## Test Setup Pattern

```typescript
import { describe, test, beforeEach, expect } from 'bun:test';
import { mockLLM, createMockClient, getMockManager } from '@llmist/testing';

describe('MyAgent', () => {
  beforeEach(() => {
    // Clear all mocks between tests
    getMockManager().clear();
  });

  test('responds correctly', async () => {
    mockLLM()
      .forAnyModel()
      .returns('Expected response')
      .register();

    const client = createMockClient();
    const result = await client.complete('Question');

    expect(result).toBe('Expected response');
  });
});
```

## Next Steps

- [Mocking LLM Responses](/testing/mocking/overview/) - Detailed mock configuration
- [Testing Gadgets](/testing/gadgets/test-gadget/) - Test gadgets in isolation
