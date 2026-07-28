import test from "node:test";
import assert from "node:assert/strict";
import {
  canAdjustInventory,
  canCreateProduct,
  canManageSupplierCommercial,
  canManageSupplierProducts,
  canManageSupplierReceiving,
  canViewMasterData,
  createProduct,
  createSupplier,
  createSupplierProduct,
  deriveProductProcurementStatus,
  normalizeMasterData,
  setPrimarySupplier,
  updateProductBasicData,
  updateProductMasterData,
  updateProductPurchasingSettings,
  updateProductWarehouseSettings,
  updateSupplierCommercialData,
  updateSupplierProductSettings,
  updateSupplierReceivingNotes,
} from "../master-data-workflow.js";
import {
  aggregatePurchaseSuggestions,
  validateManualPurchaseItem,
  validatePurchaseOrderConfirmation,
} from "../procurement-workflow.js";

const changedAt = "2026-07-23T09:00:00.000Z";

function fixture() {
  return normalizeMasterData({
    products: [
      {
        id: "p1", productCode: "P-001", barcode: "471000000001", name: "商品一", specification: "10入", category: "一般藥品", baseUnit: "盒",
        isActive: true, defaultSupplierId: "s1", procurementStatus: "PURCHASABLE", version: 1, updatedAt: changedAt,
      },
      {
        id: "p2", productCode: "P-002", barcode: "471000000002", name: "商品二", specification: "20入", category: "一般藥品", baseUnit: "盒",
        isActive: true, procurementStatus: "PENDING_PURCHASE_SETUP", version: 1, updatedAt: changedAt,
      },
      {
        id: "p3", productCode: "P-003", barcode: "471000000003", name: "商品三", specification: "30入", category: "一般藥品", baseUnit: "盒",
        isActive: true, procurementStatus: "PENDING_PURCHASE_SETUP", version: 1, updatedAt: changedAt,
      },
    ],
    suppliers: [
      { id: "s1", code: "S-001", name: "供應商一", isActive: true, minimumOrderAmount: "0.00", version: 1, updatedAt: changedAt },
      { id: "s2", code: "S-002", name: "供應商二", isActive: true, minimumOrderAmount: "0.00", version: 1, updatedAt: changedAt },
    ],
    supplierProducts: [
      {
        id: "sp1", productId: "p1", supplierId: "s1", supplierProductCode: "S1-P1", purchaseUnit: "盒", purchasePrice: "10.00",
        minimumOrderQuantity: 1, purchaseMultiple: 1, minimumOrderAmount: "0.00", leadTimeDays: 2, isPrimary: true, isActive: true, version: 1, updatedAt: changedAt,
      },
    ],
    auditLogs: [],
  });
}

function input(role, extra = {}) {
  return {
    ...extra,
    actor: { id: role.toLowerCase() + "-user", role, isActive: true },
    actorId: role.toLowerCase() + "-user",
    actorRole: role,
    changedAt,
    createId: (prefix) => prefix + "-test-" + Math.random().toString(36).slice(2, 7),
  };
}

function committed(result) {
  assert.equal(result.committed, true, result.error?.message);
  return result.state;
}

test("主檔角色能力符合規格", () => {
  assert.equal(canViewMasterData({ role: "ADMIN", isActive: true }), true);
  assert.equal(canViewMasterData({ role: "PURCHASING", isActive: true }), true);
  assert.equal(canViewMasterData({ role: "WAREHOUSE", isActive: true }), true);
  assert.equal(canViewMasterData({ role: "STORE", isActive: true }), false);
  assert.equal(canCreateProduct({ role: "PURCHASING", isActive: true }), true);
  assert.equal(canAdjustInventory({ role: "PURCHASING", isActive: true }), false);
  assert.equal(canAdjustInventory({ role: "WAREHOUSE", isActive: true }), true);
  assert.equal(canManageSupplierCommercial({ role: "WAREHOUSE", isActive: true }), false);
  assert.equal(canManageSupplierReceiving({ role: "WAREHOUSE", isActive: true }), true);
  assert.equal(canManageSupplierProducts({ role: "PURCHASING", isActive: true }), true);
});

