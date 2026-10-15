#!/usr/bin/env bash

# Regression tests for the release Node launcher. Most cases use temporary
# fake executables; the TLS case uses real npx with a loopback-only fixture
# registry and temporary package data.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LAUNCHER="${SCRIPT_DIR}/run-release-node.sh"
REAL_TIMEOUT_BIN=$(command -v timeout)
REAL_NODE_BIN=$(command -v node)
REAL_NODE_BIN_DIR=$(dirname "$REAL_NODE_BIN")
REAL_NPX_BIN=$(command -v npx)
OPENSSL_BIN=$(command -v openssl)
TAR_BIN=$(command -v tar)
export SYNC_REAL_TIMEOUT="$REAL_TIMEOUT_BIN"
TEST_ROOT=$(mktemp -d)
TLS_SERVER_PID=""
ACTIVE_RUNNER_PIDS=()

cleanup_test_root() {
  local pid
  for pid in "${ACTIVE_RUNNER_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [[ -n "$TLS_SERVER_PID" ]]; then
    kill "$TLS_SERVER_PID" 2>/dev/null || true
    wait "$TLS_SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup_test_root EXIT

REQUIRED_NODE_VERSION="24.20.0"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' \
      "$needle" "$haystack" >&2
    return 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf 'Expected output not to contain: %s\nActual output:\n%s\n' \
      "$needle" "$haystack" >&2
    return 1
  fi
}

make_workspace() {
  local name="$1"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p "${workspace}/scripts/src" "${workspace}/bin" "${workspace}/pinned-bin"
  cp "$LAUNCHER" "${workspace}/scripts/src/run-release-node.sh"
  printf '%s\n' "$REQUIRED_NODE_VERSION" >"${workspace}/.nvmrc"

  cat >"${workspace}/bin/release-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'child-node=%s\n' "$(node --version)" >>"$RUN_LOG"
printf 'node-system-ca=%s\n' "${NODE_USE_SYSTEM_CA:-unset}" >>"$RUN_LOG"
printf 'ssl-cert-file-readable=%s\n' \
  "$([[ -r "${SSL_CERT_FILE:-}" && -s "${SSL_CERT_FILE:-}" ]] && echo yes || echo no)" >>"$RUN_LOG"
printf 'ssl-cert-dir-readable=%s\n' \
  "$([[ -d "${SSL_CERT_DIR:-}" && -r "${SSL_CERT_DIR:-}" ]] && echo yes || echo no)" >>"$RUN_LOG"
pnpm --filter @workspace/scripts exec node --version
EOF
  cat >"${workspace}/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'package-child-node=%s\n' "$(node --version)" >>"$RUN_LOG"
EOF
  chmod +x "${workspace}/bin/release-child" "${workspace}/bin/pnpm"

  printf '%s\n' "$workspace"
}

write_node() {
  local node_path="$1"
  local node_version="$2"

  cat >"$node_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\n' 'v${node_version}'
  exit 0
fi

if [[ "\${1:-}" == *check-routine-node-version.mjs ]]; then
  printf 'preflight-node=%s\n' 'v${node_version}' >>"\$RUN_LOG"
  exit 0
fi

printf 'Unexpected fake node invocation: %s\n' "\$*" >&2
exit 1
EOF
  chmod +x "$node_path"
}

write_failing_npx() {
  local npx_path="$1"

  cat >"$npx_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"$RUN_LOG"
exit 1
EOF
  chmod +x "$npx_path"
}

write_resolution_failure_npx() {
  local npx_path="$1"

  cat >"$npx_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"$RUN_LOG"
printf 'simulated npx package resolution failure\n' >&2
exit 1
EOF
  chmod +x "$npx_path"
}

write_pinned_npx() {
  local npx_path="$1"
  local pinned_node_bin="$2"

  cat >"$npx_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"\$RUN_LOG"

args=("\$@")
  separator=-1
for ((index = 0; index < \${#args[@]}; index++)); do
  if [[ "\${args[index]}" == "--" ]]; then
      separator="\$index"
    break
  fi
done

if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\n' >&2
  exit 1
fi

export PATH="${pinned_node_bin}:\$PATH"
command_args=("\${args[@]:\$((separator + 1))}")
exec "\${command_args[@]}"
EOF
  chmod +x "$npx_path"
}

write_wrong_version_npx() {
  local npx_path="$1"
  local wrong_node_bin="$2"

  cat >"$npx_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"\$RUN_LOG"

args=("\$@")
separator=-1
for ((index = 0; index < \${#args[@]}; index++)); do
  if [[ "\${args[index]}" == "--" ]]; then
    separator="\$index"
    break
  fi
done

if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\n' >&2
  exit 1
fi

export PATH="${wrong_node_bin}:\$PATH"
command_args=("\${args[@]:\$((separator + 1))}")
exec "\${command_args[@]}"
EOF
  chmod +x "$npx_path"
}

run_launcher() {
  local workspace="$1"
  local log_path="$2"
  local path_value="$3"
  local output_path="${workspace}/output"

  set +e
  SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    RUN_LOG="$log_path" PATH="$path_value" \
    bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1
  RUN_STATUS=$?
  set -e
  RUN_OUTPUT=$(cat "$output_path")
}

path_without_npx() {
  local path_entry
  local filtered_path=""
  local path_entries=()

  IFS=: read -r -a path_entries <<<"$PATH"
  for path_entry in "${path_entries[@]}"; do
    [[ -x "${path_entry}/npx" ]] && continue
    if [[ -n "$filtered_path" ]]; then
      filtered_path+=":"
    fi
    filtered_path+="$path_entry"
  done

  printf '%s\n' "$filtered_path"
}

test_matching_node_skips_npx() {
  local workspace
  local log_path
  workspace=$(make_workspace matching)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -eq 0 ]] || {
    printf 'Matching Node path failed. Output:\n%s\n' "$RUN_OUTPUT" >&2
    return 1
  }
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "preflight-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "child-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "node-system-ca=1"
  assert_contains "$events" "ssl-cert-file-readable=yes"
  assert_contains "$events" "ssl-cert-dir-readable=yes"
  assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
  assert_not_contains "$events" "npx-invoked"
  echo "PASS: matching Node path runs preflight, skips npx, and preserves Node for the child"
}

test_mismatching_node_uses_npx() {
  local workspace
  local log_path
  workspace=$(make_workspace mismatching)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_node "${workspace}/pinned-bin/node" "$REQUIRED_NODE_VERSION"
  write_pinned_npx "${workspace}/bin/npx" "${workspace}/pinned-bin"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -eq 0 ]] || {
    printf 'Mismatching Node path failed. Output:\n%s\n' "$RUN_OUTPUT" >&2
    return 1
  }
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_contains "$events" "preflight-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "child-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
  echo "PASS: mismatching Node path invokes npx, runs preflight, and preserves pinned Node for the child"
}

test_wrong_fallback_node_version_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace wrong-fallback-version)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_node "${workspace}/pinned-bin/node" "24.19.0"
  write_wrong_version_npx "${workspace}/bin/npx" "${workspace}/pinned-bin"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Wrong fallback Node version unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release runner resolved Node v24.19.0; expected v${REQUIRED_NODE_VERSION}."
  assert_not_contains "$RUN_OUTPUT" "could not make pinned Node package"
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  assert_not_contains "$events" "package-child-node="
  echo "PASS: wrong fallback Node version fails before preflight or child execution"
}

