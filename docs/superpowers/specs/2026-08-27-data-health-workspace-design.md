# Data Health Workspace Design

## Goal

Give managers one coherent, read-first workspace for understanding and safely
repairing data problems without replacing the specialized setup, import, merge,
or audit workflows that remain the source of truth for ambiguous changes.

The existing Management tab is the canonical entry point. No new bottom
navigation tab is added.

## Finding model

The workspace response normalizes findings from the existing profile-health and
master-data-health scanners into a single list. Findings cover:

- profiles and profile links;
- dough, sauce, cheese, and mix recipe pools;
- ingredients;
- aliases;
- future scheduled runs;
- stale links and saved-import mismatches;
- cleanup history and unresolved import-review results when the existing source
  has them available.

Every finding has:

- a stable finding ID;
- category and severity (`info`, `warning`, or `error`);
- affected record details, including brand/flavor when applicable;
- a protected-value indicator;
- repairability (`safe` or `review`);
- a concise explanation and proposed action;
- a specialized destination for review-only work;
- an optional deterministic repair preview.

Duplicate names, missing identities, unsupported changes, and uncertain import
matches remain review-only. The system never performs fuzzy or inferred
repairs.

## Server architecture and repair safety

The existing report builders remain the scanners. A server-side workspace
orchestrator combines their results under the caller's current scope and the
existing manager capability boundary.

Safe repairs are selected explicitly by the manager. The server then:

1. re-scans inside one database transaction;
2. validates that each requested finding is still an eligible deterministic
   repair;
3. locks affected rows and verifies fingerprints/current values;
4. applies only unchanged, unprotected records;
5. preserves started and ended runs;
6. advances profile and future-run LWW stamps when a repair changes them;
7. records bounded before/after data needed for guarded undo;
8. writes an auditable batch result with IDs and counts, not payloads.

Alias cleanup is scope-bound and transactional. It retains enough prior row
data for an undo attempt, which is skipped if the row has changed or been
recreated. Existing tombstone and alias semantics are preserved. Manager-entered
values always win over automated cleanup unless the manager explicitly selects
an exact repair whose fingerprint still matches.

The API accepts only allow-listed finding IDs and repair actions. It uses
parameterized ORM operations and returns generic client-safe errors; structured
server logs include correlation/context and bounded counts but no recipe
payloads, secrets, or personal data. Report and repair work is bounded by the
existing scoped result set and does not invoke paid downstream services.

## Management UI

The current Management health/audit area becomes the canonical data-health
workspace. Specialized tools remain directly reachable:

- setup profiles for profile identity and recipe-link decisions;
- import review for saved-sheet or unresolved import decisions;
- merge tools for duplicate names and canonicalization;
- the audit log for historical event detail.

The workspace provides:

- summary counts for all findings, safe repairs, review-only findings, errors,
  and warnings;
- filters for category, severity, brand, and repairability;
- concise affected-record details;
- an explicit before/after preview for the selected safe repair set;
- confirmation before applying repairs;
- clear applied/skipped/failed outcomes;
- recent repair batches and guarded undo;
- review-only routing buttons that do not silently mutate data.

The layout is mobile-first: filters wrap, cards remain readable, and preview and
confirmation controls remain keyboard-operable at phone, tablet, and desktop
widths. Native controls, labels, focus indicators, text status, and announced
errors meet the app's existing accessibility baseline.

## Data flow and reload behavior

Opening the workspace performs an on-demand read and never mutates data. A
successful repair invalidates the workspace and affected profile/master-data
queries so the result is visible immediately. Reloading the Management tab
re-fetches current findings and repair history from the server. Undo follows the
same guarded transaction path and refreshes the workspace after completion.

Partial or failed reads show an explicit safe error state and do not present
stale data as a successful scan. A partially applied batch reports each bounded
outcome rather than claiming all requested repairs succeeded.

## Verification

Focused coverage will prove:

- normalization preserves category, severity, affected records, protection, and
  routing information;
- only selected deterministic repairs can be applied;
- capability and scope authorization hold for reads, repairs, and undo;
- fingerprints, LWW stamps, started-run protection, aliases, and tombstones are
  preserved;
- transactions and audit batches report applied/skipped/failed outcomes;
- changed records are skipped instead of overwritten;
- manager values are not cleaned up automatically.

Browser coverage will prove the Management entry point, filters, preview,
confirmation, review routing, apply/undo outcomes, reload persistence, and
phone/tablet/desktop usability. Existing specialized import, merge, setup, and
audit workflows remain covered by their own tests.

## Scope boundaries

This design does not add automatic fuzzy repair, replace specialized workflows,
perform a factory reset or broad purge, or introduce a new persistent findings
table. Existing specialized scanners and editors remain authoritative.