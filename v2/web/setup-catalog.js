import { renderImportCsvTemplate } from "../core/import-csv-templates.mjs";
import { parseSetupCatalogCsv, setupCatalogCsvTemplates } from "../core/setup-catalog-csv.mjs";

const API = "/api/v2/setup-catalog/imports";
const PENDING_KEY = "fieldline:v2:setup-catalog-pending";
const dom = Object.fromEntries([
  "setup-catalog-panel", "setup-catalog-family", "setup-catalog-form", "setup-catalog-file",
  "setup-catalog-template-columns", "setup-catalog-template-download", "setup-catalog-review", "setup-catalog-preview",
  "setup-catalog-actions", "setup-catalog-apply", "setup-catalog-retry", "setup-catalog-history",
  "setup-catalog-status", "source-workbook-form", "source-workbook-family", "source-workbook-file",
  "source-workbook-preview-button", "source-workbook-preview", "source-workbook-actions", "source-workbook-stage",
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
let sourceReview = null;

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function uuid(value) { return typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value); }
function text(value, max = 200) { return typeof value === "string" && value.length <= max; }

function validSourceSummary(value) {
  return object(value)
    && ["spec-sheets", "premix-sheets", "cheese-mix-specs", "shipping-guides", "sauce-guides", "dough-guides"]
      .includes(value.sourceFamily)
    && typeof value.sourceSha256 === "string" && /^[0-9a-f]{64}$/u.test(value.sourceSha256)
    && value.parserVersion === "v1-source-import/1"
    && ["sourceRows", "importedRows", "skippedRows", "unresolvedRows"]
      .every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 2000);
}

