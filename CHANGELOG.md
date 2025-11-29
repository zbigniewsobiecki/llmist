## <small>0.6.1 (2025-11-29)</small>

* Merge pull request #94 from zbigniewsobiecki/dev ([dfaf97d](https://github.com/zbigniewsobiecki/llmist/commit/dfaf97d)), closes [#94](https://github.com/zbigniewsobiecki/llmist/issues/94)
* fix(gadgets): update WriteFile example to show heredoc for multiline content ([1db53bb](https://github.com/zbigniewsobiecki/llmist/commit/1db53bb))

## 0.6.0 (2025-11-29)

* Merge pull request #93 from zbigniewsobiecki/dev ([2fefc1c](https://github.com/zbigniewsobiecki/llmist/commit/2fefc1c)), closes [#93](https://github.com/zbigniewsobiecki/llmist/issues/93)
* feat(agent): add gadget output limiting to prevent context overflow (#92) ([66db2e4](https://github.com/zbigniewsobiecki/llmist/commit/66db2e4)), closes [#92](https://github.com/zbigniewsobiecki/llmist/issues/92)
* feat(cli): add log-reset option and improve RunCommand approval UX ([7d4b7af](https://github.com/zbigniewsobiecki/llmist/commit/7d4b7af))
* feat(gadgets): add EditFile gadget for ed-based file editing (#91) ([ffe9ff5](https://github.com/zbigniewsobiecki/llmist/commit/ffe9ff5)), closes [#91](https://github.com/zbigniewsobiecki/llmist/issues/91)
* feat(gadgets): add heredoc syntax support for YAML and TOML parameters (#90) ([ac3ec3f](https://github.com/zbigniewsobiecki/llmist/commit/ac3ec3f)), closes [#90](https://github.com/zbigniewsobiecki/llmist/issues/90)

## <small>0.5.1 (2025-11-27)</small>

* fix(deps): downgrade marked to 15.x for marked-terminal compatibility (#89) ([be5d76d](https://github.com/zbigniewsobiecki/llmist/commit/be5d76d)), closes [#89](https://github.com/zbigniewsobiecki/llmist/issues/89)

## 0.5.0 (2025-11-27)

* feat(ci): enforce dev-to-main workflow with source branch validation (#79) ([e656e89](https://github.com/zbigniewsobiecki/llmist/commit/e656e89)), closes [#79](https://github.com/zbigniewsobiecki/llmist/issues/79)
* feat(cli): add accumulated token costs to progress indicator (#27) ([35e37eb](https://github.com/zbigniewsobiecki/llmist/commit/35e37eb)), closes [#27](https://github.com/zbigniewsobiecki/llmist/issues/27)
* feat(cli): add configuration file support (#88) ([3ed92c5](https://github.com/zbigniewsobiecki/llmist/commit/3ed92c5)), closes [#88](https://github.com/zbigniewsobiecki/llmist/issues/88)
* feat(cli): add markdown rendering and switch to YAML format (#82) ([d143ea9](https://github.com/zbigniewsobiecki/llmist/commit/d143ea9)), closes [#82](https://github.com/zbigniewsobiecki/llmist/issues/82)
* feat(cli): add models command and update model references (#46) ([bb10946](https://github.com/zbigniewsobiecki/llmist/commit/bb10946)), closes [#46](https://github.com/zbigniewsobiecki/llmist/issues/46) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* feat(cli): add progress tracking with arrows and real token counts ([b6ddaf4](https://github.com/zbigniewsobiecki/llmist/commit/b6ddaf4))
* feat(cli): add RunCommand gadget with approval gating (#85) ([6ca7504](https://github.com/zbigniewsobiecki/llmist/commit/6ca7504)), closes [#85](https://github.com/zbigniewsobiecki/llmist/issues/85)
* feat(cli): display per-call stats summary after each LLM call (#86) ([c2e13ac](https://github.com/zbigniewsobiecki/llmist/commit/c2e13ac)), closes [#86](https://github.com/zbigniewsobiecki/llmist/issues/86) [#1](https://github.com/zbigniewsobiecki/llmist/issues/1) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3) [#1](https://github.com/zbigniewsobiecki/llmist/issues/1)
* feat(cli): improve CLI showcase and fix token count display ([d686889](https://github.com/zbigniewsobiecki/llmist/commit/d686889)), closes [#1](https://github.com/zbigniewsobiecki/llmist/issues/1)
* feat(cli): improve CLI showcase and fix token count display ([2e2351b](https://github.com/zbigniewsobiecki/llmist/commit/2e2351b))
* feat(cli): improve gadget display with compact one-liner format (#81) ([1e75747](https://github.com/zbigniewsobiecki/llmist/commit/1e75747)), closes [#81](https://github.com/zbigniewsobiecki/llmist/issues/81)
* feat(cli): remove horizontal line separator from summary output (#67) ([6d08f37](https://github.com/zbigniewsobiecki/llmist/commit/6d08f37)), closes [#67](https://github.com/zbigniewsobiecki/llmist/issues/67)
* feat(gadgets): add examples property for usage documentation (#83) ([533b447](https://github.com/zbigniewsobiecki/llmist/commit/533b447)), closes [#83](https://github.com/zbigniewsobiecki/llmist/issues/83)
* feat(gadgets): add TOML as default parameter format (#87) ([ec6a181](https://github.com/zbigniewsobiecki/llmist/commit/ec6a181)), closes [#87](https://github.com/zbigniewsobiecki/llmist/issues/87)
* feat(gadgets): add WriteFile gadget to filesystem suite (#84) ([1a6b82a](https://github.com/zbigniewsobiecki/llmist/commit/1a6b82a)), closes [#84](https://github.com/zbigniewsobiecki/llmist/issues/84)
* chore: bump version to 0.1.4 (#26) ([1cac2c5](https://github.com/zbigniewsobiecki/llmist/commit/1cac2c5)), closes [#26](https://github.com/zbigniewsobiecki/llmist/issues/26) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* chore: bump version to 0.1.5 (#33) ([50ed6f0](https://github.com/zbigniewsobiecki/llmist/commit/50ed6f0)), closes [#33](https://github.com/zbigniewsobiecki/llmist/issues/33) [#27](https://github.com/zbigniewsobiecki/llmist/issues/27) [#30](https://github.com/zbigniewsobiecki/llmist/issues/30) [#31](https://github.com/zbigniewsobiecki/llmist/issues/31) [#32](https://github.com/zbigniewsobiecki/llmist/issues/32)
* chore: resolve release.yml conflict for v0.3.0 (#56) ([3468b22](https://github.com/zbigniewsobiecki/llmist/commit/3468b22)), closes [#56](https://github.com/zbigniewsobiecki/llmist/issues/56) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* chore: sync dev with main (#48) ([a926e3d](https://github.com/zbigniewsobiecki/llmist/commit/a926e3d)), closes [#48](https://github.com/zbigniewsobiecki/llmist/issues/48) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* chore: sync dev with main (workflow fix) (#52) ([5ffa0c3](https://github.com/zbigniewsobiecki/llmist/commit/5ffa0c3)), closes [#52](https://github.com/zbigniewsobiecki/llmist/issues/52) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* chore: sync dev with main after release [skip ci] ([682a182](https://github.com/zbigniewsobiecki/llmist/commit/682a182))
* chore: sync dev with main after release [skip ci] ([4bd01cc](https://github.com/zbigniewsobiecki/llmist/commit/4bd01cc))
* chore: sync dev with main after release [skip ci] ([ac6c244](https://github.com/zbigniewsobiecki/llmist/commit/ac6c244))
* chore: sync dev with main after release [skip ci] ([8581dcf](https://github.com/zbigniewsobiecki/llmist/commit/8581dcf))
* chore: sync dev with main after release [skip ci] ([f94c393](https://github.com/zbigniewsobiecki/llmist/commit/f94c393))
* chore: sync dev with main after release [skip ci] ([1583b20](https://github.com/zbigniewsobiecki/llmist/commit/1583b20))
* chore: sync dev with main after release v0.2.1 [skip ci] ([5031b1b](https://github.com/zbigniewsobiecki/llmist/commit/5031b1b))
* chore: sync main into dev after v0.3.0 merge (#61) ([ec34d08](https://github.com/zbigniewsobiecki/llmist/commit/ec34d08)), closes [#61](https://github.com/zbigniewsobiecki/llmist/issues/61) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* chore: sync main into dev with CI environment (#54) ([a5ca16b](https://github.com/zbigniewsobiecki/llmist/commit/a5ca16b)), closes [#54](https://github.com/zbigniewsobiecki/llmist/issues/54) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* fix(ci): add CI environment to release workflow (#50) ([21e5465](https://github.com/zbigniewsobiecki/llmist/commit/21e5465)), closes [#50](https://github.com/zbigniewsobiecki/llmist/issues/50)
* fix(ci): skip validate-commits check for release PRs from dev to main (#78) ([1ce8f41](https://github.com/zbigniewsobiecki/llmist/commit/1ce8f41)), closes [#78](https://github.com/zbigniewsobiecki/llmist/issues/78)
* fix(ci): upgrade Node.js to v22 for semantic-release compatibility (#59) ([3b0f4bc](https://github.com/zbigniewsobiecki/llmist/commit/3b0f4bc)), closes [#59](https://github.com/zbigniewsobiecki/llmist/issues/59)
* fix(ci): use fast-forward merge for dev sync to prevent commit buildup ([c5d33b0](https://github.com/zbigniewsobiecki/llmist/commit/c5d33b0))
* fix(cli): resolve model aliases in complete command (#36) ([b6e9f8d](https://github.com/zbigniewsobiecki/llmist/commit/b6e9f8d)), closes [#36](https://github.com/zbigniewsobiecki/llmist/issues/36) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* fix(cli): use ESM entry point for CLI binary (#15) ([e065172](https://github.com/zbigniewsobiecki/llmist/commit/e065172)), closes [#15](https://github.com/zbigniewsobiecki/llmist/issues/15)
* fix(deps): upgrade OpenAI SDK to v6 to reduce node-domexception warnings (#18) ([cae1beb](https://github.com/zbigniewsobiecki/llmist/commit/cae1beb)), closes [#18](https://github.com/zbigniewsobiecki/llmist/issues/18) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* fix(docs): correct README code examples (#41) ([b7aa032](https://github.com/zbigniewsobiecki/llmist/commit/b7aa032)), closes [#41](https://github.com/zbigniewsobiecki/llmist/issues/41)
* fix(gemini): fix token counting discrepancy by including system messages in contents ([115c94b](https://github.com/zbigniewsobiecki/llmist/commit/115c94b))
* fix(parser): use globally unique gadget invocation IDs (#20) ([d5097c3](https://github.com/zbigniewsobiecki/llmist/commit/d5097c3)), closes [#20](https://github.com/zbigniewsobiecki/llmist/issues/20)
* fix(prompts): replace XML format with plain text (#19) ([47e81f7](https://github.com/zbigniewsobiecki/llmist/commit/47e81f7)), closes [#19](https://github.com/zbigniewsobiecki/llmist/issues/19) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* fix(test): increase timeout test margins for CI coverage runs (#13) ([1980b85](https://github.com/zbigniewsobiecki/llmist/commit/1980b85)), closes [#13](https://github.com/zbigniewsobiecki/llmist/issues/13)
* Merge main into dev (#40) ([608438d](https://github.com/zbigniewsobiecki/llmist/commit/608438d)), closes [#40](https://github.com/zbigniewsobiecki/llmist/issues/40) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* Release v0.3.1 ([a55194d](https://github.com/zbigniewsobiecki/llmist/commit/a55194d)), closes [#1](https://github.com/zbigniewsobiecki/llmist/issues/1)
* Switch from GitHub Packages to npmjs.com (#11) ([a32d567](https://github.com/zbigniewsobiecki/llmist/commit/a32d567)), closes [#11](https://github.com/zbigniewsobiecki/llmist/issues/11)
* Sync dev with main (#23) ([00a0414](https://github.com/zbigniewsobiecki/llmist/commit/00a0414)), closes [#23](https://github.com/zbigniewsobiecki/llmist/issues/23) [#4](https://github.com/zbigniewsobiecki/llmist/issues/4) [#2](https://github.com/zbigniewsobiecki/llmist/issues/2) [#3](https://github.com/zbigniewsobiecki/llmist/issues/3)
* docs: add work-in-progress warning to README (#21) ([b361772](https://github.com/zbigniewsobiecki/llmist/commit/b361772)), closes [#21](https://github.com/zbigniewsobiecki/llmist/issues/21)
* docs: fix README badges for codecov and npm (#32) ([00e1102](https://github.com/zbigniewsobiecki/llmist/commit/00e1102)), closes [#32](https://github.com/zbigniewsobiecki/llmist/issues/32)
* docs: update CLI command from 'chat' to 'complete' (#14) ([c3d2d66](https://github.com/zbigniewsobiecki/llmist/commit/c3d2d66)), closes [#14](https://github.com/zbigniewsobiecki/llmist/issues/14)
* docs(hooks): add comprehensive HookPresets documentation (#31) ([73c5832](https://github.com/zbigniewsobiecki/llmist/commit/73c5832)), closes [#31](https://github.com/zbigniewsobiecki/llmist/issues/31)
* test(executor): add timing margins to fix flaky timeout test (#30) ([61d35cf](https://github.com/zbigniewsobiecki/llmist/commit/61d35cf)), closes [#30](https://github.com/zbigniewsobiecki/llmist/issues/30)

## [Unreleased]

### Changed

- **BREAKING**: Default parameter format changed from YAML to TOML ([#87](https://github.com/zbigniewsobiecki/llmist/pull/87))
  - TOML's triple-quoted strings (`"""..."""`) handle markdown content unambiguously
  - Use `--parameter-format yaml` to restore previous behavior
  - Auto mode tries formats in order: JSON → TOML → YAML

### Added

- TOML parameter format support with `js-toml` parser ([#87](https://github.com/zbigniewsobiecki/llmist/pull/87))
- TOML syntax guide in LLM prompts for multiline strings
- TOML examples for gadget invocations

---

## <small>0.4.1 (2025-11-26)</small>

* fix(gemini): fix token counting discrepancy (#80) ([644050a](https://github.com/zbigniewsobiecki/llmist/commit/644050a)), closes [#80](https://github.com/zbigniewsobiecki/llmist/issues/80) [#11](https://github.com/zbigniewsobiecki/llmist/issues/11) [#13](https://github.com/zbigniewsobiecki/llmist/issues/13)

## 0.4.0 (2025-11-26)

* feat(cli): add progress tracking with arrows and real token counts ([4095065](https://github.com/zbigniewsobiecki/llmist/commit/4095065))

## <small>0.3.1 (2025-11-26)</small>

* fix(ci): use fast-forward merge for dev sync to prevent commit buildup ([b414279](https://github.com/zbigniewsobiecki/llmist/commit/b414279))

## 0.3.0 (2025-11-26)

* feat(cli): improve CLI showcase and fix token count display ([62e9501](https://github.com/zbigniewsobiecki/llmist/commit/62e9501))

## <small>0.2.2 (2025-11-26)</small>

* Release v0.2.2 (#68) ([1fc4b34](https://github.com/zbigniewsobiecki/llmist/commit/1fc4b34)), closes [#68](https://github.com/zbigniewsobiecki/llmist/issues/68) [#11](https://github.com/zbigniewsobiecki/llmist/issues/11) [#13](https://github.com/zbigniewsobiecki/llmist/issues/13)
* fix(ci): fix dev branch sync after release (#66) ([bdf85ff](https://github.com/zbigniewsobiecki/llmist/commit/bdf85ff)), closes [#66](https://github.com/zbigniewsobiecki/llmist/issues/66)

## <small>0.2.1 (2025-11-26)</small>

* fix(ci): disable git hooks during release workflow (#65) ([f492fb6](https://github.com/zbigniewsobiecki/llmist/commit/f492fb6)), closes [#65](https://github.com/zbigniewsobiecki/llmist/issues/65)
* fix(ci): skip git hooks in semantic-release commits (#64) ([46cda82](https://github.com/zbigniewsobiecki/llmist/commit/46cda82)), closes [#64](https://github.com/zbigniewsobiecki/llmist/issues/64)
* fix(ci): update release workflow to use workflow_dispatch (#45) ([736898d](https://github.com/zbigniewsobiecki/llmist/commit/736898d)), closes [#45](https://github.com/zbigniewsobiecki/llmist/issues/45) [#11](https://github.com/zbigniewsobiecki/llmist/issues/11) [#13](https://github.com/zbigniewsobiecki/llmist/issues/13)
* fix(ci): upgrade Node.js to v22 for semantic-release (#63) ([5a1b8d1](https://github.com/zbigniewsobiecki/llmist/commit/5a1b8d1)), closes [#63](https://github.com/zbigniewsobiecki/llmist/issues/63)
* chore(release): v0.3.0 - Final attempt with proper merge (#58) ([84187a2](https://github.com/zbigniewsobiecki/llmist/commit/84187a2)), closes [#58](https://github.com/zbigniewsobiecki/llmist/issues/58) [#11](https://github.com/zbigniewsobiecki/llmist/issues/11) [#13](https://github.com/zbigniewsobiecki/llmist/issues/13)
* chore(release): v0.3.0 (#49) ([2011a0a](https://github.com/zbigniewsobiecki/llmist/commit/2011a0a)), closes [#49](https://github.com/zbigniewsobiecki/llmist/issues/49) [#11](https://github.com/zbigniewsobiecki/llmist/issues/11) [#13](https://github.com/zbigniewsobiecki/llmist/issues/13)
* Merge pull request #44 from zbigniewsobiecki/release/v0.2.0 ([0377d5c](https://github.com/zbigniewsobiecki/llmist/commit/0377d5c)), closes [#44](https://github.com/zbigniewsobiecki/llmist/issues/44)

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog is automatically generated by [semantic-release](https://github.com/semantic-release/semantic-release).

---

## [0.2.0](https://github.com/zbigniewsobiecki/llmist/compare/v0.1.6...v0.2.0) (2025-11-26)

### Features

* **cli:** add accumulated token costs to progress indicator ([#27](https://github.com/zbigniewsobiecki/llmist/pull/27))

### Bug Fixes

* **cli:** resolve model aliases in complete command ([#36](https://github.com/zbigniewsobiecki/llmist/pull/36))
* **cli:** use ESM entry point for CLI binary ([#15](https://github.com/zbigniewsobiecki/llmist/pull/15))
* **deps:** upgrade OpenAI SDK to v6 to reduce node-domexception warnings ([#18](https://github.com/zbigniewsobiecki/llmist/pull/18))
* **docs:** correct README code examples ([#41](https://github.com/zbigniewsobiecki/llmist/pull/41))
* **parser:** use globally unique gadget invocation IDs ([#20](https://github.com/zbigniewsobiecki/llmist/pull/20))
* **prompts:** replace XML format with plain text ([#19](https://github.com/zbigniewsobiecki/llmist/pull/19))
* **test:** increase timeout test margins for CI coverage runs ([#13](https://github.com/zbigniewsobiecki/llmist/pull/13))

### Documentation

* add comprehensive HookPresets documentation ([#31](https://github.com/zbigniewsobiecki/llmist/pull/31))
* add work-in-progress warning to README ([#21](https://github.com/zbigniewsobiecki/llmist/pull/21))
* fix README badges for codecov and npm ([#32](https://github.com/zbigniewsobiecki/llmist/pull/32))
* update CLI command from 'chat' to 'complete' ([#14](https://github.com/zbigniewsobiecki/llmist/pull/14))
