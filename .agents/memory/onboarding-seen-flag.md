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
