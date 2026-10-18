# Web Push Dependency License Approval

Date: 2026-10-09
Scope: API server production dependency `web-push@3.6.7`

## Policy decision

**Approved for shipping under MPL-2.0.** The requestor confirmed the decision through the task decision form, whose approval choice represented explicit approval by an authorized policy/legal owner. The form response did not include the approver's identity or a separate approval-record reference; this evidence records the confirmation as provided and does not invent either.

Policy source: `attached_assets/check-licenses_1789337301268.md` requires an explicit policy decision for weak-copyleft dependencies.

This approval applies only to `web-push@3.6.7` in the API server. It is not a general approval for other MPL-2.0 dependencies or future versions.

## Current dependency and license inventory

The API server manifest and lockfile resolve `web-push` to version `3.6.7`. Its installed package metadata declares `MPL-2.0`.

Command:

```sh
pnpm --dir artifacts/api-server licenses list --prod --json
```

Result: 130 production dependencies inventoried:

| License | Packages |
| --- | ---: |
| Apache-2.0 | 8 |
| MIT | 102 |
| BSD-3-Clause | 12 |
| ISC | 7 |
| MPL-2.0 | 1 |

The sole MPL-2.0 package is `web-push@3.6.7`.

Production vulnerability audit:

```sh
pnpm run audit:prod
```

Result: passed — no known vulnerabilities found. This security audit is separate from the license-policy decision above.

## Push behavior verification

Command:

```sh
pnpm --filter @workspace/api-server exec vitest run src/lib/webPush.test.ts
```

Result: passed — 1 test file, 12 tests.

No dependency or lockfile change was made. Push implementation and package API use remain unchanged. These focused tests cover push-alert candidate and scheduling behavior; they do not make a live push-provider delivery. A dependency replacement was not needed after approval.
