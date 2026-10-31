# External skill search ledger — 2026-10-23

Companion to [the adoption report](external-skill-research-2026-10-23.md).
Public research in an isolated repository at
`0cdb38f5ee8d9332768fa9640efda36f747b6a3b`, captured October 23, 2026.
No candidate commands executed or materials installed.

## Queries and screening

Exact natural-language queries, keyword variants, returned URLs and snippets
are retained in [search evidence](evidence/external-skill-searches-2026-10-23.json).
Search snippets, marketplace scores and installation commands are not license,
maintenance, correctness or permission evidence.

| Group | Keyword queries / discovery route | Result and exclusion |
|---|---|---|
| Browser | `"e2e-reviewer" SKILL.md`; `"playwright-test-generator" skill`; `"playwright-debugger" skill` | SkillsMP led to original voidmatcha repo; marketplace/reuploaded benchmark paths excluded as duplicate identities. Microsoft Playwright docs supplied an independent framework reference. |
| State/math | `agent skills offline sync state machine`; `Trail of Bits property based testing skills` | Original Trail of Bits property skill already installed. No generic state-machine skill selected over local incident-derived sync guidance. |
| Data/browser | `agent skills xlsx spreadsheet Anthropic`; `Supabase postgres best practices skills`; `agent skills accessibility web quality` | Original Anthropic/Supabase material reviewed; Supabase-community mirror is not a separate candidate. Separate direct tree review of Web Quality Skills provided accessibility. |
| Future | `Hugging Face skills model evaluation`; `Vercel react composition patterns skills`; `agent skill food allergen HACCP` | Original HF/Vercel repositories; old evaluation name does not match current tree. Generic food guidance is not an actual reviewed skill. |
| PWA | `github SKILL.md offline sync recovery`; `github SKILL.md PWA service worker updates` | mattiasgeniar original inspected; mayurrathi and agents-inc source/dist discovered but not advanced to adoption. Ordinary offline app repositories excluded (not skills). |
| Units | `trailofbits dimensional-analysis SKILL.md`; `github SKILL.md stateful model based testing` | Dimensional-analysis original reviewed. A search hit at an older commit is not the final reviewed source. |
| Security | `trailofbits skills differential review supply chain`; `github SKILL.md observability privacy diagnostics` | Original differential-review inspected; no new logging/credential-capture automation selected. Local privacy/evidence guidance remains primary. |
| QC | `github SKILL.md HACCP allergens food safety`; `github agent skills quality control food` | Governance framework, food checklists and commercial food services not treated as verified installable skills. No customer sources submitted. |
| License/claim repair | `vercel-labs agent-skills composition-patterns LICENSE MIT`; `WCAG large scale text 18 point 14 point` | No actual Vercel terms found in reviewed tree/search; defer copying. W3C confirms large-text units are points, not the candidate's pixels. |

Authoritative original repositories, independent maintainers (Trail of Bits,
Addy Osmani, voidmatcha, mattiasgeniar), vendor originals (Supabase, Hugging Face,
Anthropic, Vercel, Microsoft) and public catalogs were covered. Catalogs were
discovery only. This is a bounded search, not an exhaustive ecosystem survey.

## Immutable source registry

All GitHub trees below were retrieved by commit SHA, not just mutable `main`.
Seven fetched-file repositories are fully indexed in
[the source manifest](evidence/external-skill-sources-2026-10-23.json).
Tree inventory precedes candidate text review. No tree was truncated.

