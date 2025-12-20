---
title: Installation
description: Install llmist and set up your environment
---

## Install the Package

```bash
npm install llmist
# or
bun add llmist
```

## Environment Setup

Set API keys for your provider(s):

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# Google Gemini
export GEMINI_API_KEY="..."
```

llmist auto-discovers providers based on available API keys. You only need to set keys for the providers you want to use.

## CLI Installation

The CLI is included in the `@llmist/cli` package:

```bash
# Install globally
npm install -g @llmist/cli

# Or use with npx
npx llmist --help

# Or with bunx
bunx llmist --help
```

### Initialize Configuration

```bash
# Creates ~/.llmist/cli.toml
bunx llmist init
```

## Testing Package

For unit testing your agents:

```bash
npm install -D @llmist/testing
```

## TypeScript Configuration

llmist is written in TypeScript and provides full type definitions. No additional `@types` packages are needed.

Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

## Verify Installation

```typescript
import { LLMist } from 'llmist';

const answer = await LLMist.complete('Hello!');
console.log(answer);
```

## Next Steps

- [Quick Start](/getting-started/quick-start/) - Build your first agent
- [Configuration](/getting-started/configuration/) - All available options
