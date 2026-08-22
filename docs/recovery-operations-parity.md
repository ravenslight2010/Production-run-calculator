# Recovered operations parity audit

Compared with the preserved recovery commits, the current branch was checked
for import history, data health, operational reports, and shift handoff.

| Area | Result | Decision |
| --- | --- | --- |
| Import history | Recovered | Reopening a saved spec or premix snapshot is available from the history row and routes to the matching review panel. |
| Data health | Recovered | Safe repair batches are retained and can be undone only while their profile values and LWW stamp are unchanged. |
| Operational report | Recovered | Date-scoped inventory ledger totals and quality/incident detail links are retained alongside the current inventory snapshot. |
| Shift handoff | Present | The current digest is retained; it already includes scoped source availability, historical events, and source navigation. |
| Contracts | Recovered | OpenAPI and generated clients were regenerated for historical inventory and repair-batch fields plus the undo route. |

The audit intentionally excludes wholesale checkpoint merging, production
deployment, and data heals. The handoff implementation remains the current
branch version because it adds source-unavailable handling and the broader
scoped digest without removing a required behavior.

## Repeatable selective recovery playbook

The checked-in recovery manifest and audit cover the small set of operational surfaces
where a checkpoint recovery omission would be costly:

```sh
pnpm run audit:recovery
pnpm --filter @workspace/scripts run audit:recovery -- --json
```

`MISSING` means the current tree lacks declared evidence and must be investigated.
`DIFFERENT` means evidence is incomplete but the manifest records an intentional current
implementation difference; review that note rather than treating it as a failed restore.
The audit is read-only and deterministic.

Before risky work, preserve a named baseline without changing the branch:

```sh
git status --short
git branch recovery-baseline-<name> HEAD
git tag recovery-baseline-<name> HEAD
```

Use one name consistently in the recovery record. Afterward, compare selectively:

```sh
git diff --stat recovery-baseline-<name>...HEAD
git diff -- artifacts/api-server lib/api-spec artifacts/run-calculator
pnpm run audit:recovery
```

Recover only the missing feature files and their wiring, contracts, and focused tests.
Do not reset the branch or replace `home.tsx` wholesale. Record intentional differences
in `scripts/recovery-manifest.json` and explain them in the completion report.

### Completion report

```text
Baseline: <branch/tag and commit>
Current: <branch and commit>
Audit: PASS / FAIL — <command and summary>
Recovered: <feature IDs and files>
Already present: <feature IDs>
Intentional differences: <feature IDs and rationale>
Left out: <feature IDs and why>
Checks: <focused tests and typechecks>
Production changes: none / <explicitly describe>
```