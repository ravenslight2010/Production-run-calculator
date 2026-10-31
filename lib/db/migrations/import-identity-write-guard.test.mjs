import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migration = await readFile(
  new URL("./0003_serial_to_identity.sql", import.meta.url),
  "utf8",
);
const convertedColumns = new Set(
  [...migration.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/gu)].map(
    ([, tableName, columnName]) => `${tableName}.${columnName}`,
  ),
);

function matchingBrace(source, openIndex) {
  let depth = 0;
  let state = "code";
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "single-quote" || state === "double-quote" || state === "template") {
      const closing = { "single-quote": "'", "double-quote": '"', template: "`" }[state];
      if (character === "\\") index += 1;
      else if (character === closing) state = "code";
      continue;
    }
    if (character === "/" && next === "/") {
      state = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
    } else if (character === "'") {
      state = "single-quote";
    } else if (character === '"') {
      state = "double-quote";
    } else if (character === "`") {
      state = "template";
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed object at offset ${openIndex}`);
}

function objectAt(source, startIndex) {
  const openIndex = source.indexOf("{", startIndex);
  assert.notEqual(openIndex, -1, "expected an object literal");
  return source.slice(openIndex, matchingBrace(source, openIndex) + 1);
}

function insertPayloads(source, tableName) {
  const payloads = [];
  const pattern = new RegExp(
    `\\.(?:insert)\\(${tableName}\\)\\.values\\(`,
    "gu",
  );
  for (const match of source.matchAll(pattern)) {
    const argumentStart = match.index + match[0].length;
    let depth = 1;
    let state = "code";
    for (let index = argumentStart; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (state === "line-comment") {
        if (character === "\n") state = "code";
        continue;
      }
      if (state === "block-comment") {
        if (character === "*" && next === "/") {
          state = "code";
          index += 1;
        }
        continue;
      }
      if (state === "single-quote" || state === "double-quote" || state === "template") {
        const closing = { "single-quote": "'", "double-quote": '"', template: "`" }[state];
        if (character === "\\") index += 1;
        else if (character === closing) state = "code";
        continue;
      }
      if (character === "/" && next === "/") {
        state = "line-comment";
        index += 1;
      } else if (character === "/" && next === "*") {
        state = "block-comment";
        index += 1;
      } else if (character === "'") {
        state = "single-quote";
      } else if (character === '"') {
        state = "double-quote";
      } else if (character === "`") {
        state = "template";
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          payloads.push(source.slice(argumentStart, index).trim());
          break;
        }
      }
    }
  }
  return payloads;
}

function assertPayloadDoesNotSupplyGeneratedId(payload, description) {
  assert.doesNotMatch(
    payload,
    /(?:^|[,{]\s*)id\s*:/u,
    `${description} must not explicitly supply a generated ID`,
  );
  assert.doesNotMatch(
    payload,
    /\.\.\.|^\s*\[/u,
    `${description} must not spread or compute an unfiltered identity payload`,
  );
}

function tableIdentifier(tableName) {
  return `${tableName.replace(/_([a-z])/gu, (_match, letter) => letter.toUpperCase())}Table`;
}

test("import writers do not supply IDs to converted identity columns", async () => {
  assert.equal(convertedColumns.size, 37, "guard follows all converted identity columns");
  assert.ok(convertedColumns.has("import_history.id"));
  assert.ok(convertedColumns.has("spec_import_aliases.id"));
  assert.ok(!convertedColumns.has("inventory_settings.id"), "inventory settings ID is not converted");

  const operationsPath = `${repoRoot}/artifacts/api-server/src/routes/importOperations.ts`;
  const historyPath = `${repoRoot}/artifacts/api-server/src/routes/importHistory.ts`;
  const operations = await readFile(operationsPath, "utf8");
  const history = await readFile(historyPath, "utf8");

  const tableRegistryStart = operations.indexOf("const TABLES =");
  assert.notEqual(tableRegistryStart, -1, "import table registry must remain explicit");
  const tableRegistry = objectAt(operations, tableRegistryStart);
  for (const column of convertedColumns) {
    const [tableName] = column.split(".");
    assert.doesNotMatch(
      tableRegistry,
      new RegExp(`\\b${tableIdentifier(tableName)}\\b`, "u"),
      `${tableName} must not enter the generic import/snapshot writer without a filtered identity payload`,
    );
  }

  const historyInsertPayloads = [
    ...insertPayloads(operations, "importHistoryTable"),
    ...insertPayloads(history, "importHistoryTable"),
  ];
  assert.equal(historyInsertPayloads.length, 2, "all import-history inserts are inspected");
  for (const [index, payload] of historyInsertPayloads.entries()) {
    const objectPayload = payload.startsWith("{")
      ? payload
      : objectAt(history, history.indexOf("const values ="));
    assertPayloadDoesNotSupplyGeneratedId(objectPayload, `import-history insert ${index + 1}`);
  }

  const aliasInsertPayloads = insertPayloads(operations, "specImportAliasesTable");
  assert.equal(aliasInsertPayloads.length, 2, "both spec-alias insert paths are inspected");
  assertPayloadDoesNotSupplyGeneratedId(aliasInsertPayloads[0], "new spec-alias insert");
  assert.match(
    operations,
    /delete value\.id;[\s\S]*?\.insert\(specImportAliasesTable\)\.values\(value\)/u,
    "restoring an alias snapshot must remove its generated ID before insertion",
  );

  // Text-keyed operation IDs remain supported; this guard concerns only the
  // numeric identity columns listed by the conversion migration.
  assert.match(
    operations,
    /\.insert\(importOperationsTable\)\.values\(\{[\s\S]*?\bid:\s*operationId/u,
    "text-keyed import operation IDs remain valid",
  );
});
