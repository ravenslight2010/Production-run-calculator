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

## Expo-web preview blank — FIXED (was a height race, not a Clerk issue)
The mobile artifact's **expo-web** preview used to render pure white. Root cause: react-native-web's `flex:1` tree measures against `#root`, which has no intrinsic height, and collapses to zero. Setting the height in a **useEffect** ran too late (after first measure) so it stayed blank. Fix: set `html/body/#root` height **synchronously at module-load** in `app/_layout.tsx` (guarded by `Platform.OS === "web"`, before React renders) **and** bake the same CSS into the HTML shell via `app/+html.tsx` (web-only). Now renders fine.

**How to apply:** For Expo-web blank screens, fix the root-height race at module scope or in `+html.tsx`, never in a `useEffect`. The expo-web preview is now a valid visual check for the mobile app; you no longer need to fall back to the web artifact for sign-in visuals. (CORS errors on `/api/*` from the expo dev origin are a separate, expected dev-only cross-origin quirk — not a blank-screen cause.)
