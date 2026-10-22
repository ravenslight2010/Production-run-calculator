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

## Local-ref extension

The follow-up audit inventories all local refs, including branches, tags, remote-tracking refs, and other namespaces, without fetching or contacting remote services. It excludes commits reachable from the pinned snapshot above and scans up to 2,000 unique note-changing commits outside that snapshot, in Git topological order. The selected set is bounded and reproducible for the recorded ref inventory and snapshot. The inventory SHA-256 is calculated from the sorted `refname objectname` rows emitted by `git for-each-ref`; record the counts and digest below when the audit is run.

Reproduce the local-ref scan with:

```sh
pnpm --filter @workspace/scripts run audit:agent-memory-infrastructure-history -- --refs-outside-snapshot fbd58378021dba722a16440cd127c779db00bd77
```

Findings contain only ref, commit, file, line, and category. Matched text is not emitted. A finding is attributed to each inventoried ref that contains its commit. The scanner reuses the same matcher and Markdown-note exclusions as the snapshot audit.

### Local-ref result

- Ref inventory: 2,464 refs (2,219 branches, 9 tags, 234 remote-tracking refs, 2 other refs); SHA-256 `229443f76871bab98c015694ef420773aa9e712bb35e9c52db782192d9f9e853`
- Note-changing commits outside the snapshot: 1,415
- Revision limit and omitted status: 2,000; no older revisions omitted
- Findings: 190 metadata-only records across 17 commits and 54 refs. All were categorized as mailing-address matches; no infrastructure-host or deployment-image matches were found. The command above emits only ref, commit, file, line, and category for each record.
- Disposition: no history edits or automatic remediation. Mailing-address findings require owner review before any action; resource rotation/retirement was not indicated by these match categories.
- Git history rewritten: no
