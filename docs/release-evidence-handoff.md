# Release evidence handoff

Use this page and the read-only handoff command as the starting point for
reviewing release evidence. The command requires an explicit mode and source/test
revision, compares only that mode's retained report and checkpoint, checks the
current browser contract, and prints the links and unresolved statuses. It does
not modify retained evidence, run release gates, or issue a production GO.

```bash
REVISION="$(node --input-type=module -e 'import { captureReleaseIdentity } from "./scripts/src/release-source-identity.mjs"; console.log(captureReleaseIdentity(process.cwd()).revision)')"
pnpm run release:evidence-handoff -- --mode standard --revision "$REVISION"
pnpm run release:evidence-handoff -- --mode full --revision "$REVISION"
```

To inspect an archived evidence directory, add
`--evidence-dir <repository-relative-directory>`. The command exits nonzero when the
selected report is missing, stale, incomplete, or not passing, or when required
supporting test evidence is missing. A successful local/CI result still does not
establish production readiness. Run the official verifier separately:

```bash
pnpm --filter @workspace/scripts run check:release-evidence -- \
  --evidence-dir release-evidence
pnpm --filter @workspace/scripts run check:release-evidence -- \
  --evidence-dir release-evidence-full --full
```

## Where the authoritative contracts live

| Need | Source |
| --- | --- |
| Standard/full commands, runner behavior, retry and resume rules | [Release operations](release-operations.md#release-commands) |
| Required and conditional checks by code surface | [Test and release evidence matrix](test-release-matrix.md#required-release-sets-by-change-category) and [release checklist](../.agents/skills/release-checklist/SKILL.md) |
| Current full-browser case contract | [`full-browser-case-contract.mts`](../scripts/src/full-browser-case-contract.mts) |
| Browser isolation and disposable database requirements | [Test matrix isolation contract](test-release-matrix.md#isolation-and-fixture-contract) and [release checklist](../.agents/skills/release-checklist/SKILL.md#full-browser-e2e) |
| Local retained reports, logs, checkpoints, and browser artifacts | `release-evidence/` for standard; `release-evidence-full/` for full |
| Retained evaluations | The report's **Retained evaluations** section and the linked files beneath the selected evidence directory |
| CI-run evidence artifacts | [Release-check workflow](../.github/workflows/release-check.yml); each standard/full upload includes `release-evidence-handoff.md` generated for that job's mode and release-selected revision |
| Production reconciliation and deployed-revision binding | [Production reconciliation instructions](release-operations.md#bind-production-reconciliation-evidence-to-the-deployed-build) |
| Recovery after a stopped run | [Resume and fresh-run instructions](release-operations.md#how-to-interpret-a-result) |

The workflow uses the same source/test fingerprint selector as the release runner,
excluding retained evidence and generated output. Git and GitHub identifiers are
optional metadata; historical Git-bound records remain readable. The
handoff is generated after allowlist verification and before upload, alongside
the retained report and checkpoint; it does not replace or edit either record.
If generation fails, the artifact contains an explicit **INCOMPLETE** handoff
note. That diagnostic step does not change the release gate result. Missing,
stale, incomplete, or failing evidence remains non-passing in the generated
handoff.

Standard and full evidence directories are separate. A report for one mode or
revision cannot satisfy another. The checkpoint is a separate, incomplete
attempt: it does not replace the retained report. For full mode, a browser-only
report is not a full release report; it must match the selected revision and the
case count in the current contract. The runner timeout and warning budgets are
maintained in `scripts/src/release-check.mts`, not inferred from an old report.

## Local/CI results are not production proof

The handoff shows the report environment, source-library evidence environment
and revision, deployed revision, and readiness-evidence path separately. A
development or disposable-CI run is test evidence only. Production-bound proof
requires the controlled deployed revision and matching release-environment
source-library reconciliation and readiness evidence described in
[release operations](release-operations.md#bind-production-reconciliation-evidence-to-the-deployed-build).
This handoff never reports a production GO; the release owner must make that
decision through the official release process.

When a result is unresolved, the release owner owns the next test-evidence
action: produce a fresh run for the selected revision, or resume only when the
checkpoint is for the same mode and revision. The deployment/reconciliation
owner supplies missing production-bound proof. Do not manually edit reports or
relabel missing evidence as a pass.

## Historical context and secondary leads

[Task #2339 context](../.local/tasks/complete-full-release-evidence.md) records
the earlier browser/fixture repairs and evidence limitations. Its associated
[full-mode retained report](../release-evidence-full/release-check-report.md)
and [full-mode checkpoint](../release-evidence-full/release-check-checkpoint.md)
are historical: the retained report is not current proof, and the checkpoint
is explicitly incomplete with retained evidence left unchanged. The
[full-browser report under standard evidence](../release-evidence/browser-full/FINAL-REPORT.md)
is only a browser result and cannot qualify as full-mode release evidence.

These review-only pull requests are secondary investigation leads, not release
results. They contain comments from earlier code revisions; task #2592 owns
their finding-by-finding disposition. Do not count a review comment as a
passing gate or carry it forward as a current blocker without checking the
current source and matching evidence:

- [CodeRabbit review PR #83](https://github.com/ravenslight2010/Production-run-calculator/pull/83), including the [runner identity evidence comment](https://github.com/ravenslight2010/Production-run-calculator/pull/83#discussion_r4110165842).
- [CodeRabbit review PR #84](https://github.com/ravenslight2010/Production-run-calculator/pull/84), including the [retained-evaluation parse diagnostic comment](https://github.com/ravenslight2010/Production-run-calculator/pull/84#discussion_r4110169057).
- [CodeRabbit review PR #85](https://github.com/ravenslight2010/Production-run-calculator/pull/85), including the [readiness-evidence validation comment](https://github.com/ravenslight2010/Production-run-calculator/pull/85#discussion_r4110170378) and [browser fixture isolation comment](https://github.com/ravenslight2010/Production-run-calculator/pull/85#discussion_r4110167826).
