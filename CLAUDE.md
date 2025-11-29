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

- Run `bun test` before committing
- E2E tests: `bun test src/e2e --timeout 60000`
- Parser tests: `bun test src/gadgets/parser.test.ts`

## Project Structure

- `src/agent/` - Agent implementation and stream processing
- `src/core/` - Core types, messages, and client
- `src/gadgets/` - Gadget system (parser, executor, registry)
- `src/cli/` - CLI implementation
- `src/providers/` - LLM provider integrations (Anthropic, OpenAI, Gemini)
- `examples/` - Example gadgets and usage