test_npx_package_resolution_failure_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace package-resolution-failure)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_resolution_failure_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Package resolution failure unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" "simulated npx package resolution failure"
  assert_contains "$RUN_OUTPUT" \
    "Release runner could not make pinned Node package node@${REQUIRED_NODE_VERSION} available via npx; refusing to run release command."
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  echo "PASS: npx package resolution failure reports the fallback boundary before release commands"
}

test_missing_node_selector_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace missing-selector)
  log_path="${workspace}/events"

  rm "${workspace}/.nvmrc"
  : >"$log_path"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Missing Node selector unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release Node selector is missing: ${workspace}/.nvmrc"
  local events
  events=$(cat "$log_path")
  assert_not_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  echo "PASS: missing Node selector fails before npx, preflight, or child execution"
}

test_empty_node_selector_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace empty-selector)
  log_path="${workspace}/events"

  : >"${workspace}/.nvmrc"
  : >"$log_path"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Empty Node selector unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release Node selector is empty: ${workspace}/.nvmrc"
  local events
  events=$(cat "$log_path")
  assert_not_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  echo "PASS: empty Node selector fails before npx, preflight, or child execution"
}

test_missing_npx_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace missing-npx)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:$(path_without_npx)"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Missing npx unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release runner could not find npx; cannot make pinned Node package node@${REQUIRED_NODE_VERSION} available via npx; refusing to run release command."
  assert_not_contains "$RUN_OUTPUT" "command not found"
  if [[ -e "$log_path" ]]; then
    local events
    events=$(cat "$log_path")
    assert_not_contains "$events" "preflight-node="
    assert_not_contains "$events" "child-node="
  fi
  echo "PASS: missing npx reports the tooling boundary before preflight or child execution"
}

test_release_runner_verifies_local_tls_certificates() {
  local workspace="${TEST_ROOT}/tls-verification"
  local cert_dir="${TEST_ROOT}/tls-certificates"
  local server_dir="${TEST_ROOT}/tls-server"
  local wrong_node_dir="${workspace}/wrong-node"
  local node_version
  local registry_port_file="${server_dir}/registry-port"
  local tarball_port_file="${server_dir}/tarball-port"
  local server_output="${server_dir}/output"
  local client_script="${workspace}/https-client.cjs"
  local package_root="${workspace}/package"
  local package_tarball="${workspace}/fixture.tgz"
  local altered_package_tarball="${workspace}/altered-fixture.tgz"
  local tarball_mode_file="${workspace}/tarball-mode"
  local trusted_output="${workspace}/trusted-output"
  local untrusted_output="${workspace}/untrusted-output"
  local trusted_npx_output="${workspace}/trusted-npx-output"
  local untrusted_npx_output="${workspace}/untrusted-npx-output"
  local integrity_npx_output="${workspace}/integrity-npx-output"
  local redirect_integrity_npx_output="${workspace}/redirect-integrity-npx-output"
  local registry_requests="${workspace}/registry-requests"
  local tarball_requests="${workspace}/tarball-requests"
  local redirect_mode_file="${workspace}/redirect-mode"
  local npx_log="${workspace}/npx-log"
  local package_name="replit-release-runner-tls-fixture"
  local package_version="1.0.0"
  local url
  local attempt
  local status

  mkdir -p "${workspace}/scripts/src" "$wrong_node_dir" "$cert_dir" "$server_dir"
  cp "$LAUNCHER" "${workspace}/scripts/src/run-release-node.sh"
  node_version=$("$REAL_NODE_BIN" --version)
  printf '%s\n' "${node_version#v}" >"${workspace}/.nvmrc"
  cat >"${workspace}/scripts/src/check-routine-node-version.mjs" <<'EOF'
process.exit(0);
EOF
  write_node "${wrong_node_dir}/node" "deliberately-mismatched"
  cat >"${wrong_node_dir}/npx" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\\n' >>"\$RUN_LOG"
args=("\$@")
separator=-1
for ((index = 0; index < \${#args[@]}; index++)); do
  if [[ "\${args[index]}" == "--" ]]; then
    separator="\$index"
    break
  fi
done

if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\\n' >&2
  exit 1
fi

expected_package="--package=node@${node_version#v}"
package_found=false
for argument in "\${args[@]}"; do
  if [[ "\$argument" == "\$expected_package" ]]; then
    package_found=true
    break
  fi
done
if [[ "\$package_found" != true ]]; then
  printf 'Expected npx to select %s.\\n' "\$expected_package" >&2
  exit 1
fi

export PATH="${REAL_NODE_BIN_DIR}:\$PATH"
command_args=("\${args[@]:\$((separator + 1))}")
exec "\${command_args[@]}"
EOF
  chmod +x "${wrong_node_dir}/npx"

  "$OPENSSL_BIN" req -x509 -newkey rsa:2048 -nodes \
    -keyout "${cert_dir}/test-ca.key" \
    -out "${cert_dir}/test-ca.pem" \
    -days 2 \
    -subj "/CN=Release Runner Temporary Test CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    >"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the temporary TLS test CA.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  "$OPENSSL_BIN" req -new -newkey rsa:2048 -nodes \
    -keyout "${cert_dir}/server.key" \
    -out "${cert_dir}/server.csr" \
    -subj "/CN=localhost" \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the temporary TLS server key and request.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  cat >"${cert_dir}/server-extensions.cnf" <<'EOF'
[server_cert]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF
  "$OPENSSL_BIN" x509 -req \
    -in "${cert_dir}/server.csr" \
    -CA "${cert_dir}/test-ca.pem" \
    -CAkey "${cert_dir}/test-ca.key" \
    -CAcreateserial \
    -out "${cert_dir}/server.pem" \
    -days 2 \
    -extfile "${cert_dir}/server-extensions.cnf" \
    -extensions server_cert \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not sign the temporary TLS server certificate.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }

  mkdir -p \
    "${package_root}/bin" \
    "${workspace}/home" \
    "${workspace}/tmp" \
    "${workspace}/xdg-config"
  cat >"${package_root}/package.json" <<EOF
{
  "name": "${package_name}",
  "version": "${package_version}",
  "bin": {
    "local-npx-tls-fixture": "bin/run.cjs"
  }
}
EOF
  cat >"${package_root}/bin/run.cjs" <<'EOF'
#!/usr/bin/env node
console.log("local npx package resolved over verified TLS");
EOF
  chmod +x "${package_root}/bin/run.cjs"
  "$TAR_BIN" -czf "$package_tarball" -C "$workspace" package
  cp "$package_tarball" "$altered_package_tarball"
  printf 'altered package bytes\n' >>"$altered_package_tarball"
  printf 'matching\n' >"$tarball_mode_file"
  printf 'direct\n' >"$redirect_mode_file"
  : >"$registry_requests"
  : >"$tarball_requests"
  : >"${workspace}/empty-user.npmrc"
  : >"${workspace}/empty-global.npmrc"

  cat >"${server_dir}/https-server.cjs" <<'EOF'
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");

const [
  keyPath,
  certPath,
  registryPortPath,
  tarballPortPath,
  packageTarballPath,
  alteredPackageTarballPath,
  tarballModePath,
  redirectModePath,
  requestLogPath,
  tarballRequestLogPath,
] = process.argv.slice(2);
const packageName = "replit-release-runner-tls-fixture";
const packageVersion = "1.0.0";
const packageTarball = fs.readFileSync(packageTarballPath);
const alteredPackageTarball = fs.readFileSync(alteredPackageTarballPath);
const tlsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};
const registryServer = https.createServer(
  tlsOptions,
  (request, response) => {
    fs.appendFileSync(requestLogPath, `${request.method} ${request.url}\n`);
    const requestUrl = new URL(request.url, "https://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === `/${packageName}`) {
      const integrity =
        "sha512-" +
        crypto.createHash("sha512").update(packageTarball).digest("base64");
      const shasum = crypto.createHash("sha1").update(packageTarball).digest("hex");
      const metadata = {
        name: packageName,
        "dist-tags": { latest: packageVersion },
        versions: {
          [packageVersion]: {
            name: packageName,
            version: packageVersion,
            bin: { "local-npx-tls-fixture": "bin/run.cjs" },
            dist: {
              tarball:
                fs.readFileSync(redirectModePath, "utf8").trim() === "redirect"
                  ? `https://127.0.0.1:${registryServer.address().port}/redirect.tgz`
                  : `https://127.0.0.1:${registryServer.address().port}/fixture.tgz`,
              integrity,
              shasum,
            },
          },
        },
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(metadata));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/redirect.tgz") {
      response.writeHead(302, {
        location: `https://127.0.0.1:${tarballServer.address().port}/fixture.tgz`,
      });
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/fixture.tgz") {
      const tarball =
        fs.readFileSync(tarballModePath, "utf8").trim() === "altered"
          ? alteredPackageTarball
          : packageTarball;
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": tarball.length,
      });
      response.end(tarball);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("verified local TLS fixture");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  },
);

const tarballServer = https.createServer(tlsOptions, (request, response) => {
  fs.appendFileSync(tarballRequestLogPath, `${request.method} ${request.url}\n`);
  const requestUrl = new URL(request.url, "https://127.0.0.1");

  if (request.method === "GET" && requestUrl.pathname === "/fixture.tgz") {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": alteredPackageTarball.length,
    });
    response.end(alteredPackageTarball);
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

tarballServer.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(tarballPortPath, String(tarballServer.address().port));
  registryServer.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(registryPortPath, String(registryServer.address().port));
  });
});
EOF
  cat >"$client_script" <<'EOF'
