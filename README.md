# llmist

[![CI](https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml/badge.svg)](https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zbigniewsobiecki/llmist/graph/badge.svg?branch=dev)](https://codecov.io/gh/zbigniewsobiecki/llmist)
[![npm version](https://img.shields.io/npm/v/llmist.svg)](https://www.npmjs.com/package/llmist)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **Tools execute while the LLM streams. Any model. Clean API.**

> **⚠️ EARLY WORK IN PROGRESS** - This library is under active development. APIs may change without notice. Use in production at your own risk.

Most LLM libraries buffer the entire response before parsing tool calls. **llmist parses incrementally.**

Your gadgets (tools) fire the instant they're complete in the stream—giving your users immediate feedback. llmist implements its own function calling mechanism via a simple text-based block format. No JSON mode required. No native tool support needed. Works with OpenAI, Anthropic, and Gemini out of the box—extensible to any provider.

A fluent, async-first API lets you plug into any part of the agent loop. Fully typed. Composable. Your code stays clean. 

---

## 🎯 Why llmist?

<table>
<tr>
<td width="33%" valign="top">

### ⚡ Streaming Tool Execution
Gadgets execute the moment their block is parsed—not after the response completes. Real-time UX without buffering.

```typescript
// Tool fires mid-stream
for await (const event of agent.run()) {
  if (event.type === 'gadget_result')
    updateUI(event.result); // Immediate
}
```

</td>
<td width="33%" valign="top">

### 🧩 Built-in Function Calling
llmist implements its own tool calling via a simple block format. No `response_format: json`. No native tool support needed. Works with any model from supported providers.

```
!!!GADGET_START[Calculator]
!!!ARG[operation] add
!!!ARG[a] 15
!!!ARG[b] 23
!!!GADGET_END
```

*Markers are fully [configurable](./docs/BLOCK_FORMAT.md).*

</td>
<td width="33%" valign="top">

### 🔌 Composable Agent API
Fluent builder, async iterators, full TypeScript inference. Hook into any lifecycle point. Your code stays readable.

```typescript
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator, Weather)
  .withHooks(HookPresets.monitoring())
  .askAndCollect('What is 15 + 23?');
```

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Installation

```bash
npm install llmist
# or
bun add llmist
```

---

## 🖥️ Command Line Interface

```bash
# Quick completion
bunx llmist complete "Explain TypeScript generics" --model haiku

# Agent with tools
bunx llmist agent "Calculate 15 * 23" --gadget ./calculator.ts --model sonnet

# External gadgets (npm/git - auto-installed)
bunx llmist agent "Browse apple.com" --gadget webasto --model sonnet
bunx llmist agent "Screenshot google.com" --gadget webasto:minimal
bunx llmist agent "Navigate to site" --gadget git+https://github.com/user/gadgets.git

# Pipe input
cat document.txt | llmist complete "Summarize" --model gpt-5-nano
```

📖 **[CLI Reference](./docs/CLI.md)** | **[CLI Gadgets Guide](./docs/CLI_GADGETS.md)**


### Your First Agent

```typescript
import { LLMist, Gadget, z } from 'llmist';

// Define a tool (called "gadget" in llmist)
class Calculator extends Gadget({
  description: 'Performs arithmetic operations',
  schema: z.object({
    operation: z.enum(['add', 'multiply', 'subtract', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(params: this['params']): string {
    const { operation, a, b } = params; // Automatically typed!
    switch (operation) {
      case 'add': return `${a + b}`;
      case 'multiply': return `${a * b}`;
      case 'subtract': return `${a - b}`;
      case 'divide': return `${a / b}`;
      default: throw new Error('Unknown operation');
    }
  }
}

// Create and run agent with fluent API
const answer = await LLMist.createAgent()
  .withModel('gpt-5-nano')  // Model shortcuts: sonnet, haiku, etc.
  .withSystem('You are a helpful math assistant')
  .withGadgets(Calculator)
  .askAndCollect('What is 15 times 23?');

console.log(answer); // "15 times 23 equals 345"
```

**That's it!**

📖 **[Getting Started Guide](./docs/GETTING_STARTED.md)** - Learn more in 5 minutes

---

## ✨ Key Features

### 🌐 Multi-Provider Support

```typescript
// Use model shortcuts
.withModel('gpt-5-nano')    // OpenAI gpt-5-nano
.withModel('sonnet')       // Claude Sonnet 4.5
.withModel('haiku')        // Claude Haiku 4.5
.withModel('flash')        // Gemini 2.0 Flash

// Or full names
.withModel('openai:gpt-5-nano')
.withModel('anthropic:claude-sonnet-4-5')
.withModel('gemini:gemini-2.0-flash')
```

**Automatic provider discovery** - Just set API keys as env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)

📖 **[Providers Guide](./docs/PROVIDERS.md)** | **[Model Catalog](./docs/MODEL_CATALOG.md)**

### 🛠️ Flexible Gadgets (Tools)

Two ways to create tools:

```typescript
// 1. Class-based with type safety
class Weather extends Gadget({
  description: 'Get weather for a city',
  schema: z.object({ city: z.string() }),
}) {
  async execute(params: this['params']) {
    // params is auto-typed!
    const data = await fetch(`https://api.weather.com/${params.city}`);
    return `Weather: ${data.temp}°C`;
  }
}

