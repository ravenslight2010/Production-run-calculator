---
name: release-checklist
description: Pre-publish verification for this app. Use before suggesting a deploy/publish, or when the user asks to publish. Runs the right tests, typechecks, workflow restarts, and reminds what data heals will apply live.
---

# Release Checklist

Run this checklist before recommending publish. It is deliberately more
specific than a generic "tests passed" check: the browser uses the artifact API
workflow, some browser suites mutate live-day data, and server startup can run
one-time data heals.

## Scope

Use this as the repository-specific release gate after reviewing the changed
surface. Compose with, rather than duplicate, `review-before-shipping` for
security, privacy, dependency, authorization, and deployment-fit decisions.
Use `production-go` when the user asks for a final production-readiness or
GO/NO-GO decision; this checklist supplies the evidence and does not make
that decision on its own.
Do not recommend deployment until every required and applicable gate below has
recorded evidence.

## 0. Establish scope and the release record

* Review the diff and classify it as server, client/UI, shared library,
  generated API contract, schema, sync/day-state, data-heal, PWA/mobile, or
  operational-only.
* Select the checks below from the changed surface. Do not skip a **required**
  gate because an unrelated suite is expensive.
* Record the commit/revision, date, environment, commands, exit status, and
  links or paths to useful artifacts (test output, traces, screenshots, or
  visual diffs).
* Read the specialist safety skill when its trigger applies. In particular:
  `schema-change-checklist`, `sync-invariant-check`, `state-accuracy-check`,
  `spec-import-guard`, `data-heal-playbook`, and `release-checklist` are
  complementary, not replacements for these gates.

## Required gates

These gates are required for every release unless the affected package truly
does not exist in the change. A failed command or missing evidence is a
**no-go**.

### Contract, typecheck, and generated-client freshness

Run the generated-client check first when the API contract or generated
artifacts may be involved:

```sh
pnpm run check:api-generated
```

This runs `@workspace/api-spec`'s `check-generated` and rebuilds the generated
React Query and Zod package declarations. If `lib/api-spec/openapi.yaml`
changed, run code generation and review the generated diff before rerunning the
check:

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm run check:api-generated
```

Never hand-edit generated client files. A clean generated check is the
evidence that the OpenAPI source and checked-in clients agree.

Run typechecks (not builds; builds require workflow-provided environment):

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/run-calculator run typecheck
pnpm --filter @workspace/mockup-sandbox run typecheck
pnpm --filter @workspace/scripts run typecheck
```

The leaf checks only need to run for changed artifacts. `pnpm run typecheck`
is the convenient all-repository equivalent when the full check is practical.
If a shared `lib/*` package changed, `pnpm run typecheck:libs` is required
before checking its consumers.

### Unit and integration tests

Run the configured test workflows relevant to the diff. The normal repository
workflow names and commands are:

```sh
pnpm run audit:recovery
pnpm run check:clean-start
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/run-calculator run test
pnpm --filter @workspace/production-rules run test
pnpm --filter @workspace/inventory-math run test
pnpm --filter @workspace/spec-reconcile run test
pnpm --filter @workspace/scheduled-recipe-check run test
pnpm --filter @workspace/spec-export run test
pnpm --filter @workspace/corpus-harness run test
pnpm --filter @workspace/scripts run check-model-bump
pnpm --filter @workspace/scripts run check-operational-skill-evidence
```

`check:clean-start` is an operational smoke check. It preflights ports 5000 and
5173, starts only its own API and Vite process groups, verifies
`/api/healthz` (including the database check) and the initial HTML page, then
terminates those process groups. To avoid disturbing a developer process, it
fails rather than killing an occupied port; use `CLEAN_START_API_PORT` and
`CLEAN_START_WEB_PORT` to select unused equivalent ports when needed. The
default ports are the configured workflow ports, so a passing default run is
evidence that those commands bind where the workflows expect. Startup output is
included on failure to expose build errors, port conflicts, missing
environment/database setup, and early process exits instead of leaving a
misleading green result.

The recovery evidence audit is a required, read-only gate before risky merges
and releases. It exits nonzero for `MISSING` evidence and prints the missing
file, wiring, contract, or test with an actionable reason. `DIFFERENT` entries
are intentional current-implementation differences recorded in
`scripts/recovery-manifest.json`; they remain visible in the output but do not
block validation.

