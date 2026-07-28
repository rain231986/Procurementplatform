import test from "node:test";
import assert from "node:assert/strict";
import {
  PURCHASE_DEMAND_STATUSES,
  aggregatePurchaseSuggestions,
  applyPurchaseReceipt,
  buildDemandPurchaseAllocations,
  calculatePurchaseOrderTotals,
  calculatePurchaseQuantity,
  canManagePurchaseOrders,
  canReceivePurchaseOrders,
  canViewPurchaseOrders,
  cancelPurchaseOrder,
  centsToDecimal,
  closePurchaseOrder,
  createManualPurchaseOrderDraft,
  createPurchaseOrderDraft,
  decimalToCents,
  getPurchaseOrderMetrics,
  isPurchaseDemandEligible,
  orderSourceTrace,
  validatePurchaseOrderConfirmation,
  transitionPurchaseOrder,
  canEditPurchaseOrderField,
} from "../procurement-workflow.js";

const products = [
  { id: "product-a", productCode: "A", name: "商品 A", specification: "10入/盒", isActive: true, supplierId: "supplier-1" },
  { id: "product-b", productCode: "B", name: "商品 B", specification: "1台/件", isActive: true, supplierId: "supplier-2" },
];
const suppliers = [
  { id: "supplier-1", name: "供應商甲", isActive: true, minimumOrderAmount: "5000.00" },
  { id: "supplier-2", name: "供應商乙", isActive: true, minimumOrderAmount: "0.00" },
];
const supplierProducts = [
  { id: "sp-a", productId: "product-a", supplierId: "supplier-1", purchaseUnit: "盒", purchaseMultiple: 12, minimumOrderQuantity: 24, minimumOrderAmount: "5000.00", purchasePrice: "115.00", supplierProductCode: "A-甲", isPrimary: true, isActive: true },
  { id: "sp-b", productId: "product-b", supplierId: "supplier-2", purchaseUnit: "件", purchaseMultiple: 1, minimumOrderQuantity: 1, minimumOrderAmount: "0.00", purchasePrice: "0.10", supplierProductCode: "B-乙", isPrimary: true, isActive: true },
];

function demand(id, item, status = "WAITING_PURCHASE", locationId = "store-1") {
  return { id, demandNumber: `DN-${id}`, locationId, status, sourceType: "MANUAL", items: [{ id: `${id}-item`, productId: "product-a", requestedQty: item, approvedQty: item, allocatedQty: 0, receivedQty: 0 }] };
}

function baseState(order) {
  return {
    purchaseOrders: [order],
    inventory: [{ id: "balance-a", locationId: "warehouse", productId: "product-a", onHandQty: 5, reservedQty: 0 }],
    demands: [demand("demand-1", 18)],
    demandPurchaseAllocations: [],
    auditLogs: [],
  };
}

test("only approved/open demand statuses enter the purchase pool", () => {
  assert.deepEqual(PURCHASE_DEMAND_STATUSES, ["SUBMITTED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"]);
  assert.equal(isPurchaseDemandEligible("SUBMITTED"), true);
  assert.equal(isPurchaseDemandEligible("PENDING_MANAGER_APPROVAL"), false);
  assert.equal(isPurchaseDemandEligible("COMPLETED"), false);
});

test("raw demand plus MOQ and multiple keeps warehouse buffer separate", () => {
  const result = calculatePurchaseQuantity({ demandAllocatedQty: 38, warehouseSupplementQty: 0, minimumOrderQuantity: 24, purchaseMultiple: 12, unitPrice: "10.00" });
  assert.deepEqual(result, {
    demandAllocatedQty: 38,
    warehouseSupplementQty: 0,
    rawPurchaseQty: 38,
    minimumOrderQuantity: 24,
    purchaseMultiple: 12,
    minimumAdjustedQty: 38,
    suggestedPurchaseQty: 48,
    confirmedPurchaseQty: 48,
    overageQty: 10,
    warehouseBufferQty: 10,
    estimatedAmountCents: 48000,
    minimumAmountCents: 0,
    minimumAmountMet: true,
    minimumAmountShortfallCents: 0,
  });
});

