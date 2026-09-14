# Uploaded ZIP Asset Review

## Scope and method

- **Request binding:** the 39 ZIP files present in `attached_assets` on 2026-09-14.
- **Review date:** 2026-09-14.
- **Source identity:** each finding is bound to the exact uploaded filename and SHA-256 below. A repository URL is treated as a hint observed in archive documentation, not as independently verified provenance.
- **Inspection performed:** SHA-256 hashing; ZIP central-directory manifest inspection; normalized-path, duplicate-path, case-fold collision, encryption, special-file, size, and compression checks; filename and sampled text scans for credential-like material; safe reading of selected README/license/package metadata.
- **Not performed:** no extraction into the workspace, package installation, script/plugin/MCP/application execution, network service startup, dependency install, integration, or functional validation.
- **Retained scan evidence:** future JSON captures should be produced with `python3 scripts/zip_asset_inventory.py --output <approved-review-file>`. The scanner records only a UTC capture timestamp, bounded environment class, fixed command identity, and validated source revision; it never records local paths, command arguments, archive member names, or archive contents in provenance metadata. Verify a retained capture with `python3 scripts/zip_asset_inventory.py --verify <approved-review-file>` and require `integrity_valid`; this detects post-scan changes but is not a cryptographic signature.
- **Safety result:** no encrypted members, path-traversal entries, duplicate normalized paths, or case-fold collisions were observed. Symlink metadata was present in five archives and is called out below; those archives were not extracted.
- **Credential handling:** credential-like paths and sensitive behavior are named only where useful for disposition. Values were not printed, copied, or reused. A filename or test fixture match is not evidence of a live credential.
- **Evidence label:** retained scanner output remains **REVIEW EVIDENCE ONLY — NOT INSTALLATION APPROVAL**. A scan is a review artifact and does not authorize extraction, installation, execution, or integration.

## Disposition summary

The disposition vocabulary below separates archive classification from a future approval decision:

- **reference-only:** useful as a comparison/catalog/reading source, but not a current integration candidate.
- **duplicate:** byte-identical to another current upload; retain one provenance record only.
- **separate-application candidate — defer:** potentially useful as a standalone application, but outside this product or blocked by provider, license, installer, or security review.
- **reusable outside skills — adapt-later:** a bounded code/test/benchmark idea may be useful, but it needs a separate scope and compatibility review before copying anything.
- **unsafe/offensive — reject:** do not import; the archive contains offensive-security material, credential tooling, or unsafe archive metadata central to the content.
- **irrelevant — defer:** no credible fit to this TypeScript/React/Postgres production-run application.

