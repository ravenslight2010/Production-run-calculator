# V2 research and planning bundle

**Prepared:** 2026-11-10  
**Inspected V1 checkout:** `dc6e5205f55fa74005373c6d7f06fae8df0f3399`  
**Purpose:** carry the relevant V1 evidence, approved V2 decisions, and open questions when `v2/` is copied to another project.

This bundle is a focused handoff, not a second app-wide audit, release decision,
or authorization to implement the roadmap. It reuses the V1-wide assessment
from the 2026-10-29 audit, updated through 2026-11-04, then checks selected V1
source and focused tests at the inspected 2026-11-10 checkout. Historical
browser, production, and test results remain bound to their own reported source
and environment.

## Start here

1. [V1-to-V2 reconciliation](v1-to-v2.md) — what the current V1 source and
   selected tests establish for each approved V2 launch capability.
2. [Gaps and evidence ledger](gaps.md) — unresolved, excluded, conflicting, or
   unavailable evidence, with status, owner, and next action.
3. [Prioritized roadmap](roadmap.md) — evidence-based sequencing and decision
   gates; recommendations do not change V2 authorization.
4. [Source catalog](source-catalog.md) and
   [machine-readable manifest](source-catalog.json) — provenance, lifecycle,
   authority, archive path, and SHA-256 for retained sources.
5. [Archive guide](archive/README.md) — exact source copies, task snapshots,
   and clearly marked link placeholders.

## Evidence vocabulary

Evidence labels and work lifecycle are separate:

- Evidence: `verified`, `partially verified`, `unsupported`,
  `stale-suspected`, `contradicted`, or `needs-human`.
- Lifecycle: owner-approved, implemented contract, active work,
  draft/proposal, archived/cancelled, experiment, external reference, or
  historical evidence.

“Verified” is limited to the exact claim, revision, and environment stated.
Current source presence is not a complete user journey; a unit test is not
production evidence; emulated browser evidence is not physical-device evidence.

## Portability and safety

- All authored bundle links are relative and stay within `v2/research/`.
- Archived repository documents are kept under a source-tree mirror. Source
  text is not rewritten; local links to documents intentionally not retained
  resolve to explicit placeholders, not fabricated evidence.
- Task snapshots preserve accessible record descriptions and capture state and
  timestamps as of 2026-11-10. They do not expose hidden conversations or imply
  that archived/cancelled proposals were approved.
- The broad V1 inventory JSON was not copied: it contains customer-source
  filenames and is metadata-only, dated to an older V1 revision. The V2
  catalog records this exclusion without retaining its candidate rows.
- Customer workbooks, recipe/specification rows, production records, secrets,
  credentials, sessions, and raw uploaded operational captures are not included.
- The V1 application, database, deployment, and production environment were not
  changed or queried for this package.

The source catalog records exact duplicates as aliases only when byte hashes
match. Similar titles, dates, and topics are not treated as proof of duplicate
content. See [validation results](validation.md) for hash, link, privacy, and
clean-copy checks.
