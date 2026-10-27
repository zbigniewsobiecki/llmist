# WAT-225 dependency security upgrade

## Draft status and unapproved residual

**The residual below is NOT APPROVED. This branch is prepared for a draft PR,
not for merge or release.** There is one high and two moderate advisory records
in two bundled development/release-tool packages:

| Package | Selected | Advisory | Severity | Fixed |
| --- | --- | --- | --- | --- |
| undici | 6.29.0 | GHSA-xjj6-f33q-929c | High (7.5) | 6.29.1 |
| undici | 6.29.0 | GHSA-4qv8-2p9j-2685 | Moderate | 6.29.1 |
| ip-address | 10.7.2 | GHSA-rxp7-6hxx-x8q5 | Moderate | 10.7.4 |

The chain is semantic-release 25.0.3 → @semantic-release/npm 13.1.5 →
npm 11.21.1. The latter bundles node-gyp → undici and make-fetch-happen →
@npmcli/agent → socks-proxy-agent → socks → ip-address. Inspection of the
published npm 11.21.1 tarball confirms both affected versions. The inspected
latest parents, semantic-release 25.0.9 and @semantic-release/npm 13.2.0,
still require npm 11; npm 11.21.1 is the latest published compatible npm line.
There is no unused direct npm-plugin dependency to remove. Removing core
semantic-release would remove the existing release workflow's executable;
patching its bundled children or overriding its graph is outside this repair.

Although `.releaserc.json` excludes @semantic-release/npm from its plugin list,
its exec plugin uses the literal `cd packages/llmist && npm publish --access public`.
npm/npx child contexts prepend local binary directories to PATH. After the
candidate frozen installation, the benign probe below reports
`/workspace/node_modules/.bin/npm`, **11.21.1**, both before and after changing
directories. The ordinary shell resolves global npm **10.9.2**. A benign execa
probe using the exec plugin's inherited-environment options confirms the same
local resolution. Thus bundled npm is expected in the configured release path.
Advisory-specific exploitation is untested; the plugin list does not prove
unreachability. No release, dry release, publication, or provider call is run.

```sh
npm --offline --silent run env -- /bin/sh -c 'command -v npm; npm --version; cd packages/llmist; command -v npm; npm --version'
```

Here `run env` executes `env /bin/sh ...` with command arguments; it does not
print environment values. The same benign command is checked through npm exec
and npx, with offline mode and no package installation.

## Scope and before/after audits

The repair covers all four workspaces, their manifests, and the complete lockfile.
No overrides, resolutions, vendored patches, dismissed advisories, removed
packages/features, or reduced test tiers are introduced.

| Audit scope | Before: critical/high/moderate/low | After: critical/high/moderate/low |
| --- | --- | --- |
| All workspaces, including root | 6 / 19 / 15 / 1 (41 affected packages) | 0 / 1 / 1 / 0 (2 affected packages) |
| All workspaces, production only | 2 / 18 / 8 / 1 (29 affected packages) | 0 / 0 / 0 / 0 |

[Sanitized complete npm audit reports](wat-225-audits.json) retain both scopes
before and after. Raw evidence is retained in protected ignored storage.
An all-workspace audit exits 1 because of the exact three unapproved advisories;
the production audit exits 0. These counts are affected npm package entries,
including dependency propagation, not advisory-record counts. Production-only
omission excludes the bundled dev-tool nodes by construction and does not
establish release-tool safety.

[The original inventory](wat-225-original-alerts.tsv) preserves all 103 supplied
records: 29 package names, 5 critical, 37 high, 48 medium, and 13 low. These are
records, not 103 distinct dependencies or evidence of exploitation.
[The per-alert reconciliation](wat-225-candidate-reconciliation.tsv) maps every
original alert to every selected copy in the resulting lockfile. All 103 are
outside their original affected ranges. [Additional advisories](wat-225-additional-advisories.tsv)
map findings beyond that inventory to their current disposition. No GitHub
alert closure is claimed.

The evidence is bound to package-lock SHA-256
`0d479f423301bf2f0cf062bd04453666cfa6cc516d3c56d2141948e1019db322`.

## Dependency and compatibility choices

- Published runtime: MCP SDK 1.32.2, YAML 4.3.2, and Zod 4.6.7 stay on their
  existing majors with patched manifest floors. Their HTTP, URI, address, schema,
  and parsing dependency graphs receive upstream fixes.
- Private docs: Astro 7.3.8, Starlight 0.41.11, Sharp 0.35.5, and Zod 4.6.7
  clear document/image/CSS/SVG advisories. Astro and Starlight stay on these
  patch lines. No site functionality or content is removed.
- Build and tests: tsup 9.0.0 uses patched esbuild 0.28.2. Vitest and V8 coverage
  move together to 5.0.5, removing vulnerable mocker/tinypool graphs. npm 10.9.2
  cannot resolve the 4.1.12 pair's optional peer cycle, including in a fresh-lock
  reproduction; the supported 5.0.5 pair resolves. Patched Vite 7 remains explicit
  for the runner while Astro manages its own Vite dependency.
- Coverage explicitly includes the baseline extension set, retaining untested
  files after Vitest removes the old `all: true` default. Provider file-list
  comparison preserves every baseline application/source file. Vitest 5 always
  excludes its active `vitest.config.ts` itself; that is the only original
  coverage entry omitted by the provider. Generated Astro modules are additional
  entries. The new scratch-directory exclusion affects ignored research data,
  not repository source. No coverage threshold or assertion is lowered.
- Release tooling: compatible bundled npm advances to 11.21.1, fixing original
  bundled alerts while retaining only the three additional unapproved advisories.
  Neither release configuration nor the pinned authoring npm changes.

