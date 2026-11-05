# Glob and minimatch security remediation

## Scope and dependency inventory

The first operation was a filesystem walk from the project root, not a Git
file listing. It pruned dependency, VCS, environment, cache and build directories
before descending into them (`node_modules`, `.git`, `vendor`, `.venv`, `venv`,
`target`, `dist`, `build`, `.next`, `.cache`, `generated-artifacts`).
The walk included untracked files.

It found 52 application/workspace `package.json` files, one shared
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, and a root `pyproject.toml`.
The Python project declares no dependencies and has no dependency lockfile;
there are no Python packages to remediate. `python3 -m pip_audit --help`
confirmed that pip-audit is not installed; it was not installed for an empty
dependency set.

The initial walk also found 589 empty `{}` package manifests in the generated
`.local/share/pnpm/.tools` provisioning cache. These are not application
projects, have no dependencies or lockfiles, and were excluded as a dependency
cache from subsequent walks.

### JavaScript manifests

Every entry below is a directory containing `package.json`, managed by the
root's pinned pnpm 12.8.1 and the shared workspace lockfile:

```text
.
artifacts/api-server
artifacts/mockup-sandbox
artifacts/run-calculator
lib/ai-evaluation
lib/ai-memory
lib/allergen
lib/anomaly
lib/api-client-react
lib/api-spec
lib/api-zod
lib/cheese-import
lib/cheese-recipes
lib/cheese-reconcile
lib/corpus-harness
lib/cycle-count
lib/day-summary
lib/db
lib/distill-dataset
lib/downtime-trends
lib/factory-constants
lib/field-check-contract
lib/fill-missing
lib/formula-guard
lib/freezer-pull
lib/incident-cluster
lib/ingredient-catalog
lib/integrations-openai-ai-server
lib/inventory-math
lib/live-calc
lib/merge-suggest
lib/mixes
lib/mix-reconcile
lib/named-recipes
lib/name-match
lib/onboarding
lib/premix-import
lib/production-rules
lib/profile-cleanup
lib/recipe-apply
lib/recipe-guide-import
lib/scheduled-recipe-check
lib/schedule-move
lib/schedule-optimize
lib/setup-math-check
lib/shipping-import
lib/spec-export
lib/spec-import
lib/spec-reconcile
lib/sync-contract
lib/typescript-api-v6
scripts
```

## Remediation

`pnpm audit --fix` ran separately from each of the 52 directories above;
all 52 commands exited zero. The workspace-wide overrides belong in
`pnpm-workspace.yaml`, not individual manifests. No independent nested
lockfiles were found.

GitHub's advisory API reports:

| Advisory | Affected range | First patch | Selected patch |
| --- | --- | --- | --- |
| GHSA-g3hv-75wg-m249 | minimatch >=7.0.0 <11.0.1 | 11.0.1 | 11.0.4 |
| GHSA-3g3m-2fjr-6pw4 | glob >=9.0.0 <=14.0.1 | 14.0.2 | 14.0.3 |

Registry checks found that the latest TypeDoc (0.28.20) still depends on
minimatch ^10.2.5 and the latest Workbox Build (7.4.1, via vite-plugin-pwa
2.0.0) still depends on glob ^11.0.1. Accordingly, overrides select patched
versions only for the advisories' affected ranges. The selected releases
support the repository's Node 24 runtime.

Auto-fix also proposed unrelated fast-uri, serialize-javascript and undici
overrides. Those proposals were not retained: broader build/test dependency
hardening already has a separate owner, and this change is limited to the
two assigned advisories. This is not a claim that the entire dependency audit
is clean.

## Verification

These checks ran in the isolated development workspace on 2026-11-05,
using the repository's pinned release runner (Node 24.21.0, pnpm 12.8.1).
The resulting versions are recorded in the accompanying lockfile.
No publishing or production dependency changes were performed.

| Check | Result |
| --- | --- |
| Per-directory `pnpm audit --fix` | PASS: 52/52 commands exited zero |
| `CI=true pnpm install --no-frozen-lockfile` | PASS: lockfile regenerated |
| `CI=true pnpm install --frozen-lockfile` | PASS: configuration and lockfile agree |
| `pnpm --filter @workspace/api-spec run check:toolchain` | PASS: TypeDoc and both plugins generated documentation with the patched minimatch |
| `CI=true pnpm run typecheck` | PASS: full root command, including generated API checks and artifact typechecks |
| Web artifact build, `BUILD_IDENTITY_MODE=development PORT=5000 BASE_PATH=/` | PASS: includes Workbox injectManifest, service worker generation, and bundle-boundary checks |
| API artifact build, `BUILD_IDENTITY_MODE=development` | PASS |
| Second filesystem walk | PASS: 52 JavaScript manifests and 3 root Python/workspace/lock files checked; neither vulnerable package/version pair remains pinned |
| Source and installed pnpm lockfiles | PASS: both targeted vulnerable versions absent |
| `pnpm audit --json`, assigned advisory IDs | PASS: neither assigned advisory remains |
| Restarted web and API managed workflows | PASS: both serving; API startup completed |
| Development `/api/healthz` | PASS: process, startup, database, audit protection, dependencies and background workers all `ok` |
| Browser screenshot of `/` | PASS: sign-in landing page renders; no signed-in UI verification claimed |
| `git diff --check` | PASS |

The screenshot's unauthenticated API requests returned expected 401 responses.
The API workflow's generic `/` readiness probe returned 404; its actual health
endpoint passed. Neither response indicates an application startup failure.
Desktop Chromium landing-page rendering was checked; phone/tablet, WebKit,
physical devices and signed-in workflows were not exercised because these
changes affect build/documentation dependencies, not responsive UI behavior.

## Failure ledger and remaining boundaries

- The broad `pnpm audit --json` exits 1 for 14 other existing advisory records
  (4 high, 6 moderate, 4 low), concerning undici, fast-uri,
  serialize-javascript and deepmerge. None is either assigned advisory.
  Broader dependency hardening remains with the existing build/test security
  work; these findings are not suppressed or represented as fixed here.
- The automatic combined log snapshot included published-environment
  database-connection/background-worker errors unrelated to the changed
  dependency graph. No production investigation or repair was attempted.
  The already-owned database-pressure investigation remains the next action;
  the isolated development health check above passed.
- Python auto-fix is not applicable to the empty Python dependency set.
  The missing pip-audit module is recorded above, not counted as a passing
  Python audit.

Evidence here is a minimized development summary, not a release-readiness
certificate or a claim about what production is serving. Raw operational
logs, credentials, authenticated captures and database records are not included.
