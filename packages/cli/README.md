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
# or run directly with npx:
npx @llmist/cli
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

## Rate Limiting

llmist CLI enables **conservative rate limiting by default** to prevent hitting provider API limits and avoid agent crashes.

### Default Behavior

Rate limits are **automatically configured** based on your model's provider:

| Provider   | RPM | TPM       | Daily Tokens |
|------------|-----|-----------|--------------|
| Anthropic  | 50  | 40,000    | -            |
| OpenAI     | 3   | 40,000    | -            |
| Gemini     | 15  | 1,000,000 | 1,500,000    |

These defaults are **conservative** (protecting free tier users). Paid tier users should configure higher limits.

### Configuration

**TOML Config** (`~/.llmist/cli.toml` or project `llmist.toml`):

```toml
# Global rate limits (applies to all commands)
[rate-limits]
enabled = true
requests-per-minute = 100
tokens-per-minute = 200_000
safety-margin = 0.8  # Throttle at 80% of limit

# Profile-specific overrides
[profile-gemini]
model = "gemini:flash"

[profile-gemini.rate-limits]
requests-per-minute = 15
tokens-per-day = 1_500_000

# Disable rate limiting for a profile
[profile-fast]
model = "gpt4o"

[profile-fast.rate-limits]
enabled = false
```

**CLI Flags** (override all config):

```bash
# Override limits
llmist agent --rate-limit-rpm 100 --rate-limit-tpm 200000 "your prompt"

# Disable rate limiting
llmist agent --no-rate-limit "your prompt"

# Configure retry behavior
llmist agent --max-retries 5 --retry-min-timeout 2000 "your prompt"

# Disable retry
llmist agent --no-retry "your prompt"
```

### TUI Feedback

The Terminal UI provides real-time feedback when rate limiting is active:

- **Status Bar**: Shows `⏸ Throttled Xs` when waiting for rate limits
- **Status Bar**: Shows `🔄 Retry 2/3` during retry attempts
- **Conversation Log**: Persistent entries like:
  ```
  ⏸ Rate limit approaching (45 RPM, 85K TPM), waiting 5s...
  🔄 Request failed (attempt 1/3), retrying...
  ```

### Finding Your Tier Limits

To configure optimal limits for your API tier:

- **Anthropic**: [Rate Limits Documentation](https://docs.anthropic.com/en/api/rate-limits)
- **OpenAI**: [Rate Limits Guide](https://platform.openai.com/docs/guides/rate-limits)
- **Gemini**: [Quota Documentation](https://ai.google.dev/gemini-api/docs/quota)

Check your provider dashboard for current tier limits, then update your `llmist.toml` accordingly.

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
