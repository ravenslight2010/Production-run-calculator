# Production source-library pool review

## Owner decision

The production data owner chose **approve no correction** after reviewing the
current-versus-approved field differences. The owner commented: “Those was
proper corrections.” No data-heal was authorized. Production data was not
changed.

## Bounded evidence

- Live published-app diagnostic: `source-library-pool-mismatch-diagnostics-2026-10-08.json`
- Full allowlisted capture: `source-library-live-pool-capture-2026-10-08.json`
- Capture time: 2026-10-08 00:07:59 UTC
- Environment and attestation: release; published app's configured database
  connection (not an independent PostgreSQL owner-name check)
- Serving revision reported by the app: `source-sha256:876c19a1059bb44730c0da96b9e5812fccbd2d1de2a8113f7d5fa1811b78f71f`
- Approved report SHA-256: `1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294`
- Repair boundary: 2026-08-26 onward
- Pool result: 58 exact matches of 68 expected, 10 field mismatches, none missing
- All ten mismatches are cheese recipes: nine `brand` fields and one
  `components` field. Their stable IDs, approved names, and differing field
  names appear in the bounded diagnostic JSON.

The live app's reported source fingerprint matched the workspace's current
prepared-source fingerprint when captured. The bounded diagnostic response
and the read-only production-replica comparison agreed on all ten IDs and
differing fields. The replica is supplemental evidence; it does not independently
attest the published app's configured database or identify who made a write.

The previous source-heal marker was present and valid, with 46 replacements.
Read-only replica version checks showed all ten current rows were updated after
that marker. The intervening `recipe-customer-metadata-cleanup-v1` marker
reported zero cheese rows changed. The available evidence does not identify
the actor or operation for the later updates.

The current and approved field values were shown to the owner for this decision
but were not retained in the evidence files. No production source rows or
component values were retained. The aggregate capture is failed (`ok: false`)
because the ten pool mismatches remain; it is diagnostic evidence, not a
passing release reconciliation.

## Outcome

- No correction was approved; all ten current differences remain.
- No production mutation or code-based heal was attempted.
- The existing approved report and repair boundary remain unchanged.
- Any future correction requires a new owner review and a separate data-heal
  process; do not restore the August source values solely to clear this report.
