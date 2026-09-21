# Readiness recovery evidence

Run the bounded, read-only capture against the published `/api/readyz` endpoint:

```sh
pnpm --filter @workspace/scripts run check:readiness-recovery -- \
  --url https://published-host.example/api/readyz \
  --environment release \
  --deployment-id <published-deployment-id> \
  --revision <deployed-40-character-git-sha> \
  --mode normal
```

Use `--mode recovery` during a real sustained worker incident. That mode only
passes after it observes a worker-diagnostic `503` and a later healthy `200`;
it cannot manufacture either state. The output contains only allowlisted
statuses, bounded counts, operation names, and timestamps. It never retains the
URL, response body, request data, recipe data, credentials, or provider errors.

The output is capped at 60 samples and expires seven days after capture. Treat
the deployment ID and full deployed revision as required provenance, not values
to infer from the verifier's checkout.

## Deterministic local recovery proof

The CLI is also covered by a local HTTP fixture that serves two normal `200`
responses, two `503` responses with a hard startup-not-ready condition and
worker diagnostics, then two recovery `200` responses:

```sh
pnpm --filter @workspace/scripts run test:readiness-recovery
```

The test verifies the complete `normal_200` → `worker_incident_503` →
`recovery_200` sequence, including the worker warning in the incident response.
The fixture's `503` is anchored to `checks.startup = "error"` so optional
background-worker degradation is not treated as a permanent hard-failure
policy. The retained JSON is checked for the absence of request, recipe, URL,
and private diagnostic fields.

`attached_assets/replit-uptime-brief-for-agent-2026-09-20_1789934089785.md` is
a dated healthy probe reference only. It is not recovery evidence and must not
be copied into the retained evidence file.