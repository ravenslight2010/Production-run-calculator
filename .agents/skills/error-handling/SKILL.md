---
name: error-handling
description: "Design, implement, and review robust error handling in this project's TypeScript API and React client. Use when adding error types, API failure responses, client non-OK handling, retries, timeouts, user-facing failure messages, or recovery behavior."
---

# Error Handling

Make failures explicit, safe, actionable, and consistent with the existing contract. Do
not hide errors with silent fallbacks or invent a new error shape in one route.

## Core rules

1. Fail at the boundary where invalid or unsafe work can still be prevented.
2. Every `catch` must handle, translate, report, or rethrow. Never swallow an error.
3. Separate caller-safe messages from diagnostic context.
4. Preserve the original cause when wrapping an error.
5. Treat errors as part of the API and UI contract, including retry and recovery behavior.
6. Fail explicitly when required data or infrastructure is unavailable; do not return
   plausible placeholder data.

## API behavior

- Validate request inputs before database, file, or provider work.
- Known failures should map to deliberate HTTP statuses.
- Unexpected route failures must reach the terminal API error middleware.
- Return JSON rather than HTML for parse failures, oversized payloads, and thrown errors.
- Follow the existing top-level envelope:

```json
{ "error": "Safe message for the caller" }
```

- Do not return stack traces, SQL errors, filesystem paths, secrets, raw provider payloads,
  or sensitive request content.
- Log only bounded operational context: correlation, timing, outcome, safe identifiers,
  and bounded counts. Never copy request, recipe, credential, or personal-data payloads
  into logs.
- If the response shape changes, update OpenAPI and generated clients in lockstep.

## Client behavior

- Treat every non-2xx response as failure unless the endpoint contract says otherwise.
- Validate that the response body has the expected success shape before adopting it into
  cache, local storage, or canonical state.
- Avoid global fallbacks that turn authentication, authorization, or sync errors into
  apparently valid empty data.
- Show users a concise action: retry, correct input, sign in, refresh, or contact an
  authorized manager. Keep internal details out of the message.
- Preserve local/offline data when a server acknowledgment is missing or invalid.
- Rendering error boundaries handle render failures only; they do not replace event,
  request, mutation, or asynchronous error handling.

## Retries and timeouts

- Retry only transient and idempotent operations, or mutations protected by a stable
  idempotency key.
- Do not retry validation, authentication, authorization, or ordinary conflict failures.
- Bound attempts and total elapsed time; use exponential backoff with jitter where useful.
- Respect `Retry-After` for `429` and temporary availability responses when practical.
- Time out network and provider calls explicitly. Cancellation must leave state consistent.
- Use circuit breaking or backpressure only when repeated downstream failure would
  otherwise amplify load; do not add complexity without evidence it is needed.

## Review checklist

- [ ] Invalid input fails before expensive or mutating work.
- [ ] Expected failures map to intentional statuses and safe messages.
- [ ] Unexpected failures reach the terminal JSON error handler.
- [ ] Every non-OK client response is rejected rather than adopted as data.
- [ ] Logs contain useful bounded context but no sensitive payloads.
- [ ] Retries are bounded and limited to safe/retriable operations.
- [ ] Timeouts and cancellation preserve consistent state.
- [ ] User-facing messages explain the next action without leaking internals.
- [ ] OpenAPI and generated clients match any changed failure contract.
- [ ] Tests cover the failure path at its source-of-truth layer.
