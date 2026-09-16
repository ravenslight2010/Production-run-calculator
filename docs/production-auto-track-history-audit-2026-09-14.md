# Production Auto-Track History Audit

## Decision

**Status: three persisted applicator progress series need separately reviewed
reconciliation; no production mutation was performed.**

The read-only production audit found no final canonical zeroing of Sauce,
Packaging, or applicator progress. It did find three ended-run applicator
series whose last accepted value has the exact premature-cap signature of the
retired remaining-work calculation:

- September 10, 2026: two App 1 series
- September 10, 2026: one App 3 series

These counters remained below the corrected lifetime cap after Packaging had
advanced, so they cannot be treated as complete auto-tracked production
history without reconciliation. The audit does not infer replacement values:
planned cases are not sufficient evidence that every planned case or batch was
actually produced.

## Evidence classification and scope

- Capture time: September 14, 2026 (UTC)
- Environment: production PostgreSQL read replica
- Application revision: unknown; database evidence was not used to infer it
- Data class: production operational
- Audience: internal engineering and production-data reviewers
- Scope: `live` rows with auto-track claims, September 10–14, 2026
- Producing flow: parameterized, read-only aggregate SQL
- Sanitization: no actor, device, run, customer, recipe, payload, credential,
  connection, or personal identifiers retained

The production ledger contained 835 auto-track claims on three dates:
September 10, September 11, and September 14. Queries projected only bounded
counts, dates, channel names, outcomes, mutation field names, and derived
invariant results.

## Findings

### Applicator premature caps

The old implementation capped cumulative applicator batches using a
remaining-work requirement that shrank as Packaging progressed. The repaired
implementation uses a lifetime run requirement.

For each applicator series, the audit compared the last accepted count with:

1. the old remaining-work cap at that accepted snapshot;
2. the corrected lifetime cap from cases needed, pizzas per case, ounces per
   pizza, and effective recipe/batch pounds; and
3. Packaging progress at that snapshot.

Three series met all of these conditions:

- count reached the old remaining-work cap;
- count remained below the corrected lifetime cap; and
- Packaging had not yet reached the run's requested cases.

This is strong evidence that automatic progress stopped prematurely. The
stored count may understate actual applicator batches made, but production
evidence does not provide a deterministic replacement.

### Impossible zero transitions

- No final App 1–4 batch count was zero or below its last positive accepted
  claim.
- No final skid count was zero or below its last positive accepted claim.
- Two stale, rejected applicator claims observed zero-valued snapshots. Both
  recovered on the next claim within three seconds. Because the claims were
  stale, they did not write those values.
- One Packaging ledger snapshot moved from a prior positive skid view to zero
  before a zero-to-zero accepted claim. The final day snapshot later contained
  positive skid progress. The accepted claim did not perform the reset, and
  the persisted end state recovered.

The transient zero observations are therefore not final canonical corruption.
The Packaging episode remains useful incident evidence, but it does not define
a historical repair target.

### Sauce progress

The ledger contained one Sauce claim. It was stale, occurred against an
already-ended run snapshot, and preserved an existing positive Sauce count.
There was no accepted Sauce mutation and no zero transition. This is a
display/retry symptom, not persisted Sauce corruption.

### Packaging progress

- Thirteen ended runs had accepted Packaging claims.
- None ended with zero Packaging progress after those claims.
- Final Packaging values did not regress below the last accepted values.
- Nine ended snapshots were below requested cases. That fact alone is not
  corruption: runs may end below plan, and Packaging can drain after the line
  ends. There is no safe deterministic basis to replace those values.

No completed-run-history rows existed for the bounded dates. Conclusions are
therefore limited to the retained daily snapshots and coordination ledger.

## Separately reviewed data-heal plan

This is a plan only. It must not be implemented or published without a separate
production-data review.

### Diagnosis

The retired applicator cap used remaining work for a cumulative made counter.
The known-bad predicate is the three-part premature-cap signature above.

### Affected-row scope

- Table: `daily_sync`
- Scope: `live`
- Date: September 10, 2026
- Candidate series: two App 1 counters and one App 3 counter
- Exclusions: every other date, Sauce, Packaging, other applicator slots,
  manager-corrected values, and any series lacking independent source evidence