// 2. Functional for simplicity
const calculator = createGadget({
  description: 'Arithmetic operations',
  schema: z.object({ operation: z.enum(['add']), a: z.number(), b: z.number() }),
  execute: ({ operation, a, b }) => `${a + b}`,
});
```

📖 **[Gadgets Guide](./docs/GADGETS.md)** | **[Examples](./examples/02-custom-gadgets.ts)**

### 🪝 Lifecycle Hooks

Monitor, transform, and control agent execution with ready-to-use presets or custom hooks:

**Quick start with presets:**

```typescript
import { LLMist, HookPresets } from 'llmist';

// Full monitoring suite (recommended for development)
await LLMist.createAgent()
  .withHooks(HookPresets.monitoring())
  .ask('Your prompt');
// Output: Logs + timing + token tracking + error logging

// Combine specific presets for focused monitoring
await LLMist.createAgent()
  .withHooks(HookPresets.merge(
    HookPresets.timing(),
    HookPresets.tokenTracking()
  ))
  .ask('Your prompt');
```

**Available presets:**
- `logging()` / `logging({ verbose: true })` - Event logging with optional details
- `timing()` - Execution time measurements
- `tokenTracking()` - Cumulative token usage and cost tracking
- `errorLogging()` - Detailed error information
- `silent()` - No output (for testing)
- `monitoring()` - All-in-one preset combining logging, timing, tokens, and errors
- `merge()` - Combine multiple presets or add custom hooks

**Production vs Development patterns:**

```typescript
// Environment-based configuration
const isDev = process.env.NODE_ENV === 'development';
const hooks = isDev
  ? HookPresets.monitoring({ verbose: true })  // Full visibility in dev
  : HookPresets.merge(
      HookPresets.errorLogging(),              // Only errors in prod
      HookPresets.tokenTracking()              // Track costs
    );

await LLMist.createAgent()
  .withHooks(hooks)
  .ask('Your prompt');
```

**Custom hooks for advanced control:**

```typescript
// Observers: read-only monitoring
.withHooks({
  observers: {
    onLLMCallComplete: async (ctx) => {
      console.log(`Used ${ctx.usage?.totalTokens} tokens`);
      await sendMetricsToDataDog(ctx);
    },
  },
})

// Interceptors: transform data in flight
.withHooks({
  interceptors: {
    interceptTextChunk: (chunk) => chunk.toUpperCase(),
  },
})

