# Coding-assistant handoff from the Windows host inspector

## Current state

The current Windows host-inspector report is schema version 1 and exposes an `ai` recommendation for the **application's** text-AI workload. That field is not a coding-agent recommendation. The inspector is read-only: it does not install OpenCode/Ollama, download model weights, or write a profile. The current report therefore cannot yet activate the coding-assistant profile renderer.

The helper `scripts/coding-assistant/render-opencode-config.mjs` is intentionally fail-closed until a separate `codingAssistant` recommendation is added to the installer report. Do not copy `ai.candidateModel` into this field or infer coding suitability from it.

## Proposed report extension

When the installer adds coding-model selection, keep it separate from `ai` and use the existing camel-case JSON conventions:

```json
{
  "codingAssistant": {
    "status": "candidate",
    "provider": "ollama",
    "candidateModel": "<model-id-from-reviewed-catalogue>",
    "qualification": "unmeasured",
    "reasons": ["<bounded explanation>"]
  }
}
```

`status` should be `candidate`, `notRecommended`, or `unknown`. Only `candidate` with provider `ollama` and a valid local model ID is accepted by the renderer. `unknown`, `notRecommended`, cloud providers, malformed IDs, and non-Windows or blocked host reports must not yield a runnable profile. Keep `qualification: unmeasured` until representative coding tasks and host-load tests have actually run; a hardware-fit recommendation is not a quality or performance claim.

The installer must choose from a reviewed, versioned local-model catalogue using the sanitized host facts, conservatively reserving resources for the plant app and operating system. If host facts, resource headroom, or model fit are uncertain, return `unknown`/`notRecommended` and allow the core app to run without the assistant. Do not download weights or install services without a separate explicit opt-in. Keep any app-product model recommendation independent and do not claim concurrent model loading is safe without measuring it.

## Render and validate

After a future inspector version includes the extension, the helper can render a local OpenCode profile without writing files or making network requests:

```powershell
node scripts/coding-assistant/render-opencode-config.mjs --report .\host-report.json > .\opencode.json
```

Review the generated configuration before use. The helper pins both primary and title generation to the same installer-selected local model and refuses templates that weaken the existing read-only permissions, local loopback provider, or integration/tool denials. It does not install software, download a model, enforce OS isolation, test OpenCode runtime behavior, or prove zero outbound traffic.

Run its unit tests from the repository root:

```powershell
node --test scripts/coding-assistant/tests/*.test.mjs
```
