import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_GROUP_REASONS,
  addManualPurchaseOrderItem,
  applyPurchaseOrderDistributionPlans,
  buildProcurementProductSnapshot,
  buildPurchaseOrderItemDistributionPlans,
  buildPurchaseOrderItemSources,
  calculateCombinedPurchaseQuantity,
  createPurchaseOrderDraft,
  markPurchaseSuggestionNoGroup,
  mergePurchaseOrderItems,
  reopenPurchaseSuggestion,
  validateManualPurchaseItem,
  validatePurchaseOrderDistributionPlans,
} from "../procurement-workflow.js";

const products = [
  { id: "p-a", productCode: "A", name: "商品 A", specification: "10 入", baseUnit: "盒", isActive: true },
  { id: "p-b", productCode: "B", name: "商品 B", specification: "20 入", baseUnit: "盒", isActive: true },
];
const suppliers = [{ id: "sup-a", name: "供應商 A", minimumOrderAmount: "0.00", isActive: true }, { id: "sup-b", name: "供應商 B", minimumOrderAmount: "0.00", isActive: true }];
const supplierProducts = [
  { id: "sp-a", productId: "p-a", supplierId: "sup-a", purchaseUnit: "盒", purchaseMultiple: 2, minimumOrderQuantity: 4, purchasePrice: "10.00", isActive: true },
  { id: "sp-b", productId: "p-b", supplierId: "sup-a", purchaseUnit: "盒", purchaseMultiple: 1, minimumOrderQuantity: 1, purchasePrice: "20.00", isActive: true },
  { id: "sp-b-other", productId: "p-b", supplierId: "sup-b", purchaseUnit: "盒", purchaseMultiple: 1, minimumOrderQuantity: 1, purchasePrice: "30.00", isActive: true },
];
const locations = [
  { id: "store-1", name: "門市一", type: "STORE", isActive: true },
  { id: "store-2", name: "門市二", type: "STORE", isActive: true },
  { id: "store-3", name: "門市三", type: "STORE", isActive: true },
  { id: "store-4", name: "門市四", type: "STORE", isActive: true },
  { id: "store-5", name: "門市五", type: "STORE", isActive: true },
  { id: "warehouse", name: "總倉", type: "WAREHOUSE", isActive: true },
];

const suggestion = {
  id: "suggestion-1",
  supplierId: "sup-a",
  productId: "p-a",
  rawPurchaseQty: 8,
  rawDemandQty: 8,
  demandAllocatedQty: 8,
  warehouseSupplementQty: 0,
  suggestedPurchaseQty: 8,
  confirmedPurchaseQty: 8,
  sourceAllocations: [{ demandOrderId: "demand-1", demandOrderItemId: "demand-item-1", locationId: "store-1", allocatedQty: 8 }],
};

function makeOrder(overrides = {}) {
  return createPurchaseOrderDraft({
    id: overrides.id || "po-1",
    purchaseOrderNumber: "PO-TEST-001",
    supplierId: "sup-a",
    supplier: suppliers[0],
    suppliers,
    products,
    supplierProducts,
    suggestions: overrides.suggestions || [suggestion],
    manualItems: overrides.manualItems || [],
    orderDate: "2026-07-23",
    expectedDeliveryDate: "2026-07-25",
    createdBy: "buyer-1",
    ...overrides,
  });
}

function makeNoGroupState() {
  return {
    purchaseSuggestions: [{ ...suggestion, status: "PENDING" }],
    demands: [{ id: "demand-1", items: [{ id: "demand-item-1", productId: "p-a" }] }],
    auditLogs: [],
    procurementStatusLogs: [],
  };
}

