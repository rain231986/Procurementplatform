import test from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_MODES,
  INVENTORY_MOVEMENT_TYPES,
  normalizeReceivingWorkflow,
  getReceivingRowsForRole,
  receiveSupplierDirectStore,
  receiveWarehouseDistributionStore,
  receiveWarehousePurchase,
  shipWarehouseAllocation,
  validatePurchaseDeliveryConfiguration,
} from "../receiving-workflow.js";

const actor = (role, locationId = null, id = role.toLowerCase()) => ({ actor: { id, role, locationId, isActive: true }, actorId: id, actorRole: role, locationId, changedAt: "2026-07-28T09:00:00+08:00", createId: (prefix) => `${prefix}_${id}_${Math.random().toString(36).slice(2, 7)}` });
const commit = (result) => { assert.equal(result.committed, true, result.error?.message); return result.state; };
const fail = (result) => { assert.equal(result.committed, false); return result; };

function fixture() {
  const state = {
    locations: [{ id: "warehouse", type: "WAREHOUSE", isActive: true }, { id: "store1", type: "STORE", isActive: true }, { id: "store2", type: "STORE", isActive: true }],
    products: [{ id: "p1", productCode: "P-1", name: "一般商品", specification: "10盒", batchTrackingEnabled: false, expiryTrackingEnabled: false, isActive: true }, { id: "p2", productCode: "P-2", name: "批號商品", specification: "1盒", batchTrackingEnabled: true, expiryTrackingEnabled: true, isActive: true }],
    suppliers: [{ id: "s1", name: "供應商 A", isActive: true }],
    supplierProducts: [{ id: "sp1", productId: "p1", supplierId: "s1", isActive: true, purchaseUnit: "盒", purchasePrice: 10, purchaseMultiple: 1, minimumOrderQuantity: 1 }, { id: "sp2", productId: "p2", supplierId: "s1", isActive: true, purchaseUnit: "盒", purchasePrice: 20, purchaseMultiple: 1, minimumOrderQuantity: 1 }],
    inventory: [{ id: "wh-p1", locationId: "warehouse", productId: "p1", onHandQty: 20, reservedQty: 0 }, { id: "st1-p1", locationId: "store1", productId: "p1", onHandQty: 0, reservedQty: 0 }, { id: "st2-p1", locationId: "store2", productId: "p1", onHandQty: 0, reservedQty: 0 }, { id: "wh-p2", locationId: "warehouse", productId: "p2", onHandQty: 20, reservedQty: 0 }],
    purchaseOrders: [{ id: "po1", purchaseOrderNumber: "PO-1", supplierId: "s1", orderingSupplierId: "s1", payeeSupplierId: "s1", status: "ORDERED", orderDate: "2026-07-28", expectedDeliveryDate: "2026-07-30", lines: [{ id: "line1", productId: "p1", orderedQty: 12, receivedQty: 0, cancelledQty: 0, sourceAllocations: [{ locationId: "store1", demandOrderId: "d1", demandOrderItemId: "di1", allocatedQty: 5, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 }, { locationId: "store2", demandOrderId: "d2", demandOrderItemId: "di2", allocatedQty: 7, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 }] }] }],
    purchaseOrderItemStoreAllocations: [
      { id: "plan-direct", purchaseOrderId: "po1", purchaseOrderItemId: "line1", destinationLocationId: "store1", locationId: "store1", deliveryMode: "SUPPLIER_DIRECT_TO_STORE", plannedDeliveryQty: 5, expectedDeliveryDate: "2026-07-30", demandOrderId: "d1", demandOrderItemId: "di1", status: "WAITING_STORE_DIRECT_RECEIPT" },
      { id: "plan-warehouse", purchaseOrderId: "po1", purchaseOrderItemId: "line1", destinationLocationId: "store2", locationId: "store2", deliveryMode: "WAREHOUSE_DISTRIBUTION", plannedDeliveryQty: 7, expectedDeliveryDate: "2026-07-30", demandOrderId: "d2", demandOrderItemId: "di2", status: "WAITING_WAREHOUSE_RECEIPT" },
    ],
    allocations: [{ id: "allocation1", allocationNumber: "AL-1", sourceLocationId: "warehouse", destinationLocationId: "store2", demandOrderId: "d2", status: "PICKING", items: [{ id: "allocation-line1", purchaseOrderItemId: "line1", productId: "p1", allocatedQty: 7, shippedQty: 0, receivedQty: 0 }] }],
    demands: [{ id: "d1", locationId: "store1", status: "WAITING_PURCHASE", items: [{ id: "di1", productId: "p1", requestedQty: 5, approvedQty: 5, allocatedQty: 0, receivedQty: 0 }] }, { id: "d2", locationId: "store2", status: "WAITING_PURCHASE", items: [{ id: "di2", productId: "p1", requestedQty: 7, approvedQty: 7, allocatedQty: 0, receivedQty: 0 }] }],
    demandPurchaseAllocations: [], inventoryMovements: [], auditLogs: [], purchaseReceiptLogs: [], warehouseShipmentLogs: [], storeReceiptLogs: [], supplierDirectReceiptLogs: [], products: [],
  };
  // Keep the product list above while making the fixture explicit for readers.
  state.products = [{ id: "p1", productCode: "P-1", name: "一般商品", specification: "10盒", batchTrackingEnabled: false, expiryTrackingEnabled: false, isActive: true }, { id: "p2", productCode: "P-2", name: "批號商品", specification: "1盒", batchTrackingEnabled: true, expiryTrackingEnabled: true, isActive: true }];
  return normalizeReceivingWorkflow(state);
}

