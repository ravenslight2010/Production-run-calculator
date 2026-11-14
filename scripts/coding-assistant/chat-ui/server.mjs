#!/usr/bin/env node
/**
 * Localhost-only coding-assistant chat UI (pilot).
 *
 * - Binds 127.0.0.1 only
 * - Talks to Ollama OpenAI-compatible API on 127.0.0.1:11434
 * - Optional read-only repo file access under repo root (no writes)
 * - Does not implement OpenCode tools; system prompt states read-only limits
 *
 *   node scripts/coding-assistant/chat-ui/server.mjs
 *   node scripts/coding-assistant/chat-ui/server.mjs --port 7843 --model qwen2.5-coder:7b
 */
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function findRepoRoot(start) {
  if (process.env.RUNCALC_REPO && existsSync(path.join(process.env.RUNCALC_REPO, "package.json"))) {
    return path.resolve(process.env.RUNCALC_REPO);
  }
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "scripts"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: legacy depth from scripts/coding-assistant/chat-ui
  return path.resolve(start, "../../..");
}
const root = findRepoRoot(__dirname);

function skillsRoot() {
  if (process.env.CA_SKILLS_DIR && existsSync(process.env.CA_SKILLS_DIR)) {
    return process.env.CA_SKILLS_DIR;
  }
  const candidates = [
    path.join(root, "agent-skills"),
    path.join(path.dirname(root), "agent-skills"),
    path.join(__dirname, "..", "..", "..", "agent-skills"),
    path.join(__dirname, "skills"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function listSkills() {
  const base = skillsRoot();
  if (!base) return [];
  const cat = path.join(base, "catalog.json");
  if (existsSync(cat)) {
    try {
      const j = JSON.parse(readFileSync(cat, "utf8"));
      return j.skills || [];
    } catch {}
  }
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ slug: d.name, name: d.name, path: `agent-skills/${d.name}/SKILL.md` }));
}

function loadSkill(slug) {
  const base = skillsRoot();
  if (!base || !slug || slug.includes("..") || slug.includes("/") || slug.includes("\\")) return null;
  const p = path.join(base, slug, "SKILL.md");
  if (!existsSync(p)) return null;
  const st = statSync(p);
  if (st.size > 250_000) return { slug, content: readFileSync(p, "utf8").slice(0, 200_000) + "\n\n[truncated]" };
  return { slug, content: readFileSync(p, "utf8") };
}

const prefsPath = path.join(root, "ca-prefs.json");
function readPrefs() {
  try {
    if (existsSync(prefsPath)) return JSON.parse(readFileSync(prefsPath, "utf8"));
  } catch {}
  return {};
}
function writePrefs(p) {
  try {
    writeFileSync(prefsPath, JSON.stringify(p, null, 2), "utf8");
  } catch (e) {
    console.warn("prefs write failed", e.message || e);
  }
}

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const HOST = "127.0.0.1";
const PORT = Number(flag("--port", "7843")) || 7843;
const OLLAMA = flag("--ollama", "http://127.0.0.1:11434");
const MODEL = flag("--model", "qwen2.5-coder:7b");

const SYSTEM = `You are a local coding assistant for the Production Run Calculator monorepo.
You help with code, tests, imports, sync, QC, and UI under the configured repository root.

Capabilities depend on environment flags:
- File reads of the repo tree are always available via context.
- When CA_ALLOW_WRITE=1, the operator can save files under the repo root via the UI.
- When CA_ALLOW_SHELL=1, the operator can run allowlisted shell commands in the repo root via the UI.

Hard limits (never violate):
- Do not access plant data volumes (e.g. paths containing /plant or \\plant\\).
- Do not read or write .env, credentials, private keys, or secret stores.
- Do not suggest exfiltrating secrets or disabling auth.
- Prefer existing workspace packages over new frameworks.
- Be concise and practical; show concrete file paths and patches.
`;

