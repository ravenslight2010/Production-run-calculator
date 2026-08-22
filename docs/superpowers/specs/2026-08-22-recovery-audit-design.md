# Recovery audit design

## Goal

Make selective checkpoint recovery repeatable without changing application behavior or
automatically reverting code.

## Design

`scripts/recovery-manifest.json` is the checked-in source of truth for a focused set of
high-risk operational features. Each entry lists required files plus text evidence for
application wiring, API/schema contracts, and focused tests. An optional
`intentionalDifference` explains why the current implementation is valid when it differs
from the preserved checkpoint.

The scripts package owns a pure `auditManifest` function and a small CLI. The audit reads
only repository files, produces stable entry ordering and labels, supports human-readable
and JSON output, and returns failure only for unexplained missing evidence. It never
modifies the working tree.

## Verification

The fixture test exercises a complete entry, missing contract evidence, and an explicitly
documented intentional difference. The live command is suitable for local checks and can
be promoted to CI later.