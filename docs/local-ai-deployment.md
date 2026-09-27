# Local AI Deployment Runbook

This document explains how to run the app's AI features against a **self-hosted
OpenAI-compatible model server** (Ollama or llama.cpp) instead of Gemini, with
no external API key and no per-token billing.

The adapter (`lib/integrations-openai-ai-server`) chooses its backend from one
environment variable:

| `LOCAL_AI_BASE_URL` | Backend |
| --- | --- |
| unset / empty | Gemini (Replit AI Integrations proxy or direct `GOOGLE_API_KEY`) — unchanged default |
| set | The OpenAI-compatible server at that URL (Ollama / llama.cpp) |

## Option 1 — Bundled Docker Compose overlay (recommended)

The repository ships an overlay that starts Ollama, pulls the configured
models once, and points the API at it automatically:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-ai.yml up -d
```

What it does:

1. Starts `ollama` (pinned to `ollama/ollama:0.34.4`) with a persistent
   `ollama-models` volume.
2. Runs the one-shot `ollama-pull` service, which pulls `LOCAL_MODEL_FULL`
   (default `qwen3:14b`) and `LOCAL_MODEL_CHEAP` (default `qwen3:4b`).
3. Starts `api` with `LOCAL_AI_BASE_URL=http://ollama:11434/v1`, waiting for
   the model pull to finish so the first request never races a cold download.

The base `docker compose up` is unaffected — without the overlay the API keeps
using Gemini.

### Hardware note

The default full-tier model (`qwen3:14b`) needs roughly 10 GB of RAM/VRAM. On
smaller hosts, override the tiers, e.g.:

```bash
LOCAL_MODEL_FULL=qwen3:4b LOCAL_MODEL_CHEAP=qwen3:0.6b \
  docker compose -f docker-compose.yml -f docker-compose.local-ai.yml up -d
```

## Option 2 — Point at your own server

Run Ollama or llama.cpp anywhere the API can reach, then set the variables in
`.env` (see `.env.docker.example`):

```dotenv
LOCAL_AI_BASE_URL=http://host.docker.internal:11434/v1
LOCAL_AI_API_KEY=ollama
LOCAL_MODEL_FULL=qwen3:14b
LOCAL_MODEL_CHEAP=qwen3:4b
```

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOCAL_AI_BASE_URL` | _(unset)_ | Enables the local backend when set. OpenAI-compatible base, e.g. `http://ollama:11434/v1`. |
| `LOCAL_AI_API_KEY` | `local` | Placeholder key; most local servers ignore it. Set it for a keyed reverse proxy. |
| `LOCAL_MODEL_FULL` | `qwen3:14b` | Model for the "full" tier (extraction / vision). |
| `LOCAL_MODEL_CHEAP` | `qwen3:4b` | Model for the "cheap" tier (matching / classification). |
| `LOCAL_AI_FALLBACK_TO_GEMINI` | `false` | When `true`, retries Gemini **only** on transport-level local failures (connection refused / DNS / timeout / 5xx). Validation errors (4xx) and caller cancellation never fall back. |
| `LOCAL_AI_STRICT_READINESS` | `false` | When `true`, `/healthz` readiness fails if the local model host is unreachable. |

## Verifying a deployment

The adapter ships with a smoke check that exercises the real dispatch path:

```bash
# Against the configured server (uses LOCAL_AI_BASE_URL):
LOCAL_AI_BASE_URL=http://localhost:11434/v1 pnpm --filter @workspace/scripts run check:local-ai

# Offline (no server, no download): boots an in-process mock OpenAI-compatible
# server and proves the local path end to end.
pnpm --filter @workspace/scripts run check:local-ai
```

The check performs a non-stream completion and a streaming completion, and (in
mock mode) asserts that a transport failure surfaces as an error rather than a
silent success. It is also wired into the `@workspace/scripts` test chain, so
CI gates the local path on every run.

## Rolling back

Unset `LOCAL_AI_BASE_URL` (or simply omit the overlay) and the API reverts to
Gemini. No code change is required.
