# Per-pizza advisory import review

## Approved product decision

The manager selected 16 oz per pizza for each of sauce, applicator, and pepperoni
weight after rejecting a proposed 32 oz applicator limit. Dough is the heaviest
component and its largest observed amount has been 16 oz. Warn strictly above 16,
not at equality. This is an advisory review threshold, not a validated food-safety
or production specification.

## Design and boundaries

A shared pure helper derives messages from each profile's current ounce fields.
It has a separate package entry so the parser/sanitizer entry remains unchanged
and the existing parse-version safeguard does not require a needless cache reset.
The responsive import dialog displays a separate, clearly labeled advisory
callout on both review steps and beside each affected profile. Each message
identifies the field/station, original numeric value, ounce unit, and threshold.
The existing inclusion controls and Apply action remain authoritative.

Derive warnings at review time rather than persisting them into sanitizer output:
saved parses and cross-filled sauce values must receive current warnings too.
No parse/model/prompt/cache version change is needed. No API/schema changes,
number clamping, conversions, aggregate-station limit, dough-weight limit,
stick-count limit, batch-weight changes, or stored-data repair are authorized.

## Verification

Pure tests cover normal values, equality, just above the boundary, extreme finite
inputs, individual fields/stations, absent legacy fields, and nonmutation.
Rendered dialog assertions cover both steps, saved-review reuse, cross-fill,
name changes, exclusion, and unchanged Apply payloads including recipe units.
Run the full shared-library and deterministic corpus regressions, focused client
tests, and applicable typechecks. Record component evidence separately from
responsive/browser/physical-device checks.

## Ordering

A complete live inventory contained five accepted unfinished tasks with no
truncation. All ten recorded prerequisites were merged. The owner attested that
this task was accepted before the other four unfinished tasks; no ordering
exception or task dependency mutation was used. This is an advisory startup
check, not proof of platform scheduling enforcement.