test("WAREHOUSE 可建立沒有供應商的商品，狀態為待完成採購設定", () => {
  const result = createProduct(fixture(), input("WAREHOUSE", {
    createId: (prefix) => prefix + "-warehouse",
    basic: { productCode: "P-NEW", barcode: "471000000099", name: "新商品", specification: "1盒", category: "一般藥品", baseUnit: "盒" },
    warehouse: { warehouseLocationCode: "A-01", casePackQty: 12, storeDistributionMultiple: 2 },
  }));
  const state = committed(result);
  assert.equal(result.product.procurementStatus, "PENDING_PURCHASE_SETUP");
  assert.equal(state.supplierProducts.some((item) => item.productId === result.product.id), false);
  assert.equal(state.auditLogs[0].action, "PRODUCT_CREATED");
});

test("PURCHASING 可建立基本商品但不能在建立時寫入倉儲欄位", () => {
  const result = createProduct(fixture(), input("PURCHASING", {
    basic: { productCode: "P-BUY", barcode: "471000000098", name: "採購新增品", specification: "2盒", category: "保健食品", baseUnit: "盒" },
    warehouse: { warehouseLocationCode: "A-02" },
  }));
  assert.equal(result.committed, false);
  assert.match(result.error.message, /倉儲物流/);
});

test("PURCHASING 可建立供應商並留下建立 audit", () => {
  const result = createSupplier(fixture(), input("PURCHASING", {
    commercial: { code: "S-003", name: "新供應商", taxId: "12345678", minimumOrderAmount: "1000", paymentTerms: "月結" },
  }));
  const state = committed(result);
  assert.equal(result.supplier.paymentTerms, "月結");
  assert.equal(state.auditLogs[0].entityType, "SUPPLIER");
});

test("PURCHASING 可修改供應商商務欄位並保留前後價格", () => {
  const source = fixture();
  const result = updateSupplierCommercialData(source, input("PURCHASING", {
    supplierId: "s1", expectedVersion: 1, expectedUpdatedAt: changedAt,
    changes: { minimumOrderAmount: "2500.50", paymentTerms: "月結 30 天" },
  }));
  const state = committed(result);
  assert.equal(result.supplier.minimumOrderAmount, "2500.50");
  assert.equal(result.supplier.paymentTerms, "月結 30 天");
  assert.equal(state.auditLogs[0].beforeData.minimumOrderAmount, "0.00");
  assert.equal(state.auditLogs[0].afterData.minimumOrderAmount, "2500.50");
});

test("WAREHOUSE 不得修改供應商商務欄位", () => {
  const source = fixture();
  const result = updateSupplierCommercialData(source, input("WAREHOUSE", { supplierId: "s1", changes: { minimumOrderAmount: "999" } }));
  assert.equal(result.committed, false);
  assert.deepEqual(result.state, source);
});

test("WAREHOUSE 只能修改供應商收貨備註", () => {
  const source = fixture();
  const result = updateSupplierReceivingNotes(source, input("WAREHOUSE", {
    supplierId: "s1", expectedVersion: 1, expectedUpdatedAt: changedAt,
    changes: { deliveryNote: "週一上午送貨", deliveryTimeNote: "09:00-12:00", receivingNote: "需核對批號與效期" },
  }));
  const state = committed(result);
  assert.equal(result.supplier.deliveryNote, "週一上午送貨");
  assert.equal(state.auditLogs[0].action, "SUPPLIER_RECEIVING_UPDATED");
});

test("WAREHOUSE 可更新商品物流欄位，PURCHASING 不可更新物流欄位", () => {
  const source = fixture();
  const result = updateProductWarehouseSettings(source, input("WAREHOUSE", {
    productId: "p1", expectedVersion: 1, expectedUpdatedAt: changedAt,
    changes: { warehouseLocationCode: "B-02", casePackQty: 24, expiryTrackingEnabled: true },
  }));
  const state = committed(result);
  assert.equal(result.product.warehouseLocationCode, "B-02");
  assert.equal(state.auditLogs[0].action, "PRODUCT_WAREHOUSE_SETTINGS_UPDATED");
  const denied = updateProductWarehouseSettings(source, input("PURCHASING", { productId: "p1", changes: { warehouseLocationCode: "X" } }));
  assert.equal(denied.committed, false);
  assert.deepEqual(denied.state, source);
});

