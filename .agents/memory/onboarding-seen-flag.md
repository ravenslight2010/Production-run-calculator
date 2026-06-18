---
name: Onboarding "Get Started" overview
description: How the first-login app overview is gated and kept at web+mobile parity
---

The "Get Started" overview (what the app does + tabs/menu) auto-shows on a user's
first login and is reopenable from the header menu on both apps.

- **Gating is server-side, per-user:** `users.onboardingSeen` boolean (NOT device-local).
  Exposed through StaffMember and the `/me` payload; flipped by `POST /me/onboarding-seen`.
- **Auto-open once:** each app uses a `useRef` latch so the dialog/modal opens a single
  time when `me.onboardingSeen === false`, never re-triggering within a session.
- **Mark seen on dismiss only if still false** to avoid redundant writes when reopened
  manually from the menu.
- **Parity:** web `GetStartedDialog.tsx` (in home.tsx) and mobile `GetStartedModal.tsx`
  (in (tabs)/_layout.tsx) must keep identical copy/section structure; icons differ
  (lucide vs Feather) by platform.

**Why:** parity rule in replit.md; the flag must survive device changes so it lives on
the user record, not AsyncStorage/localStorage.

## Guided tour (revisit-only, no flag)

A separate multi-step "Guided Tour" (`GuidedTour.tsx` on both apps) walks through the
6 main tabs in sequence: as each step activates it switches the underlying tab (web
`onNavigate`→`setActiveTab`; mobile `onNavigate`→`router.push("/(tabs)/...")`) so the
real screen shows behind the step card. It is **opt-in only — never auto-shown**, so it
needs no server flag. Launch points (both apps, parity): a "Take a guided tour" button
in the Get Started overview footer, plus a "Guided Tour" header-menu item. Step copy
mirrors the Get Started TABS copy; keep web+mobile in sync.
