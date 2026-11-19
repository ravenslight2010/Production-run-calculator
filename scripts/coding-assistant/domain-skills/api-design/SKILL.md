---
name: api-design
description: "Design and review this project's HTTP APIs, including resource naming, methods, status codes, validation, authorization, pagination, rate limits, error responses, OpenAPI updates, and generated-client compatibility. Use when adding or changing an API endpoint or reviewing an API contract."
---

# API Design

Design APIs as contracts shared by the server, generated clients, validators, and users.
Follow existing repository conventions before applying generic REST preferences.

## Start with the existing contract

1. Inspect nearby routes and the relevant entries in `lib/api-spec/openapi.yaml`.
2. Identify callers, authentication and capability requirements, scope boundaries, and
   persistence effects.
3. Preserve compatibility unless the user explicitly approves a breaking change.
4. Do not introduce a version prefix, response wrapper, naming convention, or auth pattern
   merely because it is common elsewhere.

## Contract rules

- Model resources with clear, consistent paths. Use action endpoints only when the
  operation does not map cleanly to resource creation or mutation.
- Match HTTP methods to semantics. Treat safety and idempotency as behavioral guarantees,
  not labels.
- Return meaningful status codes:
  - `200` for successful reads or updates with a body.
  - `201` for successful creation.
  - `204` only when no response body is needed.
  - `400` for malformed or invalid requests under the existing contract.
  - `401` for missing or invalid authentication.
  - `403` for authenticated callers lacking permission or scope.
  - `404` for unavailable resources where that does not leak protected information.
  - `409` for duplicate or stale-state conflicts.
  - `413` for payloads rejected by transport or body-size limits.
  - `429` for rate limits, with `Retry-After` when practical.
  - `500` for unexpected server failures without internal details.
  - `503` for temporary unavailability, with retry guidance where appropriate.
- Validate path, query, header, and body inputs before expensive work.
- Bound collections with pagination or explicit maximum result sizes.
- Add timeouts, payload caps, and per-principal limits proportional to exposure and cost.
- Authorize the specific operation and data scope; authentication alone is not enough.

## Errors

Use the repository's current top-level JSON error envelope:

```json
{ "error": "Safe message for the caller" }
```

Do not silently switch to a nested or incompatible shape. Never expose stack traces, SQL
messages, credentials, raw provider responses, or sensitive request data. If a richer
structured error is needed, update OpenAPI and every generated consumer in the same change.

## OpenAPI and generated-code lockstep

For every contract change:

1. Update `lib/api-spec/openapi.yaml`.
2. Regenerate the API clients and validators through the repository's existing commands;
   never hand-edit generated files.
3. Confirm runtime validation and implementation match the documented request and response.
4. Run `pnpm run check:api-generated` plus the smallest relevant tests.

If an enum, query parameter, request field, status response, or response shape crosses the
API boundary, it belongs in this lockstep process.

## Review checklist

- [ ] Existing callers and backward compatibility were checked.
- [ ] Public/authenticated/authorized status is explicit.
- [ ] Facility, live/sandbox, date, and capability scope are enforced where relevant.
- [ ] Inputs are validated before database or paid-provider work.
- [ ] Collections, payloads, and expensive work are bounded.
- [ ] Method and status codes match actual behavior.
- [ ] Errors use the documented safe JSON shape.
- [ ] Idempotency or conflict handling exists where retries can duplicate a mutation.
- [ ] OpenAPI, generated clients, validators, and implementation agree.
- [ ] Relevant contract and runtime checks pass.
