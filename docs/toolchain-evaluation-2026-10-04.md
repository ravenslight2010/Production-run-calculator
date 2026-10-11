# Node 24.21.0 and pnpm 12.8.1 evaluation

**Evaluation date:** 2026-10-06
**Decision:** Not qualified. Candidate pins are present in the working tree, but
both standard and full release checks remain NO-GO; do not treat them as
approved pins.

## Candidate and source identity

The candidate runtime is Node **24.21.0** with pnpm **12.8.1**. The `.nvmrc`,
root `packageManager`, CI and release workflows, Dockerfile, and generated
`pnpm-lock.yaml` are aligned to those versions. The lockfile SHA-256 is
`251d67bf080b4e0c8015913bc3f66e8229af0e8763325cfa723c93629e9e3f13`.

Earlier standard and full checks used this dirty-workspace identity rather than
a Git commit: `test-sha256:423e5522b1faab8ba00a2295f6ae8b86875f44e82ef13b9df6e4f806afb01624`,
with source version
`source-sha256:e1769f7e0a128ad715d2fdd89ede70b3bf6a083755229e7647c6ad876fdb77ab`.
Those earlier checks used disposable CI databases and skipped production
source-library reconciliation; they are not production evidence or hosted
GitHub CI.

The latest source policy is `production-source-v2`, which includes the exact
source-library report and its SHA-256 sidecar as sealed build inputs. The
initial 2026-10-06 standard and full checks used candidate source revision
`source-sha256:85451a92fc3889d77a53e8ecea718da27e1b083da63d44e1acc6f0be33a0ea20`
and pre-update lockfile SHA-256
`46e0a8324425303ce157f10f8412caf0c3e22b81c7c22ab8df5143569d7e4f88`. The
workspace has no Git binding, so this is a source fingerprint, not a commit
identity. The published revision
remains `source-sha256:799efb31ed697fedfa5cb0f2aa8ca51038663c85bce6129122815b9d2f3be54a`.

Before the mainline rebase, after the focused `proxy-addr` lockfile update,
standard and full checks used source revision
`source-sha256:8490541a48265babfb8b1d33412f8e6bbc2d279ca61c27a69d04768ade8b8173`
and lockfile SHA-256
`f0de32515ea5526d874c8490c91669890ac77f8d6e1eea26157b8dd590f47d45`. These
remain historical source fingerprints, not Git commit identities, and do not
attest the post-rebase lockfile.

The latest pre-rebase prepared app-build record retained that source fingerprint
and was Git-bound to `c0ac012b76fa2a4de3720a068f586267d06f73bb`; its app build
ID was `app-build:6b889017-3df6-402d-a734-9a5a62b8a09d`. The reviewer benchmark
was captured while that app source fingerprint was prepared, although its own
observation says the source revision is unknown.

`minimumReleaseAge: 1440` and the existing security override policy were
preserved. Node 26 and TypeScript 7 were not promoted.

## Candidate measurements

- Before the focused security update, `pnpm install --frozen-lockfile
  --ignore-scripts --offline` passed with the earlier lockfile. The focused
  update's install was also successful. After the mainline rebase,
  `pnpm install --frozen-lockfile --ignore-scripts` passed for all 51 workspace
  projects with Node 24.21.0 and pnpm 12.8.1; its lockfile hash is recorded
  above.
- After the update, `pnpm audit --prod --audit-level high` found no known
  vulnerabilities. Express resolves `proxy-addr@2.0.8` within its declared
  `^2.0.7` range. Only the transitive lockfile resolution changed; package
  manifests, the existing security overrides, and `minimumReleaseAge: 1440`
  were preserved.
- The deterministic corpus snapshots were regenerated after the rebase under
  the candidate runtime and the corpus test passed (12/12). Both the canonical manifest at
  `lib/corpus-harness/snapshots/evaluation-manifest.json` and retained evidence
  at `release-evidence/ai-evaluations/deterministic-import-corpus.json` now
  record Node 24.21.0, lockfile SHA-256
  `251d67bf080b4e0c8015913bc3f66e8229af0e8763325cfa723c93629e9e3f13`, corpus
  source hash `5a57be7a35fd75b1bcfd42cf59fab51dd6749f4e5cc942e483ebe3ba8f8c8b49`,
  and a passed outcome. The evidence was regenerated from the run, not edited
  field by field.
