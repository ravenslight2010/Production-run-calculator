const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UNIT_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,15}$/;
const USERNAME_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;
const STATIONS = new Set(["dough", "cheese", "pepperoni", "sauce", "frontline"]);
const ROLES = new Set(["manager", "operator"]);

function compareFolded(a, b) {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new TypeError(`Invalid cutover projection: ${message}`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function requireRecord(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  const extra = keys.find((key) => !allowedKeys.includes(key));
  if (extra) fail(`${label} contains unsupported field ${extra}`);
  const missing = allowedKeys.find((key) => !Object.hasOwn(value, key));
  if (missing) fail(`${label} is missing ${missing}`);
}

function requireText(value, label, pattern = null, maxLength = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  if (value.length > maxLength) fail(`${label} is too long`);
  if (pattern && !pattern.test(value)) fail(`${label} has an unsupported format`);
  return value;
}

function uniqueByCode(rows, label) {
  const seen = new Set();
  for (const row of rows) {
    const key = row.code.toLowerCase();
    if (seen.has(key)) fail(`${label} contains a case-insensitive duplicate code`);
    seen.add(key);
  }
}

function indexByCode(rows) {
  return new Map(rows.map((row) => [row.code.toLowerCase(), row]));
}

function normalizeProducts(input) {
  const products = requireArray(input, "products").map((record, index) => {
    requireRecord(record, `products[${index}]`, ["code", "name", "unit"]);
    const code = requireText(record.code, `products[${index}].code`, CODE_PATTERN);
    const name = requireText(record.name, `products[${index}].name`, null, 120);
    const unit = requireText(record.unit, `products[${index}].unit`, UNIT_PATTERN).toLowerCase();
    return { code, name, unit };
  });
  uniqueByCode(products, "products");
  return products.sort((a, b) => compareFolded(a.code, b.code));
}

function normalizeRecipes(input, productsByCode) {
  const recipes = requireArray(input, "recipes").map((record, index) => {
    requireRecord(record, `recipes[${index}]`, ["code", "name", "productCode", "data"]);
    const code = requireText(record.code, `recipes[${index}].code`, CODE_PATTERN);
    const name = requireText(record.name, `recipes[${index}].name`, null, 120);
    const productCode = requireText(record.productCode, `recipes[${index}].productCode`, CODE_PATTERN);
    if (!productsByCode.has(productCode.toLowerCase())) {
      fail(`recipe ${code} references an unknown product`);
    }
    requireRecord(record.data, `recipes[${index}].data`, ["station_key", "ingredients"]);
    if (!STATIONS.has(record.data.station_key)) fail(`recipe ${code} has an unsupported station`);
    const ingredients = requireArray(record.data.ingredients, `recipe ${code} ingredients`)
      .map((line, lineIndex) => {
        requireRecord(line, `recipe ${code} ingredients[${lineIndex}]`, ["product_code", "quantity", "unit"]);
        const product_code = requireText(
          line.product_code,
          `recipe ${code} ingredients[${lineIndex}].product_code`,
          CODE_PATTERN,
        );
        const product = productsByCode.get(product_code.toLowerCase());
        if (!product) fail(`recipe ${code} references an unknown ingredient product`);
        const quantity = line.quantity;
        if (
          typeof quantity !== "number"
          || !Number.isFinite(quantity)
          || quantity <= 0
          || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(String(quantity))
        ) {
          fail(`recipe ${code} ingredient quantity must be a positive finite number`);
        }
        const unit = requireText(line.unit, `recipe ${code} ingredient unit`, UNIT_PATTERN).toLowerCase();
        if (unit !== product.unit) fail(`recipe ${code} ingredient unit does not match its product`);
        return { product_code: product.code, quantity, unit };
      });
    if (ingredients.length === 0 || ingredients.length > 200) {
      fail(`recipe ${code} must contain between one and 200 ingredients`);
    }
    return {
      code,
      name,
      productCode: productsByCode.get(productCode.toLowerCase()).code,
      data: { station_key: record.data.station_key, ingredients },
    };
  });
  uniqueByCode(recipes, "recipes");
  return recipes.sort((a, b) => compareFolded(a.code, b.code));
}

function normalizeSetups(input, productsByCode, recipesByCode) {
  const setups = requireArray(input, "productionSetups").map((record, index) => {
    requireRecord(record, `productionSetups[${index}]`, ["code", "name", "productCode", "data"]);
    const code = requireText(record.code, `productionSetups[${index}].code`, CODE_PATTERN);
    const name = requireText(record.name, `productionSetups[${index}].name`, null, 120);
    const productCode = requireText(record.productCode, `productionSetups[${index}].productCode`, CODE_PATTERN);
    const product = productsByCode.get(productCode.toLowerCase());
    if (!product) fail(`setup ${code} references an unknown product`);
    requireRecord(record.data, `productionSetups[${index}].data`, ["recipe_codes", "packaging_per_case"]);

    const recipeCodes = requireArray(record.data.recipe_codes, `setup ${code} recipe_codes`)
      .map((recipeCode) => {
        const normalized = requireText(recipeCode, `setup ${code} recipe code`, CODE_PATTERN);
        const recipe = recipesByCode.get(normalized.toLowerCase());
        if (!recipe) fail(`setup ${code} references an unknown recipe`);
        if (recipe.productCode.toLowerCase() !== product.code.toLowerCase()) {
          fail(`setup ${code} references a recipe for a different product`);
        }
        return recipe.code;
      });
    if (recipeCodes.length === 0 || recipeCodes.length > 20) {
      fail(`setup ${code} must reference between one and 20 recipes`);
    }
    if (new Set(recipeCodes.map((recipeCode) => recipeCode.toLowerCase())).size !== recipeCodes.length) {
      fail(`setup ${code} contains a duplicate recipe reference`);
    }

    const packaging = requireArray(
      record.data.packaging_per_case,
      `setup ${code} packaging_per_case`,
    ).map((line, lineIndex) => {
      requireRecord(line, `setup ${code} packaging[${lineIndex}]`, ["product_code", "quantity", "unit"]);
      const product_code = requireText(
        line.product_code,
        `setup ${code} packaging[${lineIndex}].product_code`,
        CODE_PATTERN,
      );
      const packagingProduct = productsByCode.get(product_code.toLowerCase());
      if (!packagingProduct) fail(`setup ${code} references an unknown packaging product`);
      if (
        typeof line.quantity !== "number"
        || !Number.isFinite(line.quantity)
        || line.quantity <= 0
        || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(String(line.quantity))
      ) {
        fail(`setup ${code} packaging quantity must be a positive finite number`);
      }
      const unit = requireText(line.unit, `setup ${code} packaging unit`, UNIT_PATTERN).toLowerCase();
      if (unit !== packagingProduct.unit) fail(`setup ${code} packaging unit does not match its product`);
      return { product_code: packagingProduct.code, quantity: line.quantity, unit };
    });
    if (packaging.length === 0 || packaging.length > 200) {
      fail(`setup ${code} must contain between one and 200 packaging lines`);
    }
    return {
      code,
      name,
      productCode: product.code,
      data: { recipe_codes: recipeCodes, packaging_per_case: packaging },
    };
  });
  uniqueByCode(setups, "productionSetups");
  return setups.sort((a, b) => compareFolded(a.code, b.code));
}

function normalizeStaff(input) {
  const staff = requireArray(input, "staff").map((record, index) => {
    requireRecord(record, `staff[${index}]`, ["username", "disabled", "roleName"]);
    const username = requireText(record.username, `staff[${index}].username`);
    if (
      !USERNAME_PATTERN.test(username)
      || username.trim() !== username
      || username.length < 3
      || username.length > 40
    ) {
      fail(`staff[${index}].username has an unsupported format`);
    }
    if (typeof record.disabled !== "boolean") fail(`staff[${index}].disabled must be boolean`);
    if (!ROLES.has(record.roleName)) fail(`staff[${index}].roleName is not a V2 built-in role`);
    return { username, disabled: record.disabled, roleName: record.roleName };
  });
  const seen = new Set();
  for (const record of staff) {
    const key = record.username.toLowerCase();
    if (seen.has(key)) fail("staff contains a case-insensitive duplicate username");
    seen.add(key);
  }
  return staff.sort((a, b) => compareFolded(a.username, b.username));
}

/**
 * Validate and deterministically order an already-reviewed V1-to-V2 mapping.
 * This function does not read a database, infer source mappings, or write rows.
 */
export function buildAllowlistedCutoverBatch(input) {
  requireRecord(input, "batch", ["products", "recipes", "productionSetups", "staff"]);
  const products = normalizeProducts(input.products);
  const productsByCode = indexByCode(products);
  const recipes = normalizeRecipes(input.recipes, productsByCode);
  const recipesByCode = indexByCode(recipes);
  const productionSetups = normalizeSetups(input.productionSetups, productsByCode, recipesByCode);
  const staff = normalizeStaff(input.staff);
  return { products, recipes, productionSetups, staff };
}
