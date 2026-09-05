# Schema-Safe Application Rollback Rehearsal Plan

1. Build immutable local API runtime images from `HEAD^` and `HEAD`, plus the current migration target, in isolated disposable Docker resources.
2. Apply the current migration once to disposable Postgres, fingerprint `public`, and prove `/` and `/api/healthz` before and after replacing only the runtime with the parent image.
3. Persist success/failure evidence, clean all rehearsal resources, add a bounded CI artifact job, and document the corresponding immutable GHCR recovery procedure.