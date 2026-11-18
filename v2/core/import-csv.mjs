import { setupImportCsvTemplates } from "./import-csv-templates.mjs";

const MAX_CSV_BYTES = 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_CELL_LENGTH = 20_000;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UNIT_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,15}$/;
const QUANTITY_PATTERN = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;

export class ImportCsvError extends Error {
  constructor(message, row = null, field = null) {
    super(message);
    this.name = "ImportCsvError";
    this.row = row;
    this.field = field;
  }
}

function fail(message, row = null, field = null) {
  throw new ImportCsvError(message, row, field);
}

export function parseCsvRows(input) {
  if (typeof input !== "string") fail("Upload a CSV file as text.");
  if (new TextEncoder().encode(input).byteLength > MAX_CSV_BYTES) {
    fail("CSV files must be 1 MiB or smaller.");
  }
  if (input.includes("\u0000") || input.includes("\uFFFD")) {
    fail("The CSV contains invalid text encoding or a forbidden character.");
  }

  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let atFieldStart = true;

  function appendCharacter(character) {
    cell += character;
    if (cell.length > MAX_CELL_LENGTH) fail("A CSV value is too long.", rows.length + 1);
  }

  function finishCell() {
    row.push(cell);
    cell = "";
    closedQuote = false;
    atFieldStart = true;
  }

  function finishRow() {
    finishCell();
    if (row.some((value) => value !== "")) {
      rows.push(row);
      if (rows.length > MAX_ROWS + 1) fail(`CSV files may contain at most ${MAX_ROWS} data rows.`);
    }
    row = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          appendCharacter('"');
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        appendCharacter(character);
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\n" && character !== "\r") {
      fail("Only a comma or line break may follow a closing quote.", rows.length + 1);
    }
    if (character === "," ) {
      finishCell();
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      else if (character === "\r") fail("Use LF or CRLF line endings.", rows.length + 1);
      finishRow();
      continue;
    }
    if (character === '"') {
      if (!atFieldStart) fail("A quote must start a CSV value.", rows.length + 1);
      quoted = true;
      atFieldStart = false;
      continue;
    }
    appendCharacter(character);
    atFieldStart = false;
    closedQuote = false;
  }

  if (quoted) fail("A quoted CSV value is not closed.", rows.length + 1);
  if (cell !== "" || row.length > 0 || closedQuote) finishRow();
  if (rows.length === 0) fail("The CSV is empty.");
  return rows;
}

export function validateCsvHeaders(rows, expected) {
  const [headers, ...data] = rows;
  if (headers.length !== expected.length || headers.some((header, index) => header !== expected[index])) {
    fail(`Use exactly these CSV columns, in order: ${expected.join(", ")}.`, 1);
  }
  for (let index = 0; index < data.length; index += 1) {
    if (data[index].length !== expected.length) {
      fail("Every data row must have the same number of columns as the header.", index + 2);
    }
  }
  if (data.length === 0) fail("Add at least one data row below the header.", 1);
  return data;
}

export function parseImportCode(value, row, field = "code") {
  if (typeof value !== "string" || !CODE_PATTERN.test(value)) {
    fail("Use 1–80 letters, numbers, dots, underscores, or hyphens; start with a letter or number.", row, field);
  }
  return value;
}

export function parseImportName(value, row, field = "name") {
  const name = value.trim();
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
    fail("Enter a name from 1 to 120 characters without control characters.", row, field);
  }
  return name;
}

export function parseImportObjectJson(value, row, field) {
  if (value.length > 20_000) fail("JSON data must be 20,000 characters or less.", row, field);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("Enter valid JSON data.", row, field);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("JSON data must be an object.", row, field);
  }

  const stack = [{ value: parsed, depth: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > 1000 || current.depth > 10) fail("JSON data is too complex.", row, field);
    for (const child of Object.values(current.value)) {
      if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
      else if (typeof child === "number" && !Number.isFinite(child)) fail("JSON numbers must be finite.", row, field);
    }
  }
  return parsed;
}

function ensureUnique(records, rowNumber, seen) {
  const normalized = records.code.toLocaleLowerCase("en-US");
  if (seen.has(normalized)) fail("A code may appear only once in an import.", rowNumber, "code");
  seen.add(normalized);
}

export function parseSetupImportCsv(kind, text) {
  const definitions = Object.fromEntries(
    Object.entries(setupImportCsvTemplates).map(([key, template]) => [key, template.headers]),
  );
  const headers = definitions[kind];
  if (!headers) fail("Choose a supported import type.");
  const rows = validateCsvHeaders(parseCsvRows(text), headers);
  const seen = new Set();
  const records = rows.map((columns, index) => {
    const rowNumber = index + 2;
    const code = parseImportCode(columns[0], rowNumber);
    const name = parseImportName(columns[1], rowNumber);
    const key = { code, name };
    if (kind === "products") {
      const unit = columns[2].trim();
      if (!UNIT_PATTERN.test(unit)) fail("Enter a valid base unit using letters, numbers, dots, slashes, or hyphens.", rowNumber, "unit");
      key.unit = unit.toLowerCase();
    } else {
      key.productCode = parseImportCode(columns[2], rowNumber, "product_code");
      key.data = parseImportObjectJson(columns[3], rowNumber, headers[3]);
    }
    ensureUnique(key, rowNumber, seen);
    return key;
  });
  return records;
}

export function parseOpeningCountCsv(text, activeProductCodes) {
  if (!Array.isArray(activeProductCodes)) throw new TypeError("Active product codes are required.");
  const rows = validateCsvHeaders(parseCsvRows(text), ["product_code", "quantity"]);
  const seen = new Set();
  const counts = rows.map((columns, index) => {
    const rowNumber = index + 2;
    const productCode = parseImportCode(columns[0], rowNumber, "product_code");
    const normalized = productCode.toLocaleLowerCase("en-US");
    if (seen.has(normalized)) fail("A product may appear only once in a count.", rowNumber, "product_code");
    seen.add(normalized);
    const quantity = columns[1];
    if (!QUANTITY_PATTERN.test(quantity)) {
      fail("Enter a non-negative quantity with up to six decimal places.", rowNumber, "quantity");
    }
    return { productCode, quantity };
  });

  const known = new Set(activeProductCodes.map((code) => String(code).toLocaleLowerCase("en-US")));
  const unknown = counts.find((item) => !known.has(item.productCode.toLocaleLowerCase("en-US")));
  if (unknown) fail(`Product code "${unknown.productCode}" is not active in V2.`, null, "product_code");
  const missing = activeProductCodes.filter((code) => !seen.has(String(code).toLocaleLowerCase("en-US")));
  if (missing.length > 0) {
    fail(`Count every active product, including zero quantities. Missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}.`);
  }
  return counts;
}

export const importCsvLimits = Object.freeze({
  maxBytes: MAX_CSV_BYTES,
  maxRows: MAX_ROWS,
});
