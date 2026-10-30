# Private local AI evaluator

Use this environment only for bounded, authorized evaluation. The application
exposes a development-only scoring path in Import Gold Lab; this is not a
production provider or a substitute for human-reviewed data. Production remains
on the existing Gemini route.

## Start and operate

The managed Replit workflow **Local AI evaluator (private)** runs
`python3 scripts/local_model_eval_setup.py serve`. Start or restart that workflow
for a persistent, Replit-managed process. It is manual and is not started by the
Project workflow or on workspace boot.

Use the following commands from the workspace root:

```sh
# Check host compatibility and headroom, download/verify the pinned artifacts,
# mark only their cache as owned, and start the detached local helper.
python3 scripts/local_model_eval_setup.py setup

# Check that the pinned model is actually ready.
python3 scripts/local_model_eval_setup.py health

# Send only generated text and a generated recipe-sheet image; print metadata,
# not raw prompts or completions.
python3 scripts/local_model_eval_setup.py smoke

# Optional detached helper controls. Prefer the managed workflow for persistence.
python3 scripts/local_model_eval_setup.py start
python3 scripts/local_model_eval_setup.py stop

# Remove only the verified, marked local evaluation cache.
python3 scripts/local_model_eval_setup.py remove
```

## Use the development app's synthetic Gold Lab path

To make the private evaluator available to the app, set
`IMPORT_GOLD_LOCAL_ENABLED=true` in the **development workspace only**. Unless
overridden for a local test, the app uses
`http://127.0.0.1:11434/v1`. Do not set this up as a production provider. The
server also checks its runtime and loopback endpoint; a configured URL is not
proof that the model is available.

1. Start the managed **Local AI evaluator (private)** workflow and confirm
   `python3 scripts/local_model_eval_setup.py health` reports the pinned model.
   For the isolated live-scoring browser check, `IMPORT_GOLD_LOCAL_LIVE=true`
   selects the test only; also set `IMPORT_GOLD_LOCAL_ENABLED=true` (and, if
   needed, `IMPORT_GOLD_LOCAL_BASE_URL=http://127.0.0.1:11434/v1`) so the
   development API is configured to use the loopback evaluator.
2. In the app, open **Settings → Data Health & Audit → Import Gold Lab**.
3. As a manager, confirm the separate configured/available status and enable
   **app-side local scoring**. This preference persists across reloads and
   devices; it does not start or stop the workflow.
4. Review the fixed synthetic sample, check the review confirmation, and apply
   it. This creates only a synthetic evaluation case; it does not import a
   workbook or change recipes, inventory, source approvals, or workflow state.
5. Select **Score locally**. The app saves the bounded score or a visible,
   persisted error result. If the evaluator is unavailable, start it and select
   **Score locally** again to make a new attempt; the failed attempt is retained
   for review. Reload the lab to confirm the latest result remains visible.

Real-source capture and Gemini comparison remain separately gated by the
required approvals and configuration. Neither the development switch nor the
synthetic fixture grants those approvals or changes general AI routing.

For the current customer-source policy decision and deletion limitations, see
[Gold Lab customer-source decision](evidence/import-gold-source-use-decision.md).
The approved 30-day manual-retention policy does not enable real-source work;
the recorded disposition remains synthetic-only until the source-specific
evidence and actual deletion requirements are verified.

CPU-only cold startup can take several minutes: the model runtime has a bounded
480-second readiness deadline after launch, and the detached helper allows up to
600 seconds for startup. Setup verifies the pinned files before launch, so the
full command may take longer than the runtime deadline.

The `setup` action is safe to rerun: it verifies existing artifacts and does not
replace a mismatched, unowned file. `remove` is intentionally strict. Stop the
managed workflow first; removal refuses while any evaluator port is active or
the ownership marker/tree is missing or invalid. It removes only
`.local/share/local-ai-eval`; it does not delete the historical Qwen3 cache.

The workflow is console-only and has no `waitForPort`. This repository already
has explicit `.replit` port mappings; Replit disables automatic port detection
when mappings exist, and a `localPort`-only mapping cannot satisfy the platform
health check. The readiness listener on port 8008 is loopback-only and has no
Replit port mapping; its minimal `/healthz` probe returns `starting` during
model load and `ready` only after the pinned model identity is healthy through
the loopback API. It exposes no inference route. `health` on port 11434 is the
authoritative model check. The OpenAI-compatible API and the llama-server backend
are bound only to `127.0.0.1:11434` and `127.0.0.1:11435`, respectively. No
evaluator port has a public mapping.

