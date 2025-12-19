# Claude Code Guidelines for llmist

## Git Workflow

### Branching Strategy

```
feature-branch  →  PR to dev  →  PR to main
     ↑                              ↑
   (work)                      (release only)
```

### Rules

1. **All work goes on feature branches** - Never commit directly to `dev` or `main`
2. **PRs always go to `dev` first** - No direct PRs to `main` from feature branches
3. **`dev` → `main` is a separate release PR** - Only after validation in `dev`

### Example Workflow

```bash
# 1. Create feature branch from dev
git checkout dev
git pull origin dev
git checkout -b feat/my-feature

# 2. Do work, commit changes
git add .
git commit -m "feat: add my feature"

# 3. Push and create PR to dev
git push -u origin feat/my-feature
gh pr create --base dev --head feat/my-feature

# 4. After PR is merged to dev and validated, create release PR
gh pr create --base main --head dev --title "chore(release): merge dev to main"
```

## Testing

- Run `bun run test` to test all packages (uses Turborepo)
- Run `bun run test --filter=llmist` for core library tests only
- E2E tests: `bun run test:e2e --filter=llmist`

## Project Structure (Monorepo)

This is a Bun Workspaces + Turborepo monorepo with the following packages:

```
packages/
├── llmist/           # Core library (npm: llmist)
│   └── src/
│       ├── agent/    # Agent implementation and stream processing
│       ├── core/     # Core types, messages, and client
│       ├── gadgets/  # Gadget system (parser, executor, registry)
│       ├── providers/# LLM provider integrations
│       └── e2e/      # End-to-end tests
├── testing/          # Testing utilities (npm: @llmist/testing)
├── cli/              # CLI application (npm: @llmist/cli, binary: llmist)
└── docs/             # Documentation site (private)
examples/             # Example gadgets and usage (uses published packages)
```

### Build Commands

```bash
bun run build         # Build all packages
bun run test          # Test all packages
bun run typecheck     # Type-check all packages
bun run lint          # Lint entire repo
```