function balance(state, locationId, productId) { return state.inventory.find((row) => row.locationId === locationId && row.productId === productId); }

test("normalization provides delivery modes and per-plan receipt fields", () => {
  const state = fixture();
  assert.deepEqual(DELIVERY_MODES, ["SUPPLIER_DIRECT_TO_STORE", "WAREHOUSE_DISTRIBUTION"]);
  assert.equal(state.purchaseOrderItemStoreAllocations[0].destinationLocationId, "store1");
  assert.equal(state.purchaseOrderItemStoreAllocations[0].signedQty, 0);
});

test("supplier direct full receipt increases only destination store inventory", () => {
  const beforeWarehouse = balance(fixture(), "warehouse", "p1").onHandQty;
  const state = commit(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store1", "store-user"), planId: "plan-direct", signedQty: 5, operationId: "direct-full-1", signedAt: "2026-07-30T10:00:00+08:00" }));
  assert.equal(balance(state, "warehouse", "p1").onHandQty, beforeWarehouse);
  assert.equal(balance(state, "store1", "p1").onHandQty, 5);
  assert.equal(state.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-direct").status, "RECEIVED");
  assert.equal(state.inventoryMovements[0].movementType, INVENTORY_MOVEMENT_TYPES.SUPPLIER_DIRECT_RECEIPT_STORE);
});

test("supplier direct partial receipt is allowed and explicit short receipt requires a reason", () => {
  const state = commit(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 3, operationId: "direct-partial-1" }));
  const plan = state.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-direct");
  assert.equal(plan.signedQty, 3);
  assert.equal(plan.shortReceivedQty, 0);
  assert.equal(plan.status, "PARTIALLY_RECEIVED");
  fail(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 3, shortReceived: true, operationId: "direct-short-no-reason" }));
  const short = commit(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 3, shortReceived: true, receiveNotes: "供應商短送 2 件", operationId: "direct-short" }));
  assert.equal(short.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-direct").shortReceivedQty, 2);
  assert.equal(short.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-direct").status, "SHORT_RECEIVED");
});

test("supplier direct cannot be signed by another store", () => {
  fail(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store2"), planId: "plan-direct", signedQty: 5, operationId: "direct-cross-store" }));
});

test("supplier direct cannot over-sign the planned quantity", () => {
  const original = fixture();
  const result = receiveSupplierDirectStore(original, { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 6, operationId: "direct-over" });
  fail(result);
  assert.equal(balance(original, "store1", "p1").onHandQty, 0);
});

test("supplier direct reject requires a reason and does not add inventory", () => {
  fail(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 0, rejected: true, operationId: "direct-reject-no-reason" }));
  const state = commit(receiveSupplierDirectStore(fixture(), { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 0, rejected: true, receiveNotes: "外箱破損，整批拒收", operationId: "direct-reject" }));
  assert.equal(balance(state, "store1", "p1").onHandQty, 0);
  assert.equal(state.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-direct").status, "REJECTED");
});

test("tracked direct receipt requires batch and expiry", () => {
  const state = fixture();
  state.purchaseOrders[0].lines.push({ id: "line2", productId: "p2", orderedQty: 2, receivedQty: 0, cancelledQty: 0 });
  state.purchaseOrderItemStoreAllocations.push({ id: "plan-tracked", purchaseOrderId: "po1", purchaseOrderItemId: "line2", destinationLocationId: "store1", deliveryMode: "SUPPLIER_DIRECT_TO_STORE", plannedDeliveryQty: 2 });
  normalizeReceivingWorkflow(state);
  fail(receiveSupplierDirectStore(state, { ...actor("STORE", "store1"), planId: "plan-tracked", signedQty: 1, receiveNotes: "部分到貨", operationId: "tracked-no-batch" }));
  const received = commit(receiveSupplierDirectStore(state, { ...actor("STORE", "store1"), planId: "plan-tracked", signedQty: 2, batchNumber: "B-001", expiryDate: "2027-12-31", operationId: "tracked-ok" }));
  assert.equal(balance(received, "store1", "p2").onHandQty, 2);
});