test("同一供應商可加入其他商品", () => {
  const result = mergePurchaseOrderItems({ id: "po", supplierId: "sup-a", suppliers, products, supplierProducts, suggestions: [suggestion], manualItems: [{ productId: "p-b", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.lines.map((line) => line.productId).sort(), ["p-a", "p-b"]);
});

test("不同供應商商品不可加入同一採購單", () => {
  const result = mergePurchaseOrderItems({ id: "po", supplierId: "sup-a", suppliers, products, supplierProducts, suggestions: [suggestion], manualItems: [{ productId: "p-b", supplierId: "sup-b", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  assert.equal(result.valid, false);
});

test("停用供應品不可人工新增", () => {
  const result = validateManualPurchaseItem({ productId: "p-b", supplierId: "sup-a", manualAddedQty: 2, manualReasonCode: "WAREHOUSE_STOCK" }, { suppliers, products, supplierProducts: supplierProducts.map((row) => row.productId === "p-b" && row.supplierId === "sup-a" ? { ...row, isActive: false } : row) });
  assert.equal(result.valid, false);
});

test("同商品會合併為單一採購單明細", () => {
  const order = makeOrder({ manualItems: [{ productId: "p-a", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].sourceType, "MIXED");
});

test("同商品的單位、單價或 MOQ 不一致時拒絕合併", () => {
  const result = mergePurchaseOrderItems({ id: "po", supplierId: "sup-a", suppliers, products, supplierProducts, suggestions: [suggestion], manualItems: [{ productId: "p-a", supplierId: "sup-a", manualAddedQty: 3, unitPrice: "99.00", manualReasonCode: "WAREHOUSE_STOCK" }] });
  assert.equal(result.valid, false);
});

test("人工新增原因必填", () => {
  const result = validateManualPurchaseItem({ productId: "p-b", supplierId: "sup-a", manualAddedQty: 2 }, { suppliers, products, supplierProducts });
  assert.equal(result.valid, false);
});

test("OTHER 原因必須有說明", () => {
  const result = validateManualPurchaseItem({ productId: "p-b", supplierId: "sup-a", manualAddedQty: 2, manualReasonCode: "OTHER" }, { suppliers, products, supplierProducts });
  assert.equal(result.valid, false);
});

test("人工單一商品來源為 MANUAL_ADDITION", () => {
  const order = makeOrder({ suggestions: [], manualItems: [{ productId: "p-b", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  assert.equal(order.lines[0].sourceType, "MANUAL_ADDITION");
  assert.equal(order.lines[0].demandSuggestedQty, 0);
});

test("系統建議與人工數量的 raw_purchase_qty 會合併", () => {
  const order = makeOrder({ manualItems: [{ productId: "p-a", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  const line = order.lines[0];
  assert.equal(line.rawPurchaseQty, 11);
  assert.equal(line.demandSuggestedQty + line.warehouseReplenishmentQty + line.manualAddedQty, 11);
  assert.equal(line.rawPurchaseQtyBeforeManual, 8);
});

test("人工單數量預設為總倉留存，不建立門市需求來源", () => {
  const order = makeOrder({ suggestions: [], manualItems: [{ productId: "p-b", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  assert.equal(order.lines[0].warehouseBufferQty, 3);
  assert.equal(order.lines[0].sourceAllocations.length, 0);
});

test("合併後仍套用 MOQ 與採購倍數", () => {
  const result = calculateCombinedPurchaseQuantity({ suggestedPurchaseQty: 5, manualAddedQty: 1, minimumOrderQuantity: 8, purchaseMultiple: 4, rawDemandQty: 5, rawPurchaseQty: 6, rawPurchaseQtyBeforeManual: 5 });
  assert.equal(result.confirmedPurchaseQty, 8);
});

test("新增人工數量可直接合併到既有明細", () => {
  const order = makeOrder();
  const result = addManualPurchaseOrderItem(order.lines[0], { productId: "p-a", supplierId: "sup-a", manualAddedQty: 2, manualReasonCode: "UPCOMING_PROMOTION" }, { supplierId: "sup-a", suppliers, products, supplierProducts });
  assert.equal(result.valid, true);
  assert.equal(result.line.manualAddedQty, 2);
  assert.equal(result.line.orderedQty, 10);
});

test("來源類型可標示 MIXED", () => {
  const line = makeOrder({ manualItems: [{ productId: "p-a", supplierId: "sup-a", manualAddedQty: 2, manualReasonCode: "WAREHOUSE_STOCK" }] }).lines[0];
  assert.deepEqual(line.sourceTypes.sort(), ["DEMAND_SUGGESTION", "MANUAL_ADDITION"]);
});

test("需求來源可轉成來源追蹤資料", () => {
  const rows = buildPurchaseOrderItemSources(makeOrder(), { createdBy: "buyer", createdAt: "2026-07-23", createId: (prefix) => `${prefix}-1` });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, "DEMAND_SUGGESTION");
  assert.equal(rows[0].sourceQty, 8);
});

test("總倉補充來源可轉成來源追蹤資料", () => {
  const rows = buildPurchaseOrderItemSources(makeOrder({ suggestions: [{ ...suggestion, warehouseSupplementQty: 4, rawPurchaseQty: 12 }] }), { createId: (prefix) => `${prefix}-1` });
  assert.equal(rows.some((row) => row.sourceType === "WAREHOUSE_REPLENISHMENT" && row.sourceQty === 4), true);
});

test("人工來源可轉成來源追蹤資料", () => {
  const rows = buildPurchaseOrderItemSources(makeOrder({ suggestions: [], manualItems: [{ productId: "p-b", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] }), { createId: (prefix) => `${prefix}-1` });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, "MANUAL_ADDITION");
  assert.equal(rows[0].sourceQty, 3);
});

test("來源數量可追溯到人工與需求合計", () => {
  const order = makeOrder({ manualItems: [{ productId: "p-a", supplierId: "sup-a", manualAddedQty: 3, manualReasonCode: "WAREHOUSE_STOCK" }] });
  const rows = buildPurchaseOrderItemSources(order);
  assert.equal(rows.reduce((sum, row) => sum + row.sourceQty, 0), 11);
});

test("2026-07-23 的六個完整月份為 1 月至 6 月", () => {
  const snapshot = buildProcurementProductSnapshot({ productId: "p-a", locations, inventory: [], referenceDate: "2026-07-23" });
  assert.deepEqual(snapshot.months.map((month) => month.label), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
});

test("缺少銷售月份會補零", () => {
  const snapshot = buildProcurementProductSnapshot({ productId: "p-a", locations, inventory: [], monthlyProductSales: [{ locationId: "store-1", productId: "p-a", salesYear: 2026, salesMonth: 6, salesQty: 7 }], referenceDate: "2026-07-23" });
  assert.deepEqual(snapshot.stores[0].sales.months.map((month) => month.salesQty), [0, 0, 0, 0, 0, 7]);
});

test("總倉銷售顯示 N/A", () => {
  const snapshot = buildProcurementProductSnapshot({ productId: "p-a", locations, inventory: [], referenceDate: "2026-07-23" });
  assert.equal(snapshot.warehouse.sales, null);
});

test("快照包含五家門市與總倉庫存", () => {
  const snapshot = buildProcurementProductSnapshot({ productId: "p-a", locations, inventory: [{ locationId: "store-1", productId: "p-a", onHandQty: 9, reservedQty: 2 }], referenceDate: "2026-07-23" });
  assert.equal(snapshot.stores.length, 5);
  assert.equal(snapshot.warehouse.locationId, "warehouse");
  assert.equal(snapshot.stores[0].inventory.availableQty, 7);
});

test("庫存快照包含採購未到、待配貨、已配貨未簽收與未完成需求", () => {
  const snapshot = buildProcurementProductSnapshot({
    productId: "p-a",
    locations,
    purchaseOrders: [{ status: "ORDERED", lines: [{ id: "line-1", productId: "p-a", orderedQty: 12, receivedQty: 4, cancelledQty: 1 }] }],
    purchaseOrderItemStoreAllocations: [{ purchaseOrderItemId: "line-1", destinationLocationId: "store-1", plannedDistributionQty: 5, actualAllocatedQty: 2 }],
    allocations: [{ destinationLocationId: "store-1", status: "SHIPPED", items: [{ productId: "p-a", shippedQty: 4, receivedQty: 1 }] }],
    demands: [{ locationId: "store-1", status: "WAITING_PURCHASE", items: [{ productId: "p-a", approvedQty: 10, allocatedQty: 3, receivedQty: 1, cancelledQty: 0 }] }],
    referenceDate: "2026-07-23",
  });
  assert.equal(snapshot.warehouse.purchaseInboundQty, 7);
  assert.equal(snapshot.warehouse.pendingAllocationQty, 3);
  assert.equal(snapshot.stores[0].allocatedInTransitQty, 3);
  assert.equal(snapshot.stores[0].openDemandQty, 6);
});

test("配貨計畫每個商品為每家門市一筆", () => {
  const order = makeOrder();
  const plans = buildPurchaseOrderItemDistributionPlans(order, { locations });
  assert.equal(plans.length, 5);
  assert.equal(plans.find((plan) => plan.destinationLocationId === "store-1").suggestedDistributionQty, 8);
});

test("配貨計畫預設不超過確認採購量", () => {
  const order = makeOrder();
  const plans = buildPurchaseOrderItemDistributionPlans(order, { locations });
  const validation = validatePurchaseOrderDistributionPlans(order, plans, { locations });
  assert.equal(validation.valid, true);
  assert.equal(validation.summaries[0].warehousePlannedRetentionQty, 0);
});

test("配貨量偏離建議時必須填原因", () => {
  const order = makeOrder();
  const plans = buildPurchaseOrderItemDistributionPlans(order, { locations });
  plans[0].plannedDistributionQty = 2;
  plans[0].planningReason = "";
  assert.equal(validatePurchaseOrderDistributionPlans(order, plans, { locations }).valid, false);
});

test("配貨量超過確認數量會拒絕", () => {
  const order = makeOrder();
  const plans = buildPurchaseOrderItemDistributionPlans(order, { locations });
  plans[0].plannedDistributionQty = 9;
  plans[0].planningReason = "門市急件";
  assert.equal(validatePurchaseOrderDistributionPlans(order, plans, { locations }).valid, false);
});

test("配貨套用後會計算總倉留存", () => {
  const order = makeOrder();
  const plans = buildPurchaseOrderItemDistributionPlans(order, { locations });
  plans[0].plannedDistributionQty = 5;
  plans[0].planningReason = "依門市優先順序調整";
  const result = applyPurchaseOrderDistributionPlans(order, plans, { locations });
  assert.equal(result.committed, true);
  assert.equal(result.order.lines[0].plannedStoreAllocationQty, 5);
  assert.equal(result.order.lines[0].warehousePlannedRetentionQty, 3);
});

test("無成團原因清單符合規則", () => {
  assert.deepEqual(NO_GROUP_REASONS, ["MINIMUM_QUANTITY_NOT_MET", "PURCHASE_MULTIPLE_NOT_MET", "SUPPLIER_MINIMUM_AMOUNT_NOT_MET", "SUPPLIER_OUT_OF_STOCK", "SUPPLIER_DISCONTINUED", "PRICE_NOT_ACCEPTED", "PRODUCT_DISCONTINUED", "OTHER"]);
});

test("採購人員可標記無成團", () => {
  const result = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "SUPPLIER_OUT_OF_STOCK", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-23" });
  assert.equal(result.committed, true);
  assert.equal(result.state.purchaseSuggestions[0].status, "NO_GROUP");
});

test("無成團會同步需求明細狀態", () => {
  const result = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "SUPPLIER_OUT_OF_STOCK", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-23" });
  assert.equal(result.state.demands[0].items[0].procurementStatus, "NO_GROUP");
  assert.equal(result.state.demands[0].items[0].procurementStatusReason, "SUPPLIER_OUT_OF_STOCK");
});

test("無成團不會產生採購單", () => {
  const result = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "SUPPLIER_OUT_OF_STOCK", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-23" });
  assert.equal(result.state.purchaseOrders, undefined);
  assert.equal(result.state.purchaseSuggestions[0].purchaseOrderId, undefined);
});

test("OTHER 無成團原因沒有說明時拒絕且回滾", () => {
  const state = makeNoGroupState();
  const result = markPurchaseSuggestionNoGroup(state, { suggestionId: "suggestion-1", reason: "OTHER", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-23" });
  assert.equal(result.committed, false);
  assert.equal(state.purchaseSuggestions[0].status, "PENDING");
});

test("非採購角色不可標記無成團", () => {
  const result = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "OTHER", note: "x", actorRole: "WAREHOUSE", actorId: "warehouse", changedAt: "2026-07-23" });
  assert.equal(result.committed, false);
});

test("無成團會寫入不含密碼的稽核資訊", () => {
  const result = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "OTHER", note: "供應商缺貨", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-23" });
  const audit = result.state.auditLogs[0];
  assert.equal(audit.action, "PURCHASE_SUGGESTION_NO_GROUP");
  assert.equal(JSON.stringify(audit).includes("password_hash"), false);
});

test("無成團歷史可保留並重新開啟", () => {
  const marked = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "SUPPLIER_OUT_OF_STOCK", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-23" });
  const reopened = reopenPurchaseSuggestion(marked.state, { suggestionId: "suggestion-1", actorRole: "PURCHASING", actorId: "buyer", changedAt: "2026-07-24" });
  assert.equal(reopened.committed, true);
  assert.equal(reopened.state.purchaseSuggestions[0].status, "REOPENED");
  assert.equal(reopened.state.purchaseSuggestions[0].noGroupHistory.length, 2);
});

test("已建立採購單的建議不可標記無成團", () => {
  const state = makeNoGroupState();
  state.purchaseSuggestions[0].purchaseOrderId = "po-1";
  const result = markPurchaseSuggestionNoGroup(state, { suggestionId: "suggestion-1", reason: "SUPPLIER_OUT_OF_STOCK", actorRole: "PURCHASING", actorId: "buyer" });
  assert.equal(result.committed, false);
});

test("無成團後重新開啟可選擇待彙整狀態", () => {
  const marked = markPurchaseSuggestionNoGroup(makeNoGroupState(), { suggestionId: "suggestion-1", reason: "SUPPLIER_OUT_OF_STOCK", actorRole: "PURCHASING", actorId: "buyer" });
  const reopened = reopenPurchaseSuggestion(marked.state, { suggestionId: "suggestion-1", nextStatus: "WAITING_AGGREGATION", actorRole: "PURCHASING", actorId: "buyer" });
  assert.equal(reopened.state.purchaseSuggestions[0].status, "WAITING_AGGREGATION");
});

test("無成團狀態變更失敗時保留原始資料", () => {
  const state = makeNoGroupState();
  const result = reopenPurchaseSuggestion(state, { suggestionId: "suggestion-1", actorRole: "PURCHASING", actorId: "buyer" });
  assert.equal(result.committed, false);
  assert.equal(state.purchaseSuggestions[0].status, "PENDING");
});
