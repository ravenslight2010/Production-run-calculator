# syntax=docker/dockerfile:1

########## builder: install deps, build web + api ##########
FROM node:24-slim AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm
WORKDIR /app

# Copy the whole workspace and install every package (this is a pnpm monorepo).
COPY . .
RUN pnpm install --frozen-lockfile

# Build the web app (served at the domain root) and the API server bundle.
# Deployment systems can provide VITE_APP_VERSION (or a Replit deployment id).
# Keep a timestamped container fallback so incident reports never carry an
# empty/local identifier from a production Docker build.
ARG VITE_APP_VERSION
ARG REPLIT_DEPLOYMENT_ID
RUN BASE_PATH=/ \
    VITE_APP_VERSION="${VITE_APP_VERSION:-${REPLIT_DEPLOYMENT_ID:-docker-$(date -u +%Y%m%d%H%M%S)}}" \
    pnpm --filter @workspace/run-calculator run build \
  && pnpm --filter @workspace/api-server run build

########## api: runs the bundled server ##########
# Reuses the builder image so the one-shot "migrate" service (see
# docker-compose.yml) can also run the schema push from the same image, which
# needs the source + dev dependencies. The server itself runs from the bundle.
FROM builder AS api
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

########## web: static files served by Caddy (also gives HTTPS) ##########
FROM caddy:2-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/artifacts/run-calculator/dist/public /srv