function csvField(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function recordsToCsv(family, records) {
  const headers = setupCatalogCsvTemplates[family]?.headers;
  if (!headers) throw new Error("The source rows do not have a supported V2 target.");
  const rows = records.map(({ code, name, data }) => {
    if (family === "mixes") {
      return [
        code, name, data.brand ?? "", data.flavor ?? "", data.batchSizeLbs ?? "",
        data.daysEarly ?? "", data.notes ?? "", data.isPrep == null ? "" : String(data.isPrep),
        data.enabled == null ? "" : String(data.enabled), JSON.stringify(data.components ?? []),
      ];
    }
    if (family === "run-templates") {
      return [code, name, data.brand ?? "", data.flavor ?? "", JSON.stringify(data.values ?? {})];
    }
    throw new Error("The source rows do not have a supported V2 target.");
  });
  return [headers, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

function readPending() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (object(value) && uuid(value.actorId) && text(value.requestId, 200)
      && text(value.family, 40) && typeof value.csv === "string"
      && (value.sourceSummary == null || validSourceSummary(value.sourceSummary))) return value;
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

function validateSourcePreview(value) {
  return object(value)
    && ["spec-sheets", "premix-sheets", "cheese-mix-specs", "shipping-guides", "sauce-guides", "dough-guides"]
      .includes(value.family)
    && value.targetFamily === (value.family === "premix-sheets" ? "mixes" : "run-templates")
    && value.parserVersion === "v1-source-import/1"
    && typeof value.fileSha256 === "string" && /^[0-9a-f]{64}$/u.test(value.fileSha256)
    && Number.isSafeInteger(value.sourceRows) && value.sourceRows >= 0 && value.sourceRows <= 2000
    && Number.isSafeInteger(value.proposedRows) && value.proposedRows >= 0 && value.proposedRows <= 2000
    && Number.isSafeInteger(value.skippedRows) && value.skippedRows >= 0 && value.skippedRows <= 2000
    && Array.isArray(value.records) && value.records.length === value.proposedRows
    && value.records.every((item) => object(item) && text(item.source, 240)
      && item.targetFamily === value.targetFamily && object(item.record)
      && text(item.record.code, 80) && text(item.record.name, 200) && object(item.record.data)
      && (item.sourceDetails == null || (object(item.sourceDetails) && JSON.stringify(item.sourceDetails).length <= 20_000)))
    && Array.isArray(value.unresolvedRows) && value.unresolvedRows.length <= 2000
    && value.unresolvedRows.every((item) => object(item) && text(item.source, 240) && text(item.reason, 300));
}

function sourceFamilyLabel(family) {
  return ({
    "spec-sheets": "Spec sheet",
    "premix-sheets": "Premix sheet",
    "cheese-mix-specs": "Cheese mix spec",
    "shipping-guides": "Shipping guide",
    "sauce-guides": "Sauce guide",
    "dough-guides": "Dough guide",
  })[family] || "Source workbook";
}

function updateSourceStageButton() {
  if (!sourceReview) {
    dom["source-workbook-stage"].disabled = true;
    return;
  }
  const included = sourceReview.candidates.filter((row) => row.include);
  const allCandidatesReviewed = included.every((row) => row.reviewed);
  const allJsonValid = included.every((row) => !row.jsonError);
  const allUnresolvedAcknowledged = sourceReview.unresolved.every((row) =>
    row.resolved || row.acknowledged || row.skipped);
  const allCheeseMapped = sourceReview.sourceFamily !== "cheese-mix-specs" || included.every((row) => {
    const values = row.record.data?.values;
    return object(values) && [1, 2, 3, 4].some((slot) =>
      Array.isArray(values[`app${slot}CheeseRecipe`])
      && typeof values[`app${slot}CheeseRecipeName`] === "string"
      && values[`app${slot}CheeseRecipeName`].trim());
  });
  dom["source-workbook-stage"].disabled = !canWrite || inFlight || validating
    || included.length === 0 || !allCandidatesReviewed || !allJsonValid || !allUnresolvedAcknowledged || !allCheeseMapped;
}

function addSourceTextField(container, title, value, onChange, { multiline = false } = {}) {
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.textContent = title;
  const input = multiline ? document.createElement("textarea") : document.createElement("input");
  if (!multiline) input.type = "text";
  input.maxLength = multiline ? 20_000 : title === "V2 code" ? 80 : 200;
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  label.append(caption, input);
  container.append(label);
}

function addSourceCheck(container, title, checked, onChange) {
  const label = document.createElement("label");
  label.className = "source-review-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const caption = document.createElement("span");
  caption.textContent = title;
  input.addEventListener("change", () => {
    onChange(input.checked);
    updateSourceStageButton();
  });
  label.append(input, caption);
  container.append(label);
}

function renderSourceReview() {
  const container = dom["source-workbook-preview"];
  container.replaceChildren();
  container.hidden = !sourceReview;
  dom["source-workbook-actions"].hidden = !sourceReview;
  if (!sourceReview) return;

  const heading = document.createElement("strong");
  heading.textContent = `${sourceFamilyLabel(sourceReview.sourceFamily)} · ${sourceReview.sourceRows} source rows · ${sourceReview.candidates.length} proposed V2 records · ${sourceReview.skippedRows} skipped · ${sourceReview.unresolved.length} unresolved`;
  container.append(heading);
  const explanation = document.createElement("p");
  explanation.className = "manager-help";
  explanation.textContent = sourceReview.targetFamily === "mixes"
    ? "Premix rows retain per-pizza ounces and per-batch pounds. Empty values stay unknown; choose explicit values before staging."
    : "These values are V2 review templates, not live run configuration. Check each row and correct its field mapping before staging.";
  container.append(explanation);

  const candidateHeading = document.createElement("h5");
  candidateHeading.textContent = "Proposed records";
  container.append(candidateHeading);
  const candidateList = document.createElement("div");
  candidateList.className = "source-review-list";
  for (const [index, item] of sourceReview.candidates.entries()) {
    const details = document.createElement("details");
    details.className = "source-review-row";
    const summary = document.createElement("summary");
    summary.textContent = `${item.record.name} · ${item.source}`;
    details.append(summary);
    addSourceCheck(details, "Include this V2 record", item.include, (checked) => {
      item.include = checked;
      updateSourceStageButton();
    });
    addSourceTextField(details, "V2 code", item.record.code, (value) => { item.record.code = value; });
    addSourceTextField(details, "V2 record name", item.record.name, (value) => { item.record.name = value; });
    addSourceTextField(details, "Mapped V2 values (JSON)", JSON.stringify(item.record.data, null, 2), (value) => {
      try {
        const parsed = JSON.parse(value);
        if (object(parsed)) {
          item.record.data = parsed;
          item.jsonError = false;
        } else item.jsonError = true;
      } catch { item.jsonError = true; }
      details.dataset.invalidJson = String(item.jsonError);
      updateSourceStageButton();
    }, { multiline: true });
    if (item.sourceDetails) {
      const evidence = document.createElement("details");
      const evidenceSummary = document.createElement("summary");
      evidenceSummary.textContent = "View parsed source evidence";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(item.sourceDetails, null, 2);
      evidence.append(evidenceSummary, pre);
      details.append(evidence);
    }
    const sourceNotes = sourceReview.unresolved.filter((entry) => entry.source === item.source);
    if (sourceNotes.length) {
      const note = document.createElement("p");
      note.className = "manager-help";
      note.textContent = sourceNotes.map((entry) => entry.reason).join(" ");
      details.append(note);
      addSourceCheck(details, "I reviewed and confirmed this V2 mapping", item.reviewed, (checked) => {
        item.reviewed = checked;
      });
    } else {
      addSourceCheck(details, "I reviewed and confirmed this mapping", item.reviewed, (checked) => {
        item.reviewed = checked;
      });
    }
    details.dataset.row = String(index + 1);
    candidateList.append(details);
  }
  if (sourceReview.candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "manager-empty";
    empty.textContent = "No rows have a safe V2 mapping. Review the unresolved rows below; nothing can be applied from this file yet.";
    candidateList.append(empty);
  }
  container.append(candidateList);

  if (sourceReview.unresolved.length) {
    const unresolvedHeading = document.createElement("h5");
    unresolvedHeading.textContent = "Unresolved source rows";
    container.append(unresolvedHeading);
    const unresolvedList = document.createElement("ul");
    unresolvedList.className = "manager-list";
    for (const item of sourceReview.unresolved) {
      const row = document.createElement("li");
      const note = document.createElement("span");
      note.textContent = `${item.source} · ${item.reason}`;
      row.append(note);
      const candidateExists = sourceReview.candidates.some((candidate) => candidate.source === item.source);
      const control = document.createElement("div");
      if (candidateExists) {
        addSourceCheck(control, "I corrected this mapping", item.resolved, (checked) => {
          item.resolved = checked;
          if (checked) item.acknowledged = false;
          updateSourceStageButton();
        });
        addSourceCheck(control, "Acknowledge as review-only", item.acknowledged, (checked) => {
          item.acknowledged = checked;
          if (checked) item.resolved = false;
          updateSourceStageButton();
        });
      } else {
        addSourceCheck(control, "Acknowledge as review-only", item.acknowledged, (checked) => {
          item.acknowledged = checked;
          if (checked) item.skipped = false;
          updateSourceStageButton();
        });
        addSourceCheck(control, "Mark this row skipped", item.skipped, (checked) => {
          item.skipped = checked;
          if (checked) item.acknowledged = false;
          updateSourceStageButton();
        });
      }
      row.append(control);
      unresolvedList.append(row);
    }
    container.append(unresolvedList);
  }
  const stageNote = document.createElement("p");
  stageNote.className = "manager-help";
  stageNote.textContent = "Only included, reviewed records are staged. Unresolved rows remain in the import history as review-only; they are never inferred or applied.";
  container.append(stageNote);
  updateSourceStageButton();
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

async function previewSourceWorkbook(event) {
  event.preventDefault();
  if (!canWrite || inFlight || validating) return;
  const file = dom["source-workbook-file"].files?.[0];
  if (!file) {
    setStatus("Choose a supported source workbook or sauce guide document.", true);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setStatus("Source workbooks must be 5 MiB or smaller.", true);
    return;
  }
  validating = true;
  updateControls();
  try {
    const body = await request(`${API}/workbooks/preview`, {
      method: "POST",
      body: JSON.stringify({
        family: dom["source-workbook-family"].value,
        fileName: file.name,
        workbookBase64: await fileToBase64(file),
      }),
    });
    if (!validateSourcePreview(body)) throw new Error("The source preview did not match the expected review format.");
    sourceReview = {
      sourceFamily: body.family,
      targetFamily: body.targetFamily,
      parserVersion: body.parserVersion,
      sourceSha256: body.fileSha256,
      sourceRows: body.sourceRows,
      skippedRows: body.skippedRows,
      candidates: body.records.map((entry) => ({
        source: entry.source,
        record: entry.record,
        sourceDetails: entry.sourceDetails ?? null,
        include: true,
        reviewed: false,
        jsonError: false,
      })),
      unresolved: body.unresolvedRows.map((entry) => ({
        ...entry,
        resolved: false,
        acknowledged: false,
        skipped: false,
      })),
    };
    renderSourceReview();
    setStatus("Review every proposed row and acknowledge unresolved rows before staging.");
  } catch (error) {
    sourceReview = null;
    renderSourceReview();
    setStatus(error instanceof Error ? error.message : "The source workbook could not be previewed.", true);
  } finally {
    validating = false;
    updateControls();
  }
}

async function stageSourceReview() {
  if (!canWrite || inFlight || validating || !sourceReview) return;
  const included = sourceReview.candidates.filter((row) => row.include);
  if (!included.length) {
    setStatus("Include at least one reviewed row before staging.", true);
    return;
  }
  if (included.some((row) => !row.reviewed || row.jsonError)) {
    setStatus("Review each included row and correct invalid JSON before staging.", true);
    return;
  }
  if (sourceReview.sourceFamily === "cheese-mix-specs" && included.some((row) => {
    const values = row.record.data?.values;
    return !object(values) || ![1, 2, 3, 4].some((slot) =>
      Array.isArray(values[`app${slot}CheeseRecipe`])
      && typeof values[`app${slot}CheeseRecipeName`] === "string"
      && values[`app${slot}CheeseRecipeName`].trim());
  })) {
    setStatus("Choose an explicit V2 cheese applicator slot for each included cheese recipe.", true);
    return;
  }
  if (sourceReview.unresolved.some((row) => !row.acknowledged && !row.resolved && !row.skipped)) {
    setStatus("Acknowledge every unresolved row as review-only or mark it skipped.", true);
    return;
  }
  try {
    const csv = recordsToCsv(sourceReview.targetFamily, included.map((row) => row.record));
    parseSetupCatalogCsv(sourceReview.targetFamily, csv);
    const skippedRows = sourceReview.skippedRows
      + sourceReview.candidates.filter((row) => !row.include).length
      + sourceReview.unresolved.filter((row) => row.skipped).length;
    const sourceSummary = {
      sourceFamily: sourceReview.sourceFamily,
      sourceSha256: sourceReview.sourceSha256,
      parserVersion: sourceReview.parserVersion,
      sourceRows: sourceReview.sourceRows,
      importedRows: included.length,
      skippedRows,
      unresolvedRows: sourceReview.unresolved.filter((row) => !row.skipped && !row.resolved).length,
    };
    if (!validSourceSummary(sourceSummary)) throw new Error("The source review counts are invalid.");
    pending = {
      actorId: staff.userId,
      requestId: crypto.randomUUID(),
      family: sourceReview.targetFamily,
      csv,
      sourceSummary,
    };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    await submitPending(parseSetupCatalogCsv(pending.family, pending.csv));
    sourceReview = null;
    renderSourceReview();
    dom["source-workbook-file"].value = "";
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The source rows could not be staged.", true);
  }
}

function updateSourceFileAccept() {
  const sauce = dom["source-workbook-family"].value === "sauce-guides";
  document.getElementById("source-workbook-file-label").textContent = sauce
    ? "XLSX workbook or DOCX guide"
    : "XLSX workbook";
  dom["source-workbook-file"].accept = sauce
    ? ".xlsx,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  document.getElementById("source-workbook-help").textContent = sauce
    ? "Up to 5 MiB. Sauce guides accept XLSX sentence tables or DOCX text; unsupported sentences remain review-only."
    : "Up to 5 MiB. Excel formulas and cached formula values require review.";
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
  if (validSourceSummary(item.sourceSummary)) {
    const summary = document.createElement("p");
    summary.className = "manager-help";
    summary.textContent = `${sourceFamilyLabel(item.sourceSummary.sourceFamily)} · ${item.sourceSummary.sourceRows} source rows · ${item.sourceSummary.importedRows} staged · ${item.sourceSummary.skippedRows} skipped · ${item.sourceSummary.unresolvedRows} unresolved and review-only${Number.isSafeInteger(item.createdCount) ? ` · ${item.createdCount} created` : ""}${Number.isSafeInteger(item.updatedCount) ? ` · ${item.updatedCount} updated` : ""}`;
    dom["setup-catalog-preview"].append(summary);
  } else if (Number.isSafeInteger(item.createdCount) || Number.isSafeInteger(item.updatedCount)) {
    const summary = document.createElement("p");
    summary.className = "manager-help";
    summary.textContent = `${item.createdCount ?? 0} created · ${item.updatedCount ?? 0} updated`;
    dom["setup-catalog-preview"].append(summary);
  }
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
    && text(item.createdAt, 60)
    && (item.sourceSummary == null || validSourceSummary(item.sourceSummary))
    && (item.createdCount == null || (Number.isSafeInteger(item.createdCount) && item.createdCount >= 0))
    && (item.updatedCount == null || (Number.isSafeInteger(item.updatedCount) && item.updatedCount >= 0));
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
    const source = validSourceSummary(item.sourceSummary)
      ? `${sourceFamilyLabel(item.sourceSummary.sourceFamily)} · ${item.sourceSummary.sourceRows} source · ${item.sourceSummary.importedRows} staged · ${item.sourceSummary.skippedRows} skipped · ${item.sourceSummary.unresolvedRows} unresolved`
      : `${item.family} · ${item.rowCount} rows`;
    const applied = Number.isSafeInteger(item.createdCount) || Number.isSafeInteger(item.updatedCount)
      ? ` · ${item.createdCount ?? 0} created · ${item.updatedCount ?? 0} updated`
      : "";
    label.textContent = `${source} · ${item.status}${applied}`;
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
        ...(pending.sourceSummary ? { sourceSummary: pending.sourceSummary } : {}),
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
    const sourceSummary = validSourceSummary(response.sourceSummary) ? response.sourceSummary : null;
    setStatus(sourceSummary
      ? `${sourceSummary.importedRows} ${sourceFamilyLabel(sourceSummary.sourceFamily).toLocaleLowerCase()} rows are staged; ${sourceSummary.skippedRows} skipped and ${sourceSummary.unresolvedRows} remain review-only.`
      : `${response.rowCount} setup rows are staged. Apply only after reviewing the values.`);
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
    if (action === "apply") {
      setStatus(`${result.createdCount ?? 0} setup rows created and ${result.updatedCount ?? 0} updated.`);
    } else {
      setStatus("Setup import undone. Later changes were preserved.");
    }
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
  dom["source-workbook-family"].disabled = !canWrite || inFlight || validating;
  dom["source-workbook-file"].disabled = !canWrite || inFlight || validating;
  dom["source-workbook-preview-button"].disabled = !canWrite || inFlight || validating;
  updateSourceStageButton();
}

dom["setup-catalog-family"].addEventListener("change", () => {
  dom["setup-catalog-preview"].hidden = true;
  dom["setup-catalog-actions"].hidden = true;
  dom["setup-catalog-file"].value = "";
  sourceReview = null;
  renderSourceReview();
  renderTemplate();
});
dom["source-workbook-form"].addEventListener("submit", (event) => { void previewSourceWorkbook(event); });
dom["source-workbook-family"].addEventListener("change", () => {
  sourceReview = null;
  updateSourceFileAccept();
  renderSourceReview();
});
updateSourceFileAccept();
dom["source-workbook-stage"].addEventListener("click", () => { void stageSourceReview(); });
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