| # | Exact uploaded archive | SHA-256 | Size / entries | Observed source and license evidence | Safety / sensitive-content notes | Disposition |
|---:|---|---|---:|---|---|---|
| 1 | `Agentic-Bug-Hunter-main_1789336705554.zip` | `32138202069e0bc9f6b8060afad8d1ee236194beadac8c5c1fc9a8a32901efdc` | 2.83 MB / 319 | README points to `github.com/Awarexone/Agentic-Bug-Hunter`; root `Agentic-Bug-Hunter-main/LICENSE` | Credential hunter/token auditor, bug-bounty, pentest and MCP content; credential-related paths and scripts | **unsafe/offensive — reject** |
| 2 | `Anthropic-Cybersecurity-Skills-main_1789345857689.zip` | `bfc6963f68d68968655c5276026dbe75f4d1354795679b2b00344852201a27e3` | 13.85 MB / 7,287 | README points to `github.com/mukul975/Anthropic-Cybersecurity-Skills`; root `Anthropic-Cybersecurity-Skills-main/LICENSE` plus per-skill licenses | 818 actual `SKILL.md` files, 1,916 scripts, malware/rootkit/credential-access/privilege-escalation and offensive content | **unsafe/offensive — reject** |
| 3 | `CLIProxyAPI-main_1789336705501.zip` | `ced94cd2bd0592d26b13c84052422a5157dc427072c7efa8d8d5f7302019679e` | 9.40 MB / 1,790 | README points to `github.com/router-for-me/EasyCLIProxyAPI` and related Router-For.ME projects; `CLIProxyAPI-main/LICENSE` is MIT | Provider proxy, multi-provider auth/token handling, `.env.example` files and credential-related code/assets | **separate-application candidate — defer** |
| 4 | `Claude-Autopilot-main_1789337301141.zip` | `e44bbfbe9abaeeb267436119b95eba4c53fbdfd4840caf3c2dab63011f5b76e9` | 487 KB / 163 | README points to `github.com/benbasha/Claude-Autopilot`; `Claude-Autopilot-main/LICENSE` | Claude-specific desktop/webview application with password UI; no direct product fit | **separate-application candidate — defer** |
| 5 | `Claude-BugHunter-main_1789336705536.zip` | `f926665e3e75f07904af56d8e2d37bcb15959512d88cc813f7c4c8ac41194dad` | 2.04 MB / 418 | README points to `github.com/elementalsouls/Claude-BugHunter`; root LICENSE and NOTICE | 83 skills, disclosed exploit reports, offensive OSINT, token scanning and breach/credential references | **unsafe/offensive — reject** |
| 6 | `CyberStrike-main_1789345857863.zip` | `1a36f01616b5ed0dad559d1b7575751d0eaad4d9bd25518e620fa556adf00a12` | 91.15 MB / 19,313 | No upstream URL observed in the sampled README set; `CyberStrike-main/LICENSE` | Symlink metadata in public assets and source files; 7,689 `SKILL.md` entries, credential/token tooling, security platform and bundled benchmark/catalog data | **unsafe/offensive — reject** |
| 7 | `ECC-main_1789337301178.zip` | `332eae9dffb803fd67243a545250653d1d9c391a991822eaef1f58724ee3a2cb` | 35.95 MB / 5,012 | Multi-agent skill bundle; `ECC-main/LICENSE` | 903 actual skills plus many translated/provider roots; overlaps project-owned API, testing, security and documentation skills | **reference-only** |
| 8 | `FreeRide-main_1789336705442.zip` | `eb4884370bc3f629125f9359af84f3835b147dd54c8258d22ad5c06466f1163a` | 19 KB / 9 | README mentions `github.com/Shaivpidadi/FreeRide`; no license file observed | One small OpenClaw-oriented skill; licensing and provenance are incomplete | **reference-only; defer** |
| 9 | `OmniRoute-main_1789345857927.zip` | `62763713fdabc8ea461173e985439c3072d14696676cb1fdc1762b9a5394d56e` | 72.97 MB / 14,895 | README points to `github.com/diegosouzapw/OmniRoute`; root and package licenses observed | Provider/model router with 47 skills, MCP/provider integrations, `.env.example` files and extensive credential/token paths | **separate-application candidate — defer** |
| 10 | `agent-skills-cli-main_1789345857497.zip` | `326c6ab15a0b6dc1f05e95839627adde1f8ef23fe1cd60aa5a26a5aa90535dd3` | 269 KB / 145 | README points to `github.com/Karanjot786/agent-skills-cli`; `agent-skills-cli-main/LICENSE` | Marketplace/install/sync CLI; its central behavior downloads and installs third-party skills, outside this review scope | **separate-application candidate — defer** |
| 11 | `agent-teams-ai-main_1789345857724.zip` | `968aab22259087a94362981db27d753a513f3ebce94530634cf3a7a8d4d62405` | 55.00 MB / 6,383 | README points to `github.com/777genius/agent-teams-ai`; `agent-teams-ai-main/LICENSE` is AGPL-3.0 | Symlink metadata at `agent-teams-ai-main/landing/dist`; desktop app, MCP server, provider credentials and 1,994 test-like paths | **separate-application candidate — defer** |
| 12 | `agentic-awesome-skills-main_1789345857674.zip` | `60a722c5f3f53ef042bbe5775d0d9dbffb01c81fb88ad9ef5c4e847cca03b15b` | 134.44 MB / 33,703 | README points to `github.com/sickn33/agentic-awesome-skills`; root and per-skill license evidence | Symlink metadata in skill references; 6,670 skills, 22,356 plugin-like paths, many `.env.example` files and provider-specific integrations | **reference-only; unsafe to extract wholesale** |
| 13 | `arscontexta-main_1789336705485.zip` | `7d68e77b771a599dba9d9d6ba93151b3071f8fd7268bbe198b6620367656151d` | 1.76 MB / 465 | README points to `github.com/tobi/qmd` and related tooling; `arscontexta-main/LICENSE` | 26 actual skills and agent-memory methodology; no direct production-run compatibility | **reference-only** |
| 14 | `auto-deep-researcher-24x7-main_1789345857811.zip` | `981ec8a38fede26eebbc00940d8c64058debc8e8868118ccb4ac9ac7f29b8034` | 12.91 MB / 119 | README points to `github.com/Xiangyue-Zhang/auto-deep-researcher-24x7`; `auto-deep-researcher-24x7-main/LICENSE` | GPU/research workflow, external model/search dependencies, 8 skills and 15 test paths; no fit to core app | **separate-application candidate — defer** |
| 15 | `autocontext-main_1789345857786.zip` | `d0f294a8741750ae999aafb2d079a0b232589c0add6dd28bd092a5b69cb29328` | 9.04 MB / 4,889 | README points to `github.com/greyhaven-ai/autocontext`; root and component `LICENSE` files, Apache-2.0 | Python and TypeScript packages, recursive agent-evaluation harness, traces/reports/datasets, `.env.example`, provider and model dependencies | **reusable outside skills — adapt-later** |
| 16 | `autoharness-main_1789345857907.zip` | `5c09f24b3ca8df359cfa617919627f455dbadb90a69a094a87c765412f85ab11` | 134 KB / 91 | README references Hermes Agent; `autoharness-main/LICENSE` | Small Python harness with one skill and 30 test-like paths; upstream identity is not independently verified from the upload | **reusable outside skills — adapt-later, provenance-gated** |
| 17 | `awesome-ai-coding-techniques-main_1789345857586.zip` | `61421d655192ff5528e484d39bf6c2e715faee6c5d990ff6a07fb80d3d57c6b2` | 102 KB / 10 | README points to `github.com/inmve/awesome-ai-coding-techniques`; no license file observed | Link/catalog-only archive; no implementation or test candidate | **reference-only** |
| 18 | `awesome-ai-tools-main_1789337301163.zip` | `5238f7fb337e2f2210ed97ff52739a38e60411e417173dc4da045bfe295e19ec` | 68 KB / 10 | README points to `github.com/eudk/awesome-ai-tools`; root LICENSE observed | Link/catalog-only archive; no implementation or test candidate | **reference-only** |
| 19 | `awesome-claude-code-main_1789335929493.zip` | `be1d0a6e8f26c7d6a999d9f81c13f9a3721faa65f732cfda42873d38b20b013f` | 2.32 MB / 69 | README references Claude Code; `awesome-claude-code-main/LICENSE` | Byte-identical to row 20; catalog and small scripts, not a product dependency | **duplicate** |
| 20 | `awesome-claude-code-main_1789336705388.zip` | `be1d0a6e8f26c7d6a999d9f81c13f9a3721faa65f732cfda42873d38b20b013f` | 2.32 MB / 69 | Same archive identity and license as row 19 | Exact duplicate of row 19 | **duplicate** |
| 21 | `awesome-claude-design-main_1789336705457.zip` | `a270677e27d54c7b07f8cf161f0d922f4ff1382c238aee9e90fb1ca53aa3ebed` | 1.06 MB / 118 | README points to `github.com/rohitg00/awesome-claude-design`; root LICENSE | Design prompt/reference collection; no executable app or reusable project fixture | **reference-only** |
| 22 | `awesome-claude-plugins-main_1789336705470.zip` | `0c785d8633834d9a8a9c168b36254cdd2fb5330f3da14676aae784ec927b59e6` | 3.84 MB / 206 | README is a plugin list; no root license observed | Plugin catalog/UI, not a reviewed plugin implementation; marketplace/provider behavior | **reference-only** |
| 23 | `awesome-gamedev-agent-skills-main_1789345857651.zip` | `579545bddf30b22af6bc5ab2c3aa438b4552867f2da3c5e796cce8cd2767db23` | 1.96 MB / 365 | README points to `github.com/gamedev-skills/awesome-gamedev-agent-skills`; LICENSE and NOTICE | 74 game-development skills; unrelated to production-run planning and inventory | **irrelevant — defer** |
| 24 | `awesome-skills-main_1789345857560.zip` | `650ddfcf072cb24c00d683265fe1b06f51088556113c4f5c4cf6f059bb026c6c` | 19.34 MB / 11,567 | README points to `github.com/theneoai/awesome-skills`; root LICENSE | 960 skills, benchmark/catalog and persona material; substantial overlap with existing skill roots | **reference-only** |
| 25 | `best-skills-main_1789345857610.zip` | `4b882308caf8e0a0cf4f8fcc398ace1bf3fed7356246f5b2a7d321455f0c6063` | 33.59 MB / 651 | README points to `github.com/LinklyAI/best-skills`; root LICENSE | Catalog/data archive with no actual `SKILL.md` entries; no reusable implementation identified | **reference-only** |
| 26 | `bug-hunter-main_1789345857706.zip` | `4c3bf3c5150c9cd5930db3e2fc249fb2d9323159155425ccf922227e127cbe0f` | 37.86 MB / 229 | README points to `github.com/codexstar69/bug-hunter`; root LICENSE | Offensive bug-hunting workflow and exploit-oriented material; not appropriate for this product | **unsafe/offensive — reject** |
| 27 | `claude-code-recipes-main_1789336705516.zip` | `3526cc3c5f95f5a70ec20d4d99a12edc37950a944e9a8d9ec19cca19b602eaba` | 883 KB / 153 | README points to related `sgharlow` repositories; `claude-code-recipes-main/LICENSE.md` | Six skills and recipe docs; provider-specific and no current product fit | **reference-only** |
| 28 | `claude-code-settings-main_1789345857743.zip` | `d91d63984dbb16815b868aba2fa6b9fa4e2b63a0a36cccac1d675285957794ab` | 239 KB / 138 | README points to `github.com/feiskyer/claude-code-settings`; root and per-skill license files | **Symlink metadata** under plugin skills; provider settings, Codex/OpenAI/image/transcription plugins, possible network/install behavior | **separate-application candidate — defer; unsafe to extract wholesale** |
| 29 | `claude-octopus-main_1789345857837.zip` | `32de537e18ed2040b40ccf9f67a1a4460177619155b1d2692de84567f6ee96aa` | 7.19 MB / 1,553 | README points to `github.com/nyldn/claude-octopus`; root and vendor licenses | Claude-specific orchestrator/MCP server, token-extraction scripts and credential-isolation tests | **separate-application candidate — defer** |
| 30 | `codexskills-main_1788409954395.zip` | `ba02ca583a68d52cc145f9ad36b9ca3c9180de3072f425169eb82b3d2d7245da` | 147 KB / 78 | No README URL; `.system` license files observed | Exact duplicate of row 31; OpenAI/Codex-specific system skills | **duplicate** |
| 31 | `codexskills-main_1789337301209.zip` | `ba02ca583a68d52cc145f9ad36b9ca3c9180de3072f425169eb82b3d2d7245da` | 147 KB / 78 | Same archive identity and license as row 30 | Exact duplicate of row 30; OpenAI/Codex-specific system skills | **duplicate** |
| 32 | `headroom-main_1789352961018.zip` | `33560b79119c7c0a94a58481be0d59ec5fa0f38f1db3963648743c1c9e4b6404` | 35.28 MB / 2,628 | README and Cargo metadata point to `github.com/headroomlabs-ai/headroom`; Apache-2.0 in `headroom-main/Cargo.toml`, LICENSE and NOTICE | Rust/Python tokenization/compression proxy, provider adapters, benchmarks and 1,240 test-like paths; not a TypeScript drop-in | **reusable outside skills — adapt-later** |
| 33 | `https-github-com-ravenslight2010-production-run_1789337301228.zip` | `88119a8a9316bec513490f0a4ce75bf4fcf2249ed5a0cb09aa4b36293761ce15` | 19.86 MB / 1,982 | Rooted at `.agents`, `.local`, `.codex-project`, `artifacts`, `lib`; README is the current product documentation | Historical full-project export with app code, memory, tests and environment examples; may contain stale operational assumptions and sensitive security design | **reference-only historical recovery baseline; never overlay** |
| 34 | `one-skill-to-rule-them-all-main_1789345857885.zip` | `29cf79508cae63c1d541d0545e46ae8c4a65bc6ca6edc2098bed8c36a14581a4` | 326 KB / 25 | README points to `github.com/AllstarGER/one-skill-to-rule-them-all`; `one-skill-to-rule-them-all-main/LICENSE.txt` | Single meta-skill and scripts; external skill installer/aggregation behavior, no product implementation | **reference-only** |
| 35 | `pilot-shell-main_1789345857764.zip` | `510aad011a1be6ed47529fad4d0a2eba2e74a51f59796daf6089a7121943a2a3` | 20.67 MB / 1,725 | README points to `github.com/maxritter/pilot-shell`; `pilot-shell-main/LICENSE` | README includes `curl ... | bash` installer; Python 3.12 launcher/installer, local tooling and token-saving hooks | **separate-application candidate — defer; installer is a stop condition** |
| 36 | `skills-main_1789336705416.zip` | `4ffd471b0a58d5bbc1b1bb9c67a46c560d3c5c26f554f1d66807747f5af802cd` | 3.99 MB / 512 | Anthropic-style skill tree; per-skill license files, no single root license observed | 20 actual skills, mostly provider/design/document tooling; overlaps the managed skill system and is not product code | **reference-only** |
| 37 | `skillstead-main_1789345857440.zip` | `d0a685d5db5e647ca0f99b386c9d9c547168e554e7319ed1ae8529aa61e20a9a` | 57.96 MB / 894 | README describes Skillstead; root Apache-2.0 and per-skill licenses | Six actual skills, including a writing-quality editor overlapping `.agents/skills/writing-quality-editor`; provider-specific install guidance and fixtures | **reference-only; duplicate-by-purpose for current skill roots** |
| 38 | `superpowers-main_1789337301193.zip` | `e5e1c9bd8cdbf1a90c319b237eb433ad7ba46d273321f48bbe50279124eee9ec` | 671 KB / 256 | README points to `github.com/obra/superpowers`; root LICENSE | Symlink metadata at `superpowers-main/AGENTS.md`; 14 skills overlap existing brainstorming/verification/delegation practices | **reference-only; unsafe to extract wholesale** |
| 39 | `vercel-labs-skills-find-skills_1789352960985.zip` | `f7c760c957484610c7b26d3b2b54ca88b9ca6e81fc89eb27fc5a83bb087e14be` | 2.5 KB / 1 | Single root `SKILL.md`; no license or upstream archive provenance observed | Manifest-only single skill; its central behavior is an external `npx skills` install/search workflow | **defer** |

