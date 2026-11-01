# Read-only startup tools diagnostic

The [retained startup-tools experiment](retained-startup-tools-experiment.md)
is separate and is **not enabled** in the normal launcher.

If startup or a validation command stalls before reaching application code, run:

```sh
node scripts/src/startup-tools-diagnostic.mjs
```

Use `--json` for structured results. `pnpm run diagnose:startup` is also available
when the package manager already works, but the direct Node command avoids
invoking a possibly broken manager.

The diagnostic reads the repository pins, checks executable presence without
running discovered tools, and inspects the expected Corepack cache metadata.
It does not install, download, contact a registry, modify a cache, or print
environment contents or configured cache paths. Exit 1 means findings need
attention; exit 2 means the command arguments were invalid.

“Present-unverified” means only that the expected cache entry declares the
expected package/version. It is not proof of package integrity or provenance,
successful startup, or offline startup. A manager version is not reported as
active because the diagnostic deliberately does not execute it.

Follow the reported next action using the existing approved runtime/provisioning
process. Do not loosen TLS checks, change version pins, run an obsolete manager,
or treat this inspection as permission to provision or publish. Verified
build-to-runtime handoff and isolated offline-startup testing are separate checks.
