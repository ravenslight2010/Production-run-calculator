# Web-push registration rejection telemetry

The API emits the structured log event `web_push_registration_rejected` when
`POST /web-push/subscriptions` rejects a registration. The event contains only:

- `outcome`: always `rejected`
- `reason`: one of `invalid_subscription`, `invalid_endpoint`,
  `unsafe_endpoint`, `unsupported_provider`, `invalid_keys`,
  `invalid_expiration`, or `expired_subscription`
- `provider`: one of `google`, `mozilla`, `apple`, `other`, or `unknown`

Use event counts grouped by `reason` and `provider` to distinguish a provider
host-policy rejection (`reason=unsupported_provider`) from malformed or unsafe
registrations and unrelated route/server failures. The provider value is only a
coarse family classification based on the endpoint's domain; it does not confirm
that a particular endpoint is legitimate or approved.

The event deliberately excludes the hostname, full endpoint URL, endpoint path,
subscription keys, user ID, and request body. Do not add these values to logs or
metrics. A rise in `other` or a provider-family `unsupported_provider` count is
evidence to investigate, not automatic approval to expand the allowlist. Validate
any candidate provider independently before changing the supported host set.