const https = require("node:https");

const request = https.get(process.argv[2], (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    if (response.statusCode !== 200 || body !== "verified local TLS fixture") {
      console.error(`Unexpected HTTPS response: ${response.statusCode} ${body}`);
      process.exitCode = 1;
      return;
    }
    console.log(body);
  });
});

request.setTimeout(5000, () => request.destroy(new Error("HTTPS request timed out")));
request.on("error", (error) => {
  console.error(`HTTPS request failed: ${error.code ?? error.message}`);
  process.exitCode = 1;
});
EOF

  "$REAL_NODE_BIN" "${server_dir}/https-server.cjs" \
    "${cert_dir}/server.key" "${cert_dir}/server.pem" \
    "$registry_port_file" "$tarball_port_file" \
    "$package_tarball" "$altered_package_tarball" "$tarball_mode_file" \
    "$redirect_mode_file" "$registry_requests" "$tarball_requests" \
    >"$server_output" 2>&1 &
  TLS_SERVER_PID=$!
  for ((attempt = 0; attempt < 100; attempt++)); do
    [[ -s "$registry_port_file" && -s "$tarball_port_file" ]] && break
    if ! kill -0 "$TLS_SERVER_PID" 2>/dev/null; then
      printf 'Local HTTPS fixture server exited before becoming ready.\n' >&2
      cat "$server_output" >&2
      return 1
    fi
    sleep 0.05
  done
  if [[ ! -s "$registry_port_file" || ! -s "$tarball_port_file" ]]; then
    printf 'Local HTTPS fixture server did not become ready in time.\n' >&2
    cat "$server_output" >&2
    return 1
  fi
  url="https://127.0.0.1:$(cat "$registry_port_file")/"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$url" >"$trusted_output" 2>&1
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$trusted_output")" != *"verified local TLS fixture"* ]]; then
    printf 'Pinned runner did not trust the explicitly supplied test CA (status %s):\n' \
      "$status" >&2
    cat "$trusted_output" >&2
    return 1
  fi
  assert_contains "$(cat "$npx_log")" "npx-invoked"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$url" >"$untrusted_output" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Pinned runner accepted a server certificate signed by the untrusted test CA.\n' >&2
    cat "$untrusted_output" >&2
    return 1
  fi
  local untrusted_result
  untrusted_result=$(cat "$untrusted_output")
  if [[ "$untrusted_result" != *"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"* &&
    "$untrusted_result" != *"UNABLE_TO_VERIFY_LEAF_SIGNATURE"* &&
    "$untrusted_result" != *"DEPTH_ZERO_SELF_SIGNED_CERT"* ]]; then
    printf 'Untrusted TLS failed for a reason other than certificate validation:\n%s\n' \
      "$untrusted_result" >&2
    return 1
  fi
  assert_contains "$(cat "$npx_log")" "npx-invoked"

  run_local_npx() {
    local cafile="$1"
    local cache_dir="$2"
    local output_path="$3"
    local -a npm_environment=(
      "PATH=${REAL_NODE_BIN_DIR}:$(dirname "$REAL_NPX_BIN"):/usr/bin:/bin"
      "HOME=${workspace}/home"
      "TMPDIR=${workspace}/tmp"
      "XDG_CONFIG_HOME=${workspace}/xdg-config"
      "npm_config_registry=${url}"
      "npm_config_cache=${cache_dir}"
      "npm_config_userconfig=${workspace}/empty-user.npmrc"
      "npm_config_globalconfig=${workspace}/empty-global.npmrc"
      "npm_config_audit=false"
      "npm_config_fund=false"
      "npm_config_update_notifier=false"
      "npm_config_fetch_retries=0"
      "npm_config_fetch_timeout=10000"
      "npm_config_strict_ssl=true"
      "SSL_CERT_FILE=${workspace}/missing-ca.pem"
      "SSL_CERT_DIR=${workspace}/missing-ca-dir"
    )

    if [[ -n "$cafile" ]]; then
      npm_environment+=("npm_config_cafile=${cafile}")
    fi

    (
      cd "$workspace"
      env -i "${npm_environment[@]}" \
        "$REAL_NPX_BIN" --yes \
        --package="${package_name}@${package_version}" \
        -- local-npx-tls-fixture
    ) >"$output_path" 2>&1
  }

  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/trusted-npm-cache" "$trusted_npx_output"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$trusted_npx_output")" != *"local npx package resolved over verified TLS"* ]]; then
    printf 'Installed npx did not resolve the fixture with its temporary CA (status %s):\n' \
      "$status" >&2
    cat "$trusted_npx_output" >&2
    return 1
  fi

  set +e
  run_local_npx "" \
    "${workspace}/untrusted-npm-cache" "$untrusted_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted the registry certificate without the temporary CA.\n' >&2
    cat "$untrusted_npx_output" >&2
    return 1
  fi
  local untrusted_npx_result
  untrusted_npx_result=$(cat "$untrusted_npx_output")
  if [[ "$untrusted_npx_result" != *"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"* &&
    "$untrusted_npx_result" != *"UNABLE_TO_VERIFY_LEAF_SIGNATURE"* &&
    "$untrusted_npx_result" != *"SELF_SIGNED_CERT_IN_CHAIN"* &&
    "$untrusted_npx_result" != *"DEPTH_ZERO_SELF_SIGNED_CERT"* ]]; then
    printf 'Untrusted npx registry request failed for a reason other than certificate validation:\n%s\n' \
      "$untrusted_npx_result" >&2
    return 1
  fi
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /fixture.tgz"

  printf 'altered\n' >"$tarball_mode_file"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/integrity-npm-cache" "$integrity_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted altered tarball bytes with the original integrity metadata.\n' >&2
    cat "$integrity_npx_output" >&2
    return 1
  fi
  local integrity_npx_result
  integrity_npx_result=$(cat "$integrity_npx_output")
  if [[ "$integrity_npx_result" != *"EINTEGRITY"* &&
    "$integrity_npx_result" != *"integrity checksum failed"* ]]; then
    printf 'Altered tarball failed for a reason other than npm integrity validation:\n%s\n' \
      "$integrity_npx_result" >&2
    return 1
  fi
  assert_not_contains "$integrity_npx_result" \
    "local npx package resolved over verified TLS"
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /fixture.tgz"

  printf 'redirect\n' >"$redirect_mode_file"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/redirect-integrity-npm-cache" "$redirect_integrity_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted altered tarball bytes after following a registry redirect.\n' >&2
    cat "$redirect_integrity_npx_output" >&2
    return 1
  fi
  local redirect_integrity_npx_result
  redirect_integrity_npx_result=$(cat "$redirect_integrity_npx_output")
  if [[ "$redirect_integrity_npx_result" != *"EINTEGRITY"* &&
    "$redirect_integrity_npx_result" != *"integrity checksum failed"* ]]; then
    printf 'Redirected altered tarball failed for a reason other than npm integrity validation:\n%s\n' \
      "$redirect_integrity_npx_result" >&2
    return 1
  fi
  assert_not_contains "$redirect_integrity_npx_result" \
    "local npx package resolved over verified TLS"
  assert_contains "$(cat "$registry_requests")" "GET /redirect.tgz"
  assert_contains "$(cat "$tarball_requests")" "GET /fixture.tgz"

  kill "$TLS_SERVER_PID" 2>/dev/null || true
  wait "$TLS_SERVER_PID" 2>/dev/null || true
  TLS_SERVER_PID=""
  echo "PASS: Node and installed npx verify the test CA, reject an untrusted CA, and reject altered package bytes directly and after redirect"
}

