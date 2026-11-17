import assert from "node:assert/strict";
import test from "node:test";
import { buildAllowlistedCutoverBatch } from "./cutover-transform.mjs";

const sample = {
  products: [
    { code: "CUT-PIZZA", name: "Synthetic Pizza", unit: "case" },
    { code: "CUT-FLOUR", name: "Synthetic Flour", unit: "lb" },
    { code: "CUT-BOX", name: "Synthetic Carton", unit: "each" },
  ],
  recipes: [{
    code: "CUT-DOUGH",
    name: "Synthetic Dough",
    productCode: "CUT-PIZZA",
    data: {
      station_key: "dough",
      ingredients: [{ product_code: "CUT-FLOUR", quantity: 12, unit: "lb" }],
    },
  }],
  productionSetups: [{
    code: "CUT-LINE",
    name: "Synthetic Line",
    productCode: "CUT-PIZZA",
    data: {
      recipe_codes: ["CUT-DOUGH"],
      packaging_per_case: [{ product_code: "CUT-BOX", quantity: 1, unit: "each" }],
    },
  }],
  staff: [
    { username: "CutoverOperator", disabled: false, roleName: "operator" },
  ],
};

test("allowlisted cutover projection returns only approved fields and stable ordering", () => {
  const result = buildAllowlistedCutoverBatch(sample);
  assert.deepEqual(Object.keys(result), ["products", "recipes", "productionSetups", "staff"]);
  assert.deepEqual(result.products.map(({ code }) => code), ["CUT-BOX", "CUT-FLOUR", "CUT-PIZZA"]);
  assert.deepEqual(result.recipes, sample.recipes);
  assert.deepEqual(result.productionSetups, sample.productionSetups);
  assert.deepEqual(result.staff, sample.staff);
});

test("output is deterministic for every permutation of a three-product input", () => {
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const results = permutations.map((order) => buildAllowlistedCutoverBatch({
    ...sample,
    products: order.map((index) => sample.products[index]),
  }));
  for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
});

test("rejects password, session, stock, and unsupported setup fields", () => {
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    staff: [{ ...sample.staff[0], passwordHash: "must-not-cross" }],
  }), /unsupported field passwordHash/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    products: [{ ...sample.products[0], quantity: 500 }],
  }), /unsupported field quantity/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    staff: [{ ...sample.staff[0], sessionToken: "must-not-cross" }],
  }), /unsupported field sessionToken/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    productionSetups: [{
      ...sample.productionSetups[0],
      data: { ...sample.productionSetups[0].data, openingCount: 400 },
    }],
  }), /unsupported field openingCount/);
});

test("rejects ambiguous duplicate codes and usernames instead of merging", () => {
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    products: [
      ...sample.products,
      { code: "cut-pizza", name: "Another pizza", unit: "case" },
    ],
  }), /case-insensitive duplicate code/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    staff: [
      ...sample.staff,
      { username: "cutoveroperator", disabled: false, roleName: "operator" },
    ],
  }), /case-insensitive duplicate username/);
});

test("rejects unmapped references, incompatible units, and custom roles", () => {
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    recipes: [{
      ...sample.recipes[0],
      data: { ...sample.recipes[0].data, ingredients: [
        { product_code: "UNKNOWN", quantity: 12, unit: "lb" },
      ] },
    }],
  }), /unknown ingredient product/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    recipes: [{
      ...sample.recipes[0],
      data: { ...sample.recipes[0].data, ingredients: [
        { product_code: "CUT-FLOUR", quantity: 12, unit: "kg" },
      ] },
    }],
  }), /unit does not match/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    staff: [{ ...sample.staff[0], roleName: "inventory-manager" }],
  }), /not a V2 built-in role/);
  assert.throws(() => buildAllowlistedCutoverBatch({
    ...sample,
    productionSetups: [{
      ...sample.productionSetups[0],
      data: {
        ...sample.productionSetups[0].data,
        recipe_codes: ["CUT-DOUGH", "cut-dough"],
      },
    }],
  }), /duplicate recipe reference/);
});
