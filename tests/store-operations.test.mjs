import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStoreOperations,
  getStoreOperationsForRole,
  getStoreSafetyStockRows,
  validateStoreTransferGate,
  createStoreTransferDraft,
  submitStoreTransfer,
  approveStoreTransfer,
  shipStoreTransfer,
  receiveStoreTransfer,
  createStoreReturnToWarehouseDraft,
  submitStoreReturnToWarehouse,
  approveStoreReturnToWarehouseByManager,
  approveStoreReturnToWarehouse,
  shipStoreReturnToWarehouse,
  receiveStoreReturnToWarehouse,
  receiveRejectedStoreReturnAtStore,
  createStoreSupplierReturnDraft,
  submitStoreSupplierReturn,
  approveStoreSupplierReturnByManager,
  reviewStoreSupplierReturn,
  confirmStoreSupplierReturn,
  shipStoreSupplierReturn,
  recordStoreSupplierReturnResolution,
  receiveStoreSupplierRejected,
  receiveStoreSupplierReplacement,
  uploadStoreReturnAttachment,
  updateStoreSafetyStock,
  validatePurchaseItemShortageGate,
} from "../store-operations-workflow.js";
import {
  normalizeSupplierOperations,
  updatePurchaseOrderItemShortage,
  cancelPurchaseOrderItemShortage,
  requeuePurchaseOrderItemShortage,
  setPurchaseOrderItemAlternative,
  getStorePurchaseStatus,
} from "../supplier-operations-workflow.js";

let sequence = 0;
const actor = (role, locationId = null, id = `${role.toLowerCase()}-${locationId || "global"}`, isStoreManager = false) => ({
  actor: { id, role, locationId, isStoreManager, isActive: true },
  actorId: id,
  actorRole: role,
  locationId,
  isStoreManager,
  changedAt: "2026-07-28T09:00:00+08:00",
  createId: (prefix) => `${prefix}_${id}_${sequence += 1}`,
});

const committed = (result) => {
  assert.equal(result.committed, true, result.error?.message || result.errors?.join("；"));
  return result.state;
};
const failed = (result) => {
  assert.equal(result.committed, false);
  return result;
};
const inventory = (state, locationId, productId) => state.inventory.find((row) => row.locationId === locationId && row.productId === productId);
const transferItem = (state, orderId) => state.storeTransferItems.find((row) => row.transferOrderId === orderId);
const warehouseReturnItem = (state, orderId) => state.storeReturnItems.find((row) => row.returnOrderId === orderId);
const directItem = (state, orderId) => state.supplierReturnItems.find((row) => row.returnOrderId === orderId);

