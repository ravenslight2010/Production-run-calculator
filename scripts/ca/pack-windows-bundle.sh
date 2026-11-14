#!/usr/bin/env bash
# Run from repo root on Linux/macOS/CI to produce CodeAgent-Windows-Setup.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/CodeAgent-Windows-Setup.zip}"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/ca/"{bin,ui/icons,cfg}
cp "$ROOT/scripts/coding-assistant/bootstrap-local.mjs" "$STAGE/ca/bin/boot.mjs"
cp "$ROOT/scripts/coding-assistant/render-opencode-config.mjs" "$STAGE/ca/bin/render.mjs"
cp "$ROOT/scripts/coding-assistant/check-readonly-profile.mjs" "$STAGE/ca/bin/check.mjs"
cp "$ROOT/scripts/coding-assistant/chat-ui/server.mjs" "$STAGE/ca/ui/server.mjs"
cp "$ROOT/scripts/coding-assistant/chat-ui/index.html" "$STAGE/ca/ui/index.html"
cp "$ROOT/scripts/coding-assistant/chat-ui/manifest.webmanifest" "$STAGE/ca/ui/manifest.webmanifest"
cp "$ROOT/scripts/coding-assistant/chat-ui/sw.js" "$STAGE/ca/ui/sw.js"
cp "$ROOT/scripts/coding-assistant/chat-ui/icons/"* "$STAGE/ca/ui/icons/"
cp "$ROOT/docs/coding-assistant/opencode-readonly.example.json" "$STAGE/ca/cfg/profile.example.json"
cp "$ROOT/docs/coding-assistant/fixtures/host-report-candidate-7b.json" "$STAGE/ca/cfg/fixture.json"
cp "$ROOT/scripts/ca/standalone-setup.ps1" "$STAGE/setup.ps1"
printf '%s\n' '@echo off' 'setlocal' 'set "HERE=%~dp0"' 'if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"' \
  'net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '"'"'%~f0'"'"' -Verb RunAs" & exit /b)' \
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%\setup.ps1" -BundleRoot "%HERE%"' 'pause' > "$STAGE/SETUP.cmd"
cp "$ROOT/scripts/ca/WINDOWS-LONG-PATHS.txt" "$STAGE/README.txt"
( cd "$STAGE" && zip -r "$OUT" . )
echo "Wrote $OUT"
