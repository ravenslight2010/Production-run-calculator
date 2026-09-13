# External skill review report

Use this structure before installing files:

## Source

- Type and location:
- Ref or archive identity:
- Archive hash/comment, if applicable:
- Source binding verified for this request:
- Review date:
- Provenance:
- License evidence:

## Inventory

- Candidate skills with actual `SKILL.md` files:
- Manifest-only or missing implementations:
- Catalogs, applications, fixtures, translations, configs, and project exports:
- Scripts, assets, references, and special files:
- Archive safety result:
- Credential-like fields present (paths/types only; never values):

## Conflicts and ownership

- Existing matching names and roots:
- Proposed editable destination:
- Overwrite or ownership concerns:

## Compatibility map

| External behavior | Classification | Local equivalent or action |
|---|---|---|

Name every removed or unresolved provider-specific behavior.

## Recommendation

Choose one: **accept**, **adapt**, **defer**, or **reject**.

State:

- the reasons;
- required adaptations;
- omitted files or behavior;
- stop conditions;
- validation required after an approved installation.

For multi-source batches, include a disposition table with one row per archive/file and a
ranked shortlist of only the highest-value non-duplicative candidates.
Do not include a candidate in the shortlist unless its exact current-request source appears
in the inventory.

Do not describe an import as installed or validated when only a review was
performed.
