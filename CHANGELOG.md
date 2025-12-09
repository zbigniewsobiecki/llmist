## 2.3.0 (2025-12-09)

* Merge pull request #159 from zbigniewsobiecki/dev ([643d52d](https://github.com/zbigniewsobiecki/llmist/commit/643d52d)), closes [#159](https://github.com/zbigniewsobiecki/llmist/issues/159)
* feat(testing): add test coverage and improve discoverability (#158) ([7f10c98](https://github.com/zbigniewsobiecki/llmist/commit/7f10c98)), closes [#158](https://github.com/zbigniewsobiecki/llmist/issues/158)

## 2.2.0 (2025-12-09)

* feat(agent): add native abort signal handling in agent loop (#157) ([2b7fa46](https://github.com/zbigniewsobiecki/llmist/commit/2b7fa46)), closes [#157](https://github.com/zbigniewsobiecki/llmist/issues/157)

## 2.1.0 (2025-12-09)

* Merge pull request #156 from zbigniewsobiecki/dev ([eb86a60](https://github.com/zbigniewsobiecki/llmist/commit/eb86a60)), closes [#156](https://github.com/zbigniewsobiecki/llmist/issues/156)
* feat(agent): add onLLMCallReady hook for post-controller logging (#154) ([2c40cbd](https://github.com/zbigniewsobiecki/llmist/commit/2c40cbd)), closes [#154](https://github.com/zbigniewsobiecki/llmist/issues/154)
* feat(cli): session-based LLM request/response logging (#150) ([3a5fb5d](https://github.com/zbigniewsobiecki/llmist/commit/3a5fb5d)), closes [#150](https://github.com/zbigniewsobiecki/llmist/issues/150)
* feat(cli): universal approval prompt format and add ed to Docker (#151) ([0686701](https://github.com/zbigniewsobiecki/llmist/commit/0686701)), closes [#151](https://github.com/zbigniewsobiecki/llmist/issues/151)
* feat(docker): add docker-args for extra container options (#152) ([d2a7360](https://github.com/zbigniewsobiecki/llmist/commit/d2a7360)), closes [#152](https://github.com/zbigniewsobiecki/llmist/issues/152)
* feat(gadgets): add onAbort and createLinkedAbortController helpers (#155) ([91c60eb](https://github.com/zbigniewsobiecki/llmist/commit/91c60eb)), closes [#155](https://github.com/zbigniewsobiecki/llmist/issues/155)
* fix(cli): improve Ctrl+C and ESC signal handling reliability (#153) ([d0ace4e](https://github.com/zbigniewsobiecki/llmist/commit/d0ace4e)), closes [#153](https://github.com/zbigniewsobiecki/llmist/issues/153)
* docs(gadgets): add multiline body example to RunCommand (#149) ([3a99272](https://github.com/zbigniewsobiecki/llmist/commit/3a99272)), closes [#149](https://github.com/zbigniewsobiecki/llmist/issues/149)

## 2.0.0 (2025-12-08)

* Merge pull request #148 from zbigniewsobiecki/dev ([21575d9](https://github.com/zbigniewsobiecki/llmist/commit/21575d9)), closes [#148](https://github.com/zbigniewsobiecki/llmist/issues/148)
* feat(gadgets): add AbortSignal support for gadget cancellation (#145) ([efc741f](https://github.com/zbigniewsobiecki/llmist/commit/efc741f)), closes [#145](https://github.com/zbigniewsobiecki/llmist/issues/145)
* feat(gadgets): add callback-based cost reporting with auto LLM tracking (#144) ([05196d2](https://github.com/zbigniewsobiecki/llmist/commit/05196d2)), closes [#144](https://github.com/zbigniewsobiecki/llmist/issues/144)
* feat(gadgets): refactor RunCommand to use argv array (#147) ([37d96ab](https://github.com/zbigniewsobiecki/llmist/commit/37d96ab)), closes [#147](https://github.com/zbigniewsobiecki/llmist/issues/147)


### BREAKING CHANGE

* RunCommand now accepts `argv` array instead of `command` string.

This change eliminates shell interpretation issues by passing arguments
directly to `Bun.spawn()` without involving `sh -c`. Special characters
like backticks, quotes, and newlines are now preserved correctly.

The block format's JSON Pointer support (`argv/0`, `argv/1`, etc.)
naturally handles array elements, and `formatParamsAsBlock` already
renders arrays in exploded format for LLM examples.

Also eliminates code duplication by having examples/gadgets/run-command.ts
re-export from the builtin.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>

* test(gadgets): add comprehensive unit tests for RunCommand

Adds dedicated test file addressing code review feedback:
- Empty argv array validation
- Command timeout handling
- Spawn failure / command not found
- No output command (returns "(no output)")
- Special character preservation (backticks, quotes)
- Combined stdout/stderr output
- Multiline output handling
- cwd option

Achieves 100% code coverage for run-command.ts

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>

## 1.7.0 (2025-12-04)

* Merge pull request #143 from zbigniewsobiecki/dev ([8a11d1d](https://github.com/zbigniewsobiecki/llmist/commit/8a11d1d)), closes [#143](https://github.com/zbigniewsobiecki/llmist/issues/143)
* feat(agent): add withTrailingMessage() for ephemeral message injection (#142) ([d17933a](https://github.com/zbigniewsobiecki/llmist/commit/d17933a)), closes [#142](https://github.com/zbigniewsobiecki/llmist/issues/142)
* chore: sync dev with main after release [skip ci] ([28f8204](https://github.com/zbigniewsobiecki/llmist/commit/28f8204))
* chore: sync dev with main after release [skip ci] ([dac7104](https://github.com/zbigniewsobiecki/llmist/commit/dac7104))
* chore: sync dev with main after release [skip ci] ([237ea7a](https://github.com/zbigniewsobiecki/llmist/commit/237ea7a))
* fix(docker): use DockerSkipError instanceof check instead of message string (#138) ([b4ce313](https://github.com/zbigniewsobiecki/llmist/commit/b4ce313)), closes [#138](https://github.com/zbigniewsobiecki/llmist/issues/138)
* fix(gadgets): add output size limiting to GadgetOutputViewer (#140) ([20e972b](https://github.com/zbigniewsobiecki/llmist/commit/20e972b)), closes [#140](https://github.com/zbigniewsobiecki/llmist/issues/140)

## <small>1.6.2 (2025-12-04)</small>

* fix(gadgets): add output size limiting to GadgetOutputViewer ([e628d95](https://github.com/zbigniewsobiecki/llmist/commit/e628d95))
* chore(release): merge dev to main (#141) ([77e5e09](https://github.com/zbigniewsobiecki/llmist/commit/77e5e09)), closes [#141](https://github.com/zbigniewsobiecki/llmist/issues/141) [#138](https://github.com/zbigniewsobiecki/llmist/issues/138) [#140](https://github.com/zbigniewsobiecki/llmist/issues/140)

## <small>1.6.1 (2025-12-04)</small>

* fix(docker): use DockerSkipError instanceof check instead of message string (#138) (#139) ([d623c97](https://github.com/zbigniewsobiecki/llmist/commit/d623c97)), closes [#138](https://github.com/zbigniewsobiecki/llmist/issues/138) [#139](https://github.com/zbigniewsobiecki/llmist/issues/139)

## 1.6.0 (2025-12-04)

* Merge pull request #137 from zbigniewsobiecki/dev ([e17f61c](https://github.com/zbigniewsobiecki/llmist/commit/e17f61c)), closes [#137](https://github.com/zbigniewsobiecki/llmist/issues/137)
* feat(cli): add Docker sandboxing for secure agent execution (#136) ([c948b03](https://github.com/zbigniewsobiecki/llmist/commit/c948b03)), closes [#136](https://github.com/zbigniewsobiecki/llmist/issues/136)
* feat(gadgets): improve parameter documentation for better LLM comprehension (#134) ([c49e423](https://github.com/zbigniewsobiecki/llmist/commit/c49e423)), closes [#134](https://github.com/zbigniewsobiecki/llmist/issues/134)
* chore: sync dev with main after release [skip ci] ([c73a8d6](https://github.com/zbigniewsobiecki/llmist/commit/c73a8d6))

## 1.5.0 (2025-12-03)

* feat(gadgets): improve parameter documentation for better LLM comprehension (#134) (#135) ([045250b](https://github.com/zbigniewsobiecki/llmist/commit/045250b)), closes [#134](https://github.com/zbigniewsobiecki/llmist/issues/134) [#135](https://github.com/zbigniewsobiecki/llmist/issues/135)

## 1.4.0 (2025-12-02)

* chore: sync dev with main after release [skip ci] ([081ccec](https://github.com/zbigniewsobiecki/llmist/commit/081ccec))
* chore(release): merge dev to main (#133) ([e405dcd](https://github.com/zbigniewsobiecki/llmist/commit/e405dcd)), closes [#133](https://github.com/zbigniewsobiecki/llmist/issues/133) [#129](https://github.com/zbigniewsobiecki/llmist/issues/129)
* chore(release): merge dev to main for release ([f0ff593](https://github.com/zbigniewsobiecki/llmist/commit/f0ff593))
* feat(cli): add built-in gadget specifier system (#130) ([87cb244](https://github.com/zbigniewsobiecki/llmist/commit/87cb244)), closes [#130](https://github.com/zbigniewsobiecki/llmist/issues/130)
* feat(cli): add configurable gadget approval system with diff display (#129) ([8781749](https://github.com/zbigniewsobiecki/llmist/commit/8781749)), closes [#129](https://github.com/zbigniewsobiecki/llmist/issues/129)
* feat(cli): add ESC key cancellation for LLM requests (#132) ([eec210e](https://github.com/zbigniewsobiecki/llmist/commit/eec210e)), closes [#132](https://github.com/zbigniewsobiecki/llmist/issues/132)
* feat(cli): add gadget inheritance with add/remove support (#131) ([4aeb778](https://github.com/zbigniewsobiecki/llmist/commit/4aeb778)), closes [#131](https://github.com/zbigniewsobiecki/llmist/issues/131)

## <small>1.3.1 (2025-12-02)</small>

* Merge pull request #126 from zbigniewsobiecki/feat/test-coverage-improvements ([59ac763](https://github.com/zbigniewsobiecki/llmist/commit/59ac763)), closes [#126](https://github.com/zbigniewsobiecki/llmist/issues/126)
* Merge pull request #127 from zbigniewsobiecki/chore/readme-update ([3b1dc78](https://github.com/zbigniewsobiecki/llmist/commit/3b1dc78)), closes [#127](https://github.com/zbigniewsobiecki/llmist/issues/127)
* Merge pull request #128 from zbigniewsobiecki/dev ([16404ee](https://github.com/zbigniewsobiecki/llmist/commit/16404ee)), closes [#128](https://github.com/zbigniewsobiecki/llmist/issues/128)
* chore: readme updates ([d7c9782](https://github.com/zbigniewsobiecki/llmist/commit/d7c9782))
* test: add comprehensive tests for core architecture ([8cc453f](https://github.com/zbigniewsobiecki/llmist/commit/8cc453f))

## 1.3.0 (2025-12-01)

* Merge pull request #117 from zbigniewsobiecki/dev ([5088ef4](https://github.com/zbigniewsobiecki/llmist/commit/5088ef4)), closes [#117](https://github.com/zbigniewsobiecki/llmist/issues/117)
* Merge pull request #125 from zbigniewsobiecki/dev ([0b3fa36](https://github.com/zbigniewsobiecki/llmist/commit/0b3fa36)), closes [#125](https://github.com/zbigniewsobiecki/llmist/issues/125)
* chore: sync dev with main after release [skip ci] ([1e8a1b3](https://github.com/zbigniewsobiecki/llmist/commit/1e8a1b3))
* fix(ci): include all test directories in coverage reporting (#124) ([ee1656b](https://github.com/zbigniewsobiecki/llmist/commit/ee1656b)), closes [#124](https://github.com/zbigniewsobiecki/llmist/issues/124)
* feat(agent): add automatic context compaction system (#119) ([05f3c30](https://github.com/zbigniewsobiecki/llmist/commit/05f3c30)), closes [#119](https://github.com/zbigniewsobiecki/llmist/issues/119)
* feat(agent): add LLM assistance hints system (#123) ([9219bc1](https://github.com/zbigniewsobiecki/llmist/commit/9219bc1)), closes [#123](https://github.com/zbigniewsobiecki/llmist/issues/123)
* feat(templates): add built-in date variable for prompt templates (#120) ([98fea89](https://github.com/zbigniewsobiecki/llmist/commit/98fea89)), closes [#120](https://github.com/zbigniewsobiecki/llmist/issues/120)
* test: add comprehensive test coverage for critical paths (#121) ([86f76d0](https://github.com/zbigniewsobiecki/llmist/commit/86f76d0)), closes [#121](https://github.com/zbigniewsobiecki/llmist/issues/121) [#122](https://github.com/zbigniewsobiecki/llmist/issues/122)
* refactor(cli): separate task completion from user messaging (#122) ([db65770](https://github.com/zbigniewsobiecki/llmist/commit/db65770)), closes [#122](https://github.com/zbigniewsobiecki/llmist/issues/122)
* docs: update documentation and fix deprecated format examples (#118) ([bcd307c](https://github.com/zbigniewsobiecki/llmist/commit/bcd307c)), closes [#118](https://github.com/zbigniewsobiecki/llmist/issues/118)
* docs: update documentation for block format only (#116) ([6a875c8](https://github.com/zbigniewsobiecki/llmist/commit/6a875c8)), closes [#116](https://github.com/zbigniewsobiecki/llmist/issues/116)

## 1.2.0 (2025-12-01)

* Merge pull request #115 from zbigniewsobiecki/dev ([fff0bf1](https://github.com/zbigniewsobiecki/llmist/commit/fff0bf1)), closes [#115](https://github.com/zbigniewsobiecki/llmist/issues/115)
* feat(gadgets): add schema-aware type coercion for block parameters (#114) ([0b62ddf](https://github.com/zbigniewsobiecki/llmist/commit/0b62ddf)), closes [#114](https://github.com/zbigniewsobiecki/llmist/issues/114)

## 1.1.0 (2025-11-30)

* Merge pull request #113 from zbigniewsobiecki/dev ([8e9d0a3](https://github.com/zbigniewsobiecki/llmist/commit/8e9d0a3)), closes [#113](https://github.com/zbigniewsobiecki/llmist/issues/113)
* fix(tests): add timer tolerance to async callback test ([14f8f2d](https://github.com/zbigniewsobiecki/llmist/commit/14f8f2d))
* feat(cli): add gadget subcommand for testing gadgets outside agent loop (#111) ([a4d8c4a](https://github.com/zbigniewsobiecki/llmist/commit/a4d8c4a)), closes [#111](https://github.com/zbigniewsobiecki/llmist/issues/111)
* feat(gadgets): add helpful error messages with gadget usage instructions (#112) ([68cd4d3](https://github.com/zbigniewsobiecki/llmist/commit/68cd4d3)), closes [#112](https://github.com/zbigniewsobiecki/llmist/issues/112)

## 1.0.0 (2025-11-30)

* Merge pull request #110 from zbigniewsobiecki/dev ([3da969f](https://github.com/zbigniewsobiecki/llmist/commit/3da969f)), closes [#110](https://github.com/zbigniewsobiecki/llmist/issues/110)
* fix(cli): improve streaming output and add rainbow markdown separators (#109) ([cad0843](https://github.com/zbigniewsobiecki/llmist/commit/cad0843)), closes [#109](https://github.com/zbigniewsobiecki/llmist/issues/109)
* feat: simplify to block-only format and fix custom argPrefix propagation (#108) ([2306ebe](https://github.com/zbigniewsobiecki/llmist/commit/2306ebe)), closes [#108](https://github.com/zbigniewsobiecki/llmist/issues/108)


### BREAKING CHANGE

* Remove YAML, JSON, TOML, and XML parameter formats.
The gadget system now uses exclusively the block format with !!!ARG: markers.

## Block Format Simplification
- Remove xml-params.ts and all XML parameter handling
- Remove YAML/JSON/TOML format options from parser
- Simplify StreamParser to only handle block format
- Remove parameterFormat configuration option
- Update all tests to use block format exclusively

## Custom argPrefix Propagation Fix
- Add argPrefix parameter to formatParamsAsBlock() in gadget.ts
- Add argPrefix parameter to getInstruction() for gadget examples
- Update buildGadgetsSection() to pass custom argPrefix to gadgets
- Make DEFAULT_PROMPTS.formatDescription dynamic using context.argPrefix
- Update formatBlockParameters() in messages.ts to use configured prefix
- Add comprehensive tests for custom prefix propagation

## Other Improvements
- Simplify prompt configuration (remove format-specific descriptions)
- Clean up constants (remove unused format-related constants)
- Update documentation to reflect block-only format

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix(cli): render markdown for orphan text output

When an LLM outputs plain text instead of using the TellUser gadget,
the CLI now renders it with markdown formatting. This ensures headers,
bullets, code blocks, etc. are displayed properly rather than as raw text.

Implementation details:
- Text chunks are accumulated in a buffer during streaming
- Markdown is rendered when a non-text event occurs or at stream end
- This ensures complete markdown structures are parsed together

Also fixes test isolation issues caused by chalk.level being set
globally when renderMarkdown initializes marked-terminal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix(cli): render bold/italic in markdown list items

Workaround for marked-terminal bug where inline markdown (**bold** and
*italic*) inside list items is not processed. The library's listitem
renderer doesn't call parseInline() like the paragraph renderer does.

Post-process the marked output to handle any remaining unrendered
inline formatting using regex replacement with chalk styling.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>

* fix: use configured gadgetArgPrefix in synthetic history and rename parametersYaml

- Fix formatBlockParameters to use this.gadgetArgPrefix instead of hardcoded "!!!ARG:"
- Add comprehensive tests for withSyntheticGadgetCall with custom prefixes
- Rename misleading parametersYaml property to parametersRaw across codebase
  (YAML parsing was removed, property now holds raw block-format parameters)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>

## 0.8.0 (2025-11-29)

* Merge pull request #107 from zbigniewsobiecki/dev ([7e51257](https://github.com/zbigniewsobiecki/llmist/commit/7e51257)), closes [#107](https://github.com/zbigniewsobiecki/llmist/issues/107)
* chore: remove stale planning documents (#106) ([44417f7](https://github.com/zbigniewsobiecki/llmist/commit/44417f7)), closes [#106](https://github.com/zbigniewsobiecki/llmist/issues/106)
* feat(cli): add config inheritance, quiet mode, and improve gadget loading (#103) ([cd0fe16](https://github.com/zbigniewsobiecki/llmist/commit/cd0fe16)), closes [#103](https://github.com/zbigniewsobiecki/llmist/issues/103)
* feat(cli): add prompt templates with Eta.js for reusable prompt composition (#105) ([1e738a1](https://github.com/zbigniewsobiecki/llmist/commit/1e738a1)), closes [#105](https://github.com/zbigniewsobiecki/llmist/issues/105)
* feat(providers): add prompt caching support for all providers (#102) ([f937c46](https://github.com/zbigniewsobiecki/llmist/commit/f937c46)), closes [#102](https://github.com/zbigniewsobiecki/llmist/issues/102)
* docs(cookbook): add todo gadgets recipe for agent task planning (#104) ([a7aaa0d](https://github.com/zbigniewsobiecki/llmist/commit/a7aaa0d)), closes [#104](https://github.com/zbigniewsobiecki/llmist/issues/104)
* fix(gadgets): use unique heredoc delimiters to avoid shell conflicts (#101) ([52efaab](https://github.com/zbigniewsobiecki/llmist/commit/52efaab)), closes [#101](https://github.com/zbigniewsobiecki/llmist/issues/101)

## 0.7.0 (2025-11-29)

* Merge pull request #100 from zbigniewsobiecki/dev ([eb68f6d](https://github.com/zbigniewsobiecki/llmist/commit/eb68f6d)), closes [#100](https://github.com/zbigniewsobiecki/llmist/issues/100)
* feat(agent): add synthetic gadget calls for in-context learning (#99) ([962108b](https://github.com/zbigniewsobiecki/llmist/commit/962108b)), closes [#99](https://github.com/zbigniewsobiecki/llmist/issues/99)
* fix(gadgets): use proper TOML inline table syntax in examples (#98) ([a3f2b37](https://github.com/zbigniewsobiecki/llmist/commit/a3f2b37)), closes [#98](https://github.com/zbigniewsobiecki/llmist/issues/98)
* fix(parser): strip markdown code fences from gadget parameters (#97) ([2daca17](https://github.com/zbigniewsobiecki/llmist/commit/2daca17)), closes [#97](https://github.com/zbigniewsobiecki/llmist/issues/97)
* docs: add CLAUDE.md with git workflow guidelines (#96) ([32ed581](https://github.com/zbigniewsobiecki/llmist/commit/32ed581)), closes [#96](https://github.com/zbigniewsobiecki/llmist/issues/96)

## <small>0.6.2 (2025-11-29)</small>

* fix(toml): TOML heredoc parsing fixes for code with regex patterns (#95) ([582aca8](https://github.com/zbigniewsobiecki/llmist/commit/582aca8)), closes [#95](https://github.com/zbigniewsobiecki/llmist/issues/95)

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
