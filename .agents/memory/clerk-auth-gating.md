---
name: Clerk auth gating (web + mobile + API)
description: How sign-in gating is wired across the three artifacts and the auth-token transport split between web and mobile.
---

# Clerk auth gating across artifacts

The whole product is gated behind Clerk sign-in; staff use app-specific email/password accounts (Clerk dev instance in dev).

## Transport split (the key non-obvious thing)
- **Web** (`run-calculator`): authenticates via Clerk's **browser cookie** automatically — no token threading needed.
- **Mobile** (`run-calculator-mobile`): has no cookie jar, so it threads a Clerk **bearer token** explicitly. `setAuthTokenGetter(() => getToken())` is wired from the root layout based on `isSignedIn`; the generated API client (`lib/api-client-react` custom-fetch) and the raw SSE/REST transports (sync client, inventoryShared) all read that getter and attach `Authorization: Bearer`.

**Why:** SSE/REST on mobile bypass the generated client, so each transport must independently pick up the bearer or it 401s.

## Server gating
- `requireAuth` gates **all** `/api/*` except `/api/healthz` (public) and the Clerk proxy.
- Verify quickly: `/api/healthz`→200, any protected route (`/api/runs`, `/api/sync/today`)→401 when signed out.

## Expo-web preview is blank — this is a known native-first quirk
The mobile artifact's **expo-web** preview renders pure white even though: bundle compiles, Clerk loads, the sign-in screen mounts in the DOM, and no JS errors fire. It was blank in the very first captures too, before any auth changes. Forcing `#root`/body height (web-only effect in root layout) did **not** fix it. Native (Expo Go) is the real target and works.

**How to apply:** Do NOT rabbit-hole on the expo-web screenshot. Verify mobile auth via: typecheck + Clerk-loaded log + sign-in DOM mount + api-server 401 logs showing the running mobile app's sync calls rejected while signed out. Use the **web** artifact's preview for the visual sign-in check.