## Promising candidates for a separately approved review

These are ranked only against the current uploads. They are not approved, installed, copied, or validated.

### 1. `autocontext-main_1789345857786.zip` — bounded evaluation/harness concepts

- **Exact source paths:** `autocontext-main/autocontext/src/autocontext/`, `autocontext-main/autocontext/tests/`, `autocontext-main/ts/src/`, `autocontext-main/ts/tests/`, and the root `autocontext-main/README.md`.
- **Provenance evidence:** the README names `https://github.com/greyhaven-ai/autocontext`; the upload itself has the exact SHA-256 recorded in row 15.
- **License evidence:** `autocontext-main/LICENSE`, `autocontext-main/autocontext/LICENSE`, and `autocontext-main/ts/LICENSE` are present; the root README describes Apache-2.0.
- **Compatibility:** the repository is Python plus TypeScript/Node, so its evaluation, trace, report, and benchmark patterns could be studied alongside this project's existing scripts and test workflows. It is not a drop-in package for the pnpm workspace and it assumes agent/provider interfaces not present here.
- **Risks:** provider calls, optional local-model/GPU paths, external telemetry or dataset behavior, generated artifacts, and credential configuration. Never run its installers or provider commands during a future review.
- **Bounded recommendation:** **adapt-later** only if the user approves a narrow design review for evaluation/benchmark ideas. Do not copy the framework or make it a dependency.