- After regenerating the API clients from the current OpenAPI contract, the
  root `pnpm run typecheck` passed. The source-library capture service tests
  passed (8/8), source verifier and reconciliation tests passed, and the
  evaluation-report retention checks passed. The run-calculator budget suite
  passed (2,996/2,996 tests), and `pnpm audit --prod --audit-level high` found
  no known vulnerabilities.
- Earlier standard and full checks passed 39/40 and 41/42 gates respectively,
  but they used the older source identity above and did not verify the current
  production reconciliation. Those pass counts do not qualify the current
  candidate.
- The earlier TypeScript 7 advisory comparison passed with advisory drift recorded and
  no compatible prior trend samples available. Its configured runner label
  describes this local measurement, not a hosted GitHub runner. TypeScript 7
  remains unpromoted.
- The earlier standard and full checkpoints each failed one of 36 accessibility
  cases. They reported 4.24:1 contrast on tablet landscape and 2.39:1 on phone
  for the rendered stoppage-log control (`#a76c23` or `#dd9733`) against
  `#fbfcfd`, below the 4.5:1 WCAG AA threshold.
- On 2026-10-05, the full accessibility suite was rerun under the candidate
  toolchain and passed 36/36 cases. The prior contrast failures did not
  reproduce, so no UI contrast change was made. The standard and full release
  checks were rerun on 2026-10-06 before the mainline rebase; their results are
  historical and are described below.

## Initial 2026-10-06 release checks (before the focused security update)

The initial standard and full checks ran with Node 24.21.0, pnpm 12.8.1, source
fingerprint `source-sha256:85451a92fc3889d77a53e8ecea718da27e1b083da63d44e1acc6f0be33a0ea20`,
and lockfile SHA-256
`46e0a8324425303ce157f10f8412caf0c3e22b81c7c22ab8df5143569d7e4f88`. Both
produced incomplete NO-GO checkpoints and are not retained passing evidence.
The isolated real API/web build-source integration passed, including the
finalized PWA and bundled public getter. The source-library report packaged
into the API build matches its reviewed SHA-256:
`1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294`.

The release preflight ran against a **development partial fixture**, not the
production database. It observed 0 of 68 expected pool rows and 25 missing
aliases (0 exact), so source-library verification failed and dependent typecheck,
test, container, and browser gates were blocked. The preflight marker and report
hash were valid; the fixture database did not contain the expected data. Do not
represent these development counts as production findings.

Both initial runs also failed the production dependency audit because the
lockfile resolved `proxy-addr@2.0.7` through Express, with critical advisory
`GHSA-jqcg-44mw-7w3h`. The later focused lockfile update resolved the patched
2.0.8 release and the fresh production audit passed; no existing override was
changed.

The manager-only source-library capture endpoint is implemented and its
authorization, no-store, size-limit, and service tests pass. It is not present
on the published revision yet, and no production capture JSON has been
returned or imported. The development partial fixture is not a substitute.
The five-request live reviewer benchmark was rerun after the focused lockfile
update but before the mainline rebase. Its report remains `retain: false` for
that earlier lockfile; it is not a benchmark of the current lockfile.

## Retained evaluation evidence

The latest standard result state is recorded at
`release-evidence/release-check-state.json`; the latest full run wrote
`release-evidence-full/release-check-checkpoint.md`. Both are incomplete, and
neither replaced the retained release reports. The older standard and full
reports are not evidence for this candidate. The disposable runs do not supply
the production source-library reconciliation evidence needed for retained
release evidence.

The pre-rebase isolated reviewer benchmark ran five authorized Gemini requests on
2026-10-06 at 11:17:00Z under Node 24.21.0 and pnpm 12.8.1, using the
then-current lockfile SHA-256
`f0de32515ea5526d874c8490c91669890ac77f8d6e1eea26157b8dd590f47d45`. Its
evaluation-only copy of the retired reviewer logic does not restore an app
dependency or runtime path. The retained observations record evaluator
SHA-256 `53c77a1ff4944bf77f773c18cde93d7cc0342ac17400ca15b0e6d1220dba08da`;
the report hashes the observations file. Raw prompts and provider payloads
were not retained, and the five requests recorded zero retries.

