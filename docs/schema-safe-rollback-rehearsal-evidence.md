# Schema-Safe Application Rollback Rehearsal Evidence

On September 3, 2026, `pnpm run check:schema-safe-rollback` completed against
disposable Docker resources with this repository revision and its parent:

- Current revision: `4f27d32c8c10efe657d404a5bf1ec2336ec4a7f1`
- Parent revision: `6bbf085eb352dfd48b66aee44ccb21c6eb8e1783`
- Current runtime image ID:
  `sha256:5edf02d1d3fcb7d71b3374fe930620e90be72819a588431aafc50bfc24187d49`
- Parent runtime image ID:
  `sha256:a56369a1823651ffcf1c0af76d2dd7b5248a198d9e02f682b02306f832dc9194`
- Matching current migration image ID:
  `sha256:153f2ace63292c1ecfa00b401ec2b90e8be014cab2e1e2a9d7ebf110d88333f2`
- Current migration result: exit 0
- Current runtime checks (`/`, `/api/healthz`): PASS
- Parent runtime checks against the migrated database (`/`, `/api/healthz`):
  PASS
- Normalized public-schema fingerprint after migration:
  `6d41aff47fb4bc479d66fa3820bd21675d1c4af7b6370c9a9b5d24d17226f1ab`
- Normalized public-schema fingerprint after runtime replacement:
  `6d41aff47fb4bc479d66fa3820bd21675d1c4af7b6370c9a9b5d24d17226f1ab`
- Cleanup check: no rehearsal containers, networks, volumes, image tags, or
  temporary worktrees remained.

The schema was applied exactly once by the migration image matching the
introduced release. The rehearsal then replaced only the application runtime
with the parent revision's immutable image while preserving the database
volume. It did not run the parent migration image or a down migration.

Each CI run writes its own `rollback-rehearsal-report.md`, appends it to the job
summary, and uploads it as a retained artifact even when the rehearsal fails.