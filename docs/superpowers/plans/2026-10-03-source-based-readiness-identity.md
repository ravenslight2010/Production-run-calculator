# Source-based readiness implementation

1. Introduce shared source and assessment identities without Git. Assessment
   identity includes production source plus applicable verification inputs.
2. Add a strictly validated, expiring source-based published handoff generated
   from an independent expected/live comparison.
3. Teach readiness, reconciliation, release, and report consumers the new
   identities; preserve historical Git-bound readers.
4. Move normal local/browser evidence producers to assessment fingerprints.
5. Add positive no-Git and negative mismatched/stale identity contracts.
6. Run focused tests/typechecks and repeat the read-only live rehearsal.
7. Update operating guidance and memory; no publishing or production writes.