Four operations failed while parsing provider output as JSON, covering 301
cases; the remaining operation parsed successfully for three cases and produced
two duplicate warnings and one no-op. There were zero unique material catches,
302 no-op verdicts including failed-batch fallbacks, and a 99.0% reviewer
failure rate. The measured p95 latency was 17,001 ms. Only one operation had
token counts (726 input and 252 output); total usage and cost are unavailable.
All six acceptance thresholds fail, so the reviewer remains `retain: false`.
The observations mark the full source revision as unknown because the
worktree was dirty. At capture time the prepared candidate record was
`source-sha256:8490541a48265babfb8b1d33412f8e6bbc2d279ca61c27a69d04768ade8b8173`,
but that identity is not embedded in the benchmark manifest; this benchmark is
bound to its evaluator, pre-rebase lockfile, and source-data hashes, not a
standalone full-source attestation. The reviewer test now rejects these
observations because their lockfile hash does not match the post-rebase lock.

On 2026-10-05, a bounded read-only source check matched the current published
build to its independently prepared source record. A fresh normal-mode
readiness capture passed all three HTTP 200 samples and replaced the expired
readiness record at `release-evidence/readiness-recovery/readiness-recovery.json`.
This evidence identifies the current published build, not the candidate source;
no publish was performed.

The active deployment reports a successful public autoscale build. The current
published-source handoff identifies deployed revision
`source-sha256:799efb31ed697fedfa5cb0f2aa8ca51038663c85bce6129122815b9d2f3be54a`,
but it does not include the approved database-owner identity required by the
production source verifier. An authorized read-only production SQL query
returned database metadata only; it did not run the verifier or establish that
the SQL connection was the database used by the deployed app. The workspace can
use that SQL-only callback but does not have the deployment's `DATABASE_URL`
connection for the official verifier. The documented capture must run in the
deployment environment that owns that connection. A manager-only capture
endpoint is implemented in the candidate but is not deployed; use it only after
Replit publishes it, or supply a report captured from the exact deployed
database. The existing reconciliation evidence is bound to an older revision
and cannot be reused for the current published build. A prior plain
`pnpm run release:check` invocation stopped at evidence preflight because it
lacked the required readiness deployment ID and deployed revision; it ran no
release gates and produced no new release report.

## Pre-rebase post-update candidate checks (2026-10-06)

The standard and full release checks were refreshed again on 2026-10-06 after
the reviewer measurement and its retention tests, but before the mainline
rebase. Both were bound to the
current readiness record for published build
`app-build:0b3efdef-fd53-46a0-a469-274acdb3243d`, deployed source revision
`source-sha256:799efb31ed697fedfa5cb0f2aa8ca51038663c85bce6129122815b9d2f3be54a`,
and current candidate lockfile. The standard result state was generated at
11:26:38Z and ended with 9 PASS, 1 FAIL, and 31 BLOCKED gates. The full check
ended with 9 PASS, 1 FAIL, and 33 BLOCKED gates; its 11:27:10Z checkpoint is
INCOMPLETE / NO-GO and did not update retained release evidence. The full
checkpoint is bound to source version
`source-sha256:e507209aff4a9cfb7bb5b1b084eea522503d220f97fb85929fc33f2f081d592c`
and verification-input fingerprint
`d390dc041bebc9a3ad272a6d40fb4319c66d068da2d722999fea44999030dffb`.

Both source-library preflights used the development partial fixture and
observed 0 of 68 expected pool rows, 0 exact aliases, and 25 missing aliases.
Dependent typecheck, test, container, and browser gates were blocked. The
security audit, API generation, source-identity/build integration, shared
library typechecks, and recovery checks passed. The separate reviewer
benchmark and evaluation-retention/privacy tests also passed their focused
checks; the full browser suite did not run.

