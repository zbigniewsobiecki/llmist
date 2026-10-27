# Contributing to llmist

Contributions welcome! Please ensure:

1. All tests pass: `npm test`
2. Code is formatted: `npm run format`
3. Linting passes: `npm run lint`
4. Types are properly defined
5. Examples/docs updated for API changes

## Development prerequisites

Use a current Node 22 or Node 24 release and the pinned npm 10.9.2. Install
with `npm ci --engine-strict --ignore-scripts=false`; retain Lefthook and its
pre-commit, commit-msg, and pre-push hooks.

The private build graph requires at least Node 22.19 on the 22 line or 24.11
on the 24 line. Its optional Linux x64 native compression dependency requires
22.20 or 24.12, so use those versions or newer for a complete installation.
These are dependency engine requirements, not claims that the earliest minor
versions were exercised. The security upgrade is qualified on Node 24.22.1;
the repository CI selects current Node 22.

These contributor prerequisites do not change the published library, CLI, or
testing package's Node >=22.0.0 consumer policy. Private documentation and
build tools are separate from the consumer dependency graph.

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
