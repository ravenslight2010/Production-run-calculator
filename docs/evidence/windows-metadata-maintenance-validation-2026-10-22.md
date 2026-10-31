# Windows metadata maintenance validation

Recorded 2026-10-22 (America/Chicago; native run timestamps are UTC).
This is command-specific development-runtime evidence, not an application release
or production-readiness decision.

## Approval and boundaries

The owner approved native Windows support for metadata maintenance only, and a
task-only pull request to obtain native Windows CI evidence. No real-data backfill, private
Apply-log export, customer evidence access, production write, deployment, or merge
was performed.

The supported Windows contract is x64 Node from `.nvmrc` (24.21.0), pnpm from
`package.json#packageManager` (12.8.1), Windows PowerShell 5.1, and a local fixed
NTFS volume. Network drives, non-NTFS filesystems, Windows ARM64, and WSL as a
substitute for native Windows validation are excluded. This does not approve the
rest of the application or other maintenance commands on Windows.

## Native Windows

- Validation-only PR: https://github.com/ravenslight2010/Production-run-calculator/pull/129
- Base: `Replit`; left unmerged.
- Code revision: `eb5905542b703992562a5992b77f36835953d249`.
- Native run: https://github.com/ravenslight2010/Production-run-calculator/actions/runs/39886470255
- Runner: GitHub-hosted `windows-2025`, x64.
- Final result: SUCCESS, completed by `2026-10-23T01:54:38Z`; every required
  native step below succeeded, including the private-export refusal assertion.
- Earlier complete metadata run:
  https://github.com/ravenslight2010/Production-run-calculator/actions/runs/39885950577
  succeeded before the additional private-export refusal assertion was added.
- Workflow lint:
  https://github.com/ravenslight2010/Production-run-calculator/actions/runs/39886470308
  succeeded.

Required native steps:

| Check | Contract |
| --- | --- |
| Runtime verification | Pinned pnpm, x64 OS/process, Windows PowerShell 5.1 |
| `pnpm install --frozen-lockfile` | Approved Windows esbuild and Rollup binaries |
| `pnpm --filter @workspace/scripts run test:metadata-maintenance` | Real Windows process identity, exclusive handle, recovery, and atomic file replacement |
| `pnpm --filter @workspace/distill-dataset run test` | Two files, 31 synthetic dataset tests |
| `pnpm run typecheck:libs` | Shared declaration graph required by scripts |
| `pnpm --filter @workspace/scripts run typecheck` | Scripts, including Windows adapter and fixtures |

The native fixture inventory includes:

- Active owner with matching process creation FILETIME: reject unchanged.
- Reused current PID with a different FILETIME: recover.
- Definitely absent PID: recover; unexpected identity lookup errors fail closed.
- Live legacy PID-only lock: reject; definitely dead legacy owner: recover.
- Truncated JSON, null record, missing identity, wrong platform, string PID, and
  oversized owner record: reject without changing the lock or decision.
- Malformed recovery marker: reject; a verified dead recovery owner: recover.
- Exclusive gate held by a real PowerShell process: reject; forced termination
  releases its handle and allows verified dead-owner recovery.
- Destination held open incompatibly: reject without changing decision bytes.
- Changed decision bytes between validation and replacement: reject and require
  revalidation.
- Spaces and non-ASCII file names and notes: preserve UTF-8 bytes.
- Private export on actual Windows: reject before reading a nonexistent credential
  path or fetching from a deliberately invalid host; create no output.

All files and owner markers were synthetic temporary fixtures. These are bounded
common-case and failure-path checks, not exhaustive testing of every NTFS feature
or Windows policy configuration.

## Linux

Linux x86_64 checks used installed Node 24.21.0 through the repository's
`scripts/src/run-release-node.sh`, with pinned pnpm 12.8.1 selected through
Corepack and made available to nested pnpm commands.

- `pnpm --filter @workspace/scripts run test:distill-backfill`: PASS, including
  Linux flock/procfs cases, private-export fixtures, and 31 dataset tests.
- After adding the Windows-only export refusal,
  `pnpm --filter @workspace/scripts exec tsx ./src/distill-applylog-export.test.mts`:
  PASS; includes a pure Windows-platform refusal assertion, not emulated Windows
  locking evidence.
- Final `pnpm --filter @workspace/scripts run typecheck`: PASS.
- `pnpm run check:workflows`: PASS, including actionlint on 13 workflows.
- `git diff --check`: PASS.

The broader Linux distillation test remains unchanged. The Windows job uses the
metadata-only test command instead of weakening the exporter's POSIX permission
assertions.

## Source binding

These SHA-256 values were compared byte-for-byte between the task workspace and
the task-only CI worktree. Later evidence prose does not change tested code.

