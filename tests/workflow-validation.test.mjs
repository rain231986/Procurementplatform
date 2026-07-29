import test from "node:test";
import assert from "node:assert/strict";
import {
  getWorkflowBlockEventsForRole,
  recordWorkflowBlockEvents,
  resolveWorkflowBlockEvents,
  validateDemandOrderGate,
  validatePurchaseOrderGate,
} from "../workflow-validation.js";

const input = (role, extra = {}) => ({
  actor: { id: `${role.toLowerCase()}-user`, role, locationId: extra.locationId || null, isActive: true },
  actorId: `${role.toLowerCase()}-user`,
  actorRole: role,
  changedAt: "2026-07-28T09:00:00+08:00",
  createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
  ...extra,
});

function stateFixture() {
  return {
    products: [{ id: "p1", productCode: "P-1", name: "一般商品", baseUnit: "盒", isActive: true, procurementStatus: "PURCHASABLE" }],
    suppliers: [{ id: "s1", name: "供應商 A", isActive: true }],
    supplierProducts: [{ id: "sp1", productId: "p1", supplierId: "s1", isActive: true, isPrimary: true, purchasePrice: 10, minimumOrderQuantity: 1, purchaseMultiple: 1 }],
    storeOrderConditions: [],
    locations: [{ id: "store1", type: "STORE", isActive: true }, { id: "warehouse", type: "WAREHOUSE", isActive: true }],
    purchaseOrderItemStoreAllocations: [],
    workflowBlockEvents: [],
    workflowNotifications: [],
  };
}

function validDemand(overrides = {}) {
  return {
    id: "demand-1",
    locationId: "store1",
    status: "DRAFT",
    notes: "門市補貨需求",
    items: [{ id: "demand-item-1", productId: "p1", requestedQty: 3, reason: "近期銷售增加" }],
    ...overrides,
  };
}

function validOrder(overrides = {}) {
  return {
    id: "po-1",
    supplierId: "s1",
    orderingSupplierId: "s1",
    payeeSupplierId: "s1",
    status: "DRAFT",
    orderDate: "2026-07-28",
    expectedDeliveryDate: "2026-07-30",
    lines: [{ id: "po-line-1", productId: "p1", orderedQty: 2, unitPrice: 10, purchaseMultiple: 1, minimumOrderQuantity: 1 }],
    ...overrides,
  };
}

function validOrderState(order = validOrder()) {
  const state = stateFixture();
  state.purchaseOrders = [order];
  state.purchaseOrderItemStoreAllocations = [{ id: "plan-1", purchaseOrderId: order.id, purchaseOrderItemId: "po-line-1", deliveryMode: "SUPPLIER_DIRECT_TO_STORE", destinationLocationId: "store1", plannedDeliveryQty: 2, expectedDeliveryDate: "2026-07-30" }];
  return state;
}

test("demand gate blocks empty lines, invalid quantity, inactive product and missing reason", () => {
  const state = stateFixture();
  const result = validateDemandOrderGate(state, validDemand({ items: [] }), { attemptedAction: "SUBMIT" });
  assert.equal(result.valid, false);
  assert.ok(result.blocking_items.some((item) => item.rule_code === "LINES_REQUIRED"));

  const invalid = validateDemandOrderGate(state, validDemand({ notes: "", items: [{ id: "i1", productId: "missing", requestedQty: 0 }] }), { attemptedAction: "SUBMIT", locationId: "store1" });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.blocking_items.some((item) => item.rule_code === "PRODUCT_ACTIVE_REQUIRED"));
  assert.ok(invalid.blocking_items.some((item) => item.rule_code === "QUANTITY_POSITIVE"));
  assert.ok(invalid.blocking_items.some((item) => item.rule_code === "REASON_REQUIRED"));
});

test("demand gate accepts a complete demand and returns the structured contract", () => {
  const result = validateDemandOrderGate(stateFixture(), validDemand(), { attemptedAction: "SUBMIT" });
  assert.equal(result.valid, true);
  assert.equal(result.error_code, null);
  assert.equal(result.workflow_type, "DEMAND_ORDER");
  assert.equal(result.blocking_items.length, 0);
  assert.equal(result.workflowType, result.workflow_type);
});

test("demand gate uses requested quantity when approved quantity defaults to zero", () => {
  const result = validateDemandOrderGate(stateFixture(), validDemand({
    items: [{ id: "demand-item-1", productId: "p1", requestedQty: 3, approvedQty: 0, reason: "近期銷售增加" }],
  }), { attemptedAction: "SUBMIT", locationId: "store1" });
  assert.equal(result.valid, true);
  assert.equal(result.blocking_items.some((item) => item.rule_code === "QUANTITY_POSITIVE"), false);
});

