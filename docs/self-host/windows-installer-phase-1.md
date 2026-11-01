# Windows server installer — Phase 1 inspection contract

Status: implementation phase 1, read-only host inspection. This is not a production-readiness approval and does not replace the qualification limits in `docs/self-host/README.md` and `docs/self-host/fresh-build-profile.md`.

## Objective and ownership

The Windows installer work owns a future server-only setup experience for `RunCalculatorServerSetup.exe`. Browser/PWA clients are unchanged; no Android, iOS, or Windows client installer is part of this work. Phase 1 adds only a host inspector, compatibility evaluation, and conservative local-AI candidate recommendation. The existing self-host launcher, Compose services, AI adapter, and application data formats remain unchanged.

The implementation is isolated on `feat/windows-server-installer`. It must not change `main`, `Replit`, production data, deployment settings, or the active repair surfaces in PR #145. No user decision or permission is expected during this phase.

## Approved phase boundaries

Phase 1 may:

- Inspect Windows edition/build, CPU architecture and virtualization capabilities, installed and available memory, local-disk capacity, display adapters, NVIDIA driver/VRAM when available, power state, network availability, and listeners on TCP ports 80 and 443.
- Run read-only local status commands for WSL, Docker, and NVIDIA when those commands exist.
- Evaluate the collected facts and emit a JSON or human-readable report to standard output.
- Identify `qwen3:4b` as a conservative, unmeasured text-model candidate for suitable hosts, including a 12 GB RAM HP Pavilion-class profile.

Phase 1 must not:

- Install or uninstall any product, Windows feature, driver, container image, or AI model.
- Enable WSL, change Docker settings, create firewall rules, change power settings, or reboot.
- Pull models, start containers, access application data, generate credentials, or contact AI providers.
- Treat a Windows GPU detection result as proof of WSL2, Docker, or Ollama GPU access.
- Claim model quality, latency, reliability, vision/OCR capability, or production compatibility without later measurement.
- Write logs, reports, credentials, or configuration except where a user explicitly redirects standard output.

## Report semantics

Every compatibility check has one state:

- `pass`: the specific checked fact satisfies the stated phase-1 policy.
- `warn`: installation may be possible, but a prerequisite, servicing, capacity, or operational issue needs attention.
- `blocked`: the current host cannot use the intended Docker Desktop/WSL2 path without a substantive platform or hardware change.
- `unknown`: the fact is missing, unsupported by the collector, or could not be read reliably. Unknown is never converted into a pass.

The overall result is the most severe state present, ordered `blocked`, `warn`, `unknown`, then `pass`. AI suitability is reported separately so that an unsuitable AI host does not block the core application, which can run without AI.

Reports intentionally omit machine name, username, serial numbers, MAC addresses, network addresses, command environment, and raw command output. Collector failures become bounded `unknown` evidence rather than raw exception dumps.

## AI recommendation contract

The phase-1 policy recommends no more than one shared text model. For a host with an x64 CPU and at least 12 GB installed RAM, the candidate is `qwen3:4b` for both the application's cheap matching/classification role and full text-extraction role. This is a candidate for later app-task evaluation, not a quality claim.

The policy must:

- Recommend no AI candidate when installed RAM is below 12 GB or the CPU architecture is unsupported.
- Return `unknown` rather than guessing when required memory or CPU facts are missing.
- Keep one loaded model and one inference at a time as the intended conservative runtime profile.
- Treat GPU acceleration as unverified until end-to-end WSL2/Docker/Ollama access is measured.
- Preserve CPU benchmarking as a fallback and allow a final outcome of core-app-without-AI.
- Reject `qwen3:14b` for a 12 GB host because the repository's roughly 10 GB runtime estimate leaves inadequate operating-system and application headroom.
- Mark vision/OCR separately as `not-qualified`; text-model suitability never establishes vision quality.

Later phases own the signed reviewed model catalogue, representative app-quality evaluation, performance benchmarks, explicit download consent, and immutable model identities.

## Run the inspector

From the repository root with the .NET 8 SDK installed:

```powershell
dotnet run --project scripts/self-host/installer/src/RunCalculator.HostInspector/RunCalculator.HostInspector.csproj -- --json
```

Omit `--json` for the human-readable report. The command needs no elevation. Its report is written only to standard output; redirect it explicitly if a report file is wanted.

## Acceptance and verification

Phase 1 is complete when:

1. The inspector builds with .NET 8 and runs on native Windows without requesting elevation.
2. Focused tests cover supported/unsupported Windows profiles, missing facts, RAM and virtualization boundaries, Docker Linux/Windows container states, occupied HTTPS ports, and non-Windows refusal.
3. AI tests cover the conservative 12 GB profile, insufficient/unknown memory, unsupported CPU, 14B rejection, separate vision status, and core-without-AI fallback.
4. Serialization tests prove stable enum values and absence of raw collector errors or host-identifying fields.
5. The existing Windows CI safety job runs the tests and a real read-only inspection, parses the JSON report, and verifies `inspectionOnly` is true without requiring a workflow-permission change.
6. Existing self-host safety contracts still pass. No required check may be reported as passed when it was not run or was blocked.

Web/browser compatibility and physical mobile checks are not applicable to this phase because it adds no web UI or client behavior. Real HP Pavilion hardware qualification remains a later physical-device prerequisite; native Windows CI is not evidence for that laptop, its NVIDIA GPU, Docker Desktop licensing, unattended startup, LAN trust, backup/restore, or production updates.
