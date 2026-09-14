# GitHub branch-state reconciliation

Snapshot captured at `2026-09-14T05:21:34Z` from the local repository and an
authorized, credential-safe GitHub integration. Only hashes, branch names,
bounded counts, titles, and first-line commit subjects are retained. No token,
raw API response, authenticated URL, or private security payload is retained.

## Revision inventory

| Ref | Revision | Observation |
| --- | --- | --- |
| Live `main` | `b20a12a74176e2e7c073b9bbc7cce222cb46d3ac` | Current GitHub tip; latest CI run failed |
| Live `Replit` | `efac5a50f5836ec70d4db546de9412643bf494be` | Current GitHub tip |
| Local `HEAD` / `Replit` | `07dbb84e4fe0ca44fe813846840eed6ba35243ca` | Eight commits beyond live `Replit`; one report remains modified in the worktree |
| Local `main` | `de9201c31bc3ff46c99c8ad1c07fc2088c65bac1` | Older comparison branch |
| Cached `origin/main` | `1a1e8b6bf6842c6ace6aef4e774449e4aa933c87` | Stale; 11 live-`main` commits are not cached locally |
| Cached `origin/Replit` | `efac5a50f5836ec70d4db546de9412643bf494be` | Matches live `Replit` |

The live branches diverge from merge base
`717b6a076c35e9d432d0c3ff06b9d80286830d97`: live `main` has 11 unique
commits and live `Replit` has 145 unique commits. No fetch, push, force-push,
branch deletion, merge, or other remote mutation was performed.

## Preserved local-only work

The eight commits after live `Replit` are retained on local `Replit` and are
not silently discarded:

| Revision | Subject |
| --- | --- |
| `07dbb84e4fe0ca44fe813846840eed6ba35243ca` | Document approved AI evaluation tool comparison |
| `60e3249261035fe9d259a2c02025b7d15ccdfa22` | Add metadata-only ZIP upload inventory and safety tests |
| `92e9fee0d35447f29dc7b45d2f77855ab02d05ab` | Git commit prior to merge |
| `3d291c2674674f01b6eb54de57f093ccd5302880` | Git commit prior to merge |
| `019764fd1dcc56ac12f83041daa45cbd95a3d1db` | Repair auth limits, scoped bootstrap caching, and WebKit sync recovery |
| `b0a5ddd160356d1eefcc0d88fca1b5c80fb3dc6e` | Review all uploaded ZIP assets and record dispositions |
| `3b32e0d19cf95e081a8287de4e9d90f92e8dd2bc` | Git commit prior to merge |
| `dd52a78edcc895cef133dcce1f894ebe6f4fc923` | Update release evidence and attach verification assets |

The current worktree modification is intentionally preserved:
`release-evidence/browser-full/FINAL-REPORT.md`. It records revision
`07dbb84e4fe0ca44fe813846840eed6ba35243ca`, a complete 159-case run with 59
passes, 30 skips, and 70 failures. The proposed delivery path is to retain
the report and local commits, create a fresh reviewed branch from current live
`main`, and selectively port or merge only after owners review the evidence and
the live-main changes. This task does not rebase, delete, or rewrite them.

## Divergent branch deltas

The live branch comparison reports 145 commits unique to `main` and 11 commits
unique to `Replit`. The live-`main` side is represented by the most recent
11 commits below; the complete history remains available on the live branch:

- `aaa56a1c5d66a4b498096a5205f04b556078ade7` — docs: mark live server-calc streaming slice 5 done
- `51437a6151fe27d29fa415fd17bf2806e4d2cb95` — Merge feat/server-line-phase-model: server line-phase model (live-calc slice 5)
- `2196342de611eb3ddc2523d31017b332ed4b2a85` — feat(web): line-phase strips adopt server model
- `f92b9a5081ae966ef5ce792ab904d795b64d41c2` — docs: mark live server-calc streaming slice 6 done
- `e43f18436657f339290641ba8af8e18453f608e1` — Merge feat/line-phase-strips-server-adoption: line-phase strips adopt server model
- `1b169d56693fd3c077bd0c2b866f9cd9fba5949c` — feat(inventory): warehouse coverage adopts server run lines
- `affa3f84d516a7771d10806941a54d9f4b8611fd` — feat(web): inventory coverage consumes streamed run lines
- `e1494cdfc105196a3bff13d7924d4037745c9e1b` — docs: mark server-warehouse-runlines migration done
- `e270aa0e7a00ddcbd2d604b3facd44aaf552edfd` — Merge feat/warehouse-coverage-server-runlines: warehouse coverage adopts streamed run lines
- `a84fd26c95e9a8c1c351f5fd95c5c1d2f94c1157` — docs: close out server-side migration (backlog §13 + completion audit)
- `b20a12a74176e2e7c073b9bbc7cce222cb46d3ac` — Merge chore/migration-closeout: migration complete (backlog §13 + audit)

