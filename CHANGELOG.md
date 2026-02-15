## <small>15.18.1 (2026-02-15)</small>

* Merge pull request #395 from zbigniewsobiecki/fix/gemini-sse-stream-retry ([bc4d3c4](https://github.com/zbigniewsobiecki/llmist/commit/bc4d3c4)), closes [#395](https://github.com/zbigniewsobiecki/llmist/issues/395)
* Merge pull request #396 from zbigniewsobiecki/dev ([a8e70a3](https://github.com/zbigniewsobiecki/llmist/commit/a8e70a3)), closes [#396](https://github.com/zbigniewsobiecki/llmist/issues/396)
* fix(core): make Gemini SSE stream errors retryable ([b8f57f7](https://github.com/zbigniewsobiecki/llmist/commit/b8f57f7))

## 15.18.0 (2026-02-13)

* Merge pull request #393 from zbigniewsobiecki/feat/budget-limit ([d792290](https://github.com/zbigniewsobiecki/llmist/commit/d792290)), closes [#393](https://github.com/zbigniewsobiecki/llmist/issues/393)
* Merge pull request #394 from zbigniewsobiecki/dev ([d56ce5f](https://github.com/zbigniewsobiecki/llmist/commit/d56ce5f)), closes [#394](https://github.com/zbigniewsobiecki/llmist/issues/394)
* feat(agent): add budget limit for agent loop ([2a07e77](https://github.com/zbigniewsobiecki/llmist/commit/2a07e77))

## 15.17.0 (2026-02-13)

* Merge pull request #391 from zbigniewsobiecki/feat/tee-to-console ([e0c501a](https://github.com/zbigniewsobiecki/llmist/commit/e0c501a)), closes [#391](https://github.com/zbigniewsobiecki/llmist/issues/391)
* Merge pull request #392 from zbigniewsobiecki/dev ([82b7731](https://github.com/zbigniewsobiecki/llmist/commit/82b7731)), closes [#392](https://github.com/zbigniewsobiecki/llmist/issues/392)
* feat(logging): add teeToConsole option for dual file+stdout output ([f63a253](https://github.com/zbigniewsobiecki/llmist/commit/f63a253))

## 15.16.0 (2026-02-05)

* Merge pull request #389 from zbigniewsobiecki/feat/system-file-option ([735bdb7](https://github.com/zbigniewsobiecki/llmist/commit/735bdb7)), closes [#389](https://github.com/zbigniewsobiecki/llmist/issues/389)
* Merge pull request #390 from zbigniewsobiecki/dev ([4c43da2](https://github.com/zbigniewsobiecki/llmist/commit/4c43da2)), closes [#390](https://github.com/zbigniewsobiecki/llmist/issues/390)
* feat(cli): add --system-file option for loading system prompts from files ([d662c11](https://github.com/zbigniewsobiecki/llmist/commit/d662c11))

## <small>15.15.1 (2026-02-05)</small>

* Merge pull request #387 from zbigniewsobiecki/fix/max-gadgets-break-loop ([5c56c11](https://github.com/zbigniewsobiecki/llmist/commit/5c56c11)), closes [#387](https://github.com/zbigniewsobiecki/llmist/issues/387)
* Merge pull request #388 from zbigniewsobiecki/dev ([a43c6bf](https://github.com/zbigniewsobiecki/llmist/commit/a43c6bf)), closes [#388](https://github.com/zbigniewsobiecki/llmist/issues/388)
* fix(agent): break stream loop when gadget limit exceeded ([891c7e4](https://github.com/zbigniewsobiecki/llmist/commit/891c7e4))

## 15.15.0 (2026-02-05)

* Merge pull request #386 from zbigniewsobiecki/dev ([2ab73e5](https://github.com/zbigniewsobiecki/llmist/commit/2ab73e5)), closes [#386](https://github.com/zbigniewsobiecki/llmist/issues/386)
* feat(agent): add maxGadgetsPerResponse to gracefully limit gadget execution (#385) ([541b043](https://github.com/zbigniewsobiecki/llmist/commit/541b043)), closes [#385](https://github.com/zbigniewsobiecki/llmist/issues/385)

## <small>15.14.2 (2026-02-04)</small>

* Merge pull request #384 from zbigniewsobiecki/dev ([869c5b1](https://github.com/zbigniewsobiecki/llmist/commit/869c5b1)), closes [#384](https://github.com/zbigniewsobiecki/llmist/issues/384)
* fix(providers): split Gemini 3 thinking level maps for Pro vs Flash (#383) ([81f1e2b](https://github.com/zbigniewsobiecki/llmist/commit/81f1e2b)), closes [#383](https://github.com/zbigniewsobiecki/llmist/issues/383)

## <small>15.14.1 (2026-02-03)</small>

* Merge pull request #382 from zbigniewsobiecki/dev ([fb7b6b4](https://github.com/zbigniewsobiecki/llmist/commit/fb7b6b4)), closes [#382](https://github.com/zbigniewsobiecki/llmist/issues/382)
* fix(providers): make toolConfig and cachedContent mutually exclusive for Gemini (#381) ([997d6a3](https://github.com/zbigniewsobiecki/llmist/commit/997d6a3)), closes [#381](https://github.com/zbigniewsobiecki/llmist/issues/381)

## 15.14.0 (2026-02-03)

* Merge pull request #379 from zbigniewsobiecki/feat/unified-context-caching ([60509b3](https://github.com/zbigniewsobiecki/llmist/commit/60509b3)), closes [#379](https://github.com/zbigniewsobiecki/llmist/issues/379)
* Merge pull request #380 from zbigniewsobiecki/dev ([5510981](https://github.com/zbigniewsobiecki/llmist/commit/5510981)), closes [#380](https://github.com/zbigniewsobiecki/llmist/issues/380)
* feat(providers): add unified context caching across all providers ([43ced67](https://github.com/zbigniewsobiecki/llmist/commit/43ced67))

## 15.13.0 (2026-02-03)

* Merge pull request #377 from zbigniewsobiecki/feat/reasoning-models ([9b22738](https://github.com/zbigniewsobiecki/llmist/commit/9b22738)), closes [#377](https://github.com/zbigniewsobiecki/llmist/issues/377)
* Merge pull request #378 from zbigniewsobiecki/dev ([7fb77cf](https://github.com/zbigniewsobiecki/llmist/commit/7fb77cf)), closes [#378](https://github.com/zbigniewsobiecki/llmist/issues/378)
* Merge remote-tracking branch 'origin/dev' into feat/reasoning-models ([2404f5a](https://github.com/zbigniewsobiecki/llmist/commit/2404f5a))
* feat(cli): add reasoning model CLI support and fix cost calculations ([5bb7203](https://github.com/zbigniewsobiecki/llmist/commit/5bb7203))
* feat(providers): add first-class reasoning model support across all providers ([17d5003](https://github.com/zbigniewsobiecki/llmist/commit/17d5003))
* docs: add reasoning model documentation across all guides and provider pages ([d43540c](https://github.com/zbigniewsobiecki/llmist/commit/d43540c))

## 15.12.0 (2026-01-22)

* Merge pull request #376 from zbigniewsobiecki/dev ([668b43d](https://github.com/zbigniewsobiecki/llmist/commit/668b43d)), closes [#376](https://github.com/zbigniewsobiecki/llmist/issues/376)
* feat(agent): add HookPresets.fileLogging() for request/response logging (#375) ([f113e72](https://github.com/zbigniewsobiecki/llmist/commit/f113e72)), closes [#375](https://github.com/zbigniewsobiecki/llmist/issues/375)

## 15.11.0 (2026-01-21)

* Merge pull request #371 from zbigniewsobiecki/dev ([c1db3fe](https://github.com/zbigniewsobiecki/llmist/commit/c1db3fe)), closes [#371](https://github.com/zbigniewsobiecki/llmist/issues/371)
* feat(retry): add numeric status code support to isRetryableError() (#370) ([02318a9](https://github.com/zbigniewsobiecki/llmist/commit/02318a9)), closes [#370](https://github.com/zbigniewsobiecki/llmist/issues/370)

## 15.10.0 (2026-01-20)

* Merge pull request #368 from zbigniewsobiecki/feat/openrouter-model-updates ([2959a68](https://github.com/zbigniewsobiecki/llmist/commit/2959a68)), closes [#368](https://github.com/zbigniewsobiecki/llmist/issues/368)
* Merge pull request #369 from zbigniewsobiecki/dev ([6aeace9](https://github.com/zbigniewsobiecki/llmist/commit/6aeace9)), closes [#369](https://github.com/zbigniewsobiecki/llmist/issues/369)
* feat(providers): add new OpenRouter models and update pricing ([a86f962](https://github.com/zbigniewsobiecki/llmist/commit/a86f962)), closes [Hi#speed](https://github.com/Hi/issues/speed)

## 15.9.0 (2026-01-16)

* Merge pull request #366 from zbigniewsobiecki/feat/sequential-gadget-execution ([137157a](https://github.com/zbigniewsobiecki/llmist/commit/137157a)), closes [#366](https://github.com/zbigniewsobiecki/llmist/issues/366)
* Merge pull request #367 from zbigniewsobiecki/dev ([207d822](https://github.com/zbigniewsobiecki/llmist/commit/207d822)), closes [#367](https://github.com/zbigniewsobiecki/llmist/issues/367)
* feat(agent): add sequential gadget execution mode ([1995785](https://github.com/zbigniewsobiecki/llmist/commit/1995785))

## <small>15.8.1 (2026-01-14)</small>

* Merge pull request #365 from zbigniewsobiecki/dev ([7b4f20d](https://github.com/zbigniewsobiecki/llmist/commit/7b4f20d)), closes [#365](https://github.com/zbigniewsobiecki/llmist/issues/365)
* fix: concurrent subagent rate limiting (#364) ([14ad6a4](https://github.com/zbigniewsobiecki/llmist/commit/14ad6a4)), closes [#364](https://github.com/zbigniewsobiecki/llmist/issues/364)

## 15.8.0 (2026-01-14)

* Merge pull request #363 from zbigniewsobiecki/dev ([c415b86](https://github.com/zbigniewsobiecki/llmist/commit/c415b86)), closes [#363](https://github.com/zbigniewsobiecki/llmist/issues/363)
* feat(agent): share rate limits and retry config across subagents (#362) ([ca24248](https://github.com/zbigniewsobiecki/llmist/commit/ca24248)), closes [#362](https://github.com/zbigniewsobiecki/llmist/issues/362)

## <small>15.7.1 (2026-01-14)</small>

* Merge pull request #361 from zbigniewsobiecki/dev ([982e33d](https://github.com/zbigniewsobiecki/llmist/commit/982e33d)), closes [#361](https://github.com/zbigniewsobiecki/llmist/issues/361)
* fix(tui): forward arrow keys from input bar for scrolling in focused mode (#360) ([28c8940](https://github.com/zbigniewsobiecki/llmist/commit/28c8940)), closes [#360](https://github.com/zbigniewsobiecki/llmist/issues/360)

## 15.7.0 (2026-01-14)

* Merge pull request #359 from zbigniewsobiecki/dev ([981d1f4](https://github.com/zbigniewsobiecki/llmist/commit/981d1f4)), closes [#359](https://github.com/zbigniewsobiecki/llmist/issues/359)
* feat(tui): improve focused mode with line scrolling and Finish rendering (#358) ([65650b9](https://github.com/zbigniewsobiecki/llmist/commit/65650b9)), closes [#358](https://github.com/zbigniewsobiecki/llmist/issues/358)

## 15.6.0 (2026-01-14)

* feat(tui,agent): add llm_response_end event and TUI improvements ([1147780](https://github.com/zbigniewsobiecki/llmist/commit/1147780))
* Merge pull request #355 from zbigniewsobiecki/feat/tui-improvements-and-llm-response-end ([06b6323](https://github.com/zbigniewsobiecki/llmist/commit/06b6323)), closes [#355](https://github.com/zbigniewsobiecki/llmist/issues/355)
* Merge pull request #357 from zbigniewsobiecki/dev ([8667427](https://github.com/zbigniewsobiecki/llmist/commit/8667427)), closes [#357](https://github.com/zbigniewsobiecki/llmist/issues/357)
* fix(gadgets): use duck typing for TaskCompletionSignal detection (#356) ([d1bffbb](https://github.com/zbigniewsobiecki/llmist/commit/d1bffbb)), closes [#356](https://github.com/zbigniewsobiecki/llmist/issues/356)
* chore: sync dev with main [skip ci] ([9c8bbbd](https://github.com/zbigniewsobiecki/llmist/commit/9c8bbbd))
* feat(gadgets): add maxConcurrent property for sequential execution (#353) ([d7620e5](https://github.com/zbigniewsobiecki/llmist/commit/d7620e5)), closes [#353](https://github.com/zbigniewsobiecki/llmist/issues/353)

## 15.5.0 (2026-01-13)

* feat(gadgets): add maxConcurrent property for sequential execution (#353) (#354) ([4b37924](https://github.com/zbigniewsobiecki/llmist/commit/4b37924)), closes [#353](https://github.com/zbigniewsobiecki/llmist/issues/353) [#354](https://github.com/zbigniewsobiecki/llmist/issues/354)

## <small>15.4.1 (2026-01-12)</small>

* Merge pull request #350 from zbigniewsobiecki/fix/retry-stream-iteration-errors ([4acf3a4](https://github.com/zbigniewsobiecki/llmist/commit/4acf3a4)), closes [#350](https://github.com/zbigniewsobiecki/llmist/issues/350)
* Merge pull request #351 from zbigniewsobiecki/docs/openrouter-provider ([0f2eefd](https://github.com/zbigniewsobiecki/llmist/commit/0f2eefd)), closes [#351](https://github.com/zbigniewsobiecki/llmist/issues/351)
* Merge pull request #352 from zbigniewsobiecki/dev ([265102c](https://github.com/zbigniewsobiecki/llmist/commit/265102c)), closes [#352](https://github.com/zbigniewsobiecki/llmist/issues/352)
* docs(providers): add OpenRouter provider documentation ([2a3d12e](https://github.com/zbigniewsobiecki/llmist/commit/2a3d12e))
* fix(agent): retry errors during stream iteration, not just initial connection ([5ccebee](https://github.com/zbigniewsobiecki/llmist/commit/5ccebee))

## 15.4.0 (2026-01-12)

* Merge branch 'dev' into feat/openrouter-provider ([fc2d44a](https://github.com/zbigniewsobiecki/llmist/commit/fc2d44a)), closes [#347](https://github.com/zbigniewsobiecki/llmist/issues/347)
* Merge pull request #340 from zbigniewsobiecki/feat/openrouter-provider ([6748365](https://github.com/zbigniewsobiecki/llmist/commit/6748365)), closes [#340](https://github.com/zbigniewsobiecki/llmist/issues/340)
* Merge pull request #349 from zbigniewsobiecki/dev ([d7f828a](https://github.com/zbigniewsobiecki/llmist/commit/d7f828a)), closes [#349](https://github.com/zbigniewsobiecki/llmist/issues/349)
* feat(providers): add OpenRouter.ai provider with meta-provider architecture ([7c8151a](https://github.com/zbigniewsobiecki/llmist/commit/7c8151a))

## 15.3.0 (2026-01-11)

* Merge pull request #348 from zbigniewsobiecki/dev ([03c9bc0](https://github.com/zbigniewsobiecki/llmist/commit/03c9bc0)), closes [#348](https://github.com/zbigniewsobiecki/llmist/issues/348)
* feat(providers): retry 400 errors for HuggingFace serverless inference (#347) ([0d1dbe1](https://github.com/zbigniewsobiecki/llmist/commit/0d1dbe1)), closes [#347](https://github.com/zbigniewsobiecki/llmist/issues/347)
* chore: sync dev with main [skip ci] ([fa68209](https://github.com/zbigniewsobiecki/llmist/commit/fa68209))
* chore: sync dev with main [skip ci] ([91824ec](https://github.com/zbigniewsobiecki/llmist/commit/91824ec))
* test(coverage): add comprehensive test coverage improvements (#344) ([3529027](https://github.com/zbigniewsobiecki/llmist/commit/3529027)), closes [#344](https://github.com/zbigniewsobiecki/llmist/issues/344)

## <small>15.2.2 (2026-01-11)</small>

* test(coverage): add comprehensive test coverage improvements (#344) (#346) ([715ae3a](https://github.com/zbigniewsobiecki/llmist/commit/715ae3a)), closes [#344](https://github.com/zbigniewsobiecki/llmist/issues/344) [#346](https://github.com/zbigniewsobiecki/llmist/issues/346)

## <small>15.2.1 (2026-01-11)</small>

* Merge pull request #345 from zbigniewsobiecki/dev ([ee3042a](https://github.com/zbigniewsobiecki/llmist/commit/ee3042a)), closes [#345](https://github.com/zbigniewsobiecki/llmist/issues/345)
* fix(providers): correct context windows for DeepSeek-V3.2 and MiniMax-M2.1 (#343) ([91eee86](https://github.com/zbigniewsobiecki/llmist/commit/91eee86)), closes [#343](https://github.com/zbigniewsobiecki/llmist/issues/343)

## 15.2.0 (2026-01-11)

* Merge pull request #342 from zbigniewsobiecki/dev ([29e6341](https://github.com/zbigniewsobiecki/llmist/commit/29e6341)), closes [#342](https://github.com/zbigniewsobiecki/llmist/issues/342)
* feat(providers): add pricing for DeepSeek-V3.2 and MiniMax-M2.1 on HuggingFace (#341) ([c5ba512](https://github.com/zbigniewsobiecki/llmist/commit/c5ba512)), closes [#341](https://github.com/zbigniewsobiecki/llmist/issues/341)

## <small>15.1.2 (2026-01-10)</small>

* Merge pull request #339 from zbigniewsobiecki/dev ([3be7bd5](https://github.com/zbigniewsobiecki/llmist/commit/3be7bd5)), closes [#339](https://github.com/zbigniewsobiecki/llmist/issues/339)
* fix(core): default temperature to 0 when not specified (#338) ([d1b35c5](https://github.com/zbigniewsobiecki/llmist/commit/d1b35c5)), closes [#338](https://github.com/zbigniewsobiecki/llmist/issues/338)

## <small>15.1.1 (2026-01-09)</small>

* Merge pull request #337 from zbigniewsobiecki/fix/remove-hardcoded-telluser ([ae2fc84](https://github.com/zbigniewsobiecki/llmist/commit/ae2fc84)), closes [#337](https://github.com/zbigniewsobiecki/llmist/issues/337)
* fix(agent): remove hardcoded TellUser synthetic gadget ([18790e1](https://github.com/zbigniewsobiecki/llmist/commit/18790e1))

## 15.1.0 (2026-01-09)

* Merge pull request #335 from zbigniewsobiecki/feat/rate-limit-triggered-by ([37827e9](https://github.com/zbigniewsobiecki/llmist/commit/37827e9)), closes [#335](https://github.com/zbigniewsobiecki/llmist/issues/335)
* Merge pull request #336 from zbigniewsobiecki/dev ([9ea7549](https://github.com/zbigniewsobiecki/llmist/commit/9ea7549)), closes [#336](https://github.com/zbigniewsobiecki/llmist/issues/336)
* feat(core): add triggeredBy to RateLimitStats for better throttle feedback ([d542b1b](https://github.com/zbigniewsobiecki/llmist/commit/d542b1b)), closes [#334](https://github.com/zbigniewsobiecki/llmist/issues/334)

## 15.0.0 (2026-01-08)

* Merge pull request #334 from zbigniewsobiecki/dev ([aac55b5](https://github.com/zbigniewsobiecki/llmist/commit/aac55b5)), closes [#334](https://github.com/zbigniewsobiecki/llmist/issues/334)
* feat(gadgets): replace EditFile ed-based implementation with search/replace (#333) ([2884a19](https://github.com/zbigniewsobiecki/llmist/commit/2884a19)), closes [#333](https://github.com/zbigniewsobiecki/llmist/issues/333)


### BREAKING CHANGE

* EditFile schema changed from { filePath, commands } to
{ filePath, search, replace }

Co-authored-by: Claude Opus 4.5 <noreply@anthropic.com>

## 14.0.0 (2026-01-08)

* Merge main into dev: resolve CHANGELOG conflict ([4dd586c](https://github.com/zbigniewsobiecki/llmist/commit/4dd586c))
* Merge pull request #331 from zbigniewsobiecki/docs/rate-limiting-complete ([65d13f3](https://github.com/zbigniewsobiecki/llmist/commit/65d13f3)), closes [#331](https://github.com/zbigniewsobiecki/llmist/issues/331)
* Merge pull request #332 from zbigniewsobiecki/dev ([eee3dcb](https://github.com/zbigniewsobiecki/llmist/commit/eee3dcb)), closes [#332](https://github.com/zbigniewsobiecki/llmist/issues/332)
* docs: comprehensive rate limiting and retry documentation ([c2770f5](https://github.com/zbigniewsobiecki/llmist/commit/c2770f5)), closes [#329](https://github.com/zbigniewsobiecki/llmist/issues/329)
* feat(cli): integrate rate limiting with TUI feedback and auto-detection (#329) ([f3731b7](https://github.com/zbigniewsobiecki/llmist/commit/f3731b7)), closes [#329](https://github.com/zbigniewsobiecki/llmist/issues/329)


### BREAKING CHANGE

* Rate limiting now enabled by default with conservative
limits to protect free tier users. Paid tier users should configure
higher limits in ~/.llmist/cli.toml or use --no-rate-limit flag.

## Features

### Configuration Infrastructure
- Add TOML schema for rate-limits and retry config sections
- Add CLI flags: --rate-limit-rpm, --rate-limit-tpm, --rate-limit-daily,
  --rate-limit-safety-margin, --no-rate-limit, --max-retries, --no-retry
- Implement 4-layer precedence: CLI flags > Profile TOML > Global TOML > Provider defaults
- Auto-detect provider from model string (anthropic, openai, gemini)

### Provider-Specific Defaults
- Anthropic: 50 RPM / 40K TPM (Tier 1 safe)
- OpenAI: 3 RPM / 40K TPM (Free tier safe)
- Gemini: 15 RPM / 1M TPM / 1.5M daily (Free tier safe)

### TUI Feedback System
- Add observer hooks: onRateLimitThrottle, onRetryAttempt
- Status bar indicators: ⏸ Throttled Xs, 🔄 Retry N/M
- Conversation log entries for rate limiting events
- Auto-clearing indicators after completion

### Enhanced Error Messages
- Context-aware error formatting with FormatLLMErrorContext
- Provider-specific documentation URLs when retries exhausted
- Multi-line actionable guidance for rate limit errors

### Documentation
- Comprehensive rate limiting section in CLI README
- Breaking change notice in CHANGELOG with migration guide
- Configuration examples for all methods (CLI, TOML, auto-detect)

## Implementation Details

**New Files:**
- packages/cli/src/rate-limit-resolver.ts: Provider detection & config resolution
- packages/cli/src/rate-limit-resolver.test.ts: 33 comprehensive tests

**Modified Files (16):**
- Configuration: config.ts, constants.ts, option-helpers.ts, program.ts
- Integration: agent-command.ts, complete-command.ts, custom-command.ts
- Core: agent.ts, hooks.ts, retry.ts
- TUI: status-bar.ts, types.ts, block-renderer.ts, index.ts
- Exports: agent/index.ts, index.ts
- Docs: README.md, CHANGELOG.md

## Testing
- Added 33 unit tests for rate limit resolver
- Added 8 tests for enhanced error formatting
- All 2894 tests passing across 107 test files
- 100% TypeScript compilation successful

## Migration Guide

For paid tier users experiencing slower execution:

```toml
# ~/.llmist/cli.toml
[rate-limits]
requests-per-minute = 500  # Your actual tier limit
tokens-per-minute = 200_000
```

Or disable entirely:
```bash
llmist agent --no-rate-limit "your prompt"
```

Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>

## 13.0.0 (2026-01-08)

* feat(cli): integrate rate limiting with TUI feedback and auto-detection (#329) (#330) ([d70269f](https://github.com/zbigniewsobiecki/llmist/commit/d70269f)), closes [#329](https://github.com/zbigniewsobiecki/llmist/issues/329) [#330](https://github.com/zbigniewsobiecki/llmist/issues/330)


### BREAKING CHANGE

* Rate limiting now enabled by default with conservative
limits to protect free tier users. Paid tier users should configure
higher limits in ~/.llmist/cli.toml or use --no-rate-limit flag.

## Features

### Configuration Infrastructure
- Add TOML schema for rate-limits and retry config sections
- Add CLI flags: --rate-limit-rpm, --rate-limit-tpm, --rate-limit-daily,
  --rate-limit-safety-margin, --no-rate-limit, --max-retries, --no-retry
- Implement 4-layer precedence: CLI flags > Profile TOML > Global TOML > Provider defaults
- Auto-detect provider from model string (anthropic, openai, gemini)

### Provider-Specific Defaults
- Anthropic: 50 RPM / 40K TPM (Tier 1 safe)
- OpenAI: 3 RPM / 40K TPM (Free tier safe)
- Gemini: 15 RPM / 1M TPM / 1.5M daily (Free tier safe)

### TUI Feedback System
- Add observer hooks: onRateLimitThrottle, onRetryAttempt
- Status bar indicators: ⏸ Throttled Xs, 🔄 Retry N/M
- Conversation log entries for rate limiting events
- Auto-clearing indicators after completion

### Enhanced Error Messages
- Context-aware error formatting with FormatLLMErrorContext
- Provider-specific documentation URLs when retries exhausted
- Multi-line actionable guidance for rate limit errors

### Documentation
- Comprehensive rate limiting section in CLI README
- Breaking change notice in CHANGELOG with migration guide
- Configuration examples for all methods (CLI, TOML, auto-detect)

## Implementation Details

**New Files:**
- packages/cli/src/rate-limit-resolver.ts: Provider detection & config resolution
- packages/cli/src/rate-limit-resolver.test.ts: 33 comprehensive tests

**Modified Files (16):**
- Configuration: config.ts, constants.ts, option-helpers.ts, program.ts
- Integration: agent-command.ts, complete-command.ts, custom-command.ts
- Core: agent.ts, hooks.ts, retry.ts
- TUI: status-bar.ts, types.ts, block-renderer.ts, index.ts
- Exports: agent/index.ts, index.ts
- Docs: README.md, CHANGELOG.md

## Testing
- Added 33 unit tests for rate limit resolver
- Added 8 tests for enhanced error formatting
- All 2894 tests passing across 107 test files
- 100% TypeScript compilation successful

## Migration Guide

For paid tier users experiencing slower execution:

```toml
# ~/.llmist/cli.toml
[rate-limits]
requests-per-minute = 500  # Your actual tier limit
tokens-per-minute = 200_000
```

Or disable entirely:
```bash
llmist agent --no-rate-limit "your prompt"
```

Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>

## UNRELEASED

### 💥 BREAKING CHANGE: Rate Limiting Enabled by Default

**What Changed:**
llmist CLI now enables **conservative rate limiting by default** to prevent rate limit errors and agent crashes.

**Default Limits:**
- **Anthropic**: 50 RPM / 40K TPM
- **OpenAI**: 3 RPM / 40K TPM
- **Gemini**: 15 RPM / 1M TPM / 1.5M daily tokens

**Who Is Affected:**

✅ **Free tier users**: Protected from rate limits automatically. No action required.

⚠️ **Paid tier users**: Your agents may run slower than necessary with conservative defaults.

**Action Required for Paid Tiers:**

Configure your actual tier limits in `~/.llmist/cli.toml`:

```toml
[rate-limits]
requests-per-minute = 500  # Your actual tier limit
tokens-per-minute = 200_000
```

Or disable rate limiting entirely:
```bash
llmist agent --no-rate-limit "your prompt"
```

**New Features:**

- 🎯 Auto-detected rate limits based on model provider
- 📊 TUI feedback: Status bar indicators (`⏸ Throttled`, `🔄 Retry`)
- 📝 Conversation log entries for rate limit events
- ⚙️ CLI flags: `--rate-limit-rpm`, `--rate-limit-tpm`, `--no-rate-limit`
- 🔧 TOML configuration support (global and profile-specific)
- ❌ Enhanced error messages with provider-specific guidance

**Documentation:**
- [CLI README - Rate Limiting](https://github.com/zbigniewsobiecki/llmist/blob/main/packages/cli/README.md#rate-limiting)
- [Provider Rate Limits - Anthropic](https://docs.anthropic.com/en/api/rate-limits)
- [Provider Rate Limits - OpenAI](https://platform.openai.com/docs/guides/rate-limits)
- [Provider Rate Limits - Gemini](https://ai.google.dev/gemini-api/docs/quota)

---

## 12.4.0 (2026-01-05)

* Merge pull request #328 from zbigniewsobiecki/dev ([0f70974](https://github.com/zbigniewsobiecki/llmist/commit/0f70974)), closes [#328](https://github.com/zbigniewsobiecki/llmist/issues/328)
* feat(core): add two-layer rate limit protection system (#327) ([26265f1](https://github.com/zbigniewsobiecki/llmist/commit/26265f1)), closes [#327](https://github.com/zbigniewsobiecki/llmist/issues/327)

## <small>12.3.6 (2026-01-04)</small>

* Merge pull request #326 from zbigniewsobiecki/dev ([1631c3c](https://github.com/zbigniewsobiecki/llmist/commit/1631c3c)), closes [#326](https://github.com/zbigniewsobiecki/llmist/issues/326)
* fix(agent): emit llm_call_complete when generator terminates early (#325) ([a78d900](https://github.com/zbigniewsobiecki/llmist/commit/a78d900)), closes [#325](https://github.com/zbigniewsobiecki/llmist/issues/325)

## <small>12.3.5 (2026-01-04)</small>

* Merge pull request #324 from zbigniewsobiecki/dev ([0ab3c68](https://github.com/zbigniewsobiecki/llmist/commit/0ab3c68)), closes [#324](https://github.com/zbigniewsobiecki/llmist/issues/324)
* fix(cli): keep TUI session content visible after completion (#323) ([2092808](https://github.com/zbigniewsobiecki/llmist/commit/2092808)), closes [#323](https://github.com/zbigniewsobiecki/llmist/issues/323)

## <small>12.3.4 (2026-01-03)</small>

* fix: chain subagent observer calls to ensure proper event ordering ([f104fe8](https://github.com/zbigniewsobiecki/llmist/commit/f104fe8))

## <small>12.3.3 (2026-01-03)</small>

* fix: bridge subagent gadget events to parent observers via ExecutionTree ([c29ff02](https://github.com/zbigniewsobiecki/llmist/commit/c29ff02))
* fix: bridge subagent gadget events to parent observers via ExecutionTree ([f65ee49](https://github.com/zbigniewsobiecki/llmist/commit/f65ee49))

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
