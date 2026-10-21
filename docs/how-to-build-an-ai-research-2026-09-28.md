# How to Build an AI — Research Memo (mapped to Production Run Calculator)

__Date:__ 2026\-09\-28 __Question:__ What does it actually take to “build an AI,” and which path fits this project? __Sources:__ 2026 fine\-tuning cost/hardware surveys \(Spheron, vast\.ai/RunPod/Lambda pricing\), RAG\-vs\-fine\-tuning decision frameworks \(Winder\.AI 2026, The AI Engineer, IBM, Big Data Boutique\), QLoRA/LoRA literature\.

<a id="X37f75f80dac1d3d8ea3340a820aa883b66cf241"></a>## 0\. “Building an AI” is three different things people conflate

Layer

What it is

Who needs to do it

__The model__ \(pre\-training\)

Teaching a network language/reasoning from trillions of tokens on GPU clusters

Frontier labs\. Llama 3 used 15 *trillion* tokens\. Cost: millions of dollars\. Not a small\-team path\.

__The behavior__ \(fine\-tuning\)

Adjusting a pre\-trained model’s *form* — schema adherence, tone, domain phrasing, refusal patterns — on hundreds\-to\-thousands of curated examples

Any small team\. This is what “building your own AI” realistically means in 2026\.

__The application__ \(prompt → RAG → agents\)

Wiring a model into a product: prompts, retrieval over your live data, tools, evals

Every team, including this one \(already done, post\-audit\)\.

The 2026 consensus sequence: __Prompt → RAG → Fine\-tune → \(Distill\)__\. Each layer is only worth adding when the cheaper one demonstrably fails your eval harness\.

<a id="X501e11a636fbdbf877d1886408611a721de5d07"></a>## 1\. Path A — Training from scratch: what it really takes

- __Data:__ competitive models need 1–2 trillion tokens minimum; Llama 3 trained on 15T\.
- __Compute:__ thousands of GPU\-months\. Even a deliberately tiny from\-scratch “educational” LLM \(nanoGPT\-style\) is a learning exercise, not a product\.
- __Verdict for this project:__ ruled out\. Nobody building a pizza\-production app should pre\-train\. The value lives in layers B and C\.

<a id="X8558a01a8ac72563719ae29301328b6ae894bd0"></a>## 2\. Path B — Fine\-tuning: the realistic “build your own model”

<a id="economics-in-2026-verified-pricing"></a>### Economics in 2026 \(verified pricing\)

Model size

Method

GPU

VRAM

Time

Cost

7–8B

QLoRA

RTX 4090 / A100

6–20GB

2–6h

__$1–15__ \(A100 80GB marketplace rentals from ~$0\.44/hr\)

13B

QLoRA

A100 40GB

12–18GB

3–6h

$2–5

34B

QLoRA

A100 80GB

24–36GB

6–10h

$8–14

70B

QLoRA

H100 80GB

40–60GB

8–12h

$10–16

70B

Full fine\-tune

8× H100

640GB

24–48h

$250–510

QLoRA freezes the base model in 4\-bit and trains tiny adapter layers \(~0\.1–1% of parameters\); you lose ~1–2% accuracy vs full fine\-tuning — a rounding error\. Tooling: __Unsloth__ \(2–5× faster, easiest start\), HF TRL SFTTrainer, Axolotl \(multi\-GPU\), torchtune\. LoRA adapters are 50–200MB and dozens can be served from one GPU\.

<a id="data-requirements"></a>### Data requirements

1,000–5,000 high\-quality examples is a solid start; 10–50K for deeper domain behavior\. __Data curation — not compute — is the real cost__ \(guides consistently report data prep >> training time\)\.

<a id="when-fine-tuning-wins-and-when-it-doesnt"></a>### When fine\-tuning wins \(and when it doesn’t\)

- ✅ __Form, not facts__: fixed JSON schema every time, domain vocabulary, consistent tone, refusal patterns\.
- ✅ __Distillation for cost/latency__: use a frontier model as teacher to generate outputs, fine\-tune a small open model on them → near\-frontier quality on the narrow task at ~1/10th inference cost\. Strongest commercial case in 2026\.
- ❌ __Knowledge that changes__ \(prices, specs, inventory\): goes stale the moment data updates — that’s RAG/database territory\. Research \(Ovadia et al\.\) shows RAG consistently beats fine\-tuning for factual recall; baking facts into weights erodes general capability \(catastrophic forgetting\)\.

<a id="X83827c71762ea16a9417b732bcd7bba27e40392"></a>## 3\. Path C — The application layer: prompt → RAG → agents

- __Prompting__ costs one API call to test; wins more often than people admit\.
- __RAG__ \(retrieval\-augmented generation\): index your documents, retrieve relevant chunks at query time, answer from them\. Right when knowledge changes or must be cited\. Typical build: £5–40K / 1–3 weeks at consultancy rates; DIY is an afternoon over docs you already have\. Quality is capped by retrieval quality — hybrid \(lexical\+vector\) retrieval \+ a reranker is the 2026 baseline; naive 500\-token chunking is the classic failure\.
- __Agents__: multi\-step tool\-using systems\. Powerful, but per this project’s own 2026\-09\-05 audit, most agent\-shaped ideas here were scored Retire — the audit’s skepticism matches the external consensus that agents are a last layer, not a first move\.
- __Eval harness is non\-negotiable__: every serious guide lists “no eval harness” as the \#1 mistake\. Without a labeled gold set and automatic metrics you cannot tell improvement from regression\.