function fixture() {
  const state = {
    locations: [
      { id: "warehouse", type: "WAREHOUSE", name: "總倉", isActive: true },
      { id: "store1", type: "STORE", name: "門市一", isActive: true },
      { id: "store2", type: "STORE", name: "門市二", isActive: true },
      { id: "inactive-store", type: "STORE", name: "停用門市", isActive: false },
    ],
    products: [
      { id: "p1", productCode: "P-001", name: "商品 A 長名稱測試", specification: "10 盒／標準規格", category: "一般", batchTrackingEnabled: false, expiryTrackingEnabled: false, isActive: true },
      { id: "p2", productCode: "P-002", name: "批號效期商品", specification: "單盒", category: "冷藏", batchTrackingEnabled: true, expiryTrackingEnabled: true, isActive: true },
      { id: "inactive-product", productCode: "P-999", name: "停用商品", specification: "不可用", isActive: false },
    ],
    suppliers: [{ id: "supplier1", code: "SUP-1", name: "供應商一", isActive: true }],
    settings: [
      { id: "setting-s1-p1", locationId: "store1", productId: "p1", safetyStockQty: 5, maximumStockQty: 30, minimumReplenishmentQty: 2, replenishmentEnabled: true },
      { id: "setting-s2-p1", locationId: "store2", productId: "p1", safetyStockQty: 1, maximumStockQty: 30, minimumReplenishmentQty: 1, replenishmentEnabled: true },
      { id: "setting-s1-p2", locationId: "store1", productId: "p2", safetyStockQty: 0, maximumStockQty: 0, minimumReplenishmentQty: 1, replenishmentEnabled: true },
    ],
    inventory: [
      { id: "bal-s1-p1", locationId: "store1", productId: "p1", onHandQty: 20, reservedQty: 0 },
      { id: "bal-s2-p1", locationId: "store2", productId: "p1", onHandQty: 2, reservedQty: 0 },
      { id: "bal-wh-p1", locationId: "warehouse", productId: "p1", onHandQty: 50, reservedQty: 0 },
      { id: "bal-s1-p2", locationId: "store1", productId: "p2", onHandQty: 8, reservedQty: 0 },
      { id: "bal-s2-p2", locationId: "store2", productId: "p2", onHandQty: 0, reservedQty: 0 },
    ],
    monthlyProductSales: [
      { locationId: "store1", productId: "p1", salesYear: 2026, salesMonth: 1, salesQty: 4 },
      { locationId: "store1", productId: "p1", salesYear: 2026, salesMonth: 2, salesQty: 5 },
      { locationId: "store1", productId: "p1", salesYear: 2026, salesMonth: 3, salesQty: 6 },
      { locationId: "store1", productId: "p1", salesYear: 2026, salesMonth: 4, salesQty: 7 },
      { locationId: "store1", productId: "p1", salesYear: 2026, salesMonth: 5, salesQty: 8 },
      { locationId: "store1", productId: "p1", salesYear: 2026, salesMonth: 6, salesQty: 9 },
    ],
    storeTransferOrders: [], storeTransferItems: [], storeReturnOrders: [], storeReturnItems: [], storeReturnAttachments: [],
    supplierReturns: [], supplierReturnItems: [], supplierReturnAttachments: [], inventoryMovements: [], auditLogs: [],
    purchaseOrders: [{ id: "po1", purchaseOrderNumber: "PO-001", supplierId: "supplier1", orderingSupplierId: "supplier1", status: "ORDERED", expectedDeliveryDate: "2026-08-01", lines: [
      { id: "line-a", productId: "p1", orderedQty: 20, receivedQty: 0, cancelledQty: 0, sourceAllocations: [{ locationId: "store1", demandOrderId: "d1", demandOrderItemId: "d1-item", allocatedQty: 20, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 }] },
      { id: "line-b", productId: "p2", orderedQty: 10, receivedQty: 0, cancelledQty: 0, sourceAllocations: [{ locationId: "store1", demandOrderId: "d1", demandOrderItemId: "d1-item-b", allocatedQty: 10, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 }] },
    ] }],
    purchaseOrderItemStoreAllocations: [], purchaseOrderItemFollowups: [], shortageRequeueEntries: [], demandPurchaseAllocations: [],
    demands: [{ id: "d1", locationId: "store1", items: [{ id: "d1-item", productId: "p1", requestedQty: 20 }, { id: "d1-item-b", productId: "p2", requestedQty: 10 }] }],
    supplierOrderSchedules: [], supplierBusinessRelations: [], supplierBankAccounts: [], supplierBankAttachments: [], productIdentifiers: [],
  };
  normalizeStoreOperations(state);
  normalizeSupplierOperations(state);
  return state;
}

function approvedTransfer(state, quantity = 5, extra = {}) {
  let next = committed(createStoreTransferDraft(state, { ...actor("STORE", "store2", "store2-user"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: quantity }], ...extra }));
  const orderId = next.storeTransferOrders[0].id;
  next = committed(submitStoreTransfer(next, { ...actor("STORE", "store2", "store2-user"), transferOrderId: orderId }));
  next = committed(approveStoreTransfer(next, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId }));
  return { state: next, orderId };
}

function approvedWarehouseReturn(state, quantity = 10, items = [{ productId: "p1", returnQty: quantity }]) {
  let next = committed(createStoreReturnToWarehouseDraft(state, { ...actor("STORE", "store1", "store1-user"), sourceLocationId: "store1", warehouseLocationId: "warehouse", returnReason: "庫存過多", items }));
  const returnOrderId = next.storeReturnOrders[0].id;
  next = committed(submitStoreReturnToWarehouse(next, { ...actor("STORE", "store1", "store1-user"), returnOrderId }));
  next = committed(approveStoreReturnToWarehouseByManager(next, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId }));
  next = committed(approveStoreReturnToWarehouse(next, { ...actor("WAREHOUSE", "warehouse", "warehouse-user"), returnOrderId }));
  return { state: next, returnOrderId };
}

function supplierConfirmedStoreReturn(state, quantity = 5) {
  let next = committed(createStoreSupplierReturnDraft(state, { ...actor("STORE", "store1", "store1-user"), sourceLocationId: "store1", supplierId: "supplier1", returnReason: "品質問題", items: [{ productId: "p1", returnQty: quantity, reasonCode: "QUALITY_ISSUE" }] }));
  const returnOrderId = next.supplierReturns[0].id;
  next = committed(submitStoreSupplierReturn(next, { ...actor("STORE", "store1", "store1-user"), returnOrderId }));
  next = committed(approveStoreSupplierReturnByManager(next, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId }));
  next = committed(reviewStoreSupplierReturn(next, { ...actor("PURCHASING", "warehouse", "buyer"), returnOrderId, returnAddress: "廠商一退貨地址", returnMethod: "宅配", resolutionType: "REFUND", expectedResolutionDate: "2026-08-15", purchasingNote: "採購內部追蹤" }));
  next = committed(confirmStoreSupplierReturn(next, { ...actor("PURCHASING", "warehouse", "buyer"), returnOrderId, accepted: true, supplierResponse: "接受退貨" }));
  return { state: next, returnOrderId, itemId: directItem(next, returnOrderId).id };
}