test("invalid purchase multiple is treated as one", () => {
  const result = calculatePurchaseQuantity({ demandAllocatedQty: 5, minimumOrderQuantity: 2, purchaseMultiple: 0 });
  assert.equal(result.suggestedPurchaseQty, 5);
  assert.equal(result.purchaseMultiple, 1);
});

test("MOQ is applied before rounding to a purchase multiple", () => {
  const result = calculatePurchaseQuantity({ demandAllocatedQty: 3, minimumOrderQuantity: 10, purchaseMultiple: 4 });
  assert.equal(result.minimumAdjustedQty, 10);
  assert.equal(result.suggestedPurchaseQty, 12);
  assert.equal(result.warehouseBufferQty, 9);
});

test("aggregation groups by supplier and purchase conditions", () => {
  const sameProduct = [
    { ...supplierProducts[0], id: "sp-a-1", purchaseUnit: "盒", purchaseMultiple: 12, minimumOrderQuantity: 24 },
    { ...supplierProducts[1], id: "sp-b-2", purchaseUnit: "箱", purchaseMultiple: 6, minimumOrderQuantity: 6, purchasePrice: "100.00", isPrimary: true },
  ];
  const result = aggregatePurchaseSuggestions({
    demands: [demand("d1", 10, "SUBMITTED"), { ...demand("d2", 8, "SUBMITTED", "store-2"), items: [{ ...demand("d2", 8).items[0], id: "d2-item", productId: "product-b" }] }],
    products,
    suppliers,
    supplierProducts: sameProduct,
    demandPurchaseAllocations: [],
  });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.supplierId).sort(), ["supplier-1", "supplier-2"]);
});

test("aggregation preserves source stores and demand item quantities", () => {
  const result = aggregatePurchaseSuggestions({
    demands: [demand("d1", 10, "SUBMITTED", "store-1"), demand("d2", 8, "PARTIALLY_ALLOCATED", "store-2")],
    products,
    suppliers,
    supplierProducts,
    demandPurchaseAllocations: [],
  });
  assert.equal(result[0].rawPurchaseQty, 18);
  assert.equal(result[0].demandAllocatedQty, 18);
  assert.deepEqual(result[0].sourceAllocations.map((item) => item.allocatedQty), [10, 8]);
  assert.deepEqual(result[0].sourceLocationIds.sort(), ["store-1", "store-2"]);
  assert.equal(result[0].sourceDemandCount, 2);
});

test("existing purchase allocation reduces shortage", () => {
  const result = aggregatePurchaseSuggestions({
    demands: [demand("d1", 18)],
    products,
    suppliers,
    supplierProducts,
    demandPurchaseAllocations: [{ demandOrderId: "d1", demandOrderItemId: "d1-item", allocatedQty: 8, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 }],
  });
  assert.equal(result[0].rawPurchaseQty, 10);
});

test("cancelling a purchase allocation returns the active quantity to the pool", () => {
  const result = aggregatePurchaseSuggestions({
    demands: [demand("d1", 18)],
    products,
    suppliers,
    supplierProducts,
    demandPurchaseAllocations: [{ demandOrderId: "d1", demandOrderItemId: "d1-item", allocatedQty: 18, receivedAllocatedQty: 0, cancelledAllocatedQty: 8 }],
  });
  assert.equal(result[0].rawPurchaseQty, 8);
});

test("completed and cancelled demand are excluded from aggregation", () => {
  const result = aggregatePurchaseSuggestions({
    demands: [demand("d1", 18, "COMPLETED"), demand("d2", 12, "CANCELLED")],
    products,
    suppliers,
    supplierProducts,
    demandPurchaseAllocations: [],
  });
  assert.equal(result.length, 0);
});

test("supplier minimum amount uses integer cents without floating point drift", () => {
  const totals = calculatePurchaseOrderTotals([
    { orderedQty: 3, unitPrice: "0.10" },
    { orderedQty: 1, unitPrice: "0.20" },
  ], { supplierMinimumOrderAmount: "0.50" });
  assert.equal(decimalToCents("0.10") * 3 + decimalToCents("0.20"), 50);
  assert.equal(totals.subtotalCents, 50);
  assert.equal(centsToDecimal(totals.totalCents), "0.50");
  assert.equal(totals.minimumAmountMet, true);
});