Before approval, identify the three candidate run references in a
restricted-review output and reconcile them against an authoritative source
such as signed/finalized production records or verified ingredient
consumption. Do not retain recipe or customer payloads.

### Repair rule

No deterministic repair rule is currently approved. Do not set the counters
to the lifetime cap merely because cases were planned. If authoritative
evidence proves an exact made count, update only a candidate whose stored value
still matches the audited value and whose correction generation has not
advanced. Otherwise leave it unchanged and record it for manager review.

### One-time execution and idempotency

If exact replacements are approved, implement a new one-time server heal:

- claim a fresh stable marker before writes;
- use one transaction and lock only the September 10 live row;
- require the full candidate predicate plus unchanged audited values;
- advance the affected run-value stamp monotonically; and
- make a second execution produce zero changes.

### Rollback posture

Retain only candidate hashes, exact before/after numeric fields, the row stamp,
and the heal marker in restricted evidence. Reversal must restore only those
reviewed fields and use a newer monotonic stamp. Do not copy or retain whole
day snapshots.

### Verification

Before publish, prove in development that:

- only the approved candidate fields change;
- manager corrections and unrelated run fields remain unchanged;
- the target predicate becomes zero;
- run-value stamps advance; and
- restart/retry applies no second change.

After publish, use the read-only production procedure to verify the marker,
changed count, exact values, stamps, and exclusions. Record “not verified” if
production evidence is unavailable.

## Unresolved boundary

The audit proves premature automatic stopping, not the exact number of
physical batches made afterward. A repair is blocked until an authoritative
production source can establish exact replacement values without guessing.

## Restricted reconciliation review

### Review disposition

**Status: production remains unchanged; all three series require manager
review because no exact replacement value is proven.**

A follow-up read-only review on September 14, 2026 identified the three
candidate series with pseudonymous references and projected only the slot,
stored count, correction generation, accepted automatic sequence, and bounded
source-presence counts:

| Candidate reference | Slot | Stored count | Correction generation | Last accepted sequence |
| --- | --- | ---: | ---: | ---: |
| `135707dfdb22ed2167290f960d6d833c` | App 1 | 3 | 0 | 3 |
| `3f2fc5c6871abec850c8fe9215ae0e06` | App 1 | 6 | 0 | 6 |
| `5b97e32987c0600a278a91bae9f3cc10` | App 3 | 3 | 0 | 3 |

These references are one-way database-generated pseudonyms used only to
distinguish the candidates. They are not evidence of source integrity and do
not reveal run, customer, recipe, actor, or device identifiers.

### Manager-change exclusion

The review also found one other App 1 automatic series on September 10. It was
excluded because its stored count was 16 while its last accepted automatic
sequence was 15. That mismatch means the current row no longer matches the
audited automatic state and may reflect a later correction or change. Its
reference and business data were not retained.

All three retained candidates still had correction generation zero and stored
count equal to the last accepted automatic sequence at review time. This
establishes that they remained unchanged candidates; it does not establish how
many physical batches were ultimately made.

### Authoritative-source comparison

For each candidate, the review checked the production sources available in the
application database:

- `completed_run_history`: zero matching finalized rows;
- `inventory_ledger`: zero matching run-linked entries; and
- `finalized_operational_reports`: zero reports covering September 10, 2026.

The inventory system records no applicator-batch-specific consumption source
for these runs. Planned cases and the corrected lifetime cap remain estimates
of required production, not proof of physical output.

### Decision

No exact target count can be established from authoritative retained evidence.
Therefore:

- no data-heal marker or repair code was added;
- no run value or run-value stamp was changed;
- the three pseudonymous candidates remain queued for manager review; and
- any future correction must supply an independently verified exact batch count
  for the specific candidate and re-check that its stored count and correction
  generation have not changed.

If that evidence is supplied later, the repair must follow the one-time,
idempotent, monotonic-stamp plan above. Setting any candidate to its planned
lifetime cap without that evidence would be a guess.

### Evidence handling

- Capture: September 14, 2026, production PostgreSQL read replica
- Application revision: unknown
- Producing flow: parameterized, read-only SQL against bounded rows and sources
- Sanitization: no raw identifiers, names, payloads, recipes, actors, devices,
  credentials, or personal data retained
- Unresolved gap: exact physical applicator batch totals are unavailable
