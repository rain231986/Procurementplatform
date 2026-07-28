import test from "node:test";
import assert from "node:assert/strict";
import { getProductIdentifiers, upsertProductIdentifier } from "../supplier-operations-workflow.js";

const actor = (role, extra = {}) => ({
  actor: { id: `${role.toLowerCase()}-user`, role, isActive: true },
  actorId: `${role.toLowerCase()}-user`,
  actorRole: role,
  changedAt: "2026-07-28T09:00:00+08:00",
  createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
  ...extra,
});

const commit = (result) => { assert.equal(result.committed, true, result.error?.message); return result.state; };
const fail = (result) => { assert.equal(result.committed, false); return result; };

function fixture() {
  return {
    products: [
      { id: "p1", productCode: "P-1", name: "商品一", specification: "10盒", baseUnit: "盒", isActive: true },
      { id: "p2", productCode: "P-2", name: "商品二", specification: "10盒", baseUnit: "盒", isActive: true },
    ],
    suppliers: [],
    supplierProducts: [],
    productIdentifiers: [],
    auditLogs: [],
  };
}

test("a product specification supports six extensible identifier slots", () => {
  let state = fixture();
  const values = ["04710001000001", "4710001000001", "710001000001", "49123456", "maker-001", "other-001"];
  const types = ["GTIN14", "EAN13", "UPCA", "JAN", "MANUFACTURER_ITEM_CODE", "OTHER"];
  values.forEach((value, index) => {
    state = commit(upsertProductIdentifier(state, { ...actor(index % 2 ? "WAREHOUSE" : "PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: index + 1, identifierType: types[index], value, isPrimary: index === 0 }));
  });
  const rows = getProductIdentifiers(state, "p1", { role: "PURCHASING" }, "10盒");
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((row) => row.slotNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(rows.filter((row) => row.isPrimary).length, 1);
});

test("the seventh active identifier and duplicate slot are rejected", () => {
  let state = fixture();
  for (let slot = 1; slot <= 6; slot += 1) state = commit(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: slot, identifierType: "MANUFACTURER_ITEM_CODE", value: `maker-${slot}` }));
  fail(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: 7, identifierType: "MANUFACTURER_ITEM_CODE", value: "maker-7" }));
  fail(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: 1, identifierType: "MANUFACTURER_ITEM_CODE", value: "maker-other" }));
});

test("the same identifier cannot bind another product or specification", () => {
  let state = commit(upsertProductIdentifier(fixture(), { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: 1, identifierType: "MANUFACTURER_ITEM_CODE", value: "SHARED-001" }));
  fail(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p2", specificationKey: "10盒", slotNumber: 1, identifierType: "MANUFACTURER_ITEM_CODE", value: "SHARED-001" }));
  fail(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", specificationKey: "20盒", slotNumber: 1, identifierType: "MANUFACTURER_ITEM_CODE", value: "SHARED-001" }));
});

test("primary switching is scoped to product and specification", () => {
  let state = commit(upsertProductIdentifier(fixture(), { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: 1, identifierType: "MANUFACTURER_ITEM_CODE", value: "P1-A", isPrimary: true }));
  state = commit(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: 2, identifierType: "MANUFACTURER_ITEM_CODE", value: "P1-B", isPrimary: false }));
  const second = state.productIdentifiers.find((row) => row.slotNumber === 2);
  state = commit(upsertProductIdentifier(state, { ...actor("WAREHOUSE"), id: second.id, productId: "p1", specificationKey: "10盒", slotNumber: 2, identifierType: "MANUFACTURER_ITEM_CODE", value: "P1-B", isPrimary: true }));
  const rows = getProductIdentifiers(state, "p1", { role: "PURCHASING" }, "10盒");
  assert.equal(rows.find((row) => row.slotNumber === 1).isPrimary, false);
  assert.equal(rows.find((row) => row.slotNumber === 2).isPrimary, true);
  assert.ok(state.auditLogs.some((log) => log.action === "PRODUCT_IDENTIFIER_UPDATED"));
});

test("stores can read safe identifiers but cannot maintain them", () => {
  const state = commit(upsertProductIdentifier(fixture(), { ...actor("PURCHASING"), productId: "p1", specificationKey: "10盒", slotNumber: 1, identifierType: "EAN13", value: "4710001000001", note: "內部備註" }));
  const visible = getProductIdentifiers(state, "p1", { role: "STORE", locationId: "store1" }, "10盒");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].note, undefined);
  fail(upsertProductIdentifier(state, { ...actor("STORE", { locationId: "store1" }), productId: "p1", specificationKey: "10盒", slotNumber: 2, identifierType: "EAN13", value: "4710001000002" }));
});
