---
name: Secret refresh for shell operations
description: Newly confirmed workspace secrets may not reach ad-hoc shell commands until a workflow refreshes the environment.
---

After a user adds or confirms a workspace secret, an already-open shell context
can lack it even though the secrets service confirms it exists. Restarting the
relevant workflow refreshed the process environment and made the secret
available to subsequent shell commands.

**Why:** Treating a missing shell variable as a missing user credential can
lead to an unnecessary second secret request, while trying to work around it
risks exposing a credential.

**How to apply:** Check only secret presence (never values); if a newly
confirmed secret is absent from the shell, restart the relevant workflow before
using it. Do not print it, persist it, or include it in command output.