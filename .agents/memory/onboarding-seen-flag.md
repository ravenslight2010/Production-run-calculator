---
name: First-login "Get Started" overview onboarding flag
description: How the once-only welcome overview is gated and where the shared latch lives.
---
The first-login "Get Started" overview is gated by a server-side per-user flag
`users.onboardingSeen`. It auto-opens once when the server reports
`onboardingSeen === false`, never re-opens within the session after dismissal
(a `useRef` latch that holds even if `me` re-emits while still unseen, before
the seen flag round-trips), and is reopenable from the header menu. Dismissing
marks it seen.

**Single source of truth (parity):** the open/latch/dismiss logic is ONE shared
hook in lib `@workspace/onboarding`, consumed by both web and mobile (separate
artifacts that can't import each other, so shared React logic must live in
`lib/*`). Keep it shared — do not re-inline the latch into either app or they
drift.

**Why:** web and mobile previously duplicated the latch inline; centralizing it
is the only way to guarantee the once-only behavior stays identical across both.

**Lib gotcha:** a React-hook lib needs `react` in BOTH peerDependencies (for
consumers) AND devDependencies so it resolves standalone under `tsc --build`,
vitest, and metro — a pure peer dep alone fails to resolve `react` when the lib
is compiled/bundled in isolation.