test("normalization creates store operation collections and preserves zero minimum quantity", () => {
  const state = normalizeStoreOperations({ settings: [{ locationId: "store1", productId: "p1", minimumReplenishmentQty: 0 }] });
  assert.ok(Array.isArray(state.storeTransferOrders));
  assert.ok(Array.isArray(state.storeReturnOrders));
  assert.equal(state.settings[0].minimumReplenishmentQty, 0);
});

test("store two can create and submit a transfer without changing inventory", () => {
  let state = committed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: 10 }], notes: "門市二缺貨" }));
  const order = state.storeTransferOrders[0];
  assert.equal(order.status, "DRAFT");
  state = committed(submitStoreTransfer(state, { ...actor("STORE", "store2"), transferOrderId: order.id }));
  assert.equal(state.storeTransferOrders[0].status, "PENDING_SOURCE_APPROVAL");
  assert.equal(inventory(state, "store1", "p1").onHandQty, 20);
  assert.equal(inventory(state, "store2", "p1").onHandQty, 2);
  assert.equal(state.inventoryMovements.length, 0);
});

test("transfer creation blocks same store, inactive destination and inactive product", () => {
  failed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store1"), sourceLocationId: "store1", destinationLocationId: "store1", items: [{ productId: "p1", requestedQty: 1 }] }));
  failed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "inactive-store", items: [{ productId: "p1", requestedQty: 1 }] }));
  failed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "inactive-product", requestedQty: 1 }] }));
});

test("transfer submission blocks empty and non-positive lines with structured validation", () => {
  let state = committed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [] }));
  const failedEmpty = failed(submitStoreTransfer(state, { ...actor("STORE", "store2"), transferOrderId: state.storeTransferOrders[0].id }));
  assert.equal(failedEmpty.validation.workflowType, "STORE_TRANSFER");
  assert.ok(failedEmpty.validation.blockingItems.some((item) => item.ruleCode === "LINES_REQUIRED"));
  state = committed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: 0 }] }));
  const failedQty = failed(submitStoreTransfer(state, { ...actor("STORE", "store2"), transferOrderId: state.storeTransferOrders[0].id }));
  assert.ok(failedQty.validation.blockingItems.some((item) => item.ruleCode === "QUANTITY_POSITIVE"));
});

test("general store cannot approve a transfer but source manager can approve without inventory movement", () => {
  const pending = (() => { let next = committed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: 5 }] })); const id = next.storeTransferOrders[0].id; return committed(submitStoreTransfer(next, { ...actor("STORE", "store2"), transferOrderId: id })); })();
  const id = pending.storeTransferOrders[0].id;
  failed(approveStoreTransfer(pending, { ...actor("STORE", "store1", "store1-user"), transferOrderId: id }));
  const approved = committed(approveStoreTransfer(pending, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: id }));
  assert.equal(approved.storeTransferOrders[0].status, "APPROVED");
  assert.equal(inventory(approved, "store1", "p1").onHandQty, 20);
  assert.equal(approved.inventoryMovements.length, 0);
});

test("manager quantity adjustment requires a reason and cannot exceed the request", () => {
  let next = committed(createStoreTransferDraft(fixture(), { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: 10 }] }));
  const id = next.storeTransferOrders[0].id;
  next = committed(submitStoreTransfer(next, { ...actor("STORE", "store2"), transferOrderId: id }));
  failed(approveStoreTransfer(next, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: id, items: [{ itemId: transferItem(next, id).id, approvedQty: 8 }] }));
  failed(approveStoreTransfer(next, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: id, items: [{ itemId: transferItem(next, id).id, approvedQty: 11, reason: "誤植" }] }));
  const approved = committed(approveStoreTransfer(next, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: id, items: [{ itemId: transferItem(next, id).id, approvedQty: 8, reason: "依庫存調整" }] }));
  assert.equal(transferItem(approved, id).approvedQty, 8);
  assert.equal(transferItem(approved, id).quantityAdjustmentReason, "依庫存調整");
});

