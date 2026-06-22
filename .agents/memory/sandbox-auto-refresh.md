---
name: Sandbox auto-refresh on staleness
description: How the seeded sandbox account re-copies from live on stale login, and why it's client-driven not server-driven.
---

# Sandbox auto-refresh

The sandbox data scope (used by the seeded sandbox account) re-copies from
live automatically when its last copy is stale, and the banner shows
"Sandbox — copied from live at …".

## Design (client-driven, NOT server auto-reset)
- Server only **reports** staleness; it never auto-resets inside `/me`.
  - `sandbox_meta` singleton table (`id=1`, `copiedAt`) records the last copy time;
    `resetSandbox()` upserts `copiedAt=now` at the end of its transaction.
  - `getSandboxCopiedAt()` / `isSandboxCopyStale()` live in api-server `lib/sandbox.ts`;
    cutoff `SANDBOX_STALE_MS` (24h) is owned server-side so web/mobile can't drift.
  - `StaffMember` gains `sandboxCopiedAt: string|null` + `sandboxStale: boolean`;
    `getStaffMember()` only reads copiedAt when the user IS the sandbox account.
    `copiedAt=null` ⇒ stale ⇒ first sandbox login auto-populates from live.
- Client reacts to `me.sandboxStale` by running the **existing manual reset flow**
  (web: resetSandboxRequest → reload; mobile: resetSandboxRequest →
  clearLocalStateForSandboxReset → reloadAppAsync), guarded by a once-per-mount ref.

**Why client-driven:** a server auto-reset on `/me` would (a) wipe mid-session and
(b) get re-polluted by the additive live-sync merge. Firing the client reset once
per mount sidesteps both.

**Why getSandboxCopiedAt is try/catch → null:** keeps non-sandbox `/me` and all
integration tests safe even if `sandbox_meta` doesn't exist yet on a fresh DB.

## Parity
Hard web+mobile parity (replit.md): web `home.tsx` (`fmtSandboxCopiedAt`,
auto-stale effect w/ `autoSandboxResetRef`, banner timestamp); mobile
`(tabs)/_layout.tsx` (`runSandboxReset` factored out, auto-stale effect) +
`components/SandboxBanner.tsx` (`copiedAt` prop + `fmtCopiedAt`).
