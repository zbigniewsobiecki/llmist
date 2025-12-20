---
title: Examples
description: Runnable TypeScript examples demonstrating llmist features
---

All examples are located in the [`/examples/`](https://github.com/zbigniewsobiecki/llmist/tree/main/examples) directory and can be run with:

```bash
bunx tsx examples/01-basic-usage.ts
```

## Basic Examples

| Example | Description |
|---------|-------------|
| [01-basic-usage.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/01-basic-usage.ts) | Calculator gadget, three ways to run agents |
| [02-custom-gadgets.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/02-custom-gadgets.ts) | Class-based vs functional gadgets, async, timeouts |
| [03-hooks.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/03-hooks.ts) | Monitoring, custom observers, interceptors |
| [04-human-in-loop.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/04-human-in-loop.ts) | Interactive conversations with user input |
| [05-streaming.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/05-streaming.ts) | Event handling, collecting results |

## Advanced Examples

| Example | Description |
|---------|-------------|
| [06-model-catalog.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/06-model-catalog.ts) | Model queries, cost estimation |
| [07-logging.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/07-logging.ts) | Verbose logging, debugging |
| [08-hook-presets-advanced.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/08-hook-presets-advanced.ts) | Advanced preset patterns, cost tracking, analytics |
| [09-filesystem-gadgets.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/09-filesystem-gadgets.ts) | Secure file system operations with path sandboxing |
| [10-text-handling.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/10-text-handling.ts) | Text response handling: textOnlyHandler, textWithGadgetsHandler |
| [11-gadget-dependencies.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/11-gadget-dependencies.ts) | Gadget dependencies (DAG execution) |

## API Patterns

| Example | Description |
|---------|-------------|
| [13-syntactic-sugar.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/13-syntactic-sugar.ts) | Fluent API showcase |
| [14-hints.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/14-hints.ts) | LLM assistance hints (iteration progress, parallel gadgets) |
| [15-trailing-messages.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/15-trailing-messages.ts) | Ephemeral trailing messages injected per LLM request |

## Multimodal

| Example | Description |
|---------|-------------|
| [16-image-generation.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/16-image-generation.ts) | Image generation with DALL-E and cost tracking |
| [17-speech-generation.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/17-speech-generation.ts) | Text-to-speech generation with OpenAI TTS |
| [18-multimodal-gadget.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/18-multimodal-gadget.ts) | Gadgets returning media (images, audio) with cost reporting |
| [19-multimodal-input.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/19-multimodal-input.ts) | Vision and multimodal input support |

## External Gadgets

| Example | Description |
|---------|-------------|
| [20-external-gadgets.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/20-external-gadgets.ts) | External gadgets from npm packages and git URLs |
| [21-browseweb-multi-call.ts](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/21-browseweb-multi-call.ts) | Multi-step web browsing with external gadget |

## Configuration

| File | Description |
|------|-------------|
| [cli.example.toml](https://github.com/zbigniewsobiecki/llmist/blob/main/examples/cli.example.toml) | CLI configuration file example |

## Reusable Gadgets

The [`/examples/gadgets/`](https://github.com/zbigniewsobiecki/llmist/tree/main/examples/gadgets) directory contains production-ready gadgets you can use or learn from:

- **Calculator** - Basic arithmetic operations
- **Strings** - String manipulation utilities
- **Random** - Random number and coin flip utilities
- **Filesystem** - Secure file operations with sandboxing
- **Todo** - Task planning system for agents
- **Web Search** - Google search integration

## Quick Reference

### Minimal Agent

```typescript
const answer = await LLMist.createAgent()
  .withModel('haiku')
  .askAndCollect('Hello!');
```

### Agent with Gadgets

```typescript
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withSystem('You are helpful')
  .withGadgets(MyGadget)
  .askAndCollect('Do something');
```

### Streaming Events

```typescript
await LLMist.createAgent()
  .withModel('flash')
  .withGadgets(MyGadget)
  .askWith('Do something', {
    onText: (text) => console.log(text),
    onGadgetResult: (r) => console.log(r.result),
  });
```
