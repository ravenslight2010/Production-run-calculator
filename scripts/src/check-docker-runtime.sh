#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/runcalc-docker-runtime.XXXXXX")"
PROJECT="runcalc-runtime-${RANDOM}-$$"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
OVERRIDE_FILE="${TEMP_ROOT}/compose.override.yml"
RUNTIME_ENV="${TEMP_ROOT}/runtime.env"
COMPOSE_ENV="${TEMP_ROOT}/compose.env"
CONFIG_FILE="${TEMP_ROOT}/compose-config.json"
API_HEALTH_FILE="${TEMP_ROOT}/api-health.json"
STATIC_FILE="${TEMP_ROOT}/static.html"
DATA_VOLUME="${PROJECT}_caddy-data"
CONFIG_VOLUME="${PROJECT}_caddy-config"
COMPOSE_ARGS=(
  --project-name "$PROJECT"
  --project-directory "$REPO_ROOT"
  --env-file "$COMPOSE_ENV"
  --file "$COMPOSE_FILE"
  --file "$OVERRIDE_FILE"
)

cleanup() {
  local status=$?
  trap - EXIT

  if ((status != 0)); then
    echo "Docker runtime check failed; collecting disposable stack status." >&2
    docker compose "${COMPOSE_ARGS[@]}" ps --all >&2 || true
    docker compose "${COMPOSE_ARGS[@]}" logs --no-color >&2 || true
  fi

  if [[ -f "$COMPOSE_ENV" && -f "$OVERRIDE_FILE" ]]; then
    if ! env -u DATABASE_URL -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
      -u SITE_ADDRESS -u RUNTIME_ENV_FILE -u DOCKER_IMAGE_TAG \
      docker compose "${COMPOSE_ARGS[@]}" down --volumes --remove-orphans; then
      echo "Could not remove the disposable Docker Compose stack." >&2
      if ((status == 0)); then
        status=1
      fi
    fi
  fi
  docker volume rm "$DATA_VOLUME" "$CONFIG_VOLUME" >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' INT TERM

compose_version="$(docker compose version --short)"
python3 - "$compose_version" <<'PY'
import re
import sys

match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", sys.argv[1])
if not match or tuple(map(int, match.groups())) < (2, 24, 4):
    raise SystemExit(
        f"Docker Compose 2.24.4 or newer is required for safe env-file replacement (found {sys.argv[1]})"
    )
PY

if [[ -n "${DOCKER_IMAGE_TAG:-}" && ! "${DOCKER_IMAGE_TAG}" =~ ^[a-f0-9]{7,64}$ ]]; then
  echo "DOCKER_IMAGE_TAG must be a lowercase hexadecimal Git revision." >&2
  exit 2
fi

cat >"$RUNTIME_ENV" <<'EOF'
POSTGRES_DB=runcalc_docker_runtime
POSTGRES_USER=runcalc_runtime
POSTGRES_PASSWORD=docker-runtime-disposable-password
DATABASE_URL=postgres://runcalc_runtime:docker-runtime-disposable-password@db:5432/runcalc_docker_runtime
PORT=5000
SESSION_SECRET=docker-runtime-disposable-session-secret
AUTH_TOKEN_SECRET=docker-runtime-disposable-auth-secret
STAFF_SIGNUP_CODE=docker-runtime-disposable-signup-code
EOF
chmod 600 "$RUNTIME_ENV"

cat >"$COMPOSE_ENV" <<EOF
POSTGRES_DB=runcalc_docker_runtime
POSTGRES_USER=runcalc_runtime
POSTGRES_PASSWORD=docker-runtime-disposable-password
SITE_ADDRESS=localhost
RUNTIME_ENV_FILE=${RUNTIME_ENV}
EOF
if [[ -n "${DOCKER_IMAGE_TAG:-}" ]]; then
  printf 'DOCKER_IMAGE_TAG=%s\n' "$DOCKER_IMAGE_TAG" >>"$COMPOSE_ENV"
fi
chmod 600 "$COMPOSE_ENV"

cat >"$OVERRIDE_FILE" <<'EOF'
services:
  db:
    image: postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
    healthcheck:
      start_period: 90s
  migrate:
    env_file: !override ${RUNTIME_ENV_FILE}
    image: runcalc-api-migrate:${DOCKER_IMAGE_TAG:-local}
  api:
    env_file: !override ${RUNTIME_ENV_FILE}
    image: runcalc-api:${DOCKER_IMAGE_TAG:-local}
  web:
    image: runcalc-web:${DOCKER_IMAGE_TAG:-local}
EOF

compose() {
  env -u DATABASE_URL -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
    -u SITE_ADDRESS -u RUNTIME_ENV_FILE -u DOCKER_IMAGE_TAG \
    docker compose "${COMPOSE_ARGS[@]}" "$@"
}

compose config --format json >"$CONFIG_FILE"
python3 - "$CONFIG_FILE" "$RUNTIME_ENV" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)
services = config["services"]

