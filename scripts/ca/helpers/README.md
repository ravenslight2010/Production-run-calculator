# Code Agent helpers

These are optional one-off scripts. The main installer is still `CA-Setup.cmd` at the repo root.

| Script | Purpose |
|--------|---------|
| Enable-Writes.cmd | Older patch that adds a simple /api/write endpoint. Prefer the built-in tool cards (Allow/Deny) in the current UI instead. |
| Make-Operational.cmd | Quick check that Ollama + chat server are running and the shortcut works. |
| Fix-CodeAgent.cmd | Kill stuck process on port 7843, restart Ollama, restart chat server. |
| Repick-Model.cmd | Measure RAM/GPU and pull a better-fitting local model (speed or balanced). |

Run any of them from an elevated PowerShell or by double-clicking the .cmd.
