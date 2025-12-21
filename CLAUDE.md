# Claude Code Guidelines for llmist

## Overview

llmist is a streaming-first, multi-provider LLM client with a custom "gadget" tool-calling system. The project is a Bun Workspaces + Turborepo monorepo.

**Packages:**
- `llmist` - Core library (npm: llmist)
- `@llmist/cli` - Command-line interface (npm: @llmist/cli)
- `@llmist/testing` - Testing utilities and mocks (npm: @llmist/testing)
- `@llmist/docs` - Documentation site (private, at llmist.dev)

## Git Workflow

```
feature-branch  →  PR to dev  →  PR to main
     ↑                              ↑
   (work)                      (release only)
```

### Rules

1. **All work on feature branches** - Never commit directly to `dev` or `main`
2. **PRs go to `dev` first** - No direct PRs to `main` from feature branches
3. **`dev` → `main` for releases** - CI validates this rule

### Workflow

```bash
# 1. Create feature branch from dev
git checkout dev && git pull origin dev
git checkout -b feat/my-feature

# 2. Work and commit (conventional commits required)
git commit -m "feat(agent): add new capability"

# 3. Push and create PR to dev
git push -u origin feat/my-feature
gh pr create --base dev

# 4. After merge to dev, create release PR
gh pr create --base main --head dev --title "chore(release): merge dev to main"
```

### Branch Sync & Recovery