def require(condition, message):
    if not condition:
        raise SystemExit(f"Docker Compose runtime contract failed: {message}")

def capabilities(service):
    return sorted(service.get("cap_drop") or []), sorted(service.get("cap_add") or [])

for name in ("api", "migrate"):
    service = services[name]
    dropped, added = capabilities(service)
    require(service.get("user") == "node", f"{name} must run as node")
    require(dropped == ["ALL"], f"{name} must drop all capabilities")
    require(not added, f"{name} must not add capabilities")
    require(service.get("network_mode") != "host", f"{name} must not use host networking")
    require(not service.get("env_file"), f"{name} must not retain a shared env file")
    require(
        service.get("environment", {}).get("DATABASE_URL")
        == "postgres://runcalc_runtime:docker-runtime-disposable-password@db:5432/runcalc_docker_runtime",
        f"{name} must connect only to the disposable Compose database",
    )

web = services["web"]
dropped, added = capabilities(web)
require(web.get("user") == "1001:1001", "Caddy must run as UID 1001")
require(dropped == ["ALL"], "Caddy must drop all capabilities before additions")
require(added == ["NET_BIND_SERVICE"], "Caddy must add only NET_BIND_SERVICE")
published = {
    f"{entry.get('published')}:{entry['target']}/{entry.get('protocol', 'tcp')}"
    for entry in web.get("ports", [])
}
require(published == {"80:80/tcp", "443:443/tcp"}, "Caddy must publish only host ports 80 and 443")

init = services["caddy-storage-init"]
init_dropped, init_added = capabilities(init)
require(init.get("user") == "0:0", "volume repair must run as root")
require(init_dropped == ["ALL"], "volume repair must drop all capabilities before additions")
require(init_added == ["CHOWN"], "volume repair must add only CHOWN")
require(init.get("network_mode") == "none", "volume repair must not have network access")

db = services["db"]
require(
    db.get("image", "").startswith("postgres:16-alpine@sha256:"),
    "the disposable Postgres image must be pinned by digest",
)
for key, expected in (
    ("POSTGRES_DB", "runcalc_docker_runtime"),
    ("POSTGRES_USER", "runcalc_runtime"),
    ("POSTGRES_PASSWORD", "docker-runtime-disposable-password"),
):
    require(db.get("environment", {}).get(key) == expected, "Postgres must use disposable credentials")
PY

if [[ -z "${DOCKER_IMAGE_TAG:-}" ]]; then
  echo "Building API, migration, and Caddy images for the disposable runtime check."
  timeout 20m env -u DATABASE_URL -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
    -u SITE_ADDRESS -u RUNTIME_ENV_FILE -u DOCKER_IMAGE_TAG \
    docker compose "${COMPOSE_ARGS[@]}" build api migrate web
fi

docker volume create "$DATA_VOLUME" >/dev/null
docker volume create "$CONFIG_VOLUME" >/dev/null
docker run --rm --user 0:0 --entrypoint /bin/sh \
  --volume "$DATA_VOLUME:/data" \
  --volume "$CONFIG_VOLUME:/config" \
  caddy:2-alpine -ec '
    printf "preserve-data-volume\n" >/data/runtime-check.marker
    printf "preserve-config-volume\n" >/config/runtime-check.marker
    chmod 600 /data/runtime-check.marker /config/runtime-check.marker
  '

echo "Starting the disposable Postgres, migration, API, and Caddy services."
timeout 10m env -u DATABASE_URL -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
  -u SITE_ADDRESS -u RUNTIME_ENV_FILE -u DOCKER_IMAGE_TAG \
  docker compose "${COMPOSE_ARGS[@]}" up --detach --no-build

migrate_id="$(compose ps --all --quiet migrate)"
api_id="$(compose ps --all --quiet api)"
web_id="$(compose ps --all --quiet web)"
storage_id="$(compose ps --all --quiet caddy-storage-init)"
for container in "$migrate_id" "$api_id" "$web_id" "$storage_id"; do
  if [[ -z "$container" ]]; then
    echo "A required service container was not created." >&2
    exit 1
  fi
done

migration_exit="$(docker inspect --format '{{.State.ExitCode}}' "$migrate_id")"
migration_status="$(docker inspect --format '{{.State.Status}}' "$migrate_id")"
if [[ "$migration_status" != "exited" || "$migration_exit" != "0" ]]; then
  echo "The one-shot schema migration did not exit successfully." >&2
  exit 1
fi

