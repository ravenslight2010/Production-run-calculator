# syntax=docker/dockerfile:1

########## builder: install deps, build web + api ##########
FROM node:24-slim AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.5.2  # keep in sync with packageManager in package.json
WORKDIR /app

# Copy the complete workspace dependency graph before application source. Keep
# this list aligned with pnpm-workspace.yaml so source-only changes can reuse the
# frozen-lockfile install layer without omitting any workspace package.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/package.json
COPY artifacts/run-calculator/package.json ./artifacts/run-calculator/package.json
COPY lib/ai-memory/package.json ./lib/ai-memory/package.json
COPY lib/ai-review/package.json ./lib/ai-review/package.json
COPY lib/allergen/package.json ./lib/allergen/package.json
COPY lib/anomaly/package.json ./lib/anomaly/package.json
COPY lib/api-client-react/package.json ./lib/api-client-react/package.json
COPY lib/api-spec/package.json ./lib/api-spec/package.json
COPY lib/api-zod/package.json ./lib/api-zod/package.json
COPY lib/cheese-import/package.json ./lib/cheese-import/package.json
COPY lib/cheese-recipes/package.json ./lib/cheese-recipes/package.json
COPY lib/cheese-reconcile/package.json ./lib/cheese-reconcile/package.json
COPY lib/corpus-harness/package.json ./lib/corpus-harness/package.json
COPY lib/cycle-count/package.json ./lib/cycle-count/package.json
COPY lib/day-summary/package.json ./lib/day-summary/package.json
COPY lib/db/package.json ./lib/db/package.json
COPY lib/downtime-trends/package.json ./lib/downtime-trends/package.json
COPY lib/fill-missing/package.json ./lib/fill-missing/package.json
COPY lib/formula-guard/package.json ./lib/formula-guard/package.json
COPY lib/freezer-pull/package.json ./lib/freezer-pull/package.json
COPY lib/incident-cluster/package.json ./lib/incident-cluster/package.json
COPY lib/ingredient-catalog/package.json ./lib/ingredient-catalog/package.json
COPY lib/integrations-openai-ai-server/package.json ./lib/integrations-openai-ai-server/package.json
COPY lib/inventory-math/package.json ./lib/inventory-math/package.json
COPY lib/merge-suggest/package.json ./lib/merge-suggest/package.json
COPY lib/mixes/package.json ./lib/mixes/package.json
COPY lib/mix-reconcile/package.json ./lib/mix-reconcile/package.json
COPY lib/named-recipes/package.json ./lib/named-recipes/package.json
COPY lib/name-match/package.json ./lib/name-match/package.json
COPY lib/onboarding/package.json ./lib/onboarding/package.json
COPY lib/premix-import/package.json ./lib/premix-import/package.json
COPY lib/production-rules/package.json ./lib/production-rules/package.json
COPY lib/profile-cleanup/package.json ./lib/profile-cleanup/package.json
COPY lib/recipe-apply/package.json ./lib/recipe-apply/package.json
COPY lib/recipe-guide-import/package.json ./lib/recipe-guide-import/package.json
COPY lib/scheduled-recipe-check/package.json ./lib/scheduled-recipe-check/package.json
COPY lib/schedule-move/package.json ./lib/schedule-move/package.json
COPY lib/schedule-optimize/package.json ./lib/schedule-optimize/package.json
COPY lib/setup-math-check/package.json ./lib/setup-math-check/package.json
COPY lib/shipping-import/package.json ./lib/shipping-import/package.json
COPY lib/spec-export/package.json ./lib/spec-export/package.json
COPY lib/spec-import/package.json ./lib/spec-import/package.json
COPY lib/spec-reconcile/package.json ./lib/spec-reconcile/package.json
COPY scripts/package.json ./scripts/package.json
RUN pnpm install --frozen-lockfile

# Application source is intentionally copied only after dependencies install.
COPY . .

# Build the web app (served at the domain root) and the API server bundle.
# Deployment systems can provide VITE_APP_VERSION (or a Replit deployment id).
# Keep a timestamped container fallback so incident reports never carry an
# empty/local identifier from a production Docker build.
ARG VITE_APP_VERSION
ARG REPLIT_DEPLOYMENT_ID
RUN PORT=3000 BASE_PATH=/ \
    VITE_APP_VERSION="${VITE_APP_VERSION:-${REPLIT_DEPLOYMENT_ID:-docker-$(date -u +%Y%m%d%H%M%S)}}" \
    pnpm --filter @workspace/run-calculator run build \
  && pnpm --filter @workspace/api-server run build

########## api-migrate-runtime: only the DB package + migration dependencies ##########
# Render runs the migration as a pre-deploy command in the API image. Deploying
# just this workspace package keeps that compatibility without copying the full
# builder dependency graph into the long-lived server image.
FROM builder AS api-migrate-runtime
RUN rm -rf /app/migration \
  && CI=true pnpm --filter @workspace/db deploy --legacy /app/migration

########## api-migrate: full workspace image for local/CI one-shot schema pushes ##########
# Keep this target compatible with `pnpm --filter @workspace/db run push-force`.
# It intentionally retains the source and development dependencies that the
# workspace command needs; it is not the image deployed for API traffic.
FROM builder AS api-migrate
CMD ["pnpm", "--filter", "@workspace/db", "run", "push-force"]

########## api-runtime-deps: production dependencies externalized by esbuild ##########
FROM builder AS api-runtime-deps
RUN rm -rf /app/api-runtime \
  && CI=true pnpm --filter @workspace/api-server deploy --legacy --prod /app/api-runtime

########## api: slim image for the bundled server ##########
FROM node:24-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/run-calculator/dist/public ./artifacts/run-calculator/dist/public
COPY --from=api-runtime-deps /app/api-runtime/node_modules ./node_modules
COPY --from=api-migrate-runtime /app/migration ./migration
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

########## web: static files served by Caddy (also gives HTTPS) ##########
FROM caddy:2-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/artifacts/run-calculator/dist/public /srv
