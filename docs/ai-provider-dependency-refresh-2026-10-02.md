# AI provider dependency refresh — 2026-10-02

This records the bounded AI integration dependency update and its release-age
and compatibility checks. It does not change providers, prompts, models, API
responses, or production data.

## Version selection

Registry metadata was checked on 2026-10-02 at 01:47 UTC through the pinned
Node 24.20.0 and workspace pnpm 12.6.0. The workspace minimum release age
remains 1440 minutes.

| Package | Locked before | Selected | Registry latest at check | Decision |
| --- | --- | --- | --- | --- |
| `@google/genai` | 2.22.0 | 2.25.0 | 2.26.0 | 2.26.0 was published 2026-10-01 23:52 UTC and deferred because it was under 24 hours old. 2.25.0 was published 2026-09-30 22:51 UTC and met the age rule. |
| `openai` | 7.15.0 | 7.25.0 | 7.27.0 | 7.27.0 (2026-10-01 23:10 UTC) and 7.26.0 (2026-10-01 21:22 UTC) were under 24 hours old and deferred. 7.25.0 was the newest eligible release. |
| `p-limit` | 7.3.2 | 7.3.3 | 7.3.3 | Eligible; published 2026-09-18. |

The selected versions are within their existing semver-compatible dependency
lines. The Google SDK requires Node `>=20`; OpenAI requires Node `>=22`; and
`p-limit` requires Node `>=20`, all compatible with the pinned Node 24.20.0.
Google's MCP SDK peer is optional. OpenAI's peers are optional and accept the
locked `ws@8.21.3`, `zod@4.6.2`, and `undici@7.29.0`; the remaining optional
AWS/Smithy peers are not required by this integration.

The pre-update production audit completed with zero advisories.

## Verification

- Frozen install: `bash scripts/src/run-release-node.sh pnpm install --frozen-lockfile` passed.
- Focused provider/retry/concurrency tests: 3 files and 15 tests passed (`geminiAdapter.test.ts`, `aiJsonRetry.test.ts`, and `aiIntegrationBatch.test.ts`).
- API and integration typecheck: `pnpm --filter @workspace/api-server run typecheck` passed; this also builds the integration package's TypeScript project.
- API build: `pnpm --filter @workspace/api-server run build` passed.
- Production security audit: `pnpm run audit:prod` passed with no known vulnerabilities.