test("safety stock blocks over-limit approval and allows manager override with reason", () => {
  const base = fixture();
  const { state: pending, orderId } = (() => { let next = committed(createStoreTransferDraft(base, { ...actor("STORE", "store2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: 16 }] })); const id = next.storeTransferOrders[0].id; next = committed(submitStoreTransfer(next, { ...actor("STORE", "store2"), transferOrderId: id })); return { state: next, orderId: id }; })();
  const itemId = transferItem(pending, orderId).id;
  const blocked = failed(approveStoreTransfer(pending, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, items: [{ itemId, approvedQty: 16 }] }));
  assert.match(blocked.error.message, /最多可調撥15/);
  const noReason = failed(approveStoreTransfer(pending, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, safetyStockOverride: true, items: [{ itemId, approvedQty: 16 }] }));
  assert.match(noReason.error.message, /例外核准/);
  const approved = committed(approveStoreTransfer(pending, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, items: [{ itemId, approvedQty: 16, safetyStockOverride: true, overrideReason: "總倉缺貨，門市緊急支援" }] }));
  assert.equal(transferItem(approved, orderId).safetyStockOverride, true);
  assert.equal(transferItem(approved, orderId).overrideReason, "總倉缺貨，門市緊急支援");
});

test("approved unshipped transfers reserve source stock for later approval", () => {
  let state = fixture();
  const first = approvedTransfer(state, 15);
  state = first.state;
  let second = committed(createStoreTransferDraft(state, { ...actor("STORE", "store2", "store2-user-2"), sourceLocationId: "store1", destinationLocationId: "store2", items: [{ productId: "p1", requestedQty: 10 }] }));
  const secondId = second.storeTransferOrders[0].id;
  second = committed(submitStoreTransfer(second, { ...actor("STORE", "store2", "store2-user-2"), transferOrderId: secondId }));
  failed(approveStoreTransfer(second, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: secondId }));
  assert.equal(inventory(second, "store1", "p1").onHandQty, 20);
  assert.equal(transferItem(second, first.orderId).shippedQty, 0);
});

test("transfer shipment decrements source only and records STORE_TRANSFER_OUT", () => {
  const { state: approved, orderId } = approvedTransfer(fixture(), 5);
  const shipped = committed(shipStoreTransfer(approved, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, operationId: "transfer-out-1" }));
  assert.equal(inventory(shipped, "store1", "p1").onHandQty, 15);
  assert.equal(inventory(shipped, "store2", "p1").onHandQty, 2);
  assert.equal(shipped.inventoryMovements[0].movementType, "STORE_TRANSFER_OUT");
  assert.equal(shipped.storeTransferOrders[0].status, "SHIPPED");
});

test("transfer supports partial shipment and rejects over-shipment atomically", () => {
  const { state: approved, orderId } = approvedTransfer(fixture(), 5);
  const itemId = transferItem(approved, orderId).id;
  const partial = committed(shipStoreTransfer(approved, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, operationId: "transfer-partial-1", items: [{ itemId, shippedQty: 2 }] }));
  assert.equal(partial.storeTransferOrders[0].status, "PARTIALLY_SHIPPED");
  const beforeQty = inventory(partial, "store1", "p1").onHandQty;
  const over = failed(shipStoreTransfer(partial, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, operationId: "transfer-over-ship", items: [{ itemId, shippedQty: 4 }] }));
  assert.equal(over.state, partial);
  assert.equal(inventory(partial, "store1", "p1").onHandQty, beforeQty);
});

test("transfer receipt increases destination only and records STORE_TRANSFER_IN", () => {
  const { state: approved, orderId } = approvedTransfer(fixture(), 5);
  const shipped = committed(shipStoreTransfer(approved, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, operationId: "transfer-out-2" }));
  const received = committed(receiveStoreTransfer(shipped, { ...actor("STORE", "store2"), transferOrderId: orderId, operationId: "transfer-in-1" }));
  assert.equal(inventory(received, "store1", "p1").onHandQty, 15);
  assert.equal(inventory(received, "store2", "p1").onHandQty, 7);
  assert.equal(received.inventoryMovements[0].movementType, "STORE_TRANSFER_IN");
  assert.equal(received.storeTransferOrders[0].status, "RECEIVED");
});

test("transfer supports partial receipt, rejects over-receipt and is idempotent", () => {
  const { state: approved, orderId } = approvedTransfer(fixture(), 5);
  const itemId = transferItem(approved, orderId).id;
  const shipped = committed(shipStoreTransfer(approved, { ...actor("STORE", "store1", "store1-manager", true), transferOrderId: orderId, operationId: "transfer-out-3" }));
  const partial = committed(receiveStoreTransfer(shipped, { ...actor("STORE", "store2"), transferOrderId: orderId, operationId: "transfer-in-2", items: [{ itemId, receivedQty: 2 }] }));
  assert.equal(partial.storeTransferOrders[0].status, "PARTIALLY_RECEIVED");
  const over = failed(receiveStoreTransfer(partial, { ...actor("STORE", "store2"), transferOrderId: orderId, operationId: "transfer-in-over", items: [{ itemId, receivedQty: 4 }] }));
  assert.equal(over.state, partial);
  const done = committed(receiveStoreTransfer(partial, { ...actor("STORE", "store2"), transferOrderId: orderId, operationId: "transfer-in-3", items: [{ itemId, receivedQty: 3 }] }));
  assert.equal(done.storeTransferOrders[0].status, "RECEIVED");
  const repeated = committed(receiveStoreTransfer(done, { ...actor("STORE", "store2"), transferOrderId: orderId, operationId: "transfer-in-3" }));
  assert.equal(repeated.storeTransferOrders[0].status, "RECEIVED");
  assert.equal(inventory(repeated, "store2", "p1").onHandQty, 7);
});