// Controllers: control execution flow
.withHooks({
  controllers: {
    beforeLLMCall: async (ctx) => {
      if (shouldCache(ctx)) {
        return { action: 'skip', syntheticResponse: cachedResponse };
      }
      return { action: 'proceed' };
    },
  },
})
```

📖 **[Hooks Guide](./docs/HOOKS.md)** | **[Examples](./examples/03-hooks.ts)**

### 💬 Human-in-the-Loop

```typescript
class AskUser extends Gadget({
  description: 'Ask the user a question',
  schema: z.object({ question: z.string() }),
}) {
  execute(params: this['params']) {
    throw new HumanInputException(params.question);
  }
}

await LLMist.createAgent()
  .withGadgets(AskUser)
  .onHumanInput(async (question) => {
    return await promptUser(question);
  })
  .ask('Help me plan my vacation');
```

📖 **[Human-in-the-Loop Guide](./docs/HUMAN_IN_LOOP.md)** | **[Examples](./examples/04-human-in-loop.ts)**

### ⚡ Streaming & Event Handling

```typescript
// Collect all text
const answer = await LLMist.createAgent()
  .withModel('haiku')
  .askAndCollect('Tell me a joke');

// Handle specific events
await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator)
  .askWith('Calculate 2 + 2', {
    onText: (text) => console.log('LLM:', text),
    onGadgetCall: (call) => console.log('Calling:', call.gadgetName),
    onGadgetResult: (result) => console.log('Result:', result.result),
  });

// Manual control
const agent = LLMist.createAgent().withModel('gpt-5-nano').ask('Question');
for await (const event of agent.run()) {
  if (event.type === 'text') console.log(event.content);
}
```

📖 **[Streaming Guide](./docs/STREAMING.md)** | **[Examples](./examples/05-streaming.ts)**

### 🔗 Gadget Dependencies (DAG Execution)

LLMs can specify execution order between gadgets. Independent gadgets run in parallel; dependent gadgets wait for their dependencies. Failed dependencies automatically skip downstream gadgets.

📖 **[Block Format](./docs/BLOCK_FORMAT.md#dependencies)** | **[Example](./examples/11-gadget-dependencies.ts)**

### 🧪 Mock Testing

```typescript
import { LLMist, mockLLM, createMockClient } from 'llmist';

mockLLM()
  .forModel('gpt-5')
  .whenMessageContains('calculate')
  .returns('The answer is 42')
  .register();

const mockClient = createMockClient();
const answer = await mockClient.createAgent()
  .withModel('gpt-5')
  .askAndCollect('Calculate 2 + 2');

console.log(answer); // "The answer is 42" - no API call made!
```

📖 **[Testing Guide](./docs/TESTING.md)** | **[Examples](./examples/mock-testing-example.ts)**

### 📊 Model Catalog & Cost Estimation

```typescript
const client = new LLMist();

// Get model specs
const gpt5 = client.modelRegistry.getModelSpec('gpt-5');
console.log(gpt5.contextWindow);    // 272000
console.log(gpt5.pricing.input);    // 1.25 per 1M tokens

// Estimate costs
const cost = client.modelRegistry.estimateCost('gpt-5', 10_000, 2_000);
console.log(`$${cost.totalCost.toFixed(4)}`);

// Find cheapest model
const cheapest = client.modelRegistry.getCheapestModel(10_000, 2_000);
```

📖 **[Model Catalog Guide](./docs/MODEL_CATALOG.md)** | **[Custom Models](./docs/CUSTOM_MODELS.md)**

### 🔢 Native Token Counting

```typescript
const messages = [
  { role: 'system', content: 'You are helpful' },
  { role: 'user', content: 'Explain quantum computing' }
];

