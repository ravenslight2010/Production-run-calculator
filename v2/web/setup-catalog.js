import { renderImportCsvTemplate } from "../core/import-csv-templates.mjs";
import { parseSetupCatalogCsv, setupCatalogCsvTemplates } from "../core/setup-catalog-csv.mjs";

const API = "/api/v2/setup-catalog/imports";
const PENDING_KEY = "fieldline:v2:setup-catalog-pending";
const dom = Object.fromEntries([
  "setup-catalog-panel", "setup-catalog-family", "setup-catalog-form", "setup-catalog-file",
  "setup-catalog-template-columns", "setup-catalog-template-download", "setup-catalog-review", "setup-catalog-preview",
  "setup-catalog-actions", "setup-catalog-apply", "setup-catalog-retry", "setup-catalog-history",
  "setup-catalog-status",
].map((id) => [id, document.getElementById(id)]));

let staff = null;
let canWrite = false;
let imports = [];
let reviewed = null;
let pending = readPending();
let inFlight = false;
let validating = false;
let historyLoading = false;
let lastHistoryLoadAt = 0;

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function uuid(value) { return typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value); }
function text(value, max = 200) { return typeof value === "string" && value.length <= max; }

function readPending() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (object(value) && uuid(value.actorId) && text(value.requestId, 200)
      && text(value.family, 40) && typeof value.csv === "string") return value;
  } catch {}
  localStorage.removeItem(PENDING_KEY);
  return null;
}

function csrfHeaders() {
  const matches = document.cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith("v2_csrf="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(8);
  return /^[A-Za-z0-9_-]{43}$/u.test(token) ? { "X-CSRF-Token": token } : null;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.method && options.method !== "GET" ? csrfHeaders() || {} : {}),
      ...options.headers,
    },
  });
  let body;
  try { body = await response.json(); } catch { throw new Error("The server returned an unreadable response."); }
  if (!response.ok) {
    const fallback = response.status === 401 ? "Your session expired. Sign in again."
      : response.status === 403 ? "Manager access and a fresh secure session are required."
        : response.status === 409 ? "The setup changed. Refresh the history and review it again."
          : "The server did not accept this setup import.";
    throw new Error(typeof body?.error === "string" ? body.error : fallback);
  }
  if (!object(body)) throw new Error("The server returned an unexpected response.");
  return body;
}

function announce(message) {
  const live = document.getElementById("live-announcer");
  if (live) {
    live.textContent = "";
    window.setTimeout(() => { live.textContent = message; }, 20);
  }
}

function setStatus(message, error = false) {
  dom["setup-catalog-status"].textContent = message;
  dom["setup-catalog-status"].dataset.kind = error ? "error" : "info";
  announce(message);
}

function button(label, handler, disabled = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "button button-secondary button-small";
  element.textContent = label;
  element.disabled = disabled || !canWrite || inFlight;
  element.addEventListener("click", handler);
  return element;
}

function renderTemplate() {
  const family = dom["setup-catalog-family"].value;
  const template = setupCatalogCsvTemplates[family];
  dom["setup-catalog-template-columns"].textContent = template.headers.join(", ");
  const csv = renderImportCsvTemplate(template);
  const link = dom["setup-catalog-template-download"];
  if (link.dataset.url) URL.revokeObjectURL(link.dataset.url);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.dataset.url = url;
  link.href = url;
  link.download = template.fileName;
}

function briefRecord(record) {
  const summary = document.createElement("li");
  summary.textContent = `${record.code} · ${record.name}`;
  return summary;
}

