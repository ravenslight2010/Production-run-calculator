# Retained startup tools — experimental, not enabled

This opt-in experiment is separate from the read-only
[startup diagnostic](startup-tools-diagnostic.md).

`build:runtime-tool-cache` prepares a private Corepack cache using the exact
source pin and default TLS/npm-signature checks. For pnpm 12 it also warms the
separately verified native executable before packing the cache into the API's
ignored `dist/runtime-tools` directory.

The experimental project launcher option `--use-retained-startup-tools`
validates the source pin, build Node selector, Corepack version, platform,
architecture and archive hash before importing the verified bytes into a
private cache outside the workspace. Restoration is cache-only with networking
disabled; it does not fall back to a registry download. The private cache is
removed when the startup-manager command exits.

**This is not enabled in the normal Publish build or run command.** Nine focused
metadata/guard tests and real signed archive preparation passed, but a fresh-cache
OS-isolated handoff did not return within its 35-second probe deadline, including
with loopback enabled. The latter attempt reached the launcher's
`pnpm --version` probe. Actual application startup was not reached.

Do not describe this as passing offline startup, infer published downtime from
it, or enable it in the default launcher without resolving that failure and
verifying the complete built-runtime handoff. Experimental generated archives
must not be inadvertently carried into the default deployment output.

The diagnostic does not invoke this builder or restorer. The regression tests
use synthetic runners; they do not certify the real native executable or a
published runtime.
