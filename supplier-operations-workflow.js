/*
 * Supplier commercial, supplier return and purchase fulfilment workflow.
 *
 * The current Phase 1 UI uses localStorage, so this module deliberately keeps
 * the same service boundary that the future API/Prisma adapter will use:
 * every mutation clones the state, validates the actor and commits all related
 * records together.  No function here edits inventory without an inventory
 * movement and an audit entry.
 */

export const SUPPLIER_PAYMENT_METHODS = Object.freeze([
  "BANK_TRANSFER", "CHECK", "CASH", "CREDIT_CARD", "DIRECT_DEBIT",
  "MONTHLY_SETTLEMENT", "OFFSET", "OTHER",
]);

export const SUPPLIER_IDENTIFIER_TYPES = Object.freeze([
  "GTIN14", "EAN13", "UPCA", "JAN", "MANUFACTURER_ITEM_CODE", "OTHER",
]);

export const SUPPLIER_ORDER_FREQUENCIES = Object.freeze([
  "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "INTERVAL_DAYS", "ON_DEMAND", "MANUAL",
]);

export const PURCHASE_ITEM_FOLLOW_UP_STATUSES = Object.freeze([
  "PENDING", "CONTACTED", "CONFIRMED", "DELAYED", "PARTIAL", "SHORTAGE", "RESOLVED",
]);

export const PURCHASE_ITEM_SHORTAGE_STATUSES = Object.freeze([
  "NONE", "PENDING_CONFIRMATION", "PARTIAL_SHORTAGE", "FULL_SHORTAGE",
  "TEMPORARY_OUT_OF_STOCK", "LONG_TERM_OUT_OF_STOCK", "DISCONTINUED",
  "ALTERNATIVE_AVAILABLE", "BACKORDERED", "RESOLVED", "CANCELLED",
]);

export const PURCHASE_ITEM_SHORTAGE_REASONS = Object.freeze([
  "SUPPLIER_NO_STOCK", "PRODUCTION_DELAY", "IMPORT_DELAY", "LOGISTICS_DELAY",
  "ALLOCATION_LIMIT", "PRODUCT_DISCONTINUED", "ORDER_QUANTITY_NOT_MET",
  "PRICE_NOT_CONFIRMED", "UNKNOWN", "OTHER",
]);

export const SUPPLIER_RETURN_SOURCES = Object.freeze([
  "PURCHASE_RECEIPT", "WAREHOUSE_STOCK", "QUALITY_ISSUE", "EXPIRY_ISSUE",
  "WRONG_ITEM", "OVER_DELIVERY", "DAMAGED", "RECALL", "OTHER",
]);

export const SUPPLIER_RETURN_STATUSES = Object.freeze([
  "DRAFT", "PENDING_SUPPLIER_CONFIRMATION", "SUPPLIER_CONFIRMED",
  "REJECTED_BY_SUPPLIER", "READY_TO_RETURN", "RETURNED_TO_SUPPLIER",
  "WAITING_RESOLUTION", "PARTIALLY_RESOLVED", "RESOLVED", "CANCELLED",
]);

export const SUPPLIER_RETURN_REASON_CODES = Object.freeze([
  "DAMAGED", "WRONG_ITEM", "SHORT_EXPIRY", "EXPIRED", "QUALITY_ISSUE",
  "OVER_DELIVERY", "RECALL", "ORDER_CANCELLED", "OTHER",
]);

export const SUPPLIER_RETURN_RESOLUTION_TYPES = Object.freeze([
  "REFUND", "REPLACEMENT", "CREDIT_NOTE", "EXCHANGE_PRODUCT", "REJECTED", "OTHER",
]);

export const SUPPLIER_ATTACHMENT_TYPES = Object.freeze([
  "BANKBOOK_COVER", "BANK_ACCOUNT_PROOF", "SUPPLIER_NOTICE", "DAMAGE_PHOTO",
  "EXPIRY_PHOTO", "SUPPLIER_APPROVAL", "WAYBILL", "RETURN_RECEIPT",
  "REFUND_PROOF", "OTHER",
]);

export const SUPPLIER_OPERATIONS_ROLES = Object.freeze({
  commercial: ["ADMIN", "PURCHASING"],
  warehouse: ["ADMIN", "WAREHOUSE"],
  returnResolution: ["ADMIN", "PURCHASING"],
  returnView: ["ADMIN", "PURCHASING", "WAREHOUSE"],
  identifier: ["ADMIN", "PURCHASING", "WAREHOUSE"],
  storeView: ["ADMIN", "PURCHASING", "WAREHOUSE", "STORE"],
});

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png"]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const text = (value) => String(value ?? "").trim();
const quantity = (value) => Math.max(0, Math.floor(Number(value) || 0));
const decimal = (value) => Math.max(0, Number(value) || 0).toFixed(2);

function nowFor(input = {}) {
  return input.changedAt || input.updatedAt || input.createdAt || new Date().toISOString();
}

function actorFor(input = {}) {
  return input.actor || {
    id: input.actorId || null,
    role: input.actorRole || input.role || null,
    locationId: input.locationId || null,
    isActive: input.isActive !== false,
  };
}

