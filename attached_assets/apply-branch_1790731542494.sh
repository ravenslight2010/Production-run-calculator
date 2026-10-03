#!/usr/bin/env bash
# Apply the local-AI adapter branch. Run from your local clone root.
# Usage: bash apply-branch.sh [path-to-bundle-dir]
set -euo pipefail

BUNDLE="${1:-./branch-bundle}"
BRANCH="feat/local-ai-adapter"

git checkout main && git pull
git checkout -b "$BRANCH"

cp "$BUNDLE/client.ts"  lib/integrations-openai-ai-server/src/client.ts
cp "$BUNDLE/models.ts"  lib/integrations-openai-ai-server/src/models.ts
cp "$BUNDLE/health.ts"  artifacts/api-server/src/routes/health.ts

pnpm typecheck
pnpm test

git add lib/integrations-openai-ai-server/src/client.ts \
        lib/integrations-openai-ai-server/src/models.ts \
        artifacts/api-server/src/routes/health.ts
git commit -m "feat: local-first AI adapter with self-hosted model server support

- Env-driven provider dispatch: LOCAL_AI_BASE_URL -> OpenAI-compatible
  server (Ollama/llama.cpp); existing Gemini key paths retained
- Native OpenAI message surface on the local path (system, vision
  data-URIs, response_format); Gemini translators kept behind fallback
- Transport-level-only per-call fallback (LOCAL_AI_FALLBACK_TO_GEMINI=true);
  4xx / malformed-output never fall back
- models.ts tiers become env-driven (LOCAL_MODEL_FULL/LOCAL_MODEL_CHEAP)
- Readiness: LOCAL_AI_BASE_URL accepted as AI configuration; optional
  strict model-host probe gated by LOCAL_AI_STRICT_READINESS
- No call-site or test-mock changes (openai pkg was already a dependency)"

git push -u origin "$BRANCH"
gh pr create --draft --title "feat: local-first AI adapter (self-hosted AI, no external API)" \
  --body-file "$BUNDLE/PR_BODY.md"
echo "Draft PR created. Keep it draft until the Phase-0 corpus benchmark passes."
