# Research Notes: Sync Reliability, Deployment, Pooling, and Readiness

**Status:** complete
**Depth:** Deep
**Repository revision:** `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`
**Environment:** Development repository plus bounded deployment metadata; no production payloads retained

## Plan

- **Question:** What does current evidence establish about reconnect overwrite risk, sync payload economics, deployed SSE reliability, database-pool capacity, and AI readiness policy?
- **Scope:** Current repository behavior, deterministic tests, official platform/runtime guidance, sanitized deployment metadata, and relevant primary technical sources.
- **Out of scope:** Retaining production day-state, recipe, request, SSE, credential, personal, or database-record content; declaring an incident root cause without a trace or deterministic reproduction.
- **Audience:** Technical maintainers and product/operations decision-makers.
- **Deliverable:** A cited deep-dive report, evidence matrix, prioritized decisions, and corrections to existing research documents where required.

## Focus Areas

| # | Area | Status | Sources |
|---|---|---|---|
| 1 | Reconnect overwrite causality | complete | repository + 5 primary sources |
| 2 | Complete/partial payload baseline | complete | repository + 6 primary sources |
| 3 | Deployed SSE behavior | complete | repository + 9 platform/protocol sources |
| 4 | Database pool and serving topology | complete | repository + 9 database/platform sources |
| 5 | AI readiness policy | complete | repository + 8 reliability/provider sources |

## Coverage Checklist

- [x] Current code permits a future-clock stale complete write at the protocol level; historical incident causality remains unproven.
- [x] Fixture savings are verified; production rates require bounded mode/byte/time histograms.
- [x] Autoscale compatibility is unresolved: scale-out is documented, but SSE/affinity/buffering guarantees are not.
- [x] Process-local fanout is safe only within one process; cross-instance delivery is not established.
- [x] Pool budgeting requires database capacity, reserves, other-service use, and maximum instance count; those inputs remain unknown.
- [x] Readiness currently gates on AI and contains a provider-key mismatch; optional-versus-hard dependency status needs owner policy.
- [x] Evidence-ranked recommendations and limitations are recorded in the final report.

## Findings Log

_Citation markers will be added after the source registry is built._

### Orientation

- Deployment metadata reports an active, successful, public **Autoscale** deployment. The production URL was intentionally not retained in these notes.
- Official Replit documentation says Autoscale can add/remove instances, does not preserve in-memory state or sticky sessions, and is not intended for long-lived stateful connections such as SSE.
- Current repository references show partial PUT, conditional partial peer frames, a manager sync-health route, a 900 ms pool acquisition timeout, and readiness logic that includes AI configuration.

### Consolidated findings

- Complete writes lack the partial contract's base-snapshot precondition; larger client timestamps can win without causal observation.
- Synthetic 32-run tests verify partial savings, but production adoption, fallback, and byte percentiles are not retained.
- Autoscale can add/remove servers and scale to zero; official pages reviewed do not state SSE, affinity, buffering, or stream-duration guarantees.
- One process owns each SSE client registry and database pool; connection and fanout budgets must account for maximum instances.
- Readiness accepts `OPENAI_API_KEY`, while the active adapter supports Replit Gemini credentials or `GOOGLE_API_KEY`.

## Conflicts & Open Questions

- The application depends on SSE while the current deployment target is Autoscale; official documentation does not explicitly reject SSE, so actual behavior still needs bounded live verification.
- Deployment metadata establishes target and build state, not active instance count, proxy buffering, or stream affinity.
- Repository tests can establish permitted behavior but cannot prove the historical production incident mechanism.

## Gaps

- No production payload or log content was collected.
- No authenticated live SSE probe, multi-process fanout run, production database-capacity query, or provider outage exercise was performed.
- These unresolved items are documented as limitations and safe future verification protocols rather than inferred facts.