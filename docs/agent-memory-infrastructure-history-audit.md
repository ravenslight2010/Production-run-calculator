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


## Commit-message extension

Commit messages are a separate input from historical note contents. The local-ref
mode now scans them as well; the `--ref` mode remains a note-only scan. This work
does not replace the separate unreachable-object audit or retained-address review.
No other current commit-message scan was identified in the task records available
at execution.

## Unreachable local commit result

- Local checkout snapshot: `5417b2a065803ed07b393b90d57b60cb8cab5700`
- Inventory method: `git fsck --no-reflogs --unreachable`; unique unreachable commit IDs sorted lexicographically before applying the limit.
- Commit inventory: 437; inventory SHA-256 `0ae449677896f435abac96aec33a1a5dbb05266b7c21d66fd01c7363431198c6`
- Revisions scanned: 437; limit: 2,000; additional commits omitted: no
- Findings: none. The shared matcher and Markdown-note exclusions were applied; matched text is never emitted.
- Disposition: no owner action or remediation is indicated by this scan. Any future findings require owner review before changes. No refs, history, or objects were changed or pruned.

Reproduce the metadata-only scan against the current local object database with:

```sh
pnpm --filter @workspace/scripts run audit:agent-memory-infrastructure-history -- --unreachable-commits
```

The inventory digest identifies the sorted set of unreachable commit IDs seen at scan time. The object database can change independently of `HEAD`; rerun the command to audit a later local inventory. This result does not cover unreachable tree/blob contents that are not represented by a scanned commit, published copies, external services, or patterns the shared matcher does not recognize.

### Range and matcher review

- Use the same pinned snapshot and locally inventoried refs as the local-ref
  command above. Independently select up to 2,000 unique commits in Git
  `--full-history --topo-order` traversal outside that snapshot, **without a path
  filter**. Thus commits changing other files, empty commits, and merge commits
  are eligible, not only commits that changed memory notes.
- Selection uses the inventoried object IDs rather than mutable ref names. The
  scanner verifies the inventory is unchanged before returning a report; a
  changed inventory makes the audit fail rather than return partial attribution.
  A SHA-256 of the ordered selected commit IDs identifies the exact bounded set.
  Reproduction requires the same local ref inventory and objects; a digest alone
  cannot restore deleted refs or objects.
- Inspect subject and body via Git's `%B` format. Message line numbers are
  one-based and include blank lines; LF and CRLF line boundaries are supported.
  Attribute each finding to every inventoried ref containing its commit,
  including branches, lightweight/annotated tags, remote-tracking refs, and other
  namespaces. No author identity, message text, or matched value is retained.
- Reuse the line-level host/image classifier from the current-note guard:
  private DNS suffixes (`internal`, `local`, `lan`, `corp`, `intranet`),
  private/link-local IPv4, private/link-local IPv6, and tagged or SHA-256-pinned
  images following the recognized `FROM`, `image`, or `container image` syntax.
  Mailing-address classification is intentionally not applied to messages.
- Emit only `ref commit message line N: category` for message findings. The
  returned audit object also contains metadata only. Git failures abort the CLI
  with a generic diagnostic instead of printing Git output or message content.


### Verification and failure ledger

| Check | Result |
| --- | --- |
| Focused history tests | PASS: 6 tests, including a branch-only message fixture touching no memory note, subject/body line metadata, snapshot exclusion, redaction of host/image values in object and CLI output, ref-kind attribution, and cap/omission behavior |
| Shared matcher tests and current-note guard | PASS: 5 tests and the current-note check; private IP variants, tagged/digest images, and benign examples remain covered |
| Scripts package typecheck | PASS: `pnpm --filter @workspace/scripts run typecheck` |
| Whitespace diff check | PASS: `git diff --check` |
| Browser, viewport, physical device, database, deployment, release checks | Not applicable: local read-only Git audit and synthetic temporary-repository tests only |

No concrete validation failures remain. Findings are metadata-only evidence,
not permission to rewrite history or change any service.

### Recorded commit-message result

- Capture: 2026-10-22 UTC, isolated development workspace, local Git objects only.
  Scanner: working-tree implementation based at
  `7eaa2da1fabde55556eaa5886d0cbc66fd23347c`; not a published-app assessment.
- Producing command: the `--refs-outside-snapshot` command above.
- Snapshot: `fbd58378021dba722a16440cd127c779db00bd77`.
- Inventory: 2,515 refs (2,270 branches, 9 tags, 234 remote-tracking refs,
  2 other refs); SHA-256
  `6ffef607d5783d33f8a22b038808b6b318696f2000214a0641597f335354b6e4`.
- Commit messages scanned: 2,000; limit: 2,000; additional commits omitted: **yes**.
- Ordered selected-commit SHA-256:
  `1bdb797757999d24ccac98a8609d46ca906ea529ae45ac0505e1749a939bf033`.
- Message findings: **none** under the reviewed host/image matcher.
- Disposition: no message finding in this bounded set indicates a resource action.
  Any future finding requires responsible-owner review before rotation,
  retirement, or other remediation. No owner decision was inferred, no external
  service was contacted, and no Git history was rewritten. Existing note-only
  mailing-address findings retain their separate owner-review disposition.

The cap is a deliberate bounded range, not exhaustive commit-message coverage.
This result excludes the remaining unselected commits, commits reachable from
the pinned snapshot, unreachable objects, reflog text, tag annotations, ref-name
contents, published copies, and external services. Public hosts and image syntax
not recognized by the matcher can also remain undetected. No clean-history claim
is made for these surfaces.
