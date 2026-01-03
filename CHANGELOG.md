## <small>12.3.2 (2026-01-03)</small>

* fix: merge subagent observers instead of replacing them (#322) ([0aa6e57](https://github.com/zbigniewsobiecki/llmist/commit/0aa6e57)), closes [#322](https://github.com/zbigniewsobiecki/llmist/issues/322)

## <small>12.3.1 (2026-01-03)</small>

* fix(agent): pass current observers to ExecutionContext for subagent inheritance (#321) ([fe22c0e](https://github.com/zbigniewsobiecki/llmist/commit/fe22c0e)), closes [#321](https://github.com/zbigniewsobiecki/llmist/issues/321)

## 12.3.0 (2026-01-02)

* Merge pull request #320 from zbigniewsobiecki/dev ([4a5d41b](https://github.com/zbigniewsobiecki/llmist/commit/4a5d41b)), closes [#320](https://github.com/zbigniewsobiecki/llmist/issues/320)
* feat(agent): add subagent gadget visibility via parentObservers ([4157857](https://github.com/zbigniewsobiecki/llmist/commit/4157857))

## <small>12.2.5 (2026-01-02)</small>

* feat(agent): add subagent gadget visibility via parentObservers

  Parent agents can now observe gadget events from subagents. When a gadget creates
  a subagent via `withParentContext(ctx)`, the parent's observer hooks are called
  for all gadget executions in the subagent.

  This enables monitoring tools like niu to display subagent gadget activity
  in the UI alongside parent session events.

  Changes:
  - Added `parentObservers` field to ExecutionContext for passing parent hooks
  - AgentBuilder.withParentContext() now stores parent observer hooks
  - StreamProcessor calls both local AND parent observers (both awaited)
  - GadgetExecutor includes parentObservers in execution context

## <small>12.2.4 (2026-01-02)</small>

* Merge pull request #319 from zbigniewsobiecki/dev ([ce9796e](https://github.com/zbigniewsobiecki/llmist/commit/ce9796e)), closes [#319](https://github.com/zbigniewsobiecki/llmist/issues/319)
* test: improve coverage from 60% to 80% with 320+ new tests (#318) ([12daa56](https://github.com/zbigniewsobiecki/llmist/commit/12daa56)), closes [#318](https://github.com/zbigniewsobiecki/llmist/issues/318)

## <small>12.2.3 (2026-01-02)</small>

* fix: await gadget observer hooks for proper event ordering (#317) ([d47453b](https://github.com/zbigniewsobiecki/llmist/commit/d47453b)), closes [#317](https://github.com/zbigniewsobiecki/llmist/issues/317)
* chore: sync dev with main [skip ci] ([2968a70](https://github.com/zbigniewsobiecki/llmist/commit/2968a70))
* docs: add HuggingFace provider to documentation (#315) ([6d6eec5](https://github.com/zbigniewsobiecki/llmist/commit/6d6eec5)), closes [#315](https://github.com/zbigniewsobiecki/llmist/issues/315)

## <small>12.2.2 (2026-01-02)</small>

* docs: add HuggingFace provider to documentation (#315) (#316) ([c6182ed](https://github.com/zbigniewsobiecki/llmist/commit/c6182ed)), closes [#315](https://github.com/zbigniewsobiecki/llmist/issues/315) [#316](https://github.com/zbigniewsobiecki/llmist/issues/316)

## <small>12.2.1 (2026-01-02)</small>

* Merge pull request #314 from zbigniewsobiecki/dev ([27327b2](https://github.com/zbigniewsobiecki/llmist/commit/27327b2)), closes [#314](https://github.com/zbigniewsobiecki/llmist/issues/314)
* fix(cli): prevent memory leak in REPL mode by clearing TUI state between turns (#313) ([fce9c55](https://github.com/zbigniewsobiecki/llmist/commit/fce9c55)), closes [#313](https://github.com/zbigniewsobiecki/llmist/issues/313)

## 12.2.0 (2026-01-02)

* Merge pull request #311 from zbigniewsobiecki/feat/huggingface-provider ([282f119](https://github.com/zbigniewsobiecki/llmist/commit/282f119)), closes [#311](https://github.com/zbigniewsobiecki/llmist/issues/311)
* Merge pull request #312 from zbigniewsobiecki/dev ([4178e72](https://github.com/zbigniewsobiecki/llmist/commit/4178e72)), closes [#312](https://github.com/zbigniewsobiecki/llmist/issues/312)
* docs: add HuggingFace to provider documentation ([b64dcae](https://github.com/zbigniewsobiecki/llmist/commit/b64dcae))
* feat(providers): add HuggingFace provider support ([3c96736](https://github.com/zbigniewsobiecki/llmist/commit/3c96736))

## <small>12.1.1 (2026-01-01)</small>

* build: migrate from custom hooks to Lefthook ([c60971c](https://github.com/zbigniewsobiecki/llmist/commit/c60971c))

## 12.1.0 (2026-01-01)

* feat(cli): increase ListDirectory default maxDepth to 3 ([a884ee9](https://github.com/zbigniewsobiecki/llmist/commit/a884ee9))

## <small>12.0.6 (2026-01-01)</small>

* fix(ci): add temporary workflow_dispatch for manual release ([9ea4077](https://github.com/zbigniewsobiecki/llmist/commit/9ea4077))
* fix(ci): export GITHUB_REF within run script for semantic-release ([4d5eae9](https://github.com/zbigniewsobiecki/llmist/commit/4d5eae9))
* fix(ci): override GITHUB_REF env var for semantic-release ([134b8cb](https://github.com/zbigniewsobiecki/llmist/commit/134b8cb))
* fix(ci): remove head_branch condition, rely on GITHUB_REF override ([a9e7cd0](https://github.com/zbigniewsobiecki/llmist/commit/a9e7cd0))
* fix(ci): use --ci false to detect branch from git checkout ([d80fc4d](https://github.com/zbigniewsobiecki/llmist/commit/d80fc4d))
* build: add Node.js 22 engines field to all packages ([7763fa9](https://github.com/zbigniewsobiecki/llmist/commit/7763fa9))
* build: trigger release with engines field ([79be416](https://github.com/zbigniewsobiecki/llmist/commit/79be416))

## <small>12.0.5 (2026-01-01)</small>

* fix(ci): add explicit branch check to release workflow ([438314a](https://github.com/zbigniewsobiecki/llmist/commit/438314a))
* fix(ci): add workflow_dispatch trigger for manual releases ([70b39ee](https://github.com/zbigniewsobiecki/llmist/commit/70b39ee))
* fix(ci): explicitly checkout main branch in release workflow ([c2c196d](https://github.com/zbigniewsobiecki/llmist/commit/c2c196d))
* fix(ci): use --branch main to override semantic-release branch detection ([1d3cc63](https://github.com/zbigniewsobiecki/llmist/commit/1d3cc63))
* build: trigger release for Node.js 22 engine requirement ([c62fe23](https://github.com/zbigniewsobiecki/llmist/commit/c62fe23))
* Merge branch 'dev' ([b464a77](https://github.com/zbigniewsobiecki/llmist/commit/b464a77))
* Merge pull request #308 from zbigniewsobiecki/dev ([fca2f11](https://github.com/zbigniewsobiecki/llmist/commit/fca2f11)), closes [#308](https://github.com/zbigniewsobiecki/llmist/issues/308)
* chore: standardize on Node.js 22 (#310) ([389eab2](https://github.com/zbigniewsobiecki/llmist/commit/389eab2)), closes [#310](https://github.com/zbigniewsobiecki/llmist/issues/310)
* chore(release): merge dev to main ([c623aa6](https://github.com/zbigniewsobiecki/llmist/commit/c623aa6))
* ci: remove source branch validation for PRs to main (#309) ([f957dcc](https://github.com/zbigniewsobiecki/llmist/commit/f957dcc)), closes [#309](https://github.com/zbigniewsobiecki/llmist/issues/309)
* ci(release): add environment to sync-dev job for secret access ([34bec86](https://github.com/zbigniewsobiecki/llmist/commit/34bec86))
* ci(release): enforce PR-only releases by removing manual triggers (#307) ([8650a7c](https://github.com/zbigniewsobiecki/llmist/commit/8650a7c)), closes [#307](https://github.com/zbigniewsobiecki/llmist/issues/307)
* ci(release): sync dev after any successful CI on main ([10357ea](https://github.com/zbigniewsobiecki/llmist/commit/10357ea))

## <small>12.0.4 (2025-12-30)</small>

* Merge pull request #306 from zbigniewsobiecki/dev ([104438d](https://github.com/zbigniewsobiecki/llmist/commit/104438d)), closes [#306](https://github.com/zbigniewsobiecki/llmist/issues/306)
* fix(timing): prevent AbortSignal listener leak in withTimeout() (#305) ([2edfab3](https://github.com/zbigniewsobiecki/llmist/commit/2edfab3)), closes [#305](https://github.com/zbigniewsobiecki/llmist/issues/305)

## <small>12.0.3 (2025-12-30)</small>

* Merge pull request #304 from zbigniewsobiecki/dev ([ff9db2b](https://github.com/zbigniewsobiecki/llmist/commit/ff9db2b)), closes [#304](https://github.com/zbigniewsobiecki/llmist/issues/304)
* fix(release): sync internal package versions during release (#303) ([cf60c23](https://github.com/zbigniewsobiecki/llmist/commit/cf60c23)), closes [#303](https://github.com/zbigniewsobiecki/llmist/issues/303)

## <small>12.0.2 (2025-12-30)</small>

* Merge pull request #301 from zbigniewsobiecki/fix/jiti-module-resolution ([cf0c8dc](https://github.com/zbigniewsobiecki/llmist/commit/cf0c8dc)), closes [#301](https://github.com/zbigniewsobiecki/llmist/issues/301)
* Merge pull request #302 from zbigniewsobiecki/dev ([adf279a](https://github.com/zbigniewsobiecki/llmist/commit/adf279a)), closes [#302](https://github.com/zbigniewsobiecki/llmist/issues/302)
* fix(cli): resolve llmist/zod imports for TypeScript gadgets in user directories ([991d58c](https://github.com/zbigniewsobiecki/llmist/commit/991d58c))

## <small>12.0.1 (2025-12-30)</small>

* Merge pull request #300 from zbigniewsobiecki/dev ([d97115e](https://github.com/zbigniewsobiecki/llmist/commit/d97115e)), closes [#300](https://github.com/zbigniewsobiecki/llmist/issues/300)
* test: fix flaky timing test in stream-processor.test.ts ([0ada2d2](https://github.com/zbigniewsobiecki/llmist/commit/0ada2d2))
* fix(cli): add runtime TypeScript support for local gadgets (#299) ([c61e602](https://github.com/zbigniewsobiecki/llmist/commit/c61e602)), closes [#299](https://github.com/zbigniewsobiecki/llmist/issues/299)

## 12.0.0 (2025-12-30)