test("supplier minimum amount exposes the shortfall", () => {
  const totals = calculatePurchaseOrderTotals([{ orderedQty: 2, unitPrice: "1600.00" }], { supplierMinimumOrderAmount: "5000.00" });
  assert.equal(totals.totalCents, 320000);
  assert.equal(totals.minimumAmountMet, false);
  assert.equal(totals.minimumAmountShortfallCents, 180000);
});

test("purchase order confirmation rejects a non-multiple", () => {
  const order = createPurchaseOrderDraft({
    id: "po-1", purchaseOrderNumber: "PO-20260723-0001", supplierId: "supplier-1", supplier: suppliers[0], products, supplierProducts,
    suggestions: [{ id: "suggestion-1", productId: "product-a", supplierId: "supplier-1", rawPurchaseQty: 18, suggestedPurchaseQty: 24, confirmedPurchaseQty: 18, sourceAllocations: [] }],
    orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer",
  });
  const result = validatePurchaseOrderConfirmation(order, { suppliers, products, supplierProducts });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /倍數/);
});

test("override reason permits a quantity exception", () => {
  const order = createPurchaseOrderDraft({
    id: "po-2", purchaseOrderNumber: "PO-20260723-0002", supplierId: "supplier-1", supplier: suppliers[0], products, supplierProducts,
    suggestions: [{ id: "suggestion-2", productId: "product-a", supplierId: "supplier-1", rawPurchaseQty: 18, suggestedPurchaseQty: 24, confirmedPurchaseQty: 18, sourceAllocations: [] }],
    orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer", overrideReason: "供應商確認可拆箱出貨",
  });
  const result = validatePurchaseOrderConfirmation(order, { suppliers, products, supplierProducts });
  assert.equal(result.valid, true);
  assert.equal(result.overrideRequired, true);
});

test("MOQ failure requires an exception reason", () => {
  const order = createManualPurchaseOrderDraft({
    id: "po-3", purchaseOrderNumber: "PO-20260723-0003", supplier: suppliers[0], supplierProducts, products,
    supplierId: "supplier-1", items: [{ productId: "product-a", orderedQty: 12, unitPrice: "115.00", reason: "總倉備貨" }],
    orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer",
  });
  const result = validatePurchaseOrderConfirmation(order, { suppliers, products, supplierProducts });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /最低採購量/);
});

test("minimum amount failure is formal at PO confirmation", () => {
  const order = createManualPurchaseOrderDraft({
    id: "po-4", purchaseOrderNumber: "PO-20260723-0004", supplier: suppliers[0], supplierProducts, products,
    supplierId: "supplier-1", items: [{ productId: "product-a", orderedQty: 24, unitPrice: "115.00", reason: "總倉備貨" }],
    orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer",
  });
  const result = validatePurchaseOrderConfirmation(order, { suppliers, products, supplierProducts });
  assert.equal(result.minimumAmountMet, false);
  assert.equal(result.minimumAmountShortfallCents, 224000);
  assert.equal(result.valid, false);
});

test("confirmation validates active supplier, product and expected date", () => {
  const order = createManualPurchaseOrderDraft({
    id: "po-5", purchaseOrderNumber: "PO-20260723-0005", supplier: suppliers[0], supplierProducts, products,
    supplierId: "supplier-1", items: [{ productId: "product-a", orderedQty: 24, unitPrice: "300.00", reason: "總倉備貨" }],
    orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-22", createdBy: "buyer",
  });
  const result = validatePurchaseOrderConfirmation(order, { suppliers: [{ ...suppliers[0], isActive: false }], products, supplierProducts });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /供應商|到貨日/);
});

