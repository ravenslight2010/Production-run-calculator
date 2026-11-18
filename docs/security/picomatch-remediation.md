# Picomatch advisory remediation

## Scope and evidence

Verified on 2026-11-18 in the isolated development task workspace, using Node
24.22.2 and pnpm 12.21.0 through `scripts/src/run-release-node.sh`.
These results describe the working tree containing this report, not a deployed
revision. No production data, credentials, or imported source records were
captured. Raw command output is local, ignored evidence under
`generated-artifacts/security/`; this report retains only dependency facts.

The filesystem inventory used `find` with directory pruning before any other
investigation, not `git ls-files`. A second `os.walk` inventory also pruned
dependency, VCS, virtualenv, build/output, and package-manager cache directories.
Managed skill templates and `.local/share` package-manager installation caches
are tooling, not project dependency roots.

## Advisory decisions

| Advisory | Published fix | Reviewed implementation |
| --- | --- | --- |
| GHSA-3v7f-55p6-f55p | 4.0.4 / 3.0.2 / 2.3.2 | Existing 4.0.7-based fork has the null-prototype POSIX class map; added method-injection regression checks. |
| GHSA-c2c7-rcm5-vvqj | 4.0.4 / 3.0.2 / 2.3.2 | Existing upstream-derived repeated-extglob protections; added bounded child-process tests of overlapping and nested repetitions. |
| GHSA-fc5q-39xc-vjpf | **None**; npm latest remains 4.0.7 | Retained the local raw-star repetition repair; expanded bounded child-process probes for both `+()` and `*()`. |

Sources: the three corresponding
`https://api.github.com/advisories/<advisory-id>` records and
`https://registry.npmjs.org/picomatch`, retrieved on the verification date.

The source repair was already present before this task. The scanner instead
identified the dependency version as `file:patches/picomatch`, losing the local
fork's provenance and reporting all three advisories. The fix registers the
maintained source as a first-party workspace package and uses `workspace:*`
for all transitive consumers. The regenerated lockfile uses workspace links,
not an opaque external file dependency. **No advisory was suppressed, no
upstream fixed release was invented, and no vulnerable registry release was
substituted.** A clean dependency scan alone is not proof of this fork's safety;
the security and installed-resolution tests remain required.

The six active installed consumers resolve the reviewed workspace source.
These are development/build tools (Vite, Vitest, tinyglobby and fdir), not V2's
HTTP API accepting user-supplied glob patterns. V2's production dependencies are
PostgreSQL and spreadsheet handling. The fork still needs maintenance until a
verified upstream fix exists; repeated raw-star patterns retain the documented
conservative matching behavior. Keep default recursion protections enabled.

## Per-manifest audit

All JavaScript manifests use the repository's pnpm policy; there is one shared
root `pnpm-lock.yaml` and no nested project lockfiles. `pnpm audit --fix` was
attempted from **each of the 54 JavaScript manifest directories**, not just the
root. No automatic fixes were available. `pyproject.toml` declares no Python
dependencies and has no Python lockfile.

The initial attempts in the two archived V1 apps and the previously unregistered
fork returned `ERR_PNPM_AUDIT_NO_LOCKFILE`. Registering the fork closes its audit
error: its own-directory audit now passes. The archived applications remain
deliberately outside the active workspace; neither pins picomatch or has a
lockfile. They were checked statically rather than reinstalled or restored.

Inventoried manifest directories (`package.json` in each except the explicitly
listed Python manifest):

```text
.
_archived/v1/artifacts/api-server
_archived/v1/artifacts/run-calculator
artifacts/mockup-sandbox
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
lib/mix-reconcile
lib/mixes
lib/name-match
lib/named-recipes
lib/onboarding
lib/premix-import
lib/production-rules
lib/profile-cleanup
lib/recipe-apply
lib/recipe-guide-import
lib/schedule-move
lib/schedule-optimize
lib/scheduled-recipe-check
lib/setup-math-check
lib/shipping-import
lib/spec-export
lib/spec-import
lib/spec-reconcile
lib/sync-contract
lib/typescript-api-v6
patches/picomatch
scripts
v2
pyproject.toml
```

## Verification and failure ledger

- PASS: lockfile regeneration followed by `CI=true pnpm install --frozen-lockfile`.
- PASS: all six fork tests, including bounded probes for all three advisories
  and resolution of six active installed consumer manifests.
- PASS: `pnpm audit --json` reports zero vulnerabilities at every severity.
- PASS: fresh Replit dependency scan reports zero findings (previously three).
- PASS: existing override compatibility check; previously approved exceptions
  for unrelated packages remain visible and unchanged.
- PASS: full repository `pnpm run typecheck`.
- PASS: V2 build, component-preview build, and both component-preview tests.
- PASS: restarted the existing component-preview workflow and inspected
  `/__mockup` on port 8081; the page rendered with no browser errors.
- FAIL (pre-existing configuration, unchanged): V2 tests pass 144 of 145.
  `published V2 starts its supervised API and worker on one external web port`
  rejects external ports `80` and `5173`, because it correctly requires only
  `80`. Both `.replit` and the guard test are byte-identical to the task's
  starting revision. Do not weaken this guard or claim the whole V2 suite is
  green. The owner should remove the unused `5173` external mapping in
  **Tools → Networking** before publishing, then rerun
  `pnpm --filter @workspace/lucia-v2 test`. Networking/deployment settings were
  not changed by this dependency repair.
- Resolved test-fixture error: an initial resolution test traversed unused
  packages retained by pnpm in its virtual store. It now starts from actual
  lockfile importers and follows the active installed graph instead.
- Archived audit limitation: the two non-workspace V1 manifests have no
  lockfiles to audit. They contain none of the reported pins; no archived
  application or database was restored.

No responsive layout or browser-specific application code changed. Physical
Android/iOS and signed-in operational journeys are not part of this dependency
repair; application build/tests and the managed preview provide smoke coverage,
not production or physical-device certification.
