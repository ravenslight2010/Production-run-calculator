---
name: Account lifecycle sessions
description: Durable security rules for invitations, transitional signup codes, and revocable cookie/Bearer sessions.
---

New-format signed tokens are not sufficient by themselves: their server-side session row must exist and remain active. Only legacy tokens without a session identifier may use the compatibility path, and they remain subject to the persisted per-user revocation boundary. Cookie and Bearer authentication must pass the same absolute-expiry, idle, password-change, account-disable, explicit-revocation, and daily-reset fences.

**Why:** Stateless validity alone leaves stolen credentials usable after manager action and cannot enforce predictable shared-tablet idle behavior. Accepting a missing session row would also turn record deletion or failed persistence into an authentication bypass.

**How to apply:** Any path that issues a token must persist its session before returning it. Any password, account-status, or manager revocation path must invalidate affected sessions. Keep public rejection reasons non-enumerating and never include tokens, invitation secrets, signup codes, usernames, or personal data in logs or evidence.

Manager invitations are single-use, expire, are stored only as hashes, and carry an authorized role. Validate that the inviter can grant that role and apply the claimed role during acceptance. The transitional signup code may be rotated or disabled without affecting existing accounts.

**Why:** Storing a requested role without applying it silently weakens manager-controlled onboarding, while applying an unchecked role creates a privilege-escalation path.

**How to apply:** Return invitation and rotated-code secrets once in the creation response, accept them only in POST bodies, and expose only bounded status/counters afterward.