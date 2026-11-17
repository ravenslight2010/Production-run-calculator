# V1 application source archive

V1's tracked web and API application trees are preserved here:

- `artifacts/run-calculator` — React/Vite web application and its tests/assets.
- `artifacts/api-server` — Express API and its tests.

## Source baseline and recovery

Tracked source and configuration were unchanged at baseline commit
`5ef8ce1a9bfd181c0e48fa2ae214ee5e863d1e7e` on branch `Replit` before the
archive move. The workspace also had untracked `.local/custom_skills` files;
they were preserved untouched. The baseline commit contains both original V1
directories and all tracked project configuration at the time.

To restore the application trees to their original paths from this archive:

```sh
mkdir -p artifacts
mv _archived/v1/artifacts/run-calculator artifacts/run-calculator
mv _archived/v1/artifacts/api-server artifacts/api-server
mkdir -p artifacts/run-calculator/.replit-artifact artifacts/api-server/.replit-artifact
mv _archived/v1/platform-configs/run-calculator/artifact.toml \
  artifacts/run-calculator/.replit-artifact/artifact.toml
mv _archived/v1/platform-configs/api-server/artifact.toml \
  artifacts/api-server/.replit-artifact/artifact.toml
```

Then restore or intentionally reconfigure the archived V1 workspace filters
and deployment settings from the baseline commit. Restoring the artifact
manifests re-registers V1's managed preview workflows. Do not publish this
workspace as V1: the `.replit` build and run commands now fail closed. For a
full source/config rollback, use the repository checkpoint or revert the archive
change rather than replacing the working tree with the baseline commit; V2 work
may exist after this baseline.

The original Replit artifact manifests are preserved in
`platform-configs/{api-server,run-calculator}/artifact.toml`. Reinstating an
`artifact.toml` under `.replit-artifact/` re-registers that app and its managed
workflow, so do so only when intentionally restoring V1.

## Deliberately not archived or changed

- No V1 database, production data, credentials, sessions, inventory, or account
  records were copied, migrated, reset, or deleted.
- `lib/`, `scripts/`, workspace configuration, and V2 source remain outside this
  archive.
- The V1 Replit artifact manifests were moved out of auto-discovery directories;
  the V1 artifact previews and managed workflows are no longer registered.
- Existing V1 test reports and generated evidence remain on disk for reference,
  but are excluded from Git and deployment images.
- The current project's deployment target is unchanged, but its build/run
  commands and `publish:ready` script fail closed because the app is archived.
- `artifacts/run-calculator-mobile` contained only ignored generated
  `node_modules`/Expo cache data, with no tracked app source or artifact
  manifest; it was left untouched.
- Historical research mirrors may still mention the old V1 paths by design.

## V2 boundary

V2 source remains in `v2/` and is a separate package in this repository. It has
no runtime imports from the archived V1 applications and must use its own
database, credentials, and isolated pilot project. This archive does not
authorize copying V1 data or publishing V2.
