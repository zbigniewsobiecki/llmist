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
!!!GADGET_START:FloppyDisk
!!!ARG:filename
DOOM.ZIP
!!!ARG:megabytes
50
!!!GADGET_END
```

Markers are fully [configurable](/library/guides/creating-gadgets/#customizing-markers).

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
  .withGadgets(FloppyDisk, DialUpModem)
  .withHooks(HookPresets.monitoring())
  .askAndCollect('How many floppies for DOOM.ZIP?');
```

## Packages

| Package | Description |
|---------|-------------|
| `llmist` | Core library with agents, gadgets, and providers |
| `@llmist/cli` | Command-line interface |
| `@llmist/testing` | Testing utilities and mocks |

## Next Steps

- [Installation](/library/getting-started/installation/) - Get llmist set up
- [Quick Start](/library/getting-started/quick-start/) - Build your first agent