ISOLATED_BROWSER_RUNNER="${SCRIPT_DIR}/run-isolated-browser-suite.sh"
ISOLATED_TEST_BIN="${TEST_ROOT}/isolated-browser-bin"
ISOLATED_TEST_OUTPUT="${TEST_ROOT}/isolated-browser-output"
ISOLATED_DB_PATH_FILE="${TEST_ROOT}/isolated-browser-db-path"
ISOLATED_PLAYWRIGHT_STARTED="${TEST_ROOT}/isolated-playwright-started"
ISOLATED_PLAYWRIGHT_STOPPED="${TEST_ROOT}/isolated-playwright-stopped"
mkdir -p "$ISOLATED_TEST_BIN"

cat >"${ISOLATED_TEST_BIN}/postgres" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${ISOLATED_TEST_BIN}/initdb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    printf '%s\n' "${args[index + 1]}" >"$ISOLATED_DB_PATH_FILE"
    exit 0
  fi
done
printf 'initdb did not receive a data directory.\n' >&2
exit 2
EOF

cat >"${ISOLATED_TEST_BIN}/pg_ctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
data_dir=""
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    data_dir="${args[index + 1]}"
    break
  fi
done
action="${args[${#args[@]} - 1]}"
case "$action" in
  start)
    : >"${data_dir}/running"
    ;;
  stop)
    rm -f "${data_dir}/running"
    ;;
  status)
    if [[ -f "${data_dir}/running" ]]; then
      exit 0
    fi
    exit 3
    ;;
  *)
    printf 'Unexpected pg_ctl action: %s\n' "$action" >&2
    exit 2
    ;;
esac
EOF

cat >"${ISOLATED_TEST_BIN}/createdb" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${ISOLATED_TEST_BIN}/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--filter" ]]; then
  exit 0
fi
if [[ "${1:-}" == "exec" && "${2:-}" == "playwright" && "${3:-}" == "test" ]]; then
  : >"$ISOLATED_PLAYWRIGHT_STARTED"
  if [[ "${ISOLATED_PLAYWRIGHT_MODE:-}" == "hang" ]]; then
    trap 'touch "$ISOLATED_PLAYWRIGHT_STOPPED"; exit 143' INT TERM
    while :; do
      sleep 1
    done
  fi
  exit "${ISOLATED_PLAYWRIGHT_STATUS:-0}"
fi
printf 'Unexpected pnpm invocation: %s\n' "$*" >&2
exit 64
EOF

chmod +x \
  "${ISOLATED_TEST_BIN}/postgres" \
  "${ISOLATED_TEST_BIN}/initdb" \
  "${ISOLATED_TEST_BIN}/pg_ctl" \
  "${ISOLATED_TEST_BIN}/createdb" \
  "${ISOLATED_TEST_BIN}/pnpm"

run_isolated_browser_case() {
  local expected_status="$1"
  local playwright_status="$2"
  local actual_status
  rm -f "$ISOLATED_DB_PATH_FILE" "$ISOLATED_PLAYWRIGHT_STARTED"

  set +e
  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${ISOLATED_TEST_BIN}:${PATH}" \
    ISOLATED_DB_PATH_FILE="$ISOLATED_DB_PATH_FILE" \
    ISOLATED_PLAYWRIGHT_STARTED="$ISOLATED_PLAYWRIGHT_STARTED" \
    ISOLATED_PLAYWRIGHT_STATUS="$playwright_status" \
    bash "$ISOLATED_BROWSER_RUNNER" \
    --playwright-config=playwright.smoke.config.ts \
    >"$ISOLATED_TEST_OUTPUT" 2>&1
  actual_status=$?
  set -e

  [[ "$actual_status" -eq "$expected_status" ]] || {
    printf 'Expected isolated browser status %s, got %s. Output:\n' \
      "$expected_status" "$actual_status" >&2
    cat "$ISOLATED_TEST_OUTPUT" >&2
    return 1
  }
  [[ -f "$ISOLATED_DB_PATH_FILE" ]] || {
    printf 'Isolated browser run did not create its disposable database.\n' >&2
    return 1
  }
  local db_path
  db_path=$(cat "$ISOLATED_DB_PATH_FILE")
  [[ ! -e "$db_path" ]] || {
    printf 'Isolated browser run left its disposable database at %s.\n' \
      "$db_path" >&2
    return 1
  }
}

test_isolated_browser_status_and_database_cleanup() {
  run_isolated_browser_case 0 0
  run_isolated_browser_case 37 37
  (
    cd "$TEST_ROOT"
    run_isolated_browser_case 0 0
  )
  echo "PASS: isolated browser runner preserves Playwright status and cleans its disposable database"
  echo "PASS: isolated browser runner resolves its workspace independently of the caller directory"
}

