---
name: Deterministic AI gates
description: Durable rules for keeping non-conversational AI enrichment optional and bounded.
---

Deterministic calculators, canonicalizers, aliases, and safe matchers are the
authoritative result. AI routes should re-run those gates at the server
boundary, send only unresolved candidates, skip narration for empty diffs, and
label provider failures as an unavailable enrichment state.

Treat model-written narration as independently removable from the deterministic
workflow it describes. Preserve narrow document extraction and confirmed
correction aliases before broad assistants, generated forecasts, or generic
vision judgments; conversation history and generated facility facts are not the
same foundation as correction memory.

**Why:** Clients can be older, bypass a local preflight, or poll unchanged
inputs. Trusting only client-side gates allows redundant paid calls and makes
provider outages look like workflow failures. Portfolio review also found that
bundling reliable calculations with optional prose obscures which capability
actually earns its cost and can cause useful non-AI behavior to be retired with
an assistant surface.

**How to apply:** Fingerprint stable deterministic inputs for repeated
non-conversational requests, cache bounded no-AI outcomes for the same snapshot,
and retain human confirmation for every uncertain AI suggestion. For persisted
AI results, serialize cache misses with a scope-and-key database lock and
re-check the row before calling the provider; successful cacheable calls should
dedupe across API processes, while provider failures remain retryable.
When retiring features, remove narration first, keep deterministic outputs and
explicit apply/undo boundaries, then make separate retention decisions for
conversation turns, generated facts, reviewed records, and correction aliases.