test("tracked warehouse receipt stores batch and expiry on the delivery plan", () => {
  const state = fixture();
  state.purchaseOrders[0].lines.push({ id: "line2", productId: "p2", orderedQty: 2, receivedQty: 0, cancelledQty: 0 });
  state.purchaseOrderItemStoreAllocations.push({ id: "plan-tracked-warehouse", purchaseOrderId: "po1", purchaseOrderItemId: "line2", destinationLocationId: "store2", deliveryMode: "WAREHOUSE_DISTRIBUTION", plannedDeliveryQty: 2 });
  normalizeReceivingWorkflow(state);
  const received = commit(receiveWarehousePurchase(state, { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line2: 2 }, batch_line2: "B-WH-001", expiry_line2: "2027-12-31", operationId: "tracked-warehouse-ok" }));
  const plan = received.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-tracked-warehouse");
  assert.equal(plan.batchNumber, "B-WH-001");
  assert.equal(plan.expiryDate, "2027-12-31");
  assert.equal(received.inventoryMovements[0].batchNumber, "B-WH-001");
});

test("warehouse purchase receipt adds warehouse inventory and never store inventory", () => {
  const state = commit(receiveWarehousePurchase(fixture(), { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "warehouse-receipt-1", receivedAt: "2026-07-30T09:00:00+08:00" }));
  assert.equal(balance(state, "warehouse", "p1").onHandQty, 27);
  assert.equal(balance(state, "store2", "p1").onHandQty, 0);
  assert.equal(state.inventoryMovements[0].movementType, INVENTORY_MOVEMENT_TYPES.PURCHASE_RECEIPT_WAREHOUSE);
  assert.equal(state.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-warehouse").status, "WAREHOUSE_RECEIVED");
});

test("direct-only line cannot be received into warehouse", () => {
  const state = fixture();
  state.purchaseOrderItemStoreAllocations = [state.purchaseOrderItemStoreAllocations[0]];
  fail(receiveWarehousePurchase(state, { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 5 }, operationId: "direct-not-warehouse" }));
});

test("store cannot perform warehouse receipt", () => {
  fail(receiveWarehousePurchase(fixture(), { ...actor("STORE", "store1"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "store-warehouse-receipt" }));
});

test("warehouse shipment is the only moment warehouse inventory decreases", () => {
  const state = commit(receiveWarehousePurchase(fixture(), { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "shipment-receipt" }));
  const shipped = commit(shipWarehouseAllocation(state, { ...actor("WAREHOUSE", "warehouse"), allocationId: "allocation1", shipByLine: { "allocation-line1": 7 }, operationId: "shipment-1", shippedAt: "2026-07-30T12:00:00+08:00" }));
  assert.equal(balance(shipped, "warehouse", "p1").onHandQty, 20);
  assert.equal(shipped.allocations[0].status, "SHIPPED");
  assert.equal(shipped.inventoryMovements[0].movementType, INVENTORY_MOVEMENT_TYPES.WAREHOUSE_SHIPMENT_TO_STORE);
});

test("warehouse shipment cannot exceed available inventory or allocated quantity", () => {
  const state = fixture();
  state.inventory.find((row) => row.locationId === "warehouse" && row.productId === "p1").onHandQty = 2;
  fail(shipWarehouseAllocation(state, { ...actor("WAREHOUSE", "warehouse"), allocationId: "allocation1", shipByLine: { "allocation-line1": 7 }, operationId: "shipment-over" }));
});

test("store receipt is unavailable before warehouse shipment", () => {
  fail(receiveWarehouseDistributionStore(fixture(), { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 7 }, operationId: "store-before-ship" }));
});

test("store signs warehouse shipment and increases store inventory", () => {
  const received = commit(receiveWarehousePurchase(fixture(), { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "store-sign-receipt" }));
  const shipped = commit(shipWarehouseAllocation(received, { ...actor("WAREHOUSE", "warehouse"), allocationId: "allocation1", shipByLine: { "allocation-line1": 7 }, operationId: "store-sign-ship" }));
  const signed = commit(receiveWarehouseDistributionStore(shipped, { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 7 }, operationId: "store-sign-1" }));
  assert.equal(balance(signed, "warehouse", "p1").onHandQty, 20);
  assert.equal(balance(signed, "store2", "p1").onHandQty, 7);
  assert.equal(signed.inventoryMovements[0].movementType, INVENTORY_MOVEMENT_TYPES.STORE_RECEIPT_FROM_WAREHOUSE);
  assert.equal(signed.allocations[0].status, "RECEIVED");
});