test_isolated_browser_interrupt_cleans_database() {
  rm -f \
    "$ISOLATED_DB_PATH_FILE" \
    "$ISOLATED_PLAYWRIGHT_STARTED" \
    "$ISOLATED_PLAYWRIGHT_STOPPED"
  set +e
  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${ISOLATED_TEST_BIN}:${PATH}" \
    ISOLATED_DB_PATH_FILE="$ISOLATED_DB_PATH_FILE" \
    ISOLATED_PLAYWRIGHT_STARTED="$ISOLATED_PLAYWRIGHT_STARTED" \
    ISOLATED_PLAYWRIGHT_STOPPED="$ISOLATED_PLAYWRIGHT_STOPPED" \
    ISOLATED_PLAYWRIGHT_MODE=hang \
    bash "$ISOLATED_BROWSER_RUNNER" \
    --playwright-config=playwright.smoke.config.ts \
    >"$ISOLATED_TEST_OUTPUT" 2>&1 &
  local runner_pid=$!
  local attempt
  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$ISOLATED_PLAYWRIGHT_STARTED" ]] && break
    sleep 0.1
  done
  if [[ ! -f "$ISOLATED_PLAYWRIGHT_STARTED" ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    set -e
    printf 'Isolated browser runner did not reach the Playwright command.\n' >&2
    cat "$ISOLATED_TEST_OUTPUT" >&2
    return 1
  fi
  kill -TERM "$runner_pid"
  wait "$runner_pid"
  local actual_status=$?
  set -e

  [[ "$actual_status" -eq 143 ]] || {
    printf 'Expected interrupted isolated browser status 143, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$ISOLATED_TEST_OUTPUT" >&2
    return 1
  }
  [[ -f "$ISOLATED_PLAYWRIGHT_STOPPED" ]] || {
    printf 'Interrupted Playwright process did not receive the forwarded signal.\n' >&2
    return 1
  }
  local db_path
  db_path=$(cat "$ISOLATED_DB_PATH_FILE")
  [[ ! -e "$db_path" ]] || {
    printf 'Interrupted browser run left its disposable database at %s.\n' \
      "$db_path" >&2
    return 1
  }
  echo "PASS: interrupted isolated browser runner stops Playwright and removes its disposable database"
}

ISOLATED_SYNC_RUNNER="${SCRIPT_DIR}/run-isolated-sync-convergence.sh"
SYNC_TEST_BIN="${TEST_ROOT}/isolated-sync-bin"
mkdir -p "$SYNC_TEST_BIN"

cat >"${SYNC_TEST_BIN}/postgres" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${SYNC_TEST_BIN}/initdb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    printf '%s\n' "${args[index + 1]}" >"$SYNC_DB_PATH_FILE"
    exit 0
  fi
done
printf 'initdb did not receive a data directory.\n' >&2
exit 2
EOF

cat >"${SYNC_TEST_BIN}/pg_ctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
data_dir=""
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    data_dir="${args[index + 1]}"
    break
  fi
done
action="${args[${#args[@]} - 1]}"
case "$action" in
  start)
    : >"${data_dir}/running"
    : >"$SYNC_PG_STARTED"
    ;;
  stop)
    : >"$SYNC_PG_STOP_ATTEMPTED"
      if [[ -n "${SYNC_TIMEOUT_SESSION_FILE:-}" &&
        -s "$SYNC_TIMEOUT_SESSION_FILE" ]]; then
        test_session=$(cat "$SYNC_TIMEOUT_SESSION_FILE")
        if ps -eo sid=,stat= |
          awk -v session="$test_session" \
            '$1 == session && $2 !~ /^Z/ { found = 1 } END { exit !found }'; then
          : >"$SYNC_PG_STOP_WITH_TEST_CHILDREN"
        fi
      fi
    if [[ "${SYNC_PG_STOP_FAILURE:-0}" == "1" ]]; then
      exit 1
    fi
    rm -f "${data_dir}/running"
    : >"$SYNC_PG_STOPPED"
    ;;
  status)
    [[ -f "${data_dir}/running" ]]
    ;;
  *)
    printf 'Unexpected pg_ctl action: %s\n' "$action" >&2
    exit 2
    ;;
esac
EOF

cat >"${SYNC_TEST_BIN}/createdb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${@: -1}" >"$SYNC_DB_NAME_FILE"
EOF

cat >"${SYNC_TEST_BIN}/api-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'touch "$SYNC_API_STOPPED"; exit 0' TERM
touch "$SYNC_API_STARTED"
while :; do sleep 1; done
EOF

cat >"${SYNC_TEST_BIN}/vitest-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'touch "$SYNC_VITEST_STOPPED"; exit 0' TERM
touch "$SYNC_VITEST_STARTED"
while :; do sleep 1; done
EOF

cat >"${SYNC_TEST_BIN}/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--filter" ||
  "${2:-}" != "@workspace/api-server" ||
  "${3:-}" != "exec" ||
  "${4:-}" != "vitest" ]]; then
  printf 'Unexpected isolated sync pnpm invocation: %s\n' "$*" >&2
  exit 64
fi
printf '%s\n' "${DATABASE_URL:-<unset>}" >"$SYNC_DATABASE_URL_FILE"
printf '%s\n' "$*" >"$SYNC_PNPM_ARGS_FILE"
touch "$SYNC_PNPM_STARTED"
bash "$SYNC_TEST_BIN/api-child" &
bash "$SYNC_TEST_BIN/vitest-child" &
wait
EOF

chmod +x \
  "${SYNC_TEST_BIN}/postgres" \
  "${SYNC_TEST_BIN}/initdb" \
  "${SYNC_TEST_BIN}/pg_ctl" \
  "${SYNC_TEST_BIN}/createdb" \
  "${SYNC_TEST_BIN}/api-child" \
  "${SYNC_TEST_BIN}/vitest-child" \
  "${SYNC_TEST_BIN}/pnpm"

cat >"${SYNC_TEST_BIN}/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${SYNC_TIMEOUT_TEST_MODE:-}" != "expire" ]]; then
  exec "$SYNC_REAL_TIMEOUT" "$@"
fi

while (( $# > 0 )); do
  case "$1" in
    --*)
      shift
      ;;
    [0-9]*s|[0-9]*m|[0-9]*h)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done
