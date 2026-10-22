# Source and adaptation

- Reviewed source: user-uploaded
  `attached_assets/drizzle-best-practices_1792704783256.zip`.
- Archive SHA-256:
  `c20fd00f053977e077b834905766e9913acc47c829ecd716e13b321cc9910ea0`.
- Duplicate source:
  `attached_assets/drizzle-best-practices(1)_1792704783277.zip`,
  with the same archive hash; not installed a second time.
- Review date: 2026-10-22.
- Archive comment: empty. No upstream repository/revision was independently
  authenticated. The archive supplies the actual implementation and an MIT
  license, preserved in `LICENSE`; its metadata identifies the guide author
  as Marc A. Maceira Zayas.
- User authorization: install missing skills if safe, after the preliminary
  inventory. Disposition: **adapt**, not an unmodified upstream installation.

## Reviewed and adapted material

The source `SKILL.md` plus these references informed the focused adaptation:
query-select-patterns, query-mutations, query-error-handling,
perf-batch-operations and types-inference.

Portable query projection, nullability, runtime decoding, transactional
mutation and inferred-type guidance was retained and qualified for the actual
project. The resulting examples are adapted, not verbatim upstream references.

## Removed or corrected assumptions

- Removed default-to-v1-RC behavior, installation commands, release-tag claims,
  automatic driver/provider setup and assumed relational API syntax.
- Removed standalone migration commands; project schema checklists and Replit
  Publish remain authoritative.
- Removed implied permission to standardize existing ID generators.
- Replaced generic raw database-error logging with project-safe error routing.
- Qualified aggregate Number conversion with runtime/domain checks.
- Removed categorical claims that SQL joins are wrong for related records.
- Added scope, version, acknowledgement, idempotency and rollback requirements.

No archive scripts, package manifests, fixture dependencies, upstream
AGENTS.md/CLAUDE.md, provider metadata or unreviewed reference files were copied
or executed. No database, application dependency, workflow or deployment
configuration was changed by this import.

## Validation boundary

Validate metadata with the project quick validator and skill catalog. The
reference's five evaluation cases support bounded content checks; they do not
establish a measured model-trigger or model-quality improvement. An open chat
may retain its earlier registry; do not claim live registration merely because
the files exist.
