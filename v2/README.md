# V2 development area

This directory is an isolated, code-only starting point for V2. It is not
registered as a workspace, workflow, artifact, or deployment, and it must not
connect to V1 databases or credentials.

The first slice is the pure run-lifecycle domain contract. Database-backed
receipts, API authentication, worker leases, PWA controls, and the isolated
Reserved VM pilot are still required before this is a usable or deployable app.
The Reserved VM pilot needs a separate V2 Replit project and disposable
database; it is a deployment-validation requirement, not a prerequisite to
writing isolated domain code here.

Run the current focused checks from the repository root:

```sh
node --test v2/core/run-lifecycle.test.mjs
```