if (( $# == 0 )); then
  printf 'Fake timeout did not receive a command.\n' >&2
  exit 64
fi

test_session=$(ps -o sid= -p "$$" | tr -d ' ')
printf '%s\n' "$test_session" >"$SYNC_TIMEOUT_SESSION_FILE"
"$@" &
command_pid=$!
for ((attempt = 0; attempt < 200; attempt++)); do
  if [[ -f "$SYNC_PNPM_STARTED" &&
    -f "$SYNC_API_STARTED" &&
    -f "$SYNC_VITEST_STARTED" ]]; then
    break
  fi
  sleep 0.01
done
if [[ ! -f "$SYNC_PNPM_STARTED" ||
  ! -f "$SYNC_API_STARTED" ||
  ! -f "$SYNC_VITEST_STARTED" ]]; then
  kill -TERM "$command_pid" 2>/dev/null || true
  wait "$command_pid" 2>/dev/null || true
  printf 'Fake timeout command did not start its test descendants.\n' >&2
  exit 65
fi

touch "$SYNC_TIMEOUT_STARTED"
printf 'fake timeout expired\n'
# Mirror a timeout that stops its direct command but exits without waiting for
# grandchildren that are still in the runner-owned session.
kill -TERM "$command_pid" 2>/dev/null || true
wait "$command_pid" 2>/dev/null || true
touch "$SYNC_TIMEOUT_EXPIRED"
exit 124
EOF
chmod +x "${SYNC_TEST_BIN}/timeout"

run_isolated_sync_interrupt_case() {
  local case_name="$1"
  local stop_failure="$2"
  local case_dir="${TEST_ROOT}/sync-${case_name}"
  local db_path
  local db_name
  local db_url
  local actual_status
  local attempt
  local runner_pid
  local output_path="${case_dir}/output"
  mkdir -p "${case_dir}/tmp"

  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${SYNC_TEST_BIN}:${PATH}" \
    TMPDIR="${case_dir}/tmp" \
    DATABASE_URL="postgresql://shared.example/should-not-be-used" \
    SYNC_DB_PATH_FILE="${case_dir}/db-path" \
    SYNC_DB_NAME_FILE="${case_dir}/db-name" \
    SYNC_DATABASE_URL_FILE="${case_dir}/database-url" \
    SYNC_PNPM_ARGS_FILE="${case_dir}/pnpm-args" \
    SYNC_PG_STARTED="${case_dir}/pg-started" \
    SYNC_PG_STOP_ATTEMPTED="${case_dir}/pg-stop-attempted" \
    SYNC_PG_STOPPED="${case_dir}/pg-stopped" \
    SYNC_PG_STOP_FAILURE="$stop_failure" \
    SYNC_PNPM_STARTED="${case_dir}/pnpm-started" \
    SYNC_API_STARTED="${case_dir}/api-started" \
    SYNC_API_STOPPED="${case_dir}/api-stopped" \
    SYNC_VITEST_STARTED="${case_dir}/vitest-started" \
    SYNC_VITEST_STOPPED="${case_dir}/vitest-stopped" \
    SYNC_TEST_BIN="$SYNC_TEST_BIN" \
    bash "$ISOLATED_SYNC_RUNNER" >"$output_path" 2>&1 &
  runner_pid=$!

  for ((attempt = 0; attempt < 200; attempt++)); do
    if [[ -f "${case_dir}/pnpm-started" &&
      -f "${case_dir}/api-started" &&
      -f "${case_dir}/vitest-started" ]]; then
      break
    fi
    sleep 0.1
  done
  if [[ ! -f "${case_dir}/pnpm-started" ||
    ! -f "${case_dir}/api-started" ||
    ! -f "${case_dir}/vitest-started" ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not reach the API/Vitest test processes.\n' >&2
    cat "$output_path" >&2
    return 1
  fi

  [[ -f "${case_dir}/db-path" && -f "${case_dir}/database-url" ]] || {
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not initialize its disposable database.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  db_url=$(cat "${case_dir}/database-url")
  db_name=$(cat "${case_dir}/db-name")
  if [[ ! "$db_url" =~ ^postgresql://postgres@127\.0\.0\.1:[0-9]+/sync_convergence_test_[[:xdigit:]]{12}$ ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not replace the inherited shared database URL: %s\n' \
      "$db_url" >&2
    return 1
  fi
  [[ "$db_url" == */"$db_name" ]] || {
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner connected to a database other than the one it created.\n' >&2
    return 1
  }
  grep -Fq 'src/routes/sync.convergence.integration.test.ts' \
    "${case_dir}/pnpm-args" || {
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not pass the owned integration test path to Vitest.\n' >&2
    return 1
  }

  kill -TERM "$runner_pid"
  set +e
  wait "$runner_pid"
  actual_status=$?
  set -e
  [[ "$actual_status" -eq 143 ]] || {
    printf 'Expected interrupted isolated sync status 143, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/api-stopped" && -f "${case_dir}/vitest-stopped" ]] || {
    printf 'Interrupted isolated sync run did not stop both API and Vitest children.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/pg-stop-attempted" ]] || {
    printf 'Interrupted isolated sync run did not attempt to stop PostgreSQL.\n' >&2
    cat "$output_path" >&2
    return 1
  }

  db_path=$(cat "${case_dir}/db-path")
  if [[ "$stop_failure" == "1" ]]; then
    [[ -d "$db_path" ]] || {
      printf 'Unstoppable disposable PostgreSQL data directory was not preserved.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    assert_contains "$(cat "$output_path")" \
      "Could not confirm that the disposable PostgreSQL server stopped; preserving its data directory at ${db_path}."
    rm -rf -- "$db_path"
  else
    [[ -f "${case_dir}/pg-stopped" ]] || {
      printf 'Interrupted isolated sync run did not stop PostgreSQL.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    [[ ! -e "$db_path" ]] || {
      printf 'Interrupted isolated sync run left its disposable data directory at %s.\n' \
        "$db_path" >&2
      return 1
    }
  fi
}

test_isolated_sync_interrupt_cleans_database_and_children() {
  run_isolated_sync_interrupt_case stopped 0
  run_isolated_sync_interrupt_case unconfirmed-stop 1
  echo "PASS: interrupted isolated sync runner stops API/Vitest and cleans or safely preserves its disposable database"
}

run_isolated_sync_timeout_case() {
  local case_name="$1"
  local stop_failure="$2"
  local case_dir="${TEST_ROOT}/sync-timeout-${case_name}"
  local db_path
  local db_name
  local db_url
  local test_session
  local actual_status
  local attempt
  local runner_pid
  local output_path="${case_dir}/output"
  mkdir -p "${case_dir}/tmp"

  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${SYNC_TEST_BIN}:${PATH}" \
    TMPDIR="${case_dir}/tmp" \
    DATABASE_URL="postgresql://shared.example/should-not-be-used" \
    SYNC_DB_PATH_FILE="${case_dir}/db-path" \
    SYNC_DB_NAME_FILE="${case_dir}/db-name" \
    SYNC_DATABASE_URL_FILE="${case_dir}/database-url" \
    SYNC_PNPM_ARGS_FILE="${case_dir}/pnpm-args" \
    SYNC_PG_STARTED="${case_dir}/pg-started" \
    SYNC_PG_STOP_ATTEMPTED="${case_dir}/pg-stop-attempted" \
    SYNC_PG_STOPPED="${case_dir}/pg-stopped" \
    SYNC_PG_STOP_WITH_TEST_CHILDREN="${case_dir}/pg-stop-with-test-children" \
    SYNC_PG_STOP_FAILURE="$stop_failure" \
    SYNC_PNPM_STARTED="${case_dir}/pnpm-started" \
    SYNC_API_STARTED="${case_dir}/api-started" \
    SYNC_API_STOPPED="${case_dir}/api-stopped" \
    SYNC_VITEST_STARTED="${case_dir}/vitest-started" \
    SYNC_VITEST_STOPPED="${case_dir}/vitest-stopped" \
    SYNC_TIMEOUT_SESSION_FILE="${case_dir}/timeout-session" \
    SYNC_TIMEOUT_STARTED="${case_dir}/timeout-started" \
    SYNC_TIMEOUT_EXPIRED="${case_dir}/timeout-expired" \
    SYNC_TIMEOUT_TEST_MODE=expire \
    SYNC_REAL_TIMEOUT="$REAL_TIMEOUT_BIN" \
    SYNC_TEST_BIN="$SYNC_TEST_BIN" \
    bash "$ISOLATED_SYNC_RUNNER" >"$output_path" 2>&1 &
  runner_pid=$!

  for ((attempt = 0; attempt < 250; attempt++)); do
    [[ -f "${case_dir}/timeout-expired" ]] && break
    sleep 0.1
  done
  if [[ ! -f "${case_dir}/timeout-expired" ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not exercise fake timeout expiry.\n' >&2
    cat "$output_path" >&2
    return 1
  fi

  set +e
  wait "$runner_pid"
  actual_status=$?
  set -e
  [[ "$actual_status" -eq 124 ]] || {
    printf 'Expected timed-out isolated sync status 124, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/api-stopped" && -f "${case_dir}/vitest-stopped" ]] || {
    printf 'Timed-out isolated sync run did not stop both API and Vitest children.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/pg-stop-attempted" ]] || {
    printf 'Timed-out isolated sync run did not attempt to stop PostgreSQL.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ ! -e "${case_dir}/pg-stop-with-test-children" ]] || {
    printf 'Timed-out isolated sync run attempted PostgreSQL cleanup before stopping test descendants.\n' >&2
    cat "$output_path" >&2
    return 1
  }

  db_url=$(cat "${case_dir}/database-url")
  db_name=$(cat "${case_dir}/db-name")
  if [[ ! "$db_url" =~ ^postgresql://postgres@127\.0\.0\.1:[0-9]+/sync_convergence_test_[[:xdigit:]]{12}$ ||
    "$db_url" != */"$db_name" ]]; then
    printf 'Timed-out isolated sync runner did not use its own disposable database URL: %s\n' \
      "$db_url" >&2
    cat "$output_path" >&2
    return 1
  fi

  test_session=$(cat "${case_dir}/timeout-session")
  if ps -eo sid=,stat= |
    awk -v session="$test_session" \
      '$1 == session && $2 !~ /^Z/ { found = 1 } END { exit !found }'; then
    printf 'Timed-out isolated sync run left live test descendants in session %s.\n' \
      "$test_session" >&2
    cat "$output_path" >&2
    return 1
  fi

  db_path=$(cat "${case_dir}/db-path")
  if [[ "$stop_failure" == "1" ]]; then
    [[ -d "$db_path" && -f "${db_path}/running" ]] || {
      printf 'Unconfirmed PostgreSQL shutdown did not preserve its live data directory.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    assert_contains "$(cat "$output_path")" \
      "Could not confirm that the disposable PostgreSQL server stopped; preserving its data directory at ${db_path}."
    rm -rf -- "$db_path"
  else
    [[ -f "${case_dir}/pg-stopped" ]] || {
      printf 'Timed-out isolated sync run did not stop PostgreSQL.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    [[ ! -e "$db_path" ]] || {
      printf 'Timed-out isolated sync run left its disposable data directory at %s.\n' \
        "$db_path" >&2
      return 1
    }
  fi
}

test_isolated_sync_timeout_cleans_descendants_before_database() {
  run_isolated_sync_timeout_case stopped 0
  run_isolated_sync_timeout_case unconfirmed-stop 1
  echo "PASS: timed-out isolated sync runner stops test descendants before PostgreSQL cleanup and removes or safely preserves its disposable database"
}

test_release_node_fallback_interrupt_stops_process_group() {
  local workspace
  local log_path
  local started_path
  local stopped_path
  local output_path
  local launcher_pid
  local attempt
  local actual_status
  workspace=$(make_workspace fallback-interrupt)
  log_path="${workspace}/events"
  started_path="${workspace}/npx-started"
  stopped_path="${workspace}/npx-stopped"
  output_path="${workspace}/output"
  mkdir -p "${workspace}/tmp"
  write_node "${workspace}/bin/node" "24.19.0"
  cat >"${workspace}/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "$NPX_STARTED"
trap 'touch "$NPX_STOPPED"; exit 143' TERM
while :; do
  sleep 1
done
EOF
  chmod +x "${workspace}/bin/npx"

  RUN_LOG="$log_path" \
    NPX_STARTED="$started_path" \
    NPX_STOPPED="$stopped_path" \
    TMPDIR="${workspace}/tmp" \
    PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1 &
  launcher_pid=$!

  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$started_path" ]] && break
    sleep 0.1
  done
  if [[ ! -f "$started_path" ]]; then
    kill -TERM "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
    printf 'Pinned-Node fallback did not reach its npx process.\n' >&2
    cat "$output_path" >&2
    return 1
  fi

  kill -TERM "$launcher_pid"
  set +e
  wait "$launcher_pid"
  actual_status=$?
  set -e
  [[ "$actual_status" -eq 143 ]] || {
    printf 'Expected interrupted fallback status 143, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "$stopped_path" ]] || {
    printf 'Pinned-Node fallback did not forward TERM to its process group.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -z "$(find "${workspace}/tmp" -mindepth 1 -maxdepth 1 -type d -print -quit)" ]] || {
    printf 'Pinned-Node fallback left its temporary marker directory behind.\n' >&2
    return 1
  }

  # The interrupted process group must release the workspace lock as well.
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  RUN_LOG="$log_path" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1 || {
      printf 'Release runner remained locked after fallback interruption.\n' >&2
      cat "$output_path" >&2
      return 1
    }
  echo "PASS: interrupted pinned-Node fallback stops its child group and removes its marker directory"
}

test_release_runner_serializes_same_workspace_commands() {
  local workspace
  local active_dir
  local event_log
  local first_output
  local second_output
  local first_pid
  local second_pid
  local first_status
  local second_status
  local events
  local attempt
  local second_waited=false
  workspace=$(make_workspace serialized)
  active_dir="${workspace}/active"
  event_log="${workspace}/serialization-events"
  first_output="${workspace}/first-output"
  second_output="${workspace}/second-output"
  local release_gate="${workspace}/allow-first-release"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/serialized-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if ! mkdir "$SERIAL_ACTIVE_DIR" 2>/dev/null; then
  printf 'overlap:%s\n' "$SERIAL_RUN_ID" >>"$SERIAL_EVENT_LOG"
  exit 91
fi
trap 'rmdir "$SERIAL_ACTIVE_DIR" 2>/dev/null || true' EXIT
printf 'start:%s\n' "$SERIAL_RUN_ID" >>"$SERIAL_EVENT_LOG"
if [[ "$SERIAL_RUN_ID" == "first" ]]; then
  for ((attempt = 0; attempt < 1000; attempt += 1)); do
    [[ -e "$SERIAL_RELEASE_GATE" ]] && break
    sleep 0.01
  done
  [[ -e "$SERIAL_RELEASE_GATE" ]] || exit 92
fi
printf 'end:%s\n' "$SERIAL_RUN_ID" >>"$SERIAL_EVENT_LOG"
EOF
  chmod +x "${workspace}/bin/serialized-child"

  SERIAL_ACTIVE_DIR="$active_dir" SERIAL_EVENT_LOG="$event_log" \
    SERIAL_RELEASE_GATE="$release_gate" SERIAL_RUN_ID=first \
    RUN_LOG="${workspace}/runner-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" serialized-child \
    >"$first_output" 2>&1 &
  first_pid=$!

  for ((attempt = 0; attempt < 200; attempt += 1)); do
    [[ -d "$active_dir" ]] && break
    sleep 0.025
  done
  if [[ ! -d "$active_dir" ]]; then
    kill "$first_pid" 2>/dev/null || true
    wait "$first_pid" 2>/dev/null || true
    printf 'First release-runner command did not start.\n' >&2
    cat "$first_output" >&2
    return 1
  fi

  SERIAL_ACTIVE_DIR="$active_dir" SERIAL_EVENT_LOG="$event_log" \
    SERIAL_RELEASE_GATE="$release_gate" SERIAL_RUN_ID=second \
    RUN_LOG="${workspace}/runner-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" serialized-child \
    >"$second_output" 2>&1 &
  second_pid=$!

  for ((attempt = 0; attempt < 200; attempt += 1)); do
    if grep -q 'Release runner is waiting for the workspace validation lock' \
      "$second_output"; then
      second_waited=true
      break
    fi
    sleep 0.025
  done
  touch "$release_gate"

  set +e
  wait "$first_pid"
  first_status=$?
  wait "$second_pid"
  second_status=$?
  set -e
  if (( first_status != 0 || second_status != 0 )); then
    printf 'Concurrent release-runner children overlapped or failed (%s, %s).\n' \
      "$first_status" "$second_status" >&2
    cat "$first_output" "$second_output" >&2
    cat "$event_log" >&2
    return 1
  fi

  if [[ "$second_waited" != true ]]; then
    printf 'Second command did not report waiting for the workspace lock.\n' >&2
    cat "$second_output" >&2
    return 1
  fi
  assert_contains "$(cat "$second_output")" \
    "Release runner acquired the workspace validation lock after"

  events=$(cat "$event_log")
  if [[ "$events" == *overlap:* ]] ||
    [[ "$(grep -c '^start:' "$event_log")" -ne 2 ]] ||
    [[ "$(grep -c '^end:' "$event_log")" -ne 2 ]]; then
    printf 'Release-runner lock did not serialize both commands:\n%s\n' "$events" >&2
    return 1
  fi
  echo "PASS: concurrent release-runner commands in one workspace execute serially"
}

test_release_runner_lock_wait_times_out_with_owner_and_recovers() {
  local workspace
  local holder_started
  local holder_release
  local holder_pid_file
  local timeout_child_marker
  local holder_output
  local waiter_output
  local owner_pid
  local attempt
  local waiter_status
  local recovery_output
  workspace=$(make_workspace lock-timeout)
  holder_started="${workspace}/holder-started"
  holder_release="${workspace}/holder-release"
  holder_pid_file="${workspace}/holder-pid"
  timeout_child_marker="${workspace}/timeout-child-ran"
  holder_output="${workspace}/holder-output"
  waiter_output="${workspace}/waiter-output"
  recovery_output="${workspace}/recovery-output"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/lock-holder" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$$" >"$LOCK_HOLDER_PID_FILE"
touch "$LOCK_HOLDER_STARTED"
while [[ ! -e "$LOCK_HOLDER_RELEASE" ]]; do
  sleep 0.05
done
EOF
  cat >"${workspace}/bin/timeout-child" <<'EOF'
#!/usr/bin/env bash
touch "$TIMEOUT_CHILD_MARKER"
EOF
  chmod +x "${workspace}/bin/lock-holder" "${workspace}/bin/timeout-child"

  LOCK_HOLDER_STARTED="$holder_started" \
    LOCK_HOLDER_RELEASE="$holder_release" \
    LOCK_HOLDER_PID_FILE="$holder_pid_file" \
    RUN_LOG="${workspace}/holder-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" lock-holder \
    >"$holder_output" 2>&1 &
  local holder_pid=$!
  ACTIVE_RUNNER_PIDS+=("$holder_pid")

  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$holder_started" ]] && break
    sleep 0.025
  done
  if [[ ! -f "$holder_started" ]]; then
    printf 'Lock holder did not start.\n' >&2
    cat "$holder_output" >&2
    return 1
  fi
  owner_pid=$(cat "$holder_pid_file")

  set +e
  RELEASE_RUNNER_LOCK_WAIT_SECONDS=2 \
    TIMEOUT_CHILD_MARKER="$timeout_child_marker" \
    RUN_LOG="${workspace}/waiter-events" PATH="${workspace}/bin:${PATH}" \
    timeout 8s bash "${workspace}/scripts/src/run-release-node.sh" timeout-child \
    >"$waiter_output" 2>&1
  waiter_status=$?
  set -e

  if [[ "$waiter_status" -ne 75 ]]; then
    printf 'Expected bounded lock wait status 75, got %s. Output:\n' \
      "$waiter_status" >&2
    cat "$waiter_output" >&2
    return 1
  fi
  assert_contains "$(cat "$waiter_output")" "owner_pid=${owner_pid}"
  assert_contains "$(cat "$waiter_output")" "wait_limit=2s"
  assert_contains "$(cat "$waiter_output")" "owner_started_at="
  assert_contains "$(cat "$waiter_output")" "timed out after 2 seconds"
  assert_contains "$(cat "$waiter_output")" "Retry after the current validation command finishes"
  [[ ! -e "$timeout_child_marker" ]] || {
    printf 'Timed-out runner unexpectedly started its child command.\n' >&2
    return 1
  }
  kill -0 "$holder_pid" 2>/dev/null || {
    printf 'Timed-out waiter unexpectedly stopped the lock holder.\n' >&2
    return 1
  }

  set +e
  RELEASE_RUNNER_LOCK_WAIT_SECONDS=7201 \
    RUN_LOG="${workspace}/over-limit-events" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" timeout-child \
    >"${workspace}/over-limit-output" 2>&1
  waiter_status=$?
  set -e
  [[ "$waiter_status" -eq 2 ]] || {
    printf 'Expected over-limit lock wait configuration to fail with status 2, got %s.\n' \
      "$waiter_status" >&2
    cat "${workspace}/over-limit-output" >&2
    return 1
  }
  assert_contains "$(cat "${workspace}/over-limit-output")" \
    "Release runner lock wait must be between 1 and 7200 seconds"
  [[ ! -e "$timeout_child_marker" ]] || {
    printf 'Over-limit lock wait configuration unexpectedly started its child command.\n' >&2
    return 1
  }

  touch "$holder_release"
  wait "$holder_pid"
  ACTIVE_RUNNER_PIDS=()

  RUN_LOG="${workspace}/recovery-events" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$recovery_output" 2>&1 || {
      printf 'Release runner did not recover after the holder released the lock.\n' >&2
      cat "$recovery_output" >&2
      return 1
    }
  assert_contains "$(cat "${workspace}/recovery-events")" \
    "child-node=v${REQUIRED_NODE_VERSION}"
  echo "PASS: lock contention reports its owner, times out within the configured bound, skips the child, and recovers after release"
}

test_release_runner_nested_invocation_reuses_lock() {
  local workspace
  local log_path
  local output_path
  workspace=$(make_workspace nested-lock)
  log_path="${workspace}/events"
  output_path="${workspace}/output"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/release-child" <<EOF
#!/usr/bin/env bash
set -euo pipefail
timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" nested-child
EOF
  cat >"${workspace}/bin/nested-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'nested-child-ran\n' >>"$RUN_LOG"
EOF
  chmod +x "${workspace}/bin/release-child" "${workspace}/bin/nested-child"

  RUN_LOG="$log_path" PATH="${workspace}/bin:${PATH}" \
    timeout 10s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1 || {
      printf 'Nested release-runner invocation failed or deadlocked.\n' >&2
      cat "$output_path" >&2
      return 1
    }
  assert_contains "$(cat "$log_path")" "nested-child-ran"
  echo "PASS: nested release-runner commands reuse the workspace lock without deadlocking"
}

test_release_runner_preserves_child_status() {
  local workspace
  local status
  workspace=$(make_workspace child-status)
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"
  cat >"${workspace}/bin/failing-child" <<'EOF'
#!/usr/bin/env bash
exit 37
EOF
  chmod +x "${workspace}/bin/failing-child"

  set +e
  RUN_LOG="${workspace}/events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" failing-child \
    >"${workspace}/output" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 37 ]] || {
    printf 'Expected child status 37 to propagate through lock, got %s.\n' "$status" >&2
    cat "${workspace}/output" >&2
    return 1
  }
  echo "PASS: release-runner lock preserves the child command exit status"
}

test_matching_node_skips_npx
test_mismatching_node_uses_npx
test_wrong_fallback_node_version_fails_before_release_commands
test_npx_package_resolution_failure_fails_before_release_commands
test_missing_node_selector_fails_before_release_commands
test_empty_node_selector_fails_before_release_commands
test_missing_npx_fails_before_release_commands
test_release_runner_verifies_local_tls_certificates
test_isolated_browser_status_and_database_cleanup
test_isolated_browser_interrupt_cleans_database
test_isolated_sync_interrupt_cleans_database_and_children
test_isolated_sync_timeout_cleans_descendants_before_database
test_release_node_fallback_interrupt_stops_process_group
test_release_runner_serializes_same_workspace_commands
test_release_runner_lock_wait_times_out_with_owner_and_recovers
test_release_runner_nested_invocation_reuses_lock
test_release_runner_preserves_child_status
