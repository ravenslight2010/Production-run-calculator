# Repository Quality Systems Audit

Date: 2026-09-06

## Scope and baseline

This audit reviewed the completed repository architecture after the recovery
work merged at baseline `0b68131f`. It covered:

- 28 editable skills: 18 under `.agents/skills/` and 10 under
  `.local/custom_skills/`;
- 5 focused skill eval sets after this audit;
- 48 package manifests under `artifacts/`, `lib/`, and `scripts/` (including
  two generated Vite dependency manifests excluded from package ownership);
- 461 unit, integration, contract, script, and focused test files;
- 41 files in the run-calculator browser evidence tree;
- 7 GitHub Actions workflow files;
- 7 benchmark-related source files under `artifacts/` and `scripts/`;
- root typecheck, generated-client, recovery, clean-start, workflow, security,
  release, and evidence-verification entry points.

The API Server remains the owner of route, database, auth, sync, import
persistence, and operational API integration coverage. The Production Run
Calculator owns client unit tests and separate Playwright configurations for
smoke, accessibility, phone, visual, PWA, sync convergence, multi-device,
department navigation, AI outage, and management performance. Shared packages
own deterministic domain tests. `@workspace/scripts` owns repository structure,
workflow, recovery, release-evidence, model-version, and benchmark checks.

## Changes made

### Editable skill catalog

- Corrected all 10 custom-skill frontmatter names to match their lowercase
  hyphenated directory identifiers. The existing catalog gate previously
  reported exactly 10 failures and now reports none.
- Narrowed the `.local` ignore rule so project-owned custom skills are
  versioned while platform-managed and secondary local skill roots remain
  ignored. Without this ownership fix, custom-skill maintenance could not
  survive a commit or task merge.
- Converted `review-before-shipping` from a duplicate release checklist into a
  bounded shipping-risk review and router:
  - `verify-before-commit` owns commit, push, pull-request, and green-build
    verification;
  - `release-checklist` owns repository-specific release evidence;
  - `production-go` owns the final production GO/NO-GO decision.
- Added a three-scenario eval set for that routing boundary.
- Added objective assertions to the existing `production-go` evals, which
  previously had expected outputs but no machine-gradeable assertions.
- Corrected the prior skill-audit snapshot so it no longer presents historical
  counts or selected eval coverage as current repository-wide facts.

### Consolidation decisions

The following overlaps are intentional and were retained:

- `release-checklist` gathers evidence; `production-go` decides; the custom
  shipping review supplies security/privacy/dependency risk input.
- `testing` covers ordinary browser behavior; `operational-browser-verification`
  adds manager, scope, reload, sync, import-history, and startup evidence.
- `state-accuracy-check` owns live calculations; `sync-invariant-check` owns
  persistence and convergence.
- `import-bug-investigation` locates the import failure;
  `spec-import-guard` protects pipeline invariants; `data-heal-playbook` applies
  only after stored data is confirmed wrong.
- `schema-change-checklist` remains the detailed existing-table field procedure;
  `db-schema-change` remains its compatibility router.
- The project-owned `skill-creator` remains authoritative for repository
  maintenance while the managed secondary copy remains read-only.

No platform-managed or secondary skill was modified.

## Test and gate assessment

Existing coverage is broad and layered. The separate browser configurations are
not duplicates: they use different fixture, safety, viewport, and evidence
contracts. Likewise, API integration suites and shared pure-logic tests protect
different source-of-truth boundaries.

The audit found these bounded remaining gaps:

1. The ordinary `test:e2e` entry point is desktop Chromium only; release-critical
   accessibility, phone, visual, PWA, convergence, and operational suites remain
   separate opt-in commands. Keep the focused suites, but give CI/release one
   explicit aggregate browser owner.
2. The accessibility smoke globally disables `landmark-one-main`, `region`,
   `meta-viewport`, and `page-has-heading-one`. Re-enable `meta-viewport` and
   replace broad shell exceptions with narrow, owned baselines.
3. Add a small WebKit smoke lane rather than multiplying every expensive
   browser suite. Keep physical Android evidence conditional on an available
   device endpoint.
4. Several high-risk API route modules rely on indirect coverage. Add direct
   authenticated and authorization/isolation cases first for runs, run
   templates, action items, profile data health, and master-data health, or
   explicitly classify their owning integration suite.
