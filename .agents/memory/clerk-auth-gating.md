---
name: Auth gating (web + mobile + API)
description: How sign-in gating is wired across the three artifacts and the auth-token transport split between web and mobile. Self-contained username+password (Clerk removed).
---

# Auth gating across artifacts

The whole product is gated behind sign-in. Auth is **self-contained username+password** (Clerk fully removed): `users` table (uuid id, unique username, scrypt passwordHash) + `user_roles` keyed by `userId`. First account created → `manager`, every later account → `operator`. Session token is an HMAC-SHA256 signed compact token (Node `crypto`), secret `AUTH_TOKEN_SECRET` || `SESSION_SECRET` fallback. Password hashing is `crypto.scrypt` + `timingSafeEqual` — no external auth dep.

Auth endpoints live in OpenAPI for codegen: `/auth/sign-up`, `/auth/sign-in`, `/auth/sign-out`, `/auth/change-password`. Generated zod body names are capitalized: `SignUpBody`, `SignInBody`, `ChangePasswordBody`. `StaffMember` shape is UNCHANGED `{userId, role, email, name}` — set `name = username`, `email = null`, so both roster UIs + OpenAPI stayed untouched.

**Orval name collision gotcha:** the request-body schema in `components/schemas` must NOT share a name with the operation's generated zod body (`<operationId>Body`), or `lib/api-zod` re-exports the same name from both `generated/types` and `generated/api` → TS2308. That's why sign-up/in use schema `AuthCredentials` (→ zod `SignUpBody`), and change-password uses schema `ChangePasswordCredentials` (→ zod `ChangePasswordBody`).

**change-password gating:** the auth router is mounted publicly (before the global `requireAuth`), so `/auth/change-password` applies `requireAuth` **inline** as per-route middleware. It verifies `currentPassword` against the stored hash, then `updateUserPassword` rewrites the scrypt hash. Session is NOT rotated (token still valid). UI lives in the InventoryTab settings area (any signed-in user), next to the manager-only StaffRolesCard.

## Current and historical transport behavior
- **Web** (`run-calculator`): authenticates via an **httpOnly cookie `rc_auth`** set by the server on sign-up/in; same-origin requests send it automatically — no token threading. Web client uses raw fetch by design (not generated hooks).
- **Historical mobile client** (`run-calculator-mobile`): the old Expo app used explicit bearer headers, but it is archived and is not a maintained product target. Do not use it as a reason to retain server auth exceptions.

**Why:** the product is now maintained as one responsive web app; the old mobile transport notes describe an archived client.

## Server gating
- `requireAuth` (verifies token from `Authorization: Bearer` OR `rc_auth` cookie) gates **all** `/api/*` except `/api/healthz` and the public `/api/auth/*` router.
- Role gating (`requireRole("manager")`) is on the SAME endpoints as before (item CRUD, AI photo, settings, staff admin). NEVER gate `/sync` day-state by role — breaks parity.
- Verify quickly: `/api/healthz`→200; protected route signed out→401; operator hitting a manager-only route (`/api/users`)→403; wrong password→401; duplicate username→409; sign-out→204.

## Historical Expo-web preview layout
The old Expo web preview required root-height styles to render its React Native web tree. That client is archived and is not a maintained product target.

**Why:** the product is maintained as a responsive web app; old Expo implementation notes can send changes into an unsupported client.

**How to apply:** follow the web-only product boundary. Do not modify or restore archived Expo sources to fix current web UI.

## Retired Expo-web preview
An earlier Expo web preview used the cross-origin `*.expo.worf.replit.dev` origin. No maintained client in the repository uses that path; current web EventSource callers use relative same-origin `/api/...` URLs. Development query-token promotion has been removed. The general development CORS policy remains unchanged.

**Why:** retaining credentials in URL query strings is not justified without a maintained caller, and the web-only product boundary supersedes the old Expo preview note.

**How to apply:** do not restore query-token authentication for an archived client. If a supported cross-origin browser client is introduced later, design its authentication transport explicitly and keep credentials out of URLs where possible.
