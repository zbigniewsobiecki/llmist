# llmist Examples

Runnable examples demonstrating llmist features.

## Setup

```bash
# Install dependencies
bun install

# Set API keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Run Examples

```bash
bunx tsx examples/01-basic-usage.ts
```

## Examples

| File | Description |
|------|-------------|
| [01-basic-usage.ts](./01-basic-usage.ts) | Calculator gadget, three ways to run agents |
| [02-custom-gadgets.ts](./02-custom-gadgets.ts) | Class-based vs functional gadgets, async, timeouts |
| [03-hooks.ts](./03-hooks.ts) | Monitoring, custom observers, interceptors |
| [04-human-in-loop.ts](./04-human-in-loop.ts) | Interactive conversations with user input |
| [05-streaming.ts](./05-streaming.ts) | Event handling, collecting results |
| [06-model-catalog.ts](./06-model-catalog.ts) | Model queries, cost estimation |
| [07-logging.ts](./07-logging.ts) | Verbose logging, debugging |
| [08-hook-presets-advanced.ts](./08-hook-presets-advanced.ts) | Advanced preset patterns, cost tracking, analytics |
| [09-filesystem-gadgets.ts](./09-filesystem-gadgets.ts) | Secure file system operations with path sandboxing |
| [13-syntactic-sugar.ts](./13-syntactic-sugar.ts) | Fluent API showcase |
| [cli.example.toml](./cli.example.toml) | CLI configuration file example |

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
