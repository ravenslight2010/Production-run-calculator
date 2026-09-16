---
name: data-cleanup
description: "Clean and standardize messy tabular data such as CSVs, spreadsheet pastes, and system exports while preserving the original, surfacing ambiguity, accounting for every row, and producing a reviewable transformation log. Use when asked to clean data, standardize a CSV, deduplicate a list, normalize columns, or repair inconsistent tabular values. For imported customer/spec workbooks, route first through the project's import audit skills; if incorrect values are already persisted, also use data-heal-playbook."
---

# Data Cleanup

Standardize messy tabular data without silently changing what it means. Preserve the
source, declare every transformation, and surface ambiguous values instead of guessing.

## Route specialized project data first

Before using the generic workflow:

- For a newly imported customer workbook, use `customer-import-audit`.
- For a spec, premix, cheese, or shipping import defect, use
  `import-bug-investigation` and any importer-specific guard it requires, including
  `spec-import-guard` for the spec pipeline.
- If a defect has already written incorrect values to persistent storage, use
  `data-heal-playbook` as well. Fixing future writes does not repair existing data.

These project skills define the source of truth. This skill supplies general cleanup
discipline around them and must not bypass their evidence or approval requirements.

## Workflow

1. **Preserve and profile the source.** Never overwrite the original. Record row count,
   columns, detected types, missing-value counts, distinct-value anomalies, mixed date or
   unit formats, whitespace/casing inconsistencies, and candidate duplicates.
2. **Show the profile before editing.** For large datasets, show bounded samples and
   aggregate counts rather than dumping sensitive or excessive content.
3. **Propose the cleanup rules.** State the target format and type for each affected
   column, exact versus fuzzy duplicate keys, missing-value policy, and quarantine rules.
   Obtain confirmation before any meaning-changing merge, deletion, or imputation.
4. **Apply deterministic changes.** Normalize only under the confirmed rules. If a value
   is ambiguous—such as `02/03/24`, an unknown unit, or a possible identity match—stop
   and ask instead of guessing.
5. **Quarantine uncertain rows.** Keep unparseable or unresolved rows in a separate,
   reviewable output. Do not mangle or silently discard them.
6. **Deliver evidence.** Produce the cleaned dataset plus a transformation log containing
   per-column changes, duplicate groups and decisions, missing-value handling, quarantined
   rows, and all dropped rows with reasons.
7. **Verify accounting and meaning.** Spot-check normalized values and state the row
   equation explicitly:

   `input rows = output rows + dropped rows + quarantined rows`

   If rows were merged, report both the input rows consumed and output rows produced so
   the arithmetic remains auditable.

## Safety rules

- Never delete or merge rows without listing the affected records and reason.
- Never infer an ambiguous date, unit, identifier, or person/entity match.
- Never replace the original input; write to a new file, table, or explicitly approved
  version.
- Do not expose secrets or unnecessary personal data in samples or logs.
- Prefer an inspectable script for large transformations; do not make invisible bulk
  edits.
- Database mutations and one-time repairs require the relevant database and data-heal
  safeguards, not this generic workflow alone.
