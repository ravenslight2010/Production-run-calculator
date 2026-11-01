#!/usr/bin/env bash

# Configure this shell and its children to use the exact root packageManager
# pin through Corepack. Source this file, then call configure_project_pnpm.
configure_project_pnpm() {
  local repo_root="$1"
  local package_json="${repo_root}/package.json"
  local pnpm_version
  local corepack_bin
  local shim_dir="${repo_root}/.config/npm/node_global/bin"
  local corepack_home
  local canonical_repo_root
  local canonical_corepack_home
  local corepack_registry="${COREPACK_NPM_REGISTRY:-https://registry.npmjs.org}"

  if [[ ! -f "$package_json" ]]; then
    printf 'Cannot select project pnpm: package.json is missing at %s.\n' \
      "$package_json" >&2
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    printf 'Cannot select project pnpm: Node.js is unavailable; restore the project Node runtime.\n' >&2
    return 1
  fi

  pnpm_version=$(
    node -e '
      const fs = require("node:fs");
      const file = process.argv[1];
      let value;
      try {
        value = JSON.parse(fs.readFileSync(file, "utf8")).packageManager;
      } catch {
        process.exit(2);
      }
      const match = typeof value === "string" &&
        value.match(/^pnpm@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/);
      if (!match) process.exit(3);
      process.stdout.write(match[1]);
    ' "$package_json"
  ) || {
    printf 'Cannot select project pnpm: package.json must pin an exact pnpm version in packageManager.\n' >&2
    return 1
  }

  corepack_bin=$(command -v corepack 2>/dev/null || true)
  if [[ -z "$corepack_bin" || ! -x "$corepack_bin" ]]; then
    printf 'Cannot select project pnpm@%s: Corepack is unavailable on PATH; restore the Node.js Corepack runtime.\n' \
      "$pnpm_version" >&2
    return 127
  fi
  if [[ ! "$corepack_registry" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$ ]]; then
    printf 'Cannot select project pnpm@%s: COREPACK_NPM_REGISTRY must be an HTTPS registry URL.\n' \
      "$pnpm_version" >&2
    return 1
  fi
  corepack_registry="${corepack_registry%/}"

  if [[ -z "${HOME:-}" ]]; then
    printf 'Cannot select project pnpm@%s: HOME is unavailable; set HOME to a writable user directory.\n' \
      "$pnpm_version" >&2
    return 1
  fi
  corepack_home="${COREPACK_HOME:-${HOME}/.cache/node/corepack}"
  if [[ "$corepack_home" != /* ]]; then
    printf 'Cannot select project pnpm@%s: COREPACK_HOME must be an absolute path outside the workspace.\n' \
      "$pnpm_version" >&2
    return 1
  fi
  canonical_repo_root=$(cd "$repo_root" && pwd -P) || {
    printf 'Cannot select project pnpm@%s: cannot resolve the workspace path.\n' \
      "$pnpm_version" >&2
    return 1
  }
  canonical_corepack_home=$(realpath -m -- "$corepack_home") || {
    printf 'Cannot select project pnpm@%s: cannot resolve COREPACK_HOME; set it to an absolute path outside the workspace.\n' \
      "$pnpm_version" >&2
    return 1
  }
  case "$canonical_corepack_home" in
    "$canonical_repo_root"|"$canonical_repo_root"/*)
      printf 'Cannot select project pnpm@%s: COREPACK_HOME must be outside the workspace to avoid recursive tool provisioning. Set COREPACK_HOME to a private cache outside the workspace.\n' \
        "$pnpm_version" >&2
      return 1
      ;;
  esac
  corepack_home="$canonical_corepack_home"

  mkdir -p "$shim_dir" || {
    printf 'Cannot select project pnpm@%s: cannot prepare the workspace shim directory %s.\n' \
      "$pnpm_version" "$shim_dir" >&2
    return 1
  }
  export COREPACK_HOME="$corepack_home"
  export COREPACK_NPM_REGISTRY="$corepack_registry"
  export COREPACK_ENABLE_PROJECT_SPEC=1
  export COREPACK_ENABLE_STRICT=1
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export COREPACK_DEFAULT_TO_LATEST=0
  export COREPACK_NETWORK_TIMEOUT=30000

  # Corepack replaces existing links with read/unlink/create. Parallel API/web
  # startup must not run that sequence against the same published entry points.
  # Prepare privately, resolve relative links before moving them, then publish
  # each launcher with same-filesystem atomic rename. No service-lifetime lock
  # or extra runtime dependency is needed.
  if ! node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const { spawnSync } = require("node:child_process");
    const [corepack, destination] = process.argv.slice(1);
    let staging;
    try {
      staging = fs.mkdtempSync(path.join(destination, ".corepack-shims-"));
      const result = spawnSync(corepack,
        ["enable", "--install-directory", staging, "pnpm"],
        { stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error("Corepack enable did not complete successfully");
      const names = ["pnpm", "pnpx"].filter(name => {
        try { fs.lstatSync(path.join(staging, name)); return true; }
        catch (error) {
          if (name === "pnpx" && error.code === "ENOENT") return false;
          throw error;
        }
      });
      // Validate every generated entry before replacing any existing launcher.
      for (const name of names) {
        const file = path.join(staging, name);
        if (fs.lstatSync(file).isSymbolicLink()) {
          const target = fs.realpathSync(file);
          fs.unlinkSync(file);
          fs.symlinkSync(target, file);
        }
        if (!fs.statSync(file).isFile()) throw new Error("Invalid Corepack launcher");
        fs.accessSync(file, fs.constants.X_OK);
      }
      for (const name of names) {
        fs.renameSync(path.join(staging, name), path.join(destination, name));
      }
    } catch (error) {
      console.error("Corepack shim preparation failed: " + error.message);
      process.exitCode = 1;
    } finally {
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
    }
  ' "$corepack_bin" "$shim_dir"; then
    printf 'Cannot prepare the Corepack pnpm shim for project pin %s; verify the Node runtime and workspace permissions.\n' \
      "$pnpm_version" >&2
    return 1
  fi
  PATH="${shim_dir}:${PATH}"
  export PATH
}
