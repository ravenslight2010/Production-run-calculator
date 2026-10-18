# Historical TypeScript comparison count discrepancy

- **Correction status recorded:** 2026-10-15
- **Historical artifact:** [`typescript-7-comparison-2026-09-15.json`](typescript-7-comparison-2026-09-15.json)
- **Artifact source revision:** `72383c601448d234b7813451618c293ebdca7ac8`
- **Artifact-reported capture date:** 2026-09-21
- Preserved historical JSON SHA-256: `9b26918612dff8f0f8d8d0b7629ac0524a3f195a9b45258a17be10894d275739`
- Reviewed declaration-approvals file SHA-256: `8d043fd34bc52104a73ab2964ef1bedbcd5dc0fe9b18a38d37b1bfb39d35e02c`

The filename says 2026-09-15, while the JSON reports a 2026-09-21 capture. The migration
research describes the background comparison as dated 2026-09-16 and reports Node 24.13.0;
the JSON reports Node 24.20.0. No retained run identifier or source bundle binds those
method details to this JSON, so their relationship is also unresolved.

## Finding

The retained JSON reports 795 baseline declaration files, 795 candidate files, and 217
textually changed files. Its package counts (2 `api-client-react`, 150 `api-zod`, 65 `db`,
and 0 other) sum to 217.

The historical results prose in
[`typescript-7-migration-research.md`](../typescript-7-migration-research.md) reports 196
formatting-only files and 9 approved semantic files, totaling 205. That leaves 12 of the
reported 217 changed files without a reconciled contract classification. The prose itself
states that the raw declaration-contract report was not retained. The approvals file contains
nine hash-pinned entries, but neither it nor the compact comparison JSON identifies the
per-file classification report or binds those approvals to the JSON's source revision.

The retained-summary command
`bash docs/evidence/reproduce-typescript-7-comparison.sh --check-retained-summary` passes.
That check verifies internal agreement between the JSON's count fields and selected prose
lines; it does not compare declaration trees, reproduce the historical diff, or verify
contract classifications.

## Source and evidence availability

- The source commit named by the JSON is absent from the local Git object database and all
  locally available refs.
- Read-only fetch requests for that exact commit from the configured `origin` and
  `gitsafe-backup` remotes were both rejected because neither remote has the requested object.
- The closest retained comparison is
  [`release-evidence-archive/stale-full-2026-09-14/evidence/typescript-7-comparison.json`](../../release-evidence-archive/stale-full-2026-09-14/evidence/typescript-7-comparison.json).
  It records a different source revision (`63cfd77eef883cba583636e6fc4c72fa37cc24a6`),
  795 files on each side, and 217 changed paths, with an unknown runner image. It retains
  path/hash manifests but not the raw declaration diff or contract-classification report.
  Only 6 of the 9 hash-pinned approval entries match both sides of that artifact; the other
  3 have at least one hash mismatch. Its matching totals therefore do not establish the
  historical classifications.
- A separate retained comparison at
  `release-evidence/typescript-7-comparison.json` is also a different run: its source identity
  is `test-sha256:6c3f05086161635b2e9c417090a3c06291abb692760dd6c251c905b3d068ee43` and it
  records 983 files per side and 282 changed paths. It is not historical evidence for the
  JSON's source revision.
- No disposable declaration trees, full diff, or raw declaration-contract report for the
  JSON's exact source revision are present in the workspace's `/tmp` area or retained
  repository evidence.
- The reproduction script can compare its checkout's current source identity; running it now
  would not reproduce the JSON's historical source revision and was not treated as historical
  evidence.

Accordingly, the historical 217 textual-difference count and the 196/9 contract
classification remain **unreconciled**. No corrected count or zero-unexplained-drift result
is asserted. The existing nine approvals are preserved as recorded but are not evidence that
all 217 changed files were classified.

## Preservation and approval boundary

The historical JSON was not edited. Its SHA-256 above was recorded before and rechecked after
this note was added. This note records an evidence limitation; it does not change or replace
the prior contract-owner conclusions. Any future change to those conclusions requires the
exact historical source inputs, a retained per-file comparison report, and relevant
contract-owner approval. Do not use a current-revision comparison as a substitute.