function safeResolve(rel) {
  const cleaned = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..") || cleaned.startsWith(".git/") || cleaned.includes("/.git/")) {
    return null;
  }
  const abs = path.resolve(root, cleaned);
  if (!abs.startsWith(root)) return null;
  return abs;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const publicIndex = path.join(__dirname, "index.html");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    if (!existsSync(publicIndex)) return send(res, 500, { error: "index.html missing" });
    return send(res, 200, readFileSync(publicIndex, "utf8"), "text/html; charset=utf-8");
  }

  // PWA / static assets (icons, manifest, service worker)
  if (req.method === "GET") {
    const staticMap = {
      "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      "/sw.js": ["sw.js", "application/javascript; charset=utf-8"],
      "/icons/icon-16.png": ["icons/icon-16.png", "image/png"],
      "/icons/icon-32.png": ["icons/icon-32.png", "image/png"],
      "/icons/icon-48.png": ["icons/icon-48.png", "image/png"],
      "/icons/icon-180.png": ["icons/icon-180.png", "image/png"],
      "/icons/icon-192.png": ["icons/icon-192.png", "image/png"],
      "/icons/icon-512.png": ["icons/icon-512.png", "image/png"],
      "/icons/coding-assistant.ico": ["icons/coding-assistant.ico", "image/x-icon"],
    };
    const hit = staticMap[url.pathname];
    if (hit) {
      const abs = path.join(__dirname, hit[0]);
      if (!existsSync(abs)) return send(res, 404, { error: "missing asset" });
      res.writeHead(200, {
        "Content-Type": hit[1],
        "Cache-Control": url.pathname === "/sw.js" ? "no-cache" : "public, max-age=86400",
      });
      res.end(readFileSync(abs));
      return;
    }
  }

  
  if (req.method === "GET" && url.pathname === "/api/skills") {
    return send(res, 200, { skills: listSkills(), root: skillsRoot() });
  }
  if (req.method === "GET" && url.pathname === "/api/skill") {
    const slug = url.searchParams.get("slug") || "";
    const sk = loadSkill(slug);
    if (!sk) return send(res, 404, { error: "skill not found" });
    return send(res, 200, sk);
  }

if (req.method === "GET" && url.pathname === "/api/health") {
    let ollama = { ok: false };
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      ollama = {
        ok: r.ok,
        models: (j.models || []).map((m) => m.name || m.model).filter(Boolean),
      };
    } catch (e) {
      ollama = { ok: false, error: String(e.message || e) };
    }
    return send(res, 200, {
      ok: true,
      bind: `${HOST}:${PORT}`,
      repoRoot: root,
      model: readPrefs().lastModel || MODEL,
      lastModel: readPrefs().lastModel || MODEL,
      ollama,
      mode: "read-only-chat-pilot",
    });
  }

  if (req.method === "GET" && url.pathname === "/api/file") {
    const rel = url.searchParams.get("path") || "";
    const abs = safeResolve(rel);
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
      return send(res, 404, { error: "file not found or blocked" });
    }
    const st = statSync(abs);
    if (st.size > 400_000) return send(res, 413, { error: "file too large" });
    const text = readFileSync(abs, "utf8");
    return send(res, 200, { path: rel, content: text });
  }

  if (req.method === "GET" && url.pathname === "/api/tree") {
    const rel = url.searchParams.get("path") || "";
    const abs = safeResolve(rel) || root;
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return send(res, 404, { error: "not a directory" });
    }
    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.name !== ".git" && d.name !== "node_modules")
      .slice(0, 200)
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : "file",
        path: path.relative(root, path.join(abs, d.name)).replace(/\\/g, "/"),
      }));
    return send(res, 200, { path: path.relative(root, abs).replace(/\\/g, "/") || ".", entries });
  }

  
  if (req.method === "GET" && url.pathname === "/api/prefs") {
    return send(res, 200, readPrefs());
  }
  if (req.method === "POST" && url.pathname === "/api/prefs") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    const cur = readPrefs();
    if (payload.lastModel) cur.lastModel = String(payload.lastModel);
    writePrefs(cur);
    return send(res, 200, cur);
  }


  if (req.method === "POST" && url.pathname === "/api/shell") {
    if (process.env.CA_ALLOW_SHELL !== "1") {
      return send(res, 403, { error: "shell disabled" });
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    const cmd = String(payload.command || "").trim();
    if (!cmd || cmd.length > 2000) return send(res, 400, { error: "invalid command" });
    const blocked = [
      /rm\s+-rf\s+[\/\\]/i,
      /format\s+/i,
      /shutdown/i,
      /mkfs/i,
      /:\s*\{\s*:/,
      /curl\s+.*\|.*(sh|bash)/i,
      /wget\s+.*\|.*(sh|bash)/i,
      /\\\\plant\\\\/i,
      /\/plant\//i,
      /\.env\b/i,
      /reg\s+delete/i,
      /Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\/i,
    ];
    if (blocked.some((re) => re.test(cmd))) {
      return send(res, 403, { error: "command blocked by policy" });
    }
    const { spawn } = await import("node:child_process");
    const cwd = root;
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "cmd.exe" : "bash", isWin ? ["/d", "/s", "/c", cmd] : ["-lc", cmd], {
      cwd,
      env: { ...process.env, CA_ALLOW_SHELL: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const max = 200_000;
    child.stdout.on("data", (d) => {
      if (stdout.length < max) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < max) stderr += d.toString("utf8");
    });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve(-1);
      }, 60_000);
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve(c ?? 0);
      });
    });
    return send(res, 200, {
      ok: code === 0,
      code,
      stdout: stdout.slice(0, max),
      stderr: stderr.slice(0, max),
      cwd,
    });
  }

