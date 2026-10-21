# Local AI Installation Research — Removing the External API Dependency

__Date:__ 2026\-09\-26 __Question:__ Can the app’s AI run *in the app itself* so no external API \(Gemini/Replit integration\) is needed? __Context:__ Production Run Calculator — web app \(React 19 \+ Vite, floor\-staff kiosk/tablet browsers, Floor Mode\), Express 5 API on Render \(autoscale, cold starts\), Postgres\. AI portfolio after the 2026\-09\-05 audit retains only: spec workbook parsing \(large structured output\), spec photo transcription \(vision\), unresolved\-name matching \(cheap\), photo stock intake \(vision\)\. All model calls flow through @workspace/integrations\-openai\-ai\-server — an OpenAI\-shaped adapter over @google/genai \(~30 call sites, pickModel\("cheap"|"full"\)\)\. Current incident history: Google retired gemini\-2\.5\-flash \(404\) and broke all Render imports for days until PR \#81 moved to gemini\-3\.6\-flash\.

<a id="what-no-api-can-mean-three-architectures"></a>## What “no API” can mean — three architectures

Option

Where inference runs

External dependency

Fits this app?

__A\. In\-browser__

Each client device \(WebGPU/WASM\)

None after model download

Weak fit \(see below\)

__B\. Self\-hosted sidecar__

Your own server/VPS next to the API \(Ollama / llama\.cpp / LocalAI\)

None \(your hardware\)

__Strong fit__

__C\. Browser\-native Prompt API__

Chrome’s bundled Gemini Nano

Chrome desktop only, Google hardware gate

Not applicable \(kiosk tablets, needs Chrome desktop \+ 4GB VRAM \+ 22GB disk\)

<a id="X577df70324893b734626dcf83f51a25b679fd41"></a>## Option A — In\-browser inference \(WebLLM / Transformers\.js\)

2026 state of the art: WebLLM 0\.2\.85 \(163 prebuilt models, Qwen3/Qwen3\.5 0\.8B–9B, Llama 3\.2 1B/3B, Phi\-4\-mini, Gemma3 1B, DeepSeek\-R1 distills; OpenAI\-compatible chat\.completions surface\), Transformers\.js 4\.3\.0 \(WebGPU \+ WASM fallback; embeddings/ASR/vision/classification beyond chat\), Chrome Prompt API \(desktop\-only\)\. WebGPU is now broadly shipped: Chrome/Edge 113\+, Chrome Android 121\+, Safari 26, Firefox 141\+ \(partial\)\.

__Why it fails for this app’s real workload:__ 1\. __The core retained job is spec\-workbook extraction__ — messy, multi\-sheet, structured\-output parsing where the audit rated Gemini\-class quality as the entire value proposition \(“the clearest labor\-saving AI workflow,” 5/5 necessity\)\. A 1–3B quantized model in a browser tab will not match gemini\-3\.6\-flash on messy spreadsheet semantics\. Quality regression directly attacks the one AI feature the audit said to protect\. 2\. __Vision \(spec photos, stock intake\) in\-browser is possible but weak/slow__ — SmolVLM\-class models are ~1–2GB downloads and materially worse than server vision models\. 3\. __Per\-device model distribution on shared floor hardware\.__ Every kiosk tablet downloads and caches 0\.7–4GB of weights; cache eviction, storage pressure, and first\-load delays become a support burden for non\-technical floor staff\. Your users’ GPUs are not your GPUs — performance is unpredictable across the device fleet\. 4\. __Floor devices are Android tablets/phones in Chrome__ — WebGPU exists \(121\+\) but thermals and memory pressure make multi\-minute vision parses likely\.

__Where A *is* viable:__ the cheap tier only — unresolved\-name matching \(Qwen3\-0\.6B / SmolLM2\-360M\-class, sub\-GB download\) as an offline\-friendly enhancement\. Even then, the existing deterministic matcher \+ alias memory already resolves most cases; the marginal value is small\.

<a id="Xcf3895598fd7ebf70b45460a8f228bf492383ee"></a>## Option B — Self\-hosted local model server \(recommended research direction\)

Run an OpenAI\-compatible inference server you operate: __Ollama__ \(managed model catalog, one\-command install, built\-in REST API, native \+ OpenAI\-compatible endpoints, structured output via format: "json" or JSON schema, vision via Qwen\-VL/Gemma 3/Llama 4 multimodal\) or __llama\-server__ \(raw llama\.cpp; ~1\.8× faster in benchmarks, grammar/JSON\-schema constraints, Prometheus metrics, more control; steeper ops\) or __LocalAI__ \(multi\-backend, text\+image\+audio in one endpoint, Docker\-first, more config\)\.

