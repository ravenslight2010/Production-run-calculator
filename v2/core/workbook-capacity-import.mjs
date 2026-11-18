import { createHash } from "node:crypto";
import path from "node:path";
import * as XLSX from "xlsx";

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 32;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 100_000;
const MAX_NAME_LENGTH = 180;
const MAX_NUMERIC_VALUE = 1_000_000;
const NUMERIC_TEXT = /^(?:0|[1-9]\d*|(?:\d{1,3}(?:,\d{3})+))(?:\.\d+)?$/u;

export class WorkbookCapacityImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkbookCapacityImportError";
  }
}

function fail(message) {
  throw new WorkbookCapacityImportError(message);
}

function safeFileName(value) {
  if (typeof value !== "string" || value.length > MAX_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail("Choose an XLSX workbook with a valid file name.");
  }
  const fileName = path.basename(value.replaceAll("\\", "/")).trim();
  if (!/\.xlsx$/iu.test(fileName) || fileName.length > 120) {
    fail("Upload an .xlsx workbook.");
  }
  return fileName;
}

function validateZipContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 22 || buffer.byteLength > MAX_WORKBOOK_BYTES) {
    fail("XLSX workbooks must be between 22 bytes and 5 MiB.");
  }

  const searchStart = Math.max(0, buffer.byteLength - 65_557);
  let eocd = -1;
  for (let offset = buffer.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.byteLength) {
        eocd = offset;
        break;
      }
    }
  }
  if (eocd < 0) fail("The workbook is not a valid XLSX archive.");

  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const directoryDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryBytes = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== entryCount
    || entryCount < 1 || entryCount > MAX_ZIP_ENTRIES
    || entryCount === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff
    || directoryOffset + directoryBytes > eocd) {
    fail("The workbook archive uses an unsupported or oversized ZIP layout.");
  }

  let offset = directoryOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryOffset + directoryBytes
      || buffer.readUInt32LE(offset) !== 0x02014b50) {
      fail("The workbook archive has an invalid file directory.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const end = nameStart + nameLength + extraLength + commentLength;
    if (end > directoryOffset + directoryBytes || nameLength < 1
      || compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff
      || (flags & 1) !== 0 || ![0, 8].includes(method)
      || uncompressedBytes > MAX_ENTRY_BYTES
      || compressedBytes > MAX_WORKBOOK_BYTES) {
      fail("The workbook archive contains an unsupported, encrypted, or oversized entry.");
    }
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    if (name.startsWith("/") || name.includes("\\")
      || name.split("/").some((part) => part === "..")) {
      fail("The workbook archive contains an invalid file path.");
    }
    expandedBytes += uncompressedBytes;
    if (expandedBytes > MAX_TOTAL_EXPANDED_BYTES) {
      fail("The workbook expands beyond the 10 MiB processing limit.");
    }
    offset = end;
  }
  if (offset !== directoryOffset + directoryBytes) {
    fail("The workbook archive has an invalid file directory.");
  }
}

function readWorkbook(buffer, fileName) {
  validateZipContainer(buffer);
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      raw: false,
      cellFormula: true,
      cellText: true,
      cellDates: false,
      bookVBA: false,
    });
  } catch {
    fail("The XLSX workbook could not be read. Resave it as a standard .xlsx file.");
  }
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length < 1
    || workbook.SheetNames.length > MAX_SHEETS) {
    fail("The workbook must contain between one and 32 sheets.");
  }
  return { workbook, fileName };
}

export function readWorkbookSheets(buffer, fileName) {
  const parsedFileName = safeFileName(fileName);
  const { workbook } = readWorkbook(buffer, parsedFileName);
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const formulas = [];
    if (sheet && typeof sheet["!ref"] === "string") {
      let range;
      try {
        range = XLSX.utils.decode_range(sheet["!ref"]);
      } catch {
        fail("The workbook contains an invalid sheet range.");
      }
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (typeof cell?.f === "string" && cell.f) formulas.push({ row, column });
        }
      }
    }
    return { name, rows: sheetRows(sheet, name), formulas };
  });
  return {
    fileName: parsedFileName,
    fileSha256: createHash("sha256").update(buffer).digest("hex"),
    sheets,
  };
}

