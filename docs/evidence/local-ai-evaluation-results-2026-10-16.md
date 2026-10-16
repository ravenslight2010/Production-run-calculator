# Local AI evaluation results — 2026-10-16

**Decision: INSUFFICIENT EVIDENCE for local adoption.** Keep production on
Gemini. This is an evaluation result, not an application production-readiness
decision.

## Evaluated configuration

| Item | Observed value |
| --- | --- |
| Model | Qwen3.5-9B `Q3_K_M`, alias `qwen3.5-9b-q3_k_m` |
| Model repository revision | `mradermacher/Qwen3.5-9B-GGUF` at `9345434ae3c14ecb7b5021df007518f70b2a5231` |
| Quantized weight SHA-256 | `36c110646c21b365714c0a7f0d512228276ba0e20b7a9187e7817b8f70fde58e` |
| Vision projector | F16; SHA-256 `97f420245a85ce129bb764e86a5e21e27d782fe6d6056c6839b9c5fdb8f38289` |
| Runtime | Ollama distribution v0.40.5; bundled llama-server build `620d2225c` |
| Host | Linux x86_64, CPU-only, 8 CPU threads, 16 GiB cgroup memory limit |
| Concurrency | One inference at a time |
| Configured budget | 4,096-token context limit; 256-token output limit |

The actual smoke requests used 17 prompt tokens/8 requested output tokens for
text and 379 prompt tokens/128 requested output tokens for the generated image
table. The context ceiling was enforced but not filled to 4,096 tokens.

The predeclared Phase-0 comparison gates are: schema validity at least Gemini
minus 1 percentage point or at least 99% absolute; critical-field agreement at
least Gemini minus 3 percentage points; overall field agreement at least Gemini
minus 5 percentage points; zero blank-poison cases; and empty-output rate no more
than Gemini plus 1 percentage point. p95 latency is reported but informational.
Any blank-poison case, critical-field gap over 5 points, or systematic missing
required fields blocks promotion. These are frozen acceptance criteria, not
measurements or authorization to run a comparison.

## Synthetic-only results

The first successful managed start reached healthy status about 76 seconds after
its first health poll. A later cold restart exceeded the original 240-second
model-start deadline (`runtime_startup_timeout`) without an OOM; the application
API remained healthy. With the bounded model-start deadline raised to 480 seconds,
a subsequent managed restart recovered and reached ready status in about five
minutes from workflow restart (about three minutes after the model-server process
started). The private health gate opened only after the pinned model and context
were verified.

Two synthetic smoke runs completed:

| Run | First text | Repeated text | Generated image | Smoke cgroup baseline | Smoke cgroup peak |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial successful start | 13.261 s | 0.607 s | 5.546 s | 10,315,915,264 B | 10,445,533,184 B |
| Restart after readiness-gate change | 29.706 s | 0.684 s | 28.885 s | 10,118,983,680 B | 10,542,686,208 B |

The latest image response matched all three expected ingredient names and all
three decimal oz-per-pizza values. At the final check, the workspace cgroup
`memory.peak` high-water was 13,722,705,920 bytes against a 17,179,869,184-byte
limit. That cumulative figure includes the application and other workspace
processes and may include earlier probes; the isolated latest-smoke measurement is
the table above. All cgroup OOM counters remained zero. The application API
health check returned HTTP 200 before and after smoke, and all evaluator
listeners were verified on loopback only.

These are measurements from one workspace session and three generated inputs.
Only two smoke observations are available; they do not support meaningful p50
or p95 latency estimates.
The image was a simple generated table, not a scanned customer workbook or a
held-out brand layout. The image result is evidence that the local model can
complete this synthetic vision request, not an OCR accuracy benchmark.

## Scope and evidence limits

| Route or evidence class | Status |
| --- | --- |
| Direct local text completion | **PASS** — synthetic prompt only |
| Direct local image completion | **PASS** — generated table only; exact names and decimal values matched |
| Native workbook-text adapter | **CONTRACT TESTED** — cell, sheet, text, formula, and cached-value provenance are preserved; no workbook was sent to the model |
| Deterministic-first unresolved-name adapter | **CONTRACT TESTED** — mocked provider contract and allowlist rejection tests; no live name-resolution inference |
| Retained application HTTP routes | **NOT RUN** — smoke uses the loopback evaluator directly; no production route was changed or called |
| Brands/layouts | **NOT EVALUATED** — only a generated synthetic table |
| Independently verified gold cases | **0 available in the reviewed workspace**; no model output or parser snapshot was promoted to gold |
| Gemini baseline | **NOT RUN** — required run/spend authorization and authorized case material were unavailable |
| PaddleOCR-VL-1.6 | **NOT INSTALLED / NOT RUN** — no held-out evidence established a scan gap requiring a second specialist |
| Production routing | **UNCHANGED** — Gemini remains the production provider |

There is no paired case set, independent human label set, live Gemini baseline,
brand coverage, or native-workbook model run. Quality gates for comparing schema
validity, critical fields, overall fields, blank-poison, and empty-output rate
remain unmeasured. Existing parser regression snapshots are not independent gold.

## Adoption decision and next evidence

Do not adopt or route production traffic to this local candidate. The synthetic
inference and resource smoke passed, but the quality comparison is
**INSUFFICIENT EVIDENCE**, not a local-model failure or a Gemini win. A future
comparison requires owner-approved source use and provider run/spend permission,
independent blind review and adjudication under
[`docs/spec-import-gold-review.md`](../spec-import-gold-review.md), frozen case
and prompt identities, and paired evaluation against the current Gemini route.
Only if that authorized held-out image evaluation identifies a material vision
gap should PaddleOCR-VL-1.6 be considered on the same image subset.

No customer content, Gemini request, or raw model prompt/completion is included
in this report.