__Why it fits this codebase unusually well:__ 1\. __The adapter seam already exists\.__ All ~30 call sites speak the OpenAI chat\.completions\.create\(\{model, messages, response\_format, max\_completion\_tokens, stream?\}\) surface\. Ollama/llama\.cpp expose /v1/chat/completions\. You rewrite one adapter module \(swap @google/genai internals for an OpenAI client pointed at http://localhost:11434/v1\), keep pickModel, keep streaming, keep the mock contract\. No route changes\. 2\. __Structured output is a first\-class citizen__ on both \(Ollama format: json\-schema; llama\.cpp grammars \+ response formats\) — spec\-parse routes already demand schema\-validated JSON\. 3\. __Vision input maps directly__ \(base64 image messages; Ollama’s multimodal engine handles preprocessing\)\. 4\. __Eliminates the incident class that just hurt you\.__ The gemini\-2\.5\-flash 404 outage took down every AI import on Render\. A pinned local GGUF never changes underneath you; upgrades become deliberate, testable events gated by the corpus benchmark\. 5\. __Cost controls become capacity planning__ — per\-token cost/rate limiting middleware can stay \(it now guards RAM/queue slots\), but there is no external billing\.

__Hard constraints to research before committing:__ 1\. __Render cannot host it\.__ Autoscale web instances have no GPU and limited RAM; a Q4 8B model needs ~5–6GB \+ KV cache\. You need a separate always\-on host: GPU VPS \(~$50–200/mo\), a used workstation on the plant network, or an on\-prem mini\-PC\. Latency from the API server to the model host must stay low \(same LAN/region\)\. 2\. __Quality gate is non\-negotiable\.__ The audit’s acceptance standard is the retained corpus benchmark, not vibes\. Before switching: run the spec\-import corpus harness against Qwen3\-8B / Gemma\-3\-12B / Qwen2\.5\-VL on the candidate hardware; compare discrepancy rates against gemini\-3\.6\-flash \(PR \#81’s baseline\); only retire Gemini if local meets the bar\. Expect to bump SPEC\_PARSE\_VERSION again \(40 → 41\) to invalidate cached parses\. 3\. __Ops burden is real\.__ Model pulls, keep\-alive tuning, KV\-cache sizing, monitoring\. Ollama is the right starting point \(appliance model\); graduate to llama\-server only if you can name the control you need\. 4\. __Cold starts and readiness\.__ Your Render autoscale already bit you once \(lazy\-chunk warm\-up fix\)\. A remote model host needs its own warm\-up/health contract in the readiness dependency check \(same pattern as PR \#79’s GOOGLE\_API\_KEY fix\)\.

<a id="Xdc62736535aa4af1c72507ca14feb375b512a36"></a>## Option C — Chrome Prompt API \(recorded for completeness\)

Stable since Chrome 148 \(May 2026\), Gemini Nano bundled: zero download in your bundle, but Chrome\-desktop\-only, requires >4GB VRAM and 22GB free disk, model can be evicted\. Floor staff run Android tablets/kiosks — inapplicable\.

<a id="recommended-path-phased"></a>## Recommended path \(phased\)

__Phase 0 — Benchmark \(decision gate, ~1–2 days\):__ Stand up Ollama on any machine with a GPU \(or rented GPU hour\)\. Run the existing corpus harness against qwen3:8b \(text\) and qwen2\.5vl:7b / gemma3:12b \(vision\) on the spec\-parse and matching routes\. Compare against the PR \#81 Gemini baseline\. Decide keep/switch per route — a hybrid \(local for cheap matching, Gemini for full extraction\) is fully legitimate\.

__Phase 1 — Adapter swap:__ Rewrite @workspace/integrations\-openai\-ai\-server internals as an OpenAI\-compatible client with LOCAL\_AI\_BASE\_URL; keep pickModel mapping to local model names; preserve the vi\.mock contract \(every test mock must still export pickModel \+ AI\_MODELS\)\.

__Phase 2 — Hardening:__ readiness dependency on the model host; cost\-limit middleware reinterpreted as concurrency/RAM guards; corpus benchmark wired into CI as the acceptance gate \(the audit already names this artifact\); SPEC\_PARSE\_VERSION bump; keep Gemini behind an env flag as optional fallback during the transition \(this is also the sanctioned cross\-provider fallback from the \#11 research\)\.

__Phase 3 — Decommission external AI \(optional\):__ remove Gemini env vars from Render, delete the @google/genai dependency, retire Replit AI Integration\.

<a id="non-goals-do-not"></a>## Non\-goals / do\-not

- Do not put a 1B\-class browser model on the spec\-parse path \(quality floor is the product\)\.
- Do not co\-locate the model on Render web instances \(RAM/GPU\)\.
- Do not skip the corpus benchmark — the 2026\-09\-05 audit made it the acceptance standard for exactly this kind of change\.

<a id="sources"></a>## Sources

- Run an LLM Inside a Browser Tab \(Pinggy, 2026\-09\-20\) — WebLLM 0\.2\.85, Transformers\.js 4\.3\.0, WebGPU matrix, Chrome Prompt API
- Transformers\.js vs Web\-LLM \(Zen van Riel, 2026\-05\-06\) — LLM vs non\-LLM task split
- llama\.cpp vs Ollama in 2026 \(glukhov\.org, 2026\-09\-11\) — runtime comparison, migration path
- Ollama vs llama\.cpp \(aiagentskit, 2026\-03\-02\) — ~1\.8× throughput delta, multimodal matrix
- Running LLMs Locally in 2026 \(daily\.dev, 2026\-03\-24\) — OpenAI SDK base\_url swap pattern, hardware needs

