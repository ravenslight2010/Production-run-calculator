# Metadata maintenance on macOS

`pnpm --filter @workspace/scripts run distill:backfill -- append-metadata`
supports Linux x64 and macOS (Apple silicon and Intel). Windows remains
unsupported. The append-only history, owner identity, recovery locks and
atomic file replacement apply on both supported systems.

On macOS install the Node version in the repository's `.nvmrc`, pnpm version
from the root `package.json` `packageManager` field, and Python 3.9 or later. The regular
`scripts/src/run-release-node.sh` entry point detects macOS and checks the
installed Node and pnpm versions before running commands. Its Python runner
uses macOS `fcntl.flock`; no GNU `flock`, Bash upgrade or Linux `/proc` is
required. A system Python with `ctypes` and `fcntl` is sufficient.

Metadata locks on macOS store the boot-session UUID and the process start
timestamp obtained through Darwin's `libproc` API, at microsecond resolution.
This distinguishes a reused PID. If Python, `libproc`, boot identity or owner
identity cannot be verified, recovery fails closed and leaves existing locks
untouched. Never remove a lock until confirming its owner is inactive.

Run the focused synthetic recovery suite and the scripts typecheck on a real
macOS host:

```sh
pnpm install --frozen-lockfile
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts exec tsx ./src/distill-backfill.test.mts
bash scripts/src/run-release-node.sh pnpm run typecheck:libs
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run typecheck
```

The GitHub Actions `Metadata maintenance macOS` check runs these commands on a
Linux runner and hosted macOS Apple silicon and Intel runners. Linux emulation
is not a substitute for either native macOS check.
