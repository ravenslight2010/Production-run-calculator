# Archive guide

## Layout

- `repo-mirror/` preserves selected source files at their original repository
  paths. Copied source bytes are unchanged.
- `task-records/` contains self-contained snapshots of accessible project
  task descriptions, with capture-time state and timestamps.
- Omitted local Markdown targets are represented by generated placeholder
  files in the same mirrored path. A placeholder states that the target was
  not archived; it is not supporting evidence.
- `../source-catalog.json` records original location, dates/revision where
  known, lifecycle, authority, provenance, source/copy hashes, duplicate aliases,
  and exclusions.

## How to read status

The 2026-10-08 Full Plan and 2026-10-16 decomposition roadmap are retained as
historical research inputs, not current approval. The 2026-10-29 V1 audit is
updated through 2026-11-04 and is not the inspected 2026-11-10 V1 revision.
The 2026-11-10 V2 architecture is the merged planning source, but it is not
proof of deployed V2 behavior. Task snapshots preserve their board state as of
2026-11-10 and do not make proposals binding.

The original broad inventory JSON, customer workbooks, recipe/specification
contents, raw production records, and raw operational uploads are not present.
Reasons and next actions are recorded in [the gap ledger](../gaps.md).
