# Reviewed branch-state reconciliation

## Integration branch

- **Base:** live `main` at `8cdbf3a2f18d3ebc03195f06f5e63bf533cb69e7`
- **Reviewed branch:** `task-2018-port-live-main`
- **Source branch preserved:** local `Replit` remains available as the archival
  source; no source branch was deleted, rewritten, or force-pushed.

This branch was created directly from the refreshed live `main` reference. The
preserved Replit work was reviewed for overlap before any changes were applied.
Several preserved commits were empty against the original reviewed live-main
revision and remain superseded after the final rebase because their
foreground-sync, ZIP-inventory, AI-evaluation, and auth-rate-limit behavior was
already present in live `main`.

## Ported work

- Foreground wake recovery, bounded retry behavior, WebKit service-worker
  isolation, timeout protection, and auth rate limits were confirmed present in
  live `main`; no duplicate historical commits were layered on top.
- The metadata-only ZIP asset inventory and its safety tests were confirmed
  present in live `main`. The reviewed branch adds the portable duplicate-upload
  coverage needed for writers that produce different ZIP metadata, while the
  inventory continues to inspect central-directory metadata only and report
  review findings rather than approve extraction or execution.
- The approved AI evaluation comparison and its provider-neutral,
  offline-first boundary were confirmed present in live `main`.

## Not copied as current evidence

The preserved browser reports and the historical ZIP upload review were tied to
older source and asset revisions. They were not copied as current release
evidence. `release-evidence/browser-full/FINAL-REPORT.md` is retained unchanged
and is explicitly bound to revision
`6fca6062f214dda503321065aea7a825e4e61448`, not to this branch. Any new
release or browser evidence must be generated or verified against the exact
revision assessed on this branch; an older report must not be relabeled current.

Historical uploaded archives remain on the preserved source branch. They were
not reintroduced into this reviewed branch merely to make an old review appear
current.

## Delivery boundary

This is a local reviewed delivery branch based on live `main`. Delivery to
GitHub `main` remains a pull request operation subject to the repository policy,
required checks, signed-commit rules, and review. No remote mutation was
performed as part of this reconciliation.