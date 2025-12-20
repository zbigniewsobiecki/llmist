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
  <strong>TypeScript LLM client with streaming tool execution</strong>
</p>

<p align="center">
  <em>Tools execute while the LLM streams. Any model. Clean API.</em>
</p>

---

> **⚠️ EARLY WORK IN PROGRESS** - This library is under active development. APIs may change without notice.

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

## Features

### Core Library (`llmist`)

| Feature | Description | Docs | Example |
|---------|-------------|------|---------|
| **Streaming Tool Execution** | Gadgets execute the moment their block is parsed—not after the response completes. | [Streaming](/packages/docs/src/content/docs/guides/streaming.md) | [05-streaming.ts](/examples/05-streaming.ts) |
| **Built-in Function Calling** | Simple block format works with any text model—no native tool support required. | [Block Format](/packages/docs/src/content/docs/guides/block-format.md) | [01-basic-usage.ts](/examples/01-basic-usage.ts) |
| **Multi-Provider Support** | OpenAI, Anthropic, and Gemini with automatic provider discovery from env vars. | [Providers](/packages/docs/src/content/docs/advanced/providers.md) | - |
| **Fluent Agent API** | Chainable builder pattern with full TypeScript inference. | [Quick Start](/packages/docs/src/content/docs/getting-started/quick-start.md) | [13-syntactic-sugar.ts](/examples/13-syntactic-sugar.ts) |
| **Class & Function Gadgets** | Two ways to create tools—classes for complex gadgets, functions for simple ones. | [Creating Gadgets](/packages/docs/src/content/docs/guides/creating-gadgets.md) | [02-custom-gadgets.ts](/examples/02-custom-gadgets.ts) |
| **Lifecycle Hooks** | Observe, intercept, and control agent execution with presets or custom hooks. | [Hooks](/packages/docs/src/content/docs/guides/hooks.md) | [03-hooks.ts](/examples/03-hooks.ts) |
| **Human-in-the-Loop** | Request user input mid-execution for interactive workflows. | [Human-in-Loop](/packages/docs/src/content/docs/guides/human-in-loop.md) | [04-human-in-loop.ts](/examples/04-human-in-loop.ts) |
| **Context Compaction** | Automatic context management prevents overflow in long conversations. | [Compaction](/packages/docs/src/content/docs/advanced/compaction.md) | - |
| **Cost Tracking** | Real-time token counting and cost estimation across providers. | [Cost Tracking](/packages/docs/src/content/docs/guides/cost-tracking.md) | [06-model-catalog.ts](/examples/06-model-catalog.ts) |
| **Subagents** | Spawn nested agents for complex multi-step tasks. | [Subagents](/packages/docs/src/content/docs/advanced/subagents.md) | - |
| **Gadget Dependencies** | DAG execution—independent gadgets run in parallel, dependent ones wait. | [Block Format](/packages/docs/src/content/docs/guides/block-format.md#dependencies) | [11-gadget-dependencies.ts](/examples/11-gadget-dependencies.ts) |
| **Custom Models** | Register fine-tuned or custom models with pricing and limits. | [Custom Models](/packages/docs/src/content/docs/advanced/custom-models.md) | - |
| **Multimodal** | Vision and image input support for compatible models. | [Multimodal](/packages/docs/src/content/docs/advanced/multimodal.md) | - |

### CLI (`@llmist/cli`)

| Feature | Description | Docs |
|---------|-------------|------|
| **Quick Completions** | Stream responses from any model via command line. | [CLI Reference](/packages/docs/src/content/docs/cli/reference.md) |
| **Agent Mode** | Run full agent loop with local gadget files. | [CLI Gadgets](/packages/docs/src/content/docs/cli/gadgets.md) |
| **External Gadgets** | Load gadgets from npm packages or git URLs (e.g., Dhalsim). | [Ecosystem](/packages/docs/src/content/docs/cli/ecosystem.md) |
| **TOML Configuration** | Reusable profiles, prompt templates, and custom commands. | [Configuration](/packages/docs/src/content/docs/cli/configuration.md) |
| **Interactive TUI** | Browse execution history, view raw requests/responses. | [CLI Reference](/packages/docs/src/content/docs/cli/reference.md#interactive-tui) |

### Testing (`@llmist/testing`)

| Feature | Description | Docs |
|---------|-------------|------|
| **Mock LLM Responses** | Deterministic testing without API calls using fluent mock builder. | [Testing Overview](/packages/docs/src/content/docs/testing/overview.md) |
| **Gadget Testing** | Test gadgets in isolation with `testGadget()` utility. | [Gadget Testing](/packages/docs/src/content/docs/testing/gadget-testing.md) |
| **Mock Gadgets** | Create mock gadgets for agent integration tests. | [Mocking](/packages/docs/src/content/docs/testing/mocking.md) |

## Quick Start

```bash
# Set your API key
export OPENAI_API_KEY="sk-..."  # or ANTHROPIC_API_KEY, GEMINI_API_KEY

# Run an example
bunx tsx examples/01-basic-usage.ts
```

See the [Quick Start Guide](/packages/docs/src/content/docs/getting-started/quick-start.md) for a complete walkthrough.

## Documentation

Browse documentation in [`packages/docs/`](/packages/docs/src/content/docs/) or run the docs site locally:

```bash
bun run docs:dev
```

## Examples

All examples are in the [`examples/`](/examples/) directory:

```bash
bunx tsx examples/01-basic-usage.ts
```

See [`examples/README.md`](/examples/README.md) for the full list.

## Development

```bash
bun install
bun run build     # Build all packages
bun run test      # Test all packages
bun run lint      # Lint and format
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
