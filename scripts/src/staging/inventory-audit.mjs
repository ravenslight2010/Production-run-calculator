import assert from "node:assert/strict";
import { digest } from "./identity.mjs";

export async function inventoryDigest(stage) {
  await stage.preflight();
  const tables = await stage.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'inventory\\_%' ORDER BY tablename",
  );
  const snapshot = [];
  for (const { tablename } of tables.rows) {
    assert.match(tablename, /^inventory_[a-z_]+$/);
    const { rows } = await stage.query(`SELECT row_to_json(t) AS row FROM "${tablename}" t`);
    snapshot.push([tablename, rows.map(({ row }) => JSON.stringify(row)).sort()]);
  }
  return digest(JSON.stringify(snapshot));
}

export async function seed(stage) {
  const credentials = stage.credentials;
  for (const role of ["manager", "operator"]) {
    const response = await stage.api("/auth/sign-up", {
      username: credentials[role].username, password: credentials[role].password,
      accessCode: role === "manager" ? credentials.managerCode : credentials.staffCode,
    }, null, 201);
    assert.equal(response.user.role, role);
    credentials[role].token = response.token;
  }
  const item = await stage.api("/inventory/items", {
    key: "ingredient:Stage Synthetic Flour:lbs", category: "ingredient",
    name: "Stage Synthetic Flour", unit: "lbs",
  }, credentials.manager.token, 201);
  await stage.api("/inventory/restock", {
    itemKey: item.key, category: "ingredient", name: item.name, unit: "lbs", qty: 10,
    lotNumber: "SYNTHETIC-STAGE-ONLY",
  }, credentials.manager.token, 200);
  stage.item = item;
  stage.record("synthetic-seed", "manager", "PASS");
}

export async function auditInventory(stage) {
  const { manager, operator } = stage.credentials;
  const { id } = stage.item;
  const before = await inventoryDigest(stage);
  const denied = [
    ["/inventory/items", { key: "denied", category: "ingredient", name: "Denied", unit: "lbs" }, "POST"],
    [`/inventory/items/${id}`, { name: "Denied rename" }, "PATCH"],
    [`/inventory/items/${id}`, undefined, "DELETE"],
    ["/inventory/adjust", { itemId: id, qtyDelta: 999, note: "Denied" }, "POST"],
    ["/inventory/settings", {}, "PUT"],
  ];
  for (const [path, body, method] of denied) {
    await stage.api(path, body, operator.token, 403, method);
    assert.equal(await inventoryDigest(stage), before);
    stage.record(`denial:${method}:${path.replace(String(id), ":item")}`, "operator", "PASS");
  }
  await stage.api("/inventory/adjust", { itemId: id, qtyDelta: 999 }, "invalid-stage-session", 401);
  assert.equal(await inventoryDigest(stage), before);
  await stage.api("/inventory/adjust", { itemId: id, qtyDelta: "invalid" }, manager.token, 400);
  assert.equal(await inventoryDigest(stage), before);
  stage.record("invalid-session-and-validation-no-write", "manager/operator", "PASS");
  const result = await stage.api("/inventory/adjust",
    { itemId: id, qtyDelta: 2, note: "Synthetic staging audit" }, manager.token, 200);
  assert.equal(result.onHand, 12);
  assert.notEqual(await inventoryDigest(stage), before);
  const totals = await stage.query("SELECT sum(qty_remaining)::float AS qty FROM inventory_lots WHERE item_id=$1", [id]);
  assert.equal(totals.rows[0].qty, 12);
  stage.record("authorized-adjustment-committed", "manager", "PASS");
  await stage.restart();
  const signedIn = await stage.api("/auth/sign-in",
    { username: manager.username, password: manager.password }, null, 200);
  manager.token = signedIn.token;
  const recovered = await stage.api("/inventory/adjust",
    { itemId: id, qtyDelta: 0 }, manager.token, 200);
  assert.equal(recovered.onHand, 12);
  await stage.api("/inventory/adjust",
    { itemId: id, qtyDelta: 1 }, operator.token, 403);
  stage.record("restart-signin-persistence-and-denial-recovery", "manager/operator", "PASS");
}