These results confirm that the focused dependency update is clean in the
candidate workspace, but do not qualify the release. The production capture
endpoint is still absent from the published build, and the available production
SQL-only callback does not provide the database connection or approved owner
handoff required by the repository's full verifier. No production report was
created from those partial inputs. The reviewer benchmark is now refreshed for
the current lockfile; its source-data, evaluator, and lockfile hashes are
recorded, and the prepared app-build fingerprint at capture matches the current
candidate fingerprint. Its own `sourceRevision` field remains `unknown`, so it
is not a standalone full-source attestation.

## Pre-rebase release result (2026-10-06)

The 2026-10-06 standard and full checks have **INCOMPLETE / NO-GO** checkpoints.
Both runs had 0/7 API shards; their downstream release and browser gates were
blocked by the source-library preflight, so the full browser suite did not run.
The candidate's `proxy-addr` audit blocker is resolved, but the deployed build
was not republished and is unchanged. Do not adopt the candidate pins until a
current production source-library report is captured and imported and fresh
standard/full checks pass with evidence bound to the assessed source revision
and lockfile. The reviewer benchmark is freshly measured for this lockfile and
calculates its own `retain: false` outcome; its separate source-revision field
remains unknown as documented above.

## Post-rebase qualification attempt (2026-10-06)

The post-rebase lockfile SHA-256 is
`251d67bf080b4e0c8015913bc3f66e8229af0e8763325cfa723c93629e9e3f13`. The
prepared candidate record identifies app build
`app-build:22f15f80-66ac-4535-b13f-ec80e6bc42f2` and source fingerprint
`source-sha256:8f56ec9a88baf4b51c621d0050c170c0e7c36c8d411845d3606bf443d0fba58f`.
Its Git revision is unavailable, so the fingerprint identifies the measured
source but is not a Git-commit attestation.

Under Node 24.21.0 and pnpm 12.8.1, the frozen install passed for all 51
workspace projects, the regenerated API clients passed the freshness check,
and root `pnpm run typecheck` passed. The source-library capture service tests
passed 8/8; source verifier, source reconciliation, and evaluation-retention
tests passed. The run-calculator budget suite passed 2,996/2,996 tests, the
deterministic corpus passed 12/12, and the production dependency audit found no
known vulnerabilities. The canonical and retained deterministic-corpus
manifests were copied from the same generated run and have matching SHA-256
`cdf7f066b1b87e3fe86c0729af717728cc2b44d6af60f153d0e883914a3894df`.

The retained Gemini reviewer observations still use the pre-rebase lockfile
SHA-256 `f0de32515ea5526d874c8490c91669890ac77f8d6e1eea26157b8dd590f47d45`.
The current reviewer-retention test rejects them as measured with a different
lockfile. No new provider requests were made, so there is no live reviewer
benchmark for the final lockfile.

The required readiness deployment ID and deployed revision were supplied from
the existing readiness record. The fresh standard check recorded 9 PASS, 1
FAIL, and 32 BLOCKED gates; the full check recorded 9 PASS, 1 FAIL, and 34
BLOCKED gates. Both checkpoints are **INCOMPLETE / NO-GO** and did not update
retained release evidence. Their source-library preflight used a development
partial fixture: 0 of 68 expected
pool rows and 0 of 25 exact aliases were found, with all 25 aliases missing.
These are development-fixture results, not production findings; dependent
typechecks, tests, container checks, and browser gates were blocked.
The explicit release-evidence verification also rejected the incomplete
checkpoint and left the retained release report unchanged.

The manager-only production capture endpoint remains unpublished, and no
production reconciliation JSON is available. The final lockfile therefore
does not qualify for adoption: the reviewer benchmark is stale for this lock,
production reconciliation is unverified, and the candidate lacks a Git-bound
source record. After the endpoint is published and a bounded production report
is captured from the deployed database, obtain fresh authorization for a
reviewer benchmark on the final lockfile, then rerun standard and full checks
against a Git-bound source revision.

The registry dates and eligibility observations remain documented in
[`dependency-update-inventory-2026-10-02.md`](dependency-update-inventory-2026-10-02.md).