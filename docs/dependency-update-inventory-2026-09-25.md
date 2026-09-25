# Workspace upgrade candidate inventory — 2026-09-25

**Snapshot:** `fdb6b128` (2026-09-25). This is an inventory, not an install,
compatibility approval, security certification, or release decision. No package,
pin, override, or generated artifact was changed.

## Method and baseline

- Compared the 50 importers and 20 catalog entries in `pnpm-lock.yaml` with
  workspace manifests, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, the
  [2026-09-14 inventory](dependency-update-inventory-2026-09-14.md), and
  `scripts/src/release-check.mts`. Workspace links are not registry upgrade
  candidates. Catalog references in the table below show the catalog's
  declared range; locked versions come from the importer entries.
- Ran `pnpm outdated -r --format json` with pnpm **11.5.2** and fresh writable
  temporary npm/XDG caches. Exit **1** (outdated packages), 20 package names
  returned. Ten registry latency warnings (10–19 seconds) were emitted on
  stdout *before* the JSON; the JSON was parsed separately. All 20 entries
  reported `wanted` equal to `current`. `latest` below is registry metadata,
  **not** a resolution proven eligible under `minimumReleaseAge: 1440`,
  overrides, or a frozen install. Recheck at implementation time.
- The root pins pnpm `11.5.2` (`packageManager`, engines `>=11`) and Node
  `24.20.0` (`.nvmrc`, release runner and CI); the shell here initially ran
  Node `24.13.0`. The audit below was also rerun through
  `scripts/src/run-release-node.sh` to select Node `24.20.0`.
  `.npmrc` disables automatic peer installation and strict peer failures;
  neither setting was changed.
- The workspace retains 93 lockfile overrides, including security pins,
  Vitest/Vite alignment, the esbuild loader substitution, and Linux-only
  optional-binary exclusions. The workspace has a one-day release-age policy
  with limited exclusions. This audit is **not** a peer-compatibility or
  override-removal exercise.

The September 14 inventory recorded a staged set of migrations and deferrals.
The current manifests already use React 19.3, Vite 8, Vitest 5, Zod 4,
`@types/node` 26, and several previously deferred UI/server majors. Those
old deferrals are historical, not today's pending upgrade list. Current
`typescript-native` is the `npm:typescript@7.0.2` comparison alias while the
active root compiler remains TypeScript 6.0.3. Promotion is explicitly gated
by the TypeScript 7 comparison and release checks; do not treat it as a
routine major bump.

## Direct dependency candidates

Each row shows **declared → locked → registry latest**. `catalog:` declarations
are expanded to their actual workspace range. `Prod` means declared as a
runtime dependency of a server/shared package, even where a separate frontend
artifact lists the same package under `devDependencies`. `Dev` is a declaration
classification, not proof that code is absent from a shipped browser bundle.
All latest versions are registry observations, not tested replacements.

| Package / area | Declared → locked → latest | Scope | Risk and action |
| --- | --- | --- | --- |
| `@google/genai` — API server, AI integration library | `^2.22.0` → 2.22.0 → **2.24.0** | Prod; minor | Provider request/response and retry semantics: separate integration refresh; test bounded AI failure/retry paths and API build. |
| `openai` — AI integration library | `^7.15.0` → 7.15.0 → **7.23.0** | Prod; minor | Confirm provider-neutral adapter compatibility (older inventory noted no application imports); typecheck integration and API, then focused provider tests. |
| `p-limit` — AI integration library | `^7.3.2` → 7.3.2 → **7.3.3** | Prod; patch | Low isolated risk; include with the integration refresh and test concurrency limits. |
| `drizzle-orm` — API server, DB library | catalog `^0.45.2` → 0.45.2 → **0.45.3** | Prod; 0.x patch | Query and transaction correctness: pair with DB tooling review; run DB/API typechecks and focused integration tests. No schema push in this audit. |
| `drizzle-kit` — DB library | `^0.31.10` → 0.31.10 → **0.31.11** | Dev; 0.x patch | Migration-generation risk: inspect generated diff before any future application, and run DB checks. |
| `zod` — API server, API Zod, DB, both frontends | catalog `^4.6.2` → 4.6.2 → **4.6.5** | Prod + Dev; patch | Generated schemas and validation behavior: isolate with API generated-output check, API Zod tests, typechecks and form validation tests. Not a Zod 3→4 migration. |
| `@tanstack/react-query` — calculator, API React client | catalog `^5.102.8` → 5.102.8 → **5.103.2** | Dev declarations; minor | Query invalidation/sync risk: client typecheck and focused data-refresh tests. |
| `vite` — calculator, mockup | `^8.3.0` → 8.3.0 → **8.3.1** | Dev; patch | Build/PWA/proxy coupling; test both builds, workbook boundary and dev proxy smoke; nested Vite is overridden to catalog. |
| `vitest` — API, calculator, scripts, shared libraries | exact `5.0.0` in most importers; scripts declares `^4.1.9`, overridden to 5.0.0 → **5.0.1** | Dev; patch | Deliberate global `vitest` and `@vitest/mocker` 5.0.0 overrides must move in lockstep if changed; check API and calculator suites plus representative shared libraries. Scripts' declared 4.x range does **not** describe its locked version. Defer a blanket bump. |
| `orval` — API spec | exact `8.32.0` → 8.32.0 → **8.37.0** | Dev; minor | Generated-client drift/TypeDoc peers: separate codegen review; run `check:api-generated`, API typechecks and inspect generated diff. Do not combine with TypeScript promotion. |
| `@types/node` — API, frontends, DB, integration, scripts, corpus | catalog `^26.5.1` → 26.5.1 → **26.6.2** | Dev; minor | Ambient types can expose cross-project diagnostics; run full typecheck and API build; distinct from changing the Node runtime pin. |
| `tsx` — scripts, corpus | catalog `^4.23.13` → 4.23.13 → **4.23.15** | Dev; patch | Script loader risk: run focused script/CLI checks and clean startup. |
| `prettier` — root | `^3.9.6` → 3.9.6 → **3.9.9** | Dev; patch | Formatting drift only; defer to a tooling refresh with a no-write format diff. |
| `@testing-library/dom` — calculator | `^10.4.1` → 10.4.1 → **10.4.2** | Dev; patch | Test-only; include with test tooling refresh, run calculator suite. |
| `jsdom` — calculator | `^30.0.1` → 30.0.1 → **30.1.1** | Dev; minor | DOM test-environment behavior; run calculator suite. |
| `framer-motion` — calculator, mockup | catalog `^13.2.0` → 13.2.0 → **13.4.3** | Dev declarations; minor | Prior inventory found no frontend imports; recheck usage, then both builds/typechecks. |
| `lucide-react` — calculator, mockup | catalog `^1.45.0` → 1.45.0 → **1.48.0** | Dev declarations; minor | Icon export/render compatibility; check both builds and key icon views. |
| `react-resizable-panels` — calculator, mockup | `^4.12.4` → 4.12.4 → **4.13.3** | Dev declarations; minor | Layout behavior; check frontend typechecks/builds and panel resize in a focused browser smoke if updated. |
| `tailwind-merge` — calculator, mockup | catalog `^3.6.0` → 3.6.0 → **3.7.0** | Dev declarations; minor | Class conflict behavior; check builds and affected component styling. |
| `typescript` — root, API spec | root `~6.0.3`, API spec exact `6.0.3` → 6.0.3 → **7.0.2** | Dev; major | **Intentional deferral.** Existing TypeScript 7 comparison alias, editor/TypeDoc/codegen constraints and promotion gates govern this; do not schedule a normal upgrade. |

