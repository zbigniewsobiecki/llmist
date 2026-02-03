# llmist Examples

Runnable examples demonstrating llmist features.

## Setup

```bash
# Install dependencies
npm install

# Set API keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export HF_TOKEN="hf_..."
```

## Run Examples

```bash
npx tsx examples/01-basic-usage.ts
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
| [10-text-handling.ts](./10-text-handling.ts) | Text response handling: textOnlyHandler, textWithGadgetsHandler |
| [11-gadget-dependencies.ts](./11-gadget-dependencies.ts) | Gadget dependencies (DAG execution) |
| [12-error-handling.ts](./12-error-handling.ts) | Error handling patterns, recovery, retries |
| [13-syntactic-sugar.ts](./13-syntactic-sugar.ts) | Fluent API showcase |
| [14-hints.ts](./14-hints.ts) | LLM assistance hints (iteration progress, parallel gadgets) |
| [15-trailing-messages.ts](./15-trailing-messages.ts) | Ephemeral trailing messages injected per LLM request |
| [16-image-generation.ts](./16-image-generation.ts) | Image generation with DALL-E and cost tracking |
| [17-speech-generation.ts](./17-speech-generation.ts) | Text-to-speech generation with OpenAI TTS |
| [18-multimodal-gadget.ts](./18-multimodal-gadget.ts) | Gadgets returning media (images, audio) with cost reporting |
| [19-multimodal-input.ts](./19-multimodal-input.ts) | Vision and multimodal input support |
| [20-external-gadgets.ts](./20-external-gadgets.ts) | External gadgets from npm packages and git URLs |
| [21-browseweb-multi-call.ts](./21-browseweb-multi-call.ts) | Multi-step web browsing with external gadget |
| [22-format-timing.ts](./22-format-timing.ts) | Response formatting and timing utilities |
| [23-session-manager.ts](./23-session-manager.ts) | Session management |
| [24-huggingface-test.ts](./24-huggingface-test.ts) | HuggingFace provider with streaming and provider selection |
| [25-reasoning-models.ts](./25-reasoning-models.ts) | Reasoning models with thinking/extended thinking |
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
