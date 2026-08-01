# Mobile App: Maintenance Mode

**Status:** Paused (as of 2026-07-06)

## What This Means
- The mobile app (`artifacts/run-calculator-mobile`) is **not actively developed**
- Focus is on the **web app** (`artifacts/run-calculator`)
- Mobile code receives **security updates only**
- **New features ship to web first**; mobile parity is suspended

## Why
The web app is the primary interface. Mobile development requires constant sync with web (formulas, UI, sync logic). Maintaining both in parallel is unsustainable; web-only strategy lets us move faster.

## If You Need Mobile
1. **To resume development:** See `../../.agents/memory/web-mobile-parity.md` for the sync/formula/UI contracts
2. **To report a bug:** Check if it affects the web app too; if so, fix web first
3. **For a specific feature:** Add it to web; mobile parity is future work

## Web App is Here
- **URL:** Ask your manager or see the deployment docs
- **Development:** `pnpm --filter @workspace/run-calculator run dev`
- **Issues:** GitHub Issues, labeled `web` or `mobile`

---

Questions? See the [full roadmap](../../ROADMAP.md).
