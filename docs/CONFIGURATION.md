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

### Error Handling & Retry

| Method | Type | Default | Description |
|--------|------|---------|-------------|
| `.withStopOnGadgetError(stop)` | `boolean` | `true` | Stop on first gadget error |
| `.withErrorHandler(handler)` | Function | none | Custom error handling |
| `.withRetry(config)` | `RetryConfig` | Enabled, 3 retries | Configure retry with exponential backoff |
| `.withoutRetry()` | - | - | Disable automatic retry |

```typescript
.withErrorHandler((ctx) => {
  // Return true to continue, false to stop
  return ctx.errorType !== 'execution';
})

// Configure retry behavior for rate limits and transient errors
.withRetry({
  retries: 5,           // Max retry attempts
  minTimeout: 2000,     // Initial delay (ms)
  maxTimeout: 60000,    // Max delay (ms)
  onRetry: (error, attempt) => console.log(`Retry ${attempt}`),
})

// Disable retry entirely
.withoutRetry()
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
| `.withTrailingMessage(message)` | `string \| Function` | Ephemeral message appended to each request |

#### Trailing Messages

Add an ephemeral message that appears at the end of each LLM request but is **not** persisted to conversation history. This is useful for:

- **Reminders**: Instructions that need to be reinforced on every turn
- **Context injection**: Current state or status that changes independently
- **Format enforcement**: "Always respond in JSON format"

```typescript
// Static message
LLMist.createAgent()
  .withTrailingMessage("Always respond in JSON format.")
  .ask("List users");

// Dynamic message based on iteration
LLMist.createAgent()
  .withTrailingMessage((ctx) =>
    `[Iteration ${ctx.iteration}/${ctx.maxIterations}] Focus on completing the current task.`
  )
  .ask("Build a web app");

// Inject current status/state
let taskStatus = "pending";
LLMist.createAgent()
  .withTrailingMessage(() =>
    `[Current task status: ${taskStatus}] Adjust your approach based on this status.`
  )
  .ask("Process tasks");
```

**Key behavior:**
- Message is ephemeral - only appears in the current LLM request
- Not persisted to conversation history
- Composes with existing `beforeLLMCall` hooks
- Respects "skip" action from existing controllers

### Advanced

| Method | Type | Description |
|--------|------|-------------|
| `.withPromptConfig(config)` | `PromptTemplateConfig` | Custom prompt templates |
| `.withGadgetStartPrefix(prefix)` | `string` | Custom gadget marker start (default: `!!!GADGET_START:`) |
| `.withGadgetEndPrefix(prefix)` | `string` | Custom gadget marker end (default: `!!!GADGET_END`) |
| `.withGadgetArgPrefix(prefix)` | `string` | Custom argument prefix for block format (default: `!!!ARG:`) |
| `.withTextOnlyHandler(handler)` | `TextOnlyHandler` | Handle text-only responses |
| `.withTextWithGadgetsHandler(handler)` | `object` | Wrap text alongside gadget calls |

#### Custom Prefixes

All three marker prefixes can be customized if you need to avoid conflicts with your content or match existing systems:

```typescript
LLMist.createAgent()
  .withGadgetStartPrefix("<<GADGET_START>>")
  .withGadgetEndPrefix("<<GADGET_END>>")
  .withGadgetArgPrefix("<<ARG>>")
  // ...
```

Or in CLI config (`~/.llmist/cli.toml`):

```toml
[agent]
gadget-start-prefix = "<<GADGET_START>>"
gadget-end-prefix = "<<GADGET_END>>"
gadget-arg-prefix = "<<ARG>>"
```

#### Text Handling Configuration

Control how text responses are handled in the agent loop:

```typescript
// Handle text-only responses (when LLM doesn't call any gadgets)
.withTextOnlyHandler("acknowledge")  // Continue loop
.withTextOnlyHandler("terminate")    // End loop (default)
.withTextOnlyHandler("wait_for_input") // Ask for human input

// Wrap text that accompanies gadget calls as synthetic gadget calls
// This keeps conversation history consistent and gadget-oriented
.withTextWithGadgetsHandler({
  gadgetName: "TellUser",
  parameterMapping: (text) => ({ message: text, done: false, type: "info" }),
  resultMapping: (text) => `ℹ️  ${text}`,  // Optional: format the result
})
```

The `textWithGadgetsHandler` is useful when you want text that appears alongside gadget calls to also appear in the conversation history as an explicit gadget call. This helps LLMs maintain a consistent "gadget invocation" mindset.

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
