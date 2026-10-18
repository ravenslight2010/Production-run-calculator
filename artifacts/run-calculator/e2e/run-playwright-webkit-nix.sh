#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd "${script_dir}/../../.." && pwd -P)"
workspace_browser_root="${repository_root}/.cache/ms-playwright"
browser_root="${PLAYWRIGHT_BROWSERS_PATH:-${workspace_browser_root}}"
if [[ ! -d "${browser_root}" ]]; then
  browser_root="${HOME}/.cache/ms-playwright"
fi
if [[ ! -d "${browser_root}" ]]; then
  echo "Playwright WebKit is not installed under ${browser_root}" >&2
  exit 1
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

configured_library_path="${PLAYWRIGHT_WEBKIT_LIBRARY_PATH:-}"
configured_library_path="$(
  printf '%s' "${configured_library_path}" |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
)"
if [[ -n "${configured_library_path}" ]]; then
  library_path_source="${configured_library_path}"
else
  library_path_source="$(
    for attribute in gcc.cc.lib libglvnd x264.lib; do
      output_path="$(nix eval --raw "nixpkgs#${attribute}.outPath")"
      printf '%s/lib:' "${output_path}"
    done
  )"
fi

minibrowser_root="${webkit_root}/minibrowser-wpe"
export WEBKIT_EXEC_PATH="${minibrowser_root}/bin"
export WEBKIT_INJECTED_BUNDLE_PATH="${minibrowser_root}/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="${minibrowser_root}/share"
inherited_library_path="${LD_LIBRARY_PATH:-}"
if [[ -n "${configured_library_path}" &&
  "${inherited_library_path}" == "${configured_library_path}"* ]]; then
  inherited_library_path="${inherited_library_path#"${configured_library_path}"}"
  inherited_library_path="${inherited_library_path#:}"
fi
export LD_LIBRARY_PATH="${minibrowser_root}/lib:${minibrowser_root}/sys/lib:${library_path_source%:}${inherited_library_path:+:$inherited_library_path}"

exec "${minibrowser_root}/bin/MiniBrowser" "$@"