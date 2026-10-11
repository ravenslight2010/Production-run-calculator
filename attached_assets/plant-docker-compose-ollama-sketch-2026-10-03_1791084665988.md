# Plant Docker Compose + Ollama Sketch

**Date:** 2026-10-03  
**Base:** existing root `docker-compose.yml` on `Replit` (`db`, `migrate`, `api`, `web`)  
**Goal:** LAN deploy with **no public internet**; AI via local OpenAI-compatible Ollama; clients only reach `web`/`api`.

This is a **sketch for Replit / ops to adapt** — not a committed file. Prefer compose **profiles** or an override file so Replit/cloud deploys stay unchanged.

---

## 1. Current compose (summary)

```yaml
services:
  db:        postgres:16-alpine
  migrate:   one-shot schema push
  api:       build target api, expose 5000, env_file .env
  web:       build target web, ports 80/443, Caddy volumes
volumes: db-data, caddy-data, caddy-config
```

---

## 2. Recommended approach: override file

Keep `docker-compose.yml` as-is. Add:

**`docker-compose.plant.yml`** (merge with `-f docker-compose.yml -f docker-compose.plant.yml`)

```yaml
# Plant / LAN profile — local AI sidecar. Do not use on public Replit as-is.
services:
  ollama:
    image: ollama/ollama:0.12.3   # PIN a tested tag; do not use floating latest in prod
    container_name: prc-ollama
    restart: unless-stopped
    environment:
      OLLAMA_HOST: 0.0.0.0:11434
      OLLAMA_KEEP_ALIVE: 24h
      OLLAMA_CONTEXT_LENGTH: "32768"
      OLLAMA_NUM_PARALLEL: "1"
      OLLAMA_MAX_LOADED_MODELS: "1"
    volumes:
      - ollama-data:/root/.ollama
    # Do NOT publish 11434 to the host/LAN by default.
    # Only the api container should reach Ollama on the compose network.
    expose:
      - "11434"
    healthcheck:
      test: ["CMD-SHELL", "ollama list >/dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 40s
    # Uncomment when NVIDIA Container Toolkit is installed on the plant host:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

  api:
    environment:
      # Merge with env_file; these force plant AI behavior when override is used
      AI_MODE: local_only
      LOCAL_AI_BASE_URL: http://ollama:11434/v1
      LOCAL_AI_API_KEY: ollama
      LOCAL_AI_MODEL: qwen2.5-coder:14b
      # LOCAL_AI_TIMEOUT_MS: "120000"
    depends_on:
      ollama:
        condition: service_healthy

volumes:
  ollama-data:
```

**Bring up plant stack:**

```bash
docker compose -f docker-compose.yml -f docker-compose.plant.yml up -d
```

**Replit / public:** continue using only `docker-compose.yml` (no Ollama service).

---

## 3. Plant `.env` additions (illustrative)

Add to plant `.env` (never commit secrets):

```bash
# AI — plant offline
AI_MODE=local_only
LOCAL_AI_BASE_URL=http://ollama:11434/v1
LOCAL_AI_API_KEY=ollama
LOCAL_AI_MODEL=qwen2.5-coder:14b

# Existing app secrets unchanged:
# POSTGRES_*, SITE_ADDRESS, session secrets, etc.

# Explicitly unset or omit cloud keys on air-gapped hosts:
# GOOGLE_API_KEY=
# AI_INTEGRATIONS_GEMINI_API_KEY=
```

---

## 4. Model preload (offline-friendly)

### Online build machine (once)

```bash
docker compose -f docker-compose.yml -f docker-compose.plant.yml up -d ollama
docker exec -it prc-ollama ollama pull qwen2.5-coder:14b
# optional fallback:
docker exec -it prc-ollama ollama pull qwen2.5:7b
docker exec -it prc-ollama ollama list
```

### Air-gap transfer

1. On connected host: pull models into `ollama-data` volume or export blobs.  
2. Checksum archive.  
3. Copy via USB to plant host.  
4. Restore volume / import; **never** rely on `ollama pull` at plant runtime.

Document exact export/import commands in `docs/plant-model-update-runbook.md` when ops finalizes the host OS.

---

## 5. Network / security notes

| Rule | Why |
|------|-----|
| Tablets → only `web` :80/:443 | Never point browsers at Ollama |
| Ollama only `expose`, not `ports: "11434:11434"` | Avoid unauthenticated LAN model API |
| If debugging from host needed | Temporarily `127.0.0.1:11434:11434` only |
| Firewall | No required outbound internet for core + local AI |
| GPU | Enable NVIDIA deploy block only after toolkit verified |

---

## 6. Health expectations

| Endpoint | Expectation |
|----------|-------------|
| `/api/livez` | 200 if process up |
| `/api/readyz` | 200 if db + startup + auditProtection ok; AI optional |
| `capabilities.ai` | `configured` when local adapter sees `LOCAL_AI_BASE_URL` (and optionally probe) |

If Ollama is down and `AI_MODE=local_only`, AI routes fail soft; production runs / sync still work.

---

## 7. Resource sizing (reminder)

| Host | Suitable models |
|------|-----------------|
| CPU-only mini PC | 7B class only; slow interactive |
| 24 GB VRAM workstation | 14B–32B Q4 coding models — practical plant assist |
| Preload context | `OLLAMA_CONTEXT_LENGTH=32768` minimum for tool/JSON work |

---

## 8. Verification script (manual)

```bash
# After up:
curl -sS http://127.0.0.1/api/readyz | jq .
# From inside api container:
curl -sS http://ollama:11434/api/tags
# Smoke AI route (auth as needed):
# POST a small JSON extract against local model — expect structured body or clear unavailable
```

---

## 9. Rollout order

1. Land **LOCAL_AI adapter** (checklist companion doc) + tests.  
2. Add `docker-compose.plant.yml` + plant env example (no Replit default change).  
3. Preload model on a test host; run import/chat offline smoke.  
4. Plant runbook: USB model update, GPU drivers, backup of `ollama-data`.  
5. Only then enable plant UI AI features under feature flags.

---

## 10. Explicit non-goals

- Changing Replit production compose to require GPU  
- Publishing Ollama to the internet  
- Auto-downloading models on first plant boot  
- Making AI a hard dependency of `/readyz`

---

*Sketch 2026-10-03 — plant compose overlay for Ollama + existing PRC stack.*
