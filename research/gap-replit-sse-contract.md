## Key Facts

- **Autoscale explicitly scales across multiple servers:** Replit says Autoscale servers scale up/down with traffic, adds servers when busy, and can reduce the count to **as low as zero** when idle. The page also says users can configure a “maximum number of servers.” This is an explicit platform statement, not inference.
- **Autoscale does not publish a numeric maximum in the fetched documentation:** the page mentions a configurable maximum-server setting but gives no value or guarantee for the maximum/current instance count.
- **Autoscale request/connection duration:** the fetched official Autoscale page states no explicit request-duration limit, connection-duration limit, idle timeout, proxy timeout, or stream lifetime guarantee.
- **SSE/WebSocket support:** the fetched official Replit deployment-types and Autoscale pages contain no explicit statement guaranteeing or prohibiting long-lived SSE or WebSocket connections. Any claim that Autoscale definitely breaks this app’s SSE is therefore unsupported by these pages alone.
- **In-memory state / sticky sessions:** the fetched official pages contain no explicit statement about in-memory state persistence, sticky sessions, or session affinity. It is reasonable engineering inference that scale-out plus process-local state requires verification, but it is not an explicit Replit guarantee or prohibition.
- **Reserved VM is the documented always-on alternative:** Replit describes Reserved VM as one dedicated server that never sleeps, with consistent performance and predictable fixed monthly cost. It lists “chat bots that must stay connected” and “always-on API servers” as ideal use cases. This supports Reserved VM as the documented alternative for continuously connected workloads, but the page still does not explicitly mention SSE.

## Conflicts

- Earlier secondary summaries characterized Replit Autoscale as unsuitable for SSE/WebSockets and lacking sticky sessions. The authoritative pages fetched here do **not** make those exact claims. They establish scale-to-zero and multi-server behavior, but not stream incompatibility, affinity policy, or timeout values.
- “Reserved VM is better suited to persistent connections” is supported by Replit’s explicit “never sleeps,” “chat bots that must stay connected,” and “always-on API servers” language. “Reserved VM guarantees SSE correctness” would be an unsupported extrapolation.

## Claim Impact

- **Verified, high confidence:** active Autoscale semantics include traffic-based server scaling, scale-to-zero, and configurable maximum server count.
- **Verified, high confidence:** Reserved VM is documented as a dedicated always-on server and recommended for always-on APIs / continuously connected chat bots.
- **Unsupported, high confidence:** a specific Replit Autoscale request timeout, connection timeout, SSE timeout, buffering policy, sticky-session guarantee, or maximum instance count.
- **Partially verified, medium confidence:** treating Autoscale + process-local SSE fanout as a compatibility risk. The risk follows from repository architecture plus documented scale-out, but official Replit docs do not state the routing/affinity behavior needed to prove cross-instance delivery failure.
- **Recommended wording:** describe Autoscale as a deployment compatibility risk requiring a sanitized live probe or Replit support confirmation; do not state that Replit officially rejects SSE/WebSockets. Reserved VM is the documented alternative worth evaluating for this always-on SSE workload.

## Sources

1. **Replit — “Deployment types”**; URL: https://docs.replit.com/features/publishing/deployment-types; Tier 1 official platform documentation; publication date not shown; accessed 2026-09-19; saved evidence: `research/sources/gapfill-replit-01-deployment-types.md`.
2. **Replit — “Autoscale Deployments”**; URL: https://docs.replit.com/references/publishing/autoscale-deployments; Tier 1 official platform documentation; publication date not shown; accessed 2026-09-19; saved evidence: `research/sources/gapfill-replit-02-autoscale.md`.
3. **Replit — “Reserved VM Deployments”**; URL: https://docs.replit.com/references/publishing/reserved-vm-deployments; Tier 1 official platform documentation; publication date not shown; accessed 2026-09-19; saved evidence: `research/sources/gapfill-replit-03-reserved-vm.md`.