## Pinned profile and storage

- Candidate: Qwen3.5-9B GGUF, `Q3_K_M`, from
  `mradermacher/Qwen3.5-9B-GGUF` revision
  `9345434ae3c14ecb7b5021df007518f70b2a5231`.
- Quantized weights: 4,616,185,088 bytes;
  SHA-256 `36c110646c21b365714c0a7f0d512228276ba0e20b7a9187e7817b8f70fde58e`.
- Vision projector: F16, 918,165,952 bytes;
  SHA-256 `97f420245a85ce129bb764e86a5e21e27d782fe6d6056c6839b9c5fdb8f38289`.
- Runtime: official Ollama Linux AMD64 v0.40.5 distribution, archive SHA-256
  `dc5eabc292f9949546c90a97c820f924b035e05243b0de13c7f366182562169c`;
  bundled `llama-server` build `620d2225c`, binary SHA-256
  `234b05b2138264f8fb263c3205e85f4c290e8afe5067e280a4f6f90cdac5696b`.
- The inspected Qwen3.5 model card identifies Apache-2.0; the Ollama distribution
  license identifies MIT. These statements apply to those upstream materials,
  not automatically to every bundled subcomponent. Re-check upstream notices
  before redistribution. The evaluator does not bundle weights in a publish
  artifact.
- Cache: `.local/share/local-ai-eval`, ignored by Git and excluded by
  `.replitignore`. The weight files are not Git/LFS assets. The cache is private
  evaluation data and is not needed by the published application.

The supported preflight is Linux x86_64 with at least 12 GiB memory limit, 8 GiB
available memory, 8 GiB free disk, and CPU access. The measured workspace had
8 CPU threads, a 16 GiB cgroup memory limit, and no usable GPU. The pinned profile
uses CPU inference, one active request, 4,096-token context ceiling, and a
256-token output ceiling. The local candidate adapter further requires synthetic
fixture IDs and bounded inputs. A fixture ID is not authorization: do not send
customer material unless its use has been specifically approved.

## Evaluation-only boundaries

`@workspace/ai-evaluation/local-candidate` targets only the fixed loopback URL and
the approved model identity. It accepts bounded text, inline PNG/JPEG/WebP images,
or unresolved-name candidates after a deterministic pass. Native workbook text
requests carry each cell's sheet/address, text value, formula text, and cached
value as separate fields; they do not flatten formulas into unlabeled values.
Image transcription is a separate path and does not replace native workbook
handling. All extracted output remains advisory. The existing deterministic
parser, source bounds, sanitizers, target allowlists, review, authorization, and
explicit Apply remain authoritative.

The static application-knowledge package is versioned and source-linked. It is
scoped by route and evaluator role; see
[`docs/ai-knowledge/README.md`](ai-knowledge/README.md). Refresh its manifest
after a reviewed content/version change with `python3 scripts/check_ai_knowledge.py
--update`, then run `--check`.

The smoke test is intentionally synthetic. It verifies a short text completion,
a repeated completion, and a generated ingredient/oz-per-pizza table image. It
does not invoke a retained application HTTP route, parse a native workbook, or
measure production accuracy.

## Troubleshooting and rollback

- If `health` reports the endpoint unavailable, check the managed workflow's
  console output and poll `health` again while its internal probe reports
  `starting`.
- A `runtime_startup_timeout` means the pinned runtime did not report healthy
  within its 480-second launch deadline. Check CPU/memory headroom and the
  managed workflow state before retrying; the evaluator does not retry the model
  load automatically.
- `runtime_startup_timeout`, `runtime_model_identity_mismatch`, or
  `model_digest_mismatch` are hard failures. Do not lower the resource preflight
  or accept a different model digest to make startup appear successful.
- Check `python3 scripts/local_model_eval_setup.py health`, cgroup memory,
  available disk, and whether ports 8008, 11434, or 11435 are already in use.
- To stop use the managed workflow stop action, then run the `stop` command if a
  detached helper was also started. `remove` is for the marked cache only.
- To back out code/configuration, restore the Replit checkpoint or revert the
  task changes, then stop the managed workflow. Do not manually delete the legacy
  Qwen3 cache or unmarked files.

For the bounded findings, open
[`docs/evidence/local-ai-evaluation-results-2026-10-16.md`](evidence/local-ai-evaluation-results-2026-10-16.md).