| Original source | Reviewed revision | Latest repository commit at capture | Actual terms / disposition |
|---|---|---|---|
| [voidmatcha/e2e-skills](https://github.com/voidmatcha/e2e-skills/tree/1e77cba3b9fdcfb27ab160073f5151678c3781e2) | `1e77cba3b9fdcfb27ab160073f5151678c3781e2` | 2026-10-23 13:57:12 UTC | Root and per-skill LICENSE/NOTICE inspected: Apache-2.0, copyright voidmatcha 2026; adapt reviewer prose, defer generator/debugger machinery. |
| [Trail of Bits skills](https://github.com/trailofbits/skills/tree/196a9073ab10d35bacf111f945e02c00b2c6883a) | `196a9073ab10d35bacf111f945e02c00b2c6883a` | 2026-10-23 09:26:17 UTC | Actual root LICENSE: CC-BY-SA-4.0. Dimensional-analysis adaptation must retain attribution/ShareAlike; property-testing already installed. |
| [Supabase agent-skills](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7) | `c9be0e931b7930f7d02126d04774d904c381e7d7` | 2026-10-02 12:34:48 UTC | Actual root LICENSE: MIT, Supabase 2026. Adapt selected PostgreSQL performance references. |
| [Web Quality Skills](https://github.com/addyosmani/web-quality-skills/tree/afa8da942115f2961fdbfa80807ea0b232ff6c00) | `afa8da942115f2961fdbfa80807ea0b232ff6c00` | 2026-08-24 21:07:33 UTC | Actual root LICENSE: MIT, Addy Osmani 2026. Adapt accessibility only with corrections. |
| [Vercel agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278) | `063bee94c3f4df8453406c830b0a7df0f2860278` | 2026-08-28 13:36:07 UTC | No license/notice terms in reviewed tree. `license: MIT` frontmatter is insufficient; defer copying. |
| [Hugging Face skills](https://github.com/huggingface/skills/tree/fabc634a893f62ad5c2039830397efa35fa62715) | `fabc634a893f62ad5c2039830397efa35fa62715` | 2026-10-23 09:08:02 UTC | Actual root LICENSE Apache-2.0; current local-model/community-eval skills inspected, defer new runtime/dependencies. |
| [Anthropic skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44) | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | 2026-10-09 18:45:49 UTC | `skills/xlsx/LICENSE.txt` contains service-agreement restrictions; do not infer repository-wide open licensing. No xlsx copying. Webapp-testing duplicates existing guidance. |
| [mattiasgeniar offline-first-pwa](https://github.com/mattiasgeniar/offline-first-pwa/tree/295ccd331bf58428f39d306e1e5e385b6b9eea73) | `295ccd331bf58428f39d306e1e5e385b6b9eea73` | 2026-08-19 13:48:55 UTC | Tree contains only AGENTS.md, README.md and SKILL.md; no actual license. Reject categorical policy import. |
| [Microsoft Playwright](https://github.com/microsoft/playwright/tree/20a2087ea43412b90c172c88faef80786ee18b8b) | `20a2087ea43412b90c172c88faef80786ee18b8b` | 2026-10-22 18:08:06 UTC | Tree/reference inventory only; LICENSE/NOTICE paths located, not used to authorize an adoption. [Official agents docs](https://playwright.dev/docs/test-agents) are framework context. |

Dates above are repository-level maintenance evidence, not the last modification
date of every candidate or a maintenance SLA. Examples, tests and references
were inventoried; no upstream benchmark claim is accepted as a project result.

### Key byte identities

These SHA-256 values bind the reviewed text; manifest URLs identify each exact
path. Hashes authenticate bytes, not author identity or permission.

| Source path | SHA-256 |
|---|---|
| voidmatcha `skills/e2e-reviewer/SKILL.md` | `1678a427c878ba43e5b7da0e7be90c3602163e580f6dfe59b837df4c56634958` |
| voidmatcha `skills/playwright-debugger/SKILL.md` | `df77411080963f7991a8ba8390fb0638998aadcf9c66cc8bb6d963bb43aa5bff` |
| voidmatcha `skills/playwright-test-generator/SKILL.md` | `44547a5e9303a80e70a41cb718d893ebd3873f8896ba43e2a93d313df567d35f` |
| voidmatcha root LICENSE | `4c9fb97c01f065d3113df961e895744276238f69361905181e383503cad57283` |
| voidmatcha root NOTICE | `3750db04b78aa2946bd15d5b3e3c0c81a8227ac26b81f088a9fb5d150478c70e` |
| Trail of Bits dimensional-analysis SKILL.md | `e3a091ca6acd079a00044a74929153bd569731b08c24b4bbaba59203c734a67c` |
| Trail of Bits root LICENSE | `7abe19ec9bb73b36141b999b861d24ad855e808bafe0f81e84cce28556f6c297` |
| Supabase PostgreSQL SKILL.md | `ad65e776f45e761bafc609d3f506c77c1032225aa65e0c4c02f241b8071e5855` |
| Supabase root LICENSE | `b65e575eb4f04a13c187d64e958321298e2ab84d67aa8428819f362056ba292c` |
| Web Quality accessibility SKILL.md | `267fb2a0707d6142f2871f22688203a42ba21291a2aa200fb740936e41362b5d` |
| Web Quality root LICENSE | `c122223ac43e86421958e18623979942c21b642951e2e3736dcb63eff13587c3` |
| mattiasgeniar SKILL.md | `4b5c6a2c3cb8e79f9b73d2d936d8034de26a6f71313d9330b6417f8500c2be33` |

### Uploaded identity and independent browser re-review

The inventory covers all six matching Drizzle ZIP copies, three reviewer
copies, one debugger, one generator and one release runbook. It records sizes,
SHA-256, collision/symlink/encryption/special-file/expanded-size checks.
All 12 passed the metadata safety screen; that is not installation approval.
All 12 ZIP comments were empty; no embedded revision comment was relied upon.
No archive was extracted; selected bounded text members were read only after
the screen. All relevant browser ZIPs have no license/notice members.

| Exact upload(s) | Archive SHA-256 | Result |
|---|---|---|
| `e2e-reviewer_1792704783293.zip`, `e2e-reviewer_1792705150866.zip`, `e2e-reviewer_1792705253851.zip` | `a05623c122e0c22281b05b461ef0714fadb9d5c1d2efe64756bca217c04f4a33` | Identical copies; SKILL hash `9ddbb822afb46d4909c720dc05e868eab3834dffa757ea7b3c9f6937301ae7a4` differs from pinned upstream. Old upload remains deferred. |
| `playwright-debugger_1792705150191.zip` | `50220a0362dc4008af9380b5cd41b2811b7af221b66e1328c6dabe8a15d20c9f` | SKILL hash `20b3b5d149df3868ed85f6838f01116bffa5fa4ca351e6a2086413dac988b2ab` differs from upstream. |
| `playwright-test-generator_1792705150180.zip` | `7e1568c16026d19f7eff0e0e63d4393d32417d93b632208f0067956313d0fb4b` | SKILL hash `0dad6c565178139f5450be1489eb13e332becc7bccbb55ea5ad628fb23b3496f` differs from upstream. |
| Drizzle six filenames enumerated in retained inventory | `c20fd00f053977e077b834905766e9913acc47c829ecd716e13b321cc9910ea0` | Identical copies; actual MIT license inside, copyright Honra 2026. Preserve installed adaptation/source limitation. |
| `prc-release-ops_1792705068299.zip` | `7521f2289aacefba486d3ce08e3b2005c94a8e641ace52b942d869247e3a35e4` | Three files, no license; review-protection bypass instructions cause rejection. |

New upstream Apache licenses/NOTICE resolve the **new reviewed upstream**
browser source permission evidence only. They do not retroactively authenticate
or license an unknown earlier bundle. No historic repository revision was
matched to the uploaded bytes; none is claimed.

The uploaded [skill index](../attached_assets/Skills-index-and-installation_1792705067863.docx)
was treated as untrusted historical catalog text. Its Hono stack assertion
conflicts with current Express API source; its installation instructions do not
override editable-root and approval gates. The prior
[ZIP review](zip-asset-review-2026-09-14.md) classifies older broad bundles as
catalogs/toolkits/reference-only; those were not executed or reinstalled.
No historical bug/security report is implementation authorization.

## Reproduction and verification

1. Obtain each GitHub commit/tree through
   `https://api.github.com/repos/OWNER/REPO/git/trees/REVISION?recursive=1`.
   Confirm `truncated: false`; identify actual SKILL.md, license and notice paths.
2. Retrieve exact source manifest `url` values as plain bytes with bounded
   public GETs. Compare SHA-256 and size; do not execute downloaded content.
3. Reproduce archive inventory with the repository metadata scanner and the
   12 explicit paths in its retained report. Verify the integrity envelope with
   `python3 scripts/zip_asset_inventory.py --verify docs/evidence/external-skill-archives-2026-10-23.json`.
4. Run the supported catalog command in the main report. Do not pass an extra
   standalone `--`: this pnpm version forwards it to the script.
5. Check Markdown local paths, pinned repository/file URL consistency,
   deduplication, license/source hashes and accepted eval cases. Public source
   reads establish link reachability at capture, not perpetual availability.
6. No browser, build, DB, workflow restart, production check or release suite
   applies. No candidate model benchmark was run.

Verification results are retained in
[research checks](evidence/external-skill-verification-2026-10-23.json).
PASS means the specified research check passed; NOT REACHED means adoption evals
await approval; MISSING/FAIL candidate evidence remains attached to its
defer/reject disposition in the main failure ledger, not relabeled as passed.
