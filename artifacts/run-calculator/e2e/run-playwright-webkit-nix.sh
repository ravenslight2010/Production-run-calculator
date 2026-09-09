#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${script_dir}/../../.." && pwd -P)"
workspace_browser_root="${repository_root}/.cache/ms-playwright"
browser_root="${PLAYWRIGHT_BROWSERS_PATH:-${workspace_browser_root}}"
if [[ ! -d "${browser_root}" ]]; then
  browser_root="${HOME}/.cache/ms-playwright"
fi
webkit_root="$(
  find "${browser_root}" -maxdepth 1 -type d -name 'webkit-*' -print \
    | sort -V \
    | tail -n 1
)"

if [[ -z "${webkit_root}" || ! -x "${webkit_root}/minibrowser-wpe/bin/MiniBrowser" ]]; then
  echo "Playwright WebKit is not installed under ${browser_root}" >&2
  exit 1
fi

nix_library_path="$(
  for attribute in gcc.cc.lib libglvnd x264.lib; do
    output_path="$(nix eval --raw "nixpkgs#${attribute}.outPath")"
    printf '%s/lib:' "${output_path}"
  done
)"

minibrowser_root="${webkit_root}/minibrowser-wpe"
export WEBKIT_EXEC_PATH="${minibrowser_root}/bin"
export WEBKIT_INJECTED_BUNDLE_PATH="${minibrowser_root}/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="${minibrowser_root}/share"
export LD_LIBRARY_PATH="${minibrowser_root}/lib:${minibrowser_root}/sys/lib:${nix_library_path%:}"

exec "${minibrowser_root}/bin/MiniBrowser" "$@"