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

## Startup-budget follow-up — 2026-10-16

The host again reported Linux x86_64, 8 CPU threads, and a 16 GiB cgroup memory
limit. The pinned weight and projector sizes and SHA-256 digests matched. The
4096-token context and 256-token output budgets were unchanged.

| Run | Total to private API ready | Model-server ready | Maximum sampled `memory.current` | `memory.peak` high-water | OOM counters | Application API |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Setup-driven detached start/stop | 23.443 s | Ready before helper returned (exact intermediate time not captured) | 14,055,534,592 B | 14,439,686,144 B | All zero | Not running |
| Managed restart rejected by memory preflight | 4.9 s to bounded rejection; model did not launch | Not reached | 11,381,526,528 B observed during the rejection window | 14,439,686,144 B | All zero | Not running |
| Managed restart after headroom recovered | 128.681 s | 124.148 s | 8,868,888,576 B | 14,439,686,144 B | All zero | Not running |
| Second successful managed restart | 11.212 s | 11.212 s | 8,868,085,760 B | 14,439,686,144 B | All zero | Not running |
| Managed restart with the API healthy | 114.171 s | 114.062 s | 13,317,754,880 B | 13,335,293,952 B | All zero | HTTP 200, `ok`; all six readiness checks `ok` |
| Dedicated detached helper start/stop | 117.393 s | 117.078 s | 8,838,852,608 B | 13,335,293,952 B | All zero | Stopped for this cycle |

The setup-driven helper stop completed in 1.160 seconds; the dedicated
`scripts/start_local_model_eval_proxy.sh stop` completed in 6.036 seconds, and
all evaluator listeners were closed afterward. On successful runs, the private
health response identified `qwen3.5-9b-q3_k_m` and `contextLimit: 4096`. Ports
8008, 11434, and 11435 were observed bound only to 127.0.0.1. The application
API's 8080 listener was the expected preview service and was separate from the
private evaluator ports. The cgroup high-water stayed below its
17,179,869,184-byte limit; each sampled `memory.current` maximum is separate
from its cgroup's cumulative `memory.peak`.

The first managed attempt failed closed before launching the model because
preflight saw about 5.4 GiB of headroom, below its existing 8 GiB minimum. In
that attempt, the safe preflight message appeared within about five seconds
and no evaluator listener opened. Use later dropped below the threshold without
clearing caches.
After the API-backed restart, memory use remained just above the threshold for
a further 180 seconds after stopping the evaluator; the dedicated helper was
started only after stopping the API freed enough headroom. No model artifacts
were deleted and no system caches were manually cleared. These results do not
justify changing the 480-second runtime readiness deadline, the 600-second
helper startup ceiling, or the 4096/256 model budgets.

The first artifact setup attempt also exposed a packaging mismatch: the pinned
Ollama archive contains its runtime at the archive root, while setup expected a
nested `ollama/` directory. Setup now accepts either layout and still verifies
the installed runtime identity. The initial pre-install focused run passed 40
tests with its artifact-dependent lifecycle integration skipped. After
installation, a final focused run passed 40 setup, proxy, smoke, and lifecycle
contract tests. The lifecycle listener assertion now matches the observed
loopback-only readiness bind; real startup and stop behavior was measured
separately above.

The managed API artifact workflow timed out while rebuilding its run
environment, before its command started. With approval, the same configured
development startup script was run through the pinned Node runner; its
`push-force` schema step completed and `/api/healthz` returned HTTP 200 with
`status: ok` and all six readiness checks `ok`. The API remained healthy during
the measured API-backed evaluator restart. The API process was stopped after
verification.

## Reusable repeated-start report

To collect comparable startup and memory evidence on a later session, run:

```sh
python3 scripts/local_model_eval_setup.py measure-startups --runs 3
```

This performs a bounded series of 2–5 evaluator starts (3 by default), stops
each started evaluator before continuing, and stores sanitized JSON metadata in
the ignored private directory
`.local/share/local-ai-eval/startup-reports/`. The report records process-to-
model-server and process-to-private-API readiness times, API health summaries
before and after each start, cgroup limit/current/peak and OOM counters,
sampled current-memory high-water, and whether the observed listeners are
loopback-only. The report directory is mode `0700`; each report file is mode
`0600`.

The command requires already-installed, verified evaluator artifacts and
refuses to run beside an existing evaluator. It does not clear caches or remove
model artifacts. The first row is labeled `firstInSeries`; later rows are
`repeatedRestart`. These labels describe run order only and do not prove that
the first start was a cold-cache start. `memory.peak` remains the cgroup's
cumulative high-water mark; compare it with the before/after values rather
than treating it as a per-run reset measurement. The report contains no
prompts, completions, response bodies, request identifiers, or raw listener
addresses.
