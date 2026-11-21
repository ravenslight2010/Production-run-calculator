# Coding Assistant – Full Useful Items Package
**Local OpenCode-based coding assistant (offline / Ollama)**  
**Supports v1 (Production-run-calculator), v2 (Lucias-production-assistant-v2), and future versions**  
**Date: 2026-11-15**

This package contains:
- Updated recommended `opencode.json` profile (non-read-only, skills/plugins allowed, edit/write ask)
- Domain-specific skills for import, QC/Brix, sync, multi-version work, schemas/gold sets
- Install instructions for power-pack + superpowers + these domain skills

## 1. Quick Install (Windows)

After your base CA-Setup has run:

```powershell
# 1. Install recommended power-pack skills (code-review, feature-dev, etc.)
npx @waybarrios/opencode-power-pack install --profile recommended

# 2. Optional but strong: Superpowers methodology
# Add to your opencode.json (see profile below) then restart

# 3. Install the domain skills from this package
# Copy the coding-assistant-skills folder to your global skills directory:
Copy-Item -Recurse -Force .\coding-assistant-skills\* "$env:USERPROFILE\.config\opencode\skills\"

# Or run the included install-domain-skills.ps1
.\install-domain-skills.ps1
```

Restart the chat UI, then ask: “List available skills”.

## 2. Recommended opencode.json (non-read-only)

Use or merge with the file `recommended-opencode-profile.json` in this package.

Key points:
- Skills, plugins, and MCP allowed
- `edit` and `write` are `ask` (safe but usable)
- Sensitive files still denied
- Context7 MCP (local) included
- Superpowers + agent-skills + skills-doctor plugins listed

## 3. Domain Skills Included

All under `coding-assistant-skills/`:

| Skill | Use for |
|-------|---------|
| import-product-inventory | Gold sets, name library, schedule/dough/sauce/cheese imports |
| qc-brix-haccp | Brix testing, HACCP, run-tied QC |
| sync-diagnostics | Outbox, pool pressure, wake, timestamp, tablet sync |
| version-diff | v1 vs v2 comparison and porting decisions |
| schema-and-goldsets | Schema evolution and gold-set creation |
| multi-version-work | Working across v1 / v2 / future versions safely |

These are global so the same agent can help on any version.

## 4. Plugins (add to opencode.json)

```json
"plugin": [
  "opencode-agent-skills",
  "opencode-skills-doctor",
  "superpowers@git+https://github.com/obra/superpowers.git",
  "opencode-power-pack@git+https://github.com/waybarrios/opencode-power-pack.git"
]
```

(Power-pack can also be installed via the npx command above; the plugin entry is optional.)

## 5. MCP (local-first)

Context7 is already in the recommended profile.  
Add GitHub later only if you want it (requires token).

## 6. Multi-Version Notes

- Put shared skills in `~/.config/opencode/skills/` (global).
- Put version-specific notes in each repo’s `AGENTS.md` or `.opencode/skills/`.
- Always tell the agent which version you are working on.
- Use the `version-diff` and `multi-version-work` skills when switching.

## 7. Verification

In the chat UI:
- “List available skills”
- “Use the import-product-inventory skill to help me make a gold set”
- “Compare how runs work in v1 vs v2”

All skills work offline once installed.
