---
title: Agent Configuration
description: Configure agents for common use cases and scenarios
---

This guide shows how to configure llmist agents for common use cases, from simple completions to complex multi-tool workflows.

## Basic Patterns

### Simple Q&A Agent

Quick responses without tools:

```typescript
const answer = await LLMist.createAgent()
  .withModel('haiku')          // Fast, cheap model
  .withSystem('You are a helpful assistant.')
  .askAndCollect('What is the capital of France?');
```

### Tool-Using Agent

Agent with gadgets for specific capabilities:

```typescript
const result = await LLMist.createAgent()
  .withModel('sonnet')
  .withSystem('You are an arcade historian.')
  .withGadgets(ArcadeHighScore, FloppyDisk)
  .withMaxIterations(5)
  .askAndCollect('What were the top Pac-Man scores and how many floppies to back them up?');
```

### Long-Running Task Agent

For complex multi-step tasks:

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(FileReader, FileWriter, ShellCommand)
  .withMaxIterations(50)
  .withCompaction({
    triggerThresholdPercent: 70,
    preserveRecentTurns: 15,
  })
  .withHooks(HookPresets.monitoring());

for await (const event of agent.ask('Refactor the auth module').run()) {
  // Handle events
}
```

## Model Selection

### By Use Case

| Use Case | Recommended Model | Why |
|----------|-------------------|-----|
| Quick Q&A | `haiku` | Fast, cheap |
| Code generation | `sonnet` | Good balance |
| Complex reasoning | `opus` or `o3` | Best quality, use `.withReasoning("high")` |
| Bulk processing | `flash` | Cost-effective |
| Simple extraction | `gpt-5-nano` | Affordable |

### Dynamic Selection

```typescript
const selectModel = (task: string) => {
  if (task.includes('simple')) return 'haiku';
  if (task.includes('code')) return 'sonnet';
  return 'gpt-5-nano';
};

const agent = LLMist.createAgent()
  .withModel(selectModel(userTask))
  .ask(userTask);
```

## Error Handling Strategies

### Fail Fast (Default)

Stop on first error:

```typescript
.withStopOnGadgetError(true)
```

### Resilient Mode

Continue despite errors:

```typescript
.withStopOnGadgetError(false)
.withErrorHandler((ctx) => {
  logger.warn(`Gadget ${ctx.gadgetName} failed:`, ctx.error);
  return true;  // Continue
})
```

### Selective Recovery

```typescript
.withErrorHandler((ctx) => {
  // Stop on critical errors
  if (ctx.gadgetName === 'DatabaseWrite') {
    return false;  // Stop
  }
  // Continue on non-critical errors
  return true;
})
```

### Automatic Retry

Retry on rate limits and transient errors:

```typescript
.withRetry({
  retries: 5,
  minTimeout: 2000,
  maxTimeout: 60000,
  onRetry: (error, attempt) => {
    console.log(`Retry ${attempt}: ${error.message}`);
  },
})

// Or disable retry
.withoutRetry()
```

## Conversation Patterns

### With History

Continue from previous conversation:

```typescript
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withHistory([
    { user: 'My name is Alice' },
    { assistant: 'Nice to meet you, Alice!' },
  ])
  .askAndCollect('What is my name?');
// "Your name is Alice"
```

### Multi-Turn Interaction

```typescript
const conversation = [];
const agent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(FloppyDisk);

// First turn
conversation.push({ user: 'How many floppies for a 10MB file?' });
const response1 = await agent
  .withHistory(conversation)
  .askAndCollect('How many floppies for a 10MB file?');
conversation.push({ assistant: response1 });

// Second turn
conversation.push({ user: 'What about a 50MB file?' });
const response2 = await agent
  .withHistory(conversation)
  .askAndCollect('What about a 50MB file?');
```

### Trailing Messages

Add ephemeral context to each request:

```typescript
// Static reminder
.withTrailingMessage('Always respond in JSON format.')

// Dynamic context
.withTrailingMessage((ctx) =>
  `[Iteration ${ctx.iteration}/${ctx.maxIterations}]`
)

// Inject current state
let status = 'pending';
.withTrailingMessage(() => `Current status: ${status}`)
```

## Production Configurations

### Development Mode

Full visibility for debugging:

```typescript
const devAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(MyGadgets)
  .withHooks(HookPresets.monitoring({ verbose: true }))
  .withLogger(createLogger({ minLevel: 'debug' }));
```

### Production Mode

Minimal overhead, error tracking:

```typescript
const prodAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(MyGadgets)
  .withHooks(HookPresets.merge(
    HookPresets.errorLogging(),
    HookPresets.tokenTracking(),
  ))
  .withRetry({ retries: 3 })
  .withCompaction({ enabled: true });
```

### Cost-Conscious Mode

Minimize API costs:

```typescript
const cheapAgent = LLMist.createAgent()
  .withModel('haiku')  // Cheapest model
  .withMaxIterations(5)  // Limit iterations
  .withCompaction({
    strategy: 'sliding-window',  // No summarization cost
    triggerThresholdPercent: 60,
  })
  .withHooks(HookPresets.tokenTracking());  // Monitor costs
