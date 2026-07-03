---
name: Sandbox scope isolation boundaries
description: What is and isn't scope-isolated for the seeded sandbox account; use before adding new manager-gated or global-table routes.
---

The seeded sandbox account (a well-known demo login seeded in
`artifacts/api-server/src/lib/sandbox.ts`) is a non-production demo
shortcut, not a real tenant boundary:

- `sandboxAllowed()` (`artifacts/api-server/src/lib/sandbox.ts`) gates it to
  `NODE_ENV !== "production"`. It's checked at seed time (index.ts), at
  sign-in (routes/auth.ts rejects any `user.sandbox` row when not allowed),
  and again at `/sandbox/reset` (defense in depth) — so a lingering sandbox
  row can never be used once an env flips to production.
- The sandbox account is always granted the `manager` role so every
  manager-gated FEATURE is reachable for testing. But some tables are
  genuinely global with no per-scope column (`users`, `user_roles`, `roles`,
  password-reset requests) — capability alone isn't a safe gate there.
  `requireLiveScope` (middlewares/requireCapability.ts) 403s a sandbox-scoped
  session before it reaches those routes; apply it to any NEW route that
  touches those tables, ahead of `requireCapability`.
- Most other domain tables (production_rules, incidents, inventory, etc.) DO
  carry a `scope` text column defaulting `"live"`, stamped via
  `currentScope()` on write and filtered on every read. Adding a new
  manager/global-ish feature? Default to giving it a `scope` column and
  filtering by `currentScope()` rather than reaching for `requireLiveScope` —
  that's the pattern used everywhere else and keeps sandbox testing possible
  for the feature itself.