function makeId(input, prefix) {
  return input.createId ? input.createId(prefix) : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireRole(actor, roles, message = "目前角色沒有執行此操作的權限") {
  if (!actor || actor.isActive === false || !roles.includes(actor.role)) throw new Error(`${message}，需要 ${roles.join(" 或 ")}`);
}

function requireEntity(entity, label) {
  if (!entity) throw new Error(`找不到${label}`);
  return entity;
}

function auditSafe(value) {
  if (Array.isArray(value)) return value.map(auditSafe);
  if (!value || typeof value !== "object") return value;
  const output = {};
  Object.entries(value).forEach(([key, item]) => {
    if (["accountNumber", "account_number", "passwordHash", "password_hash", "fileData", "dataUrl"].includes(key)) {
      output[key] = key.toLowerCase().includes("account") ? maskAccount(item) : "[REDACTED]";
    } else if (["storageKey", "storage_key"].includes(key)) {
      output[key] = "[PRIVATE_STORAGE_KEY]";
    } else output[key] = auditSafe(item);
  });
  return output;
}

function addAudit(state, input, action, entityType, entityId, detail, beforeData = null, afterData = null) {
  state.auditLogs.unshift({
    id: makeId(input, "audit"),
    action,
    entityType,
    entityId: entityId || null,
    userId: actorFor(input).id || null,
    userRole: actorFor(input).role || null,
    detail: text(detail) || action,
    beforeData: auditSafe(beforeData),
    afterData: auditSafe(afterData),
    createdAt: nowFor(input),
  });
}

function transact(sourceState, input, callback) {
  const state = clone(sourceState || {});
  normalizeSupplierOperations(state);
  try {
    const result = callback(state, actorFor(input));
    return { committed: true, state, ...result };
  } catch (error) {
    return { committed: false, state: sourceState, error: error instanceof Error ? error : new Error(String(error)), errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function ensureArray(state, name) {
  state[name] = Array.isArray(state[name]) ? state[name] : [];
  return state[name];
}

function normalizePurchaseLine(line) {
  line.receivedQty = quantity(line.receivedQty);
  line.cancelledQty = quantity(line.cancelledQty);
  line.orderedQty = quantity(line.orderedQty || line.confirmedPurchaseQty || line.suggestedPurchaseQty);
  line.remainingQty = Math.max(0, line.orderedQty - line.receivedQty - line.cancelledQty);
  line.followUpStatus = PURCHASE_ITEM_FOLLOW_UP_STATUSES.includes(line.followUpStatus) ? line.followUpStatus : "PENDING";
  line.followUpNote = line.followUpNote || "";
  line.supplierResponseNote = line.supplierResponseNote || "";
  line.shortageStatus = PURCHASE_ITEM_SHORTAGE_STATUSES.includes(line.shortageStatus) ? line.shortageStatus : "NONE";
  line.shortageQty = Math.min(line.remainingQty, quantity(line.shortageQty));
  line.shortageReason = line.shortageReason || null;
  line.shortageNote = line.shortageNote || "";
  line.shortageRequeueStatus = line.shortageRequeueStatus || null;
  line.lastFollowedUpAt = line.lastFollowedUpAt || null;
  line.lastFollowedUpBy = line.lastFollowedUpBy || null;
  line.nextFollowUpAt = line.nextFollowUpAt || null;
  line.revisedExpectedDeliveryDate = line.revisedExpectedDeliveryDate || null;
  line.storeVisibleNote = line.storeVisibleNote || "";
  line.storeVisibleShortageNote = line.storeVisibleShortageNote || "";
  line.internalNote = line.internalNote || "";
  line.alternativeSupplierId = line.alternativeSupplierId || null;
  line.alternativeProductId = line.alternativeProductId || null;
  line.shortageConfirmedAt = line.shortageConfirmedAt || null;
  line.shortageConfirmedBy = line.shortageConfirmedBy || null;
  line.supplierNextAvailableDate = line.supplierNextAvailableDate || null;
  line.shortageResolvedAt = line.shortageResolvedAt || null;
  line.shortageResolvedBy = line.shortageResolvedBy || null;
  line.shortageRequeuedQty = quantity(line.shortageRequeuedQty);
  line.sourceAllocations = Array.isArray(line.sourceAllocations) ? line.sourceAllocations : [];
  line.sourceAllocations.forEach((source) => {
    source.allocatedQty = quantity(source.allocatedQty);
    source.receivedAllocatedQty = quantity(source.receivedAllocatedQty);
    source.cancelledAllocatedQty = quantity(source.cancelledAllocatedQty);
    source.requeuedQty = quantity(source.requeuedQty);
  });
  return line;
}

function hydrateLegacySourceAllocations(state, line) {
  const sources = Array.isArray(line.sourceAllocations) ? line.sourceAllocations : [];
  if (!sources.length) return;
  let remainingOrdered = quantity(line.orderedQty || line.confirmedPurchaseQty || line.suggestedPurchaseQty);
  sources.forEach((source) => {
    if (source.allocatedQty == null) {
      const demandItem = state.demands.find((demand) => demand.id === source.demandOrderId)?.items?.find((item) => item.id === source.demandOrderItemId);
      const demandQty = quantity(demandItem?.purchaseRequiredQty || demandItem?.approvedQty || demandItem?.requestedQty);
      source.allocatedQty = Math.min(remainingOrdered, demandQty || remainingOrdered);
    }
    remainingOrdered = Math.max(0, remainingOrdered - quantity(source.allocatedQty));
  });
  let remainingReceived = quantity(line.receivedQty);
  sources.forEach((source) => {
    if (source.receivedAllocatedQty == null) source.receivedAllocatedQty = Math.min(quantity(source.allocatedQty), remainingReceived);
    remainingReceived = Math.max(0, remainingReceived - quantity(source.receivedAllocatedQty));
  });
  let remainingCancelled = quantity(line.cancelledQty);
  sources.forEach((source) => {
    if (source.cancelledAllocatedQty == null) source.cancelledAllocatedQty = Math.min(quantity(source.allocatedQty) - quantity(source.receivedAllocatedQty), remainingCancelled);
    remainingCancelled = Math.max(0, remainingCancelled - quantity(source.cancelledAllocatedQty));
  });
}

export function normalizeSupplierOperations(state) {
  [
    "supplierBusinessRelations", "supplierBankAccounts", "supplierBankAttachments",
    "supplierOrderSchedules", "productIdentifiers", "supplierReturns",
    "supplierReturnItems", "supplierReturnAttachments", "purchaseOrderItemFollowups",
    "shortageRequeueEntries", "inventoryMovements", "demandPurchaseAllocations",
  ].forEach((name) => ensureArray(state, name));
  ensureArray(state, "suppliers");
  ensureArray(state, "products");
  ensureArray(state, "supplierProducts");
  ensureArray(state, "demands");
  ensureArray(state, "purchaseOrders");
  ensureArray(state, "auditLogs");
  state.suppliers.forEach((supplier) => {
    supplier.taxId = supplier.taxId || "";
    supplier.paymentMethod = SUPPLIER_PAYMENT_METHODS.includes(supplier.paymentMethod) ? supplier.paymentMethod : "BANK_TRANSFER";
    supplier.paymentMethodNote = supplier.paymentMethodNote || "";
    supplier.settlementDays = quantity(supplier.settlementDays);
    supplier.billingCycle = supplier.billingCycle || "MONTHLY";
    supplier.invoiceRequirement = supplier.invoiceRequirement || "REQUIRED";
    supplier.currency = supplier.currency || "TWD";
    supplier.supplierPublicNote = supplier.supplierPublicNote || "";
  });
  state.purchaseOrders.forEach((order) => {
    order.orderingSupplierId = order.orderingSupplierId || order.supplierId || null;
    order.payeeSupplierId = order.payeeSupplierId || null;
    order.orderingSupplierSnapshot = order.orderingSupplierSnapshot || null;
    order.payeeSupplierSnapshot = order.payeeSupplierSnapshot || null;
    order.paymentMethod = order.paymentMethod || null;
    order.paymentTerms = order.paymentTerms || null;
    order.paymentMethodNote = order.paymentMethodNote || null;
    order.orderFrequency = order.orderFrequency || null;
    order.supplierScheduleSnapshot = order.supplierScheduleSnapshot || null;
    const ordering = state.suppliers.find((supplier) => supplier.id === order.orderingSupplierId);
    const relation = state.supplierBusinessRelations.find((item) => item.orderingSupplierId === order.orderingSupplierId && item.isDefault && item.isActive !== false);
    const payee = state.suppliers.find((supplier) => supplier.id === (order.payeeSupplierId || relation?.payeeSupplierId || order.orderingSupplierId));
    if (ordering) {
      order.payeeSupplierId = payee?.id || order.payeeSupplierId || null;
      order.orderingSupplierSnapshot ||= supplierSnapshot(ordering);
      order.payeeSupplierSnapshot ||= supplierSnapshot(payee);
      order.paymentTerms ||= ordering.paymentTerms || null;
      order.paymentMethod ||= ordering.paymentMethod || null;
      order.paymentMethodNote ||= ordering.paymentMethodNote || null;
      const schedule = state.supplierOrderSchedules.find((item) => item.supplierId === ordering.id && item.isPrimary && item.isActive !== false) || state.supplierOrderSchedules.find((item) => item.supplierId === ordering.id && item.isActive !== false);
      order.orderFrequency ||= schedule?.frequencyType || null;
      order.supplierScheduleSnapshot ||= schedule ? clone(schedule) : null;
    }
    order.lines = Array.isArray(order.lines) ? order.lines : [];
    order.lines.forEach((line) => {
      hydrateLegacySourceAllocations(state, line);
      normalizePurchaseLine(line);
    });
  });
  state.supplierReturns.forEach((item) => {
    item.status = SUPPLIER_RETURN_STATUSES.includes(item.status) ? item.status : "DRAFT";
    item.items = Array.isArray(item.items) ? item.items : [];
  });
  state.supplierBankAccounts.forEach((account) => {
    account.accountNumberMasked = account.accountNumberMasked || maskAccount(account.accountNumber);
  });
  state.supplierReturnItems.forEach((item) => {
    item.returnQty = quantity(item.returnQty);
    item.replacementQty = quantity(item.replacementQty);
    item.replacementReceivedQty = quantity(item.replacementReceivedQty);
    item.refundedQty = quantity(item.refundedQty);
    item.creditedQty = quantity(item.creditedQty);
    item.rejectedQty = quantity(item.rejectedQty);
    item.unresolvedQty = Math.max(0, item.returnQty - item.refundedQty - item.creditedQty - item.replacementReceivedQty - item.rejectedQty);
  });
  state.demandPurchaseAllocations.forEach((allocation) => {
    allocation.allocatedQty = quantity(allocation.allocatedQty);
    allocation.receivedQty = quantity(allocation.receivedQty);
    allocation.cancelledQty = quantity(allocation.cancelledQty);
    allocation.requeuedQty = quantity(allocation.requeuedQty);
  });
  return state;
}

export function maskAccount(accountNumber) {
  const value = text(accountNumber);
  if (!value) return "—";
  return value.length <= 5 ? "＊".repeat(value.length) : `${"＊".repeat(Math.max(4, value.length - 5))}${value.slice(-5)}`;
}

function bankOwnerKey(account) {
  return account.payeeSupplierId || account.supplierId;
}

export function canManageSupplierCommercialData(user) {
  return Boolean(user?.isActive !== false && SUPPLIER_OPERATIONS_ROLES.commercial.includes(user.role));
}

export function canManageSupplierReturns(user) {
  return Boolean(user?.isActive !== false && SUPPLIER_OPERATIONS_ROLES.returnView.includes(user.role));
}

export function canCreateSupplierReturn(user) {
  return Boolean(user?.isActive !== false && SUPPLIER_OPERATIONS_ROLES.warehouse.includes(user.role));
}

export function canResolveSupplierReturn(user) {
  return Boolean(user?.isActive !== false && SUPPLIER_OPERATIONS_ROLES.returnResolution.includes(user.role));
}

export function canMaintainProductIdentifiers(user) {
  return Boolean(user?.isActive !== false && SUPPLIER_OPERATIONS_ROLES.identifier.includes(user.role));
}

export function validateSupplierTaxId(taxId, { existingSupplierId = null, suppliers = [], actorRole = null, exceptionReason = "" } = {}) {
  const value = text(taxId);
  if (value && !/^\d{8}$/.test(value)) return "統一編號必須是 8 位數字";
  const duplicate = suppliers.find((supplier) => supplier.id !== existingSupplierId && supplier.taxId && supplier.taxId === value);
  if (duplicate && !(actorRole === "ADMIN" && text(exceptionReason))) return "統一編號不可重複；管理員例外時必須填寫原因";
  return null;
}

export function updateSupplierCommercialTerms(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以維護供應商商務資料");
    const supplier = requireEntity(state.suppliers.find((item) => item.id === input.supplierId), "供應商");
    const changes = { ...(input.changes || input.commercial || {}) };
    const allowed = new Set(["taxId", "paymentTerms", "paymentMethod", "paymentMethodNote", "settlementDays", "billingCycle", "invoiceRequirement", "currency", "supplierPublicNote", "code", "name", "contactName", "phone", "email", "address", "leadTimeDays", "minimumOrderAmount", "isActive"]);
    const unknown = Object.keys(changes).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`供應商商務資料包含不可修改欄位：${unknown.join("、")}`);
    const taxError = validateSupplierTaxId(changes.taxId ?? supplier.taxId, { existingSupplierId: supplier.id, suppliers: state.suppliers, actorRole: actor.role, exceptionReason: input.taxIdExceptionReason });
    if (taxError) throw new Error(taxError);
    const method = changes.paymentMethod ?? supplier.paymentMethod;
    if (!SUPPLIER_PAYMENT_METHODS.includes(method)) throw new Error("付款方式不合法");
    if (method === "OTHER" && !text(changes.paymentMethodNote ?? supplier.paymentMethodNote)) throw new Error("付款方式為其他時必須填寫說明");
    const before = clone(supplier);
    Object.assign(supplier, changes);
    supplier.taxId = text(supplier.taxId);
    supplier.paymentMethodNote = text(supplier.paymentMethodNote);
    supplier.settlementDays = quantity(supplier.settlementDays);
    supplier.updatedAt = nowFor(input);
    supplier.version = Math.max(1, quantity(supplier.version) + 1);
    addAudit(state, input, "SUPPLIER_COMMERCIAL_TERMS_UPDATED", "SUPPLIER", supplier.id, "供應商付款條件與商務資料已更新", before, supplier);
    if (duplicateAuditNeeded(state, input, changes.taxId, supplier.id, input.taxIdExceptionReason)) addAudit(state, input, "SUPPLIER_TAX_ID_EXCEPTION", "SUPPLIER", supplier.id, text(input.taxIdExceptionReason), null, { taxId: "[EXCEPTION]" });
    return { supplier };
  });
}

function duplicateAuditNeeded(state, input, taxId, supplierId, reason) {
  return actorFor(input).role === "ADMIN" && text(reason) && state.suppliers.some((supplier) => supplier.id !== supplierId && supplier.taxId === text(taxId));
}

export function upsertSupplierBusinessRelation(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以維護訂購與付款對象關係");
    const ordering = requireEntity(state.suppliers.find((item) => item.id === input.orderingSupplierId), "訂購供應商");
    const payee = input.payeeSupplierId ? requireEntity(state.suppliers.find((item) => item.id === input.payeeSupplierId), "付款供應商") : null;
    if (ordering.isActive === false || payee?.isActive === false) throw new Error("訂購供應商與付款供應商都必須啟用");
    let relation = input.id ? state.supplierBusinessRelations.find((item) => item.id === input.id) : null;
    if (input.id && !relation) throw new Error("找不到供應商商務關係");
    const before = relation ? clone(relation) : null;
    relation ||= { id: makeId(input, "supplierBusinessRelation"), createdAt: nowFor(input), createdBy: actor.id || null };
    Object.assign(relation, {
      orderingSupplierId: ordering.id,
      payeeSupplierId: payee?.id || null,
      isDefault: input.isDefault !== false,
      isActive: input.isActive !== false,
      effectiveFrom: input.effectiveFrom || null,
      effectiveTo: input.effectiveTo || null,
      note: text(input.note),
      updatedAt: nowFor(input),
    });
    if (relation.isDefault) state.supplierBusinessRelations.filter((item) => item.orderingSupplierId === ordering.id && item.id !== relation.id).forEach((item) => { item.isDefault = false; item.updatedAt = nowFor(input); });
    if (!state.supplierBusinessRelations.includes(relation)) state.supplierBusinessRelations.unshift(relation);
    addAudit(state, input, "SUPPLIER_BUSINESS_RELATION_UPDATED", "SUPPLIER_BUSINESS_RELATION", relation.id, "已設定訂購供應商與付款供應商關係", before, relation);
    return { relation };
  });
}

