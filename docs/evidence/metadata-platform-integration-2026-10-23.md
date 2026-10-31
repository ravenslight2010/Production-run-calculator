# Metadata platform integration

This merge preserves the separately approved Linux, macOS, and bounded Windows
metadata-maintenance paths. It does not approve other commands on Windows.

## Conflict resolution

- The platform gate accepts Linux, macOS, and Windows; other hosts still fail
  closed with instructions to leave existing locks untouched.
- The POSIX recovery worker remains available on Linux and macOS. Windows uses
  its separate PowerShell/NTFS implementation, never the POSIX worker.
- Native POSIX recovery fixtures remain enabled on both Linux and macOS;
  Windows-specific fixtures remain separate. A string annotation fixes a
  TypeScript inference error in the foreign-owner fixture without changing its
  fail-closed assertions.
- The supported-host memory entry retains both explicit platform approvals.

## Integration failures repaired

The updated main branch contained generated Zod constraints declared after their
first use, preventing the focused metadata test from loading its production
contract. Regenerating from the existing OpenAPI contract with the existing
Orval hook restored declaration ordering and generated-output consistency. No
OpenAPI contract was changed.

The library typecheck exposed an unrelated malformed live-calculation test
fixture. It supplied a run snapshot to an applicator helper that requires
individual fields. The fixture now supplies those fields. The same test file's
invalid-pizzas-per-case fixture now actually uses zero, and its positive canonical
wall-schedule fixture supplies matching generation and private wall ownership.
These changes repair test setup; production calculations, scheduling, and
ownership fences are unchanged.

## Checks

On Linux with Node 24.21.0 and pinned pnpm 12.8.1:

- API generation through `pnpm --filter @workspace/api-spec run generate`: PASS.
- Focused metadata test through
  `pnpm --filter @workspace/scripts exec tsx ./src/distill-backfill.test.mts`: PASS.
- `pnpm run typecheck:libs`: PASS after the fixture repair.
- `pnpm --filter @workspace/scripts run typecheck`: PASS.
- `pnpm --filter @workspace/live-calc exec vitest run src/liveCalc.test.ts`:
  PASS, 10 tests.
- `git diff --check`: PASS.

No new native macOS or Windows run was performed during conflict resolution.
Earlier host-native evidence remains bound to its recorded revisions; Linux
checks are not represented as native evidence for either host. No real metadata
append, private evidence inspection, backfill, production write, or deployment
was performed.
