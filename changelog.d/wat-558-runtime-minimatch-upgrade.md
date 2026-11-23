Upgrade the direct runtime minimatch dependency to ^11 (qualified at 11.0.7), removing
GHSA-g3hv-75wg-m249 from the library and inherited CLI runtime paths while preserving
other characterized skill selection and built ESM/CommonJS and CLI workflows. Two matching
changes are accepted: `src/!(a)*.ts` now selects `src/ab.ts`, and `src/?.ts` now selects
`src/😀.ts`; minimatch 9.0.9 selected neither. Cleanup, private
documentation and bundled release-tool glob/minimatch findings remain unresolved upstream.