test("auto demand gate falls back to a positive store confirmation when requested quantity is a stale zero", () => {
  const result = validateDemandOrderGate(stateFixture(), validDemand({
    sourceType: "AUTO",
    items: [{ id: "demand-item-1", productId: "p1", requestedQty: 0, storeConfirmedQty: 5, systemSuggestedQty: 5, reason: "安全庫存觸發" }],
  }), { attemptedAction: "SUBMIT_AUTO_TO_MANAGER", locationId: "store1" });
  assert.equal(result.valid, true);
  assert.equal(result.blocking_items.some((item) => item.rule_code === "QUANTITY_POSITIVE"), false);
});

test("store minimum condition is checked before the demand status transition", () => {
  const state = stateFixture();
  state.storeOrderConditions = [{ locationId: "store1", productId: "p1", conditionMode: "BOTH", minimumQty: 5, minimumAmount: 100, isActive: true }];
  const result = validateDemandOrderGate(state, validDemand(), { attemptedAction: "SUBMIT" });
  assert.equal(result.valid, false);
  assert.ok(result.blocking_items.some((item) => item.rule_code === "STORE_MINIMUM_CONDITION"));
});

test("purchase-order gate blocks missing delivery plans and accepts a valid plan", () => {
  const state = validOrderState();
  const missing = validatePurchaseOrderGate({ ...state, purchaseOrderItemStoreAllocations: [] }, state.purchaseOrders[0], { attemptedAction: "CONFIRM" });
  assert.equal(missing.valid, false);
  assert.ok(missing.blocking_items.some((item) => item.rule_code === "DELIVERY_MODE_REQUIRED"));

  const valid = validatePurchaseOrderGate(state, state.purchaseOrders[0], { attemptedAction: "CONFIRM" });
  assert.equal(valid.valid, true, JSON.stringify(valid.blocking_items));
});

test("purchase-order gate blocks inactive payee, invalid product and missing price", () => {
  const state = validOrderState({ lines: [{ id: "po-line-1", productId: "missing", orderedQty: 2, unitPrice: "", purchaseMultiple: 1, minimumOrderQuantity: 1 }] });
  state.suppliers[0].isActive = false;
  const result = validatePurchaseOrderGate(state, state.purchaseOrders[0], { attemptedAction: "CONFIRM" });
  assert.equal(result.valid, false);
  assert.ok(result.blocking_items.some((item) => item.rule_code === "ORDERING_SUPPLIER_ACTIVE"));
  assert.ok(result.blocking_items.some((item) => item.rule_code === "PAYEE_SUPPLIER_ACTIVE"));
  assert.ok(result.blocking_items.some((item) => item.rule_code === "PRICE_REQUIRED"));
});

test("workflow block events deduplicate unresolved blocks and retain history after resolution", () => {
  const validation = validateDemandOrderGate(stateFixture(), validDemand({ items: [] }), { attemptedAction: "SUBMIT" });
  const first = recordWorkflowBlockEvents({}, validation, input("STORE", { entityLocationId: "store1" }));
  const second = recordWorkflowBlockEvents(first.state, validation, input("STORE", { entityLocationId: "store1" }));
  assert.equal(first.state.workflowBlockEvents.length, 1);
  assert.equal(second.state.workflowBlockEvents.length, 1);
  assert.equal(second.state.workflowNotifications.length, 1);
  assert.equal(getWorkflowBlockEventsForRole(second.state, { role: "STORE", locationId: "store1" }, { unresolvedOnly: true }).length, 1);
  assert.equal(getWorkflowBlockEventsForRole(second.state, { role: "STORE", locationId: "store2" }, { unresolvedOnly: true }).length, 0);

  const resolved = resolveWorkflowBlockEvents(second.state, { entityId: "demand-1", attemptedAction: "SUBMIT", actorId: "manager-1", changedAt: "2026-07-28T10:00:00+08:00" });
  assert.equal(resolved.resolved, 1);
  assert.equal(resolved.state.workflowBlockEvents[0].isResolved, true);
  assert.equal(resolved.state.workflowBlockEvents.length, 1);
  assert.equal(resolved.state.workflowNotifications[0].isRead, true);
});

test("different blocking codes for the same workflow action remain separate events", () => {
  const state = stateFixture();
  const validation = validateDemandOrderGate(state, validDemand({ notes: "", items: [{ id: "i1", productId: "missing", requestedQty: 0 }] }), { attemptedAction: "SUBMIT" });
  const result = recordWorkflowBlockEvents({}, validation, input("STORE", { entityLocationId: "store1" }));
  assert.ok(result.state.workflowBlockEvents.length >= 3);
  assert.equal(new Set(result.state.workflowBlockEvents.map((event) => event.blockingCode)).size, result.state.workflowBlockEvents.length);
});