const tokens = await client.countTokens('openai:gpt-5', messages);
const cost = client.modelRegistry.estimateCost('gpt-5', tokens, 1000);
```

Uses provider-specific methods (tiktoken for OpenAI, native APIs for Anthropic/Gemini).

---

## 📚 Documentation

**Getting Started**
- **[Getting Started](./docs/GETTING_STARTED.md)** - Your first agent in 5 minutes
- **[Configuration](./docs/CONFIGURATION.md)** - All available options
- **[Quick Methods](./docs/QUICK_METHODS.md)** - Simple APIs for basic tasks

**Core Concepts**
- **[Gadgets (Tools)](./docs/GADGETS.md)** - Creating custom functions
- **[Block Format](./docs/BLOCK_FORMAT.md)** - Parameter syntax reference
- **[Hooks](./docs/HOOKS.md)** - Lifecycle monitoring and control
- **[Streaming](./docs/STREAMING.md)** - Real-time response handling
- **[Human-in-the-Loop](./docs/HUMAN_IN_LOOP.md)** - Interactive workflows

**Advanced**
- **[Providers](./docs/PROVIDERS.md)** - Multi-provider configuration
- **[Model Catalog](./docs/MODEL_CATALOG.md)** - Querying models and costs
- **[Custom Models](./docs/CUSTOM_MODELS.md)** - Register fine-tuned models
- **[Error Handling](./docs/ERROR_HANDLING.md)** - Recovery strategies
- **[Testing](./docs/TESTING.md)** - Mocking and test strategies

**Reference**
- **[CLI Reference](./docs/CLI.md)** - Command-line interface
- **[Architecture](./docs/ARCHITECTURE.md)** - Technical deep-dive
- **[Debugging](./docs/DEBUGGING.md)** - Capture raw prompts/responses
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues

---

## 🎓 Examples

Comprehensive examples are available in the **[examples/](./examples/)** directory:

| Example | Description |
|---------|-------------|
| **[01-basic-usage.ts](./examples/01-basic-usage.ts)** | Simple agent with calculator gadget |
| **[02-custom-gadgets.ts](./examples/02-custom-gadgets.ts)** | Async gadgets, validation, loop termination |
| **[03-hooks.ts](./examples/03-hooks.ts)** | Lifecycle hooks for monitoring |
| **[04-human-in-loop.ts](./examples/04-human-in-loop.ts)** | Interactive conversations |
| **[05-streaming.ts](./examples/05-streaming.ts)** | Real-time streaming |
| **[06-model-catalog.ts](./examples/06-model-catalog.ts)** | Model queries and cost estimation |
| **[07-logging.ts](./examples/07-logging.ts)** | Logging and debugging |
| **[13-syntactic-sugar.ts](./examples/13-syntactic-sugar.ts)** | Fluent API showcase |
| **[11-gadget-dependencies.ts](./examples/11-gadget-dependencies.ts)** | Gadget dependencies (DAG execution) |
| **[20-external-gadgets.ts](./examples/20-external-gadgets.ts)** | npm/git gadget packages |

**Run any example:**
```bash
bun install && bun run build
bunx tsx examples/01-basic-usage.ts
```

See **[examples/README.md](./examples/README.md)** for full list and details.

---

## 🏗️ Architecture

llmist follows **SOLID principles** with a composable architecture.

**Key components:**
- **LLMist** - Provider-agnostic streaming client
- **Agent** - Full agent loop with automatic orchestration
- **StreamProcessor** - Process LLM streams with custom event loops
- **GadgetExecutor** - Execute tools with timeout and error handling
- **GadgetRegistry** - Registry for available tools

📖 **[Architecture Guide](./docs/ARCHITECTURE.md)** for detailed design documentation

---

## 🧪 Development

```bash
bun install

# Run tests
bun test              # All tests
bun run test:unit     # Unit tests only
bun run test:e2e      # E2E tests only

# Build and lint
bun run build
bun run lint
bun run format
```

---

## 🤝 Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines, commit conventions, and release process.

---

## 📄 License

MIT - see [LICENSE](./LICENSE) for details.

---

## 🔗 Links

- 📦 [npm Package](https://www.npmjs.com/package/llmist)
- 🐙 [GitHub Repository](https://github.com/zbigniewsobiecki/llmist)
- 📚 [Full Documentation](./docs/)
- 🐛 [Issue Tracker](https://github.com/zbigniewsobiecki/llmist/issues)

---

Made with 🤪 by the llmist team