assert_container_security() {
  local id="$1"
  local expected_user="$2"
  local expected_drop="$3"
  local expected_add="$4"
  local actual
  local actual_base
  local actual_add
  actual="$(docker inspect --format '{{.Config.User}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.CapAdd}}' "$id")"
  actual_base="${actual%|*}"
  actual_add="${actual##*|}"
  if [[ "$actual_base" != "${expected_user}|${expected_drop}" ]] ||
    { [[ "$expected_add" == "[]" ]] && [[ "$actual_add" != "[]" && "$actual_add" != "null" ]]; } ||
    { [[ "$expected_add" != "[]" ]] && [[ "$actual_add" != "$expected_add" ]]; }; then
    printf 'Container security mismatch: expected %s|%s|%s, got %s\n' \
      "$expected_user" "$expected_drop" "$expected_add" "$actual" >&2
    return 1
  fi
}

assert_container_security "$migrate_id" "node" '["ALL"]' '[]'
assert_container_security "$api_id" "node" '["ALL"]' '[]'
assert_container_security "$web_id" "1001:1001" '["ALL"]' '["NET_BIND_SERVICE"]'
assert_container_security "$storage_id" "0:0" '["ALL"]' '["CHOWN"]'

echo "Waiting up to 120 seconds for Caddy HTTPS, API readiness, and static serving."
ready=0
for _ in $(seq 1 60); do
  if curl --silent --show-error --insecure --max-time 3 \
      --resolve localhost:443:127.0.0.1 \
      --output "$API_HEALTH_FILE" \
      --write-out '%{http_code}' \
      https://localhost/api/healthz 2>/dev/null | grep -qx '200' &&
    curl --silent --show-error --insecure --max-time 3 \
      --resolve localhost:443:127.0.0.1 \
      --output "$STATIC_FILE" \
      --write-out '%{http_code}' \
      https://localhost/ 2>/dev/null | grep -qx '200' &&
    grep -Eiq '<!doctype html|<html([[:space:]>])' "$STATIC_FILE"; then
    ready=1
    break
  fi
  sleep 2
done
if ((ready == 0)); then
  echo "Caddy did not serve a ready API and static application within 120 seconds." >&2
  exit 1
fi

python3 - "$API_HEALTH_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    health = json.load(stream)
if health.get("status") != "ok":
    raise SystemExit("The API readiness endpoint did not report status=ok")
checks = health.get("checks", {})
if checks.get("startup") != "ok" or checks.get("database") != "ok":
    raise SystemExit("The API readiness endpoint did not confirm startup and database readiness")
PY

http_status="$(
  curl --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' \
    --resolve localhost:80:127.0.0.1 http://localhost/
)"
if [[ "$http_status" != "308" ]]; then
  echo "Caddy did not serve HTTP on port 80 and redirect to HTTPS (status ${http_status})." >&2
  exit 1
fi

assert_volume_repaired() {
  docker run --rm --user 1001:1001 --entrypoint /bin/sh \
    --volume "$DATA_VOLUME:/data" \
    --volume "$CONFIG_VOLUME:/config" \
    caddy:2-alpine -ec '
      test "$(stat -c %u:%g /data/runtime-check.marker)" = 1001:1001
      test "$(cat /data/runtime-check.marker)" = preserve-data-volume
      test "$(stat -c %u:%g /config/runtime-check.marker)" = 1001:1001
      test "$(cat /config/runtime-check.marker)" = preserve-config-volume
      printf "written-by-caddy-user\n" >/data/runtime-check.persistence
      printf "written-by-caddy-user\n" >/config/runtime-check.persistence
    '
}
assert_volume_repaired

echo "Restarting Caddy and confirming the repaired volumes still persist."
compose restart web
restarted=0
for _ in $(seq 1 30); do
  if curl --silent --show-error --insecure --max-time 3 \
      --resolve localhost:443:127.0.0.1 \
      --output "$STATIC_FILE" \
      --write-out '%{http_code}' \
      https://localhost/ 2>/dev/null | grep -qx '200'; then
    restarted=1
    break
  fi
  sleep 2
done
if ((restarted == 0)); then
  echo "Caddy did not return on HTTPS after restart." >&2
  exit 1
fi
docker run --rm --user 1001:1001 --entrypoint /bin/sh \
  --volume "$DATA_VOLUME:/data" \
  --volume "$CONFIG_VOLUME:/config" \
  caddy:2-alpine -ec '
    test "$(cat /data/runtime-check.persistence)" = written-by-caddy-user
    test "$(cat /config/runtime-check.persistence)" = written-by-caddy-user
  '

echo "PASS: disposable Docker startup, migration, non-root capabilities, ports, health, static serving, and Caddy volume persistence"