test("store operation views isolate cross-store data and role capabilities", () => {
  const { state, orderId } = approvedTransfer(fixture(), 5);
  const store1 = getStoreOperationsForRole(state, { role: "STORE", locationId: "store1" });
  const store2 = getStoreOperationsForRole(state, { role: "STORE", locationId: "store2" });
  assert.equal(store1.transfers.length, 1);
  assert.equal(store2.transfers.length, 1);
  assert.equal(store1.transfers[0].id, orderId);
  assert.equal(getStoreOperationsForRole(state, { role: "STORE", locationId: "unrelated" }).transfers.length, 0);
  assert.equal(getStoreOperationsForRole(state, { role: "WAREHOUSE" }).transfers.length, 1);
});

test("store manager can update own safety stock and audit before/after values", () => {
  const result = updateStoreSafetyStock(fixture(), { ...actor("STORE", "store1", "store1-manager", true), locationId: "store1", productId: "p1", safetyStockQty: 15, maximumStockQty: 25, reason: "季節性需求上升", replenishmentEnabled: true });
  const state = committed(result);
  const row = state.settings.find((item) => item.locationId === "store1" && item.productId === "p1");
  assert.equal(row.safetyStockQty, 15);
  assert.equal(row.maximumStockQty, 25);
  assert.equal(state.auditLogs[0].action, "STORE_SAFETY_STOCK_UPDATED");
  assert.equal(state.auditLogs[0].beforeData.safetyStockQty, 5);
  assert.equal(state.auditLogs[0].afterData.safetyStockQty, 15);
  assert.equal(state.auditLogs[0].afterData.lastModifiedReason, "季節性需求上升");
});

test("safety stock writes are isolated to managers and reject invalid maximum", () => {
  failed(updateStoreSafetyStock(fixture(), { ...actor("STORE", "store1"), locationId: "store2", productId: "p1", safetyStockQty: 3, reason: "跨店測試" }));
  failed(updateStoreSafetyStock(fixture(), { ...actor("PURCHASING", "warehouse"), locationId: "store1", productId: "p1", safetyStockQty: 3, reason: "採購參考" }));
  failed(updateStoreSafetyStock(fixture(), { ...actor("STORE", "store1", "store1-manager", true), locationId: "store1", productId: "p1", safetyStockQty: 20, maximumStockQty: 10, reason: "設定錯誤" }));
});

test("safety stock view includes inventory and six-month sales with role scope", () => {
  const state = fixture();
  const own = getStoreSafetyStockRows(state, { role: "STORE", locationId: "store1" });
  const all = getStoreSafetyStockRows(state, { role: "PURCHASING", locationId: "warehouse" });
  assert.equal(own.every((row) => row.locationId === "store1"), true);
  assert.equal(all.some((row) => row.locationId === "store2"), true);
  assert.equal(own.find((row) => row.productId === "p1").sixMonthSalesTotal, 39);
  assert.equal(own.find((row) => row.productId === "p1").belowSafetyStock, false);
});

test("warehouse return gate blocks missing reason, lines, batch, expiry and excess inventory", () => {
  let state = committed(createStoreReturnToWarehouseDraft(fixture(), { ...actor("STORE", "store1"), sourceLocationId: "store1", warehouseLocationId: "warehouse", returnReason: "", items: [] }));
  const blocked = failed(submitStoreReturnToWarehouse(state, { ...actor("STORE", "store1"), returnOrderId: state.storeReturnOrders[0].id }));
  assert.equal(blocked.validation.workflowType, "STORE_RETURN_WAREHOUSE");
  state = committed(createStoreReturnToWarehouseDraft(fixture(), { ...actor("STORE", "store1"), sourceLocationId: "store1", warehouseLocationId: "warehouse", returnReason: "效期接近", items: [{ productId: "p2", returnQty: 99 }] }));
  const gate = failed(submitStoreReturnToWarehouse(state, { ...actor("STORE", "store1"), returnOrderId: state.storeReturnOrders[0].id }));
  assert.ok(gate.validation.blockingItems.some((item) => item.ruleCode === "BATCH_REQUIRED"));
  assert.ok(gate.validation.blockingItems.some((item) => item.ruleCode === "EXPIRY_REQUIRED"));
  assert.ok(gate.validation.blockingItems.some((item) => item.ruleCode === "RETURN_AVAILABLE_EXCEEDED"));
});

test("store return to warehouse approval does not move inventory until shipment", () => {
  const initial = fixture();
  const { state: approved, returnOrderId } = approvedWarehouseReturn(initial, 10);
  assert.equal(approved.storeReturnOrders[0].status, "APPROVED");
  assert.equal(inventory(approved, "store1", "p1").onHandQty, 20);
  assert.equal(inventory(approved, "warehouse", "p1").onHandQty, 50);
  assert.equal(approved.inventoryMovements.length, 0);
  const shipped = committed(shipStoreReturnToWarehouse(approved, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId, operationId: "return-wh-out-1" }));
  assert.equal(inventory(shipped, "store1", "p1").onHandQty, 10);
  assert.equal(inventory(shipped, "store1", "p1").returnInTransitQty, 10);
  assert.equal(inventory(shipped, "warehouse", "p1").onHandQty, 50);
  assert.equal(shipped.inventoryMovements[0].movementType, "STORE_RETURN_TO_WAREHOUSE_OUT");
});

