#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_dir="${CI_BINARY_WORKFLOW_DIR:-$workspace_root/.github/workflows}"
inventory="$workflow_dir/ci-binary-provenance.md"

if [[ ! -d "$workflow_dir" ]]; then
  echo "CI binary provenance check failed: workflow directory is missing: $workflow_dir" >&2
  exit 1
fi

if [[ ! -f "$inventory" ]]; then
  echo "CI binary provenance check failed: missing inventory: $inventory" >&2
  exit 1
fi

mapfile -t workflow_files < <(
  find "$workflow_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print | sort
)

if (( ${#workflow_files[@]} == 0 )); then
  echo "CI binary provenance check failed: no workflow files were found." >&2
  exit 1
fi

failures=0

for workflow in "${workflow_files[@]}"; do
  # These patterns deliberately cover both the current release-download form
  # and common future forms. Package-manager installs and health/webhook curls
  # are not binary downloads and therefore are not flagged.
  mapfile -t download_lines < <(
    {
      grep -Ein \
        'releases/download|gh[[:space:]]+(release[[:space:]]+)?download|actions/download-artifact|(^|[[:space:]])(curl|wget)[[:space:]].*(--output[=[:space:]]|-o[[:space:]]|--remote-name([[:space:]]|$)|(^|[[:space:]])-O([[:space:]]|$))|(^|[[:space:]])(tar|unzip)[[:space:]]' \
        "$workflow" || true
      awk '
        function continued(line) { return line ~ /\\[[:space:]]*$/ }
        {
          if (!in_download && $0 ~ /(^|[[:space:]])(curl|wget)[[:space:]]/) {
            in_download = 1
            start_line = NR
          }
          if (in_download && $0 ~ /--output([=[:space:]])|-o[[:space:]]|--remote-name([[:space:]]|$)|(^|[[:space:]])-O([[:space:]]|$)/) {
            print start_line ": multiline curl/wget output"
            in_download = 0
          } else if (in_download && !continued($0)) {
            in_download = 0
          }
        }
      ' "$workflow"
    } | sort -t: -k1,1n -u
  )

  if (( ${#download_lines[@]} == 0 )); then
    continue
  fi

  verify_line="$(
    grep -Ein 'gh[[:space:]]+attestation[[:space:]]+verify' "$workflow" |
      cut -d: -f1 |
      head -n1 || true
  )"
  extract_line="$(
    grep -Ein '(^|[[:space:]])(tar[[:space:]]+-[a-zA-Z]*x|unzip([[:space:]]|$)|install[[:space:]]+-m|chmod[[:space:]]+\+x|(^|[[:space:]])\./)' "$workflow" |
      cut -d: -f1 |
      head -n1 || true
  )"

  if [[ -z "$verify_line" ]]; then
    echo "::error file=$workflow::Downloaded executable/archive has no GitHub artifact-attestation verification." >&2
    failures=$((failures + 1))
    continue
  fi

  if ! grep -Eq -- '--repo[[:space:]]+[^[:space:]]+' "$workflow"; then
    echo "::error file=$workflow::Artifact-attestation verification must pin the expected publisher repository with --repo." >&2
    failures=$((failures + 1))
  fi

  if ! grep -Eq -- '--signer-workflow[[:space:]]+[^[:space:]]+' "$workflow"; then
    echo "::error file=$workflow::Artifact-attestation verification must pin the expected signing workflow with --signer-workflow." >&2
    failures=$((failures + 1))
  fi

  if ! grep -Eq -- '--cert-oidc-issuer[[:space:]]+https://token\.actions\.githubusercontent\.com' "$workflow"; then
    echo "::error file=$workflow::Artifact-attestation verification must pin GitHub's Actions OIDC issuer." >&2
    failures=$((failures + 1))
  fi

  if [[ -n "$extract_line" && "$verify_line" -ge "$extract_line" ]]; then
    echo "::error file=$workflow::Artifact-attestation verification must happen before extraction, installation, or execution." >&2
    failures=$((failures + 1))
  fi
done

if (( failures > 0 )); then
  echo "CI binary provenance check failed with $failures issue(s)." >&2
  exit 1
fi

echo "All downloaded CI executables and archives have fail-closed provenance gates."