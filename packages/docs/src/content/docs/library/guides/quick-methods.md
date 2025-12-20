---
title: Quick Methods
description: Simple APIs for basic LLM interactions
---

Simple APIs for basic LLM interactions without agent setup.

## Overview

For simple prompts without tools, use quick methods:

```typescript
import { LLMist } from 'llmist';

// One-shot completion
const answer = await LLMist.complete('What is 2+2?');

// Streaming
for await (const chunk of LLMist.stream('Tell me a story')) {
  process.stdout.write(chunk);
}
```

## Static Methods

### `LLMist.complete()`

Get a complete response as a string:

```typescript
// Basic
const answer = await LLMist.complete('Explain quantum computing');

// With options
const answer = await LLMist.complete('Write a haiku', {
  model: 'sonnet',
  temperature: 0.9,
  systemPrompt: 'You are a poet',
  maxTokens: 100,
});
```

### `LLMist.stream()`

Stream text chunks in real-time:

```typescript
// Basic
for await (const chunk of LLMist.stream('Tell me a story')) {
  process.stdout.write(chunk);
}

// With options
for await (const chunk of LLMist.stream('Write code', {
  model: 'gpt4o',
  systemPrompt: 'You are a coding assistant',
})) {
  process.stdout.write(chunk);
}
```

## Instance Methods

Use with a configured client:

```typescript
const client = new LLMist({
  defaultProvider: 'anthropic',
});

// Complete
const answer = await client.complete('Hello');

// Stream
for await (const chunk of client.streamText('Hello')) {
  process.stdout.write(chunk);
}
```

## Options

```typescript
interface TextGenerationOptions {
  model?: string;        // Model name or alias (default: 'gpt-5-mini')
  temperature?: number;  // 0-1 (default: provider default)
  systemPrompt?: string; // System prompt (default: none)
  maxTokens?: number;    // Max tokens (default: provider default)
}
```

## Model Shortcuts

Works with all model shortcuts:

```typescript
await LLMist.complete('Hello', { model: 'haiku' });
await LLMist.complete('Hello', { model: 'sonnet' });
await LLMist.complete('Hello', { model: 'gpt4o' });
await LLMist.complete('Hello', { model: 'flash' });
```

## When to Use Quick Methods

**Use quick methods when:**
- Simple prompts without tools
- No conversation history needed
- No need for event handling
- Just want text output

**Use agents when:**
- Need tools (gadgets)
- Want streaming events
- Need conversation history
- Want lifecycle hooks

## Comparison

```typescript
// Quick method (simple)
const answer = await LLMist.complete('What is 2+2?');

// Agent (same result, more verbose)
const answer = await LLMist.createAgent()
  .withModel('gpt-5-mini')
  .askAndCollect('What is 2+2?');
```

## See Also

- [Quick Start](/library/getting-started/quick-start/) - Full guide
- [Streaming Guide](/library/guides/streaming/) - Agent streaming
- [Models & Aliases](/reference/models/) - All available models