test("PURCHASING 可修改商品名稱/規格/分類，但不能修改商品編號", () => {
  const source = fixture();
  const result = updateProductBasicData(source, input("PURCHASING", {
    productId: "p1", expectedVersion: 1, expectedUpdatedAt: changedAt,
    changes: { name: "商品一改名", specification: "20入", category: "保健食品" },
  }));
  const state = committed(result);
  assert.equal(result.product.name, "商品一改名");
  assert.equal(state.products.find((item) => item.id === "p1").productCode, "P-001");
  const denied = updateProductBasicData(source, input("PURCHASING", { productId: "p1", changes: { productCode: "P-HACK" } }));
  assert.equal(denied.committed, false);
  assert.deepEqual(denied.state, source);
});

test("WAREHOUSE 不得寫入商品採購價格、MOQ 或倍數", () => {
  const source = fixture();
  const result = updateProductPurchasingSettings(source, input("WAREHOUSE", { productId: "p1", changes: { purchasePrice: "99" } }));
  assert.equal(result.committed, false);
  assert.deepEqual(result.state, source);
});

test("PURCHASING 建立有效商品供應商關係後商品變成可採購", () => {
  const source = fixture();
  const result = createSupplierProduct(source, input("PURCHASING", {
    productId: "p2", supplierId: "s1",
    changes: { supplierProductCode: "S1-P2", purchaseUnit: "盒", purchasePrice: "15", minimumOrderQuantity: 5, purchaseMultiple: 5, isPrimary: true },
  }));
  const state = committed(result);
  assert.equal(result.product.procurementStatus, "PURCHASABLE");
  assert.equal(deriveProductProcurementStatus(state.products.find((item) => item.id === "p2"), state.supplierProducts), "PURCHASABLE");
});

test("同一商品切換主要供應商時只保留一筆主要關係", () => {
  const source = fixture();
  const added = createSupplierProduct(source, input("PURCHASING", {
    productId: "p1", supplierId: "s2",
    changes: { supplierProductCode: "S2-P1", purchaseUnit: "盒", purchasePrice: "11", minimumOrderQuantity: 1, purchaseMultiple: 1, isPrimary: false },
  }));
  const stateWithSecond = committed(added);
  const relation = stateWithSecond.supplierProducts.find((item) => item.supplierId === "s2");
  const switched = setPrimarySupplier(stateWithSecond, input("PURCHASING", {
    productId: "p1", supplierProductId: relation.id, expectedVersion: stateWithSecond.products.find((item) => item.id === "p1").version, expectedSupplierProductVersion: relation.version,
  }));
  const state = committed(switched);
  assert.equal(state.supplierProducts.filter((item) => item.productId === "p1" && item.isPrimary && item.isActive).length, 1);
  assert.equal(state.supplierProducts.find((item) => item.id === "sp1").isPrimary, false);
  assert.equal(state.products.find((item) => item.id === "p1").defaultSupplierId, "s2");
});

test("取消主要供應商沒有替代或明確確認時整筆交易 rollback", () => {
  const source = fixture();
  const result = updateSupplierProductSettings(source, input("PURCHASING", {
    supplierProductId: "sp1", productId: "p1", expectedVersion: 1, expectedProductVersion: 1,
    changes: { isPrimary: false },
  }));
  assert.equal(result.committed, false);
  assert.match(result.error.message, /主要供應商/);
  assert.deepEqual(result.state, source);
});

test("明確確認無主要供應商後，商品回到待完成採購設定", () => {
  const source = fixture();
  const result = updateSupplierProductSettings(source, input("PURCHASING", {
    supplierProductId: "sp1", productId: "p1", expectedVersion: 1, expectedProductVersion: 1, allowNoPrimary: true,
    changes: { isPrimary: false },
  }));
  const state = committed(result);
  assert.equal(state.supplierProducts.find((item) => item.id === "sp1").isPrimary, false);
  assert.equal(state.products.find((item) => item.id === "p1").procurementStatus, "PENDING_PURCHASE_SETUP");
});

test("商品主檔可在同一交易切換主要供應商", () => {
  const source = fixture();
  const added = createSupplierProduct(source, input("PURCHASING", {
    productId: "p1", supplierId: "s2",
    changes: { supplierProductCode: "S2-P1", purchaseUnit: "盒", purchasePrice: "11", minimumOrderQuantity: 1, purchaseMultiple: 1, isPrimary: false },
  }));
  const stateWithSecond = committed(added);
  const product = stateWithSecond.products.find((item) => item.id === "p1");
  const result = updateProductMasterData(stateWithSecond, input("PURCHASING", {
    productId: "p1", expectedVersion: product.version, purchasing: { defaultSupplierId: "s2" },
  }));
  const state = committed(result);
  assert.equal(state.products.find((item) => item.id === "p1").defaultSupplierId, "s2");
  assert.equal(state.supplierProducts.find((item) => item.supplierId === "s2" && item.productId === "p1").isPrimary, true);
});