test("store partial receipt is allowed, while explicit short receipt requires a reason", () => {
  const received = commit(receiveWarehousePurchase(fixture(), { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "partial-receipt-wh" }));
  const shipped = commit(shipWarehouseAllocation(received, { ...actor("WAREHOUSE", "warehouse"), allocationId: "allocation1", shipByLine: { "allocation-line1": 7 }, operationId: "partial-receipt-ship" }));
  const partial = commit(receiveWarehouseDistributionStore(shipped, { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 3 }, operationId: "partial-ok" }));
  assert.equal(partial.allocations[0].status, "PARTIALLY_RECEIVED");
  assert.equal(partial.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-warehouse").shortReceivedQty, 0);
  fail(receiveWarehouseDistributionStore(shipped, { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 3 }, shortReceived: true, operationId: "partial-short-no-reason" }));
  const short = commit(receiveWarehouseDistributionStore(shipped, { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 3 }, shortReceived: true, receiveNotes: "物流箱損短收 4 件", operationId: "partial-short" }));
  assert.equal(short.purchaseOrderItemStoreAllocations.find((row) => row.id === "plan-warehouse").shortReceivedQty, 4);
  fail(receiveWarehouseDistributionStore(partial, { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 5 }, operationId: "sign-over" }));
});

test("store receipt is isolated to the allocation destination", () => {
  const received = commit(receiveWarehousePurchase(fixture(), { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "isolation-wh" }));
  const shipped = commit(shipWarehouseAllocation(received, { ...actor("WAREHOUSE", "warehouse"), allocationId: "allocation1", shipByLine: { "allocation-line1": 7 }, operationId: "isolation-ship" }));
  fail(receiveWarehouseDistributionStore(shipped, { ...actor("STORE", "store1"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 7 }, operationId: "isolation-store" }));
});

test("all four movement types are distinct and do not duplicate", () => {
  const state = fixture();
  const direct = commit(receiveSupplierDirectStore(state, { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 5, operationId: "four-direct" }));
  const whReceived = commit(receiveWarehousePurchase(direct, { ...actor("WAREHOUSE", "warehouse"), orderId: "po1", receivedByLine: { line1: 7 }, operationId: "four-purchase" }));
  const shipped = commit(shipWarehouseAllocation(whReceived, { ...actor("WAREHOUSE", "warehouse"), allocationId: "allocation1", shipByLine: { "allocation-line1": 7 }, operationId: "four-ship" }));
  const signed = commit(receiveWarehouseDistributionStore(shipped, { ...actor("STORE", "store2"), allocationId: "allocation1", receivedByLine: { "allocation-line1": 7 }, operationId: "four-store" }));
  assert.deepEqual(new Set(signed.inventoryMovements.map((row) => row.movementType)), new Set(Object.values(INVENTORY_MOVEMENT_TYPES)));
  assert.equal(signed.inventoryMovements.length, 4);
});

test("receiving operation ids are idempotent", () => {
  const original = fixture();
  const once = commit(receiveSupplierDirectStore(original, { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 5, operationId: "idempotent-direct" }));
  const twice = commit(receiveSupplierDirectStore(once, { ...actor("STORE", "store1"), planId: "plan-direct", signedQty: 5, operationId: "idempotent-direct" }));
  assert.equal(balance(twice, "store1", "p1").onHandQty, 5);
  assert.equal(twice.inventoryMovements.filter((row) => row.operationId === "idempotent-direct").length, 1);
  assert.equal(twice.supplierDirectReceiptLogs.length, 1);
});

test("receiving projection exposes Chinese rows and store isolation", () => {
  const state = fixture();
  const storeRows = getReceivingRowsForRole(state, { role: "STORE", locationId: "store1", isActive: true });
  assert.equal(storeRows.length, 1);
  assert.equal(storeRows[0].deliveryMode, "SUPPLIER_DIRECT_TO_STORE");
  // Warehouse-distribution rows are not actionable for the store until the
  // warehouse has shipped them; the store must not see another store's direct row.
  assert.equal(getReceivingRowsForRole(state, { role: "STORE", locationId: "store2", isActive: true }).length, 0);
});

test("delivery configuration rejects missing destination and excess quantity", () => {
  const state = fixture();
  const order = state.purchaseOrders[0];
  const invalid = validatePurchaseDeliveryConfiguration(order, [{ purchaseOrderItemId: "line1", deliveryMode: "SUPPLIER_DIRECT_TO_STORE", destinationLocationId: "warehouse", plannedDeliveryQty: 20 }], { locations: state.locations });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.blockingItems.some((item) => item.ruleCode === "DELIVERY_QTY_EXCEEDS_PURCHASE"));
  assert.ok(invalid.blockingItems.some((item) => item.ruleCode === "DIRECT_DESTINATION_MUST_STORE"));
});
