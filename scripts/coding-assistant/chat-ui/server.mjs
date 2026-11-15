#!/usr/bin/env node
/**
 * Local coding assistant chat UI (local Ollama only — no cloud token limits).
 * Binds 127.0.0.1. Optional search. Sessions, tools with approval, gold-set helper.
 */
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  if (process.env.RUNCALC_REPO && existsSync(path.join(process.env.RUNCALC_REPO, "package.json"))) {
    return path.resolve(process.env.RUNCALC_REPO);
  }
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, "../../..");
}
let root = findRepoRoot(__dirname);

const AGENT_ROOT = process.env.CA_AGENT_ROOT || path.join(path.dirname(root), "agent");
const SESSIONS_DIR = path.join(AGENT_ROOT, "sessions");
const TASKS_DIR = path.join(AGENT_ROOT, "tasks");
const TASKS_DONE = path.join(TASKS_DIR, "done");
if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });
if (!existsSync(TASKS_DONE)) mkdirSync(TASKS_DONE, { recursive: true });

function secretsPath() {
  return path.join(AGENT_ROOT, "config", "secrets.json");
}
function readSecretsFile() {
  try {
    const p = secretsPath();
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch {}
  return {};
}
function writeSecretsFile(obj) {
  const p = secretsPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2), { encoding: "utf8", mode: 0o600 });
}

function skillsRoot() {
  const candidates = [
    process.env.CA_SKILLS_DIR,
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "opencode", "skills"),
    path.join(root, "scripts", "coding-assistant", "domain-skills"),
    path.join(root, "agent-skills"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
function listSkills() {
  const base = skillsRoot();
  if (!base) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ slug: d.name, name: d.name }));
  } catch { return []; }
}
function loadSkill(slug) {
  const base = skillsRoot();
  if (!base || !slug || /[\\/]/.test(slug) || slug.includes("..")) return null;
  const p = path.join(base, slug, "SKILL.md");
  if (!existsSync(p)) return null;
  return { slug, content: readFileSync(p, "utf8").slice(0, 120000) };
}