function defaultPayeeFor(state, orderingSupplierId) {
  return state.supplierBusinessRelations.find((item) => item.orderingSupplierId === orderingSupplierId && item.isDefault && item.isActive !== false) || null;
}

function supplierSnapshot(supplier) {
  if (!supplier) return null;
  return { id: supplier.id, code: supplier.code || supplier.supplierCode || null, name: supplier.name || supplier.supplierName || null };
}

export function snapshotPurchaseOrderSupplierTerms(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以設定採購單供應商對象");
    const order = requireEntity(state.purchaseOrders.find((item) => item.id === input.purchaseOrderId), "採購單");
    const orderingId = input.orderingSupplierId || order.orderingSupplierId || order.supplierId;
    const ordering = requireEntity(state.suppliers.find((item) => item.id === orderingId), "訂購供應商");
    const relation = defaultPayeeFor(state, ordering.id);
    const payeeId = input.payeeSupplierId === undefined ? (relation?.payeeSupplierId || order.payeeSupplierId || ordering.id) : input.payeeSupplierId;
    const payee = requireEntity(state.suppliers.find((item) => item.id === payeeId), "付款供應商");
    if (ordering.isActive === false || payee.isActive === false) throw new Error("正式採購單不得使用停用供應商");
    if (order.status === "ORDERED" && order.payeeSupplierId !== payee.id && !text(input.changeReason)) throw new Error("已下單採購單切換付款供應商必須填寫原因");
    if (!order.status || ["DRAFT", "PENDING_CONFIRMATION"].includes(order.status) || text(input.changeReason)) {
      const before = { orderingSupplierId: order.orderingSupplierId, payeeSupplierId: order.payeeSupplierId, paymentMethod: order.paymentMethod, paymentTerms: order.paymentTerms };
      const schedule = state.supplierOrderSchedules.find((item) => item.supplierId === ordering.id && item.isActive !== false && item.isPrimary !== false) || state.supplierOrderSchedules.find((item) => item.supplierId === ordering.id && item.isActive !== false);
      order.orderingSupplierId = ordering.id;
      order.supplierId = ordering.id;
      order.payeeSupplierId = payee.id;
      order.orderingSupplierSnapshot = supplierSnapshot(ordering);
      order.payeeSupplierSnapshot = supplierSnapshot(payee);
      order.paymentTerms = ordering.paymentTerms || null;
      order.paymentMethod = ordering.paymentMethod || null;
      order.paymentMethodNote = ordering.paymentMethodNote || null;
      order.orderFrequency = schedule?.frequencyType || null;
      order.supplierScheduleSnapshot = schedule ? clone(schedule) : null;
      order.updatedAt = nowFor(input);
      addAudit(state, input, "PURCHASE_ORDER_SUPPLIER_SNAPSHOT_UPDATED", "PURCHASE_ORDER", order.id, text(input.changeReason) || "採購單已保存訂購與付款對象快照", before, { orderingSupplierId: order.orderingSupplierId, payeeSupplierId: order.payeeSupplierId, paymentMethod: order.paymentMethod, paymentTerms: order.paymentTerms });
    }
    return { order };
  });
}

