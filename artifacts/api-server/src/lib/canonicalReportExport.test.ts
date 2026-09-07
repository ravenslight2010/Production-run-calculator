import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  canonicalReportCsv,
  canonicalReportPrintHtml,
  canonicalReportRows,
  canonicalReportSnapshotId,
  canonicalReportXlsx,
} from "./canonicalReportExport";

const snapshot = {
  id: "3b1267a8-11bb-44e2-a8b9-687874f54800", contentHash: "a".repeat(64), finalizedAt: new Date("2025-01-01T00:00:00.000Z"),
  report: { scope: "day", date: "2025-01-01", periodStart: "2025-01-01", periodEnd: "2025-01-01", production: { casesPlanned: 1, casesProduced: 1, attainmentPct: 100, totalDowntimeMinutes: 0, totalStoppages: 0, runsFinished: 1, runsPlanned: 1, unfinishedRuns: [] }, productionRows: [], quality: { availability: "unavailable", value: null }, incidents: { availability: "unavailable", value: null }, inventory: { availability: "unavailable", value: null } },
} as any;

function parseCsv(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === "\"") {
        if (csv[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === ",") {
      record.push(cell);
      cell = "";
    } else if (character === "\r" && csv[index + 1] === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      index += 1;
    } else {
      cell += character;
    }
  }
  record.push(cell);
  records.push(record);
  return records;
}

function unescapeXml(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function readXlsxWorksheet(bytes: Uint8Array): string[][] {
  const data = Buffer.from(bytes);
  const rows: string[][] = [];
  let offset = 0;
  while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const method = data.readUInt16LE(offset + 8);
    const compressedSize = data.readUInt32LE(offset + 18);
    const nameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = data.subarray(dataStart, dataStart + compressedSize);
    const xml = (method === 0 ? compressed : inflateRawSync(compressed)).toString("utf8");
    if (data.subarray(offset + 30, offset + 30 + nameLength).toString("utf8") === "xl/worksheets/sheet1.xml") {
      for (const rowXml of xml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)) {
        rows.push([...rowXml[1].matchAll(/<c\b[^>]*>.*?<t>(.*?)<\/t>.*?<\/c>/gs)]
          .map((match) => unescapeXml(match[1])));
      }
      break;
    }
    offset = dataStart + compressedSize;
  }
  return rows;
}

const auditedSnapshot = {
  id: "4b1267a8-11bb-44e2-a8b9-687874f54800",
  contentHash: "b".repeat(64),
  finalizedAt: new Date("2026-09-07T05:30:00.000-07:00"),
  report: {
    scope: "day",
    date: "2026-09-06",
    periodStart: "2026-09-06",
    periodEnd: "2026-09-06",
    generatedAt: "2026-09-07T05:29:59.000-07:00",
    attribution: { generatedBy: "manager@example.test", source: "canonical-server" },
    production: {
      casesPlanned: 2, casesProduced: 1, attainmentPct: 50, totalDowntimeMinutes: 7,
      totalStoppages: 1, runsFinished: 0, runsPlanned: 1, unfinishedRuns: ["Café 栗🌶️"],
    },
    productionRows: [{
      id: "run-1", date: "2026-09-06", run: "Café 栗🌶️", status: "unfinished",
      casesPlanned: 2, casesProduced: 1, attainmentPct: 50, downtimeMinutes: 7, stoppages: 1,
    }],
    quality: {
      availability: "available",
      value: { rows: [{ id: "quality-1", occurredAt: "2026-09-06T23:59:59-07:00", product: "Crème brûlée", status: "open", issues: 1, summary: "=HYPERLINK(\"https://example.test\",\"unsafe\")" }] },
    },
    incidents: {
      availability: "available",
      value: { rows: [{ id: "incident-1", occurredAt: "2026-09-06T23:59:58-07:00", status: "open", priority: "high", reporter: "@night-shift", summary: "Temperature + humidity review" }] },
    },
    inventory: {
      availability: "available",
      value: { rows: [{ id: "inventory-1", item: "-reorder-me", state: "low", onHand: 1, unit: "kg", reorderThreshold: 2 }] },
    },
    unresolvedActions: {
      availability: "available",
      value: { rows: [{ id: "action-1", priority: "high", source: "quality", action: "Review", detail: "Café 栗🌶️" }] },
    },
  },
} as any;

