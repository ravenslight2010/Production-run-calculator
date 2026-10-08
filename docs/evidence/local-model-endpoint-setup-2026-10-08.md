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
- At the setup capture below, the local model-list and health checks used only
  metadata routes; no completion/inference request had yet been sent. The later
  synthetic-only smoke attempts and their capacity-gate result are recorded
  below. No customer content or remote inference provider was used, and no
  production routing was changed.

The endpoint remains a workspace-local service, not a managed Replit workflow.
The workspace rejected adding another workflow at its current workflow limit;
existing workflows were left unchanged. Replit's supported top-level
`.replit` `onBoot` command now runs
`bash scripts/start_local_model_eval_proxy.sh start` at workspace startup.
The helper detaches the endpoint, suppresses its output, avoids duplicate
launches, and removes stale process records left by a workspace restart.

For manual control:

```sh
HOME="$PWD/.local/ollama-cache-home" bash scripts/start_local_model_eval_proxy.sh status
HOME="$PWD/.local/ollama-cache-home" bash scripts/start_local_model_eval_proxy.sh stop
HOME="$PWD/.local/ollama-cache-home" bash scripts/start_local_model_eval_proxy.sh start
```

The helper only stops a process whose command line matches this endpoint. It
checks readiness through the loopback `/v1/models` metadata route and does not
read or log completions. It does not expose a port or create a Replit workflow.
If an untracked service is already answering on the local endpoint, the helper
refuses to claim it or stop it.

The endpoint was stopped after the smoke attempts and was not listening at the
final smoke capture. The weights are in the ignored workspace-local cache
because the home overlay quota blocked the initial pull. The manual commands
above select that cache through `HOME`. The configured `onBoot` command still
uses the default home and has not been verified against this relocated cache;
its startup evidence below uses a metadata fixture rather than these weights.
For a foreground launch with the restored cache:

```sh
HOME="$PWD/.local/ollama-cache-home" python3 scripts/local_model_eval_proxy.py
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
- Workspace boot startup is configured through the documented `.replit`
  `onBoot` setting. The configured command can be run manually to exercise the
  same startup hook without stopping or changing any unrelated workflow.
- Environment: development workspace; not production.
- Git `HEAD` at capture: `060dc03e181ff45fb1e7f4762f22d14f891355d4`.
- SHA-256 of `scripts/local_model_eval_proxy.py`:
  `d6b7eb5b954734c394c46d6db16396e877b380f35859797fd28e951a2d3edb3b`.
- SHA-256 of `scripts/test_local_model_eval_proxy.py`:
  `2c60a55bf815b46912d410253fbc8d5bc522a4ba14657589cb27569da2a957b1`.
- SHA-256 of `replit.nix` at the original endpoint capture:
  `173b9fc450cd3df7c10e51ebdbf03fb6cab38dbf3fc3c7085186b432f5adcb8f`.

This setup record does not establish that comparison cases are authorized or
ready. The provider-comparison gate review remains a separate, time-bound
assessment.


## Synthetic local smoke attempt — capacity gate failed

- Captured at `2026-10-08T17:55:05Z` in the development workspace at Git
  revision `11d23273a331cd3f5da7b00703c4b280c039add0`.
- The registry manifest and installed Ollama model both matched the approved
  `qwen3:8b` digest above. Its model layer is 5,225,374,496 bytes. The weights
  were restored only after owner approval and are in an ignored workspace-local
  cache; no model files were added to Git.
- Three local completion attempts used the same synthetic prompt through
  `http://127.0.0.1:11434/v1`; no source-backed or customer content was sent.
  Each returned HTTP 500 before generating a completion. The first error
  response arrived in 0.429 seconds; this is not a successful inference latency.
- The sanitized Ollama error reported that the configured 32,768-token context
  required 12.3 GiB while 10.8 GiB was available. No model remained loaded, so
  the active context length could not be verified during these 32,768-token
  attempts; the context was not lowered for them.