function renderReview(item, label) {
  reviewed = item;
  dom["setup-catalog-preview"].replaceChildren();
  dom["setup-catalog-preview"].hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = `${label} · ${item.rowCount ?? item.records?.length ?? 0} rows`;
  const list = document.createElement("ul");
  list.className = "manager-list";
  for (const record of (item.records || []).slice(0, 12)) list.append(briefRecord(record));
  if ((item.records || []).length > 12) {
    const more = document.createElement("li");
    more.textContent = `${item.records.length - 12} more rows`;
    list.append(more);
  }
  dom["setup-catalog-preview"].append(heading, list);
  const unresolved = (item.records || []).reduce((count, record) => {
    const data = record?.data;
    if (!object(data)) return count;
    const components = Array.isArray(data.components) ? data.components : [];
    const templateRows = item.family === "run-templates" && object(data.values)
      ? Object.entries(data.values).flatMap(([key, value]) => key.endsWith("Recipe") && Array.isArray(value) ? value : [])
      : [];
    return count + components.filter((entry) => object(entry) && !entry.ingredientCode).length
      + (data.ingredientName && !data.ingredientCode ? 1 : 0)
      + templateRows.length;
  }, 0);
  if (unresolved) {
    const note = document.createElement("p");
    note.className = "manager-help";
    note.textContent = `${unresolved} ingredient reference(s) remain unlinked. Names are preserved; no identity was guessed.`;
    dom["setup-catalog-preview"].append(note);
  }
  if ((item.records || []).some((record) => record.data?.key === "run-calc-flavors")) {
    const note = document.createElement("p");
    note.className = "manager-help";
    note.textContent = "These flavors remain unscoped. V2 will not assign them to a brand.";
    dom["setup-catalog-preview"].append(note);
  }
  if (item.family === "run-templates" && unresolved) {
    const note = document.createElement("p");
    note.className = "manager-help";
    note.textContent = "Template ingredient names and source IDs are preserved as text; they are not V2 ingredient links.";
    dom["setup-catalog-preview"].append(note);
  }
  const values = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "View the validated field values";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify((item.records || []).slice(0, 12), null, 2);
  values.append(summary, pre);
  dom["setup-catalog-preview"].append(values);
  dom["setup-catalog-actions"].hidden = true;
  dom["setup-catalog-apply"].hidden = true;
  if (item.status === "staged") {
    dom["setup-catalog-actions"].hidden = false;
    dom["setup-catalog-apply"].hidden = false;
    dom["setup-catalog-apply"].disabled = !canWrite || inFlight;
    dom["setup-catalog-apply"].textContent = "Apply reviewed setup";
  }
}

function validateSummary(item) {
  return object(item) && uuid(item.id) && text(item.family, 40)
    && ["staged", "applied", "undone"].includes(item.status)
    && Number.isSafeInteger(item.rowCount) && item.rowCount >= 1 && item.rowCount <= 2000
    && text(item.createdAt, 60);
}

async function loadImports(force = false) {
  if (historyLoading) return;
  if (!force && Date.now() - lastHistoryLoadAt < 5000) return;
  historyLoading = true;
  try {
    const body = await request(API);
    if (!Array.isArray(body.imports) || !body.imports.every(validateSummary)) {
      throw new Error("The setup import history is incomplete. Refresh to try again.");
    }
    imports = body.imports;
    lastHistoryLoadAt = Date.now();
    renderHistory();
  } finally {
    historyLoading = false;
  }
}