test("a suggestion already linked to another PO cannot be duplicated", () => {
  const order = createPurchaseOrderDraft({
    id: "po-6", purchaseOrderNumber: "PO-20260723-0006", supplierId: "supplier-1", supplier: suppliers[0], products, supplierProducts,
    suggestions: [{ id: "suggestion-6", productId: "product-a", supplierId: "supplier-1", rawPurchaseQty: 24, suggestedPurchaseQty: 24, confirmedPurchaseQty: 24, sourceAllocations: [] }],
    orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer",
  });
  const result = validatePurchaseOrderConfirmation(order, { suppliers, products, supplierProducts, existingSuggestionIds: ["suggestion-6"] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /重複/);
});

test("suggestion PO keeps demand source allocations and warehouse buffer", () => {
  const suggestion = { id: "suggestion-7", productId: "product-a", supplierId: "supplier-1", rawPurchaseQty: 18, suggestedPurchaseQty: 24, confirmedPurchaseQty: 24, demandAllocatedQty: 18, warehouseBufferQty: 6, sourceAllocations: [{ demandOrderId: "d1", demandOrderItemId: "d1-item", locationId: "store-1", allocatedQty: 10 }] };
  const order = createPurchaseOrderDraft({ id: "po-7", purchaseOrderNumber: "PO-20260723-0007", supplierId: "supplier-1", supplier: suppliers[0], products, supplierProducts, suggestions: [suggestion], orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer" });
  assert.equal(order.lines[0].warehouseBufferQty, 14);
  assert.equal(order.lines[0].rawPurchaseQty, 18);
  assert.equal(order.lines[0].demandAllocatedQty, 10);
  assert.equal(order.lines[0].warehouseSupplementQty, 0);
  assert.equal(order.lines[0].suggestedPurchaseQty, 24);
  assert.equal(order.lines[0].confirmedPurchaseQty, 24);
  assert.equal(order.lines[0].multipleOverageQty, 6);
  assert.equal(order.lines[0].sourceAllocations[0].allocatedQty, 10);
  assert.equal(order.lines[0].orderedQty, 24);
});

test("manual PO puts all unsourced quantity into warehouse buffer", () => {
  const order = createManualPurchaseOrderDraft({ id: "po-8", purchaseOrderNumber: "PO-20260723-0008", supplier: suppliers[1], supplierProducts, products, supplierId: "supplier-2", items: [{ productId: "product-b", orderedQty: 7, unitPrice: "0.10", reason: "總倉安全庫存補充" }], orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer" });
  assert.equal(order.sourceType, "MANUAL");
  assert.equal(order.lines[0].warehouseBufferQty, 7);
  assert.equal(order.lines[0].warehouseSupplementQty, 7);
  assert.equal(order.lines[0].multipleOverageQty, 0);
  assert.deepEqual(order.lines[0].sourceAllocations, []);
});

test("PO source allocations become traceable relation rows", () => {
  const order = createPurchaseOrderDraft({ id: "po-9", purchaseOrderNumber: "PO-20260723-0009", supplierId: "supplier-1", supplier: suppliers[0], products, supplierProducts, suggestions: [{ id: "s9", productId: "product-a", supplierId: "supplier-1", confirmedPurchaseQty: 24, sourceAllocations: [{ demandOrderId: "d1", demandOrderItemId: "d1-item", allocatedQty: 18 }] }], orderDate: "2026-07-23", expectedDeliveryDate: "2026-07-24", createdBy: "buyer" });
  const rows = buildDemandPurchaseAllocations(order);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { id: null, demandOrderId: "d1", demandOrderItemId: "d1-item", purchaseOrderId: "po-9", purchaseOrderItemId: order.lines[0].id, allocatedQty: 18, receivedAllocatedQty: 0, cancelledAllocatedQty: 0, createdAt: null, updatedAt: null });
});

test("PO status flow supports confirmation, order, receipt and close", () => {
  const order = { id: "po-flow", status: "DRAFT", lines: [{ orderedQty: 1, receivedQty: 0, cancelledQty: 0 }] };
  const pending = transitionPurchaseOrder(order, "PENDING_CONFIRMATION", { actorId: "buyer", changedAt: "2026-07-23 10:00" });
  const ordered = transitionPurchaseOrder(pending.order, "ORDERED", { actorId: "buyer", changedAt: "2026-07-23 10:01" });
  assert.equal(ordered.order.status, "ORDERED");
  assert.equal(ordered.order.orderedBy, "buyer");
});

test("invalid PO transition is rejected", () => {
  const result = transitionPurchaseOrder({ status: "DRAFT", lines: [] }, "RECEIVED", { actorId: "buyer" });
  assert.equal(result.valid, false);
});

test("DRAFT fields are editable and ORDERED content is locked", () => {
  assert.equal(canEditPurchaseOrderField("DRAFT", "orderedQty"), true);
  assert.equal(canEditPurchaseOrderField("DRAFT", "unitPrice"), true);
  assert.equal(canEditPurchaseOrderField("ORDERED", "expectedDeliveryDate"), true);
  assert.equal(canEditPurchaseOrderField("ORDERED", "orderedQty"), false);
  assert.equal(canEditPurchaseOrderField("CLOSED", "notes"), false);
});

test("remaining quantity is ordered minus received minus cancelled, clamped at zero", () => {
  const metrics = getPurchaseOrderMetrics({ lines: [{ orderedQty: 24, receivedQty: 10, cancelledQty: 20 }] });
  assert.equal(metrics.remainingQty, 0);
  assert.equal(metrics.cancelledQty, 20);
});

test("partial receipt increases warehouse inventory and source demand receipt", () => {
  const order = { id: "po-receive", status: "ORDERED", lines: [{ id: "line-r", productId: "product-a", orderedQty: 24, receivedQty: 0, cancelledQty: 0, sourceAllocations: [{ demandOrderId: "demand-1", demandOrderItemId: "demand-1-item", allocatedQty: 18 }] }] };
  const state = baseState(order);
  state.demandPurchaseAllocations = buildDemandPurchaseAllocations(order);
  const result = applyPurchaseReceipt(state, { orderId: order.id, receivedByLine: { "line-r": 10 }, actorId: "warehouse", actorRole: "WAREHOUSE", receivedAt: "2026-07-23", note: "先到一箱" });
  assert.equal(result.committed, true);
  assert.equal(result.state.purchaseOrders[0].lines[0].receivedQty, 10);
  assert.equal(result.state.purchaseOrders[0].status, "PARTIALLY_RECEIVED");
  assert.equal(result.state.inventory[0].onHandQty, 15);
  assert.equal(result.state.demandPurchaseAllocations[0].receivedAllocatedQty, 10);
  assert.equal(result.state.demands[0].items[0].purchaseReceivedQty, 10);
});

test("full receipt changes status to RECEIVED and tracks completion date", () => {
  const order = { id: "po-full", status: "ORDERED", lines: [{ id: "line-full", productId: "product-a", orderedQty: 10, receivedQty: 0, cancelledQty: 0, sourceAllocations: [] }] };
  const state = baseState(order);
  const result = applyPurchaseReceipt(state, { orderId: order.id, receivedByLine: { "line-full": 10 }, actorId: "warehouse", actorRole: "WAREHOUSE", receivedAt: "2026-07-23" });
  assert.equal(result.state.purchaseOrders[0].status, "RECEIVED");
  assert.equal(result.state.purchaseOrders[0].actualCompletedDate, "2026-07-23");
});

test("over-receipt rejects without changing inventory or PO", () => {
  const order = { id: "po-over", status: "ORDERED", lines: [{ id: "line-over", productId: "product-a", orderedQty: 10, receivedQty: 0, cancelledQty: 0, sourceAllocations: [] }] };
  const state = baseState(order);
  const result = applyPurchaseReceipt(state, { orderId: order.id, receivedByLine: { "line-over": 11 }, actorId: "warehouse", actorRole: "WAREHOUSE", receivedAt: "2026-07-23" });
  assert.equal(result.committed, false);
  assert.equal(state.inventory[0].onHandQty, 5);
  assert.equal(state.purchaseOrders[0].lines[0].receivedQty, 0);
});

test("receipt transaction rolls back when warehouse balance is missing", () => {
  const order = { id: "po-rollback", status: "ORDERED", lines: [{ id: "line-rollback", productId: "product-a", orderedQty: 10, receivedQty: 0, cancelledQty: 0, sourceAllocations: [] }] };
  const state = { ...baseState(order), inventory: [] };
  const result = applyPurchaseReceipt(state, { orderId: order.id, receivedByLine: { "line-rollback": 3 }, actorId: "warehouse", actorRole: "WAREHOUSE", receivedAt: "2026-07-23" });
  assert.equal(result.committed, false);
  assert.equal(result.state.purchaseOrders[0].lines[0].receivedQty, 0);
});

test("WAREHOUSE and ADMIN may receive, PURCHASING may not", () => {
  assert.equal(canReceivePurchaseOrders({ role: "WAREHOUSE", isActive: true }), true);
  assert.equal(canReceivePurchaseOrders({ role: "ADMIN", isActive: true }), true);
  assert.equal(canReceivePurchaseOrders({ role: "PURCHASING", isActive: true }), false);
});

test("whole PO cancellation requires a reason and preserves no receipt", () => {
  const order = { id: "po-cancel", status: "ORDERED", lines: [{ id: "line-cancel", orderedQty: 10, receivedQty: 0, cancelledQty: 0 }] };
  const invalid = cancelPurchaseOrder(order, { reason: "", actorId: "buyer", cancelledAt: "2026-07-23" });
  assert.equal(invalid.committed, false);
  const valid = cancelPurchaseOrder(order, { reason: "供應商停止供貨", actorId: "buyer", cancelledAt: "2026-07-23" });
  assert.equal(valid.committed, true);
  assert.equal(valid.order.status, "CANCELLED");
  assert.equal(valid.order.lines[0].cancelledQty, 10);
});

test("remaining cancellation returns uncovered demand to the purchase pool", () => {
  const order = { id: "po-cancel-remain", status: "PARTIALLY_RECEIVED", lines: [{ id: "line-cancel-remain", productId: "product-a", orderedQty: 24, receivedQty: 10, cancelledQty: 0, sourceAllocations: [{ demandOrderId: "demand-1", demandOrderItemId: "demand-1-item", allocatedQty: 18, receivedAllocatedQty: 10 }] }] };
  const state = baseState(order);
  state.demandPurchaseAllocations = buildDemandPurchaseAllocations(order);
  const result = cancelPurchaseOrder(state, { orderId: order.id, remainingOnly: true, reason: "供應商缺貨", actorId: "buyer", cancelledAt: "2026-07-23" });
  assert.equal(result.committed, true);
  assert.equal(result.state.purchaseOrders[0].lines[0].cancelledQty, 14);
  assert.equal(result.state.purchaseOrders[0].lines[0].remainingQty, 0);
  assert.equal(result.state.demandPurchaseAllocations[0].cancelledAllocatedQty, 8);
  assert.equal(result.state.demands[0].items[0].purchaseOrderedQty, 10);
});

test("a PO can close only when every line has no remaining quantity", () => {
  const open = closePurchaseOrder({ id: "po-open", status: "PARTIALLY_RECEIVED", lines: [{ orderedQty: 10, receivedQty: 3, cancelledQty: 0 }] }, { actorId: "buyer", closedAt: "2026-07-23" });
  assert.equal(open.committed, false);
  const closed = closePurchaseOrder({ id: "po-closed", status: "PARTIALLY_RECEIVED", lines: [{ orderedQty: 10, receivedQty: 3, cancelledQty: 7 }] }, { actorId: "buyer", closedAt: "2026-07-23" });
  assert.equal(closed.committed, true);
  assert.equal(closed.order.status, "CLOSED");
});

test("source trace lists stores, demands and warehouse buffer without hiding quantities", () => {
  const order = { id: "po-trace", lines: [{ id: "line-trace", productId: "product-a", orderedQty: 24, warehouseBufferQty: 6, sourceAllocations: [{ demandOrderId: "demand-1", demandOrderItemId: "demand-1-item", locationId: "store-1", allocatedQty: 18 }] }] };
  const trace = orderSourceTrace(order);
  assert.equal(trace[0].warehouseBufferQty, 6);
  assert.equal(trace[0].sources[0].locationId, "store-1");
  assert.equal(trace[0].sources[0].allocatedQty, 18);
});

test("role boundaries cover purchasing, warehouse, admin and store visibility", () => {
  assert.equal(canManagePurchaseOrders({ role: "PURCHASING", isActive: true }), true);
  assert.equal(canManagePurchaseOrders({ role: "WAREHOUSE", isActive: true }), false);
  assert.equal(canManagePurchaseOrders({ role: "ADMIN", isActive: true }), true);
  assert.equal(canViewPurchaseOrders({ role: "STORE", isActive: true }), true);
});