test("warehouse receives store return and adds warehouse inventory only at receipt", () => {
  const { state: approved, returnOrderId } = approvedWarehouseReturn(fixture(), 10);
  const shipped = committed(shipStoreReturnToWarehouse(approved, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId, operationId: "return-wh-out-2" }));
  const received = committed(receiveStoreReturnToWarehouse(shipped, { ...actor("WAREHOUSE", "warehouse"), returnOrderId, operationId: "return-wh-in-1" }));
  assert.equal(inventory(received, "warehouse", "p1").onHandQty, 60);
  assert.equal(inventory(received, "store1", "p1").returnInTransitQty, 0);
  assert.equal(received.storeReturnOrders[0].status, "RECEIVED_BY_WAREHOUSE");
  assert.equal(received.inventoryMovements[0].movementType, "STORE_RETURN_TO_WAREHOUSE_IN");
});

test("warehouse partial rejection requires reason and can return rejected quantity to store", () => {
  const { state: approved, returnOrderId } = approvedWarehouseReturn(fixture(), 10);
  const shipped = committed(shipStoreReturnToWarehouse(approved, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId, operationId: "return-wh-out-3" }));
  const itemId = warehouseReturnItem(shipped, returnOrderId).id;
  failed(receiveStoreReturnToWarehouse(shipped, { ...actor("WAREHOUSE", "warehouse"), returnOrderId, operationId: "return-wh-in-no-reason", items: [{ itemId, receivedQty: 5, rejectedQty: 5 }] }));
  const partial = committed(receiveStoreReturnToWarehouse(shipped, { ...actor("WAREHOUSE", "warehouse"), returnOrderId, operationId: "return-wh-in-2", items: [{ itemId, receivedQty: 5, rejectedQty: 5, reason: "包裝破損" }] }));
  assert.equal(partial.storeReturnOrders[0].status, "RETURNED_TO_STORE");
  assert.equal(inventory(partial, "warehouse", "p1").onHandQty, 55);
  const returned = committed(receiveRejectedStoreReturnAtStore(partial, { ...actor("STORE", "store1"), returnOrderId, operationId: "return-wh-back-1" }));
  assert.equal(inventory(returned, "store1", "p1").onHandQty, 15);
  assert.equal(returned.inventoryMovements[0].movementType, "STORE_RETURN_REJECTED_BACK_TO_STORE");
});

test("warehouse return over-shipment rolls back source inventory and return-in-transit", () => {
  const { state: approved, returnOrderId } = approvedWarehouseReturn(fixture(), 10);
  const result = failed(shipStoreReturnToWarehouse(approved, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId, operationId: "return-wh-over", items: [{ itemId: warehouseReturnItem(approved, returnOrderId).id, shippedQty: 11 }] }));
  assert.equal(result.state, approved);
  assert.equal(inventory(approved, "store1", "p1").onHandQty, 20);
  assert.equal(inventory(approved, "store1", "p1").returnInTransitQty, 0);
});

test("direct supplier return requires manager, purchasing and supplier confirmation before shipment", () => {
  const { state: ready, returnOrderId } = supplierConfirmedStoreReturn(fixture(), 5);
  assert.equal(ready.supplierReturns[0].status, "SUPPLIER_CONFIRMED");
  assert.equal(inventory(ready, "store1", "p1").onHandQty, 20);
  const shipped = committed(shipStoreSupplierReturn(ready, { ...actor("STORE", "store1"), returnOrderId, operationId: "return-supplier-out-1" }));
  assert.equal(shipped.supplierReturns[0].status, "WAITING_RESOLUTION");
  assert.equal(inventory(shipped, "store1", "p1").onHandQty, 15);
  assert.equal(inventory(shipped, "warehouse", "p1").onHandQty, 50);
  assert.equal(shipped.inventoryMovements[0].movementType, "STORE_RETURN_TO_SUPPLIER_OUT");
});

test("direct supplier shipment is blocked before purchasing review and does not change inventory", () => {
  let state = committed(createStoreSupplierReturnDraft(fixture(), { ...actor("STORE", "store1"), sourceLocationId: "store1", supplierId: "supplier1", returnReason: "品質問題", items: [{ productId: "p1", returnQty: 5, reasonCode: "QUALITY_ISSUE" }] }));
  const id = state.supplierReturns[0].id;
  state = committed(submitStoreSupplierReturn(state, { ...actor("STORE", "store1"), returnOrderId: id }));
  state = committed(approveStoreSupplierReturnByManager(state, { ...actor("STORE", "store1", "store1-manager", true), returnOrderId: id }));
  failed(shipStoreSupplierReturn(state, { ...actor("STORE", "store1"), returnOrderId: id, operationId: "supplier-before-review" }));
  assert.equal(inventory(state, "store1", "p1").onHandQty, 20);
});

