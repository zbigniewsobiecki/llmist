# Configuration

All configuration options for LLMist client and agents.

## LLMist Client Options

```typescript
const client = new LLMist(options);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapters` | `ProviderAdapter[]` | `[]` | Manual provider adapters |
| `defaultProvider` | `string` | First adapter | Default provider prefix |
| `autoDiscoverProviders` | `boolean` | `true` | Auto-discover from env vars |
| `customModels` | `ModelSpec[]` | `[]` | Custom model specifications |

```typescript
// Full example
const client = new LLMist({
  autoDiscoverProviders: true,
  defaultProvider: 'anthropic',
  customModels: [{
    provider: 'openai',
    modelId: 'ft:gpt-5:my-org',
    displayName: 'My Model',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { input: 5.0, output: 15.0 },
    knowledgeCutoff: '2024-08',
    features: { streaming: true, functionCalling: true, vision: true },
  }],
});
```

## AgentBuilder Options

```typescript
LLMist.createAgent()
  .withModel(model)
  .withSystem(prompt)
  // ... etc
```

### Core Options

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `.withModel(model)` | `string` | `openai:gpt-5-mini` | Model name or alias |
| `.withSystem(prompt)` | `string` | none | System prompt |
| `.withTemperature(temp)` | `number` | Provider default | Temperature (0-1) |
| `.withMaxIterations(n)` | `number` | 10 | Max agent loop iterations |

### Gadgets

| Method | Type | Description |
|--------|------|-------------|
| `.withGadgets(...gadgets)` | `GadgetOrClass[]` | Register gadgets (classes or instances) |
| `.withDefaultGadgetTimeout(ms)` | `number` | Default timeout for all gadgets |
| `.withParameterFormat(format)` | `'json' \| 'yaml'` | Gadget parameter format |

### Error Handling

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `.withStopOnGadgetError(stop)` | `boolean` | `true` | Stop on first gadget error |
| `.withErrorHandler(handler)` | Function | none | Custom error handling |

```typescript
.withErrorHandler((ctx) => {
  // Return true to continue, false to stop
  return ctx.errorType !== 'execution';
})
```

### Conversation

| Method | Type | Description |
|--------|------|-------------|
| `.withHistory(messages)` | `HistoryMessage[]` | Add conversation history |
| `.addMessage(message)` | `HistoryMessage` | Add single message |

```typescript
.withHistory([
  { user: 'Hello' },
  { assistant: 'Hi there!' },
])
```

### Lifecycle

| Method | Type | Description |
|--------|------|-------------|
| `.withHooks(hooks)` | `AgentHooks` | Lifecycle hooks |
| `.withLogger(logger)` | `Logger` | Custom tslog logger |
| `.onHumanInput(handler)` | Function | Human input handler |

### Advanced

| Method | Type | Description |
|--------|------|-------------|
| `.withPromptConfig(config)` | `PromptConfig` | Custom prompt templates |
| `.withGadgetStartPrefix(prefix)` | `string` | Custom gadget marker start |
| `.withGadgetEndPrefix(prefix)` | `string` | Custom gadget marker end |
| `.withTextOnlyHandler(handler)` | `TextOnlyHandler` | Handle text-only responses |

## Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | OpenAI | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic | Anthropic API key |
| `GEMINI_API_KEY` | Gemini | Google Gemini API key |

## Quick Methods Options

```typescript
LLMist.complete(prompt, options);
LLMist.stream(prompt, options);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `gpt-5-mini` | Model name or alias |
| `temperature` | `number` | Provider default | Temperature (0-1) |
| `systemPrompt` | `string` | none | System prompt |
| `maxTokens` | `number` | Provider default | Max tokens to generate |

## Execution Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.ask(prompt)` | `Agent` | Create agent (don't run) |
| `.askAndCollect(prompt)` | `Promise<string>` | Run and collect text |
| `.askWith(prompt, handlers)` | `Promise<void>` | Run with event handlers |

## See Also

- **[Getting Started](./GETTING_STARTED.md)** - Quick setup
- **[Providers Guide](./PROVIDERS.md)** - Provider configuration
- **[Hooks Guide](./HOOKS.md)** - Lifecycle hooks
