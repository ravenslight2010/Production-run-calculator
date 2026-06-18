---
name: Auth gating (web + mobile + API)
description: How sign-in gating is wired across the three artifacts and the auth-token transport split between web and mobile. Self-contained username+password (Clerk removed).
---

# Auth gating across artifacts

The whole product is gated behind sign-in. Auth is **self-contained username+password** (Clerk fully removed): `users` table (uuid id, unique username, scrypt passwordHash) + `user_roles` keyed by `userId`. First account created → `manager`, every later account → `operator`. Session token is an HMAC-SHA256 signed compact token (Node `crypto`), secret `AUTH_TOKEN_SECRET` || `SESSION_SECRET` fallback. Password hashing is `crypto.scrypt` + `timingSafeEqual` — no external auth dep.

Auth endpoints live in OpenAPI for codegen: `/auth/sign-up`, `/auth/sign-in`, `/auth/sign-out`, `/auth/change-password`. Generated zod body names are capitalized: `SignUpBody`, `SignInBody`, `ChangePasswordBody`. `StaffMember` shape is UNCHANGED `{userId, role, email, name}` — set `name = username`, `email = null`, so both roster UIs + OpenAPI stayed untouched.

**Orval name collision gotcha:** the request-body schema in `components/schemas` must NOT share a name with the operation's generated zod body (`<operationId>Body`), or `lib/api-zod` re-exports the same name from both `generated/types` and `generated/api` → TS2308. That's why sign-up/in use schema `AuthCredentials` (→ zod `SignUpBody`), and change-password uses schema `ChangePasswordCredentials` (→ zod `ChangePasswordBody`).

**change-password gating:** the auth router is mounted publicly (before the global `requireAuth`), so `/auth/change-password` applies `requireAuth` **inline** as per-route middleware. It verifies `currentPassword` against the stored hash, then `updateUserPassword` rewrites the scrypt hash. Session is NOT rotated (token still valid). UI lives in the InventoryTab settings area (any signed-in user), next to the manager-only StaffRolesCard, on both web + mobile.

## Transport split (the key non-obvious thing)
- **Web** (`run-calculator`): authenticates via an **httpOnly cookie `rc_auth`** set by the server on sign-up/in; same-origin requests send it automatically — no token threading. Web client uses raw fetch by design (not generated hooks).
- **Mobile** (`run-calculator-mobile`): has no cookie jar, so it threads a **bearer token** explicitly. Token is returned in the sign-up/in JSON body, stored in `expo-secure-store` (key `rc_auth_token`), and exposed via `setAuthTokenGetter`. The generated API client and the raw SSE/REST transports (sync client, inventoryShared, aiOptimize) all read that getter and attach `Authorization: Bearer`.

**Why:** SSE/REST on mobile bypass the generated client, so each transport must independently pick up the bearer or it 401s.

## Server gating
- `requireAuth` (verifies token from `Authorization: Bearer` OR `rc_auth` cookie) gates **all** `/api/*` except `/api/healthz` and the public `/api/auth/*` router.
- Role gating (`requireRole("manager")`) is on the SAME endpoints as before (item CRUD, AI photo, settings, staff admin). NEVER gate `/sync` day-state by role — breaks parity.
- Verify quickly: `/api/healthz`→200; protected route signed out→401; operator hitting a manager-only route (`/api/users`)→403; wrong password→401; duplicate username→409; sign-out→204.

## Expo-web preview blank — FIXED (height race, not an auth issue)
react-native-web's `flex:1` tree measures against `#root`, which has no intrinsic height, and collapses to zero. Setting height in a `useEffect` runs too late. Fix: set `html/body/#root` height **synchronously at module-load** in `app/_layout.tsx` (guarded by `Platform.OS === "web"`) **and** bake the same CSS into `app/+html.tsx`. **How to apply:** fix root-height race at module scope or `+html.tsx`, never in a `useEffect`.

## Expo-web preview signed-in data (CORS + SSE) — FIXED
The expo-web preview is served cross-origin from `*.expo.worf.replit.dev` calling the API at `*.worf.replit.dev/api/*` (native is unaffected — no CORS, bearer via header):
- **CORS** (`api-server/src/app.ts`): origin is an allowlist function, not blanket `origin:true`. Reflects configured `REPLIT_DOMAINS` always; reflects localhost + `*.replit.dev` only when `NODE_ENV !== "production"`. No-Origin requests (native/curl) always pass.
- **SSE auth on web**: the browser `EventSource` cannot set an `Authorization` header, so it appends the token as `?token=`. The server promotes `?token=` → `Authorization: Bearer` in a middleware that runs **before** auth, gated to `NODE_ENV !== "production"` only.

**Why:** EventSource has no header API; same-origin web uses cookies and is unaffected. **How to apply:** keep token-in-URL acceptance dev-only; never blanket-reflect CORS origins.