5. Client and browser performance checks exist, but no deterministic package
   command enforces the documented budgets together. Keep provider-backed AI
   latency benchmarks scheduled/evidence-only.
6. Release source-reconciliation verification has both a workflow step and a
   release-runner owner. Consolidate invocation ownership and assert it runs
   once.
7. CI security audit is informational while release audit is blocking. Preserve
   the distinction if intended, but name both policies and their severity and
   registry-failure behavior explicitly.
8. Quality documentation should use exact package-qualified commands and remove
   stale shorthand or template text.

These recommendations do not duplicate the cancelled recipe-pool or
saved-import rollback tasks.

## Verification evidence

Executed during this audit:

- `pnpm --filter @workspace/scripts run check:skill-catalog`
  - before: FAIL, 10 editable custom-skill name failures;
  - after: PASS, 128 skills inventoried, 0 failures, 33 documented managed
    warnings, 0 managed-baseline drift.
- `pnpm --filter @workspace/scripts run test:skill-catalog`
  - PASS, 12 tests.
- `python3 -S .agents/skills/skill-creator/scripts/test_quick_validate.py`
  - PASS, 4 tests.
- JSON/eval structural validation
  - exposed missing assertions in `production-go`; repaired in this audit.
- Bounded three-prompt with-skill versus captured pre-edit baseline comparison
  - revised skill routed commit verification to `verify-before-commit`, release
    evidence to `release-checklist`, and final status to `production-go`;
  - baseline collapsed all three prompts into a generic shipping NO-GO.
- `pnpm --filter @workspace/scripts run test`
  - PASS, including shell inventory, workflow contracts, source-audit tooling,
    release evidence, benchmark regressions, schema rollback, catalog, and
    quick-validator checks.
- `CI=true pnpm run typecheck`
  - PASS, including recovery audit, generated API freshness, shared libraries,
    API Server, Production Run Calculator, Canvas, and scripts.
- `pnpm run check:workflows`
  - PASS, 7 workflow files validated with the pinned actionlint wrapper.
- `git diff --check`
  - PASS.
- completion validation
  - PASS: API, client, production-rules, inventory-math,
    scheduled-recipe-check, spec-export, Gemini benchmark regression,
    model-bump, operational-skill-evidence, typecheck, production dependency
    audit, and managed code review;
  - BLOCKED: the retained standard/full reports are stale, and retained-evidence
    verification rejects them. Fresh standard and full runs at the current
    revision correctly stop at the development source-library gate and write
    incomplete NO-GO checkpoints rather than replacing retained evidence. The
    development database is a mixed test fixture, not the audited production
    snapshot: its marker records only 1 replacement and 1 alias, and the
    verifier finds 65 missing pool targets, 22 missing aliases, 10 stale
    profile links, and 3 missing canonical stubs.
  - PRODUCTION RECONCILIATION: a read-only production check on 2026-09-07
    confirmed the owner-approved marker applied on 2026-09-05 with 46
    replacements and 3 deleted zero stubs; all 68 audited pool targets and
    all 25 expected aliases match, and no audited stubs remain. This confirms
    the production repair is complete without using production writes, but it
    does not make the development fixture valid release evidence.

Full application/browser/release runs were not used to validate metadata-only
skill changes because they cannot provide additional evidence for this changed
surface. No workflow restart was required because no application code, package,
toolchain, or run command changed.

## Environmental blockers

- Physical Android browser coverage requires
  `PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT`.
- Provider-backed live AI benchmarks require their configured provider and are
  evidence/benchmark lanes, not deterministic pull-request gates.
- Destructive browser and integration setups must remain bound to disposable
  databases; production was queried only through the approved read-only
  verification path and was never mutated by this audit.
- Release verification remains NO-GO until a release-scoped evidence run can
  verify the approved reconciliation against its matching database. The
  development fixture cannot be made equivalent by rerunning the
  marker-guarded heal: it already claimed the approved repair and safely
  applied only the rows present there. This audit did not copy production data,
  reset the marker, or mutate master data merely to make a release gate green.

## Bounded recommendations

Prioritize three follow-up units rather than a broad test rewrite:

1. make release browser ownership explicit and retire broad accessibility
   suppressions;
2. add/classify direct authorization coverage for the five highest-risk
   indirectly covered API routes;
3. align release verifier ownership and document CI-versus-release security
   policy.

Do not merge distinct suites merely because they share terminology. Consolidate
only command ownership and genuinely equivalent assertions.