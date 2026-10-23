# Windows metadata maintenance

The distillation metadata-only append command supports native Windows x64 when
the repository's pinned Node.js and pnpm versions are installed, PowerShell 5.1
is available, and the decision file is on a local fixed NTFS volume.

- Node.js: exactly the version in `.nvmrc`, x64.
- pnpm: exactly the version in the root `package.json` `packageManager` field.
- PowerShell: Windows PowerShell 5.1, using its normal execution policy; the
  command invokes the Windows-supplied executable by its system path.
- Storage: local fixed NTFS only. Network shares, removable/non-NTFS volumes,
  WSL/Linux, Windows ARM64, macOS, and other platforms are not supported by this
  Windows implementation.

From a Windows x64 checkout, install the workspace dependencies with
`pnpm install --frozen-lockfile`, then run:

```powershell
pnpm --filter @workspace/scripts run test:metadata-maintenance
pnpm --filter @workspace/distill-dataset run test
pnpm run typecheck:libs
pnpm --filter @workspace/scripts run typecheck
```

The Windows workflow runs the focused tests and both typechecks on a native
`windows-2025` runner. Its synthetic lock tests cover a live owner, a reused
PID, a dead owner, a live legacy PID-only lock, and malformed lock data. Linux
continues to use `flock` and procfs; Windows does not use WSL or emulate Linux.

The broader `test:distill-backfill` command remains a Linux check: it also runs
private Apply-log export tests with POSIX file-permission requirements. Windows
support for that exporter is not part of this metadata-only command's approval.
The exporter rejects Windows before reading credentials or fetching private
records; an NTFS ACL and retention contract needs separate approval.

Windows holds an exclusive OS file handle on a persistent recovery-gate file
through validation and the entire atomic replacement. Windows releases the
handle on normal exit or process termination. Recovery checks the lock
owner's PID and UTC process-creation FILETIME; it reclaims only a positively
absent process or a PID whose verified creation time differs. Inaccessible or
ambiguous identities, malformed locks, and live legacy PID-only locks fail
closed. Appends retain the existing metadata-only validation and history; the
replacement is written to a same-directory temporary file, flushed, and
atomically installed without deleting the prior decision first. A concurrent
change detected during the locked compare-and-swap requires a retry.

This command's Windows support does not imply Windows support for the full
application or for other maintenance commands.