function renderHistory() {
  const list = dom["setup-catalog-history"];
  list.replaceChildren();
  if (!imports.length) {
    const empty = document.createElement("li");
    empty.className = "manager-list-notice";
    empty.textContent = "No additional setup imports recorded yet.";
    list.append(empty);
    return;
  }
  for (const item of imports) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${item.family} · ${item.status} · ${item.rowCount} rows`;
    row.append(label);
    if (item.status === "staged" || item.status === "applied" || item.status === "undone") {
      row.append(button("Review", () => { void reopen(item); }));
    }
    if (item.status === "applied") {
      row.append(button("Undo", () => { void act(item, "undo"); }));
    }
    list.append(row);
  }
}

async function reopen(item) {
  try {
    const detail = await request(`${API}/${encodeURIComponent(item.id)}`);
    if (detail.id !== item.id || !Array.isArray(detail.records) || detail.records.length !== item.rowCount) {
      throw new Error("The staged setup details did not match their history.");
    }
    const label = detail.status === "staged" ? "Staged setup · review before applying"
      : detail.status === "applied" ? "Applied setup · imported values"
        : "Undone setup · prior import values";
    renderReview(detail, label);
    dom["setup-catalog-apply"].dataset.importId = item.id;
    setStatus("Review the preserved values before applying.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Setup review could not be loaded.", true);
  }
}

async function stage() {
  if (!canWrite || inFlight || validating) return;
  if (pending && pending.actorId !== staff?.userId) {
    setStatus("A pending setup import belongs to another manager on this device. Sign in as that manager to retry it.", true);
    return;
  }
  const file = dom["setup-catalog-file"].files?.[0];
  if (!file) {
    setStatus("Choose a CSV file.", true);
    return;
  }
  if (file.size > 1024 * 1024) {
    setStatus("CSV files must be 1 MiB or smaller.", true);
    return;
  }
  const family = dom["setup-catalog-family"].value;
  validating = true;
  updateControls();
  let csv;
  try {
    csv = await file.text();
    const records = parseSetupCatalogCsv(family, csv);
    pending = { actorId: staff.userId, requestId: crypto.randomUUID(), family, csv };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    await submitPending(records);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The setup file could not be validated.", true);
  } finally {
    validating = false;
    updateControls();
  }
}

async function submitPending(records = null) {
  if (!canWrite || !pending || pending.actorId !== staff?.userId || inFlight) {
    setStatus("Retry is available only to the manager who started this import.", true);
    return;
  }
  inFlight = true;
  dom["setup-catalog-retry"].disabled = true;
  dom["setup-catalog-review"].disabled = true;
  try {
    const validated = records || parseSetupCatalogCsv(pending.family, pending.csv);
    const response = await request(API, {
      method: "POST",
      body: JSON.stringify({
        requestId: pending.requestId, family: pending.family, csv: pending.csv,
      }),
    });
    if (!uuid(response.importId) || !Array.isArray(response.records)
      || response.records.length !== validated.length) {
      throw new Error("The server could not confirm this setup import.");
    }
    localStorage.removeItem(PENDING_KEY);
    pending = null;
    renderReview({ ...response, status: "staged", rowCount: response.records.length },
      "Validated setup · review before applying");
    dom["setup-catalog-apply"].dataset.importId = response.importId;
    dom["setup-catalog-file"].value = "";
    setStatus(`${response.rowCount} setup rows are staged. Apply only after reviewing the values.`);
    await loadImports(true);
  } catch (error) {
    dom["setup-catalog-retry"].hidden = false;
    setStatus(error instanceof Error ? error.message : "The result is not confirmed. Retry the same import.", true);
  } finally {
    inFlight = false;
    updateControls();
  }
}

async function act(item, action) {
  if (!canWrite || inFlight) return;
  if (action === "undo" && !window.confirm("Undo this setup import? Later changes may block the undo.")) return;
  inFlight = true;
  updateControls();
  try {
    const result = await request(`${API}/${encodeURIComponent(item.id)}/${action}`, {
      method: "POST",
      body: "{}",
    });
    if (result.importId !== item.id || result.outcome !== (action === "apply" ? "applied" : "undone")) {
      throw new Error("The server could not confirm this setup action.");
    }
    setStatus(action === "apply" ? "Setup import applied." : "Setup import undone.");
    reviewed = null;
    dom["setup-catalog-preview"].hidden = true;
    dom["setup-catalog-actions"].hidden = true;
    await loadImports(true);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The setup action was not confirmed. Refresh history before retrying.", true);
  } finally {
    inFlight = false;
    updateControls();
  }
}

function updateControls() {
  const retryOwned = pending && pending.actorId === staff?.userId;
  dom["setup-catalog-retry"].hidden = !retryOwned;
  dom["setup-catalog-retry"].disabled = !canWrite || inFlight;
  dom["setup-catalog-review"].disabled = !canWrite || inFlight || validating;
  dom["setup-catalog-family"].disabled = !canWrite || inFlight || validating;
  dom["setup-catalog-file"].disabled = !canWrite || inFlight || validating;
  dom["setup-catalog-template-download"].setAttribute("aria-disabled", String(!canWrite));
  dom["setup-catalog-apply"].disabled = !canWrite || inFlight;
  dom["setup-catalog-history"].querySelectorAll("button").forEach((control) => {
    control.disabled = !canWrite || inFlight;
  });
}

dom["setup-catalog-family"].addEventListener("change", () => {
  dom["setup-catalog-preview"].hidden = true;
  dom["setup-catalog-actions"].hidden = true;
  dom["setup-catalog-file"].value = "";
  renderTemplate();
});
dom["setup-catalog-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  void stage();
});
dom["setup-catalog-retry"].addEventListener("click", () => { void submitPending(); });
dom["setup-catalog-apply"].addEventListener("click", () => {
  const item = imports.find((entry) => entry.id === dom["setup-catalog-apply"].dataset.importId)
    || reviewed;
  if (item) void act(item, "apply");
});
renderTemplate();

export function updateSetupCatalogContext(nextStaff, writable) {
  staff = nextStaff;
  canWrite = writable === true && staff?.capabilities?.includes("manage-inventory") === true;
  dom["setup-catalog-panel"].hidden = !staff?.capabilities?.includes("manage-inventory");
  if (!staff) {
    imports = [];
    reviewed = null;
    dom["setup-catalog-history"].replaceChildren();
    dom["setup-catalog-preview"].hidden = true;
    return;
  }
  updateControls();
  if (canWrite) {
    void loadImports().catch((error) => setStatus(error.message || "Setup history could not be loaded.", true));
  }
}