The 20 rows represent all names returned by the direct-workspace outdated
query. A name can appear in more importers than the abbreviated area column;
the source of truth for the full importer set is `pnpm-lock.yaml`. `react`,
`react-dom`, `pnpm`, and the Node executable did not appear as direct package
updates in that result; Node and pnpm are tracked separately as toolchains.

## Security and override boundaries

Ran the existing production command with fresh writable caches:

```text
pnpm run audit:prod:release
  -> pnpm audit --prod --audit-level high
  -> exit 0; "No known vulnerabilities found"
bash scripts/src/run-release-node.sh pnpm run audit:prod:release
  -> Node 24.20.0, pnpm 11.5.2; exit 0; "No known vulnerabilities found"
pnpm audit --audit-level high
  -> exit 0; "No known vulnerabilities found"
```

The last command includes development dependencies; the first two use only
pnpm's production graph. None used `--ignore-registry-errors`. These are
successful registry responses **at the high-severity threshold**, not proof
that there are no lower-severity, unpublished, or future advisories. No
security-driven direct upgrade is evidenced by these commands. Registry
latency warnings affected the outdated query, not the reported audit result;
there was no registry outage in this snapshot. Repeat both audits when
implementing upgrades.

Override spot-check against lockfile package keys found active pins for
`adm-zip`, `browserslist`, `body-parser`, `protobufjs`, `fast-uri`,
`js-yaml`, `vitest`, `@vitest/mocker`, `undici`, `esbuild`, `linkify-it`,
`markdown-it`, `qs`, `postcss`, `@babel/core`, and both guarded
`brace-expansion` lines. No package key currently starts with `image-size@`
or `uuid@`; that **does not** establish those protective overrides are stale
or safe to remove (a future resolution can reintroduce them). The security
pins and one-day release-age policy remain unchanged. In particular, the
Vitest 5.0.1 registry result is **not** a reason to remove or silently bypass
the coupled 5.0.0 overrides.

## Ordered recommendation

1. **Separate implementation candidate:** refresh the AI integration
   dependencies (`@google/genai`, `openai`, `p-limit`) with provider-boundary
   checks; the two minor versions warrant more than a lockfile-only update.
2. **Separate implementation candidate:** evaluate the DB pair
   (`drizzle-orm`, `drizzle-kit`) without generating/applying schema changes;
   keep runtime and migration-tool validation together.
3. **Later, bounded tooling/client slices:** consider Orval/Zod generated
   contract updates independently of TypeScript 7, and a small frontend/test
   tooling patch batch with the checks specified above. These are maintenance
   candidates, not security emergencies. Keep the exact Vitest overrides
   coupled until proven compatible.
4. **Already drafted, not duplicate follow-ups:** pnpm 12 and Replit Node
   alignment have existing project tasks. TypeScript 7 remains on its own
   explicit promotion track. This inventory neither changes those pins nor
   approves any of those migrations.