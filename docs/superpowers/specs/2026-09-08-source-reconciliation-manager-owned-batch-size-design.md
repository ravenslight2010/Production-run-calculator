# Source reconciliation manager-owned batch size design

## Goal

Keep source-library reconciliation verification fail-closed for the approved
recipe, link, alias, reference, marker, and stub invariants without treating an
authorized post-heal mix batch-size edit as an incomplete repair.

## Ownership boundary

The immutable v1 repair continues to initialize `mixes.batchSize` from the
approved source when it first runs. After that transaction, batch size is a
manager-owned operational setting: the manager-facing mix editor and setup
conflict-resolution flow may update it.

Post-heal verification therefore compares mix components, brand, flavor,
days-early, and source-owned notes, but not batch size. The repair definition,
plan fingerprint, marker contract, and production data remain unchanged.

## Failure behavior

Missing or renamed pool rows still produce findings. Any drift in source-owned
mix fields, including components, still fails the release verifier and remains
visible in Data Health. Alias, profile, pending-run, protected-history, stub,
and marker checks are unaffected.

## Regression coverage

The read-only release verifier must pass when only a mix batch size differs and
must still fail when the same row's components differ. Data Health integration
coverage must likewise ignore post-heal batch-size drift while retaining all
other reconciliation findings.