After each release, `main` is automatically synced to `dev`. If sync fails, the workflow shows a failure in GitHub Actions (you'll get an email notification).

**Manual recovery if branches desync:**
```bash
git fetch origin
git checkout dev
git merge origin/main
# Resolve any conflicts
git push origin dev
```

## Commands

### Build & Test
```bash
bun install              # Install dependencies
bun run build            # Build all packages (uses Turborepo)
bun run test             # Run all tests
bun run typecheck        # Type-check all packages
bun run lint             # Lint with Biome
bun run format           # Format with Biome
bun run check            # Lint + format
```

### Package-Specific
```bash
bun run test --filter=llmist           # Core library tests only
bun run test --filter=@llmist/cli      # CLI tests only
bun run test --filter=@llmist/testing  # Testing package tests
bun run test:e2e --filter=llmist       # E2E tests (use mocks)
```

### Documentation
```bash
bun run docs:dev         # Start docs dev server
bun run docs:build       # Build docs site
bun run docs:preview     # Preview built docs
```

## Project Structure

```
packages/
├── llmist/              # Core library
│   └── src/
│       ├── agent/       # Agent, builder, stream processor, hooks, compaction
│       ├── core/        # LLMist client, messages, execution tree, models
│       ├── gadgets/     # Parser, executor, registry, helpers, exceptions
│       ├── providers/   # Anthropic, OpenAI, Gemini adapters
│       ├── utils/       # Formatting, timing, config resolution
│       ├── logging/     # tslog-based logging
│       ├── session/     # Session management
│       └── e2e/         # End-to-end tests
├── cli/                 # CLI application
│   └── src/
│       ├── agent-command.ts    # Main agent command
│       ├── complete-command.ts # Completion command
│       ├── config.ts           # TOML config parsing
│       └── tui/                # Terminal UI
├── testing/             # Testing utilities
│   └── src/
│       ├── mock-builder.ts     # Fluent mock API
│       ├── mock-adapter.ts     # Provider mock
│       ├── gadget-testing.ts   # testGadget() utility
│       └── helpers.ts          # Test helpers
└── docs/                # Astro Starlight docs site
    └── src/content/docs/
        ├── library/     # Core library docs
        ├── cli/         # CLI docs
        ├── testing/     # Testing docs
        └── reference/   # API reference

examples/                # Runnable examples (01-23)
└── gadgets/             # Example gadgets (calculator, filesystem, etc.)
```

## Key Concepts

### Gadgets
Tools that LLMs can call. Two styles:
```typescript
// Class-based (recommended for complex gadgets)
class MyGadget extends Gadget({
  description: 'Does something',
  schema: z.object({ param: z.string() }),
}) {
  execute(params: this['params']): string { ... }
}

// Function-based (simple one-offs)
const myGadget = createGadget({
  name: 'MyGadget',
  schema: z.object({ param: z.string() }),
  execute: (params) => { ... },
});
```

### Hooks System
Three-tier architecture:
- **Controllers** - Modify execution flow (beforeLLMCall, afterLLMError, etc.)
- **Interceptors** - Transform data (interceptRawChunk, interceptGadgetResult, etc.)
- **Observers** - Read-only monitoring (onLLMCallComplete, onGadgetExecutionComplete, etc.)

### Execution Tree
First-class model for tracking agent execution state, including nested subagents.

### Compaction
Auto-enabled context management with strategies: sliding-window, summarization, hybrid.

## Code Style

### Linting & Formatting
- **Biome** for linting and formatting
- Line width: 100 characters
- Indent: 2 spaces
- Imports auto-organized

### Naming Conventions
- Classes: PascalCase (`Agent`, `GadgetRegistry`)
- Functions: camelCase (`createGadget`, `resolveModel`)
- Types: PascalCase (`ExecutionContext`, `ModelSpec`)
- Constants: UPPER_SNAKE_CASE (`GADGET_START_PREFIX`)
- Files: kebab-case (`stream-processor.ts`, `model-registry.ts`)

### TypeScript
- Strict mode enabled
- Zod for runtime validation
- Avoid `any` (warn level in linter)
- Export types alongside implementations

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

**Types:**
- `feat:` - New feature (minor bump)
- `fix:` - Bug fix (patch bump)
- `docs:` - Documentation
- `refactor:` - Refactoring
- `test:` - Tests
- `chore:` - Maintenance

**Scopes:** `agent`, `gadgets`, `cli`, `testing`, `docs`, `providers`, `core`

**Breaking changes:** Add `BREAKING CHANGE:` in footer (major bump)

Git hooks validate commits locally via commitlint.

## Testing

### Unit Tests
Co-located with source files (`*.test.ts`). Use Bun's built-in test runner.

### E2E Tests
In `packages/llmist/src/e2e/`. Use mocks by default (no API calls in CI).

### Mocking LLM Responses
```typescript
import { mockLLM, createMockClient, resetMocks } from '@llmist/testing';

mockLLM()
  .whenMessageContains('hello')
  .returns('Hi there!')
  .register();

const agent = LLMist.createAgent()
  .withClient(createMockClient())
  .ask('hello');
```

### Testing Gadgets
```typescript
import { testGadget } from '@llmist/testing';

const result = await testGadget(new MyGadget(), { param: 'value' });
expect(result.result).toBe('expected');
```

## CI/CD

### CI Workflow (`.github/workflows/ci.yml`)
Runs on all PRs and pushes to main/dev:
1. Validates source branch (PRs to main must come from dev)
2. Builds all packages
3. Runs typecheck, lint, unit tests
4. Runs E2E tests
5. Validates commit messages (commitlint)
6. Reports coverage to Codecov

### Release Workflow (`.github/workflows/release.yml`)
Triggered on push to main:
1. Analyzes commits via semantic-release
2. Determines version bump
3. Updates CHANGELOG.md
4. Creates git tag and GitHub release
5. Publishes to npm
6. Syncs changes back to dev

**No manual version bumps needed!**

## Key Files

| File | Purpose |
|------|---------|
| `packages/llmist/src/index.ts` | Main library exports (~400 lines) |
| `packages/llmist/src/agent/agent.ts` | Agent orchestration (~1400 lines) |
| `packages/llmist/src/agent/builder.ts` | Fluent API builder (~1200 lines) |
| `packages/llmist/src/gadgets/parser.ts` | Block format parser |
| `packages/llmist/src/gadgets/executor.ts` | Gadget execution |
| `packages/llmist/src/core/client.ts` | LLMist client class |
| `packages/cli/src/config.ts` | TOML config parsing (~37K) |
| `turbo.json` | Turborepo task configuration |
| `biome.json` | Linter/formatter configuration |

## Examples

23 runnable examples in `examples/`:
```bash
bunx tsx examples/01-basic-usage.ts
bunx tsx examples/12-error-handling.ts
```

Key examples:
- `01-basic-usage.ts` - Three ways to run agents
- `02-custom-gadgets.ts` - Class vs functional gadgets
- `03-hooks.ts` - Observer and interceptor patterns
- `12-error-handling.ts` - Error handling and recovery
- `19-multimodal-input.ts` - Vision/audio input
- `20-external-gadgets.ts` - Loading gadgets from npm/git

## Provider Setup

Set environment variables for auto-discovery:
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

Model aliases: `sonnet`, `opus`, `haiku`, `gpt4o`, `flash`, etc.

## Documentation

- Live site: [llmist.dev](https://llmist.dev)
- Structure: Astro Starlight with TypeDoc integration
- Sections: Library, CLI, Testing, Reference, Cookbook
