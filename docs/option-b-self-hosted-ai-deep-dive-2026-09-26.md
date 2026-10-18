Option B Deep Dive — Self-Hosted Local Model Server (Ollama / llama.cpp)
Date: 2026-09-26 Goal: Replace the Gemini dependency (Replit AI Integration / direct API) with a self-hosted OpenAI-compatible inference server, so AI runs on infrastructure you control with no external API keys or per-token billing. Grounding: Actual source of lib/integrations-openai-ai-server on main (client.ts, models.ts, package.json).
0. The key discovery: your adapter is already 90% compatible
From lib/integrations-openai-ai-server/package.json:
"dependencies": {  "@google/genai": "^2.22.0",  "openai": "^7.15.0",      // <-- already installed, currently unused  ...}
The openai package is already a dependency of the adapter workspace. The rest of the server (~30 call sites, plus web/mobile clients via generated contracts) only ever touches:
openai.chat.completions.create({ model, messages, response_format, max_completion_tokens, stream? })// → { choices: [{ message: { content } }] }  or  async iterable of { choices: [{ delta: { content } }] }
That is exactly the surface of Ollama’s /v1/chat/completions and llama.cpp’s OpenAI-compatible server. This is a one-module rewrite, not an integration project.
1. Current adapter mechanics that change or disappear
| Current (Gemini client.ts) | Local OpenAI-compatible endpoint |
| --- | --- |
| new GoogleGenAI({ apiKey, httpOptions: { apiVersion:"", baseUrl } }) | new OpenAI({ baseURL: process.env.LOCAL_AI_BASE_URL ?? "http://localhost:11434/v1", apiKey: "ollama" }) |
| system→systemInstruction translation | Native — delete toGemini() entirely |
| thinkingConfig: { thinkingLevel: LOW } | Delete — local models don’t burn a shared output pool; the MAX_TOKENS starvation class disappears |
| response_format:{type:"json_object"} → responseMimeType | Native response_format — but see §3 for the Ollama vs llama.cpp schema-strictness difference |
| dataUriToInlineData() for vision | Native image_url data-URI parts (both servers accept base64) — delete the translator |
| resp.text ?? null null-normalization | SDK returns choices[0].message.content string; keep a ?? null guard for empty content |
| Replit proxy vs GOOGLE_API_KEY dual path | Single LOCAL_AI_BASE_URL; keep the Gemini client behind an env flag as optional fallback (see §7) |

Test-mock contract is preserved automatically: every vi.mock("@workspace/integrations-openai-ai-server") factory expects { openai, AI_MODELS, pickModel } — keep those three exports and no test changes.
models.ts becomes:
export const AI_MODELS = {  full: process.env.LOCAL_MODEL_FULL ?? "qwen3:14b",  cheap: process.env.LOCAL_MODEL_CHEAP ?? "qwen3:4b",} as const;
2. Runtime choice: Ollama first, llama.cpp when you can name the reason
|  | Ollama | llama-server (llama.cpp) |
| --- | --- | --- |
| Install/ops | Appliance model — one binary, systemd unit, model catalog | You manage flags, slots, KV cache |
| OpenAI surface | /v1/chat/completions supported; response_format support has historically been partial in the compat endpoint (native /api/chat format is the reliable path) | Full response_format incl. JSON-schema via grammar constraints — strictest structured output |
| Throughput (2026 benchmarks) | Baseline | ~1.8× Ollama on identical hardware |
| Vision | Multimodal engine, qwen2.5vl, gemma3, llama3.2-vision | Direct mmproj support |
| Metrics | Basic | Prometheus + per-slot telemetry |
| Right when… | You want it working this week | Schema-strictness or throughput becomes the bottleneck |

Recommendation: start with Ollama, but validate response_format: {type:"json_object"} behavior on the compat endpoint against your spec-parse routes in the Phase-0 benchmark (your routes already run zod canonicalization + retry on malformed JSON, so a soft gap is survivable — but know it before you commit). If per-route JSON-schema validation proves necessary to hold extraction quality, move to llama-server — its grammar-backed schema support is the strictest available on any OpenAI-compatible server.
3. Model selection per workload tier
Your retained portfolio (post-audit) maps to three model needs:
| Workload | Tier | Candidate models (Q4) | Resident RAM/VRAM | Notes |
| --- | --- | --- | --- | --- |
| Name matching, fill-missing, merge candidates (cheap) | 1.7–4B | qwen3:4b (or 1.7b) | ~2.5–3.5GB | High-volume, low-stakes; deterministic matcher still runs first per gates policy |
| Spec workbook parsing (full) | 12–14B | qwen3:14b, gemma3:12b | ~8–9GB | The quality-critical route; benchmark decides |
| Spec photos, stock intake (vision) | 7–12B VLM | qwen2.5vl:7b, gemma3:12b-v | ~5–9GB | Vision quality is the biggest open question — measure |

VRAM reality: a 24GB card (used RTX 3090/4090) holds qwen3:14b Q4 + qwen2.5vl:7b Q4 concurrently (≈15GB) with room for KV cache — both tiers stay warm. A 16GB card (4060 Ti) forces an 8B text ceiling or model-swapping; a swap is a 10–30s first-token delay on an import click — unacceptable on a floor kiosk unless pre-warmed.
4. Hardware & network topology
Render cannot host the model (no GPU, autoscale RAM). Three viable topologies:
On-prem GPU workstation on the plant LAN (recommended) — used RTX 3090 24GB tower (~$800–1,200 one-time). Latency to floor devices is irrelevant (calls originate from the Render-hosted API, not the floor). But Render (cloud) → plant LAN needs a secure tunnel: Tailscale/WireGuard between the Render service and the box, or a TLS+API-key reverse proxy with firewall allow-listing. Binding Ollama to 0.0.0.0 unexposed on the public internet is mandatory.
Colocated GPU VPS (same region as Render, ~$100–200/mo) — simplest networking (private networking or low-latency public), no tunnel, but recurring cost and it’s “someone else’s computer” again (though your server, not an API).
Mini-PC (16GB) — cheapest, tightest ceiling; only if the benchmark shows 8B-class quality passes.
5. Server-side changes checklist (outside the adapter)
Readiness check (same pattern as PR #79’s GOOGLE_API_KEY fix): add the model host to the readiness dependencies — GET $LOCAL_AI_BASE_URL/api/tags (Ollama) or /health (llama.cpp). Render deploys currently have a lazy-chunk cold-start scar (PR #81); don’t add a cold model host to that list silently.
Cost middleware (rateLimitCost.ts): per-token budgets become meaningless. Two options: (a) keep the counters but map to concurrency + context-length guards (a local server degrades via queueing, not 429s — set OLLAMA_NUM_PARALLEL=2 and mirror that in middleware); (b) no-op it and rely on p-limit already in the adapter package. Recommend (a) — the middleware’s real job was never money, it was protecting the inference backend from stampedes.
Retry/sanitize (aiJsonRetry.ts): keep — local servers return 5xx under load; one bounded retry still fits.
Result cache + SPEC_PARSE_VERSION: keep the cache (now saves compute, not money). Bump 40 → 41 when the model changes so stale parses invalidate.
Streaming routes (/ai/ask, /ai/recipe-assistant SSE): OpenAI-SDK streaming works unchanged against both servers. (Both routes are audit-marked Retire anyway — don’t block the migration on them.)
Web/mobile clients: zero changes — the contract is server-internal.
6. Phase-0 benchmark protocol (the decision gate)
The 2026-09-05 audit made the corpus harness the acceptance standard. Concrete procedure:
Stand up Ollama on any GPU machine (a rented GPU hour is fine for the read).
Point the adapter at it via LOCAL_AI_BASE_URL with a minimal client rewrite (§1).
Run the retained spec-import corpus (the same harness that produced second-pass-reviewer-benchmark-2026-09-05.json) against qwen3:14b and gemma3:12b; run the photo corpus against qwen2.5vl:7b.
Compare discrepancy rates vs the gemini-3.6-flash baseline recorded at PR #81 (add it to the benchmark evidence file alongside the Node/pnpmLock provenance already tracked).
Per-route verdict: switch / keep-Gemini / hybrid. A hybrid (local for cheap matching, Gemini for full extraction) is legitimate and matches the #11 cross-provider-fallback research — it also de-risks the migration.
Latency budget: 14B Q4 on a 3090 ≈ 40–60 tok/s. Spec parse emits 1–3k tokens across workbook chunks → 30–75s per import, roughly comparable to current chunked parses; verify against production logs before promising parity.
7. Fallback policy (decide explicitly, per the gates doc)
The durable gates policy says provider failures must surface as a labeled, fail-closed “AI unavailable” state. With two providers you have a choice:
Fail-closed (policy default): local down → enrichment unavailable, deterministic workflows unaffected.
Local→Gemini fallback for the retained extraction routes only: protects the import UX during model-host outages, at the cost of keeping the Gemini dependency alive. If you choose this, the adapter needs the dual-client logic the current client() already has — keep it.
Recommend: fail-closed everywhere except spec import, where a Gemini fallback is justified (it’s the one workflow with no deterministic substitute). Record the decision in the audit doc’s portfolio table.
8. Risks
| Risk | Mitigation |
| --- | --- |
| Extraction quality regression vs Gemini | Corpus gate (§6); hybrid per-route fallback; never switch unbenchmarked |
| Model-swap latency on kiosk imports | Single GPU with both models resident (24GB), or keep-alive pre-warm at sign-in (same trick as PR #81’s lazy-chunk warm-up) |
| Ops burden / bus factor | Ollama appliance model; document in docs/; pin model digests so upgrades are deliberate |
| Security of the inference endpoint | Tailscale/WireGuard or TLS+key; never expose 11434 publicly; firewall |
| Render↔plant-LAN tunnel flakiness | Health check + fail-closed state; consider colocated VPS if the tunnel proves unreliable |
| Supply-chain | Pin model digests (ollama pull qwen3:14b@sha256:...) like you pin pnpmLockSha256 in the corpus manifest |

9. Effort estimate
| Phase | Work | Size |
| --- | --- | --- |
| 0 | Benchmark harness run (rented GPU) | 1–2 days |
| 1 | Adapter rewrite + env plumbing + readiness check | 2–4 days |
| 2 | Middleware retarget, cache/version bump, CI evidence | 2–3 days |
| 3 | Hardware procurement + network (if on-prem) | parallel, 1–2 wks elapsed |
| 4 | Retirement of Gemini path (optional) | 1 day + retention review per audit |

Total engineering: roughly 1–2 weeks. The long pole is hardware/network, not code.