describe("canonical report export", () => {
  it("labels exports with immutable snapshot identity and emits a zip XLSX", () => {
    expect(canonicalReportCsv(snapshot)).toContain(canonicalReportSnapshotId(snapshot));
    const bytes = canonicalReportXlsx(snapshot);
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    expect(new TextDecoder().decode(bytes)).toContain("Canonical report");
  });

  it("round-trips CSV and XLSX detail rows, provenance, Unicode, timestamps, and formula-like values", () => {
    const csvRows = parseCsv(canonicalReportCsv(auditedSnapshot));
    const csvHeaders = csvRows[0];
    const csvByType = new Map(csvRows.slice(1).map((row) => [
      row[csvHeaders.indexOf("Row type")] + ":" + row[csvHeaders.indexOf("ID")],
      Object.fromEntries(csvHeaders.map((header, index) => [header, row[index]])),
    ]));
    const metadata = csvByType.get("metadata:")!;
    expect(metadata["Snapshot ID"]).toBe(canonicalReportSnapshotId(auditedSnapshot));
    expect(metadata["Archive ID"]).toBe(auditedSnapshot.id);
    expect(metadata["Content hash"]).toBe(auditedSnapshot.contentHash);
    expect(metadata["Finalized at"]).toBe(auditedSnapshot.finalizedAt.toISOString());
    expect(csvByType.get("detail:run-1")?.Run).toBe("Café 栗🌶️");
    expect(csvByType.get("detail:quality-1")?.Date).toBe("2026-09-06T23:59:59-07:00");
    expect(csvByType.get("detail:quality-1")?.Detail).toBe("'=HYPERLINK(\"https://example.test\",\"unsafe\")");
    expect(csvByType.get("detail:incident-1")?.Reporter).toBe("'@night-shift");
    expect(csvByType.get("detail:inventory-1")?.Item).toBe("'-reorder-me");
    expect(csvRows).toHaveLength(canonicalReportRows(auditedSnapshot).length + 1);

    const worksheetRows = readXlsxWorksheet(canonicalReportXlsx(auditedSnapshot));
    expect(worksheetRows[0]).toEqual(csvRows[0]);
    const xlsxByType = new Map(worksheetRows.slice(1).map((row) => [
      row[csvHeaders.indexOf("Row type")] + ":" + row[csvHeaders.indexOf("ID")],
      Object.fromEntries(csvHeaders.map((header, index) => [header, row[index]])),
    ]));
    expect(xlsxByType.get("metadata:")?.["Snapshot ID"]).toBe(canonicalReportSnapshotId(auditedSnapshot));
    expect(xlsxByType.get("detail:run-1")?.Run).toBe("Café 栗🌶️");
    expect(xlsxByType.get("detail:quality-1")?.Detail).toBe("'=HYPERLINK(\"https://example.test\",\"unsafe\")");
    expect(worksheetRows).toHaveLength(csvRows.length);
  });

  it("keeps print/PDF-friendly HTML escaped, provenance-bearing, and bounded for large detail sets", () => {
    const largeSnapshot = {
      ...auditedSnapshot,
      report: {
        ...auditedSnapshot.report,
        productionRows: Array.from({ length: 2_000 }, (_, index) => ({
          id: `large-${index}`,
          date: "2026-09-06",
          run: `Run ${index} Café`,
          status: "finished",
          casesPlanned: 1,
          casesProduced: 1,
          attainmentPct: 100,
          downtimeMinutes: 0,
          stoppages: 0,
        })),
      },
    };
    const html = canonicalReportPrintHtml(largeSnapshot);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("@media print");
    expect(html).toContain(`Snapshot: ${canonicalReportSnapshotId(largeSnapshot).replace(/&/g, "&amp;")}`);
    expect(html).toContain(`Content hash: ${largeSnapshot.contentHash}`);
    expect(html).toContain("Run 0 Café");
    expect(html).toContain("Run 1999 Café");
    expect(html).not.toContain("<script");
    expect(html.length).toBeLessThan(2_000_000);
    expect(canonicalReportRows(largeSnapshot)).toHaveLength(2_006);
  });
});
