<p align="center">
  <img src="llmist-icon.png" alt="llmist" width="128" height="128">
</p>

<h1 align="center">llmist</h1>

<p align="center">
  <a href="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml"><img src="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/zbigniewsobiecki/llmist"><img src="https://codecov.io/gh/zbigniewsobiecki/llmist/graph/badge.svg?branch=dev" alt="codecov"></a>
  <a href="https://www.npmjs.com/package/llmist"><img src="https://img.shields.io/npm/v/llmist.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
</p>

<p align="center">
  <strong>Streaming-first multi-provider LLM client in TypeScript with home-made tool calling</strong>
</p>

<p align="center">
  <em>The flexible agent and tool layer for any LLM.</em>
</p>

---

## Installation

```bash
npm install llmist
```

## Packages

| Package | Description |
|---------|-------------|
| [`llmist`](https://www.npmjs.com/package/llmist) | Core library - agents, gadgets, providers |
| [`@llmist/cli`](https://www.npmjs.com/package/@llmist/cli) | Command-line interface |
| [`@llmist/testing`](https://www.npmjs.com/package/@llmist/testing) | Testing utilities and mocks |

## Core Capabilities

### Gadget System (Home-Made Tool Calling)

llmist implements its own tool calling syntax called "gadgets" - no native function calling or structured output required.

- **[LLM- and streaming-friendly block format](https://llmist.dev/reference/block-format/)** — Tools execute the moment their block is parsed, not after the response completes
- **[Built-in dependencies](https://llmist.dev/reference/block-format/#dependencies)** — DAG execution with parallel independent gadgets and sequential dependent ones
- **Works with any model** — Any LLM that can follow instructions can use gadgets
- **Configurable syntax markers** — Customize the block delimiters to fit your needs

### Agent API

Low-boilerplate, TypeScript-first API for building agents and subagents.

- **[Fluent builder pattern](https://llmist.dev/library/getting-started/quick-start/)** — Chainable `.withModel()`, `.withGadgets()`, `.withHooks()` configuration
- **Full TypeScript inference** — Gadget parameters are typed from Zod schemas, no assertions needed
- **[Class & function gadgets](https://llmist.dev/library/guides/creating-gadgets/)** — Classes for complex tools, simple functions for quick ones
- **[Subagent spawning](https://llmist.dev/library/advanced/subagents/)** — Nested agents for complex multi-step tasks

### Hook System

Three-layer architecture for deep integration with agent execution. [Learn more →](https://llmist.dev/library/guides/hooks/)

- **Observers** — Read-only monitoring for logging and analytics
- **Interceptors** — Synchronous transforms for modifying messages
- **Controllers** — Async lifecycle control for flow management

Use cases: observability, flow control, benchmarking, [human-in-the-loop](https://llmist.dev/library/guides/human-in-loop/), deep app/UI integration.

### Multi-Provider Support

First-class support for multiple LLM providers with unified API. [Learn more →](https://llmist.dev/library/providers/overview/)

- **[OpenAI, Anthropic, Gemini, HuggingFace](https://llmist.dev/library/providers/overview/)** — Auto-discovery from environment variables
- **Caching-aware** — Tracks cached vs. uncached tokens for accurate metrics
- **[Built-in cost calculation](https://llmist.dev/library/guides/cost-tracking/)** — Real-time token counting and cost estimation
- **[Multimodal](https://llmist.dev/library/advanced/multimodal/)** — Vision and image input support
- **[Extensible](https://llmist.dev/library/advanced/custom-models/)** — Add custom providers or models

### CLI & TUI

Developer-first command-line experience for running and building agents. [Learn more →](https://llmist.dev/cli/getting-started/introduction/)

- **[Config-driven](https://llmist.dev/cli/configuration/toml-reference/)** — TOML configuration for reusable profiles and templates
- **[3rd party gadget system](https://llmist.dev/cli/gadgets/external-gadgets/)** — Load gadgets from local files, git URLs, or npm packages
- **[Publish your own](https://llmist.dev/cli/gadgets/local-gadgets/)** — Write and easily share your gadgetry
- **Raw LLM access** — Control over logging and direct access to request/response content
- **[Interactive TUI](https://llmist.dev/cli/tui/overview/)** — Browse execution history, inspect raw payloads

### Testing Infrastructure

Full mocking for deterministic, LLM-free testing. [Learn more →](https://llmist.dev/testing/getting-started/introduction/)

- **[MockBuilder](https://llmist.dev/testing/mocking/overview/)** — Fluent API for scripting mock responses
- **[Gadget testing](https://llmist.dev/testing/gadgets/test-gadget/)** — `testGadget()` utility for isolated gadget tests
- **Agent mocking** — Test full agent flows without API calls

## Quick Start

### Library

```bash
npm install llmist
export OPENAI_API_KEY="sk-..."  # or ANTHROPIC_API_KEY, GEMINI_API_KEY, HF_TOKEN
```

```typescript
import { LLMist, Gadget, z } from 'llmist';

class DialUp extends Gadget({
  description: 'Simulates connecting to the internet via 56k modem',
  schema: z.object({
    phoneNumber: z.string().describe('ISP dial-up number'),
    baud: z.enum(['14400', '28800', '33600', '56000']).default('56000'),
  }),
}) {
  execute(params: this['params']): string {
    return `ATDT ${params.phoneNumber}... CONNECT ${params.baud}. You've got mail!`;
  }
}

const answer = await LLMist.createAgent()
  .withModel('sonnet')
  .withGadgets(DialUp)
  .askAndCollect('Connect me to AOL');
```

### CLI

```bash
npm install -g @llmist/cli

# Quick completion
llmist complete "Explain TypeScript generics"

# Run agent with local gadgets
llmist agent "Search for files" --gadgets ./my-gadgets/

# Use BrowseWeb subagent from Dhalsim for web automation
llmist agent "Find the iPhone 16 Pro price on apple.com" --gadgets dhalsim/BrowseWeb
```

See [Dhalsim](https://github.com/zbigniewsobiecki/dhalsim) for browser automation gadgets.

### Testing

```bash
npm install -D @llmist/testing
```

```typescript
import { testGadget, mockLLM, createMockClient } from '@llmist/testing';

// Test gadgets in isolation
const result = await testGadget(new Calculator(), { a: 5, b: 3 });
expect(result.result).toBe('8');

// Mock LLM responses for agent tests
mockLLM()
  .whenMessageContains('hello')
  .returns('Hi there! How can I help?')
  .register();

const agent = LLMist.createAgent()
  .withClient(createMockClient());

const response = await agent.askAndCollect('hello');
// Deterministic result, no API calls
```

## Documentation

Browse documentation at [llmist.dev](https://llmist.dev).

## Examples

All examples are in the [`examples/`](/examples/) directory:

```bash
npx tsx examples/01-basic-usage.ts
```

See [`examples/README.md`](/examples/README.md) for the full list.

## Development

```bash
npm install
npm run build     # Build all packages
npm run test      # Test all packages
npm run lint      # Lint and format
```

## Contributing

See [CONTRIBUTING.md](/CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](/LICENSE)

---

<p align="center">
  <a href="https://www.npmjs.com/package/llmist">npm</a> •
  <a href="https://github.com/zbigniewsobiecki/llmist">GitHub</a> •
  <a href="https://github.com/zbigniewsobiecki/llmist/issues">Issues</a>
</p>