The 11 commits unique to live `Replit` are:

- `b781df4706667af65e5493b0bb98c755b1ee6361` — Update smoke test results and attach new asset archive
- `c38ba1ed1388889b825dd9a7c02a59b2bb69722d` — Add property-based testing license and update memory file
- `66f06c8b98e7408cf594e2d7e0ef6564ceaf8bba` — Import project asset archives
- `1acf9bd427b2a80c994dd98cb1efebcecb6d8787` — Add data cleanup skill documentation and update browser smoke tests
- `1c5e84eb482b318206e83edde6b4c10b68acf0ac` — Add project assets and documentation files
- `996dc0321b1b672245c1dd147922cea74346c412` — Initialize api-design and error-handling agent skills
- `9bdc6ceb25b1f968839cf1684a20ba7f713d269c` — Update final report and attach project assets
- `de6570da0641ff57c417527eb5fd669c1cca830d` — Remove redundant export and metadata files
- `0552328967d72e087342ea4c3a27da95df69c730` — Update documentation and add new skill definitions
- `56fa8f705df99cddc4cfd2fc7bc698de3577e4a` — Add documentation and writing review skills
- `efac5a50f5836ec70d4db546de9412643bf494be` — Update asset archives and repository attributes

These lists are bounded audit evidence, not a replacement for a future full
fetch. The live branch tips above are the authoritative revisions for this
audit.

## Upgrade and dependency branch triage

The following remote branches are ancestors of the cached `origin/main`, and
therefore also precede live `main`: `upgrade/phase1-ui-runtime`,
`upgrade/phase2-server`, `upgrade/phase3-toolchain`, `upgrade/phase4-zod4`,
`upgrade/phase5-typescript6`, `upgrade/types-node-26`, `chore/dep-updates`,
`chore/orval-8.31`, `chore/rhf-refresh`, and
`chore/security-vuln-fixes`. They are obsolete as delivery branches; preserve
them for history and do not merge them again.

The open pull request is #49,
`chore(deps-dev): bump typescript from 6.0.3 to 7.0.2`, from
`dependabot/npm_and_yarn/typescript-7.0.2`
(`f5fbd621345e550f45207d34b5740e421e4f0a19`). Its base is stale at
`4829a6356332be0c1f3ce8fd35c894a3459b6678`, while live `main` is
`b20a12a74176e2e7c073b9bbc7cce222cb46d3ac`; its mergeability is unknown and
its latest release-check run failed. Do not merge it as-is. If TypeScript 7 is
still wanted, recreate or rebase it from current live `main` through a separate
reviewed delivery path.

The remaining Dependabot branches are not ancestors because their changes were
superseded or folded into the merged dependency waves. Classify them as
obsolete unless a maintainer explicitly selects one for a fresh branch from
live `main`; do not merge stale branch tips automatically.

## Open issues, releases, and workflow state

- Open pull request: #49, the stale TypeScript 7.0.2 update.
- Open issue: #38, `[Alert] Stable branch protection drift detected`.
- Live GitHub tags: none.
- Live GitHub releases: none.
- Local-only recovery tags: five `recovery-baseline-*` tags; no live GitHub
  release or tag was created or mutated by this audit.
- Latest observed `CI` run on live `main`: failed at revision
  `b20a12a74176e2e7c073b9bbc7cce222cb46d3ac` on 2026-09-14.

GitHub Actions Docker publication is intentionally separate from GitHub
releases and tags. The `Docker image` job publishes `latest` and the commit SHA
to GHCR only for a push to `main`; no release/tag workflow or GitHub Release
is implied. Creating a release workflow would require a separate approved
design covering protected environments, revision binding, provenance, and
rollback.

## Branch-protection evidence

The authorized live API snapshot on 2026-09-14 reports required signed commits,
one pull-request approval with stale-approval dismissal, six strict required
checks from app `15368`, disabled administrator enforcement, disabled
conversation resolution, disabled force-pushes, and disabled branch deletion.
The local `gh` CLI was not authenticated, so the CLI verifier result is
explicitly unavailable in this workspace; no unauthenticated public response
was treated as proof of private settings. See
`.github/signed-commit-policy-evidence.md` for the bounded policy fields and
`.github/repository-policy.md` for the contract.