# @llmist/cli

<p align="center">
  <a href="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml"><img src="https://github.com/zbigniewsobiecki/llmist/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@llmist/cli"><img src="https://img.shields.io/npm/v/@llmist/cli.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
</p>

**Command-line interface for llmist - run LLM agents from the terminal.**

## Installation

```bash
npm install -g @llmist/cli
# or
bunx @llmist/cli
```

## Quick Start

```bash
# Set your API key
export OPENAI_API_KEY="sk-..."

# Quick completion
llmist complete "Explain TypeScript generics in one paragraph"

# Run an agent with gadgets
llmist agent "Search for files" --gadgets ./my-gadgets/

# Interactive chat
llmist chat
```

## Commands

| Command | Description |
|---------|-------------|
| `complete <prompt>` | One-shot LLM completion |
| `agent <prompt>` | Run agent with gadgets |
| `chat` | Interactive chat session |
| `tui` | Launch terminal UI |

## Using Gadgets

Load gadgets from various sources:

```bash
# Local directory
llmist agent "Do something" --gadgets ./gadgets/

# npm package
llmist agent "Search the web" --gadgets dhalsim/BrowseWeb

# Git URL
llmist agent "Process files" --gadgets github:user/repo
```

## Configuration

Create a `llmist.toml` file for reusable configurations:

```toml
[agent]
model = "sonnet"
system = "You are a helpful assistant"

[gadgets]
paths = ["./gadgets"]
external = ["dhalsim/BrowseWeb"]

[display]
markdown = true
colors = true
```

Use with:

```bash
llmist agent "Do something" --config ./llmist.toml
```

## Terminal UI

The TUI provides an interactive interface to browse execution history, inspect raw payloads, and debug agent runs:

```bash
llmist tui
```

## Documentation

Full documentation at [llmist.dev/cli](https://llmist.dev/cli/getting-started/introduction/)

- [Configuration Reference](https://llmist.dev/cli/configuration/toml-reference/)
- [Writing Gadgets](https://llmist.dev/cli/gadgets/local-gadgets/)
- [External Gadgets](https://llmist.dev/cli/gadgets/external-gadgets/)
- [TUI Guide](https://llmist.dev/cli/tui/overview/)

## Related Packages

- [`llmist`](https://www.npmjs.com/package/llmist) - Core library
- [`@llmist/testing`](https://www.npmjs.com/package/@llmist/testing) - Testing utilities

## License

MIT
