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
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const HOST = "127.0.0.1";
const PORT = Number(flag("--port", "7843")) || 7843;
const OLLAMA = flag("--ollama", "http://127.0.0.1:11434");
const MODEL = flag("--model", "qwen2.5-coder:7b");

const SYSTEM = `You are a local coding assistant for the Production Run Calculator repository.
You run entirely on the operator's machine via Ollama. You have no cloud providers.

Hard limits:
- You cannot edit files, run shell commands, or access the network beyond this chat.
- Treat any request to modify production plant data, secrets, or .env as refused.
- Prefer answers grounded in repository paths the user names or that appear in read-only context.
- If unsure, say so. Do not invent APIs or file contents.

This chat UI is a pilot companion to the read-only OpenCode profile; it is not the floor production AI.`;

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

  if (req.method === "GET" && url.pathname === "/api/health") {
    let ollama = { ok: false };
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
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
      model: MODEL,
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

  if (req.method === "POST" && url.pathname === "/api/chat") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const model = payload.model || MODEL;
    const contextFiles = Array.isArray(payload.contextFiles) ? payload.contextFiles : [];
    let contextBlob = "";
    for (const rel of contextFiles.slice(0, 6)) {
      const abs = safeResolve(rel);
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) continue;
      if (statSync(abs).size > 120_000) continue;
      contextBlob += `\n\n--- FILE ${rel} ---\n${readFileSync(abs, "utf8").slice(0, 100_000)}`;
    }
    const sys = contextBlob ? `${SYSTEM}\n\nRead-only context:${contextBlob}` : SYSTEM;
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

server.listen(PORT, HOST, () => {
  console.log(`Coding-assistant chat UI (read-only pilot)`);
  console.log(`  http://${HOST}:${PORT}/`);
  console.log(`  Ollama ${OLLAMA}  model=${MODEL}`);
  console.log(`  Repo   ${root}`);
  console.log(`  Bind is loopback-only. Ctrl+C to stop.`);
});