test("supplier rejection returns goods to store only after store receipt", () => {
  const { state: ready, returnOrderId, itemId } = supplierConfirmedStoreReturn(fixture(), 5);
  let state = committed(shipStoreSupplierReturn(ready, { ...actor("STORE", "store1"), returnOrderId, operationId: "supplier-reject-out" }));
  state = committed(recordStoreSupplierReturnResolution(state, { ...actor("PURCHASING", "warehouse", "buyer"), returnOrderId, returnOrderItemId: itemId, resolutionType: "REJECTED", resolutionQty: 5, supplierResponse: "廠商拒收" }));
  assert.equal(state.supplierReturns[0].status, "PARTIALLY_RESOLVED");
  const returned = committed(receiveStoreSupplierRejected(state, { ...actor("STORE", "store1"), returnOrderId, operationId: "supplier-reject-in" }));
  assert.equal(inventory(returned, "store1", "p1").onHandQty, 20);
  assert.equal(returned.supplierReturns[0].status, "RESOLVED");
  assert.equal(returned.inventoryMovements[0].movementType, "SUPPLIER_RETURN_REJECTED_BACK_TO_STORE");
});

test("supplier replacement is added to store inventory only after store receipt", () => {
  const { state: ready, returnOrderId, itemId } = supplierConfirmedStoreReturn(fixture(), 5);
  let state = committed(shipStoreSupplierReturn(ready, { ...actor("STORE", "store1"), returnOrderId, operationId: "supplier-replace-out" }));
  state = committed(recordStoreSupplierReturnResolution(state, { ...actor("PURCHASING", "warehouse", "buyer"), returnOrderId, returnOrderItemId: itemId, resolutionType: "REPLACEMENT", resolutionQty: 5, supplierResponse: "補寄相同商品" }));
  assert.equal(inventory(state, "store1", "p1").onHandQty, 15);
  const received = committed(receiveStoreSupplierReplacement(state, { ...actor("STORE", "store1"), returnOrderId, returnOrderItemId: itemId, receivedQty: 5, operationId: "supplier-replace-in" }));
  assert.equal(inventory(received, "store1", "p1").onHandQty, 20);
  assert.equal(received.inventoryMovements[0].movementType, "SUPPLIER_REPLACEMENT_RECEIPT_STORE");
  assert.equal(received.supplierReturns[0].status, "RESOLVED");
});

test("return attachments use private keys and enforce role and store isolation", () => {
  const { state: direct, returnOrderId } = supplierConfirmedStoreReturn(fixture(), 2);
  const uploaded = committed(uploadStoreReturnAttachment(direct, { ...actor("STORE", "store1"), returnOrderId, fileName: "damage.jpg", fileType: "image/jpeg", fileSize: 100, storageKey: "private/store1/damage" }));
  assert.equal(uploaded.supplierReturnAttachments[0].storageKey, "private/store1/damage");
  assert.equal(uploaded.auditLogs[0].afterData.storageKey, undefined);
  assert.equal(uploaded.supplierReturnAttachments[0].storageKey.startsWith("private/"), true);
  failed(uploadStoreReturnAttachment(uploaded, { ...actor("STORE", "store2"), returnOrderId, fileName: "damage.jpg", fileType: "image/jpeg", fileSize: 100, storageKey: "private/store2/damage" }));
  failed(uploadStoreReturnAttachment(uploaded, { ...actor("STORE", "store1"), returnOrderId, fileName: "damage.exe", fileType: "application/octet-stream", fileSize: 100, storageKey: "public/damage" }));
});

test("store direct return view hides purchasing notes from store and isolates other stores", () => {
  const { state: direct, returnOrderId } = supplierConfirmedStoreReturn(fixture(), 2);
  const store = getStoreOperationsForRole(direct, { role: "STORE", locationId: "store1" });
  const other = getStoreOperationsForRole(direct, { role: "STORE", locationId: "store2" });
  assert.equal(store.supplierReturns[0].id, returnOrderId);
  assert.equal(store.supplierReturns[0].purchasingNote, "");
  assert.equal(other.supplierReturns.length, 0);
});

test("direct supplier over-shipment rolls back store inventory and movement records", () => {
  const { state: ready, returnOrderId, itemId } = supplierConfirmedStoreReturn(fixture(), 5);
  const result = failed(shipStoreSupplierReturn(ready, { ...actor("STORE", "store1"), returnOrderId, operationId: "supplier-over", items: [{ itemId, shippedQty: 6 }] }));
  assert.equal(result.state, ready);
  assert.equal(inventory(ready, "store1", "p1").onHandQty, 20);
  assert.equal(ready.inventoryMovements.length, 0);
});

