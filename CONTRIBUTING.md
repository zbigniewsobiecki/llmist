# Contributing to llmist

Contributions welcome! Please ensure:

1. All tests pass: `bun test`
2. Code is formatted: `bun run format`
3. Linting passes: `bun run lint`
4. Types are properly defined
5. Examples/docs updated for API changes

## Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification. All commit messages must be formatted as:

```
<type>(<scope>): <subject>
```

**Types:**
- `feat:` - New feature (triggers minor version bump)
- `fix:` - Bug fix (triggers patch version bump)
- `docs:` - Documentation only changes
- `style:` - Code style changes (formatting, missing semi-colons, etc)
- `refactor:` - Code refactoring without feature changes
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `build:` - Build system or dependency changes
- `ci:` - CI configuration changes
- `chore:` - Other changes that don't modify src or test files

**Breaking Changes:** Add `BREAKING CHANGE:` in the footer to trigger major version bump.

**Examples:**
```bash
feat(agent): add support for streaming tool calls
fix(cli): prevent crash on invalid gadget path
docs: update API documentation for v2
```

**Note:** Git hooks will validate your commit messages locally.

## Release Process

Releases are fully automated using [semantic-release](https://github.com/semantic-release/semantic-release):

1. Merge PR to `main` branch
2. CI workflow runs automatically
3. If CI passes, release workflow:
   - Analyzes commits since last release
   - Determines version bump based on commit types
   - Updates `package.json` and `CHANGELOG.md`
   - Creates git tag and GitHub release
   - Publishes to npm
   - Syncs changes back to `dev` branch

**No manual version bumps needed!**
