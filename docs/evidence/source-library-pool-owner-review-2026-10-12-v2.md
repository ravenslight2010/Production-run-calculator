# Owner review: fingerprint-bound intentional pool differences

Approval record date: 2026-10-12 UTC (2026-10-11 America/Chicago).

The app owner explicitly chose “Keep these exact current differences; no repairs” after reviewing the bounded finding of nine cheese-recipe brand differences and one Brand Cheese Mix component difference. This is a new approval, not an inference from the historical October 8 record. These are intentional differences; no data heal or production recipe write is authorized.

Exception ID: source-library-pool-owner-approved-differences-2026-10-08-v2

This approval binds the exact value fingerprints in the fresh production capture and diagnostic evidence below. The fresh diagnostic was checked against all ten fingerprints presented for approval; every fingerprint and descriptor was unchanged. Both captures use the published-app-runtime-connection and revision `source-sha256:f3736aad123bdf811562b02e42891c062d3123ff83fa97cdf96d060869bc6e23`.

- Diagnostics: docs/evidence/source-library-pool-diagnostics-2026-10-12-v2.json
- Diagnostics SHA-256: a1bac011c00e010e03ec33486d35091981c1aa88dcf0ff4a28d9b3e9508c65c5
- Diagnostics captured at: 2026-10-12T02:41:56.785Z
- Capture: docs/evidence/source-library-pool-live-capture-2026-10-12-v2.json
- Capture SHA-256: 1632929f70b8412b149662b11d3ed11539c5f800add6727833c4f4fe0387172b
- Capture captured at: 2026-10-12T02:41:57.723Z
- Approved source report SHA-256: 1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294

The captured pre-approval result remains failed evidence: 58 exact matches, 10 mismatches, no missing pools. It is retained unchanged as the reviewed baseline, not relabeled as a passing capture. A new runtime capture must apply this pinned exception and still satisfy all other reconciliation checks before retained release evidence can pass. Later value changes, new differences, missing rows, or report changes are not covered. The original v1 manifest and its evidence remain byte-for-byte untouched. No raw recipe values, credentials, or database records are retained.
