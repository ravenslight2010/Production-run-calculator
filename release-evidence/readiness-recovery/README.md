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