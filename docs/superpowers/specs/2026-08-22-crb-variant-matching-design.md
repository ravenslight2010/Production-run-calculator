# CRB variant matching design

## Goal

Keep all imported CRB weight/tray variants while only attaching customers to a
variant when the workbook or an already-saved profile provides one unique,
deterministic match.

## Decisions

- A generic customer assignment may populate a sole variant in its qualifier
  tier, but never several generic variants.
- A profile's stored doughball weight may tag a variant only when exactly one
  imported variant has that weight; duplicate weights stay unassigned.
- An empty exact-name dough stub is not authoritative over a family recipe
  with real components or doughball data. The profile link may move to that
  family only when the family match is deterministic and data-backed.
- Recipe component rows continue through the existing import and pool-upsert
  path unchanged; the change is limited to variant customer association and
  source selection.

## Verification

Unit coverage proves generic and qualifier-tier ambiguity remain unassigned,
explicit/singleton behavior remains available, and an exact zero-value CRB
stub cannot prevent a data-backed family hydration.