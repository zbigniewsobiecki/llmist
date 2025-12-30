# llmist

<p align="center">
  <a href="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml"><img src="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/zbigniewsobiecki/llmist"><img src="https://codecov.io/gh/zbigniewsobiecki/llmist/graph/badge.svg?branch=dev" alt="codecov"></a>
  <a href="https://www.npmjs.com/package/llmist"><img src="https://img.shields.io/npm/v/llmist.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
</p>

**Streaming-first multi-provider LLM client in TypeScript with home-made tool calling.**

llmist implements its own tool calling syntax called "gadgets" - tools execute the moment their block is parsed, not after the response completes. Works with any model that can follow instructions.

## Installation

```bash
npm install llmist
```

## Quick Start

```typescript
import { Gadget, LLMist, z } from 'llmist';

// Define a gadget (tool) with Zod schema
class Calculator extends Gadget({
  description: 'Performs arithmetic operations',
  schema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(params: this['params']): string {
    const { operation, a, b } = params;
    switch (operation) {
      case 'add': return String(a + b);
      case 'subtract': return String(a - b);
      case 'multiply': return String(a * b);
      case 'divide': return String(a / b);
    }
  }
}

// Run the agent
const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(Calculator)
  .askAndCollect('What is 15 times 23?');

console.log(answer);
```

## Features

- **Streaming-first** - Tools execute mid-stream, not after response completes
- **Multi-provider** - OpenAI, Anthropic, Gemini with unified API
- **Type-safe** - Full TypeScript inference from Zod schemas
- **Flexible hooks** - Observers, interceptors, and controllers for deep integration
- **Built-in cost tracking** - Real-time token counting and cost estimation
- **Multimodal** - Vision and audio input support

## Providers

Set one of these environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

Use model aliases for convenience:

```typescript
.withModel('sonnet')   // Claude 3.5 Sonnet
.withModel('opus')     // Claude Opus 4
.withModel('gpt4o')    // GPT-4o
.withModel('flash')    // Gemini 2.0 Flash
```

## Documentation

Full documentation at [llmist.dev](https://llmist.dev)

- [Getting Started](https://llmist.dev/library/getting-started/introduction/)
- [Creating Gadgets](https://llmist.dev/library/guides/creating-gadgets/)
- [Hooks System](https://llmist.dev/library/guides/hooks/)
- [Provider Configuration](https://llmist.dev/library/providers/overview/)

## Examples

See the [examples directory](https://github.com/zbigniewsobiecki/llmist/tree/main/examples) for runnable examples covering all features.

## Related Packages

- [`@llmist/cli`](https://www.npmjs.com/package/@llmist/cli) - Command-line interface
- [`@llmist/testing`](https://www.npmjs.com/package/@llmist/testing) - Testing utilities and mocks

## License

MIT
