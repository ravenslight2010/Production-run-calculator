# Local model endpoint setup evidence — 2026-10-08

## Scope and host decision

This is setup evidence for the local evaluation endpoint, not a model-quality
comparison or authorization to start one. The project owner explicitly approved
using the current Replit development workspace instead of a separate dedicated
evaluation host. The workspace is CPU-only: its cgroup quota is 8 CPUs, its
memory limit is 16 GiB, and no GPU device is visible. This is a disclosed
deviation from the dedicated-host plan.

No separate cloud host, paid inference provider, or AI subscription was added.
The open-source model weights were downloaded from the Ollama model registry
into the workspace. Workspace compute remains subject to the user's existing
Replit terms.

The actual workspace identifier and designated operator are recorded in a
restricted local evidence file outside the repository. They are intentionally
omitted from this shared report.

## Model identity

- Approved tag: `qwen3:8b`
- Ollama version: `0.9.5`
- Immutable manifest digest: `sha256:500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`
- Model config digest: `sha256:05a61d37b08453e59290add468e3bb2f688e23a01e967fecb0e2fa41218cea76`
- Model layer digest: `sha256:a3de86cd1c132c822487ededd47a324c50491393e6565cd14bafa40d0b8e686f`
- Model layer size: 5,225,388,164 bytes

The launcher checks the local `qwen3:8b` digest before opening the proxy. The
observed model-list digest matched the SHA-256 of the installed Ollama manifest.

## Endpoint and controls

- OpenAI-compatible endpoint: `http://127.0.0.1:11434/v1`
- Ollama backend: `127.0.0.1:11435`
- Both listening sockets were verified as `127.0.0.1`; no LAN/public binding
  was present. The native Ollama API is not routed through the proxy.
- The endpoint accepts only `qwen3:8b` chat completions and the model-list
  route. The proxy enforces one in-flight request, an Ollama queue of one, a
  32,768-token context, an 8 MiB request-body limit, and a 120-second completion
  deadline. Larger completion-token budgets are capped at 32,768; streaming is
  rejected.
- Proxy access logging is disabled. Ollama stdout/stderr are discarded by the
  launcher. The proxy does not persist request or response bodies.
- The local model-list and health checks used only metadata routes. No
  completion/inference request was sent, no customer content was used, no
  inference provider was called, and no production routing was changed.

The endpoint is running as a workspace background process, not a managed
Replit workflow. The workspace rejected adding another workflow at its current
workflow limit; existing workflows were left unchanged. If this process stops
or the workspace restarts, run:

```sh
python3 scripts/local_model_eval_proxy.py
```

## Verification and provenance

- Final endpoint verification captured at `2026-10-08T16:31:55Z`.
- `python3 -m unittest discover -s scripts -p 'test_local_model_eval_proxy.py' -v` — 9 tests passed.
- `python3 -m py_compile scripts/local_model_eval_proxy.py scripts/test_local_model_eval_proxy.py` — passed.
- `git diff --check` — passed.
- `GET /v1/models` listed `qwen3:8b`; the proxy returned 404 for the native
  Ollama `/api/version` route.
- The final startup reached the ready state only after the pinned model digest
  check passed.
- Environment: development workspace; not production.
- Git `HEAD` at capture: `060dc03e181ff45fb1e7f4762f22d14f891355d4`.
- SHA-256 of `scripts/local_model_eval_proxy.py`:
  `d6b7eb5b954734c394c46d6db16396e877b380f35859797fd28e951a2d3edb3b`.
- SHA-256 of `scripts/test_local_model_eval_proxy.py`:
  `2c60a55bf815b46912d410253fbc8d5bc522a4ba14657589cb27569da2a957b1`.
- SHA-256 of `replit.nix`:
  `173b9fc450cd3df7c10e51ebdbf03fb6cab38dbf3fc3c7085186b432f5adcb8f`.

This setup record does not establish that comparison cases are authorized or
ready. The provider-comparison gate review remains a separate, time-bound
assessment.

## Repository typecheck note

- `CI=true pnpm run typecheck` completed successfully with the workspace's
  installed Node `v24.13.0`.
- The pinned release runner requires Node `v24.21.0` from `.nvmrc`, but npm
  could not provision `node@24.21.0` in this workspace. Its default-cache
  attempt reported `ECOMPROMISED`; retries with a fresh cache and the system CA
  paths failed with an npm cache write error. The typecheck itself therefore
  remains unverified under the exact pinned Node runtime.
- TLS verification was not disabled, and no runtime pin or release-runner code
  was changed to bypass this limitation.
