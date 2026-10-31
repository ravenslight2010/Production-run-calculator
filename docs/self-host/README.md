# Windows LAN self-hosting — integration candidate

**Status: DRAFT / NO-GO for production.** Replit/main source integration is complete
for the captured refreshed tips; see the [current integration report](integration-2026-10-31.md).
Private build/workbook inputs and full CI still block production readiness.
 This branch uses the current `Replit`
application as its functional baseline. It does not change Replit publishing,
move production data, merge into main, or install an automatic updater.

## Target and implemented boundary

One semi-dedicated Windows host, roughly 20 browser clients (floor, office and
buffer), iOS/iPadOS Safari, Android Chrome and Windows Edge/Chrome. LAN/Wi-Fi
remains available during WAN loss. Fresh application database; test real imports
rather than clone Replit production. Core application and downloaded local AI
must remain usable without public internet. Local AI is advisory, not permission
to apply production changes autonomously.

Implemented in this first integration candidate:

- Independent `docker-compose.self-host.yml`, fixed project `runcalc-selfhost`,
  new named data volumes, no published database/model API ports.
- Explicit one-time schema initialization, never an API startup dependency.
  Existing force-push schema tooling remains confined to a refused-if-data-exists
  first-install path. **Do not use it for application updates.**
- Windows PowerShell launcher, exact Node requirement, independent private state
  directory, generated high-entropy database/staff/first-manager credentials,
  exclusive credential creation, Windows ACLs, no credential printing.
- Normal restart uses cached images (`--pull never`, `--no-build`) and never
  downloads models or runs migrations. Core starts independently of AI readiness.
- Internal-CA LAN HTTPS with the existing security headers/proxy behavior;
  external font and QR-service CSP exceptions removed on this stack only.
- Smaller provisional CPU-friendly model defaults (`qwen3:4b` for both roles),
  one model and one inference slot at a time. No cloud fallback. This is a
  conservative starting configuration, **not** a measured capacity guarantee.
- Pure fail-closed update-policy module and regression suite. This is an
  executable planning contract, **not a signature verifier, backup system,
  reset receipt emitter, update scheduler, or image switcher**.

See [branch comparison](branch-audit.md) and
[qualification and failure ledger](qualification.md) for remaining requirements.

## Prerequisites — qualify before using real data

- Windows x64, Linux containers through a suitable Docker/WSL2 installation;
  verify Docker licensing, supported Windows version and unattended reboot/logon
  behavior. A launcher plus `restart: unless-stopped` does not prove Docker starts
  before an operator logs in. No startup task is installed by this PR.
- PowerShell **7**, exact Node version in `.nvmrc`, Git checkout of this branch.
- Reserved host IP and private DNS entry, e.g. `runcalc.factory.lan`, resolvable
  by every client **without WAN**. Substitute the actual facility hostname.
- Explicit facility **IANA** timezone. Do not infer it from the operator's PC.
  Windows `Central Standard Time` is not the format this initializer accepts.
- Existing services must not occupy host ports 80/443. Use a Windows **Private**
  firewall rule scoped to the actual LAN subnet; do not expose/forward these
  ports on the internet. No firewall/security controls are weakened by the script.
- First installation needs WAN to fetch container images/build dependencies and
  models. Cached restart is offline; first installation is not an air-gap bundle.

## Disposable fresh-install rehearsal

Run from PowerShell 7 on the **intended Windows machine**, using a NEW dedicated
state directory outside the checkout. Initialization refuses existing credentials
or the fixed database volume. It never deletes/reuses an existing database.

```powershell
./scripts/self-host/Start-SelfHost.ps1 `
  -StateDirectory 'C:\ProgramData\RunCalculator-Test' `
  -InitializeFresh `
  -Site 'runcalc.factory.lan' `
  -TimeZone 'America/Chicago' `
  -Manager 'manager1'
