---
name: Supervisor PIN vs server role
description: How the local supervisor PIN gate relates to the server manager/operator role, and the manager-bypass rule.
---

# Supervisor PIN vs server role (two independent layers)

There are TWO access layers that are easy to confuse:

1. **Server role** (`useMe()` → `isManager`, role `manager` | `operator`, from `/api/me`).
   Follows the *account* across devices. Gates server-authorized features:
   inventory/ledger writes, staff management, AI recommendations, incident
   review. The first account ever created is auto-bootstrapped as `manager`.

2. **Supervisor PIN** — a *local, per-device* lock (web: `localStorage`
   `SUPERVISOR_PIN_KEY`, default `1234`; mobile: `supervisorPin` in RunContext /
   AsyncStorage, default in `DEFAULT_SUPERVISOR_PIN`). Validated entirely
   client-side. Gates *run-configuration editing* and *master-data creation* on
   a shared, logged-in floor device. Web exposes it as the Operator/Supervisor
   header badge toggle (`role`/`isSupervisor` local state); mobile as a lock
   screen on the Configure tab plus the Excel-import "create brand/flavor" chips.

**Rule (decided):** a **manager bypasses the PIN automatically** — they never
type it. Operators still need it. Implemented as:
- Web: `isSupervisor = isManager || role === "supervisor"` (all web gates key off
  `isSupervisor`); the header badge toggle no-ops for managers.
- Mobile: every PIN gate is `supervisorPin && !unlocked && !isManager` (Configure
  lock screen, Excel-import create chips + its inline PIN prompt).

**Why:** mixed usage — some staff use individual logins, some share a tablet that
stays logged in. The PIN still protects a shared operator session; managers
shouldn't be slowed by a second secret they already out-rank.

**How to apply:** any NEW PIN-gated surface must also OR in `isManager`, on BOTH
apps, to keep parity. `master-data.tsx` (mobile) has no lock gate — it only
displays/changes the PIN — so it needs no bypass.