Use the package workflow that owns the changed code; do not claim the entire
suite passed from a single unrelated package. The API test workflow is also the
integration gate for route/database behavior. When running a specific
`*.integration.test.ts`, use that test's isolated database setup and verify
`DATABASE_URL` is not shared or production. Capture the workflow name and
passed test count (or the failing test and its output) as evidence.

### Workflow health and real preview check

After any code, package, toolchain, or run-command change, restart the relevant
workflow. For a normal full-stack release restart both API workflows:

* `API Server` — port 5000.
* `artifacts/api-server: API Server` — port 8080; this is the API reached by
  the browser.
* `artifacts/run-calculator: web` — the client preview, when the web artifact
  is affected.

Check workflow logs for startup errors, port failures, uncaught exceptions, and
unexpected migration/heal failures. Verify the running app through the public
`$REPLIT_DEV_DOMAIN` (or the configured preview), never by treating localhost
as proof that the proxied browser path works. Exercise the changed surface in
the preview and save a screenshot or browser result. A server that starts on
5000 while the browser-facing 8080 API is stale is a **no-go**.

## Conditional gates

Run these when the corresponding surface is changed. If the condition applies,
the check is required; otherwise record `not applicable` with the reason.

### Browser smoke and accessibility

For client, API-backed flow, auth, sync, or routing changes, run the compact
cross-device release journey:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e:smoke
```

Expected evidence is one passing desktop Chromium project and one passing
390×844 phone-sized Chromium project. This suite resets only a disposable
today row and must never use production or a shared operational database.

For UI or interaction changes, run the axe-based accessibility suite:

```sh
pnpm --filter @workspace/run-calculator run test:e2e:a11y
```

Expected evidence is passing desktop and phone-sized scans with no new
critical/serious violations. Investigate any violation rather than accepting a
changed baseline silently.

### Responsive, visual, and PWA/mobile coverage

For responsive layout, touch, keyboard, or phone interaction changes:

```sh
pnpm --filter @workspace/run-calculator run test:e2e:phone
```

For reviewed visual surfaces or intentional screenshot changes:

```sh
pnpm --filter @workspace/run-calculator run test:e2e:visual
```

Visual failures require a reviewed baseline update and an explanation of every
changed region; do not overwrite snapshots just to make the command green.

For service-worker, install, update, offline, or PWA handoff changes:

```sh
pnpm --filter @workspace/run-calculator run test:pwa-handoff
```

For a release that claims physical Android coverage, additionally run:

```sh
pnpm --filter @workspace/run-calculator run test:e2e:phone:device
```

This is environment-dependent and requires
`PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT`; the emulated phone suite is not evidence
that a physical keyboard and browser handoff work.

### Full browser E2E

Run the main browser suite for changes to live runs, timers, sync recovery,
factory-wide state, or another scenario covered only there:

```sh
E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 \
  pnpm --filter @workspace/run-calculator run test:e2e
