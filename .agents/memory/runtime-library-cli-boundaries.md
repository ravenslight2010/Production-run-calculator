---
name: Runtime library and CLI boundaries
description: Bundled server imports must not execute command-line checks or depend on migration-source asset locations.
---

Keep runtime diagnostics in import-side-effect-free libraries, separate from
command-line entry modules. Do not assume that an argv/import.meta.url equality
guard remains import-safe after bundling: imported modules share the entry
bundle's URL. Relative asset URLs also resolve from the bundle, not the original
source directory.

**Why:** A publish compiled successfully but crashed at startup when a runtime
health import read a source SQL asset from the bundle directory. An imported
release CLI also executed unintentionally inside the server.

**How to apply:** Test the actual bundled entry in a disposable directory without
source assets or inherited credentials. Verify that CLI wrappers still validate
direct invocation without executing on library import. If a runtime inventory
duplicates migration-owned targets, test exact parity with the migration instead
of reading migration source files during application startup.
