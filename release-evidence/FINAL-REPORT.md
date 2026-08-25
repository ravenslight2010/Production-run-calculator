# Final Production Safety and Rollback Review

**Decision: NO-GO**

**Revision reviewed:** `fd6b6f1be1b0a6691c275aadb14ed917abbeee2c`
**Review date:** 2026-08-25
**Environment:** development database and artifact-managed local preview. No
production writes or destructive production tests were performed.

## Deployment fit and live metadata

- **Configured target:** Autoscale (`.replit`).
- **Live deployment metadata:** public deployment exists at
  `https://Lucias-Production-Assistant.replit.app`; deployment type is
  Autoscale and the current build is successful.
- **Fit:** PASS. Autoscale is appropriate for this web/API application, including
  the always-on API, browser preview, SSE streams, and operational workflows.
  The API listens on its configured `PORT`, exposes `/api/healthz`, and the
  web artifact proxies API requests through the same deployment surface.
- **Production database separation:** **FAIL / UNVERIFIED.** The deployment
  metadata and repository do not expose the production database binding. The
  managed environment inventory exposes no inspectable `DATABASE_URL` value or
  production binding identity. Before publishing or republishing, an operator
  must verify that the deployment environment resolves its managed production
  database and does not inherit the development database, disposable E2E
  database, or CI database.

## Required release evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Deployment type and build | PASS | `.replit` selects `autoscale`; `getDeploymentInfo` reports deployed, public, successful build |
| Generated API contract | PASS | `pnpm run check:api-generated` |
| API type safety | **FAIL** | `pnpm --filter @workspace/api-server run typecheck` fails in `src/routes/countObservation.ts:70` because the returned object is not assignable to `SanitizedCountDraft \| null` |
| Recovery audit | PASS | `pnpm run audit:recovery` — 4 pass, 0 intentional differences, 0 missing |
| Clean startup and health | PASS | `CLEAN_START_API_PORT=18081 CLEAN_START_WEB_PORT=18082 CLEAN_START_MOCKUP_PORT=18180 pnpm run check:clean-start`; API health, web proxy health, initial HTML, mockup HTML, and retained screenshot passed |
| Secret storage | PASS for inspected surface | Managed secret names are present for Gemini integration, session signing, and staff signup; no secret values were displayed |
| Secret separation | PASS for inspected source | Repository scan found no bundled application credential; CI fixtures contain intentionally local test-only values and GitHub Actions secret references |
| Sensitive-data logging | PASS | Startup/health logging uses status, outcome, bounded counts, and error codes; no request/profile payload logging was found in the reviewed paths |
| Production monitoring | **FAIL / UNVERIFIED** | `/api/healthz` and structured startup/error events exist, but no configured production uptime alert, deployment monitoring, or alert destination is represented in repository evidence |
| Authorization and test isolation | PASS by retained evidence | Existing release report and recovery evidence document auth boundaries and disposable destructive-test setup; no production destructive test was run |

## Schema and startup data review

### Schema

Recent work added three fields to the populated `inventory_items` table:
`production_ingredient_id` (nullable text), `conversion_factor` (nullable
double precision), and `consumption_priority` (integer default `0`). The
change is additive and uses an existing scoped unique index; no column is
`.unique()` and no composite primary key was changed. The OpenAPI request and
response schemas and generated clients are present and the generated check
passes.

No production schema diff was inspected in this review. The publish operator
must review the development-to-production schema diff and apply the repository’s
non-interactive `push-force` process only after confirming it is additive and
backward compatible. Do not treat the local disposable database as production
evidence.

### Startup data heals

The API calls `runDataHeals()` before accepting requests. It claims each heal
with a stable marker inside a transaction, so each database runs pending heals
once. The current registry includes repairs for profile/recipe links, CRB
ingredient and dough-family corrections, cheese and mix poison/duplicate
cleanup, alias/name cleanup and reversals, purchased-crust die cleanup,
dough-variant and merge-vanish recovery, saved-parse/import corrections,
brand/name drift, sync-row restoration, fresh-device contamination cleanup,
incident workflow reconciliation, and cheese-component-ounce cleanup.

These heals can update, repoint, or delete live rows on first production boot.
They are not universally reversible. Before publishing:

1. Take a production database backup/snapshot and preserve the candidate
   revision under a named checkpoint or tag.
2. Review existing `data_heals` marker/result rows and identify which pending
   heals will run.
3. Capture the documented minimal counts and preservation checks for each
   pending repair; do not run ad-hoc production mutations.
4. Monitor the first boot for `data_heals`, health, startup, and master-data
   health events.

No live marker/result verification was performed because production database
access was not available through this review.

## Rollback and post-publish procedure

### Before publish

1. Resolve the API typecheck failure.
2. Verify the production deployment binding uses the production database and
   that development/E2E/CI database settings cannot be inherited.
3. Review the production schema diff; apply only approved additive changes.
4. Take and name a production backup/checkpoint, and record the exact candidate
   revision.
5. Enable deployment monitoring and an uptime alert against
   `/api/healthz`, with an owner and notification destination.

### After publish

1. Confirm the deployment build is successful and the published URL loads.
2. Check `/api/healthz` and verify the database health result is healthy.
3. Exercise authenticated browser smoke for desktop and phone-sized views,
   including an operational workflow and SSE/live update path.
4. Review startup logs for failed heals, schema errors, auth failures, and
   master-data health findings; verify heal marker/result rows using the
   approved read-only production procedure.
5. Confirm monitoring receives healthy telemetry before declaring the release
   complete.

### Rollback

If startup, schema, health, sync, or operational checks regress, stop further
publishes, open the named checkpoint, and restore the last approved application
revision using Replit’s checkpoint/rollback flow. Restore the database from the
pre-publish backup when data was changed or a heal/schema operation is
implicated; do not attempt broad manual reverse edits. After rollback, rerun
clean-start, health, generated-contract/type checks, and focused authenticated
browser/API checks, then re-review the deployment database binding.

Irreversible-risk items are the startup heals that delete or repoint rows and
any schema operation that a publish-time diff identifies as destructive. The
inventory change currently visible in source is additive, but its production
application still requires operator diff review.

## Release decision

**NO-GO — do not publish.** Autoscale fit, successful deployment metadata,
managed secret presence, generated contracts, recovery audit, clean startup,
and inspected logging are satisfactory. Publishing is blocked by the current
API typecheck failure, unverified production database separation, and
unverified production monitoring/alerting. The unresolved database and
monitoring checks are hard blockers even if the typecheck is fixed.
