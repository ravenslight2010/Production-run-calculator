import assert from "node:assert/strict";
import test from "node:test";
import {
  importCsvLimits,
  ImportCsvError,
  parseOpeningCountCsv,
  parseSetupImportCsv,
} from "./import-csv.mjs";
import {
  openingCountCsvTemplate,
  renderImportCsvTemplate,
  setupImportCsvTemplates,
} from "./import-csv-templates.mjs";

const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;

test("product CSV accepts an optional BOM, CRLF, and trims user-facing names", () => {
  const result = parseSetupImportCsv(
    "products",
    "\uFEFFcode,name,unit\r\nFLOUR,\"Bread, \"\"Strong\"\"\",lb\r\n",
  );
  assert.deepEqual(result, [{ code: "FLOUR", name: 'Bread, "Strong"', unit: "lb" }]);
});

test("recipe and production setup rows require JSON objects", () => {
  const recipes = parseSetupImportCsv(
    "recipes",
    'code,name,product_code,definition_json\nBASE,Base dough,FLOUR,"{""hydration"":0.62}"\n',
  );
  assert.deepEqual(recipes[0], {
    code: "BASE",
    name: "Base dough",
    productCode: "FLOUR",
    data: { hydration: 0.62 },
  });
  assert.throws(
    () => parseSetupImportCsv("production-setups", "code,name,product_code,config_json\nLINE,Line,FLOUR,[]\n"),
    (error) => error instanceof ImportCsvError && error.field === "config_json",
  );
});

test("download templates parse with canonical headers and synthetic example rows", () => {
  for (const [kind, template] of Object.entries(setupImportCsvTemplates)) {
    const csv = renderImportCsvTemplate(template);
    const records = parseSetupImportCsv(kind, csv);
    assert.equal(records.length, template.rows.length);
    assert.match(csv, /TEMPLATE-/u);
  }

  const productCodes = setupImportCsvTemplates.products.rows.map(([code]) => code);
  const countCsv = renderImportCsvTemplate(openingCountCsvTemplate);
  const counts = parseOpeningCountCsv(countCsv, productCodes);
  assert.deepEqual(counts.map(({ productCode, quantity }) => [productCode, quantity]), [
    ["TEMPLATE-PIZZA", "0"],
    ["TEMPLATE-FLOUR", "0"],
    ["TEMPLATE-BOX", "0"],
  ]);
  assert.deepEqual(openingCountCsvTemplate.rows.map(([code]) => code), productCodes);
});

test("rejects malformed headers, duplicate keys, broken quoting, and oversized files", () => {
  const invalidCases = [
    ["products", "name,code,unit\nFlour,FLOUR,lb\n", /exactly these CSV columns/],
    ["products", "code,name,unit\nA,Flour,lb\na,Meal,lb\n", /only once/],
    ["products", 'code,name,unit\nA,"Flour,lb\n', /not closed/],
    ["products", "code,name,unit\nA,Flour,lb\nB,Meal\n", /same number of columns/],
    ["products", "code,name,unit\nA,Flour,lb\n", null],
  ];
  for (const [kind, csv, message] of invalidCases.slice(0, 4)) {
    assert.throws(() => parseSetupImportCsv(kind, csv), message);
  }
  assert.throws(
    () => parseSetupImportCsv("products", `code,name,unit\nA,${"x".repeat(importCsvLimits.maxBytes)},lb\n`),
    /1 MiB or smaller/,
  );
});

test("opening count requires each active product exactly once with explicit zero quantities", () => {
  const counts = parseOpeningCountCsv(
    "product_code,quantity\nFLOUR,125.5\nCHEESE,0\n",
    ["FLOUR", "CHEESE"],
  );
  assert.deepEqual(counts, [
    { productCode: "FLOUR", quantity: "125.5" },
    { productCode: "CHEESE", quantity: "0" },
  ]);
  assert.throws(
    () => parseOpeningCountCsv("product_code,quantity\nFLOUR,1\n", ["FLOUR", "CHEESE"]),
    /Count every active product/,
  );
  assert.throws(
    () => parseOpeningCountCsv("product_code,quantity\nFLOUR,-1\nCHEESE,0\n", ["FLOUR", "CHEESE"]),
    /non-negative quantity/,
  );
  assert.throws(
    () => parseOpeningCountCsv("product_code,quantity\nFLOUR,1\nCHEESE,0\n", ["FLOUR", "CHEESE", "OIL"]),
    /Count every active product/,
  );
});

test("CSV quoting round-trips generated names without changing row boundaries", () => {
  let state = 0x5eed1234;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  const alphabet = ["Plain", "comma, inside", 'a "quoted" word', "spaces inside", "prefix"];
  for (let sample = 0; sample < 100; sample += 1) {
    const name = `${alphabet[next() % alphabet.length]} ${alphabet[next() % alphabet.length]}`;
    const csv = `code,name,unit\n${csvCell(`P${sample}`)},${csvCell(name)},lb\n`;
    assert.equal(parseSetupImportCsv("products", csv)[0].name, name);
  }
  assert.throws(
    () => parseSetupImportCsv("products", 'code,name,unit\nP1,"two\nlines",lb\n'),
    /without control characters/,
  );
});
