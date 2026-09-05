# Retained AI service contracts

The retained AI surface has two jobs. Both produce advisory output only. Neither
service writes production setup, inventory, schedules, recipes, aliases, or
corrections.

## 1. Reviewed document extraction

### Inputs and adapters

- `workbook-text` accepts validated, bounded workbook text.
- `spec-images` accepts validated JPEG, PNG, or WebP page images and transcribes
  them into bounded workbook-style text.
- Adapter-specific validation runs before any model call. A rejected source does
  not consume model capacity.
- Paper run sheets and photo stock intake are not part of this service.

### Evidence and output

- The provider receives only the validated source and an already-grounded prompt.
- The canonical service does not load facility facts, corrections, aliases, or
  conversation history itself.
- Model JSON is retried only through the shared bounded retry policy.
- Untrusted output is sanitized before the optional second-pass reviewer sees it.
- Workbook and image outputs keep source text available to the existing import
  review UI; parsing and transcription never commit data.

### Review and apply

- Every result is marked `decision: "suggestion"`.
- Workbook parse results retain per-profile and per-recipe review verdicts.
- Image transcription must pass through the normal workbook parser and import
  review before a user can apply it.
- Existing import dialogs remain the only apply boundary.

## 2. Deterministic-first unresolved-data resolution

### Ordering

1. Validate and bound the request.
2. Resolve exact, loose-key, learned-alias, and other known deterministic matches.
3. Stop without a model call when nothing remains unresolved.
4. Build the model prompt from unresolved candidates only.
5. Sanitize model output against the original unresolved candidates and canonical
   target allowlists.
6. Attach reviewer verdicts and return suggestions for explicit confirmation.

The shared deterministic-first resolver is used by import-name matching, premix
matching, fill-missing, and ambiguous merge suggestions. Cache-backed routes use
its cache-aware enrichment adapter: cache, cost, prompt grounding, sanitization,
and reviewer mechanics remain route-owned, while the resolver owns
short-circuiting, freshly recomputed deterministic merging, and canonical status.

### Caching and cost

- Cached matching values contain model-owned unresolved suggestions only.
- Deterministic matches are recomputed and merged per request, so a cache hit
  cannot replay another request's deterministic choices.
- Existing shared AI-result caching, in-flight deduplication, route bounds, rate
  limits, and cost charging remain in force.
- Provider failures do not silently become applied values. Existing deterministic
  results may still be returned for review with `aiStatus: "unavailable"`.

### Status

All successful advisory responses use the common fields:

- `decision: "suggestion"`
- `aiGenerated`
- `aiStatus`: `deterministic`, `enriched`, or `unavailable`
- optional `modelStatus`: `completed`, `provider-unavailable`, `rate-limited`, or
  `malformed`

Legacy response fields remain available during compatibility migration.

## State separation

- Correction aliases remain explicit, user-confirmed correction records.
- Denied merge pairs remain explicit merge-review history.
- Generated facility facts remain a separate evidence store.
- Conversation memory remains a separate conversational aid.

No retained service may merge these stores, write one from another, or treat
model output as a confirmed correction.