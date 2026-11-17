const definition = (fileName, headers, rows) => Object.freeze({
  fileName,
  headers: Object.freeze(headers),
  rows: Object.freeze(rows.map((row) => Object.freeze(row))),
});

export const setupImportCsvTemplates = Object.freeze({
  products: definition("products-template.csv", ["code", "name", "unit"], [
    ["TEMPLATE-PIZZA", "Example Finished Product", "case"],
    ["TEMPLATE-FLOUR", "Example All-purpose Flour", "lb"],
    ["TEMPLATE-BOX", "Example Case Carton", "each"],
  ]),
  recipes: definition("recipes-template.csv", ["code", "name", "product_code", "definition_json"], [
    ["TEMPLATE-DOUGH", "Example Dough Recipe", "TEMPLATE-PIZZA", JSON.stringify({
      station_key: "dough",
      ingredients: [{ product_code: "TEMPLATE-FLOUR", quantity: 100, unit: "lb" }],
    })],
  ]),
  "production-setups": definition("production-setups-template.csv", ["code", "name", "product_code", "config_json"], [
    ["TEMPLATE-LINE", "Example Production Line", "TEMPLATE-PIZZA", JSON.stringify({
      recipe_codes: ["TEMPLATE-DOUGH"],
      packaging_per_case: [{ product_code: "TEMPLATE-BOX", quantity: 1, unit: "each" }],
    })],
  ]),
});

export const openingCountCsvTemplate = definition("opening-count-template.csv", ["product_code", "quantity"], [
  ["TEMPLATE-PIZZA", "0"],
  ["TEMPLATE-FLOUR", "0"],
  ["TEMPLATE-BOX", "0"],
]);

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderImportCsvTemplate(template) {
  const rows = [template.headers, ...template.rows];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