if (req.method === "POST" && url.pathname === "/api/chat") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const model = payload.model || readPrefs().lastModel || MODEL;
    if (payload.model) {
      const cur = readPrefs();
      cur.lastModel = String(payload.model);
      writePrefs(cur);
    }
    const contextFiles = Array.isArray(payload.contextFiles) ? payload.contextFiles : [];
    const skillSlugs = Array.isArray(payload.skills) ? payload.skills : [];
    let skillBlob = "";
    for (const slug of skillSlugs.slice(0, 3)) {
      const sk = loadSkill(String(slug));
      if (sk) skillBlob += `\n\n--- SKILL ${sk.slug} ---\n${sk.content.slice(0, 120000)}`;
    }

    let contextBlob = "";
    for (const rel of contextFiles.slice(0, 6)) {
      const abs = safeResolve(rel);
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) continue;
      if (statSync(abs).size > 120_000) continue;
      contextBlob += `\n\n--- FILE ${rel} ---\n${readFileSync(abs, "utf8").slice(0, 100_000)}`;
    }
    let sys = SYSTEM;
    if (skillBlob) sys += `\n\nActive skills (follow when relevant):${skillBlob}`;
    if (contextBlob) sys += `\n\nFile context:${contextBlob}`;

    try {
      const r = await fetch(`${OLLAMA}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: sys }, ...messages],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const text = await r.text();
      if (!r.ok) return send(res, 502, { error: "ollama error", status: r.status, body: text.slice(0, 800) });
      const data = JSON.parse(text);
      const content = data.choices?.[0]?.message?.content ?? "";
      return send(res, 200, { content, model, raw: data });
    } catch (e) {
      return send(res, 502, { error: String(e.message || e) });
    }
  }

  send(res, 404, { error: "not found" });
});

async function warmup() {
  try {
    const tags = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!tags.ok) console.warn("Ollama tags HTTP", tags.status);
    else console.log("Ollama reachable");
  } catch (e) {
    console.warn("Ollama not reachable yet:", e.message || e);
    console.warn("Start Ollama from the Start Menu, then refresh the browser.");
  }
}

server.on("error", (err) => {
  console.error("Server failed to bind:", err.message || err);
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is in use. Close the other CodeAgent/node process or use --port.`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Coding-assistant chat UI (read-only pilot)`);
  console.log(`  http://${HOST}:${PORT}/`);
  console.log(`  Ollama ${OLLAMA}  model=${MODEL}`);
  console.log(`  Repo   ${root}`);
  console.log(`  Bind is loopback-only. Ctrl+C to stop.`);
  warmup();
});