const prefsPath = path.join(AGENT_ROOT, "config", "prefs.json");
function readPrefs() {
  try { if (existsSync(prefsPath)) return JSON.parse(readFileSync(prefsPath, "utf8")); } catch {}
  return {};
}
function writePrefs(p) {
  const dir = path.dirname(prefsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(prefsPath, JSON.stringify(p, null, 2));
}

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const HOST = "127.0.0.1";
const PORT = Number(flag("--port", "7843")) || 7843;
const OLLAMA = flag("--ollama", "http://127.0.0.1:11434");
const MODEL = flag("--model", "qwen2.5-coder:7b");

const SYSTEM = `You are a local coding assistant (Ollama only — no cloud token limits).
Repo root: ${root}
Help with code, imports, gold sets, QC, sync, and multi-version work (v1/v2/v3).

Tools (request via structured JSON in your reply when needed):
- To propose a file edit, reply with a fenced block: \`\`\`tool
{"tool":"edit","path":"relative/path","old":"exact text","new":"replacement"}
\`\`\`
- To run a shell command: \`\`\`tool
{"tool":"shell","command":"safe command"}
\`\`\`
- For gold-set draft: \`\`\`tool
{"tool":"goldset","sheet":"schedule|dough|...","examples":[...]}
\`\`\`
The UI will show an approval card. Prefer local files and skills first.
Optional search is available when the user enables it (/search).
Be concise. Show concrete paths.`;

function safeResolve(rel) {
  const cleaned = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..") || cleaned.includes(".git")) return null;
  const abs = path.resolve(root, cleaned);
  if (!abs.startsWith(root)) return null;
  return abs;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
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

function sessionFile(id) { return path.join(SESSIONS_DIR, id + ".json"); }
function listSessions() {
  try {
    return readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const p = path.join(SESSIONS_DIR, f);
        try {
          const j = JSON.parse(readFileSync(p, "utf8"));
          return { id: j.id, title: j.title || j.id, updated: j.updated || 0, messages: (j.messages || []).length };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 40);
  } catch { return []; }
}
function loadSession(id) {
  const p = sessionFile(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}
function saveSession(sess) {
  sess.updated = Date.now();
  writeFileSync(sessionFile(sess.id), JSON.stringify(sess, null, 2));
}


function taskFile(id) { return path.join(TASKS_DIR, id + ".json"); }
function listTasks() {
  try {
    return readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const j = JSON.parse(readFileSync(path.join(TASKS_DIR, f), "utf8"));
          return { id: j.id, type: j.type || "task", title: j.title || j.id, priority: j.priority || 5, status: j.status || "open", created: j.created || 0 };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.priority - b.priority) || (b.created - a.created));
  } catch { return []; }
}
function loadTask(id) {
  const p = taskFile(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}
function saveTask(t) {
  t.updated = Date.now();
  writeFileSync(taskFile(t.id), JSON.stringify(t, null, 2));
}

const publicIndex = path.join(__dirname, "index.html");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    if (!existsSync(publicIndex)) return send(res, 500, { error: "index.html missing" });
    return send(res, 200, readFileSync(publicIndex, "utf8"), "text/html; charset=utf-8");
  }

  // static
  if (req.method === "GET") {
    const staticMap = {
      "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      "/sw.js": ["sw.js", "application/javascript; charset=utf-8"],
    };
    const hit = staticMap[url.pathname];
    if (hit) {
      const abs = path.join(__dirname, hit[0]);
      if (existsSync(abs)) {
        res.writeHead(200, { "Content-Type": hit[1] });
        res.end(readFileSync(abs));
        return;
      }
    }
    if (url.pathname.startsWith("/icons/")) {
      const abs = path.join(__dirname, url.pathname);
      if (existsSync(abs)) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(readFileSync(abs));
        return;
      }
    }
  }

  if (req.method === "GET" && url.pathname === "/api/skills") {
    return send(res, 200, { skills: listSkills(), root: skillsRoot() });
  }
  if (req.method === "GET" && url.pathname === "/api/skill") {
    const sk = loadSkill(url.searchParams.get("slug") || "");
    if (!sk) return send(res, 404, { error: "not found" });
    return send(res, 200, sk);
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    return send(res, 200, { sessions: listSessions() });
  }
  if (req.method === "POST" && url.pathname === "/api/sessions") {
    const body = JSON.parse(await readBody(req) || "{}");
    const id = body.id || randomUUID().slice(0, 8);
    const sess = loadSession(id) || { id, title: body.title || "New session", messages: [], repo: root };
    if (body.messages) sess.messages = body.messages;
    if (body.title) sess.title = body.title;
    saveSession(sess);
    return send(res, 200, sess);
  }
  if (req.method === "GET" && url.pathname === "/api/session") {
    const s = loadSession(url.searchParams.get("id") || "");
    if (!s) return send(res, 404, { error: "not found" });
    return send(res, 200, s);
  }

  if (req.method === "POST" && url.pathname === "/api/repo") {
    const body = JSON.parse(await readBody(req) || "{}");
    const next = body.path;
    if (next && existsSync(path.join(next, "package.json"))) {
      root = path.resolve(next);
      return send(res, 200, { ok: true, root });
    }
    return send(res, 400, { error: "invalid repo" });
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    const diag = {
      time: new Date().toISOString(),
      repo: root,
      model: readPrefs().lastModel || MODEL,
      ollama: OLLAMA,
      skills: listSkills().map((s) => s.slug),
      sessions: listSessions().length,
      searchAllowed: process.env.CA_ALLOW_SEARCH === "1",
    };
    return send(res, 200, diag);
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const allow = process.env.CA_ALLOW_SEARCH === "1" || url.searchParams.get("force") === "1";
    if (!allow) return send(res, 403, { error: "search disabled" });
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return send(res, 400, { error: "missing q" });
    try {
      const ddg = new URL("https://api.duckduckgo.com/");
      ddg.searchParams.set("q", q);
      ddg.searchParams.set("format", "json");
      ddg.searchParams.set("no_html", "1");
      const r = await fetch(ddg, { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      const results = [];
      if (j.AbstractText) results.push({ title: j.Heading || q, snippet: j.AbstractText, url: j.AbstractURL || "" });
      for (const t of (j.RelatedTopics || []).slice(0, 5)) {
        if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 80), snippet: t.Text, url: t.FirstURL });
      }
      return send(res, 200, { query: q, results, source: "duckduckgo" });
    } catch (e) {
      return send(res, 503, { error: "search unavailable", detail: String(e.message || e) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/tool/apply") {
    const body = JSON.parse(await readBody(req) || "{}");
    if (body.tool === "edit") {
      const abs = safeResolve(body.path);
      if (!abs || !existsSync(abs)) return send(res, 404, { error: "file not found" });
      let content = readFileSync(abs, "utf8");
      if (body.old && content.includes(body.old)) {
        content = content.replace(body.old, body.new || "");
        writeFileSync(abs, content);
        return send(res, 200, { ok: true, path: body.path });
      }
      return send(res, 400, { error: "old text not found" });
    }
    if (body.tool === "shell") {
      if (process.env.CA_ALLOW_SHELL !== "1") return send(res, 403, { error: "shell disabled" });
      const { spawn } = await import("node:child_process");
      const isWin = process.platform === "win32";
      const child = spawn(isWin ? "cmd.exe" : "bash", isWin ? ["/d", "/s", "/c", body.command] : ["-lc", body.command], { cwd: root, windowsHide: true });
      let out = "";
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { out += d.toString(); });
      const code = await new Promise((r) => child.on("close", r));
      return send(res, 200, { ok: code === 0, code, output: out.slice(0, 8000) });
    }
    return send(res, 400, { error: "unknown tool" });
  }

  
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    return send(res, 200, { tasks: listTasks() });
  }
  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const body = JSON.parse(await readBody(req) || "{}");
    const id = body.id || randomUUID().slice(0, 8);
    const task = {
      id,
      type: body.type || "task",
      title: body.title || body.type || "Task",
      priority: Number(body.priority) || 5,
      status: "open",
      payload: body.payload || {},
      skill: body.skill || null,
      created: Date.now(),
    };
    saveTask(task);
    return send(res, 200, task);
  }
  if (req.method === "GET" && url.pathname === "/api/task") {
    const t = loadTask(url.searchParams.get("id") || "");
    if (!t) return send(res, 404, { error: "not found" });
    return send(res, 200, t);
  }
  if (req.method === "POST" && url.pathname === "/api/task/done") {
    const body = JSON.parse(await readBody(req) || "{}");
    const t = loadTask(body.id);
    if (!t) return send(res, 404, { error: "not found" });
    t.status = "done";
    t.result = body.result || null;
    const donePath = path.join(TASKS_DONE, t.id + ".json");
    writeFileSync(donePath, JSON.stringify(t, null, 2));
    try { writeFileSync(taskFile(t.id), ""); } catch {}
    const fs = await import("node:fs");
    fs.unlinkSync(taskFile(t.id));
    return send(res, 200, { ok: true });
  }