```

The hostname/timezone/manager above are **examples, not selected facility values**.
The generated `self-host.env` is private and contains bootstrap credentials.
Read it locally through an administrator-approved method; do not paste it into
chat, commit it, attach it to an issue, or print resolved Compose config in CI.
Choose a dedicated empty state directory: its ACL is replaced with current-user
and SYSTEM access. Administrator recovery remains possible through Windows
administration. Keep bootstrap secrets out of general staff access.

An interrupted initialization is intentionally **not** retried automatically.
Record the error and inspect the disposable installation; do not remove volumes
or bypass guards on a host containing real data. Recovery/re-entry needs a
reviewed workflow before production qualification.

After successful setup, normal restart is:

```powershell
./scripts/self-host/Start-SelfHost.ps1 -StateDirectory 'C:\ProgramData\RunCalculator-Test'
```

A successful `up` means only that Docker accepted the startup request. Verify
HTTPS `/api/ready`, login and workflows; it is **not** a deployment acceptance.

## Prepare AI once, while online

After the base stack starts, use the same private environment file. This explicit
command downloads models and is intentionally absent from routine startup:

```powershell
$env:SELF_HOST_ENV_FILE = 'C:\ProgramData\RunCalculator-Test\self-host.env'
docker compose --project-name runcalc-selfhost `
  --env-file $env:SELF_HOST_ENV_FILE -f docker-compose.self-host.yml `
  --profile prepare-ai run --rm ollama-pull
Remove-Item Env:SELF_HOST_ENV_FILE
```

Run from the checkout root. Model startup can take time. Do not expose Ollama to
clients. Upgrade model/image versions only deliberately; current image tags are
not an immutable production release channel. Missing/failed AI must be reported
as unavailable, never silently switched to a paid cloud provider.

Text-model setup does **not** qualify camera/photo/OCR or every AI feature. Audit
feature capabilities, choose a vision-capable local route when needed, and test
import/diagnosis quality on representative facility samples before approval.

## LAN HTTPS trust

Caddy's internal CA avoids public ACME/DNS dependencies. Provision its **public
root certificate** on each managed Windows/iOS/Android device and explicitly
trust it according to that platform's policy. Never distribute the CA private
key. Root extraction, renewal, backup and managed trust distribution remain to
be rehearsed; a certificate warning is a blocking failure, not a step to bypass.

Preserve the Caddy data volume: it contains the private CA and must be protected
and included in the approved backup/recovery design. Ordinary app/database
backup does not automatically back up this volume. Verify installed PWAs,
service workers, camera access and same-origin session behavior over trusted
HTTPS. WAN-only web push or other third-party services are not promised offline.

## Update policy and midnight reset

The user reports no activity 21:00–05:00 and an existing daily local-midnight
reset. The initial policy candidate permits updates **00:30–04:30 local only**,
AFTER verified reset completion, not merely because the clock passed midnight.
These times are proposed implementation defaults, not an approved host schedule.
The 04:30 boundary reserves time before 05:00 operations. DST is resolved using
the configured IANA timezone; installation locks/receipts must prevent duplicate
runs during a repeated local hour.

`update-policy.mjs` rejects missing evidence, wrong installation/source/day,
future/stale reset or backup receipts, unverified restored backup, active/pending
client writes, missing rollback images, changed schema, unsigned releases, mutable
image tags and unverified host clock. On rejection the proposed action is to
leave the running application alone. It performs no I/O or install operation.

The `signatureVerified`, `restoreVerified` and other fields are **trusted-caller
inputs in unit tests**, not proof a real host has done those checks. No production
component emits or consumes them yet. Never fabricate receipts to turn this
planner into an updater. A tested versioned artifact built from verified `main`
—not arbitrary `git pull`, branch images or source checkout—is the intended
future channel. A WAN outage must skip update checks without stopping the app.

Required remaining implementation in this same self-hosting objective:

1. An explicitly approved self-host artifact publishing policy (existing GitHub
   source-validation guards currently prohibit registry publication), then
   main-only tested release publishing, immutable image digests, signed manifest
   verification, source/build identity and promotion/revocation policy.
2. Read-only check/download and atomic cached staging; single-host lock, audited
   maintenance/quiescence contract, actual midnight-reset completion receipts.
3. Encrypted/ACL-protected database + configuration + CA backups, off-host copy,
   integrity/restore rehearsal, retention, disk-space protection and schema-aware
   forward migration/rollback. Never restore an old DB while accepting new writes.
4. Rehearsed image switch/health checks/automatic app-only rollback only when
   schema-compatible; destructive/schema changes require reviewed migrations.
5. Native Windows scheduling, unattended reboot and sleep/restart behavior,
   20-client mixed-device workload, WAN-loss and restore drills.

## Local verification

```text
node --test scripts/self-host/self-host.test.mjs
pnpm --filter @workspace/run-calculator exec vitest run src/runTemplatesRepository.test.ts
pnpm --filter @workspace/integrations-openai-ai-server exec vitest run
CI=true pnpm run typecheck
```

Use the exact pinned Node/pnpm versions. The new CI lane runs the pure tests on
Linux/Windows, parses the PowerShell launcher on Windows and validates Compose
syntax on Linux. It does **not** certify a real Windows Docker deployment.
