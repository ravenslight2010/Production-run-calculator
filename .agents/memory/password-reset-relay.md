---
name: Password reset (manager-approval relay)
description: How the no-email forgot-password flow works and its parity/security constraints.
---
Self-contained username+password auth has no email/SMS, so password reset uses a
manager-approval relay: signed-out user requests reset → manager approves and is
shown a ONE-TIME code once → user enters code + new password.

**Enumeration safety:** `/auth/forgot-password` ALWAYS returns `{ok:true}` whether
or not the username exists. The UI must advance to the code-entry step regardless;
never branch UI on whether the account was found.

**Probe-path exemption (gotcha):** `/auth/reset-password` returns 401 for a
wrong/expired/used code. Both clients exempt `/auth/*` from the global
`onUnauthorized` bounce (see `isSessionProbePath`), so that 401 shows inline
instead of logging the requester out. Keep new public auth endpoints under
`/auth/` or they'll trigger a session bounce.

**Code:** single-use, TTL-limited; verification normalizes (strip spaces/dashes,
uppercase) so case/format don't matter. Manager list endpoint is requireRole
("manager")-gated; the request/reset endpoints are public (before the auth gate).

**Decline + auto-expire:** managers can also decline a pending request (status
`"declined"`, no code issued) via `POST /password-reset-requests/{id}/decline`
(204). `status` is plain text — adding new statuses needs no migration. The
manager pending list also auto-drops requests older than `PENDING_REQUEST_TTL_MS`
(7d). Decline guarded on status `"pending"` so it can't race approve/used.

**Parity:** web + mobile must match — client helpers in each `inventoryShared`,
a 3-step forgot-password screen, and the manager approve/decline + show-code UI
in `StaffRolesCard`. React Query key `["passwordResetRequests"]`, polled.
