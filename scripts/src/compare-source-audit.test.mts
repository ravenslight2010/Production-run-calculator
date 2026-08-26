import assert from "node:assert/strict";
import path from "node:path";
import {
  parseDoughRows,
  parseDoughWorkbook,
  parseSauceRows,
  parseSauceWorkbook,
} from "./compare-source-audit.mts";

type Row = unknown[];

const retained = (kind: "dough" | "sauce", name: string) =>
  path.resolve(
    process.cwd(),
    "..",
    "attached_assets",
    "source-library",
    kind,
    name,
  );

const componentAmounts = (components: Array<{ ingredient: string; lbs: number }>) =>
  new Map(components.map((component) => [component.ingredient, component.lbs]));

function testDoughNumericAnnotatedAndVariants() {
  const rows: Row[] = [
    ["FIXTURE DOUGH"],
    ["LBS.", "2 Bag", "4 Bag"],
    ["ADM FLOUR", 100, "200 (four bag target)", 250],
    ["WATER", 38.7, "77.4 (tested)", 96.75],
    ["TOTAL WEIGHT", 138.7, 277.4, 346.75],
    ["", "OZ.", "LBS.", "PER TRAY"],
    ["7-inch dough", 6.2, 0.39, 24],
  ];
  const parsed = parseDoughRows(
    rows,
    "/fixtures/Brand_Dough_Mixing_Procedure_-_08_1784339683868.xlsx",
  );

  assert.equal(parsed.name, "Brand Dough");
  assert.deepEqual([...componentAmounts(parsed.components)], [
    ["ADM FLOUR", 200],
    ["WATER", 77.4],
  ]);
  assert.deepEqual(parsed.doughballVariants, [
    { label: "7-inch dough", weightOz: 6.2, perTray: 24 },
  ]);
}

function testDoughInstructionOnlyAmount() {
  const rows: Row[] = [
    ["FIXTURE FRENCH FRY DOUGH"],
    ["LBS."],
    ["WHEAT FLOUR", 200],
    ["25029 FRENCH FRIES", " "],
    ["WATER", 101.5],
    ["TOTAL", 301.5],
    ["1. ADD 18 LB (4 BAGS) OF FRENCH FRIES TO THE MIXING BOWL."],
    ["", "OZ.", "LBS.", "PER TRAY"],
    ["French fry dough", 15, 0.99, 15],
  ];
  const parsed = parseDoughRows(
    rows,
    "/fixtures/Lowe's_French_Fry_Dough_Mixing_Procedure_-_03_1784339683985.xlsx",
  );

  assert.equal(parsed.name, "Lowe's French Fry Dough");
  assert.equal(componentAmounts(parsed.components).get("25029 FRENCH FRIES"), 18);
  assert.deepEqual(parsed.doughballVariants, [
    { label: "French fry dough", weightOz: 15, perTray: 15 },
  ]);
}

function testSauceNumericAnnotatedAndMultiBatch() {
  const rows: Row[] = [
    ["Ingredients:"],
    ["Water", "1.5 (tested)", "qt"],
    ["Oil", 2, "lbs"],
    ["TOTAL", 3.5],
  ];
  const parsed = parseSauceRows(
    rows,
    "/fixtures/Alfredo_Pizza_Sauce_07_1784339519130.xlsx",
  );
  assert.equal(parsed.name, "Alfredo Sauce");
  assert.deepEqual([...componentAmounts(parsed.components)], [
    ["Water", 1.5],
    ["Oil", 2],
  ]);

  const multiBatchRows: Row[] = [
    ["Tika Masala Sauce"],
    ["Ingredients:", "", "", "", "", "", "", "Batches"],
    ["Water", "", 28, "qt", "", "", "", 639.468, "", 106.578, "Water", 0.3947],
    ["Oil", "", 10, "lbs", "", "", "", 60, "", 10, "Oil", 0.037],
    ["TOTAL", "", "", "", "", "", "", 699.468],
    ["Process"],
  ];
  const multiBatch = parseSauceRows(
    multiBatchRows,
    "/fixtures/Tikka_Masala_Process_1784339520201.xlsx",
  );
  assert.equal(multiBatch.name, "Tika Masala Sauce");
  assert.deepEqual([...componentAmounts(multiBatch.components)], [
    ["Water", 106.578],
    ["Oil", 10],
  ]);
}