- The cgroup limit remained 17,179,869,184 bytes (16 GiB), with an 8-CPU quota.
  Its high-water after the attempts was 11,715,952,640 bytes (10.91 GiB), below
  the limit. That high-water was already present immediately before the timed
  request, so it is cumulative workspace evidence, not a request-isolated peak.
  `memory.events` reported zero `oom` and `oom_kill` events.
- The proxy's captured stdout/stderr contained only startup output and no
  synthetic prompt; the access-log handler is tested to emit nothing. The
  proxy and launcher keep bodies in memory and do not write request or response
  bodies to files. No model completion was produced or retained.
- No source-backed comparison was run and production routing was unchanged.
  **Result: the 32,768-token setting does not pass on this host.**
- `python3 -m unittest discover -s scripts -p 'test_local_model_eval_proxy.py' -v`
  — 10 tests passed, including the access-log suppression test;
  `py_compile` and `git diff --check` passed.


## Owner-approved lower-context smoke follow-up

- Final evidence captured at `2026-10-08T18:17:15Z` in the development
  workspace at Git revision `727d993d0a086b611b535f32e9c471519b5d8e29`.
- After the owner approved a lower-context check, a one-off evaluator process
  used a 4,096-token context limit, below the approved 32,768-token ceiling.
  The checked-in proxy and production routing were not changed. The same
  synthetic prompt was sent only to the loopback endpoint.
- A first lower-context attempt at 8,192 tokens returned HTTP 504 at 120.025
  seconds without a completion. Its sampled memory peak was 9,517,625,344 bytes;
  the cgroup high-water remained 11,715,952,640 bytes, with no new OOM events.
- The 4,096-token attempt returned HTTP 200 with a non-empty completion in
  68.745 seconds. The one-off evaluator set `OLLAMA_CONTEXT_LENGTH=4096`;
  Ollama's `/api/ps` response did not provide a readable `context_length` value.
- For the successful attempt, cgroup high-water rose from 11,715,952,640 to
  12,705,800,192 bytes (11.83 GiB), below the 17,179,869,184-byte (16 GiB)
  limit. The sampled peak matched that high-water, and `oom`/`oom_kill` counts
  stayed at zero.
- Captured proxy stdout/stderr contained only startup output: neither the
  synthetic prompt nor the non-empty completion appeared in logs. Request and
  response bodies were held in memory only; no body file was written or
  retained.
- **Result:** Qwen3 returned under the 120-second deadline at the owner-approved
  4,096-token setting, but not at 8,192 or 32,768 tokens in this workspace.
  This does not establish that the full 32,768-token context fits or authorize
  source-backed comparisons. No source-backed comparison was run.

## Workspace-startup implementation verification

- `python3 -m unittest discover -s scripts -p 'test_local_model_endpoint_startup.py' -v`
  — 4 tests passed. Its lifecycle test uses a loopback-only metadata fixture
  that advertises the already-approved digest; it verifies start, stop, the
  configured `onBoot` command, and both listener addresses. It sends no
  completion request and does not verify model quality.
- The startup configuration test confirms neither endpoint port is mapped in
  `.replit`; the live fixture checks both TCP listeners use IPv4 loopback.
- The isolated task-validation copy did not contain the approved Qwen3 manifest
  under `~/.ollama/models`. A real-model startup therefore failed closed at the
  digest check. No model was downloaded, and no digest or request limit was
  changed.
- The Replit workspace restart event could not be triggered from the isolated
  task runner. The exact configured `onBoot` command was exercised after a
  stop; Replit's documented workspace-start hook and the regression test cover
  the automatic-start configuration.
- SHA-256 of the current `.replit`:
  `f727806131d4d775f32172f975dc941e8666d881293fcbb5fea580fc25cfa015`.
- SHA-256 of the current `replit.nix`:
  `aba0b345328fa0269ab10672bc410600fd84057794cbc67dc3db2dd2290d7356`.
- SHA-256 of the startup helper:
  `b5968391f74651a738f68eb546ef82dc23d4ec48615023c205f2f9cf4f9e5bfe`.
- SHA-256 of the startup test:
  `6bf74ca63db2f2e72e683cb838721d24f98146d6b7121c6c660d82c633845ff7`.

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