```

### High-Reliability Mode

Maximum reliability for critical tasks:

```typescript
const reliableAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(MyGadgets)
  .withRetry({
    retries: 5,
    minTimeout: 5000,
    maxTimeout: 120000,
  })
  .withDefaultGadgetTimeout(60000)
  .withErrorHandler((ctx) => {
    alertOps(`Gadget error: ${ctx.gadgetName}`, ctx.error);
    return ctx.errorType !== 'timeout';
  });
```

## Specialized Agents

### Code Assistant

```typescript
const codeAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withSystem(`You are an expert programmer.
    - Write clean, tested code
    - Follow best practices
    - Explain your reasoning`)
  .withGadgets(ReadFile, WriteFile, RunTests, ShellCommand)
  .withMaxIterations(20)
  .withTemperature(0.3);  // More deterministic
```

### Reasoning Agent

```typescript
const reasoningAgent = LLMist.createAgent()
  .withModel('o3')          // Or opus, pro — any reasoning-capable model
  .withReasoning('high')    // "none" | "low" | "medium" | "high" | "maximum"
  .withSystem(`You are an expert mathematician.
    - Show your work step by step
    - Verify your answers`)
  .withGadgets(Calculator, Wolfram)
  .withMaxIterations(10);
```

See the [Reasoning Models](/library/guides/reasoning-models/) guide for full details on effort levels and provider mapping.

### Caching Agent

Reduce latency and cost for conversations with large, repeated context:

```typescript
// Gemini: explicit caching for large system prompts
const geminiAgent = LLMist.createAgent()
  .withModel('gemini:gemini-2.5-flash')
  .withSystem(longCodebaseContext)      // Large context benefits most
  .withCaching({ enabled: true, scope: 'system', ttl: '3600s' })
  .withMaxIterations(20);

// Anthropic: caching is automatic, but can be disabled
const anthropicAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withoutCaching()   // Opt out of prompt caching
  .ask('Quick question');
```

See the provider pages for [Anthropic](/library/providers/anthropic/) and [Gemini](/library/providers/gemini/) caching details.

### Research Agent

```typescript
const researchAgent = LLMist.createAgent()
  .withModel('opus')  // Best reasoning
  .withSystem(`You are a research assistant.
    - Verify information from multiple sources
    - Cite your sources
    - Distinguish facts from opinions`)
  .withGadgets(WebSearch, ReadURL, TakeNotes)
  .withMaxIterations(30)
  .withCompaction({
    strategy: 'summarization',  // Preserve research context
    preserveRecentTurns: 20,
  });
```

### Data Processing Agent

```typescript
const dataAgent = LLMist.createAgent()
  .withModel('flash')  // Fast and cheap
  .withSystem('Process data accurately. Report errors clearly.')
  .withGadgets(ReadCSV, WriteCSV, Transform)
  .withMaxIterations(100)
  .withStopOnGadgetError(false)  // Continue on individual errors
  .withCompaction({
    strategy: 'sliding-window',
    preserveRecentTurns: 5,
  });
```

### Interactive Assistant

```typescript
const interactiveAgent = LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(AskUser, TellUser, FloppyDisk)
  .onHumanInput(async (question) => {
    return await showPrompt(question);
  })
  .withTextOnlyHandler('wait_for_input');
```

## Custom Block Format

Change gadget markers if needed:

```typescript
.withGadgetStartPrefix('<<TOOL_START>>')
.withGadgetEndPrefix('<<TOOL_END>>')
.withGadgetArgPrefix('<<PARAM>>')
```

Or in CLI config:

```toml
[agent]
gadget-start-prefix = "<<TOOL_START>>"
gadget-end-prefix = "<<TOOL_END>>"
gadget-arg-prefix = "<<PARAM>>"
```

## Event-Driven Processing

### Selective Event Handling

```typescript
await agent.askWith('Process this task', {
  onText: (text) => updateUI(text),
  onGadgetCall: (call) => showSpinner(call.gadgetName),
  onGadgetResult: (result) => hideSpinner(),
  onError: (error) => showError(error),
});
```

### Full Stream Control

```typescript
for await (const event of agent.ask('Task').run()) {
  switch (event.type) {
    case 'text':
      appendText(event.content);
      break;
    case 'gadget_call':
      logGadgetCall(event);
      break;
    case 'gadget_result':
      logGadgetResult(event);
      break;
    case 'compaction':
      logCompaction(event);
      break;
    case 'iteration_complete':
      updateProgress(event.iteration);
      break;
  }
}
```

## Environment-Based Configuration

```typescript
const config = {
  model: process.env.LLM_MODEL || 'sonnet',
  maxIterations: parseInt(process.env.MAX_ITERATIONS || '10'),
  logLevel: process.env.LOG_LEVEL || 'warn',
};

const agent = LLMist.createAgent()
  .withModel(config.model)
  .withMaxIterations(config.maxIterations)
  .withLogger(createLogger({ minLevel: config.logLevel }))
  .withHooks(
    process.env.NODE_ENV === 'production'
      ? HookPresets.errorLogging()
      : HookPresets.monitoring({ verbose: true })
  );
```

## See Also

- [Models & Aliases](/reference/models/) - All available models
- [Hooks Guide](/library/guides/hooks/) - Lifecycle hooks
- [Compaction](/library/advanced/compaction/) - Context management
- [Cost Tracking](/library/guides/cost-tracking/) - Monitor costs
- [Reasoning Models](/library/guides/reasoning-models/) - Thinking/reasoning support
- [Streaming Guide](/library/guides/streaming/) - Event handling
