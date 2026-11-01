# PR usefulness audit and main-green repair

## Agent-owned execution

Owner: Notion AI, continuing the Windows self-host/main-green objective. User explicitly
asked to review open and closed PRs for useful work, then make main green. Baseline
main: `ff0672efd5bb2add6b2491b1265f1fafc95c3fed`. Inventory uses the complete GitHub
pulls REST pagination (not search). Review all titles/state/base/head/body, inspect
all open and closed-unmerged file deltas plus selected merged CI/security/AI/runtime
changes, and compare relevant patches against current files. This is a usefulness
triage, not a claim that every line of every historical merged PR was re-audited.

None expected from the user for safe code repairs. Keep branch protections unchanged
at the explicitly approved solo-maintainer setting: PRs, strict six required checks,
signed main commits, no force pushes; approvals0. No Replit publication or production
DB changes. No arbitrary bulk merge/closure of other agents' or dependency PRs.

## Applicable safeguards and verification

Follow AGENTS/task execution, verify-before-commit, CI security review, Docker browser
runtime/readiness and evidence hygiene. Use isolated disposable Docker/Postgres,
unique fixtures and retained count-only reports. No production secrets in PR jobs,
fork execution, pull_request_target, host-network entitlement grant, raw fixture Git
or artifact/cache export, validation weakening or retry-as-proof. The repair PR needs
its own exact-head, owner-reviewed input environment; main/report environments remain
unchanged. Validate negative authorization contracts before granting test input access.

Run focused network/configuration contracts, full root typecheck, workflow/actionlint,
required PR CI and standard release, and real reviewed-PR Docker/Caddy browser matrix;
then normal signed merge and all applicable main workflows. Compatibility matrix:
Chromium and WebKit desktop, phone, tablet portrait/landscape in the isolated HTTPS
Docker/Caddy suite; physical Android/iOS/Windows devices NOT RUN (no device service).
Host install/updater/load and production qualification are not inferred from CI.

## Inventory and dispositions

Complete inventory: **143 PRs — 10 open, 74 merged, 59 closed without merge.**

- PR129 Windows and PR130 macOS are validation-only work; current native workflows,
  metadata locks and maintenance tests already incorporate their useful coverage.
  Their old bodies explicitly say not to treat them as application release merges.
- PR44 username case uniqueness and facility-date reset fence, PR46 protected-value/
  authorization fixes, and PR16 direct GOOGLE_API_KEY support are present in current
  evolved code. Do not replay historical schema/sync/auth trees over current code.
- PR103's undici7.29.1 fix is already pinned; fast-uri is newer3.1.8, not its3.1.7.
  Do not downgrade. Existing production audit remains a required gate.
- PR105's old release proposals overlap current passing release gates (WebKit install,
  key evidence, corpus and disposable readiness). They contain obsolete Node/timing
  values and unrelated lock snapshots; no wholesale cherry-pick. Retain current
  immutable identity, fixture authority and negative evidence checks.
- PR82/104 historical cloud model ladders are not replacements for the current bounded
  Gemini resilience and local-first adapter (merged87/108) or distillation work102.
  Preserve local-first selection, explicit cloud fallback, safety and cancellation.
- PR112–115 action/config housekeeping has been absorbed by newer pinned workflows.
- PR141/143/144 integration history is already represented by PR142's exact merged
  tree. It is not additional feature work to merge again.
- Open132–140 dependency PRs are useful maintenance candidates, not fixes for the
  current main-only build-network failure. Chokidar6 and resolvers6 are major changes;
  orval changes affect generated-client/corpus identity. Keep them open for their own
  focused compatibility evidence rather than bulk-merging lock/evidence snapshots.
- PR68 updated Buildx tooling, but does not justify giving the main smoke build extra
  host-network privileges. Replit-local bridge/DNS workarounds must not be global CI
  defaults. Reuse the repository's configurable-environment lesson, not privileged
  flags or old application source.

### Per-PR register