function dateFrom(value) {
  const date = new Date(`${text(value)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDay(date) { return date.toISOString().slice(0, 10); }

export function calculateNextSupplierOrderDate(input = {}) {
  const start = dateFrom(input.fromDate || new Date().toISOString().slice(0, 10));
  if (!start) throw new Error("訂貨日期格式不正確");
  const frequency = input.frequencyType || "MANUAL";
  const interval = Math.max(1, quantity(input.intervalDays) || 1);
  if (frequency === "DAILY") start.setUTCDate(start.getUTCDate() + 1);
  else if (frequency === "WEEKLY") {
    const weekdays = [...new Set((input.weekdays || []).map(Number).filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b);
    if (!weekdays.length) start.setUTCDate(start.getUTCDate() + 7);
    else {
      for (let offset = 1; offset <= 7; offset += 1) {
        const candidate = new Date(start);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        if (weekdays.includes(candidate.getUTCDay())) return isoDay(candidate);
      }
    }
  }
  else if (frequency === "BIWEEKLY") start.setUTCDate(start.getUTCDate() + 14);
  else if (frequency === "INTERVAL_DAYS") start.setUTCDate(start.getUTCDate() + interval);
  else if (frequency === "MONTHLY") {
    start.setUTCMonth(start.getUTCMonth() + 1);
    const dayOfMonth = quantity(input.dayOfMonth);
    if (dayOfMonth >= 1 && dayOfMonth <= 31) {
      const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      start.setUTCDate(Math.min(dayOfMonth, lastDay));
    }
  }
  else return null;
  return isoDay(start);
}

export function upsertSupplierOrderSchedule(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以維護供應商訂貨週期");
    const supplier = requireEntity(state.suppliers.find((item) => item.id === input.supplierId), "供應商");
    const frequencyType = input.frequencyType || "MANUAL";
    if (!SUPPLIER_ORDER_FREQUENCIES.includes(frequencyType)) throw new Error("訂貨週期不合法");
    if (frequencyType === "INTERVAL_DAYS" && quantity(input.intervalDays) < 1) throw new Error("間隔天數至少為 1");
    let schedule = input.id ? state.supplierOrderSchedules.find((item) => item.id === input.id) : null;
    if (input.id && !schedule) throw new Error("找不到供應商訂貨週期");
    const before = schedule ? clone(schedule) : null;
    schedule ||= { id: makeId(input, "supplierOrderSchedule"), createdAt: nowFor(input), createdBy: actor.id || null };
    Object.assign(schedule, {
      supplierId: supplier.id, frequencyType, intervalDays: quantity(input.intervalDays), weekdays: Array.isArray(input.weekdays) ? input.weekdays.map(Number).filter((day) => day >= 0 && day <= 6) : [], dayOfMonth: quantity(input.dayOfMonth) || null, cutoffTime: input.cutoffTime || null, expectedDeliveryDays: quantity(input.expectedDeliveryDays ?? supplier.leadTimeDays), nextOrderDate: input.nextOrderDate || calculateNextSupplierOrderDate({ frequencyType, intervalDays: input.intervalDays, weekdays: input.weekdays, dayOfMonth: input.dayOfMonth, fromDate: input.fromDate }) || null, nextExpectedDeliveryDate: input.nextExpectedDeliveryDate || null, storeVisibleNote: text(input.storeVisibleNote), internalNote: text(input.internalNote), isPrimary: input.isPrimary !== false, isActive: input.isActive !== false, effectiveFrom: input.effectiveFrom || null, effectiveTo: input.effectiveTo || null, updatedAt: nowFor(input),
    });
    if (schedule.isPrimary) state.supplierOrderSchedules.filter((item) => item.supplierId === supplier.id && item.id !== schedule.id).forEach((item) => { item.isPrimary = false; item.updatedAt = nowFor(input); });
    if (!state.supplierOrderSchedules.includes(schedule)) state.supplierOrderSchedules.unshift(schedule);
    addAudit(state, input, "SUPPLIER_ORDER_SCHEDULE_UPDATED", "SUPPLIER_ORDER_SCHEDULE", schedule.id, "供應商訂貨週期已更新", before, schedule);
    return { schedule };
  });
}

export function getStoreSupplierSchedule(state, { supplierId, productId = null } = {}) {
  const supplierProduct = productId ? state.supplierProducts?.find((item) => item.productId === productId && item.isPrimary && item.isActive !== false) || state.supplierProducts?.find((item) => item.productId === productId && item.isActive !== false) : null;
  const id = supplierId || supplierProduct?.supplierId;
  const supplier = state.suppliers?.find((item) => item.id === id);
  const schedule = state.supplierOrderSchedules?.find((item) => item.supplierId === id && item.isPrimary && item.isActive !== false) || state.supplierOrderSchedules?.find((item) => item.supplierId === id && item.isActive !== false);
  if (!supplier || !schedule) return null;
  return { supplierId: supplier.id, supplierName: supplier.name || supplier.supplierName, frequencyType: schedule.frequencyType, nextOrderDate: schedule.nextOrderDate || null, cutoffTime: schedule.cutoffTime || null, expectedDeliveryDays: schedule.expectedDeliveryDays || 0, nextExpectedDeliveryDate: schedule.nextExpectedDeliveryDate || null, storeVisibleNote: schedule.storeVisibleNote || "" };
}

function identifierValue(type, value) {
  return type === "MANUFACTURER_ITEM_CODE" || type === "OTHER" ? text(value).toUpperCase() : text(value).replaceAll(" ", "");
}

function validateIdentifier(type, value) {
  const normalized = identifierValue(type, value);
  if (!SUPPLIER_IDENTIFIER_TYPES.includes(type)) throw new Error("商品國際代碼類型不合法");
  if (!normalized) throw new Error("商品代碼不得為空");
  if (type === "GTIN14" && !/^\d{14}$/.test(normalized)) throw new Error("GTIN-14 必須是 14 位數字");
  if (type === "EAN13" && !/^\d{13}$/.test(normalized)) throw new Error("EAN-13 必須是 13 位數字");
  if (type === "UPCA" && !/^\d{12}$/.test(normalized)) throw new Error("UPC-A 必須是 12 位數字");
  if (type === "JAN" && !/^\d{8}(?:\d{5})?$/.test(normalized)) throw new Error("JAN Code 必須是 8 或 13 位數字");
  if (type === "MANUFACTURER_ITEM_CODE" && normalized.length > 80) throw new Error("製造商料號不得超過 80 字元");
  return normalized;
}

export function upsertProductIdentifier(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.identifier, "只有採購人員、倉管或管理員可以維護商品國際代碼");
    const product = requireEntity(state.products.find((item) => item.id === input.productId), "商品");
    const type = input.identifierType || input.type;
    if (input.clear === true) {
      const existing = requireEntity(state.productIdentifiers.find((item) => item.id === input.id && item.productId === product.id), "商品國際代碼");
      const before = clone(existing);
      existing.isActive = false;
      existing.updatedAt = nowFor(input);
      addAudit(state, input, "PRODUCT_IDENTIFIER_DEACTIVATED", "PRODUCT_IDENTIFIER", existing.id, `商品 ${product.id} 的 ${type} 已清除`, before, existing);
      return { identifier: existing };
    }
    const value = validateIdentifier(type, input.value);
    const duplicate = state.productIdentifiers.find((item) => item.id !== input.id && item.identifierType === type && item.value === value && item.isActive !== false);
    if (duplicate) throw new Error("相同國際代碼已被其他商品使用");
    let identifier = input.id ? state.productIdentifiers.find((item) => item.id === input.id) : null;
    if (input.id && !identifier) throw new Error("找不到商品國際代碼");
    const before = identifier ? clone(identifier) : null;
    identifier ||= { id: makeId(input, "productIdentifier"), createdAt: nowFor(input), createdBy: actor.id || null };
    Object.assign(identifier, { productId: product.id, identifierType: type, value, country: text(input.country), issuer: text(input.issuer), isPrimary: input.isPrimary === true, isActive: input.isActive !== false, note: text(input.note), updatedAt: nowFor(input) });
    if (identifier.isPrimary) state.productIdentifiers.filter((item) => item.productId === product.id && item.id !== identifier.id && item.identifierType === type).forEach((item) => { item.isPrimary = false; });
    if (!state.productIdentifiers.includes(identifier)) state.productIdentifiers.unshift(identifier);
    addAudit(state, input, "PRODUCT_IDENTIFIER_UPDATED", "PRODUCT_IDENTIFIER", identifier.id, `商品 ${product.id} 的 ${type} 已更新`, before, identifier);
    return { identifier };
  });
}

export function getProductIdentifiers(state, productId, user = null) {
  const rows = (state.productIdentifiers || []).filter((item) => item.productId === productId && item.isActive !== false);
  if (user?.role === "STORE") return rows.filter((item) => ["GTIN14", "EAN13", "UPCA", "JAN", "MANUFACTURER_ITEM_CODE"].includes(item.identifierType)).map(({ id, productId: idProduct, identifierType, value, isPrimary }) => ({ id, productId: idProduct, identifierType, value, isPrimary }));
  return rows.map(clone);
}

function findOrderAndLine(state, input) {
  const order = requireEntity(state.purchaseOrders.find((item) => item.id === input.purchaseOrderId), "採購單");
  const line = requireEntity(order.lines.find((item) => item.id === input.purchaseOrderItemId), "採購單品項");
  return { order, line };
}

export function updatePurchaseOrderItemTracking(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以更新採購明細追蹤");
    const { order, line } = findOrderAndLine(state, input);
    const status = input.followUpStatus || line.followUpStatus || "CONTACTED";
    if (!PURCHASE_ITEM_FOLLOW_UP_STATUSES.includes(status)) throw new Error("採購明細追蹤狀態不合法");
    const before = clone(line);
    Object.assign(line, { followUpStatus: status, followUpNote: text(input.followUpNote ?? line.followUpNote), supplierResponseNote: text(input.supplierResponseNote ?? input.supplierResponse ?? line.supplierResponseNote), lastFollowedUpAt: input.contactDate || nowFor(input), lastFollowedUpBy: actor.id || null, nextFollowUpAt: input.nextFollowUpAt || null, revisedExpectedDeliveryDate: input.revisedExpectedDeliveryDate || null, supplierNextAvailableDate: input.supplierNextAvailableDate || line.supplierNextAvailableDate || null, storeVisibleNote: text(input.storeVisibleNote ?? line.storeVisibleNote), internalNote: text(input.internalNote ?? line.internalNote) });
    const history = { id: makeId(input, "purchaseOrderItemFollowup"), purchaseOrderId: order.id, purchaseOrderItemId: line.id, followUpStatus: line.followUpStatus, followUpNote: line.followUpNote, supplierResponse: line.supplierResponseNote, shortageReason: line.shortageReason, revisedExpectedDeliveryDate: line.revisedExpectedDeliveryDate, supplierNextAvailableDate: line.supplierNextAvailableDate, nextFollowUpAt: line.nextFollowUpAt, storeVisibleNote: line.storeVisibleNote, internalNote: line.internalNote, contactDate: line.lastFollowedUpAt, createdBy: actor.id || null, createdAt: nowFor(input) };
    state.purchaseOrderItemFollowups.unshift(history);
    syncSourceDemandItems(state, order, line, input);
    addAudit(state, input, "PURCHASE_ORDER_ITEM_FOLLOWUP_UPDATED", "PURCHASE_ORDER_ITEM", line.id, "採購明細追蹤已更新", before, line);
    return { order, line, followup: history };
  });
}

function sourceLocations(line) { return [...new Set((line.sourceAllocations || []).map((source) => source.locationId).filter(Boolean))]; }

function publicPurchaseStatus(order, line) {
  if (line.shortageRequeueStatus === "ALTERNATIVE") return "ALTERNATIVE_AVAILABLE";
  if (line.shortageRequeueStatus === "NO_GROUP") return "NO_GROUP";
  if (line.shortageRequeueStatus === "REQUEUED") return "REQUEUED";
  if (quantity(line.shortageQty) > 0) return line.shortageStatus || "PARTIAL_SHORTAGE";
  if (line.shortageStatus === "CANCELLED") return "CANCELLED";
  if (line.followUpStatus === "DELAYED") return "DELAYED";
  if (line.followUpStatus === "PARTIAL") return "PARTIALLY_RECEIVED";
  if (line.followUpStatus === "RESOLVED") return "RECEIVED";
  return order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED" ? order.status : line.followUpStatus || order.status || "ORDERED";
}

function sourceKey(source) {
  return `${source.demandOrderId || ""}:${source.demandOrderItemId || ""}`;
}

function sourceOpenQty(source) {
  return Math.max(0, quantity(source.allocatedQty) - quantity(source.receivedAllocatedQty) - quantity(source.cancelledAllocatedQty));
}

function shortageBySource(line) {
  const result = new Map();
  let remaining = quantity(line.shortageQty);
  (line.sourceAllocations || []).forEach((source) => {
    const shortageQty = Math.min(sourceOpenQty(source), remaining);
    result.set(sourceKey(source), shortageQty);
    remaining -= shortageQty;
  });
  return result;
}

function applySourceAllocationCancellation(state, line, requestedQty, { requeue = false, cancelDemand = false } = {}) {
  let remaining = quantity(requestedQty);
  const changes = [];
  for (const source of line.sourceAllocations || []) {
    if (!remaining || !source.demandOrderId || !source.demandOrderItemId) break;
    const changedQty = Math.min(sourceOpenQty(source), remaining);
    if (!changedQty) continue;
    source.cancelledAllocatedQty = quantity(source.cancelledAllocatedQty) + changedQty;
    if (requeue) source.requeuedQty = quantity(source.requeuedQty) + changedQty;
    const allocation = state.demandPurchaseAllocations.find((row) => row.purchaseOrderItemId === line.id && row.demandOrderId === source.demandOrderId && row.demandOrderItemId === source.demandOrderItemId);
    if (allocation) {
      allocation.cancelledAllocatedQty = quantity(allocation.cancelledAllocatedQty) + changedQty;
      if (requeue) allocation.requeuedQty = quantity(allocation.requeuedQty) + changedQty;
      allocation.updatedAt = new Date().toISOString();
    }
    if (cancelDemand) {
      const demandItem = state.demands.find((demand) => demand.id === source.demandOrderId)?.items?.find((item) => item.id === source.demandOrderItemId);
      if (demandItem) demandItem.cancelledQty = quantity(demandItem.cancelledQty) + changedQty;
    }
    changes.push({ key: sourceKey(source), quantity: changedQty });
    remaining -= changedQty;
  }
  return { changedQty: quantity(requestedQty) - remaining, changes };
}

function syncSourceDemandItems(state, order, line, input = {}) {
  const publicStatus = publicPurchaseStatus(order, line);
  const publicNote = text(line.storeVisibleShortageNote || line.storeVisibleNote || line.supplierResponseNote);
  const shortageMap = shortageBySource(line);
  (line.sourceAllocations || []).forEach((source) => {
    const demand = state.demands.find((item) => item.id === source.demandOrderId);
    const demandItem = demand?.items?.find((item) => item.id === source.demandOrderItemId);
    if (!demandItem) return;
    const sourceShortageQty = quantity(shortageMap.get(sourceKey(source)));
    const sourceRequeuedQty = quantity(source.requeuedQty);
    const sourceStatus = sourceRequeuedQty > 0
      ? (line.shortageRequeueStatus === "NO_GROUP" ? "NO_GROUP" : line.shortageRequeueStatus === "ALTERNATIVE" ? "ALTERNATIVE_AVAILABLE" : "REQUEUED")
      : sourceShortageQty > 0
        ? (line.shortageStatus || "PARTIAL_SHORTAGE")
        : line.shortageStatus === "CANCELLED" ? "CANCELLED" : publicStatus;
    demandItem.purchaseShortageQty = sourceShortageQty;
    demandItem.purchaseOpenQty = sourceOpenQty(source);
    demandItem.purchaseRequeuedQty = sourceRequeuedQty;
    demandItem.purchaseLatestExpectedDeliveryDate = line.revisedExpectedDeliveryDate || order.expectedDeliveryDate || null;
    demandItem.purchaseFollowUpStatus = line.followUpStatus || "PENDING";
    demandItem.purchaseStoreVisibleNote = publicNote;
    demandItem.procurementStatus = sourceStatus;
    demandItem.procurementStatusReason = line.shortageReason || (sourceRequeuedQty > 0 ? "REQUEUED" : null);
    demandItem.procurementStatusNote = publicNote || text(line.shortageNote || line.shortageResolutionReason);
    demandItem.procurementStatusUpdatedAt = line.shortageConfirmedAt || line.lastFollowedUpAt || nowFor(input);
  });
}

function syncSourceDemandReturnStatus(state, returnItem, returnOrder, input = {}) {
  if (!returnItem.purchaseOrderItemId) return;
  const sourceOrder = state.purchaseOrders.find((order) => order.lines?.some((line) => line.id === returnItem.purchaseOrderItemId));
  const sourceLine = sourceOrder?.lines?.find((line) => line.id === returnItem.purchaseOrderItemId);
  if (!sourceOrder || !sourceLine) return;
  const status = returnOrder.status === "RESOLVED" ? "RETURN_RESOLVED" : returnOrder.status === "REJECTED_BY_SUPPLIER" ? "RETURN_REJECTED" : "RETURN_PROCESSING";
  const publicNote = text(returnItem.supplierResponse || "供應商退貨處理中");
  (sourceLine.sourceAllocations || []).forEach((source) => {
    const demand = state.demands.find((item) => item.id === source.demandOrderId);
    const demandItem = demand?.items?.find((item) => item.id === source.demandOrderItemId);
    if (!demandItem) return;
    demandItem.purchaseReturnStatus = status;
    demandItem.procurementStatus = status;
    demandItem.procurementStatusReason = returnItem.reasonCode || null;
    demandItem.procurementStatusNote = publicNote;
    demandItem.procurementStatusUpdatedAt = nowFor(input);
  });
}

export function getPurchaseOrderItemTrackingRows(state, user = null) {
  requireRole(actorFor(user || {}), SUPPLIER_OPERATIONS_ROLES.storeView, "目前角色無法查看採購明細追蹤");
  const rows = [];
  (state.purchaseOrders || []).forEach((order) => (order.lines || []).forEach((line) => {
    if ((line.remainingQty <= 0 && line.shortageQty <= 0 && !line.shortageRequeueStatus) || ["CANCELLED", "RECEIVED", "CLOSED"].includes(order.status)) return;
    const locations = sourceLocations(line);
    if (user?.role === "STORE" && !locations.includes(user.locationId)) return;
    rows.push({ purchaseOrderId: order.id, purchaseOrderNumber: order.purchaseOrderNumber, orderingSupplierId: order.orderingSupplierId || order.supplierId, orderingSupplierName: order.orderingSupplierSnapshot?.name || state.suppliers?.find((item) => item.id === (order.orderingSupplierId || order.supplierId))?.name || "—", payeeSupplierId: order.payeeSupplierId || null, payeeSupplierName: order.payeeSupplierSnapshot?.name || state.suppliers?.find((item) => item.id === order.payeeSupplierId)?.name || "—", purchaseOrderStatus: order.status, purchaseOrderItemId: line.id, productId: line.productId, orderedQty: line.orderedQty, receivedQty: line.receivedQty, openQty: line.remainingQty, shortageQty: line.shortageQty, shortageStatus: line.shortageStatus, shortageRequeueStatus: line.shortageRequeueStatus, shortageRequeuedQty: line.shortageRequeuedQty, shortageReason: line.shortageReason, originalExpectedDeliveryDate: order.expectedDeliveryDate || null, latestExpectedDeliveryDate: line.revisedExpectedDeliveryDate || order.expectedDeliveryDate || null, supplierNextAvailableDate: line.supplierNextAvailableDate || null, followUpStatus: line.followUpStatus, lastFollowedUpAt: line.lastFollowedUpAt, nextFollowUpAt: line.nextFollowUpAt, supplierResponseNote: line.supplierResponseNote, storeVisibleNote: line.storeVisibleNote, storeVisibleShortageNote: line.storeVisibleShortageNote, internalNote: user?.role === "STORE" ? "" : line.internalNote, sourceLocationIds: user?.role === "STORE" ? locations.filter((id) => id === user.locationId) : locations, alternativeSupplierId: line.alternativeSupplierId, alternativeProductId: line.alternativeProductId });
  }));
  if (user?.role === "WAREHOUSE") {
    return rows.map((row) => {
      const safeRow = { ...row };
      delete safeRow.payeeSupplierId;
      delete safeRow.payeeSupplierName;
      return safeRow;
    });
  }
  if (user?.role === "STORE") {
    return rows.map((row) => {
      const safeRow = { ...row };
      delete safeRow.payeeSupplierId;
      delete safeRow.payeeSupplierName;
      const order = state.purchaseOrders.find((candidate) => candidate.id === row.purchaseOrderId);
      const line = order?.lines?.find((candidate) => candidate.id === row.purchaseOrderItemId);
      const sources = (line?.sourceAllocations || []).filter((source) => source.locationId === user.locationId);
      const shortageMap = line ? shortageBySource(line) : new Map();
      const openQty = sources.reduce((sum, source) => sum + sourceOpenQty(source), 0);
      const shortageQty = sources.reduce((sum, source) => sum + quantity(shortageMap.get(sourceKey(source))), 0);
      const requeuedQty = sources.reduce((sum, source) => sum + quantity(source.requeuedQty), 0);
      return { ...safeRow, openQty, shortageQty, sourceLocationIds: [user.locationId], requeuedQty, storeVisibleNote: row.storeVisibleShortageNote || row.storeVisibleNote };
    }).filter((row) => row.openQty > 0 || row.shortageQty > 0 || row.requeuedQty > 0);
  }
  return rows;
}

export function updatePurchaseOrderItemShortage(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以維護採購明細缺貨");
    const { order, line } = findOrderAndLine(state, input);
    const shortageQty = quantity(input.shortageQty);
    if (shortageQty > line.remainingQty) throw new Error("缺貨數量不可大於尚未到貨數量");
    const status = shortageQty === 0
      ? (["NONE", "RESOLVED", "CANCELLED"].includes(input.shortageStatus) ? input.shortageStatus : "NONE")
      : (input.shortageStatus || (shortageQty < line.remainingQty ? "PARTIAL_SHORTAGE" : "FULL_SHORTAGE"));
    if (!PURCHASE_ITEM_SHORTAGE_STATUSES.includes(status)) throw new Error("缺貨狀態不合法");
    if (shortageQty > 0 && ["NONE", "RESOLVED", "CANCELLED"].includes(status)) throw new Error("有缺貨數量時狀態不可為 NONE、RESOLVED 或 CANCELLED");
    if (shortageQty > 0 && !PURCHASE_ITEM_SHORTAGE_REASONS.includes(input.shortageReason)) throw new Error("缺貨原因不合法");
    const before = clone(line);
    Object.assign(line, { shortageQty, shortageStatus: status, shortageReason: shortageQty ? input.shortageReason : null, shortageNote: text(input.shortageNote), shortageConfirmedAt: nowFor(input), shortageConfirmedBy: actor.id || null, supplierNextAvailableDate: input.supplierNextAvailableDate || line.supplierNextAvailableDate || null, shortageResolvedAt: ["RESOLVED", "CANCELLED"].includes(status) ? nowFor(input) : null, shortageResolvedBy: ["RESOLVED", "CANCELLED"].includes(status) ? actor.id || null : null, storeVisibleShortageNote: text(input.storeVisibleShortageNote ?? line.storeVisibleShortageNote) });
    syncSourceDemandItems(state, order, line, input);
    addAudit(state, input, "PURCHASE_ORDER_ITEM_SHORTAGE_UPDATED", "PURCHASE_ORDER_ITEM", line.id, `缺貨 ${shortageQty} 件`, before, line);
    return { order, line };
  });
}

export function cancelPurchaseOrderItemShortage(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以取消採購明細缺貨");
    const { order, line } = findOrderAndLine(state, input);
    const cancelQty = Math.min(line.shortageQty, quantity(input.quantity || line.shortageQty));
    if (!cancelQty) throw new Error("沒有可取消的缺貨數量");
    if (!text(input.reason)) throw new Error("取消缺貨數量必須填寫原因");
    const before = clone(line);
    const requeue = ["REQUEUE", "NO_GROUP"].includes(input.action);
    const sourceChange = applySourceAllocationCancellation(state, line, cancelQty, { requeue, cancelDemand: !requeue });
    line.shortageQty = Math.max(0, line.shortageQty - cancelQty);
    line.cancelledQty += cancelQty;
    line.remainingQty = Math.max(0, line.orderedQty - line.receivedQty - line.cancelledQty);
    line.shortageStatus = line.shortageQty ? "PARTIAL_SHORTAGE" : "CANCELLED";
    line.shortageRequeueStatus = input.action === "NO_GROUP" ? "NO_GROUP" : input.action === "REQUEUE" ? "REQUEUED" : null;
    line.shortageRequeuedQty += requeue ? sourceChange.changedQty : 0;
    line.shortageResolutionReason = text(input.reason);
    line.shortageResolvedAt = !line.shortageQty ? nowFor(input) : null;
    line.shortageResolvedBy = !line.shortageQty ? actor.id || null : null;
    syncSourceDemandItems(state, order, line, input);
    addAudit(state, input, "PURCHASE_ORDER_ITEM_SHORTAGE_CANCELLED", "PURCHASE_ORDER_ITEM", line.id, `${cancelQty} 件缺貨取消／${line.shortageRequeueStatus || "未重新納池"}`, before, line);
    return { order, line, cancelledQty: cancelQty };
  });
}

export function requeuePurchaseOrderItemShortage(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以將缺貨重新納入採購池");
    const { order, line } = findOrderAndLine(state, input);
    if (!line.shortageQty) throw new Error("目前沒有可重新納入採購池的缺貨數量");
    if (!text(input.reason)) throw new Error("缺貨重新處理必須填寫原因");
    const requeueQty = line.shortageQty;
    const sourceChange = applySourceAllocationCancellation(state, line, requeueQty, { requeue: true });
    line.cancelledQty += requeueQty;
    line.remainingQty = Math.max(0, line.orderedQty - line.receivedQty - line.cancelledQty);
    line.shortageQty = 0;
    line.shortageStatus = "CANCELLED";
    line.shortageRequeuedQty += requeueQty;
    const entry = { id: makeId(input, "shortageRequeue"), sourcePurchaseOrderId: order.id, sourcePurchaseOrderItemId: line.id, productId: line.productId, supplierId: input.supplierId || line.alternativeSupplierId || order.orderingSupplierId || order.supplierId, quantity: requeueQty, action: input.action === "NO_GROUP" ? "NO_GROUP" : "REQUEUE", reason: text(input.reason), sourceLocationIds: sourceLocations(line), sourceChanges: sourceChange.changes, createdBy: actor.id || null, createdAt: nowFor(input), status: input.action === "NO_GROUP" ? "NO_GROUP" : "WAITING_AGGREGATION" };
    state.shortageRequeueEntries.unshift(entry);
    line.shortageRequeueStatus = entry.action === "NO_GROUP" ? "NO_GROUP" : "REQUEUED";
    line.shortageResolutionReason = text(input.reason);
    syncSourceDemandItems(state, order, line, input);
    addAudit(state, input, "PURCHASE_SHORTAGE_REQUEUED", "PURCHASE_ORDER_ITEM", line.id, entry.action === "NO_GROUP" ? "缺貨標記無成團" : "缺貨已重新納入採購池", null, entry);
    return { entry, order, line };
  });
}

export function setPurchaseOrderItemAlternative(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以設定替代供應來源");
    const { order, line } = findOrderAndLine(state, input);
    if (!line.shortageQty) throw new Error("只有有缺貨數量的明細才能設定替代來源");
    if (input.alternativeSupplierId && !state.suppliers.some((item) => item.id === input.alternativeSupplierId && item.isActive !== false)) throw new Error("替代供應商未啟用或不存在");
    if (input.alternativeProductId && !state.products.some((item) => item.id === input.alternativeProductId && item.isActive !== false)) throw new Error("替代商品未啟用或不存在");
    const requeueQty = line.shortageQty;
    const sourceChange = applySourceAllocationCancellation(state, line, requeueQty, { requeue: true });
    line.alternativeSupplierId = input.alternativeSupplierId || null;
    line.alternativeProductId = input.alternativeProductId || null;
    line.shortageStatus = "ALTERNATIVE_AVAILABLE";
    line.shortageQty = 0;
    line.cancelledQty += requeueQty;
    line.remainingQty = Math.max(0, line.orderedQty - line.receivedQty - line.cancelledQty);
    line.shortageRequeueStatus = "ALTERNATIVE";
    line.shortageRequeuedQty += requeueQty;
    line.shortageNote = text(input.note);
    const entry = { id: makeId(input, "shortageRequeue"), sourcePurchaseOrderId: order.id, sourcePurchaseOrderItemId: line.id, productId: line.productId, alternativeProductId: line.alternativeProductId, alternativeSupplierId: line.alternativeSupplierId, supplierId: line.alternativeSupplierId || order.orderingSupplierId || order.supplierId, quantity: requeueQty, action: "ALTERNATIVE", reason: text(input.note), sourceLocationIds: sourceLocations(line), sourceChanges: sourceChange.changes, createdBy: actor.id || null, createdAt: nowFor(input), status: "WAITING_AGGREGATION" };
    state.shortageRequeueEntries.unshift(entry);
    syncSourceDemandItems(state, order, line, input);
    addAudit(state, input, "PURCHASE_ORDER_ITEM_ALTERNATIVE_SET", "PURCHASE_ORDER_ITEM", line.id, "已設定替代供應來源", null, { alternativeSupplierId: line.alternativeSupplierId, alternativeProductId: line.alternativeProductId });
    return { order, line, entry };
  });
}

export function getStorePurchaseStatus(state, user, demandOrderId = null) {
  requireRole(actorFor(user || {}), SUPPLIER_OPERATIONS_ROLES.storeView, "目前角色無法查看採購進度");
  return getPurchaseOrderItemTrackingRows(state, user).filter((row) => !demandOrderId || (state.purchaseOrders.find((order) => order.id === row.purchaseOrderId)?.lines.find((line) => line.id === row.purchaseOrderItemId)?.sourceAllocations || []).some((source) => source.demandOrderId === demandOrderId)).map((row) => {
    const schedule = getStoreSupplierSchedule(state, { supplierId: row.orderingSupplierId, productId: row.productId });
    return { purchaseOrderNumber: row.purchaseOrderNumber, productId: row.productId, orderingSupplierName: row.orderingSupplierName, purchaseOrderStatus: row.purchaseOrderStatus, isOrdered: ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(row.purchaseOrderStatus), orderedQty: row.orderedQty, receivedQty: row.receivedQty, openQty: row.openQty, requeuedQty: row.requeuedQty || 0, shortageQty: row.shortageQty, shortageStatus: row.shortageStatus, shortageRequeueStatus: row.shortageRequeueStatus || null, shortageReason: row.shortageReason, latestExpectedDeliveryDate: row.latestExpectedDeliveryDate, supplierNextAvailableDate: row.supplierNextAvailableDate || null, followUpStatus: row.followUpStatus, lastFollowedUpAt: row.lastFollowedUpAt, nextFollowUpAt: row.nextFollowUpAt, latestStatusUpdatedAt: row.lastFollowedUpAt || null, purchaseFrequency: schedule?.frequencyType || null, nextOrderDate: schedule?.nextOrderDate || null, cutoffTime: schedule?.cutoffTime || null, expectedDeliveryDays: schedule?.expectedDeliveryDays || 0, nextExpectedDeliveryDate: schedule?.nextExpectedDeliveryDate || null, storeVisibleNote: row.storeVisibleShortageNote || row.storeVisibleNote, sourceLocationIds: row.sourceLocationIds };
  });
}

function getWarehouseBalance(state, locationId, productId) {
  let balance = state.inventory?.find((item) => item.locationId === locationId && item.productId === productId);
  if (!balance) { state.inventory ||= []; balance = { id: makeId({}, "balance"), locationId, productId, onHandQty: 0, reservedQty: 0, returnReservedQty: 0 }; state.inventory.push(balance); }
  balance.onHandQty = quantity(balance.onHandQty);
  balance.reservedQty = quantity(balance.reservedQty);
  balance.returnReservedQty = quantity(balance.returnReservedQty);
  return balance;
}

function returnItem(state, returnOrderItemId) { return requireEntity(state.supplierReturnItems.find((item) => item.id === returnOrderItemId), "退貨明細"); }
function returnOrderForItem(state, item) { return requireEntity(state.supplierReturns.find((order) => order.id === item.returnOrderId), "退貨單"); }

function nextReturnNumber(state, dateValue) {
  const stamp = text(dateValue || new Date().toISOString()).slice(0, 10).replaceAll("-", "");
  const prefix = `RTV-${stamp}-`;
  const count = state.supplierReturns.filter((item) => String(item.returnNumber || "").startsWith(prefix)).length + 1;
  return `${prefix}${String(count).padStart(3, "0")}`;
}

export function createSupplierReturnDraft(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.warehouse, "只有總倉或管理員可以建立供應商退貨草稿");
    const supplier = requireEntity(state.suppliers.find((item) => item.id === input.supplierId), "供應商");
    if (supplier.isActive === false) throw new Error("供應商已停用");
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error("退貨單至少需要一項商品");
    const returnOrder = { id: makeId(input, "supplierReturn"), returnNumber: nextReturnNumber(state, input.createdAt), supplierId: supplier.id, orderingSupplierId: input.orderingSupplierId || supplier.id, payeeSupplierId: input.payeeSupplierId || null, sourceType: input.sourceType || "WAREHOUSE_STOCK", sourcePurchaseOrderId: input.sourcePurchaseOrderId || null, sourceReceiptId: input.sourceReceiptId || null, status: "DRAFT", returnDate: input.returnDate || nowFor(input).slice(0, 10), expectedResolutionDate: input.expectedResolutionDate || null, actualResolutionDate: null, returnReason: text(input.returnReason), supplierResponse: "", warehouseNote: text(input.warehouseNote), purchasingNote: "", resolutionType: null, totalQty: 0, estimatedAmount: "0.00", confirmedAmount: "0.00", createdBy: actor.id || null, confirmedBy: null, returnedBy: null, resolvedBy: null, createdAt: nowFor(input), confirmedAt: null, returnedAt: null, resolvedAt: null, updatedAt: nowFor(input) };
    if (!SUPPLIER_RETURN_SOURCES.includes(returnOrder.sourceType)) throw new Error("退貨來源不合法");
    const createdItems = items.map((item) => {
      const product = requireEntity(state.products.find((candidate) => candidate.id === item.productId), "退貨商品");
      const qty = quantity(item.returnQty);
      if (!qty) throw new Error("退貨數量必須大於 0");
      const sourceOrder = item.purchaseOrderItemId ? state.purchaseOrders.find((purchaseOrder) => purchaseOrder.lines?.some((line) => line.id === item.purchaseOrderItemId)) : null;
      if (item.purchaseOrderItemId && (!sourceOrder || (input.sourcePurchaseOrderId && sourceOrder.id !== input.sourcePurchaseOrderId))) throw new Error("退貨來源採購明細不存在或與採購單不一致");
      if (item.purchaseOrderItemId && state.supplierReturnItems.some((existing) => existing.purchaseOrderItemId === item.purchaseOrderItemId && !["RESOLVED", "CANCELLED"].includes(state.supplierReturns.find((order) => order.id === existing.returnOrderId)?.status))) throw new Error("同一採購明細已有處理中的退貨，不得重複退貨");
      if (product.batchTrackingEnabled && !text(item.batchNumber)) throw new Error(`${product.name || product.id} 需要批號`);
      if (product.expiryTrackingEnabled && !text(item.expiryDate)) throw new Error(`${product.name || product.id} 需要效期`);
      const balance = getWarehouseBalance(state, item.warehouseLocationId || "warehouse", product.id);
      const available = Math.max(0, balance.onHandQty - balance.reservedQty - balance.returnReservedQty);
      if (qty > available) throw new Error(`${product.name || product.id} 可退數量不足`);
      return { id: makeId(input, "supplierReturnItem"), returnOrderId: returnOrder.id, productId: product.id, purchaseOrderItemId: item.purchaseOrderItemId || null, receiptItemId: item.receiptItemId || null, warehouseLocationId: item.warehouseLocationId || "warehouse", availableQtyAtCreation: available, returnQty: qty, batchNumber: text(item.batchNumber), expiryDate: text(item.expiryDate), unitPrice: decimal(item.unitPrice), estimatedAmount: decimal(qty * Number(item.unitPrice || 0)), confirmedAmount: "0.00", reasonCode: item.reasonCode || "OTHER", itemCondition: text(item.itemCondition), supplierResponse: "", replacementQty: 0, replacementReceivedQty: 0, refundedQty: 0, creditedQty: 0, rejectedQty: 0, unresolvedQty: qty, note: text(item.note), reservedQty: 0, returnedQty: 0, createdAt: nowFor(input), updatedAt: nowFor(input) };
    });
    if (createdItems.some((item) => !SUPPLIER_RETURN_REASON_CODES.includes(item.reasonCode))) throw new Error("退貨原因不合法");
    returnOrder.totalQty = createdItems.reduce((sum, item) => sum + item.returnQty, 0);
    returnOrder.estimatedAmount = decimal(createdItems.reduce((sum, item) => sum + Number(item.estimatedAmount), 0));
    state.supplierReturns.unshift(returnOrder);
    state.supplierReturnItems.push(...createdItems);
    addAudit(state, input, "SUPPLIER_RETURN_DRAFT_CREATED", "SUPPLIER_RETURN_ORDER", returnOrder.id, `${returnOrder.returnNumber} 建立退貨草稿`, null, returnOrder);
    return { returnOrder, items: createdItems };
  });
}

export function updateSupplierReturnDraft(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.warehouse, "只有總倉或管理員可以編輯供應商退貨草稿");
    const order = requireEntity(state.supplierReturns.find((item) => item.id === input.returnOrderId), "退貨單");
    if (order.status !== "DRAFT") throw new Error("只有退貨草稿可以編輯");
    const item = requireEntity(state.supplierReturnItems.find((row) => row.id === input.returnOrderItemId && row.returnOrderId === order.id), "退貨明細");
    const changes = input.item || {};
    const product = requireEntity(state.products.find((candidate) => candidate.id === (changes.productId || item.productId)), "退貨商品");
    const qty = quantity(changes.returnQty ?? item.returnQty);
    if (!qty) throw new Error("退貨數量必須大於 0");
    const batchNumber = text(changes.batchNumber ?? item.batchNumber);
    const expiryDate = text(changes.expiryDate ?? item.expiryDate);
    if (product.batchTrackingEnabled && !batchNumber) throw new Error(`${product.name || product.id} 需要批號`);
    if (product.expiryTrackingEnabled && !expiryDate) throw new Error(`${product.name || product.id} 需要效期`);
    const balance = getWarehouseBalance(state, changes.warehouseLocationId || item.warehouseLocationId || "warehouse", product.id);
    const available = Math.max(0, balance.onHandQty - balance.reservedQty - balance.returnReservedQty);
    if (qty > available) throw new Error(`${product.name || product.id} 可退數量不足`);
    const reasonCode = changes.reasonCode || item.reasonCode;
    if (!SUPPLIER_RETURN_REASON_CODES.includes(reasonCode)) throw new Error("退貨原因不合法");
    const before = { order: clone(order), item: clone(item) };
    Object.assign(order, { sourceType: changes.sourceType || order.sourceType, returnReason: text(changes.returnReason ?? order.returnReason), warehouseNote: text(changes.warehouseNote ?? order.warehouseNote), expectedResolutionDate: changes.expectedResolutionDate || order.expectedResolutionDate || null, updatedAt: nowFor(input) });
    if (!SUPPLIER_RETURN_SOURCES.includes(order.sourceType)) throw new Error("退貨來源不合法");
    Object.assign(item, { productId: product.id, warehouseLocationId: changes.warehouseLocationId || item.warehouseLocationId || "warehouse", availableQtyAtCreation: available, returnQty: qty, batchNumber, expiryDate, unitPrice: decimal(changes.unitPrice ?? item.unitPrice), estimatedAmount: decimal(qty * Number(changes.unitPrice ?? item.unitPrice ?? 0)), reasonCode, itemCondition: text(changes.itemCondition ?? item.itemCondition), note: text(changes.note ?? item.note), unresolvedQty: qty, updatedAt: nowFor(input) });
    order.totalQty = state.supplierReturnItems.filter((row) => row.returnOrderId === order.id).reduce((sum, row) => sum + row.returnQty, 0);
    order.estimatedAmount = decimal(state.supplierReturnItems.filter((row) => row.returnOrderId === order.id).reduce((sum, row) => sum + Number(row.estimatedAmount || 0), 0));
    addAudit(state, input, "SUPPLIER_RETURN_DRAFT_UPDATED", "SUPPLIER_RETURN_ORDER", order.id, "供應商退貨草稿已更新", before, { order, item });
    return { returnOrder: order, item };
  });
}

export function transitionSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.supplierReturns.find((item) => item.id === input.returnOrderId), "退貨單");
    const next = input.status;
    const roleMap = { PENDING_SUPPLIER_CONFIRMATION: SUPPLIER_OPERATIONS_ROLES.warehouse, SUPPLIER_CONFIRMED: SUPPLIER_OPERATIONS_ROLES.returnResolution, REJECTED_BY_SUPPLIER: SUPPLIER_OPERATIONS_ROLES.returnResolution, READY_TO_RETURN: SUPPLIER_OPERATIONS_ROLES.returnResolution, RETURNED_TO_SUPPLIER: SUPPLIER_OPERATIONS_ROLES.warehouse, WAITING_RESOLUTION: SUPPLIER_OPERATIONS_ROLES.warehouse, RESOLVED: SUPPLIER_OPERATIONS_ROLES.returnResolution, CANCELLED: SUPPLIER_OPERATIONS_ROLES.warehouse };
    requireRole(actor, roleMap[next] || SUPPLIER_OPERATIONS_ROLES.returnView, "目前角色無法變更退貨單狀態");
    const valid = { DRAFT: ["PENDING_SUPPLIER_CONFIRMATION", "CANCELLED"], PENDING_SUPPLIER_CONFIRMATION: ["SUPPLIER_CONFIRMED", "REJECTED_BY_SUPPLIER", "CANCELLED"], SUPPLIER_CONFIRMED: ["READY_TO_RETURN", "CANCELLED"], READY_TO_RETURN: ["RETURNED_TO_SUPPLIER"], RETURNED_TO_SUPPLIER: ["WAITING_RESOLUTION"], WAITING_RESOLUTION: ["PARTIALLY_RESOLVED", "RESOLVED"], PARTIALLY_RESOLVED: ["RESOLVED"] };
    if (!SUPPLIER_RETURN_STATUSES.includes(next) || !(valid[order.status] || []).includes(next)) throw new Error(`退貨單不可由 ${order.status} 轉為 ${next}`);
    const before = clone(order);
    if (next === "READY_TO_RETURN") reserveReturnItems(state, order, input);
    order.status = next;
    order.updatedAt = nowFor(input);
    if (next === "SUPPLIER_CONFIRMED") { order.confirmedBy = actor.id || null; order.confirmedAt = nowFor(input); }
    if (next === "RETURNED_TO_SUPPLIER") { order.returnedBy = actor.id || null; order.returnedAt = nowFor(input); }
    if (next === "RESOLVED") { order.resolvedBy = actor.id || null; order.resolvedAt = nowFor(input); order.actualResolutionDate = nowFor(input).slice(0, 10); }
    if (next === "RETURNED_TO_SUPPLIER") executeReturnInventory(state, order, input);
    state.supplierReturnItems.filter((item) => item.returnOrderId === order.id).forEach((item) => syncSourceDemandReturnStatus(state, item, order, input));
    addAudit(state, input, "SUPPLIER_RETURN_STATUS_CHANGED", "SUPPLIER_RETURN_ORDER", order.id, `${before.status} → ${next}`, before, order);
    return { returnOrder: order };
  });
}

function reserveReturnItems(state, order, input) {
  state.supplierReturnItems.filter((item) => item.returnOrderId === order.id).forEach((item) => {
    const balance = getWarehouseBalance(state, item.warehouseLocationId, item.productId);
    const available = Math.max(0, balance.onHandQty - balance.reservedQty - balance.returnReservedQty);
    if (item.returnQty > available) throw new Error("退貨保留數量已超過目前可用庫存");
    balance.returnReservedQty += item.returnQty;
    item.reservedQty = item.returnQty;
    item.updatedAt = nowFor(input);
  });
}

function executeReturnInventory(state, order, input) {
  state.supplierReturnItems.filter((item) => item.returnOrderId === order.id).forEach((item) => {
    if (item.returnedQty) throw new Error("退貨已執行出庫，不得重複出庫");
    const balance = getWarehouseBalance(state, item.warehouseLocationId, item.productId);
    if (balance.onHandQty < item.returnQty) throw new Error("退貨出庫時庫存不足");
    balance.onHandQty -= item.returnQty;
    balance.returnReservedQty = Math.max(0, balance.returnReservedQty - item.reservedQty);
    item.returnedQty = item.returnQty;
    item.reservedQty = 0;
    item.updatedAt = nowFor(input);
    state.inventoryMovements.unshift({ id: makeId(input, "inventoryMovement"), locationId: item.warehouseLocationId, productId: item.productId, movementType: "SUPPLIER_RETURN_OUTBOUND", quantity: -item.returnQty, sourceType: "SUPPLIER_RETURN", sourceId: order.id, createdBy: actorFor(input).id || null, createdAt: nowFor(input), note: order.returnNumber });
  });
}

export function uploadSupplierAttachment(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const returnItem = input.returnOrderItemId ? requireEntity(state.supplierReturnItems.find((item) => item.id === input.returnOrderItemId), "退貨明細") : null;
    const returnOrder = input.returnOrderId ? requireEntity(state.supplierReturns.find((item) => item.id === input.returnOrderId), "退貨單") : returnItem ? requireEntity(state.supplierReturns.find((item) => item.id === returnItem.returnOrderId), "退貨單") : null;
    const bankAccount = input.supplierBankAccountId ? requireEntity(state.supplierBankAccounts.find((item) => item.id === input.supplierBankAccountId), "供應商銀行帳戶") : null;
    const isReturn = Boolean(returnOrder || returnItem);
    const roles = isReturn ? SUPPLIER_OPERATIONS_ROLES.returnView : SUPPLIER_OPERATIONS_ROLES.commercial;
    requireRole(actor, roles, "目前角色無法上傳供應商附件");
    if (!isReturn && !bankAccount) throw new Error("附件必須綁定銀行帳戶或退貨單");
    if (returnItem && returnItem.returnOrderId !== returnOrder.id) throw new Error("退貨附件與退貨單不相符");
    const fileName = text(input.fileName);
    const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension) || !ALLOWED_ATTACHMENT_EXTENSIONS.has(text(input.fileType).split("/").pop().toLowerCase())) throw new Error("附件只允許 PDF、JPG、JPEG、PNG");
    if (quantity(input.fileSize) <= 0 || quantity(input.fileSize) > MAX_ATTACHMENT_BYTES) throw new Error("附件大小必須大於 0 且不得超過 10 MB");
    if (!text(input.storageKey) || !text(input.storageKey).startsWith("private/") || /^https?:\/\//i.test(text(input.storageKey))) throw new Error("附件必須使用私有 storage key，不得使用公開 URL");
    if (!SUPPLIER_ATTACHMENT_TYPES.includes(input.attachmentType || "OTHER")) throw new Error("附件用途不合法");
    const attachment = { id: makeId(input, "supplierAttachment"), supplierBankAccountId: bankAccount?.id || null, returnOrderId: returnOrder?.id || null, returnOrderItemId: returnItem?.id || null, attachmentType: input.attachmentType || "OTHER", fileName, fileType: text(input.fileType).toLowerCase(), fileSize: quantity(input.fileSize), storageKey: text(input.storageKey), uploadedBy: actor.id || null, uploadedAt: nowFor(input), isActive: true };
    if (attachment.supplierBankAccountId) state.supplierBankAttachments.unshift(attachment);
    else state.supplierReturnAttachments.unshift(attachment);
    addAudit(state, input, "SUPPLIER_ATTACHMENT_UPLOADED", isReturn ? "SUPPLIER_RETURN_ORDER" : "SUPPLIER_BANK_ACCOUNT", returnOrder?.id || bankAccount?.id, "已上傳附件 metadata（未記錄內容或公開 URL）", null, { attachmentType: attachment.attachmentType, fileName: attachment.fileName, fileSize: attachment.fileSize });
    return { attachment };
  });
}

export function createSupplierBankAccount(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以維護供應商銀行帳戶");
    const supplier = requireEntity(state.suppliers.find((item) => item.id === input.supplierId), "供應商");
    if (supplier.isActive === false) throw new Error("停用供應商不可新增銀行帳戶");
    const payee = input.payeeSupplierId ? requireEntity(state.suppliers.find((item) => item.id === input.payeeSupplierId), "付款供應商") : supplier;
    if (payee.isActive === false) throw new Error("停用付款供應商不可新增銀行帳戶");
    const accountNumber = text(input.accountNumber);
    if (!accountNumber) throw new Error("銀行帳號為必填");
    if (input.isPrimary && input.isActive === false) throw new Error("停用帳戶不可設為主要帳戶");
    const ownerKey = input.payeeSupplierId || supplier.id;
    if (input.isPrimary) state.supplierBankAccounts.filter((item) => bankOwnerKey(item) === ownerKey).forEach((item) => { item.isPrimary = false; });
    const account = { id: makeId(input, "supplierBankAccount"), supplierId: supplier.id, payeeSupplierId: input.payeeSupplierId || null, bankName: text(input.bankName), bankCode: text(input.bankCode), branchName: text(input.branchName), branchCode: text(input.branchCode), accountName: text(input.accountName), accountNumber, accountNumberMasked: maskAccount(accountNumber), isPrimary: input.isPrimary === true, isActive: input.isActive !== false, verifiedAt: null, verifiedBy: null, verifiedNote: "", createdBy: actor.id || null, createdAt: nowFor(input), updatedAt: nowFor(input) };
    state.supplierBankAccounts.unshift(account);
    addAudit(state, input, "SUPPLIER_BANK_ACCOUNT_CREATED", "SUPPLIER_BANK_ACCOUNT", account.id, "新增供應商銀行帳戶（帳號已遮罩）", null, { ...account, accountNumber: maskAccount(account.accountNumber) });
    return { account: { ...account, accountNumber: undefined, accountNumberMasked: maskAccount(account.accountNumber) } };
  });
}

export function switchPrimarySupplierBankAccount(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以切換主要銀行帳戶");
    const account = requireEntity(state.supplierBankAccounts.find((item) => item.id === input.accountId), "供應商銀行帳戶");
    if (account.isActive === false) throw new Error("停用銀行帳戶不可設為主要帳戶");
    state.supplierBankAccounts.filter((item) => bankOwnerKey(item) === bankOwnerKey(account)).forEach((item) => { item.isPrimary = item.id === account.id; item.updatedAt = nowFor(input); });
    addAudit(state, input, "SUPPLIER_PRIMARY_BANK_SWITCHED", "SUPPLIER_BANK_ACCOUNT", account.id, "已切換主要銀行帳戶", null, { supplierId: account.supplierId, accountNumber: maskAccount(account.accountNumber) });
    return { account: { ...account, accountNumber: undefined, accountNumberMasked: maskAccount(account.accountNumber) } };
  });
}

export function verifySupplierBankAccount(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以驗證供應商銀行帳戶");
    const account = requireEntity(state.supplierBankAccounts.find((item) => item.id === input.accountId), "供應商銀行帳戶");
    if (account.isActive === false) throw new Error("停用銀行帳戶不可驗證");
    const before = clone(account);
    account.verifiedAt = nowFor(input);
    account.verifiedBy = actor.id || null;
    account.verifiedNote = text(input.verifiedNote);
    account.updatedAt = nowFor(input);
    addAudit(state, input, "SUPPLIER_BANK_ACCOUNT_VERIFIED", "SUPPLIER_BANK_ACCOUNT", account.id, "供應商銀行帳戶已驗證（帳號已遮罩）", before, { ...account, accountNumber: maskAccount(account.accountNumber) });
    return { account: { ...account, accountNumber: undefined, accountNumberMasked: maskAccount(account.accountNumber) } };
  });
}

export function disableSupplierBankAccount(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.commercial, "只有採購人員或管理員可以停用供應商銀行帳戶");
    const account = requireEntity(state.supplierBankAccounts.find((item) => item.id === input.accountId), "供應商銀行帳戶");
    if (!text(input.reason)) throw new Error("停用銀行帳戶必須填寫原因");
    const before = clone(account);
    account.isActive = false;
    account.isPrimary = false;
    account.updatedAt = nowFor(input);
    addAudit(state, input, "SUPPLIER_BANK_ACCOUNT_DISABLED", "SUPPLIER_BANK_ACCOUNT", account.id, text(input.reason), before, { ...account, accountNumber: maskAccount(account.accountNumber) });
    return { account: { ...account, accountNumber: undefined, accountNumberMasked: maskAccount(account.accountNumber) } };
  });
}

export function getSupplierBankAccountsForRole(state, supplierId, user, { reveal = false } = {}) {
  const allowed = user?.isActive !== false && SUPPLIER_OPERATIONS_ROLES.commercial.includes(user?.role);
  if (!allowed) return [];
  return (state.supplierBankAccounts || []).filter((item) => item.supplierId === supplierId && item.isActive !== false).map((item) => ({ ...clone(item), accountNumber: reveal && item.accountNumber && !String(item.accountNumber).startsWith("＊＊＊＊") ? item.accountNumber : undefined, accountNumberMasked: item.accountNumberMasked || maskAccount(item.accountNumber), supplierBankAttachments: state.supplierBankAttachments.filter((file) => file.supplierBankAccountId === item.id && file.isActive !== false).map(({ storageKey, ...file }) => file) }));
}

export function recordSupplierReturnResolution(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.returnResolution, "只有採購人員或管理員可以記錄供應商退貨處理結果");
    const item = returnItem(state, input.returnOrderItemId);
    const order = returnOrderForItem(state, item);
    if (!["WAITING_RESOLUTION", "PARTIALLY_RESOLVED", "RETURNED_TO_SUPPLIER", "REJECTED_BY_SUPPLIER"].includes(order.status)) throw new Error("退貨單尚未進入供應商處理階段");
    if (!SUPPLIER_RETURN_RESOLUTION_TYPES.includes(input.resolutionType)) throw new Error("退貨處理結果不合法");
    if (order.status === "REJECTED_BY_SUPPLIER" && input.resolutionType !== "REJECTED") throw new Error("供應商已拒絕退貨時只能登記拒絕結果");
    item.rejectedQty = quantity(item.rejectedQty);
    const resolutionQty = Math.min(item.unresolvedQty, quantity(input.resolutionQty || item.unresolvedQty));
    if (!resolutionQty) throw new Error("處理數量必須大於 0");
    const before = clone(item);
    order.resolutionType = input.resolutionType;
    order.supplierResponse = text(input.supplierResponse);
    item.supplierResponse = text(input.supplierResponse);
    item.confirmedAmount = decimal(input.confirmedAmount ?? item.estimatedAmount);
    if (input.resolutionType === "REFUND") item.refundedQty += resolutionQty;
    else if (input.resolutionType === "CREDIT_NOTE") item.creditedQty += resolutionQty;
    else if (input.resolutionType === "REPLACEMENT" || input.resolutionType === "EXCHANGE_PRODUCT") item.replacementQty += resolutionQty;
    else if (input.resolutionType === "REJECTED") item.rejectedQty += resolutionQty;
    item.unresolvedQty = Math.max(0, item.returnQty - item.refundedQty - item.creditedQty - item.replacementReceivedQty - item.rejectedQty);
    order.status = item.unresolvedQty === 0 && item.replacementQty <= item.replacementReceivedQty ? "RESOLVED" : "PARTIALLY_RESOLVED";
    order.updatedAt = nowFor(input);
    if (order.status === "RESOLVED") { order.resolvedBy = actor.id || null; order.resolvedAt = nowFor(input); order.actualResolutionDate = nowFor(input).slice(0, 10); }
    syncSourceDemandReturnStatus(state, item, order, input);
    addAudit(state, input, "SUPPLIER_RETURN_RESOLUTION_RECORDED", "SUPPLIER_RETURN_ORDER_ITEM", item.id, `${input.resolutionType} ${resolutionQty} 件`, before, item);
    return { returnOrder: order, item };
  });
}

export function receiveSupplierReplacement(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.warehouse, "只有總倉或管理員可以登記替代品到貨");
    const item = returnItem(state, input.returnOrderItemId);
    const order = returnOrderForItem(state, item);
    const receiveQty = quantity(input.receivedQty);
    if (!receiveQty || receiveQty > Math.max(0, item.replacementQty - item.replacementReceivedQty)) throw new Error("替代品到貨數量超過待收數量");
    const productId = input.replacementProductId || item.productId;
    const balance = getWarehouseBalance(state, input.warehouseLocationId || "warehouse", productId);
    balance.onHandQty += receiveQty;
    item.replacementReceivedQty += receiveQty;
    item.replacementProductId = productId;
    item.rejectedQty = quantity(item.rejectedQty);
    item.unresolvedQty = Math.max(0, item.returnQty - item.refundedQty - item.creditedQty - item.replacementReceivedQty - item.rejectedQty);
    state.inventoryMovements.unshift({ id: makeId(input, "inventoryMovement"), locationId: input.warehouseLocationId || "warehouse", productId, movementType: "SUPPLIER_REPLACEMENT_RECEIPT", quantity: receiveQty, sourceType: "SUPPLIER_RETURN", sourceId: order.id, createdBy: actor.id || null, createdAt: nowFor(input), note: order.returnNumber });
    order.status = item.unresolvedQty === 0 ? "RESOLVED" : "PARTIALLY_RESOLVED";
    order.updatedAt = nowFor(input);
    syncSourceDemandReturnStatus(state, item, order, input);
    addAudit(state, input, "SUPPLIER_REPLACEMENT_RECEIVED", "SUPPLIER_RETURN_ORDER_ITEM", item.id, `替代品入庫 ${receiveQty} 件`, null, { productId, quantity: receiveQty });
    return { returnOrder: order, item, balance };
  });
}

export function closeSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, SUPPLIER_OPERATIONS_ROLES.returnResolution, "只有採購人員或管理員可以結案供應商退貨");
    const order = requireEntity(state.supplierReturns.find((item) => item.id === input.returnOrderId), "退貨單");
    const items = state.supplierReturnItems.filter((item) => item.returnOrderId === order.id);
    if (!items.length || items.some((item) => item.unresolvedQty > 0)) throw new Error("退貨單仍有未完成處理數量");
    order.status = "RESOLVED";
    order.resolvedAt = nowFor(input);
    order.resolvedBy = actor.id || null;
    order.purchasingNote = text(input.purchasingNote);
    items.forEach((item) => syncSourceDemandReturnStatus(state, item, order, input));
    addAudit(state, input, "SUPPLIER_RETURN_CLOSED", "SUPPLIER_RETURN_ORDER", order.id, "供應商退貨已結案", null, order);
    return { returnOrder: order };
  });
}

export function getSupplierReturnsForRole(state, user) {
  requireRole(actorFor(user || {}), SUPPLIER_OPERATIONS_ROLES.returnView, "目前角色無法查看供應商退貨");
  const rows = (state.supplierReturns || []).map((order) => ({ ...clone(order), items: state.supplierReturnItems.filter((item) => item.returnOrderId === order.id).map((item) => ({ ...clone(item), supplierReturnAttachments: user.role === "STORE" ? [] : state.supplierReturnAttachments.filter((file) => file.returnOrderItemId === item.id || file.returnOrderId === order.id).map(({ storageKey, ...file }) => file), internalNote: user.role === "STORE" ? "" : item.note })) }));
  return user.role === "STORE" ? rows.filter((order) => order.items.some((item) => (state.purchaseOrders || []).some((po) => po.lines?.some((line) => line.id === item.purchaseOrderItemId && sourceLocations(line).includes(user.locationId))))) : rows;
}
