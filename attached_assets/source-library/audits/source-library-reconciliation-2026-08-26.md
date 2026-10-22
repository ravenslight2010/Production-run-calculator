# Source-library reconciliation

Snapshot captured: 2026-08-26T00:21:27.339Z
Manifest: def4f820d563eacd26499cbe043d2251d8c48a31993d36fc57553fa69ac0baf9

## Findings

- wrongQuantities: 0
- missingComponents: 25
- extraComponents: 47
- duplicateComponents: 4
- wrongNamesOrLinks: 22
- allZeroStubs: 3
- unmatchedSourceRecipes: 78
- unmatchedLiveRecipes: 125
- duplicateRecipes: 0

## Proposals

- automatic: 68
- ambiguous: 4

All proposals are bounded before→after records. They preserve IDs, history, and references; none authorizes deletion or writes to production.
All-zero stubs remain deletion candidates only after reference repoint and history-preservation checks.