```text
296b7311c11c6caf920c921cfa1a79a4cce0c1323b4edc3b4243f7da7ef241ee  scripts/src/distill-backfill.mts
ef35a051bdbcba8bd2fa20dbbd7602708799795c6047c17baf610ead42b75d46  scripts/src/distill-backfill.test.mts
8140600a641118eb1deb97add1e1a2969b335facc469f2add533147f2977305b  scripts/src/distill-backfill-windows.test.mts
411468e705cc6479dbb8db0f713111fdd9424904b25533b4df990ddcb4149de2  scripts/src/metadata-maintenance-windows.mts
e52d24ab936489613eb2791ede12cffa8465a39973cbc73a8d5bed70088f14db  scripts/src/metadata-maintenance-windows.ps1
d2ba9dd263fe926b55dccac28fa8695ab86e831a486903e7d43852d64b7d721c  scripts/src/distill-applylog-export.mts
12a240064a00f0b63207aa8eb15e0cd69a347b1bd4f1a66308c5ba25d4cf3ffc  scripts/src/distill-applylog-export.test.mts
207bf0f017eb63fd98735a249f2ae2588749710b8b724bf49d555cb170a4710f  scripts/package.json
cb83afa1cba863d90ef0426a6eaaea7a8ae5981dadf08d0b0d2d9065dc47e65b  pnpm-workspace.yaml
d51ed1793fe22b677d91cf0fe74498050278348b8f98c68bbcf0c8f8ae16953d  pnpm-lock.yaml
76012880daf5bce09b3ed978acb21d714ab406fe77e19d5955ee51987ef19dfa  .github/workflows/windows-metadata-maintenance.yml
```

## Failure ledger and exclusions

Resolved within this task:

- Windows PowerShell 5.1 converted a null backup-path argument to an empty
  string. Use its explicit .NET null-string sentinel, preserving atomic
  `File.Replace` rather than falling back to copy/delete.
- Malformed lock JSON produced raw parser errors. Return a controlled refusal
  without exposing lock contents; retain the file unchanged.
- The initial workflow cache lacked the repository-required run-scoped key.
  Remove caching rather than weaken that policy.
- The new crash fixture used invalid PowerShell environment-variable syntax.
  Correct the synthetic fixture and rerun it natively.
- The isolated Linux shell selected pnpm 10 despite a pnpm 12 pin. Use Corepack's
  pinned manager for both the command and its nested invocations; stop only
  positively identified recursive bootstrap processes.
- The required completion command, `bash scripts/src/run-release-node.sh pnpm run
  typecheck`, initially hit that bootstrap problem before reaching TypeScript.
  Its environment does not use the manual command prefix. Repair the local
  manager's writable version cache using the already verified Corepack binary,
  so the unchanged command and nested invocations resolve the repository pin.
  No tracked release-runner change was needed. The final command result is
  retained with the task's completion validation.

Known independent validation-PR limitation:

- The automatically triggered Department navigation browser job fails with
  `Required build-source inputs are missing.` The public base checkout lacks
  the required `attached_assets/source-library/audits` tree. This is an
  application build/source-evidence boundary, not a metadata-command failure.
  The existing source-library release-evidence work owns that issue; the next
  action is to restore approved, environment-bound build inputs without exposing
  private source evidence. This task did not inspect or publish that evidence.
- Unrelated standard/release/browser/advisory runs were cancelled when still
  active. Their full CI/release results are not represented as passing.
- Browser, responsive UI, schema, live-state/sync, and deployment checks are not
  applicable to the metadata command. The additional API-only completion repair
  below changes no UI or browser-specific behavior.

## Completion-review repair: QC JSONB retry equality

The complete inherited branch included a QC label-reference retry comparison
that serialized objects read back from JSONB. PostgreSQL can reorder their keys,
so identical requests could receive 409 instead of a duplicate acknowledgement.
Replace both transaction and fallback comparisons with structural equality.
The same structural comparison now protects the adjacent component-observation
array without making array order irrelevant. Required-field arrays retain their
existing order-sensitive comparison.

No API shape, permission, schema, stored-history content, or deliberate-conflict
status changed. Existing valid records need no data heal. This is a bounded
completion-review repair, not additional Windows application support; it is not
included in the Windows-only validation PR.

Real-router regression checks against separately created and removed disposable
local PostgreSQL clusters both passed:

```text
pnpm --filter @workspace/api-server exec vitest run src/routes/roles.integration.test.ts \
  -t 'keeps label comparisons server-resolved, approved, versioned, and idempotent'
1 passed; 190 unrelated tests skipped

pnpm --filter @workspace/api-server exec vitest run src/routes/roles.integration.test.ts \
  -t 'resolves component checks from canonical settings, evaluates them server-side, and audits retry/correction/redaction'
1 passed; 190 unrelated tests skipped
```

The label regression explicitly reads the persisted JSONB record, retries with
reordered expected-field keys, verifies the same event ID and duplicate response,
rejects a changed lot with 409, and confirms only one event remains. All accounts,
sessions, references, and database writes were synthetic. Shared application
startup was not exercised; no permission was granted for startup data heals
against existing operational data.

Optional new capabilities remain separate: a Windows ACL/retention contract for
private exports, and operation identities for idempotent retries. The current
append contract intentionally continues to treat a fresh invocation as a fresh
append; no existing history is deduplicated or rewritten.
