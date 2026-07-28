export const PRODUCT_PROCUREMENT_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_PURCHASE_SETUP",
  "PURCHASABLE",
  "INACTIVE",
]);

export const PRODUCT_BASIC_FIELDS = Object.freeze([
  "productCode",
  "barcode",
  "name",
  "specification",
  "category",
  "baseUnit",
  "isActive",
]);

export const PRODUCT_WAREHOUSE_FIELDS = Object.freeze([
  "casePackQty",
  "storeDistributionUnit",
  "storeDistributionMultiple",
  "warehouseLocationCode",
  "batchTrackingEnabled",
  "expiryTrackingEnabled",
  "minimumShelfLifeDays",
  "storageNote",
]);

export const PRODUCT_PURCHASING_FIELDS = Object.freeze([
  "supplierProductCode",
  "purchaseUnit",
  "purchasePrice",
  "minimumOrderQuantity",
  "purchaseMultiple",
  "minimumOrderAmount",
  "leadTimeDays",
  "isPrimary",
  "isActive",
]);

export const SUPPLIER_COMMERCIAL_FIELDS = Object.freeze([
  "code",
  "name",
  "taxId",
  "contactName",
  "phone",
  "email",
  "address",
  "leadTimeDays",
  "minimumOrderAmount",
  "paymentTerms",
  "isActive",
]);

export const SUPPLIER_RECEIVING_FIELDS = Object.freeze([
  "deliveryNote",
  "deliveryTimeNote",
  "receivingNote",
]);

export const MASTER_DATA_ROLES = Object.freeze({
  ADMIN: "ADMIN",
  PURCHASING: "PURCHASING",
  WAREHOUSE: "WAREHOUSE",
  STORE: "STORE",
});

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function booleanValue(value, fallback = false) {
  return value === undefined || value === null ? fallback : value === true || value === "true";
}