### 2. `headroom-main_1789352961018.zip` — token-budget and benchmark ideas

- **Exact source paths:** `headroom-main/crates/headroom-core/src/`, `headroom-main/crates/headroom-core/tests/`, `headroom-main/crates/headroom-core/benches/`, `headroom-main/tests/`, and `headroom-main/benchmarks/`.
- **Provenance evidence:** `headroom-main/README.md` and `headroom-main/Cargo.toml` identify `https://github.com/headroomlabs-ai/headroom`.
- **License evidence:** `headroom-main/LICENSE`, `headroom-main/NOTICE`, and `license = "Apache-2.0"` in `headroom-main/Cargo.toml`.
- **Compatibility:** the repository contains Rust core code, a Python extension, provider adapters, and extensive tokenization tests. Only the concepts and isolated test cases may be useful for AI-route budgeting; the current app is TypeScript/React/Postgres and should not absorb a Rust proxy.
- **Risks:** native toolchain and FFI complexity, model/provider-specific token accounting, network proxy behavior, and `.env.example`/credential surfaces.
- **Bounded recommendation:** **adapt-later** for a written comparison of token-budget tests and invariants; stop before importing code or adding a Rust build.

### 3. `autoharness-main_1789345857907.zip` — small harness/test reference

- **Exact source paths:** `autoharness-main/SKILL.md`, `autoharness-main/tests/`, `autoharness-main/README.md`, and `autoharness-main/LICENSE`.
- **Provenance evidence:** the README references Hermes Agent, but the archive does not establish a fully verified upstream identity beyond the uploaded filename.
- **License evidence:** `autoharness-main/LICENSE` is present.
- **Compatibility:** small Python implementation with 56 Python files and 30 test-like paths; potentially readable as a test-harness pattern, but it is not aligned with the project's Vitest/TypeScript workflows.
- **Risks:** provenance gap, provider assumptions, and possible instructions/scripts that have not been executed.
- **Bounded recommendation:** **adapt-later, provenance-gated**. Require a confirmed immutable upstream reference and a file-level review before considering any selective reuse.

