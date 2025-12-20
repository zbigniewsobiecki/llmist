---
title: Introduction
description: What is llmist and why should you use it?
---

**llmist** is a TypeScript LLM client with streaming tool execution. Most LLM libraries buffer the entire response before parsing tool calls. **llmist parses incrementally.**

Your gadgets (tools) fire the instant they're complete in the stream—giving your users immediate feedback.

## Key Features

### Streaming Tool Execution

Gadgets execute the moment their block is parsed—not after the response completes. Real-time UX without buffering.

```typescript
for await (const event of agent.run()) {
  if (event.type === 'gadget_result')
    updateUI(event.result); // Immediate
}
```

### Built-in Function Calling

llmist implements its own tool calling via a simple block format. No `response_format: json`. No native tool support needed. Works with any model from supported providers.

```
!!!GADGET_START[Calculator]
!!!ARG[operation] add
!!!ARG[a] 15
!!!ARG[b] 23
!!!GADGET_END
```

Markers are fully [configurable](/getting-started/configuration/).

### Multi-Provider Support

OpenAI, Anthropic, and Gemini out of the box—extensible to any provider. Just set API keys as environment variables.

```typescript
.withModel('sonnet')   // Anthropic Claude
.withModel('gpt-5')    // OpenAI
.withModel('flash')    // Google Gemini
```

### Composable Agent API

Fluent builder, async iterators, full TypeScript inference. Hook into any lifecycle point. Your code stays readable.

```typescript
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator, Weather)
  .withHooks(HookPresets.monitoring())
  .askAndCollect('What is 15 + 23?');
```

## Packages

| Package | Description |
|---------|-------------|
| `llmist` | Core library with agents, gadgets, and providers |
| `@llmist/cli` | Command-line interface |
| `@llmist/testing` | Testing utilities and mocks |

## Next Steps

- [Installation](/getting-started/installation/) - Get llmist set up
- [Quick Start](/getting-started/quick-start/) - Build your first agent
