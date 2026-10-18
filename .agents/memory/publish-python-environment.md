---
name: Publish Python environment
description: Deployment builders can fail before the Node build when an incomplete local Python environment is included with a Python project.
---

Keep incomplete development-only Python environment directories out of the published source context when the application does not need them at runtime.

**Why:** Replit's publish builder runs `uv lock` for a repository with `pyproject.toml`. An empty or partial `.pythonlibs` directory can be detected as the configured project environment and fail publishing before the application build starts.

**How to apply:** If a publish fails during package setup with `uv lock` and reports that `.pythonlibs` has no Python executable, exclude `.pythonlibs` from `.replitignore`, then verify `uv lock` from a clean context and republish.