Compatible parent alternatives are checked rather than assumed unsafe from their
major versions. An isolated tsup 8.5.1 graph resolves esbuild 0.27.7 and reports
GHSA-g7r4-m6w7-qqqr; no patched 0.27 release is published. Astro 5.18.2 with
its matching Starlight 0.37.7 peer graph reports seven affected packages,
including critical GHSA-26w7-cxv4-gfx2. Latest Astro 6.4.8 also remains affected.
Astro's newer GHSA-98hj-9722-w3j8 fix requires 7.3.2; every patched 7.3 release
requires unifont ~0.7.5 → undici ^8. Every published undici 8 release requires
Node >=22.19. The compatible undici 7 line cannot satisfy that parent constraint.
No rejected alternative's findings are accepted as new residuals.

## Build prerequisites and consumer boundary

The private tooling refresh within Node 22/24 is authorized. Its mandatory engine
floor is 22.19 on Node 22 or 24.11 on Node 24; optional Linux x64 native compression
requires 22.20/24.12. The actual qualified build worker is Node **24.22.1**, not
an inferred minimum. Existing CI selects current Node 22; its exact-head result
remains required. [Contributor prerequisites](../../CONTRIBUTING.md#development-prerequisites)
state these distinctions. The root manifest contract, npm 10.9.2, `.nvmrc`, fleet
configuration, and published Node >=22.0.0 engine declarations are preserved.

Consumer verification traverses dependencies and peers for each published package,
resolving workspace links and nested copies, separately from private docs and
devDependencies. Both baseline and candidate graphs accept Node 22.0. Missing
optional peers are unchanged. Built-artifact checks additionally cover:

- Actual Node 22.0.0: library ESM/CJS imports, the testing ESM bundle's mocked
  stream returning the expected text, and the CLI's version command pass.
- Baseline Vitest 3.2.6: four cases compare baseline and candidate testing ESM/CJS
  bundles for mock streaming, approval replies, first prompt, and abort behavior.
  All four pass. This checks bundled Vitest code rather than inferring consumer
  compatibility from manifest engines alone.

The baseline comparison uses an unchanged detached origin/dev worktree in ignored
storage. Its install and the library/testing builds pass. Tests use mocks only.
A plain CJS testing import outside a Vitest context is not used as a contract
assertion: the helper relies on a running test context.

## Existing dependency PR reconciliation

The branch overlaps dependency PRs #670, #669, #668, #667, #666, #664, #663,
#662, #661, #660, #658, #657, #656, #654, #617, and #615 with fixes at least
as new as their proposals, while explicitly retaining the additional bundled
residuals above. The inventory's Turbo PR #622, ws PR #621, and documentation
PR #671 are not merged or closed; unrelated dependency updates are not added
merely because they have open PRs. No existing PR is closed or merged.

## Compatibility fixture and assertion ownership

Vitest 5 requires constructible implementations when mocks are used with `new`.
Thirty constructor fixtures in the CLI completion/TUI and provider utility tests
use named constructor functions, retaining the same returned objects and every
existing call/result assertion. Named functions preserve constructor semantics
without Biome rewriting anonymous functions into arrows. The six affected files
pass all 157 targeted cases after this migration.

Patched Zod restores runtime support for the one-argument typed record; its type
declarations still prescribe the two-argument form. Two old rejection fixtures
pinned an upstream serialization limitation. Their throw assertions now exercise
a genuinely invalid zero-argument record, with positive parse and JSON checks
covering supported records:

| Original assertion subject | Preserved rejection owner | Additional valid-record owner |
| --- | --- | --- |
| validateGadgetSchema rejects one-argument record | packages/llmist/src/gadgets/schema-validator.test.ts:89 rejects a record missing both schemas | same file:95 verifies validation and typed parse; :99 rejects nonstring values |
| Gadget instruction rejects one-argument record | packages/llmist/src/gadgets/zod-v4-compatibility.test.ts:133 rejects malformed record serialization | packages/llmist/src/gadgets/schema-to-json.test.ts:11 verifies typed additionalProperties in generated instructions |

No product code or exported API is changed to artificially reject a schema that
the patched converter now supports. No test is deleted or skipped.

## Verification progress and remaining gates

- [x] Frozen npm 10.9.2 engine-strict install with lifecycle enabled.
- [x] Unwrapped postinstall and direct Lefthook install/validation; all three hooks
  executable and wired to Lefthook.
- [x] Exact candidate local npm 11.21.1 resolution and complete consumer checks.
- [x] Original 103-record mapping and exact additional residual reconciliation.
- [x] Final staged-tree build, typecheck, lint, unit, coverage, and mocked E2E.
- [x] Independent local-review gate: no must-fix findings.

All six verification commands exit 0 on Node 24.22.1 with authoring npm 10.9.2:
`npm run build`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run test:coverage`, and `npm run test:e2e`. Unit and coverage runs each pass
7,031 tests in 248 files. Coverage reports 77.12% statements, 78.58% branches,
77.83% functions, and 77.41% lines; instrumentation changes make these unsuitable
for an improvement claim. Mocked E2E passes 99 tests in 11 files. The repository's
three live-provider files (four cases) remain gated off, unchanged from baseline.
Normal commit hooks remain enforced: the candidate is committed only if they pass.

Constructor assertions are unchanged; the two retargeted schema assertions and
their additional coverage are accounted for above. No timing/speed claim is made.
Merge requires an explicit user decision on the unapproved residual, independent
and Root review, actual successful lint-and-test/validate-commits/e2e-tests at the
exact reviewed head, the required distinct approving identity, and strict dev
up-to-date checks. Merge, release, alert closure, rollout, final fresh-checkout
canary, and completion of WAT-225/WAT-224 are not claimed.
