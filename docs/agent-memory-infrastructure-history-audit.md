# Agent-memory infrastructure history audit

## Result

- Snapshot: `fbd58378021dba722a16440cd127c779db00bd77`
- Revisions scanned: 1,012
- Revision limit: 2,000; no older revisions omitted
- Findings: none
- Disposition: no historical match was identified in the scanned range, so no resource remediation was indicated. No Git history was rewritten.

## Scope and reproduction

The audit examined every reachable commit at the snapshot that changed a scanned Markdown note under `.agents/memory/`. It used the same host and deployment-image matchers as the working-tree guard. `.agents/memory/codex-fixes.md` and non-Markdown files were excluded.

Reproduce the metadata-only scan with:

```sh
pnpm --filter @workspace/scripts run audit:agent-memory-infrastructure-history -- --ref fbd58378021dba722a16440cd127c779db00bd77
```

Findings, if any, contain only commit, file, line, and category. Matched text is not emitted.

## Limits

This result is specific to the Git history reachable from the recorded snapshot and the scanner's current match patterns. It does not cover unreachable Git objects, other refs not reachable from that snapshot, non-Markdown memory files, published copies, external services, or host/image patterns the scanner does not recognize. A clean result is not proof that no infrastructure details exist outside this bounded scope.