test("非 PURCHASABLE 商品不會產生採購建議或人工採購品項", () => {
  const source = fixture();
  const suggestions = aggregatePurchaseSuggestions({
    products: source.products,
    suppliers: source.suppliers,
    supplierProducts: source.supplierProducts,
    demands: [{ id: "d1", locationId: "store01", status: "SUBMITTED", items: [{ id: "di1", productId: "p2", requestedQty: 5, allocatedQty: 0 }] }],
  });
  assert.equal(suggestions.length, 0);
  const validation = validateManualPurchaseItem({ productId: "p2", supplierId: "s1", quantity: 5, reason: "補貨" }, { products: source.products, suppliers: source.suppliers, supplierProducts: source.supplierProducts });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /尚未完成採購設定/);
});

test("非 PURCHASABLE 商品不能確認採購單", () => {
  const source = fixture();
  const result = validatePurchaseOrderConfirmation({ status: "DRAFT", supplierId: "s1", lines: [{ productId: "p2", orderedQty: 5, unitPrice: "10", sourceType: "MANUAL_ADDITION" }] }, { products: source.products, suppliers: source.suppliers, supplierProducts: source.supplierProducts });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /尚未完成採購設定/);
});

test("商品供應商關係補齊必要條件後可推導為 PURCHASABLE", () => {
  const source = fixture();
  const pending = source.products.find((item) => item.id === "p3");
  const relation = { id: "sp3", productId: "p3", supplierId: "s1", supplierProductCode: "S1-P3", purchaseUnit: "盒", purchasePrice: "0.00", minimumOrderQuantity: 1, purchaseMultiple: 1, isPrimary: true, isActive: true };
  source.supplierProducts.push(relation);
  assert.equal(deriveProductProcurementStatus(pending, source.supplierProducts), "PURCHASABLE");
});

test("商品版本衝突會拒絕修改且不污染原 state", () => {
  const source = fixture();
  const result = updateProductWarehouseSettings(source, input("WAREHOUSE", { productId: "p1", expectedVersion: 99, changes: { warehouseLocationCode: "X" } }));
  assert.equal(result.committed, false);
  assert.match(result.error.message, /重新載入/);
  assert.deepEqual(result.state, source);
});

test("商品供應商設定也檢查商品版本衝突", () => {
  const source = fixture();
  const result = updateSupplierProductSettings(source, input("PURCHASING", { supplierProductId: "sp1", productId: "p1", expectedVersion: 1, expectedProductVersion: 99, changes: { purchasePrice: "12" } }));
  assert.equal(result.committed, false);
  assert.deepEqual(result.state, source);
});

test("商品、供應商與關係 audit 都保存角色與前後內容", () => {
  const source = fixture();
  const supplier = committed(updateSupplierCommercialData(source, input("PURCHASING", { supplierId: "s1", changes: { minimumOrderAmount: "120" } })));
  const product = supplier.products.find((item) => item.id === "p1");
  const relation = committed(updateSupplierProductSettings(supplier, input("PURCHASING", { supplierProductId: "sp1", productId: "p1", expectedProductVersion: product.version, changes: { purchasePrice: "12" } })));
  const logs = relation.auditLogs.filter((log) => ["SUPPLIER_COMMERCIAL_UPDATED", "SUPPLIER_PRODUCT_UPDATED"].includes(log.action));
  assert.equal(logs.length, 2);
  assert.equal(logs.every((log) => log.userRole === "PURCHASING"), true);
  assert.equal(logs.every((log) => log.beforeData && log.afterData), true);
});

test("STORE 不能透過 service 寫入任何主檔欄位", () => {
  const source = fixture();
  const result = updateProductMasterData(source, input("STORE", { productId: "p1", basic: { name: "不應成功" } }));
  assert.equal(result.committed, false);
  assert.deepEqual(result.state, source);
  const supplier = updateSupplierReceivingNotes(source, input("STORE", { supplierId: "s1", changes: { receivingNote: "不應成功" } }));
  assert.equal(supplier.committed, false);
  assert.deepEqual(supplier.state, source);
});
