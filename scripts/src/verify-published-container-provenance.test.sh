#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VERIFY_SCRIPT="${SCRIPT_DIR}/verify-published-container-provenance.sh"
TEST_ROOT=$(mktemp -d)
FAKE_DOCKER="${TEST_ROOT}/docker"
REPORT="${TEST_ROOT}/provenance.txt"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat >"$FAKE_DOCKER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == pull ]]; then
  exit 0
fi

if [[ "$1" == image && "$2" == inspect ]]; then
  ref="${@: -1}"
  if [[ "$*" == *Config.Labels* ]]; then
    printf '%s\n' "$EXPECTED_REVISION"
  else
    printf '%s\n' "$ref"
  fi
  exit 0
fi

exit 1
EOF
chmod +x "$FAKE_DOCKER"

export PATH="${TEST_ROOT}:$PATH"
export EXPECTED_REVISION=0123456789abcdef0123456789abcdef01234567
export PROVENANCE_REPORT="$REPORT"
export API_IMAGE=ghcr.io/example/runcalc-api
export API_MIGRATE_IMAGE=ghcr.io/example/runcalc-api-migrate
export WEB_IMAGE=ghcr.io/example/runcalc-web
export API_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export API_MIGRATE_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export WEB_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

if ! PATH="${TEST_ROOT}:$PATH" \
  bash "$VERIFY_SCRIPT" >/dev/null; then
  printf 'Expected matching image digests and labels to pass.\n' >&2
  exit 1
fi

grep -Fq 'overall_status=pass' "$REPORT"
grep -Fq 'image_1_digest_verified=true' "$REPORT"
grep -Fq 'image_3_revision_verified=true' "$REPORT"

cat >"$FAKE_DOCKER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == pull ]]; then
  exit 0
fi

if [[ "$1" == image && "$2" == inspect ]]; then
  ref="${@: -1}"
  if [[ "$*" == *Config.Labels* ]]; then
    printf 'wrong-revision\n'
  else
    printf '%s\n' "$ref"
  fi
  exit 0
fi

exit 1
EOF
chmod +x "$FAKE_DOCKER"

if PATH="${TEST_ROOT}:$PATH" bash "$VERIFY_SCRIPT" >/dev/null 2>&1; then
  printf 'Expected a mismatched revision label to fail closed.\n' >&2
  exit 1
fi
grep -Fq 'overall_status=fail' "$REPORT"
grep -Fq 'image_1_revision_verified=false' "$REPORT"

cat >"$FAKE_DOCKER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == pull ]]; then
  exit 0
fi

if [[ "$1" == image && "$2" == inspect ]]; then
  ref="${@: -1}"
  if [[ "$*" == *Config.Labels* ]]; then
    printf '%s\n' "$EXPECTED_REVISION"
  else
    printf 'ghcr.io/example/other-image@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\n'
  fi
  exit 0
fi

exit 1
EOF
chmod +x "$FAKE_DOCKER"

if PATH="${TEST_ROOT}:$PATH" bash "$VERIFY_SCRIPT" >/dev/null 2>&1; then
  printf 'Expected a mismatched published digest to fail closed.\n' >&2
  exit 1
fi
grep -Fq 'overall_status=fail' "$REPORT"
grep -Fq 'image_1_digest_verified=false' "$REPORT"

echo "PASS: published container provenance verification fails closed on mismatches"