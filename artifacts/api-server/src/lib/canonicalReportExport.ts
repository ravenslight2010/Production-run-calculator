import { createHash } from "node:crypto";
import type { OperationalReport } from "@workspace/day-summary";

export type CanonicalReportExportFormat = "csv" | "xlsx" | "print";

export type CanonicalReportSnapshot = {
  id: string;
  contentHash: string;
  finalizedAt: Date;
  report: OperationalReport;
};

export function canonicalReportSnapshotId(snapshot: Pick<CanonicalReportSnapshot, "id" | "contentHash">): string {
  return `finalized:${snapshot.id}:${snapshot.contentHash}`;
}

function safeCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: string | number | undefined): string {
  return `"${safeCell(value).replace(/"/g, "\"\"")}"`;
}

type ExportRow = Record<string, string | number>;

/** A deterministic, server-owned flat representation of a finalized report. */
export function canonicalReportRows(snapshot: CanonicalReportSnapshot): ExportRow[] {
  const report = snapshot.report;
  const rows: ExportRow[] = [{
    Section: "Canonical snapshot",
    "Row type": "metadata",
    "Snapshot ID": canonicalReportSnapshotId(snapshot),
    "Archive ID": snapshot.id,
    "Content hash": snapshot.contentHash,
    "Finalized at": snapshot.finalizedAt.toISOString(),
    Period: `${report.periodStart} to ${report.periodEnd}`,
    Scope: report.scope,
  }];
  const add = (section: string, type: string, id: string, fields: ExportRow) =>
    rows.push({ Section: section, "Row type": type, ID: id, ...fields });
  add("Production", "summary", "production", {
    "Cases planned": report.production.casesPlanned, "Cases produced": report.production.casesProduced,
    "Attainment %": report.production.attainmentPct, "Downtime minutes": report.production.totalDowntimeMinutes,
    Stoppages: report.production.totalStoppages,
  });
  for (const row of report.productionRows ?? []) add("Production", "detail", row.id, {
    Date: row.date, Run: row.run, Status: row.status, "Cases planned": row.casesPlanned,
    "Cases produced": row.casesProduced, "Attainment %": row.attainmentPct,
    "Downtime minutes": row.downtimeMinutes, Stoppages: row.stoppages,
  });
  for (const row of report.quality.value?.rows ?? []) add("Quality", "detail", row.id, {
    Date: row.occurredAt, Product: row.product, Status: row.status, Issues: row.issues, Detail: row.summary,
  });
  for (const row of report.incidents.value?.rows ?? []) add("Incidents", "detail", row.id, {
    Date: row.occurredAt, Status: row.status, Priority: row.priority, Reporter: row.reporter, Detail: row.summary,
  });
  for (const row of report.inventory.value?.rows ?? []) add("Inventory", "detail", row.id, {
    Item: row.item, Status: row.state, "On hand": row.onHand, Unit: row.unit, "Reorder threshold": row.reorderThreshold,
  });
  for (const row of report.unresolvedActions?.value?.rows ?? []) add("Actions", "detail", row.id, {
    Priority: row.priority, Source: row.source, Action: row.action, Detail: row.detail,
  });
  return rows;
}

export function canonicalReportCsv(snapshot: CanonicalReportSnapshot): string {
  const rows = canonicalReportRows(snapshot);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n");
}

function xml(value: string | number | undefined): string {
  return safeCell(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function canonicalReportPrintHtml(snapshot: CanonicalReportSnapshot): string {
  const rows = canonicalReportRows(snapshot);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Canonical operational report</title>
<style>body{font:12px system-ui,sans-serif;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #555;padding:4px;text-align:left;vertical-align:top}th{background:#eee}@media print{body{margin:8mm}}</style>
</head><body><h1>Canonical operational report</h1><p>Snapshot: ${xml(canonicalReportSnapshotId(snapshot))}<br>Content hash: ${xml(snapshot.contentHash)}</p>
<table><thead><tr>${headers.map((header) => `<th>${xml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${xml(row[header])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const utf8 = new TextEncoder();
const u16 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255);
const u32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; } return out;
};

/** Minimal standards-compliant XLSX writer; keeps export packaging server-side without a browser-only dependency. */
export function canonicalReportXlsx(snapshot: CanonicalReportSnapshot): Uint8Array {
  const rows = canonicalReportRows(snapshot);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const letters = (column: number) => {
    let value = column + 1; let result = "";
    while (value) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
    return result;
  };
  const sheetRows = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${letters(c)}${r + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files: Array<[string, string]> = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Canonical report" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ];
  let offset = 0; const local: Uint8Array[] = []; const central: Uint8Array[] = [];
  for (const [name, body] of files) {
    const path = utf8.encode(name); const data = utf8.encode(body); const crc = crc32(data);
    local.push(join(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(path.length), u16(0), path, data));
    central.push(join(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(path.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), path));
    offset += local[local.length - 1].length;
  }
  const directory = join(...central);
  return join(...local, directory, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0));
}

export function canonicalExportFilename(snapshot: CanonicalReportSnapshot, format: CanonicalReportExportFormat): string {
  const stamp = createHash("sha256").update(canonicalReportSnapshotId(snapshot)).digest("hex").slice(0, 12);
  return `canonical-operational-${snapshot.report.scope}-${snapshot.report.date}-${stamp}.${format === "print" ? "html" : format}`;
}