<a id="X4351a015a45e689c3af1b462b3e5ff47e14dcca"></a>## 4\. Where Production Run Calculator sits on this map

__Unusual advantage: the eval harness prerequisite is already satisfied\.__ lib/corpus\-harness \(spec\-import corpus, evaluation manifest, benchmark artifacts\) is exactly the “labeled gold set \+ automatic metrics” every guide says to build in week one\. Most teams don’t have this; you do\.

Your AI workload

Knowledge\- or behavior\-bound?

Right tool

Spec workbook parsing \(the 5/5\-necessity feature\)

__Behavior\-bound__ \(structured extraction form over messy spreadsheets\)

__Fine\-tune candidate__ — or keep frontier model \+ corpus\-gated prompting

Spec photo transcription

Behavior\-bound \(vision→structured\)

Fine\-tune candidate \(Qwen2\.5\-VL LoRA\) once corpus exists

Name matching / fill\-missing

Mostly solved deterministically \+ alias memory

Nothing; fine\-tuning would be waste

Inventory/pricing/staff\-facing data

Knowledge\-bound, volatile

Deterministic DB \(already built\) — never fine\-tune facts

Operational Q&A over run data

Knowledge\-bound, volatile

RAG over your Postgres — only if a real question corpus emerges \(per \#11 research\)

<a id="X5b5427bccf7bc3e1aad299eb4a1569f2ecf85d2"></a>### The interesting convergence: Option B \(self\-hosted inference\) \+ distillation

The two research threads join: you don’t have to choose between “Gemini quality” and “no external API\.” The 2026 distillation pattern fits your assets exactly:

1. __Teacher:__ keep gemini\-3\.6\-flash running via the existing adapter\.
2. __Dataset:__ run the retained spec\-import corpus through the teacher \(you already have the harness; the audit’s privacy mode even gives you a curation pattern — metadata\-only retained artifacts\)\.
3. __Student:__ QLoRA fine\-tune qwen3:8b \(or qwen2\.5vl:7b for photos\) on ~1–5K extraction examples — __$1–15 of GPU rental, a few hours__\.
4. __Evaluate:__ same corpus harness, same acceptance standard \(discrepancy rates vs the PR \#81 Gemini baseline\)\.
5. __Deploy:__ the student serves through the exact local adapter from the Option B deep dive — one GPU, no external API, model pinned by digest\.

If the student passes the corpus gate, you’ve built your own AI for the core workflow: a fine\-tuned local model whose *form* is locked to your schema, with facts still flowing from your deterministic database \(where they belong\)\.

<a id="X8ea7251e99152af0e2fa08ae35a396c836e8b75"></a>## 5\. If you actually want to run a fine\-tune — concrete recipe

1. Rent an A100 80GB \(~$0\.44–1\.39/hr: vast\.ai marketplace, RunPod, Lambda\) or use a local 24GB card for 7–8B QLoRA\.
2. pip install torch transformers peft bitsandbytes trl datasets accelerate \(or Unsloth for 2–5× speed\)\.
3. Format data as instruction/output JSONL mapped through the chat template\.
4. QLoRA config: 4\-bit base, LoRA rank 16–64, lr ~1e\-4–2e\-4, 2–3 epochs — the standard 2026 starting point\.
5. Train \(hours\), merge or serve adapter, evaluate __against the corpus harness before any merge__\.
6. Serve via Ollama/llama\.cpp \(adapters merge into GGUF\) behind the LOCAL\_AI\_BASE\_URL adapter\.

<a id="recommendation"></a>## 6\. Recommendation

1. __Don’t__ build from scratch \(ever, for this product\) and __don’t__ fine\-tune facts into weights\.
2. __Do__ pursue the Option B self\-hosted path first — it’s the infrastructure the fine\-tune would later run on\.
3. __Then, if the corpus benchmark shows the local base model \(qwen3\-14b\) falling short of Gemini on spec\-parse__ — that’s the trigger for the distillation fine\-tune\. It converts “we rent frontier API forever” into “we spent $15 and own the behavior\.”
4. Total incremental cost of the experiment: under $50 and a weekend\. The eval harness — your moat — is already built\.

<a id="sources"></a>## Sources

- Fine\-Tune LLMs for Under $20 \(Medium/A, 2026\-02\) — A100 80GB marketplace pricing $0\.44/hr\+, QLoRA walkthrough
- How to Fine\-Tune LLMs in 2026: Costs, GPUs, Code \(Spheron, 2026\-03\) — size/method/cost table, Unsloth\-first recommendation
- RAG vs Fine\-Tuning in 2026: Decision Framework \(Winder\.AI, 2026\-06\) — decision tree, distillation case, hybrid pattern
- RAG vs Fine\-Tuning \(The AI Engineer, 2026\-07\) — “RAG changes what the model sees; fine\-tuning changes how it behaves”
- Fine\-Tuning When RAG Isn’t Enough \(Big Data Boutique, 2026\-05\) — “fine\-tune form, not facts”; eval harness prerequisite
- IBM Think \(2025\-02\) — prompt engineering vs RAG vs fine\-tuning distinction

