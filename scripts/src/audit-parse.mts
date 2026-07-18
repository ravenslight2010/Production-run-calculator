// Task audit helper: deterministically parse the uploaded source workbooks and
// write JSON to /tmp/audit_parsed_*.json for comparison against prod data.
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseCheeseWorkbook } from "@workspace/cheese-import";
import { parsePremixWorkbook } from "@workspace/premix-import";
import { parseShippingGuide } from "@workspace/shipping-import";

type SheetGrid = { name: string; rows: string[][] };

function readGrids(file: string): SheetGrid[] {
  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf);
  const grids: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    grids.push({
      name,
      rows: rows.map(r => (Array.isArray(r) ? r.map(c => (c == null ? "" : String(c))) : [])),
    });
  }
  return grids;
}

const LIB = path.resolve(process.cwd(), "..", "attached_assets/source-library");
const out: Record<string, unknown> = {};

// Cheese workbook
{
  const dir = path.join(LIB, "cheese");
  for (const f of fs.readdirSync(dir)) {
    const grids = readGrids(path.join(dir, f));
    out.cheese = parseCheeseWorkbook(grids);
  }
}

// Premix workbook
{
  const dir = path.join(LIB, "premix");
  for (const f of fs.readdirSync(dir)) {
    const grids = readGrids(path.join(dir, f));
    out.premix = parsePremixWorkbook(grids);
  }
}

// Shipping guide
{
  const dir = path.join(LIB, "shipping");
  for (const f of fs.readdirSync(dir)) {
    const grids = readGrids(path.join(dir, f));
    out.shipping = parseShippingGuide(grids);
  }
}

// Dough + sauce procedure workbooks: raw grids (generic ingredient/lbs
// extraction is done in the comparison step; keep the full grid for evidence).
for (const kind of ["dough", "sauce"] as const) {
  const dir = path.join(LIB, kind);
  const files: Record<string, SheetGrid[]> = {};
  for (const f of fs.readdirSync(dir)) files[f] = readGrids(path.join(dir, f));
  out[`${kind}Grids`] = files;
}

// Spec sheets: raw grids for targeted extraction in the comparison step.
{
  const dir = path.join(LIB, "specs");
  const files: Record<string, SheetGrid[]> = {};
  for (const f of fs.readdirSync(dir)) files[f] = readGrids(path.join(dir, f));
  out.specGrids = files;
}

// Schedule workbook grids too (informational).
{
  const dir = path.join(LIB, "schedule");
  const files: Record<string, SheetGrid[]> = {};
  for (const f of fs.readdirSync(dir)) files[f] = readGrids(path.join(dir, f));
  out.scheduleGrids = files;
}

for (const [k, v] of Object.entries(out)) {
  fs.writeFileSync(`/tmp/audit_parsed_${k}.json`, JSON.stringify(v, null, 1));
  console.log(k, "written");
}
