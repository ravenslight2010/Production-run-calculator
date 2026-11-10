# Replit Deployment Feasibility Evidence for V2

**Checked:** 2026-11-10  
**Scope:** Replit project/artifact deployment boundaries, Reserved VM multi-process support, and database separation.  
**Data safety:** Documentation review only. No V1 database connection, write, deployment change, or publish was performed.

## Result

The earlier proposal of a separately deployed API artifact and worker artifact is not supported as written:

- Replit says artifacts in one project share backend/data and publish together; an artifact cannot be published independently or assigned a separate deployment mode.
- Replit says separate projects are separate deployment/data boundaries. Their Replit-managed production databases are not a shared database.
- Replit documentation describes running multiple processes/services inside one Reserved VM deployment, including with a process supervisor. This supports a revised candidate: one V2 project, one Reserved VM deployment, one API process and one supervised worker process sharing that project's V2 database.

This is a **documentation-verified platform fit**, not an executed deployment proof. The current workspace is the V1 project, and root `.replit` selects `autoscale`. No separate V2 project/deployment or isolated Reserved VM publish target is available in this task context. Publishing the current project would cross the explicit V1 safety boundary. Therefore there is no synthetic-data evidence yet for shared-database behavior between the two processes, process-level or deployment-level restart behavior, publish compatibility, or actual connection ceilings.

**Recommendation:** Keep the one-Reserved-VM/two-process arrangement as the V2 candidate, but treat the isolated synthetic pilot below as a hard gate before V2 feature implementation. Do not use separate Replit projects with an assumed shared managed database. If the pilot cannot prove adequate process supervision or connection headroom, pause and get approval for a different database/deployment boundary; do not adopt an external database implicitly.

## Evidence reviewed

### Official Replit documentation

Results from Replit's official documentation search on 2026-11-10:

| Source | What it supports | What it does not prove |
|---|---|---|
| [Deployment types](https://docs.replit.com/features/publishing/deployment-types) | Reserved VM is the always-on deployment option; Autoscale has different scaling behavior. | That this V2 app has been deployed or meets its workload target. |
| [What's an Artifact?](https://docs.replit.com/features/projects-and-artifacts/artifacts) | Artifacts in a project share backend/data and publish together. | Independent deployment settings or a specific V2 worker/API topology. |
| [Multiple Artifacts vs. Separate Projects](https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects) | Artifacts cannot publish independently; separate projects are needed for independent publication. | That separate projects share a Replit-managed database. |
| [Reserved VM deployments](https://docs.replit.com/references/publishing/reserved-vm-deployments) | A Reserved VM can run multiple processes/services under a supervisor or chained command. | Independent process resource allocations, worker child restart behavior for this app, or publish overlap safety. |
| [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production) | Development and production databases are separate environments; each project owns its own managed database. | A shared managed production database between projects. |
| [Projects](https://docs.replit.com/features/projects-and-artifacts/projects) | Projects are the container for artifacts and their shared services/data. | Any unconfigured deployment behavior for this app. |

The documentation search also returned the following platform details: a single Reserved VM deployment can run multiple services using a process supervisor or command chain; a failed long-running program may be restarted by the deployment; and separate projects do not natively share Replit-managed production database connections. These statements describe platform capability/boundaries, not a test result from this app.

### Current workspace evidence

- Root `.replit` sets `deploymentTarget = "autoscale"` and runs the API. It is not a V2 Reserved VM configuration.
- `artifacts/api-server/.replit-artifact/artifact.toml` defines an API artifact with a development command and production build/run configuration.
- `artifacts/run-calculator/.replit-artifact/artifact.toml` defines the web artifact. Artifact-level configuration does not establish independently deployable API and worker VMs.
- The configured workflows and artifacts belong to the current workspace; no separate V2 staging project, isolated production database, or Reserved VM publish target was exposed to this task.
- V1 telemetry is separately documented in [production-evidence.md](production-evidence.md). It does not establish a V2 DB connection ceiling and is not used to set one.

## Feasibility matrix

| Requirement | Status | Evidence / next step |
|---|---|---|
| Two independently deployed API and worker artifacts in the same project | **FAIL — platform limitation** | Project artifacts publish together and cannot have independent deployment modes. Use one deployment with multiple supervised processes instead. |
| Separate Replit projects sharing one managed production database | **FAIL — platform limitation** | Project-managed production databases are separate; no native cross-project shared managed DB is documented. |
| One Reserved VM process group can host API and worker | **PARTIALLY VERIFIED** | Platform documentation supports multiple processes in one deployment. The actual app/service wiring still needs a pilot. |
| API and worker read/write the same synthetic database | **NOT RUN** | No isolated V2 deployment/database was available. Verify with a synthetic marker in the isolated pilot. |
| Worker child restart and lease takeover without duplicate progress | **NOT RUN** | Must be exercised by killing/restarting the synthetic worker before/after commit. |
| Whole deployment restart and publish preserve safe recovery | **NOT RUN** | Must be exercised in isolated V2 deployment; record which processes restart and whether versions remain compatible. |
| Actual usable database capacity and safe pool ceilings | **NOT RUN** | Measure the V2 database ceiling/reserves and steady plus publish-overlap peak; do not infer from V1 or later samples. |
| V1 remains untouched | **PASS — scoped inspection** | No V1 database was accessed, and no deployment, code, schema, or configuration outside research documents/memory was changed. |

## Isolated synthetic pilot protocol

Run only after an owner creates or authorizes a separate V2 Replit project and its disposable database. Keep V1 credentials and connection strings out of the pilot.

1. Deploy a minimal API and worker as separate supervised processes within one Reserved VM deployment.
2. Verify both processes' environment points only to the same empty/synthetic V2 database. API writes a unique test marker; worker reads it and writes a separate synthetic result; API reads that result.
3. Confirm the API remains healthy while stopping/restarting only the worker. Confirm supervisor restarts the worker and the lease/fencing generation prevents the previous worker from committing.
4. Terminate the entire deployment and verify startup recovery, then publish a harmless code change and record deployment behavior, process versions, health, and database availability.
5. Exercise a synthetic due action with crashes before transaction commit and after commit/before acknowledgment. Assert exactly one domain progress effect and one idempotency receipt.
6. Measure the database's effective usable connection budget and all client pool maxima, including overlap/maintenance reserves. Document measurement source/time and retain enough headroom for the agreed safety margin.
7. Repeat a short no-work interval and confirm the worker does not issue unnecessary claim writes.
8. Retain sanitized results only. Any connection to V1, unclear deployment/database identity, or unexplained duplicate progress is an immediate stop condition.

The pilot passes only when all rows currently marked `NOT RUN` have evidence and no V1 connection is possible. Until then, the process arrangement is a recommendation, not a verified production topology.
