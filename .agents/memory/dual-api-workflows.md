---
name: Dual API server workflows
description: Two API server workflows exist; the browser reaches the artifact one (8080), not the port-5000 duplicate — restart BOTH after killing api-server processes.
---

# Dual API server workflows

TWO workflows run the same API server: "API Server" (PORT=5000) and
"artifacts/api-server: API Server" (artifact-managed, port 8080). The user's
browser reaches the API through the public domain via the **8080 artifact
workflow** — the 5000 one being healthy does NOT mean the app works.

**Why:** a `pkill -f api-server` during a maintenance task killed both; only
the 5000 workflow was restarted, and the user's sign-in silently broke
("Won't let me sign in") while local healthz on 5000 looked fine.

**How to apply:** after killing api-server processes, restart BOTH workflows,
then verify through the public domain, not localhost:
`curl https://$REPLIT_DEV_DOMAIN/api/healthz` (expect 200) and a wrong-password
POST to `/api/auth/sign-in` (expect 401). If server logs show no incoming
requests while the user reports failures, suspect the OTHER server/port is the
one actually serving traffic.