function testSauceSideBySideTestedTable() {
  const rows: Row[] = [
    ["MATERIALS"],
    ["", "", "", "", "Red Hot Sauce", 48, "lb"],
    ["", "", "", "", "Franks Hot Sauce", 145, "lb"],
    ["All Ingredients are to be weighed, not measured in cups"],
  ];
  const parsed = parseSauceRows(
    rows,
    "/fixtures/Four_Hands_Red_Hot_Pizza_Sauce_-_03_1784339519513.xlsx",
  );
  assert.equal(parsed.name, "Red Hot Pizza Sauce");
  assert.deepEqual([...componentAmounts(parsed.components)], [
    ["Red Hot Sauce", 48],
    ["Franks Hot Sauce", 145],
  ]);
}

function testUnrecognizedLayoutsFailClosed() {
  assert.throws(
    () =>
      parseDoughRows(
        [
          ["FIXTURE DOUGH"],
          ["LBS."],
          ["FLOUR", "not an amount"],
          ["TOTAL"],
        ],
        "/fixtures/Brand_Dough_Mixing_Procedure_-_08_1784339683868.xlsx",
      ),
    /Unable to parse dough amount/,
  );
  assert.throws(
    () =>
      parseSauceRows(
        [
          ["Ingredients:"],
          ["Known ingredient", 2],
          ["Mystery ingredient", "not an amount"],
          ["Process"],
        ],
        "/fixtures/Alfredo_Pizza_Sauce_07_1784339519130.xlsx",
      ),
    /Unable to parse sauce amount/,
  );
}

function testRepresentativeRetainedWorkbooks() {
  const dough = parseDoughWorkbook(
    retained(
      "dough",
      "Malted_Barley_Dough_Mixing_Procedure_-_29_1784339684152.xlsx",
    ),
  );
  assert.equal(dough.name, "Malted Barley Dough");
  assert.equal(componentAmounts(dough.components).get("ADM WHEAT FLOUR"), 200);
  assert.deepEqual(dough.doughballVariants, [
    {
      label: "LOWE'S, HANNAFORD, LUCIA CRAFT, NOB HILL CRAFT Thick (Argus)",
      weightOz: 13.8,
      perTray: 16,
    },
  ]);

  const frenchFry = parseDoughWorkbook(
    retained(
      "dough",
      "Lowe's_French_Fry_Dough_Mixing_Procedure_-_03_1784339683985.xlsx",
    ),
  );
  assert.equal(
    componentAmounts(frenchFry.components).get("25029 FRENCH FRIES"),
    18,
  );

  const tikka = parseSauceWorkbook(
    retained("sauce", "Tikka_Masala_Process_1784339520201.xlsx"),
  );
  assert.equal(tikka.name, "Tika Masala Sauce");
  assert.equal(componentAmounts(tikka.components).get("Water"), 106.57800000000002);

  const tested = parseSauceWorkbook(
    retained(
      "sauce",
      "Four_Hands_Red_Hot_Pizza_Sauce_-_03_1784339519513.xlsx",
    ),
  );
  assert.equal(tested.name, "Red Hot Pizza Sauce");
  assert.equal(componentAmounts(tested.components).get("Franks Hot Sauce"), 145);
}

testDoughNumericAnnotatedAndVariants();
testDoughInstructionOnlyAmount();
testSauceNumericAnnotatedAndMultiBatch();
testSauceSideBySideTestedTable();
testUnrecognizedLayoutsFailClosed();
testRepresentativeRetainedWorkbooks();
console.log("Source audit parser fixture tests passed.");