```

This configuration is **destructive**: its global setup deletes today's
`daily_sync` row, and selected tests repeat that reset. It is never allowed
against production or a shared operational database. The guard must approve a
local database, an explicitly disposable database name, or the two explicit
test-mode variables above. `REPLIT_DEV_DOMAIN` alone is not a safety signal.

The phone, accessibility, visual, and PWA configs intentionally do not inherit
this destructive setup. Run them independently and do not replace them with
the main suite.

### Frontline, Sauce, and pending-run progress

Changes to Frontline applicator auto-tracking, Sauce barrel tracking,
coordination claims, or pending-run progress require all of:

- `state-accuracy-check` evidence for cadence, fractional carry/anchors, caps,
  suppression, pause/resume, lifecycle eligibility, and pending → running rebase;
- `sync-invariant-check` evidence for run-scoped stamps/registers, canonical
  responses, retries, and delayed acknowledgement isolation;
- focused API/client regressions plus the bounded live-station switch/reload
  journey from `operational-browser-verification`;
- desktop and 390×844 responsive browser evidence for the affected live station;
- retained release evidence tied to the exact revision being assessed.

Missing, stale, differently-revisioned, or desktop-only evidence is a no-go.
Do not substitute a unit pass for the live-station browser journey, and do not
regenerate the full publication record merely to validate a task-local guardrail.

## Environment-dependent checks

These are expected when the environment supports them, but a missing service
must be reported rather than disguised as a pass:

* Physical mobile: `test:e2e:phone:device` and its endpoint.
* Production-like preview: browser smoke against the artifact-managed web/API
  workflows and a screenshot of the changed surface.
* Deployment/provider checks: use the deployment/release process for this app;
  this checklist does not add a provider integration.
* Vulnerability, dependency, authorization, secrets, production-database, and
  deployment-fit review: apply the `review-before-shipping` gates. Any failed
  security or authorization gate is a no-go.

## Operational warnings and stop conditions

Before publish, explicitly answer these questions:

1. **Data heals:** Did `artifacts/api-server/src/lib/dataHeals.ts` gain a new
   heal, or change an existing heal/marker? Identify it in plain language,
   state whether it runs at startup, and tell the operator that live stored data
   will be corrected automatically. Follow `data-heal-playbook` when existing
   data was poisoned.
2. **Schema:** Did `lib/db/src/schema/*` change? Confirm the change is additive
   for populated tables, check the migration/push path, and verify it was
   applied in development. Do not run a destructive schema operation as part of
   release validation. Use `push-force` only through the established post-merge
   setup.
3. **Sync/day state:** Did sync routes, merge logic, stamps, reset epochs,
   SSE, or day-state shape change? Run `sync-invariant-check`, include the
   relevant recovery/multi-device evidence, and do not publish with an
   unresolved stale-write or reset-boundary failure.
4. **Destructive test setup:** Does any command delete live-day rows, reset a
   database, or create broad fixtures? Stop and verify the disposable database
   guard before running it. Never use production data for E2E or integration
   setup. Record cleanup completion or remaining disposable fixtures.
5. **Rollback and post-merge:** Is the change reversible? Flag schema drops,
   irreversible data edits, breaking API changes, and one-time heals. Confirm
   the rollback/checkpoint plan and the post-merge schema/workflow verification
   owner before recommending publish.

Stop and do not recommend publish when any required gate fails, generated code
is stale, the browser-facing workflow is unhealthy, a destructive test cannot
prove database isolation, a required conditional suite is unavailable without
an accepted exception, or an operational warning has no owner/plan.

## Final report format

Return a concise go/no-go report in this form:

```text
Release: <commit/revision>
Scope: <one-line summary>
Environment: <preview/test DB; never include secrets>

Required gates
- Generated client: PASS/FAIL — <command + evidence>
- Typecheck: PASS/FAIL — <commands + evidence>
- Unit/integration: PASS/FAIL — <workflow(s), counts/output>
- Workflow/preview: PASS/FAIL — <workflows restarted + URL/screenshot/log evidence>

Conditional gates
- Browser smoke: PASS/FAIL/N/A — <desktop + phone evidence>
- Accessibility: PASS/FAIL/N/A — <axe evidence>
- Phone/mobile: PASS/FAIL/N/A — <emulated/physical evidence>
- Visual: PASS/FAIL/N/A — <baseline review or reason>
- PWA: PASS/FAIL/N/A — <handoff evidence>
- Full destructive E2E/isolation: PASS/FAIL/N/A — <disposable DB proof>

Operational review
- Data heal: none / <heal and live-data impact>
- Schema: none / additive verified / blocked
- Sync: none / specialist checks and recovery evidence
- Destructive setup: isolated and cleaned / blocked
- Rollback and post-merge plan: <summary>

Decision: GO / NO-GO
Failures or accepted exceptions: <short list with owner and next action>
```

Only after the report is **GO**, all required and applicable conditional gates
pass, and the operational warnings have explicit answers, suggest deployment.

Skip steps that don't apply (e.g. no schema change) — don't re-run unrelated suites for a tiny fix.


## Mechanical release evidence

The release runner is the source of the retained release record. A successful
standard or full run must write `release-evidence/release-check-report.md` and
the clean-start evidence files, then validate that record before returning
success. The report must be tied to the current git revision and mode, list
commands and results, and use explicit `PASS`/`FAIL` or infrastructure failure
statuses for every gate. `GO` is invalid unless every applicable gate is
`PASS`, operational warnings are answered, and accepted exceptions are either
`none` or include an owner, next action, and expiry. A timeout is never a
product pass or an accepted exception by implication.