test("shortage gate blocks negative, over-open, missing reason, OTHER without note and inactive alternative", () => {
  const state = fixture();
  const line = state.purchaseOrders[0].lines[0];
  assert.ok(validatePurchaseItemShortageGate(line, { shortageQty: -1, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK" }, state.products).blockingItems.some((item) => item.ruleCode === "SHORTAGE_QTY_NON_NEGATIVE"));
  assert.ok(validatePurchaseItemShortageGate(line, { shortageQty: 21, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK" }, state.products).blockingItems.some((item) => item.ruleCode === "SHORTAGE_QTY_EXCEEDS_OPEN"));
  assert.ok(validatePurchaseItemShortageGate(line, { shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "" }, state.products).blockingItems.some((item) => item.ruleCode === "SHORTAGE_REASON_REQUIRED"));
  assert.ok(validatePurchaseItemShortageGate(line, { shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "OTHER", shortageNote: "" }, state.products).blockingItems.some((item) => item.ruleCode === "SHORTAGE_OTHER_NOTE_REQUIRED"));
  assert.ok(validatePurchaseItemShortageGate(line, { shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK", alternativeProductId: "inactive-product" }, state.products).blockingItems.some((item) => item.ruleCode === "ALTERNATIVE_PRODUCT_ACTIVE_REQUIRED"));
});

test("shortage is maintained per purchase item, creates follow-up history and replies to store", () => {
  const state = fixture();
  const updated = committed(updatePurchaseOrderItemShortage(state, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 8, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK", shortageNote: "廠商暫無庫存", storeVisibleShortageNote: "商品 A 預計下週補貨", supplierResponseNote: "供應商已回覆" }));
  const lineA = updated.purchaseOrders[0].lines.find((line) => line.id === "line-a");
  const lineB = updated.purchaseOrders[0].lines.find((line) => line.id === "line-b");
  assert.equal(lineA.shortageQty, 8);
  assert.equal(lineB.shortageQty, 0);
  assert.equal(updated.purchaseOrderItemFollowups.length, 1);
  assert.equal(updated.demands[0].items.find((item) => item.id === "d1-item").purchaseShortageQty, 8);
  const visible = getStorePurchaseStatus(updated, { role: "STORE", locationId: "store1" });
  assert.equal(visible[0].storeVisibleNote, "商品 A 預計下週補貨");
  assert.equal(visible[0].internalNote, undefined);
});

test("shortage update rolls back on invalid quantity and service enforces OTHER note", () => {
  const original = fixture();
  const over = failed(updatePurchaseOrderItemShortage(original, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 21, shortageStatus: "FULL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK" }));
  assert.equal(over.state, original);
  assert.equal(original.purchaseOrders[0].lines[0].shortageQty, 0);
  failed(updatePurchaseOrderItemShortage(original, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "OTHER", shortageNote: "" }));
  const negative = failed(updatePurchaseOrderItemShortage(original, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: -1, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK" }));
  assert.equal(negative.state, original);
});

test("shortage requeue, no-group and alternative operations keep item-level history", () => {
  let state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK", shortageNote: "重新處理" }));
  state = committed(requeuePurchaseOrderItemShortage(state, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", action: "REQUEUE", reason: "納入下一次採購池" }));
  assert.equal(state.purchaseOrders[0].lines[0].shortageRequeueStatus, "REQUEUED");
  assert.equal(state.purchaseOrderItemFollowups.length, 2);
  let alternativeState = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK", shortageNote: "替代來源" }));
  alternativeState = committed(setPurchaseOrderItemAlternative(alternativeState, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", alternativeProductId: "p2", note: "改採批號商品" }));
  assert.equal(alternativeState.purchaseOrders[0].lines[0].shortageStatus, "ALTERNATIVE_AVAILABLE");
  assert.equal(alternativeState.purchaseOrderItemFollowups.length, 2);
  const cancelledState = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK", shortageNote: "取消" }));
  const cancelled = committed(cancelPurchaseOrderItemShortage(cancelledState, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", quantity: 5, reason: "門市取消需求" }));
  assert.equal(cancelled.purchaseOrderItemFollowups.length, 2);
  assert.equal(cancelled.purchaseOrders[0].lines[0].shortageStatus, "CANCELLED");
});

test("inactive alternative product is rejected without changing the purchase item", () => {
  let state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", shortageQty: 5, shortageStatus: "PARTIAL_SHORTAGE", shortageReason: "SUPPLIER_NO_STOCK", shortageNote: "替代商品測試" }));
  const before = structuredClone(state.purchaseOrders[0].lines[0]);
  failed(setPurchaseOrderItemAlternative(state, { ...actor("PURCHASING", "warehouse", "buyer"), purchaseOrderId: "po1", purchaseOrderItemId: "line-a", alternativeProductId: "inactive-product", note: "不可用" }));
  assert.deepEqual(state.purchaseOrders[0].lines[0], before);
});