| PR | State | Title | Disposition |
| --- | --- | --- | --- |
| [#144](https://github.com/ravenslight2010/Production-run-calculator/pull/144) | Merged | Integrate main ancestry while preserving current Replit code | Merged history; preserve current evolved implementation |
| [#143](https://github.com/ravenslight2010/Production-run-calculator/pull/143) | Merged | Integrate current Replit into Windows self-hosting feature branch only | Merged history; preserve current evolved implementation |
| [#142](https://github.com/ravenslight2010/Production-run-calculator/pull/142) | Merged | Windows LAN self-hosting — fresh runtime and isolated CI inputs | Merged history; preserve current evolved implementation |
| [#141](https://github.com/ravenslight2010/Production-run-calculator/pull/141) | Closed unmerged | Integration only: record current main ancestry on self-hosting branch | Validation/integration history; not an independent current repair |
| [#140](https://github.com/ravenslight2010/Production-run-calculator/pull/140) | Open | Bump openai from 7.38.0 to 7.42.0 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#139](https://github.com/ravenslight2010/Production-run-calculator/pull/139) | Open | Bump lucide-react from 1.59.0 to 1.61.0 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#138](https://github.com/ravenslight2010/Production-run-calculator/pull/138) | Open | Bump @tanstack/react-query from 5.104.4 to 5.104.5 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#137](https://github.com/ravenslight2010/Production-run-calculator/pull/137) | Open | Bump typedoc-plugin-markdown from 4.14.0 to 4.14.1 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#136](https://github.com/ravenslight2010/Production-run-calculator/pull/136) | Open | Bump chokidar from 5.0.0 to 6.0.0 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#135](https://github.com/ravenslight2010/Production-run-calculator/pull/135) | Open | Bump @hookform/resolvers from 5.9.2 to 6.0.0 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#134](https://github.com/ravenslight2010/Production-run-calculator/pull/134) | Open | Bump vite from 8.3.4 to 8.3.5 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#133](https://github.com/ravenslight2010/Production-run-calculator/pull/133) | Open | Bump react-resizable-panels from 4.14.5 to 4.14.8 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#132](https://github.com/ravenslight2010/Production-run-calculator/pull/132) | Open | Bump orval from 8.43.0 to 8.44.0 | Maintenance candidate; retain open, no bulk dependency/evidence merge |
| [#131](https://github.com/ravenslight2010/Production-run-calculator/pull/131) | Merged | Reconcile main into kimi | Merged history; preserve current evolved implementation |
| [#130](https://github.com/ravenslight2010/Production-run-calculator/pull/130) | Closed unmerged | Validation only: metadata maintenance on native macOS | Validation/integration history; not an independent current repair |
| [#129](https://github.com/ravenslight2010/Production-run-calculator/pull/129) | Open | Validate native Windows metadata maintenance | Native validation already represented; leave unchanged |
| [#128](https://github.com/ravenslight2010/Production-run-calculator/pull/128) | Merged | Fix run-templates test flake: drain in-flight flushes, drop fake timers | Merged history; preserve current evolved implementation |
| [#127](https://github.com/ravenslight2010/Production-run-calculator/pull/127) | Merged | Fix fake-timer boundary flake in run-templates repository tests | Merged history; preserve current evolved implementation |
| [#126](https://github.com/ravenslight2010/Production-run-calculator/pull/126) | Merged | Replit security hardening + bug fixes (2026-10-21 scan findings) | Merged history; preserve current evolved implementation |
| [#125](https://github.com/ravenslight2010/Production-run-calculator/pull/125) | Merged | Replit integration merge — sync fixes round 2 | Merged history; preserve current evolved implementation |
| [#124](https://github.com/ravenslight2010/Production-run-calculator/pull/124) | Merged | chore(skills): drop unsupported effort key from property-based-testing frontmatter | Merged history; preserve current evolved implementation |
| [#123](https://github.com/ravenslight2010/Production-run-calculator/pull/123) | Merged | feat(observability): log database-checkout and server-delay telemetry | Merged history; preserve current evolved implementation |
| [#122](https://github.com/ravenslight2010/Production-run-calculator/pull/122) | Merged | fix(a11y): darken manager-attention count badges to meet contrast minimum | Merged history; preserve current evolved implementation |
| [#121](https://github.com/ravenslight2010/Production-run-calculator/pull/121) | Merged | test(a11y): wait for dropdown unmount before scanning manager setup dialog | Merged history; preserve current evolved implementation |
| [#120](https://github.com/ravenslight2010/Production-run-calculator/pull/120) | Merged | merge: pull Replit line updates into main (21 commits) | Merged history; preserve current evolved implementation |
| [#119](https://github.com/ravenslight2010/Production-run-calculator/pull/119) | Merged | refactor(db): convert legacy serial columns to identity columns | Merged history; preserve current evolved implementation |
| [#118](https://github.com/ravenslight2010/Production-run-calculator/pull/118) | Merged | test(e2e): replace hard-coded sleeps and unproven absence assertions | Merged history; preserve current evolved implementation |
| [#117](https://github.com/ravenslight2010/Production-run-calculator/pull/117) | Merged | Bump typedoc-plugin-markdown from 4.13.0 to 4.14.0 | Merged history; preserve current evolved implementation |
| [#116](https://github.com/ravenslight2010/Production-run-calculator/pull/116) | Merged | ci: bump download-artifact v8.0.2, pnpm/action-setup v6.1.0, github-script v9.0.0 + config cleanup | Merged history; preserve current evolved implementation |
| [#115](https://github.com/ravenslight2010/Production-run-calculator/pull/115) | Closed unmerged | chore: remove vestigial Expo ignores and stale setup-node comment | Useful intent already covered/superseded; no replay |
| [#114](https://github.com/ravenslight2010/Production-run-calculator/pull/114) | Closed unmerged | ci: bump actions/github-script to v9.0.0 | Useful intent already covered/superseded; no replay |
| [#113](https://github.com/ravenslight2010/Production-run-calculator/pull/113) | Closed unmerged | ci: bump pnpm/action-setup to v6.1.0 | Useful intent already covered/superseded; no replay |
| [#112](https://github.com/ravenslight2010/Production-run-calculator/pull/112) | Closed unmerged | ci: bump actions/download-artifact to v8.0.2 | Useful intent already covered/superseded; no replay |
| [#111](https://github.com/ravenslight2010/Production-run-calculator/pull/111) | Merged | ci: bump actions/checkout to v7.0.1 | Merged history; preserve current evolved implementation |
| [#110](https://github.com/ravenslight2010/Production-run-calculator/pull/110) | Merged | chore(deps): batch patch/minor dependency updates (react 19.3.1, react-query, openai, lucide, resolvers, vitest overrides) | Merged history; preserve current evolved implementation |
| [#109](https://github.com/ravenslight2010/Production-run-calculator/pull/109) | Merged | fix(ci): install pnpm shim in dependabot evidence refresh workflow | Merged history; preserve current evolved implementation |
| [#108](https://github.com/ravenslight2010/Production-run-calculator/pull/108) | Merged | Integrate Replit line into main (Replit primary) + local-AI adapter weave | Merged history; preserve current evolved implementation |
| [#107](https://github.com/ravenslight2010/Production-run-calculator/pull/107) | Merged | Bump actions/upload-artifact from 4.6.2 to 7.0.2 | Merged history; preserve current evolved implementation |
| [#106](https://github.com/ravenslight2010/Production-run-calculator/pull/106) | Merged | Bump actions/setup-node from 4.4.0 to 7.1.0 | Merged history; preserve current evolved implementation |
| [#105](https://github.com/ravenslight2010/Production-run-calculator/pull/105) | Closed unmerged | fix(release-check): unblock the repo-wide release gates | Reviewed; obsolete snapshots overlap safer current implementation |
| [#104](https://github.com/ravenslight2010/Production-run-calculator/pull/104) | Closed unmerged | feat(ai): fall back across a bounded Gemini model ladder | Reviewed; obsolete snapshots overlap safer current implementation |
| [#103](https://github.com/ravenslight2010/Production-run-calculator/pull/103) | Closed unmerged | fix(deps): clear 11 Dependabot alerts via undici and fast-uri override bumps | Useful intent already covered/superseded; no replay |
| [#102](https://github.com/ravenslight2010/Production-run-calculator/pull/102) | Merged | feat: local-AI distillation research + lib/distill-dataset, plus 11 new research docs | Merged history; preserve current evolved implementation |
| [#101](https://github.com/ravenslight2010/Production-run-calculator/pull/101) | Closed unmerged | Bump jsdom from 30.0.1 to 30.1.1 | Historical proposal; no established current main-green benefit |
| [#100](https://github.com/ravenslight2010/Production-run-calculator/pull/100) | Closed unmerged | Bump @tanstack/react-query from 5.102.8 to 5.104.0 | Historical proposal; no established current main-green benefit |
| [#99](https://github.com/ravenslight2010/Production-run-calculator/pull/99) | Closed unmerged | Bump lucide-react from 1.45.0 to 1.49.0 | Historical proposal; no established current main-green benefit |
| [#98](https://github.com/ravenslight2010/Production-run-calculator/pull/98) | Closed unmerged | Bump openai from 7.15.0 to 7.25.0 | Historical proposal; no established current main-green benefit |
| [#97](https://github.com/ravenslight2010/Production-run-calculator/pull/97) | Closed unmerged | Bump p-limit from 7.3.2 to 7.3.3 | Historical proposal; no established current main-green benefit |
| [#96](https://github.com/ravenslight2010/Production-run-calculator/pull/96) | Merged | Bump vitest from 5.0.4 to 5.0.5 | Merged history; preserve current evolved implementation |
| [#95](https://github.com/ravenslight2010/Production-run-calculator/pull/95) | Closed unmerged | Bump vite from 8.3.0 to 8.3.1 | Historical proposal; no established current main-green benefit |
| [#94](https://github.com/ravenslight2010/Production-run-calculator/pull/94) | Closed unmerged | Bump @types/node from 26.6.1 to 26.6.3 | Historical proposal; no established current main-green benefit |
| [#93](https://github.com/ravenslight2010/Production-run-calculator/pull/93) | Merged | Bump orval from 8.42.0 to 8.43.0 | Merged history; preserve current evolved implementation |
| [#92](https://github.com/ravenslight2010/Production-run-calculator/pull/92) | Closed unmerged | Document operational intent delivery and Gemini adapter behavior | Review/commentary context; no needed runtime delta for main-green |
| [#91](https://github.com/ravenslight2010/Production-run-calculator/pull/91) | Merged | chore(deps): update within declared ranges and declare api-spec typedoc peers | Merged history; preserve current evolved implementation |
| [#90](https://github.com/ravenslight2010/Production-run-calculator/pull/90) | Merged | fix: rebind corpus evaluation manifest to main's pnpm-lock fingerprint | Merged history; preserve current evolved implementation |
| [#89](https://github.com/ravenslight2010/Production-run-calculator/pull/89) | Merged | fix: commit pnpm 12 @pnpm/exe lockfile entry and rebind corpus manifest fingerprint | Merged history; preserve current evolved implementation |
| [#88](https://github.com/ravenslight2010/Production-run-calculator/pull/88) | Merged | docs: pull Replit's cited research library and reliability plan into main | Merged history; preserve current evolved implementation |
| [#87](https://github.com/ravenslight2010/Production-run-calculator/pull/87) | Merged | feat(ai): local-first AI adapter — self-hosted OpenAI-compatible backend with Gemini fallback | Merged history; preserve current evolved implementation |
| [#86](https://github.com/ravenslight2010/Production-run-calculator/pull/86) | Closed unmerged | Test merge: Replit line into main (with AuditLogCard PDF-export test fix) | Validation/integration history; not an independent current repair |
| [#85](https://github.com/ravenslight2010/Production-run-calculator/pull/85) | Closed unmerged | Review only (2/3): CodeRabbit scan of Replit changes | Review/commentary context; no needed runtime delta for main-green |
| [#84](https://github.com/ravenslight2010/Production-run-calculator/pull/84) | Closed unmerged | Review only (1/3): CodeRabbit scan of Replit changes | Review/commentary context; no needed runtime delta for main-green |
| [#83](https://github.com/ravenslight2010/Production-run-calculator/pull/83) | Closed unmerged | Review only (3/3): CodeRabbit scan of Replit branch | Review/commentary context; no needed runtime delta for main-green |
| [#82](https://github.com/ravenslight2010/Production-run-calculator/pull/82) | Closed unmerged | fix: import AI model chain — 3.8-flash primary, lite fallbacks, env overrides | Reviewed; obsolete snapshots overlap safer current implementation |
| [#81](https://github.com/ravenslight2010/Production-run-calculator/pull/81) | Merged | fix: restore Render imports — gemini-3.6-flash + lazy-chunk warm-up | Merged history; preserve current evolved implementation |
| [#80](https://github.com/ravenslight2010/Production-run-calculator/pull/80) | Merged | docs: log Render recovery for cross-agent memory | Merged history; preserve current evolved implementation |
| [#79](https://github.com/ravenslight2010/Production-run-calculator/pull/79) | Merged | fix: accept GOOGLE_API_KEY in readiness dependencies check | Merged history; preserve current evolved implementation |
| [#78](https://github.com/ravenslight2010/Production-run-calculator/pull/78) | Merged | Bump @testing-library/dom from 10.4.1 to 10.4.2 | Merged history; preserve current evolved implementation |
| [#77](https://github.com/ravenslight2010/Production-run-calculator/pull/77) | Closed unmerged | Bump jsdom from 30.0.1 to 30.1.1 | Historical proposal; no established current main-green benefit |
| [#76](https://github.com/ravenslight2010/Production-run-calculator/pull/76) | Closed unmerged | Bump @tanstack/react-query from 5.102.8 to 5.103.2 | Historical proposal; no established current main-green benefit |
| [#75](https://github.com/ravenslight2010/Production-run-calculator/pull/75) | Closed unmerged | Bump openai from 7.15.0 to 7.23.0 | Historical proposal; no established current main-green benefit |
| [#74](https://github.com/ravenslight2010/Production-run-calculator/pull/74) | Merged | Bump @google/genai from 2.22.0 to 2.23.0 | Merged history; preserve current evolved implementation |
| [#73](https://github.com/ravenslight2010/Production-run-calculator/pull/73) | Closed unmerged | Bump zod from 4.6.2 to 4.6.5 | Historical proposal; no established current main-green benefit |
| [#72](https://github.com/ravenslight2010/Production-run-calculator/pull/72) | Closed unmerged | Bump lucide-react from 1.45.0 to 1.48.0 | Historical proposal; no established current main-green benefit |
| [#71](https://github.com/ravenslight2010/Production-run-calculator/pull/71) | Merged | Bump prettier from 3.9.6 to 3.9.7 | Merged history; preserve current evolved implementation |
| [#70](https://github.com/ravenslight2010/Production-run-calculator/pull/70) | Merged | Bump @types/node from 26.5.1 to 26.6.1 | Merged history; preserve current evolved implementation |
| [#69](https://github.com/ravenslight2010/Production-run-calculator/pull/69) | Merged | Bump framer-motion from 13.2.0 to 13.4.0 | Merged history; preserve current evolved implementation |
| [#68](https://github.com/ravenslight2010/Production-run-calculator/pull/68) | Merged | Bump docker/setup-buildx-action from 3.12.0 to 4.4.1 | Merged history; preserve current evolved implementation |
| [#67](https://github.com/ravenslight2010/Production-run-calculator/pull/67) | Merged | Bump docker/setup-qemu-action from 3.7.0 to 4.4.0 | Merged history; preserve current evolved implementation |
| [#66](https://github.com/ravenslight2010/Production-run-calculator/pull/66) | Merged | Bump docker/build-push-action from 6.19.2 to 7.4.0 | Merged history; preserve current evolved implementation |
| [#65](https://github.com/ravenslight2010/Production-run-calculator/pull/65) | Merged | docs: correct battery/performance audit priorities | Merged history; preserve current evolved implementation |
| [#64](https://github.com/ravenslight2010/Production-run-calculator/pull/64) | Merged | fix: typescript-api-v6 boundary violation + flaky sync SSE retry budget | Merged history; preserve current evolved implementation |
| [#63](https://github.com/ravenslight2010/Production-run-calculator/pull/63) | Merged | docs: sync system, importer redesign, and auto-track coordination research | Merged history; preserve current evolved implementation |
| [#62](https://github.com/ravenslight2010/Production-run-calculator/pull/62) | Merged | Restore API route mounts and heartbeat contracts | Merged history; preserve current evolved implementation |
| [#61](https://github.com/ravenslight2010/Production-run-calculator/pull/61) | Closed unmerged | Deliver integrated Replit update through protected review path | Validation/integration history; not an independent current repair |
| [#60](https://github.com/ravenslight2010/Production-run-calculator/pull/60) | Closed unmerged | Bump zod from 4.6.2 to 4.6.4 | Historical proposal; no established current main-green benefit |
| [#59](https://github.com/ravenslight2010/Production-run-calculator/pull/59) | Closed unmerged | Bump tailwind-merge from 3.6.0 to 3.7.0 | Historical proposal; no established current main-green benefit |
| [#58](https://github.com/ravenslight2010/Production-run-calculator/pull/58) | Closed unmerged | Bump docker/build-push-action from 6.19.2 to 7.3.0 | Historical proposal; no established current main-green benefit |
| [#57](https://github.com/ravenslight2010/Production-run-calculator/pull/57) | Closed unmerged | Bump actions/github-script from 7.1.0 to 9.0.0 | Historical proposal; no established current main-green benefit |
| [#56](https://github.com/ravenslight2010/Production-run-calculator/pull/56) | Closed unmerged | Bump docker/setup-buildx-action from 3.12.0 to 4.3.0 | Historical proposal; no established current main-green benefit |
| [#55](https://github.com/ravenslight2010/Production-run-calculator/pull/55) | Closed unmerged | Bump actions/setup-node from 4.4.0 to 7.0.0 | Historical proposal; no established current main-green benefit |
| [#54](https://github.com/ravenslight2010/Production-run-calculator/pull/54) | Closed unmerged | Bump actions/checkout from 4.4.0 to 7.0.1 | Historical proposal; no established current main-green benefit |
| [#53](https://github.com/ravenslight2010/Production-run-calculator/pull/53) | Closed unmerged | Bump actions/upload-artifact from 4.6.2 to 7.0.1 | Historical proposal; no established current main-green benefit |
| [#52](https://github.com/ravenslight2010/Production-run-calculator/pull/52) | Closed unmerged | Bump docker/login-action from 3.7.0 to 4.6.0 | Historical proposal; no established current main-green benefit |
| [#51](https://github.com/ravenslight2010/Production-run-calculator/pull/51) | Closed unmerged | Bump pnpm/action-setup from f40ffcd9367d9f12939873eb1018b921a783ffaa to b906affcce14559ad1aafd4ab0e942779e9f58b1 | Historical proposal; no established current main-green benefit |
| [#50](https://github.com/ravenslight2010/Production-run-calculator/pull/50) | Closed unmerged | Bump docker/setup-qemu-action from 3.7.0 to 4.3.0 | Historical proposal; no established current main-green benefit |
| [#49](https://github.com/ravenslight2010/Production-run-calculator/pull/49) | Closed unmerged | Bump typescript from 6.0.3 to 7.0.2 | Historical proposal; no established current main-green benefit |
| [#48](https://github.com/ravenslight2010/Production-run-calculator/pull/48) | Closed unmerged | build(deps): bump @replit/vite-plugin-cartographer from 0.5.21 to 0.6.1 | Historical proposal; no established current main-green benefit |
| [#47](https://github.com/ravenslight2010/Production-run-calculator/pull/47) | Closed unmerged | chore(deps): bump @types/node from 25.9.6 to 26.5.1 | Historical proposal; no established current main-green benefit |
| [#46](https://github.com/ravenslight2010/Production-run-calculator/pull/46) | Closed unmerged | fix: 5 test/data-integrity regressions from warehouse-snapshot + inventory-auto-deduction merges | Useful intent already covered/superseded; no replay |
| [#45](https://github.com/ravenslight2010/Production-run-calculator/pull/45) | Closed unmerged | build(deps): bump @vitest/mocker from 4.1.9 to 5.0.0 in the npm_and_yarn group across 0 directory | Historical proposal; no established current main-green benefit |
| [#44](https://github.com/ravenslight2010/Production-run-calculator/pull/44) | Closed unmerged | fix: username case-race, daily-reset boundary bypass, LineMapDashboard allowlist | Useful intent already covered/superseded; no replay |
| [#43](https://github.com/ravenslight2010/Production-run-calculator/pull/43) | Closed unmerged | build(deps): bump @vitest/mocker from 4.1.9 to 5.0.0 in the npm_and_yarn group across 0 directory | Historical proposal; no established current main-green benefit |
| [#42](https://github.com/ravenslight2010/Production-run-calculator/pull/42) | Closed unmerged | build(deps-dev): bump vitest from 4.1.9 to 4.1.11 in /lib/api-zod in the npm_and_yarn group across 1 directory | Historical proposal; no established current main-green benefit |
| [#41](https://github.com/ravenslight2010/Production-run-calculator/pull/41) | Merged | feat: server-side calc cache + summaryStats pre-computation + client … | Merged history; preserve current evolved implementation |
| [#40](https://github.com/ravenslight2010/Production-run-calculator/pull/40) | Merged | feat: Inventory Auto-Deduction — All Features | Merged history; preserve current evolved implementation |
| [#39](https://github.com/ravenslight2010/Production-run-calculator/pull/39) | Merged | Merge Replit updates (163 commits) into main | Merged history; preserve current evolved implementation |
| [#37](https://github.com/ravenslight2010/Production-run-calculator/pull/37) | Merged | Step 7b: server wall-clock bootstrap + client skip-latch (Task 1 mirror) | Merged history; preserve current evolved implementation |
| [#36](https://github.com/ravenslight2010/Production-run-calculator/pull/36) | Merged | Port wall-clock auto-track engine + compute-only schedule verdicts (Task 2) | Merged history; preserve current evolved implementation |
| [#35](https://github.com/ravenslight2010/Production-run-calculator/pull/35) | Merged | Skip redundant client net-second ticks while server schedule is fresh (Task 1) | Merged history; preserve current evolved implementation |
| [#34](https://github.com/ravenslight2010/Production-run-calculator/pull/34) | Merged | Document step 7a (server-owned net-second auto-track) merged | Merged history; preserve current evolved implementation |
| [#33](https://github.com/ravenslight2010/Production-run-calculator/pull/33) | Merged | Run net-second auto-track claims from the server (step 7a) | Merged history; preserve current evolved implementation |
| [#32](https://github.com/ravenslight2010/Production-run-calculator/pull/32) | Merged | Document step 6c merged + heartbeat test fix (memory) | Merged history; preserve current evolved implementation |
| [#31](https://github.com/ravenslight2010/Production-run-calculator/pull/31) | Merged | Push the auto-track schedule on the SSE heartbeat (step 6c) | Merged history; preserve current evolved implementation |
| [#30](https://github.com/ravenslight2010/Production-run-calculator/pull/30) | Merged | docs: mark Step 6b merged in refactor status | Merged history; preserve current evolved implementation |
| [#29](https://github.com/ravenslight2010/Production-run-calculator/pull/29) | Merged | Drive net-second claims from the server due-now verdict (step 6b) | Merged history; preserve current evolved implementation |
| [#28](https://github.com/ravenslight2010/Production-run-calculator/pull/28) | Merged | docs: reference engine PR #27 in refactor status | Merged history; preserve current evolved implementation |
| [#27](https://github.com/ravenslight2010/Production-run-calculator/pull/27) | Merged | Extract per-tick write decisions into the auto-track engine (engine PR #2) | Merged history; preserve current evolved implementation |
| [#26](https://github.com/ravenslight2010/Production-run-calculator/pull/26) | Merged | docs: mark Step 6b foundation merged in refactor status | Merged history; preserve current evolved implementation |
| [#25](https://github.com/ravenslight2010/Production-run-calculator/pull/25) | Merged | Extract pure auto-track engine into live-calc (step 6b foundation) | Merged history; preserve current evolved implementation |
| [#24](https://github.com/ravenslight2010/Production-run-calculator/pull/24) | Merged | docs: mark Step 6a merged in refactor status | Merged history; preserve current evolved implementation |
| [#23](https://github.com/ravenslight2010/Production-run-calculator/pull/23) | Merged | Add server-computed auto-track schedule (refactor step 6a) | Merged history; preserve current evolved implementation |
| [#22](https://github.com/ravenslight2010/Production-run-calculator/pull/22) | Merged | Extract Setup and Summary tools panels into memoized contexts (refactor step 5) | Merged history; preserve current evolved implementation |
| [#21](https://github.com/ravenslight2010/Production-run-calculator/pull/21) | Merged | Extract Inventory and Mix Plan panels into narrow contexts (refactor step 4b) | Merged history; preserve current evolved implementation |
| [#20](https://github.com/ravenslight2010/Production-run-calculator/pull/20) | Merged | Extract Warehouse tab into narrow memoized context (refactor step 4) | Merged history; preserve current evolved implementation |
| [#19](https://github.com/ravenslight2010/Production-run-calculator/pull/19) | Merged | Server-side refactor: shared calc engine + server-side calc (Steps 1-3) | Merged history; preserve current evolved implementation |
| [#18](https://github.com/ravenslight2010/Production-run-calculator/pull/18) | Merged | Replit handoff: fixes to absorb + red CI workflows to fix | Merged history; preserve current evolved implementation |
| [#17](https://github.com/ravenslight2010/Production-run-calculator/pull/17) | Merged | Merge Replit updates (navigation, polling, release evidence) + restore GOOGLE_API_KEY | Merged history; preserve current evolved implementation |
| [#16](https://github.com/ravenslight2010/Production-run-calculator/pull/16) | Closed unmerged | Restore GOOGLE_API_KEY fallback in AI client | Useful intent already covered/superseded; no replay |
| [#15](https://github.com/ravenslight2010/Production-run-calculator/pull/15) | Closed unmerged | Merge Replit branch: navigation, master-data polling, release evidence, source-library reconciliation | Validation/integration history; not an independent current repair |
| [#14](https://github.com/ravenslight2010/Production-run-calculator/pull/14) | Merged | Expand AGENTS.md with shared skills and test catalog | Merged history; preserve current evolved implementation |
| [#13](https://github.com/ravenslight2010/Production-run-calculator/pull/13) | Merged | Add shared knowledge base for multi-agent workflow | Merged history; preserve current evolved implementation |
| [#12](https://github.com/ravenslight2010/Production-run-calculator/pull/12) | Merged | Fix web app typecheck: build recipe-guide-import decls + type flavor param | Merged history; preserve current evolved implementation |
| [#11](https://github.com/ravenslight2010/Production-run-calculator/pull/11) | Merged | Re-add static file serving for Render deploy | Merged history; preserve current evolved implementation |
| [#10](https://github.com/ravenslight2010/Production-run-calculator/pull/10) | Closed unmerged | build(deps): bump @types/node from 25.9.6 to 26.5.1 | Historical proposal; no established current main-green benefit |
| [#9](https://github.com/ravenslight2010/Production-run-calculator/pull/9) | Closed unmerged | build(deps-dev): bump @radix-ui/react-radio-group from 1.3.8 to 1.4.7 | Historical proposal; no established current main-green benefit |
| [#8](https://github.com/ravenslight2010/Production-run-calculator/pull/8) | Closed unmerged | chore(deps): bump @vitejs/plugin-react from 5.2.0 to 6.1.1 | Historical proposal; no established current main-green benefit |
| [#7](https://github.com/ravenslight2010/Production-run-calculator/pull/7) | Closed unmerged | build(deps-dev): bump @radix-ui/react-dropdown-menu from 2.1.16 to 2.1.24 | Historical proposal; no established current main-green benefit |
| [#6](https://github.com/ravenslight2010/Production-run-calculator/pull/6) | Closed unmerged | chore(deps): bump framer-motion from 12.43.0 to 13.2.0 | Historical proposal; no established current main-green benefit |
| [#5](https://github.com/ravenslight2010/Production-run-calculator/pull/5) | Closed unmerged | build(deps-dev): bump @testing-library/user-event from 14.6.1 to 14.6.7 | Historical proposal; no established current main-green benefit |
| [#4](https://github.com/ravenslight2010/Production-run-calculator/pull/4) | Closed unmerged | chore(deps-dev): bump chokidar from 4.0.3 to 5.0.0 | Historical proposal; no established current main-green benefit |
| [#3](https://github.com/ravenslight2010/Production-run-calculator/pull/3) | Closed unmerged | build(deps-dev): bump @radix-ui/react-toggle from 1.1.10 to 1.1.18 | Historical proposal; no established current main-green benefit |
| [#2](https://github.com/ravenslight2010/Production-run-calculator/pull/2) | Closed unmerged | build(deps-dev): bump react-hook-form from 7.75.0 to 7.87.0 | Historical proposal; no established current main-green benefit |
| [#1](https://github.com/ravenslight2010/Production-run-calculator/pull/1) | Closed unmerged | build(deps-dev): bump react-icons from 5.6.0 to 5.7.0 | Historical proposal; no established current main-green benefit |

## Failure ledger and acceptance

1. Fresh execution workspace had no checkout/tool helper. Restore privately from the
   authorized GitHub credential, never print it; exact main baseline verified.
2. Confirmed main Docker/Caddy41252544790 fails before browser execution: test Compose
   globally inserts `network: host`; Buildx Bake refuses without an extra entitlement.
   Fix the cause: default isolated build networking, reject host opt-in in CI, retain
   explicit local-only `DOCKER_CADDY_BUILD_NETWORK=host` for constrained Replit DNS.
   Context paths use JSON/YAML-safe quoting, including Windows separators/spaces.
3. Four focused network tests pass; full root typecheck and required hosted gates
   pending at this checkpoint. No Docker engine in agent sandbox: real matrix must
   run on GitHub's disposable runner, never claimed from pure configuration tests.
4. Tool apply_patch helper was unavailable in the restored computer; used exact local
   file edits instead. No partial patch or repo state loss.

Completion requires actual reviewed-PR browser execution (not PR job skip), all exact
head required checks and uninterrupted standard release, followed by signed protected
merge and post-merge main workflows. Preserve failures as failures until closed.

5. First authoritative local typecheck stopped with127because the fresh computer
   lacked ShellCheck. This is an environment failure, not waived verification.
   Restore0.11.0from its publisher asset and verify the asset SHA256 before use;
   rerun root types under the pinned Node24.21.0/pnpm12.8.1toolchain.

Initial pre-push validation: four focused network tests and test-command registration
contract PASS; complete authoritative root typecheck PASS after restoring ShellCheck.
The feature PR is initially draft to obtain its actual immutable PR number before
provisioning an exact-PR, exact-branch, exact-reviewed-head input environment. Initial
unprivileged setup runs are not acceptance evidence; no secrets available to them.

## Exact repair PR145 validation boundary

The actual repair PR is145, branch fix/main-green-pr-audit. It receives a NEW
independent capability in pr-145-reviewed-test-inputs, restricted to precisely
refs/pull/145/merge, owner review and disabled admin bypass. Original PR142, main
and Docker/Caddy report environment policies/secrets are snapshotted and unchanged.
The transport permits145only with its exact same-repository branch/base/ref and
reviewed40hexhead; separate default capability hash. Forks, other PRs/branches,
wrong heads, main/target events and unknown callers fail before fetch. All58source/
9opaque archive hashes, byte budgets,600file modes and allowlisted cleanup remain.

CI now has a real additional Docker/Caddy browser job ONLY for reviewed PR145;
it receives only that independent fixture capability, contents-read transport and
no cache/build-record/raw-artifact export. Original protected main-only Docker/Caddy
workflow/secret remain unchanged. The prior main-only failure must be reproduced
and closed before merging, not deferred until after merge. Other unreviewed PRs
and forks remain unprivileged. Setup draft runs on the initial authorization-free
head were cancelled as superseded, never counted as passes.

32combined fixture/network security contracts PASS locally, including exact145
positive/negative cases and preserved142/main boundaries. One invocation used the
computer default directory and found no tests; rerun from repo root passed all32.
Final root typecheck/workflow lint and exact-head hosted checks remain required.

Final pre-push local validation:32fixture/network contracts PASS, full authoritative
root typecheck PASS, actionlint across15workflows PASS, workflow negative permission/
cache/artifact regressions PASS, test-command registration and whitespace checks PASS.
Original3environment configurations/policies/secrets and branch protections must
remain byte-for-byte unchanged; verify before granting exact-head PR145input review.