function money(value, fallback = "0.00") {
  const raw = text(value).replaceAll(",", "");
  if (!raw) return fallback;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("金額格式不正確");
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function nowFor(input = {}) {
  return input.changedAt || input.updatedAt || input.createdAt || new Date().toISOString();
}

function actorFor(input = {}) {
  return input.actor || {
    id: input.actorId || null,
    role: input.actorRole || input.role || null,
    isActive: input.isActive !== false,
  };
}

function createId(input, prefix) {
  return input.createId ? input.createId(prefix) : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureArrays(state) {
  state.products = state.products || [];
  state.suppliers = state.suppliers || [];
  state.supplierProducts = state.supplierProducts || [];
  state.auditLogs = state.auditLogs || [];
}

function errorResult(sourceState, error) {
  return {
    committed: false,
    state: sourceState,
    entity: null,
    error: error instanceof Error ? error : new Error(String(error)),
    errors: [error instanceof Error ? error.message : String(error)],
  };
}

function transact(sourceState, input, callback) {
  const state = clone(sourceState);
  ensureArrays(state);
  try {
    const result = callback(state, actorFor(input));
    return { committed: true, state, ...result };
  } catch (error) {
    return errorResult(sourceState, error);
  }
}

function requireRole(actor, roles) {
  if (!actor || actor.isActive === false || !roles.includes(actor.role)) {
    throw new Error(`目前角色不得執行此主檔操作，需要 ${roles.join(" 或 ")}`);
  }
}

function assertAllowedKeys(changes, allowed, label) {
  const unknown = Object.keys(changes || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label}包含不可修改欄位：${unknown.join("、")}`);
}

function assertConcurrency(entity, input, label) {
  if (input.expectedVersion !== undefined && integer(entity.version, 1) !== integer(input.expectedVersion, 1)) {
    throw new Error(`${label}已由其他人更新，請重新載入後再修改。`);
  }
  if (input.expectedUpdatedAt !== undefined && String(entity.updatedAt || "") !== String(input.expectedUpdatedAt || "")) {
    throw new Error(`${label}已由其他人更新，請重新載入後再修改。`);
  }
}

function bump(entity, input) {
  entity.version = integer(entity.version, 1) + 1;
  entity.updatedAt = nowFor(input);
}

function addAudit(state, input, { action, entityType, entityId, beforeData, afterData, detail }) {
  const actor = actorFor(input);
  state.auditLogs.unshift({
    id: input.auditId || createId(input, "audit"),
    userId: actor.id || null,
    userRole: actor.role || null,
    action,
    entityType,
    entityId: entityId || null,
    beforeData: beforeData === undefined ? null : clone(beforeData),
    afterData: afterData === undefined ? null : clone(afterData),
    detail: detail || action,
    createdAt: nowFor(input),
  });
}

function findProduct(state, productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error("找不到商品");
  return product;
}

function findSupplier(state, supplierId) {
  const supplier = state.suppliers.find((item) => item.id === supplierId);
  if (!supplier) throw new Error("找不到供應商");
  return supplier;
}

function findSupplierProduct(state, input = {}) {
  const relation = input.supplierProductId
    ? state.supplierProducts.find((item) => item.id === input.supplierProductId)
    : state.supplierProducts.find((item) => item.productId === input.productId && item.supplierId === input.supplierId);
  if (!relation) throw new Error("找不到商品供應商設定");
  return relation;
}

function validateUniqueProduct(state, product, changes = {}) {
  const productCode = text(changes.productCode ?? product.productCode);
  const barcode = text(changes.barcode ?? product.barcode);
  if (!productCode || !barcode || !text(changes.name ?? product.name) || !text(changes.baseUnit ?? product.baseUnit)) {
    throw new Error("商品編號、條碼、商品名稱與基本單位為必填");
  }
  if (state.products.some((item) => item.id !== product.id && item.productCode === productCode)) throw new Error("商品編號已存在");
  if (state.products.some((item) => item.id !== product.id && item.barcode === barcode)) throw new Error("商品條碼已存在");
}

function validateSupplier(state, supplier, changes = {}) {
  const code = text(changes.code ?? supplier.code);
  const name = text(changes.name ?? supplier.name);
  if (!code || !name) throw new Error("供應商代碼與名稱為必填");
  if (state.suppliers.some((item) => item.id !== supplier.id && item.code === code)) throw new Error("供應商代碼已存在");
  if (integer(changes.leadTimeDays ?? supplier.leadTimeDays) < 0) throw new Error("交貨天數不得小於 0");
}

function requiredSupplierFields(relation) {
  return Boolean(
    relation
      && relation.isActive !== false
      && text(relation.purchaseUnit)
      && text(relation.supplierProductCode)
      && integer(relation.purchaseMultiple, 0) >= 1
      && integer(relation.minimumOrderQuantity, 0) >= 1
      && Number.isFinite(Number(relation.purchasePrice))
      && Number(relation.purchasePrice) >= 0,
  );
}

export function deriveProductProcurementStatus(product = {}, supplierProducts = []) {
  if (!product.isActive) return "INACTIVE";
  if (!text(product.productCode) || !text(product.name) || !text(product.baseUnit)) return "DRAFT";
  const primary = supplierProducts.find((item) => item.productId === product.id && item.isPrimary === true && item.isActive !== false);
  return requiredSupplierFields(primary) ? "PURCHASABLE" : "PENDING_PURCHASE_SETUP";
}

export function isProductPurchasable(product = {}) {
  return !product.procurementStatus || product.procurementStatus === "PURCHASABLE";
}

export function normalizeMasterData(data) {
  ensureArrays(data);
  data.suppliers.forEach((supplier) => {
    supplier.code = supplier.code ?? supplier.supplierCode ?? "";
    supplier.name = supplier.name ?? supplier.supplierName ?? "";
    supplier.taxId = supplier.taxId ?? "";
    supplier.contactName = supplier.contactName ?? supplier.contact ?? "";
    supplier.phone = supplier.phone ?? "";
    supplier.email = supplier.email ?? "";
    supplier.address = supplier.address ?? "";
    supplier.leadTimeDays = integer(supplier.leadTimeDays);
    supplier.minimumOrderAmount = money(supplier.minimumOrderAmount);
    supplier.paymentTerms = supplier.paymentTerms ?? "";
    supplier.deliveryNote = supplier.deliveryNote ?? "";
    supplier.deliveryTimeNote = supplier.deliveryTimeNote ?? "";
    supplier.receivingNote = supplier.receivingNote ?? "";
    supplier.isActive = supplier.isActive !== false;
    supplier.version = integer(supplier.version, 1);
    supplier.createdAt = supplier.createdAt || null;
    supplier.updatedAt = supplier.updatedAt || supplier.createdAt || null;
  });
  data.products.forEach((product) => {
    product.productCode = product.productCode ?? "";
    product.barcode = product.barcode ?? "";
    product.name = product.name ?? product.productName ?? "";
    product.specification = product.specification ?? "";
    product.category = product.category ?? product.categoryId ?? "";
    product.baseUnit = product.baseUnit ?? "件";
    product.defaultSupplierId = product.defaultSupplierId ?? product.supplierId ?? null;
    product.supplierId = product.supplierId ?? product.defaultSupplierId ?? null;
    product.casePackQty = integer(product.casePackQty);
    product.storeDistributionUnit = product.storeDistributionUnit ?? product.baseUnit ?? "件";
    product.storeDistributionMultiple = Math.max(1, integer(product.storeDistributionMultiple, 1));
    product.warehouseLocationCode = product.warehouseLocationCode ?? "";
    product.batchTrackingEnabled = product.batchTrackingEnabled === true;
    product.expiryTrackingEnabled = product.expiryTrackingEnabled === true;
    product.minimumShelfLifeDays = integer(product.minimumShelfLifeDays);
    product.storageNote = product.storageNote ?? "";
    product.isActive = product.isActive !== false;
    product.version = integer(product.version, 1);
    product.createdAt = product.createdAt || null;
    product.updatedAt = product.updatedAt || product.createdAt || null;
  });
  data.supplierProducts.forEach((relation) => {
    relation.supplierProductCode = relation.supplierProductCode ?? "";
    relation.purchaseUnit = relation.purchaseUnit ?? "件";
    relation.purchasePrice = money(relation.purchasePrice);
    relation.minimumOrderQuantity = integer(relation.minimumOrderQuantity, 1);
    relation.purchaseMultiple = Math.max(1, integer(relation.purchaseMultiple, 1));
    relation.minimumOrderAmount = money(relation.minimumOrderAmount);
    relation.leadTimeDays = integer(relation.leadTimeDays);
    relation.isPrimary = relation.isPrimary === true;
    relation.isActive = relation.isActive !== false;
    relation.version = integer(relation.version, 1);
    relation.createdAt = relation.createdAt || null;
    relation.updatedAt = relation.updatedAt || relation.createdAt || null;
  });
  data.products.forEach((product) => {
    product.procurementStatus = PRODUCT_PROCUREMENT_STATUSES.includes(product.procurementStatus)
      ? product.procurementStatus
      : deriveProductProcurementStatus(product, data.supplierProducts);
    if (product.procurementStatus === "PURCHASABLE") {
      const primary = data.supplierProducts.find((item) => item.productId === product.id && item.isPrimary === true && item.isActive !== false);
      product.defaultSupplierId = primary?.supplierId || product.defaultSupplierId;
      product.supplierId = product.defaultSupplierId;
    }
  });
  return data;
}

export function canViewMasterData(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "PURCHASING", "WAREHOUSE"].includes(user.role));
}

export function canCreateProduct(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "PURCHASING", "WAREHOUSE"].includes(user.role));
}

export function canAdjustInventory(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "WAREHOUSE"].includes(user.role));
}

export function canManageSupplierCommercial(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "PURCHASING"].includes(user.role));
}

export function canManageSupplierReceiving(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "WAREHOUSE"].includes(user.role));
}

export function canManageSupplierProducts(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "PURCHASING"].includes(user.role));
}

function applyProductBasic(state, product, input, actor) {
  const changes = input.changes || input.basic || {};
  const full = ["ADMIN", "WAREHOUSE"].includes(actor.role);
  const allowed = full ? PRODUCT_BASIC_FIELDS : ["name", "specification", "category"];
  assertAllowedKeys(changes, allowed, "商品基本資料");
  if (!input.skipConcurrency) assertConcurrency(product, input, "商品資料");
  validateUniqueProduct(state, product, changes);
  const before = clone(product);
  if (changes.productCode !== undefined) product.productCode = text(changes.productCode);
  if (changes.barcode !== undefined) product.barcode = text(changes.barcode);
  if (changes.name !== undefined) product.name = text(changes.name);
  if (changes.specification !== undefined) product.specification = text(changes.specification);
  if (changes.category !== undefined) product.category = text(changes.category);
  if (changes.baseUnit !== undefined) product.baseUnit = text(changes.baseUnit);
  if (changes.isActive !== undefined) product.isActive = booleanValue(changes.isActive, product.isActive);
  if (!product.isActive) product.procurementStatus = "INACTIVE";
  else product.procurementStatus = deriveProductProcurementStatus(product, state.supplierProducts);
  bump(product, input);
  addAudit(state, input, { action: "PRODUCT_BASIC_UPDATED", entityType: "PRODUCT", entityId: product.id, beforeData: before, afterData: product, detail: "商品基本資料已更新" });
}

function applyProductWarehouse(state, product, input) {
  const changes = input.changes || input.warehouse || {};
  assertAllowedKeys(changes, PRODUCT_WAREHOUSE_FIELDS, "商品倉儲物流設定");
  if (!input.skipConcurrency) assertConcurrency(product, input, "商品資料");
  const before = clone(product);
  if (changes.casePackQty !== undefined) product.casePackQty = integer(changes.casePackQty);
  if (changes.storeDistributionUnit !== undefined) product.storeDistributionUnit = text(changes.storeDistributionUnit);
  if (changes.storeDistributionMultiple !== undefined) product.storeDistributionMultiple = Math.max(1, integer(changes.storeDistributionMultiple, 1));
  if (changes.warehouseLocationCode !== undefined) product.warehouseLocationCode = text(changes.warehouseLocationCode);
  if (changes.batchTrackingEnabled !== undefined) product.batchTrackingEnabled = booleanValue(changes.batchTrackingEnabled, false);
  if (changes.expiryTrackingEnabled !== undefined) product.expiryTrackingEnabled = booleanValue(changes.expiryTrackingEnabled, false);
  if (changes.minimumShelfLifeDays !== undefined) product.minimumShelfLifeDays = integer(changes.minimumShelfLifeDays);
  if (changes.storageNote !== undefined) product.storageNote = text(changes.storageNote);
  bump(product, input);
  addAudit(state, input, { action: "PRODUCT_WAREHOUSE_SETTINGS_UPDATED", entityType: "PRODUCT", entityId: product.id, beforeData: before, afterData: product, detail: "商品倉儲物流設定已更新" });
}

function applySupplierCommercial(state, supplier, input) {
  const changes = input.changes || input.commercial || {};
  assertAllowedKeys(changes, SUPPLIER_COMMERCIAL_FIELDS, "供應商商務資料");
  assertConcurrency(supplier, input, "供應商資料");
  validateSupplier(state, supplier, changes);
  const before = clone(supplier);
  if (changes.code !== undefined) supplier.code = text(changes.code);
  if (changes.name !== undefined) supplier.name = text(changes.name);
  if (changes.taxId !== undefined) supplier.taxId = text(changes.taxId);
  if (changes.contactName !== undefined) supplier.contactName = text(changes.contactName);
  if (changes.phone !== undefined) supplier.phone = text(changes.phone);
  if (changes.email !== undefined) supplier.email = text(changes.email);
  if (changes.address !== undefined) supplier.address = text(changes.address);
  if (changes.leadTimeDays !== undefined) supplier.leadTimeDays = integer(changes.leadTimeDays);
  if (changes.minimumOrderAmount !== undefined) supplier.minimumOrderAmount = money(changes.minimumOrderAmount);
  if (changes.paymentTerms !== undefined) supplier.paymentTerms = text(changes.paymentTerms);
  if (changes.isActive !== undefined) supplier.isActive = booleanValue(changes.isActive, supplier.isActive);
  bump(supplier, input);
  addAudit(state, input, { action: "SUPPLIER_COMMERCIAL_UPDATED", entityType: "SUPPLIER", entityId: supplier.id, beforeData: before, afterData: supplier, detail: "供應商商務資料已更新" });
}

function applySupplierReceiving(state, supplier, input) {
  const changes = input.changes || input.receiving || {};
  assertAllowedKeys(changes, SUPPLIER_RECEIVING_FIELDS, "供應商收貨資料");
  assertConcurrency(supplier, input, "供應商資料");
  const before = clone(supplier);
  if (changes.deliveryNote !== undefined) supplier.deliveryNote = text(changes.deliveryNote);
  if (changes.deliveryTimeNote !== undefined) supplier.deliveryTimeNote = text(changes.deliveryTimeNote);
  if (changes.receivingNote !== undefined) supplier.receivingNote = text(changes.receivingNote);
  bump(supplier, input);
  addAudit(state, input, { action: "SUPPLIER_RECEIVING_UPDATED", entityType: "SUPPLIER", entityId: supplier.id, beforeData: before, afterData: supplier, detail: "供應商收貨備註已更新" });
}

function normalizeSupplierProductChanges(changes, relation) {
  const next = { ...changes };
  if (next.purchasePrice !== undefined) next.purchasePrice = money(next.purchasePrice);
  if (next.minimumOrderAmount !== undefined) next.minimumOrderAmount = money(next.minimumOrderAmount);
  if (next.minimumOrderQuantity !== undefined) next.minimumOrderQuantity = integer(next.minimumOrderQuantity);
  if (next.purchaseMultiple !== undefined) next.purchaseMultiple = Math.max(1, integer(next.purchaseMultiple, 1));
  if (next.leadTimeDays !== undefined) next.leadTimeDays = integer(next.leadTimeDays);
  if (next.supplierProductCode !== undefined) next.supplierProductCode = text(next.supplierProductCode);
  if (next.purchaseUnit !== undefined) next.purchaseUnit = text(next.purchaseUnit);
  if (next.isPrimary !== undefined) next.isPrimary = booleanValue(next.isPrimary, relation?.isPrimary);
  if (next.isActive !== undefined) next.isActive = booleanValue(next.isActive, relation?.isActive !== false);
  return next;
}

function assertSupplierProductFields(relation) {
  if (!text(relation.purchaseUnit)) throw new Error("採購單位為必填");
  if (relation.purchaseMultiple < 1) throw new Error("採購倍數至少為 1");
  if (relation.minimumOrderQuantity < 1) throw new Error("最低採購量至少為 1");
  if (Number(relation.purchasePrice) < 0 || Number.isNaN(Number(relation.purchasePrice))) throw new Error("採購單價不得小於 0");
}

function refreshProductStatus(state, product) {
  const beforeStatus = product.procurementStatus;
  const primary = state.supplierProducts.find((item) => item.productId === product.id && item.isPrimary === true && item.isActive !== false);
  product.defaultSupplierId = primary?.supplierId || null;
  product.supplierId = product.defaultSupplierId;
  const nextStatus = deriveProductProcurementStatus(product, state.supplierProducts);
  product.procurementStatus = nextStatus;
  return beforeStatus !== nextStatus;
}

function applyPrimarySupplierOnState(state, product, target, input, actor, { allowNoPrimary = false } = {}) {
  if (target && (target.productId !== product.id || target.isActive === false)) throw new Error("主要供應商必須是此商品的啟用供應商關係");
  if (!target && !allowNoPrimary) throw new Error("停用主要供應商前必須指定新的主要供應商，或確認暫無主要供應商");
  const beforeProduct = clone(product);
  const beforeRelations = state.supplierProducts.filter((item) => item.productId === product.id).map(clone);
  state.supplierProducts.filter((item) => item.productId === product.id).forEach((relation) => {
    const shouldBePrimary = Boolean(target && relation.id === target.id && relation.isActive !== false);
    if (relation.isPrimary !== shouldBePrimary) {
      relation.isPrimary = shouldBePrimary;
      bump(relation, input);
    }
  });
  refreshProductStatus(state, product);
  bump(product, input);
  addAudit(state, input, {
    action: "PRIMARY_SUPPLIER_SWITCHED",
    entityType: "PRODUCT",
    entityId: product.id,
    beforeData: { product: beforeProduct, supplierProducts: beforeRelations },
    afterData: { product, supplierProducts: state.supplierProducts.filter((item) => item.productId === product.id) },
    detail: target ? `主要供應商已切換為 ${target.supplierId}` : "商品暫無主要供應商",
  });
}

function applySupplierProduct(state, relation, product, supplier, input, actor) {
  const changes = normalizeSupplierProductChanges(input.changes || input.purchasing || {}, relation);
  assertAllowedKeys(changes, PRODUCT_PURCHASING_FIELDS, "商品供應商採購設定");
  assertConcurrency(relation, input, "商品供應商設定");
  if (product.isActive === false) throw new Error("商品已停用，不得新增或修改採購設定");
  if (supplier.isActive === false) throw new Error("供應商已停用");
  const before = clone(relation);
  Object.assign(relation, changes);
  if (relation.isActive === false && relation.isPrimary === true) relation.isPrimary = false;
  assertSupplierProductFields(relation);
  if (relation.isPrimary === false && before.isPrimary === true && relation.isActive !== false && !input.replacementSupplierProductId && input.allowNoPrimary !== true) {
    throw new Error("停用主要供應商前必須指定新的主要供應商，或確認暫無主要供應商");
  }
  bump(relation, input);
  const wantsPrimary = relation.isPrimary === true;
  if (wantsPrimary) applyPrimarySupplierOnState(state, product, relation, input, actor, { allowNoPrimary: true });
  else {
    const wasPrimary = before.isPrimary === true;
    if (wasPrimary) {
      const replacement = input.replacementSupplierProductId
        ? state.supplierProducts.find((item) => item.id === input.replacementSupplierProductId)
        : null;
      if (replacement) applyPrimarySupplierOnState(state, product, replacement, input, actor, { allowNoPrimary: false });
      else applyPrimarySupplierOnState(state, product, null, input, actor, { allowNoPrimary: input.allowNoPrimary === true });
    } else {
      refreshProductStatus(state, product);
      bump(product, input);
    }
  }
  addAudit(state, input, { action: "SUPPLIER_PRODUCT_UPDATED", entityType: "SUPPLIER_PRODUCT", entityId: relation.id, beforeData: before, afterData: relation, detail: "商品供應商採購設定已更新" });
}

function applyProductPurchasing(state, product, input, actor) {
  const changes = { ...(input.purchasing || input.changes || {}) };
  const defaultSupplierId = changes.defaultSupplierId;
  const allowNoPrimary = changes.allowNoPrimary;
  delete changes.defaultSupplierId;
  delete changes.allowNoPrimary;
  if (defaultSupplierId !== undefined) {
    const target = defaultSupplierId
      ? state.supplierProducts.find((item) => item.productId === product.id && item.supplierId === defaultSupplierId)
      : null;
    if (defaultSupplierId && !target) throw new Error("主要供應商必須先建立商品供應商關係");
    applyPrimarySupplierOnState(state, product, target, { ...input, skipConcurrency: true }, actor, { allowNoPrimary: allowNoPrimary === true || input.allowNoPrimary === true });
  }
  if (Object.keys(changes).length) {
    const relation = findSupplierProduct(state, { supplierProductId: input.supplierProductId, productId: product.id, supplierId: input.supplierId || defaultSupplierId || product.defaultSupplierId });
    const supplier = findSupplier(state, relation.supplierId);
    applySupplierProduct(state, relation, product, supplier, {
      ...input,
      changes,
      expectedVersion: input.expectedSupplierProductVersion,
      expectedUpdatedAt: input.expectedSupplierProductUpdatedAt,
      skipConcurrency: true,
    }, actor);
  }
  product.procurementStatus = deriveProductProcurementStatus(product, state.supplierProducts);
}

export function updateProductBasicData(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING", "WAREHOUSE"]);
    const product = findProduct(state, input.productId);
    if (actor.role === "PURCHASING" && Object.keys(input.changes || input.basic || {}).some((key) => !["name", "specification", "category"].includes(key))) throw new Error("採購人員只能修改商品名稱、規格與分類");
    applyProductBasic(state, product, input, actor);
    return { entity: product, product };
  });
}

export function updateProductWarehouseSettings(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "WAREHOUSE"]);
    const product = findProduct(state, input.productId);
    applyProductWarehouse(state, product, input);
    return { entity: product, product };
  });
}

export function updateProductMasterData(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING", "WAREHOUSE"]);
    const product = findProduct(state, input.productId);
    assertConcurrency(product, input, "商品資料");
    const scopedInput = { ...input, skipConcurrency: true };
    if (input.basic || input.changes) {
      if (actor.role === "PURCHASING" && Object.keys(input.basic || input.changes || {}).some((key) => !["name", "specification", "category"].includes(key))) throw new Error("採購人員只能修改商品名稱、規格與分類");
      applyProductBasic(state, product, { ...scopedInput, changes: input.basic || input.changes }, actor);
    }
    if (input.warehouse) {
      requireRole(actor, ["ADMIN", "WAREHOUSE"]);
      applyProductWarehouse(state, product, { ...scopedInput, changes: input.warehouse }, actor);
    }
    if (input.purchasing) {
      requireRole(actor, ["ADMIN", "PURCHASING"]);
      applyProductPurchasing(state, product, { ...scopedInput, purchasing: input.purchasing }, actor);
    }
    product.procurementStatus = deriveProductProcurementStatus(product, state.supplierProducts);
    return { entity: product, product };
  });
}

export function updateProductPurchasingSettings(sourceState, input = {}) {
  return updateProductMasterData(sourceState, { ...input, purchasing: input.purchasing || input.changes || {} });
}

export function createProduct(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING", "WAREHOUSE"]);
    const basic = input.basic || {};
    const warehouse = input.warehouse || {};
    const purchasing = input.purchasing || {};
    const full = ["ADMIN", "WAREHOUSE"].includes(actor.role);
    const basicAllowed = PRODUCT_BASIC_FIELDS;
    assertAllowedKeys(basic, basicAllowed, "商品基本資料");
    assertAllowedKeys(warehouse, full ? PRODUCT_WAREHOUSE_FIELDS : [], "商品倉儲物流設定");
    if (actor.role === "WAREHOUSE" && Object.keys(purchasing).length) throw new Error("倉管不得建立採購商務設定");
    if (actor.role === "PURCHASING") assertAllowedKeys(purchasing, [...PRODUCT_PURCHASING_FIELDS, "supplierId", "defaultSupplierId"], "商品採購設定");
    const product = {
      id: createId(input, "product"),
      productCode: text(basic.productCode),
      barcode: text(basic.barcode),
      name: text(basic.name),
      specification: text(basic.specification),
      category: text(basic.category),
      baseUnit: text(basic.baseUnit || "件"),
      defaultSupplierId: null,
      supplierId: null,
      casePackQty: integer(warehouse.casePackQty),
      storeDistributionUnit: text(warehouse.storeDistributionUnit || basic.baseUnit || "件"),
      storeDistributionMultiple: Math.max(1, integer(warehouse.storeDistributionMultiple, 1)),
      warehouseLocationCode: text(warehouse.warehouseLocationCode),
      batchTrackingEnabled: booleanValue(warehouse.batchTrackingEnabled),
      expiryTrackingEnabled: booleanValue(warehouse.expiryTrackingEnabled),
      minimumShelfLifeDays: integer(warehouse.minimumShelfLifeDays),
      storageNote: text(warehouse.storageNote),
      isActive: basic.isActive === undefined ? true : booleanValue(basic.isActive, true),
      procurementStatus: "PENDING_PURCHASE_SETUP",
      version: 1,
      createdAt: nowFor(input),
      updatedAt: nowFor(input),
    };
    validateUniqueProduct(state, product, product);
    if (product.isActive === false) product.procurementStatus = "INACTIVE";
    state.products.unshift(product);
    addAudit(state, input, { action: "PRODUCT_CREATED", entityType: "PRODUCT", entityId: product.id, beforeData: null, afterData: product, detail: "建立商品主檔" });
    if (Object.keys(purchasing).length) {
      const supplierId = purchasing.supplierId || purchasing.defaultSupplierId;
      if (!supplierId) throw new Error("採購設定必須指定供應商");
      const supplier = findSupplier(state, supplierId);
      if (supplier.isActive === false) throw new Error("供應商已停用");
      const relation = {
        id: createId(input, "supplierProduct"), productId: product.id, supplierId,
        supplierProductCode: text(purchasing.supplierProductCode), purchaseUnit: text(purchasing.purchaseUnit || product.baseUnit),
        purchasePrice: money(purchasing.purchasePrice), minimumOrderQuantity: integer(purchasing.minimumOrderQuantity, 1),
        purchaseMultiple: Math.max(1, integer(purchasing.purchaseMultiple, 1)), minimumOrderAmount: money(purchasing.minimumOrderAmount),
        leadTimeDays: integer(purchasing.leadTimeDays), isPrimary: purchasing.isPrimary !== false, isActive: purchasing.isActive !== false,
        version: 1, createdAt: nowFor(input), updatedAt: nowFor(input),
      };
      assertSupplierProductFields(relation);
      state.supplierProducts.unshift(relation);
      product.defaultSupplierId = relation.isPrimary ? supplierId : null;
      product.supplierId = product.defaultSupplierId;
      product.procurementStatus = deriveProductProcurementStatus(product, state.supplierProducts);
      addAudit(state, input, { action: "SUPPLIER_PRODUCT_CREATED", entityType: "SUPPLIER_PRODUCT", entityId: relation.id, beforeData: null, afterData: relation, detail: "建立商品供應商設定" });
    }
    return { entity: product, product };
  });
}

export function createSupplier(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING"]);
    const commercial = input.commercial || input.changes || {};
    assertAllowedKeys(commercial, SUPPLIER_COMMERCIAL_FIELDS, "供應商商務資料");
    const supplier = {
      id: createId(input, "supplier"), code: text(commercial.code), name: text(commercial.name), taxId: text(commercial.taxId),
      contactName: text(commercial.contactName), phone: text(commercial.phone), email: text(commercial.email), address: text(commercial.address),
      leadTimeDays: integer(commercial.leadTimeDays), minimumOrderAmount: money(commercial.minimumOrderAmount), paymentTerms: text(commercial.paymentTerms),
      deliveryNote: "", deliveryTimeNote: "", receivingNote: "", isActive: commercial.isActive === undefined ? true : booleanValue(commercial.isActive, true),
      version: 1, createdAt: nowFor(input), updatedAt: nowFor(input),
    };
    validateSupplier(state, supplier, supplier);
    state.suppliers.unshift(supplier);
    addAudit(state, input, { action: "SUPPLIER_CREATED", entityType: "SUPPLIER", entityId: supplier.id, beforeData: null, afterData: supplier, detail: "建立供應商" });
    return { entity: supplier, supplier };
  });
}

export function updateSupplierCommercialData(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING"]);
    const supplier = findSupplier(state, input.supplierId);
    applySupplierCommercial(state, supplier, input);
    return { entity: supplier, supplier };
  });
}

export function updateSupplierReceivingNotes(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "WAREHOUSE"]);
    const supplier = findSupplier(state, input.supplierId);
    applySupplierReceiving(state, supplier, input);
    return { entity: supplier, supplier };
  });
}

export function createSupplierProduct(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING"]);
    const product = findProduct(state, input.productId);
    const supplier = findSupplier(state, input.supplierId);
    if (product.isActive === false) throw new Error("商品已停用，不得新增採購設定");
    if (supplier.isActive === false) throw new Error("供應商已停用");
    if (state.supplierProducts.some((item) => item.productId === product.id && item.supplierId === supplier.id)) throw new Error("此商品供應商關係已存在");
    const changes = normalizeSupplierProductChanges(input.changes || input.purchasing || {}, {});
    assertAllowedKeys(changes, PRODUCT_PURCHASING_FIELDS, "商品供應商採購設定");
    const relation = {
      id: createId(input, "supplierProduct"), productId: product.id, supplierId: supplier.id,
      supplierProductCode: text(changes.supplierProductCode), purchaseUnit: text(changes.purchaseUnit || product.baseUnit),
      purchasePrice: money(changes.purchasePrice), minimumOrderQuantity: integer(changes.minimumOrderQuantity, 1),
      purchaseMultiple: Math.max(1, integer(changes.purchaseMultiple, 1)), minimumOrderAmount: money(changes.minimumOrderAmount),
      leadTimeDays: integer(changes.leadTimeDays), isPrimary: changes.isPrimary === true, isActive: changes.isActive !== false,
      version: 1, createdAt: nowFor(input), updatedAt: nowFor(input),
    };
    assertSupplierProductFields(relation);
    state.supplierProducts.unshift(relation);
    if (relation.isPrimary) applyPrimarySupplierOnState(state, product, relation, input, actor, { allowNoPrimary: true });
    else { refreshProductStatus(state, product); bump(product, input); }
    addAudit(state, input, { action: "SUPPLIER_PRODUCT_CREATED", entityType: "SUPPLIER_PRODUCT", entityId: relation.id, beforeData: null, afterData: relation, detail: "建立商品供應商關係" });
    return { entity: relation, supplierProduct: relation, product };
  });
}

export function updateSupplierProductSettings(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING"]);
    const relation = findSupplierProduct(state, input);
    const product = findProduct(state, relation.productId);
    const supplier = findSupplier(state, relation.supplierId);
    assertConcurrency(product, {
      expectedVersion: input.expectedProductVersion,
      expectedUpdatedAt: input.expectedProductUpdatedAt,
    }, "商品資料");
    applySupplierProduct(state, relation, product, supplier, input, actor);
    return { entity: relation, supplierProduct: relation, product };
  });
}

export function setPrimarySupplier(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING"]);
    const product = findProduct(state, input.productId);
    assertConcurrency(product, input, "商品資料");
    const target = input.supplierProductId
      ? state.supplierProducts.find((item) => item.id === input.supplierProductId)
      : input.supplierId
        ? state.supplierProducts.find((item) => item.productId === product.id && item.supplierId === input.supplierId)
        : null;
    if (input.supplierProductId && !target) throw new Error("找不到指定的商品供應商設定");
    if (input.supplierId && !target) throw new Error("找不到指定的商品供應商設定");
    if (target) assertConcurrency(target, {
      expectedVersion: input.expectedSupplierProductVersion ?? input.expectedVersion,
      expectedUpdatedAt: input.expectedSupplierProductUpdatedAt ?? input.expectedUpdatedAt,
    }, "商品供應商設定");
    applyPrimarySupplierOnState(state, product, target || null, input, actor, { allowNoPrimary: input.allowNoPrimary === true });
    return { entity: product, product, supplierProduct: target || null };
  });
}

export function setProductProcurementStatus(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "PURCHASING"]);
    const product = findProduct(state, input.productId);
    assertConcurrency(product, input, "商品資料");
    const before = clone(product);
    const derived = deriveProductProcurementStatus(product, state.supplierProducts);
    if (input.status && input.status !== derived) throw new Error(`商品採購狀態必須依必要設定計算，目前可設定為 ${derived}`);
    product.procurementStatus = derived;
    bump(product, input);
    addAudit(state, input, { action: "PRODUCT_PROCUREMENT_STATUS_UPDATED", entityType: "PRODUCT", entityId: product.id, beforeData: before, afterData: product, detail: `商品採購狀態為 ${derived}` });
    return { entity: product, product };
  });
}