function sheetRows(sheet, sheetName) {
  if (!sheet || typeof sheet["!ref"] !== "string") return [];
  let range;
  try {
    range = XLSX.utils.decode_range(sheet["!ref"]);
  } catch {
    fail("The workbook contains an invalid sheet range.");
  }
  const rowCount = range.e.r + 1;
  const columnCount = range.e.c + 1;
  if (rowCount * columnCount > MAX_CELLS || rowCount > MAX_ROWS + 100 || columnCount > MAX_COLUMNS) {
    fail("The workbook sheet is too large to review safely.");
  }
  const rows = Array.from({ length: rowCount }, () => Array(columnCount).fill(""));
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      const formatted = typeof cell.w === "string" ? cell.w : "";
      if (formatted) rows[row][column] = formatted;
      else if (!cell.f && (cell.t === "s" || cell.t === "str")) rows[row][column] = String(cell.v ?? "");
      else if (!cell.f && cell.t === "n" && Number.isFinite(cell.v)) rows[row][column] = String(cell.v);
    }
  }
  return rows;
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‘’`]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedMatchKey(value) {
  return normalizedText(value).toLocaleLowerCase("en-US");
}

function numberFromCell(value, { integer = false } = {}) {
  const text = normalizedText(value);
  if (!text || !NUMERIC_TEXT.test(text)) return null;
  const number = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(number) || number <= 0 || number > MAX_NUMERIC_VALUE
    || (integer && !Number.isSafeInteger(number))) return null;
  return number;
}

function sourceCell(sheetName, rowIndex, columnIndex) {
  return `${sheetName}!${XLSX.utils.encode_col(columnIndex)}${rowIndex + 1}`;
}

function matchingDoughHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 120); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const keys = row.map((cell) => normalizedMatchKey(cell).replace(/[^a-z]/gu, ""));
    const ozColumn = keys.findIndex((key) => key === "oz" || key === "ounces");
    const yieldColumn = keys.findIndex((key) => key === "yield");
    const trayColumn = keys.findIndex((key) => key.includes("tray"));
    if (ozColumn >= 1 && yieldColumn > ozColumn && trayColumn > yieldColumn) {
      return { rowIndex, ozColumn, yieldColumn, trayColumn };
    }
  }
  return null;
}

function rowLabel(row, beforeColumn) {
  for (let column = beforeColumn - 1; column >= 0; column -= 1) {
    const label = normalizedText(row[column]);
    if (label) return { label, column };
  }
  return { label: "", column: -1 };
}

function sourceKeyFor({ family, fileName, sheetName, label, occurrence }) {
  const digest = createHash("sha256")
    .update([family, normalizedMatchKey(fileName), normalizedMatchKey(sheetName), normalizedMatchKey(label), occurrence].join("\u0000"))
    .digest("hex");
  return digest;
}

function uniqueNameKeyMap(products) {
  const groups = new Map();
  for (const product of products) {
    if (!product || typeof product.code !== "string" || typeof product.name !== "string") continue;
    const key = normalizedMatchKey(product.name);
    if (!key) continue;
    const matches = groups.get(key) ?? [];
    matches.push(product);
    groups.set(key, matches);
  }
  return groups;
}

function mapRowsToProducts(rows, products, priorLinks, managerLinks = []) {
  const productByCode = new Map(products.map((product) => [product.code.toLocaleLowerCase("en-US"), product]));
  const exactNames = uniqueNameKeyMap(products);
  const existingLinks = new Map();
  const explicitLinks = new Map();
  for (const link of priorLinks) {
    if (typeof link?.sourceKey === "string" && typeof link?.productCode === "string") {
      existingLinks.set(link.sourceKey, link.productCode);
    }
  }
  for (const link of managerLinks) {
    if (typeof link?.sourceKey === "string" && typeof link?.productCode === "string") {
      explicitLinks.set(link.sourceKey, link.productCode);
    }
  }

  return rows.map((row) => {
    const existingCode = existingLinks.get(row.sourceKey);
    const existingProduct = existingCode ? productByCode.get(existingCode.toLocaleLowerCase("en-US")) : null;
    if (existingProduct) return { ...row, productCode: existingProduct.code, linkType: "remembered" };
    const exactMatches = exactNames.get(normalizedMatchKey(row.name)) ?? [];
    if (exactMatches.length === 1) return { ...row, productCode: exactMatches[0].code, linkType: "exact" };
    const explicitCode = explicitLinks.get(row.sourceKey);
    const explicitProduct = explicitCode
      ? productByCode.get(explicitCode.toLocaleLowerCase("en-US"))
      : null;
    if (explicitProduct) return { ...row, productCode: explicitProduct.code, linkType: "manager" };
    return {
      ...row,
      productCode: null,
      linkType: exactMatches.length > 1 ? "ambiguous" : "unmatched",
    };
  });
}

function doughRowsFromWorkbook(workbook, fileName) {
  const output = [];
  const occurrences = new Map();
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName], sheetName);
    const header = matchingDoughHeader(rows);
    if (!header) continue;
    let blankRows = 0;
    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      if (row.every((value) => !normalizedText(value))) {
        blankRows += 1;
        if (blankRows >= 2) break;
        continue;
      }
      blankRows = 0;
      const { label, column: labelColumn } = rowLabel(row, header.ozColumn);
      const doughballOz = numberFromCell(row[header.ozColumn]);
      if (!label || doughballOz === null) continue;
      if (label.length > 120) fail("A dough recipe name is longer than the V2 120-character limit.");
      const rawYield = normalizedText(row[header.yieldColumn]);
      const yieldDoughballsPerBatch = numberFromCell(rawYield);
      const occurrenceKey = `${normalizedMatchKey(sheetName)}\u0000${normalizedMatchKey(label)}`;
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const sourceKey = sourceKeyFor({
        family: "dough",
        fileName,
        sheetName,
        label,
        occurrence,
      });
      const perTray = numberFromCell(row[header.trayColumn], { integer: true });
      output.push({
        sourceKey,
        name: label,
        doughballYield: yieldDoughballsPerBatch,
        doughballWeightOz: doughballOz,
        doughballsPerTray: perTray,
        source: {
          family: "dough-procedure",
          fileName,
          sheetName,
          row: rowIndex + 1,
          labelCell: sourceCell(sheetName, rowIndex, labelColumn),
          doughballWeightCell: sourceCell(sheetName, rowIndex, header.ozColumn),
          yieldCell: sourceCell(sheetName, rowIndex, header.yieldColumn),
          traysCell: sourceCell(sheetName, rowIndex, header.trayColumn),
          displayedYield: rawYield || null,
        },
      });
      if (output.length > MAX_ROWS) fail("The workbook contains more than 2,000 dough recipe rows.");
    }
  }
  return output;
}

function headerKey(value) {
  return normalizedMatchKey(value).replace(/[^a-z]/gu, "");
}

function parsePizzasPerCase(value) {
  const text = normalizedText(value);
  const multipack = text.match(/^([1-9]\d*)\s*[-–x×]\s*([1-9]\d*)\s*[- ]?\s*(?:pack|pk)s?$/iu);
  if (multipack) {
    const quantity = Number(multipack[1]) * Number(multipack[2]);
    return Number.isSafeInteger(quantity) && quantity <= 100 ? quantity : null;
  }
  const count = numberFromCell(text, { integer: true });
  return count !== null && count <= 100 ? count : null;
}

function shippingRowsFromWorkbook(workbook, fileName) {
  const output = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[sheetName], sheetName);
    let headerIndex = -1;
    let nameColumn = -1;
    let pizzasColumn = -1;
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
      const keys = (rows[rowIndex] ?? []).map(headerKey);
      const name = keys.findIndex((key) => ["pizza", "product", "brand"].includes(key));
      const pizzas = keys.findIndex((key) => key.startsWith("pizzas"));
      if (name >= 0 && pizzas > name) {
        headerIndex = rowIndex;
        nameColumn = name;
        pizzasColumn = pizzas;
        break;
      }
    }
    if (headerIndex < 0) continue;

    const occurrences = new Map();
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const name = normalizedText(row[nameColumn]);
      if (!name) continue;
      if (name.length > 120) fail("A shipping product name is longer than the V2 120-character limit.");
      const occurrenceKey = normalizedMatchKey(name);
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const sourceKey = sourceKeyFor({
        family: "shipping",
        fileName,
        sheetName,
        label: name,
        occurrence,
      });
      const rawPizzasPerCase = normalizedText(row[pizzasColumn]);
      output.push({
        sourceKey,
        name,
        pizzasPerCase: parsePizzasPerCase(rawPizzasPerCase),
        source: {
          family: "shipping-guide",
          fileName,
          sheetName,
          row: rowIndex + 1,
          labelCell: sourceCell(sheetName, rowIndex, nameColumn),
          pizzasPerCaseCell: sourceCell(sheetName, rowIndex, pizzasColumn),
          displayedPizzasPerCase: rawPizzasPerCase || null,
        },
      });
      if (output.length > MAX_ROWS) fail("The workbook contains more than 2,000 shipping rows.");
    }
    if (output.length > 0) break;
  }
  return output;
}

export function parseDoughCapacityWorkbook(buffer, fileName) {
  const parsedFileName = safeFileName(fileName);
  const { workbook } = readWorkbook(buffer, parsedFileName);
  const rows = doughRowsFromWorkbook(workbook, parsedFileName);
  if (rows.length === 0) {
    fail("No doughball yield table was found. Upload a dough mixing procedure with OZ, YIELD, and PER TRAY columns.");
  }
  return {
    fileName: parsedFileName,
    fileSha256: createHash("sha256").update(buffer).digest("hex"),
    rows,
  };
}

export function parseShippingCapacityWorkbook(buffer, fileName) {
  const parsedFileName = safeFileName(fileName);
  const { workbook } = readWorkbook(buffer, parsedFileName);
  const rows = shippingRowsFromWorkbook(workbook, parsedFileName);
  if (rows.length === 0) {
    fail("No shipping guide rows were found. Upload a guide with a PIZZA and PIZZAS/CS column.");
  }
  return {
    fileName: parsedFileName,
    fileSha256: createHash("sha256").update(buffer).digest("hex"),
    rows,
  };
}

export function linkWorkbookCapacityRows(rows, products, priorLinks = [], managerLinks = []) {
  if (!Array.isArray(products) || !Array.isArray(priorLinks) || !Array.isArray(managerLinks)) {
    throw new TypeError("Active products and source links are required.");
  }
  return mapRowsToProducts(rows, products, priorLinks, managerLinks);
}

export const workbookCapacityImportLimits = Object.freeze({
  maxBytes: MAX_WORKBOOK_BYTES,
  maxRows: MAX_ROWS,
});
