# Coding-assistant handoff from the Windows host inspector

## Current state

The Windows host-inspector report remains read-only. Its `ai` recommendation is for the **application's** text-AI workload; it is separate from the new `codingAssistant` recommendation for the local coding agent. Neither field installs OpenCode/Ollama, downloads model weights, writes a profile, or contacts an AI provider.

The coding-assistant recommendation uses `candidate`, `notRecommended`, or `unknown`; only a `candidate` with provider `ollama`, an allowlisted model ID, and the expected context cap can render a profile. The `qualification` remains `unmeasured`. Hardware fit is not a coding-quality, latency, or normal-plant-load guarantee.

## Initial candidate catalogue and policy

The selector ranks only models in this small initial catalogue:

| Candidate | Ollama artifact | Profile context cap | Conservative snapshot thresholds |
|---|---|---:|---|
| Higher-capacity | `qwen3-coder:30b` | 65,536 tokens | 64 GiB total RAM, 32 GiB available RAM, 24 GiB system-drive free |
| Lower-capacity | `qwen2.5-coder:7b` | 32,768 tokens | 24 GiB total RAM, 12 GiB available RAM, 8 GiB system-drive free |

Ollama lists Qwen3-Coder 30B as a 19 GB Q4_K_M artifact with 256K native context and Apache-2.0 licensing; the profile intentionally caps it at 65,536 tokens.[^https://ollama.com/library/qwen3-coder:30b] Ollama lists Qwen2.5-Coder 7B as a 4.7 GB Q4_K_M artifact with Apache-2.0 licensing; its library lists a 32K context window, so it is a smaller fallback below the preferred 64K repository context target.[^https://ollama.com/library/qwen2.5-coder:7b]

These RAM and disk thresholds are conservative **selection policy**, not vendor minimum requirements. Available RAM is only a point-in-time snapshot; host and app load must be measured during an explicit later pilot. System-drive space is only a proxy—the eventual installer must recheck the selected Ollama model-store path before showing a download prompt. GPU facts do not affect selection because Windows detection does not prove Ollama acceleration.

If facts are missing or inconsistent, report `unknown`. If no catalogue entry meets the thresholds, report `notRecommended` and leave the coding assistant/model absent; never weaken the plant app's resource headroom to force a selection. No install or model download may happen until Donald explicitly opts in. Before any model pull is implemented, replace mutable model tags with a reviewed, versioned catalog entry pinned to the artifact digest.

## Render and validate

After the inspector emits a separate coding-assistant candidate, render a local OpenCode profile without writing files or making network requests:

```powershell
node scripts/coding-assistant/render-opencode-config.mjs --report .\host-report.json > .\opencode.json
```

Review the generated configuration before use. The helper pins primary and title generation to the same local model, applies the catalogue's context cap, and refuses templates that weaken the read-only permissions, loopback provider, or integration/tool denials. It does not install software, download a model, enforce OS isolation, test OpenCode runtime behavior, or prove zero outbound traffic.

Run JavaScript tests from the repository root:

```powershell
node --test scripts/coding-assistant/tests/*.test.mjs
```
