# Windows server installer — Phase 1 inspection contract

Status: read-only host inspection with separate app-AI and coding-assistant model candidates. This is not a production-readiness approval and does not replace the qualification limits in `docs/self-host/README.md` and `docs/self-host/fresh-build-profile.md`.

## Objective and ownership

The Windows installer work owns a future server-only setup experience for `RunCalculatorServerSetup.exe`. Browser/PWA clients are unchanged; no Android, iOS, or Windows client installer is part of this work. Phase 1 adds a host inspector, compatibility evaluation, and conservative model candidate recommendations for two distinct workloads: app text AI and the optional local coding assistant. The existing self-host launcher, Compose services, AI adapter, and application data formats remain unchanged.

The coding-assistant candidate is a development-only recommendation, not an end-user plant feature. This branch does not alter the installer project on `feat/windows-server-installer`, `main`, `Replit`, production data, deployment settings, or the active repair surfaces in PR #145. No software or model installation is part of this phase.

## Approved phase boundaries

Phase 1 may:

- Inspect Windows edition/build, CPU architecture and virtualization capabilities, installed and available memory, local-disk capacity, display adapters, NVIDIA driver/VRAM when available, power state, network availability, and listeners on TCP ports 80 and 443.
- Run read-only local status commands for WSL, Docker, and NVIDIA when those commands exist.
- Evaluate the collected facts and emit a JSON or human-readable report to standard output.
- Identify `qwen3:4b` as a conservative, unmeasured text-model candidate for the app's AI workload on suitable hosts.
- Separately recommend `qwen3-coder:30b` or `qwen2.5-coder:7b` as a hardware-fit coding-model candidate only when conservative memory and disk thresholds are met; report `unknown` or `notRecommended` otherwise.

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

## App AI recommendation contract

The app-AI recommendation is unchanged: for a host with an x64 CPU and at least 12 GB installed RAM, the candidate is `qwen3:4b` for the application's matching/classification and text-extraction roles. It is an unmeasured candidate for app tasks, not a coding-model recommendation.

The app-AI policy returns `unknown` for missing memory or CPU facts, declines a candidate below 12 GB RAM or on unsupported CPU architecture, keeps one model and one inference at a time, treats GPU acceleration as unverified, preserves CPU benchmarking as a fallback, and allows the core app to run without AI. Vision/OCR remains `notQualified` unless separately evaluated.

## Coding-assistant recommendation contract

`codingAssistant` is a separate report field and never copies `ai.candidateModel`. The initial local catalogue ranks only:

- `qwen3-coder:30b` with a 65,536-token profile cap when the snapshot has at least 64 GiB total RAM, 32 GiB available RAM, and 24 GiB free on the system drive.
- `qwen2.5-coder:7b` with a 32,768-token profile cap when the snapshot has at least 24 GiB total RAM, 12 GiB available RAM, and 8 GiB free on the system drive.

The larger candidate is preferred when its threshold is met; otherwise the smaller candidate is considered. These are conservative project selection thresholds, not vendor minimums. The 7B model's 32K context is below the preferred 64K target; users must assess it against repository tasks. Unknown or inconsistent facts produce `unknown`; hosts below thresholds get `notRecommended` and a no-model fallback.

The model pages list approximate artifact sizes of 19 GB for Qwen3-Coder 30B and 4.7 GB for Qwen2.5-Coder 7B. The installer must recheck free space at the actual model-store location. A later installer phase must pin an exact artifact digest before downloading; model tags may change. Both candidates remain `unmeasured` for coding quality, speed, and impact under normal app workload. GPU detection does not drive selection or prove acceleration. Only one loaded model/request at a time is a planning limit, not an enforced concurrency control.

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
3. App-AI tests cover the conservative 12 GB profile, insufficient/unknown memory, unsupported CPU, separate vision status, and core-without-AI fallback.
4. Coding-assistant tests cover the model tier thresholds, insufficient and unknown facts, unsupported CPU, 32K/64K context selection, no-model fallback, and unverified GPU behavior.
5. Serialization tests prove stable enum values and absence of raw collector errors or host-identifying fields.
6. The existing Windows CI safety job runs the tests and a real read-only inspection, parses the JSON report, and verifies `inspectionOnly` is true without requiring a workflow-permission change.
7. Existing self-host safety contracts still pass. No required check may be reported as passed when it was not run or was blocked.

Web/browser compatibility and physical mobile checks are not applicable to this phase because it adds no web UI or client behavior. Real HP Pavilion hardware qualification remains a later physical-device prerequisite; native Windows CI is not evidence for that laptop, its NVIDIA GPU, Docker Desktop licensing, unattended startup, LAN trust, backup/restore, or production updates.
