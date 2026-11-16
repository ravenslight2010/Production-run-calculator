const definition = (fileName, headers, rows) => Object.freeze({
  fileName,
  headers: Object.freeze(headers),
  rows: Object.freeze(rows.map((row) => Object.freeze(row))),
});

export const setupImportCsvTemplates = Object.freeze({
  products: definition("products-template.csv", ["code", "name", "unit"], [
    ["TEMPLATE-FLOUR", "Example All-purpose Flour", "lb"],
    ["TEMPLATE-CHEESE", "Example Mozzarella", "lb"],
  ]),
  recipes: definition("recipes-template.csv", ["code", "name", "product_code", "definition_json"], [
    ["TEMPLATE-DOUGH", "Example Dough Recipe", "TEMPLATE-FLOUR", JSON.stringify({
      ingredients: [{ product_code: "TEMPLATE-FLOUR", quantity: 100, unit: "lb" }],
    })],
  ]),
  "production-setups": definition("production-setups-template.csv", ["code", "name", "product_code", "config_json"], [
    ["TEMPLATE-LINE", "Example Production Line", "TEMPLATE-FLOUR", JSON.stringify({
      stations: ["mix", "makeup"],
      cases_per_hour: 120,
    })],
  ]),
});

export const openingCountCsvTemplate = definition("opening-count-template.csv", ["product_code", "quantity"], [
  ["TEMPLATE-FLOUR", "0"],
  ["TEMPLATE-CHEESE", "0"],
]);

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderImportCsvTemplate(template) {
  const rows = [template.headers, ...template.rows];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