if (req.method === "GET" && url.pathname === "/api/health") {
    let ollama = { ok: false };
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      ollama = { ok: r.ok, models: (j.models || []).map((m) => m.name).filter(Boolean) };
    } catch (e) { ollama = { ok: false, error: String(e.message || e) }; }
    return send(res, 200, { ok: true, repoRoot: root, model: readPrefs().lastModel || MODEL, ollama, mode: "local-ollama" });
  }

  if (req.method === "GET" && url.pathname === "/api/tree") {
    const rel = url.searchParams.get("path") || "";
    const abs = safeResolve(rel) || root;
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return send(res, 404, { error: "not a dir" });
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

  if (req.method === "GET" && url.pathname === "/api/file") {
    const abs = safeResolve(url.searchParams.get("path") || "");
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return send(res, 404, { error: "not found" });
    if (statSync(abs).size > 400000) return send(res, 413, { error: "too large" });
    return send(res, 200, { path: url.searchParams.get("path"), content: readFileSync(abs, "utf8") });
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const payload = JSON.parse(await readBody(req) || "{}");
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const model = payload.model || readPrefs().lastModel || MODEL;
    const stream = payload.stream === true;
    const contextFiles = Array.isArray(payload.contextFiles) ? payload.contextFiles : [];
    const skillSlugs = Array.isArray(payload.skills) ? payload.skills : [];
    let skillBlob = "";
    for (const slug of skillSlugs.slice(0, 3)) {
      const sk = loadSkill(String(slug));
      if (sk) skillBlob += `\n\n--- SKILL ${sk.slug} ---\n${sk.content}`;
    }
    let contextBlob = "";
    for (const rel of contextFiles.slice(0, 6)) {
      const abs = safeResolve(rel);
      if (abs && existsSync(abs) && statSync(abs).isFile() && statSync(abs).size < 120000) {
        contextBlob += `\n\n--- FILE ${rel} ---\n${readFileSync(abs, "utf8").slice(0, 80000)}`;
      }
    }
    let sys = SYSTEM + `\nCurrent repo: ${root}`;
    if (skillBlob) sys += `\n\nActive skills:${skillBlob}`;
    if (contextBlob) sys += `\n\nFile context:${contextBlob}`;

    const body = {
      model,
      messages: [{ role: "system", content: sys }, ...messages],
      temperature: 0.2,
      stream,
    };

    try {
      const r = await fetch(`${OLLAMA}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });
      if (!r.ok) {
        const t = await r.text();
        return send(res, 502, { error: "ollama", status: r.status, body: t.slice(0, 500) });
      }
      if (stream && r.body) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(dec.decode(value, { stream: true }));
        }
        res.end();
        return;
      }
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      return send(res, 200, { content, model });
    } catch (e) {
      return send(res, 502, { error: String(e.message || e) });
    }
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Code Agent (local Ollama) http://${HOST}:${PORT}/`);
  console.log(`Repo: ${root}`);
  console.log(`Sessions: ${SESSIONS_DIR}`);
});
