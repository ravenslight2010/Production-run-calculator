---
name: sauceBarrelBreakdown signature differs web vs mobile
description: Same-named helper has a different first-arg contract on web vs mobile; copying a web call site verbatim into mobile miscounts barrels.
---

`sauceBarrelBreakdown` exists in BOTH apps with the SAME name but a DIFFERENT first-argument contract:

- WEB (`artifacts/run-calculator/src/utils.ts`): `sauceBarrelBreakdown(sauceBatches, effBarrelLbs)` — first arg is already batches; `totalBarrels = ceil(sauceBatches / batchesPerBarrel)`.
- MOBILE (`artifacts/run-calculator-mobile/context/RunContext.tsx`): `sauceBarrelBreakdown(sauceLbs, effBarrelLbs)` — first arg is LBS; it divides internally (`batches = sauceLbs / effBarrelLbs`) then `ceil(batches / batchesPerBarrel)`.

**Why:** During UI-parity work a web call site (`sauceBarrelBreakdown(calc.sauceBatches, ...)`) was copied verbatim into mobile frontline, passing batches where lbs were expected → double-divide → barrel count collapsed toward 1.

**How to apply:** On MOBILE always pass `calc.sauceLbs` (see the correct caller in `sauce.tsx`). On WEB pass `calc.sauceBatches`. Do not assume same-named helpers across the two apps share a signature — verify the param before copying a call site between web and mobile.