### 4. `agent-teams-ai-main_1789345857724.zip` — separate desktop application only

- **Exact source paths:** `agent-teams-ai-main/src/`, `agent-teams-ai-main/agent-teams-controller/`, `agent-teams-ai-main/mcp-server/`, `agent-teams-ai-main/tests/`, and `agent-teams-ai-main/package.json`.
- **Provenance evidence:** README points to `https://github.com/777genius/agent-teams-ai`.
- **License evidence:** `agent-teams-ai-main/LICENSE` declares AGPL-3.0.
- **Compatibility:** a desktop AI-team application with its own provider/runtime model and build system; it is not a component for the production-run calculator.
- **Risks:** AGPL obligations, symlink metadata at `landing/dist`, provider credentials, MCP/runtime behavior, and a large unrelated dependency surface.
- **Bounded recommendation:** **separate-application candidate — defer**. Consider only if the user explicitly wants a separate desktop product review; do not integrate into this workspace.

## Explicit exclusions and stop conditions

- **Historical project export:** row 33 is a comparison/recovery baseline only. It must not be overlaid onto the current project. Any future selective recovery requires a separate approved comparison and the rollback/recovery process.
- **Provider-specific applications:** CLIProxyAPI, OmniRoute, Claude Autopilot, Agent Teams AI, Claude Octopus, Pilot Shell, and related settings/marketplace archives are not reusable dependencies for this app. Their provider credentials, plugins, installers, and network behavior are stop conditions.
- **Offensive-security content:** Agentic Bug Hunter, Anthropic Cybersecurity Skills, Claude BugHunter, CyberStrike, and Bug Hunter are explicitly separated from reusable candidates. No security tooling or credential-access material should be imported from them.
- **Catalogs and translated mirrors:** Awesome lists, ECC, skills-main, agentic-awesome-skills, Skillstead, Superpowers, and similar bundles are reference material only. Do not bulk-install every skill, locale, plugin, or manifest entry.
- **Credential-bearing or credential-like paths:** do not copy `.env` files, private-key/certificate material, token/credential stores, auth fixtures, or populated configuration. Values were not displayed or reused in this review.
- **Unsafe archive metadata:** archives with symlink entries must be re-inventoried in a fresh temporary staging directory before any approved selective extraction. Never extract them into the workspace.
- **Approval boundary:** this report is a review, not permission to install, integrate, execute, or validate any candidate.

## Ranked shortlist

| Rank | Candidate | Value if approved | Main blocker |
|---:|---|---|---|
| 1 | `autocontext-main_1789345857786.zip` — `autocontext-main/autocontext/tests/` and `autocontext-main/ts/tests/` | Evaluation/benchmark and trace patterns | Provider/network assumptions; separate Python/TS framework |
| 2 | `headroom-main_1789352961018.zip` — `headroom-main/crates/headroom-core/tests/` and `headroom-main/benchmarks/` | Token-budget and model-counting test ideas | Rust/FFI proxy; provider-specific behavior |
| 3 | `autoharness-main_1789345857907.zip` — `autoharness-main/tests/` | Small harness structure worth comparing | Upstream provenance not fully verified |

No other archive qualifies for the shortlist because it is duplicate, catalog-only, a historical export, provider-specific, offensive/security-sensitive, irrelevant, or lacks sufficient provenance/license evidence.