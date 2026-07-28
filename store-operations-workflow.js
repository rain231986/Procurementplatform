/*
 * Store-to-store transfers, store safety-stock settings and store returns.
 *
 * The browser proof-of-concept persists one JSON document.  Every mutation in
 * this file clones that document first and commits the inventory movement,
 * workflow row and audit row as one result.  The same boundary is intended for
 * the future API/Prisma adapter and keeps location/RBAC checks server-side.
 */

export const STORE_TRANSFER_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_SOURCE_APPROVAL",
  "RETURNED",
  "APPROVED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "REJECTED",
  "CANCELLED",
]);

export const STORE_RETURN_TO_WAREHOUSE_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_STORE_MANAGER_APPROVAL",
  "PENDING_WAREHOUSE_APPROVAL",
  "APPROVED",
  "SHIPPED_TO_WAREHOUSE",
  "PARTIALLY_RECEIVED",
  "RECEIVED_BY_WAREHOUSE",
  "REJECTED",
  "RETURNED_TO_STORE",
  "CANCELLED",
]);

export const STORE_DIRECT_RETURN_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_STORE_MANAGER_APPROVAL",
  "PENDING_PURCHASING_REVIEW",
  "PENDING_SUPPLIER_CONFIRMATION",
  "SUPPLIER_CONFIRMED",
  "SHIPPED_TO_SUPPLIER",
  "WAITING_RESOLUTION",
  "PARTIALLY_RESOLVED",
  "RESOLVED",
  "REJECTED",
  "CANCELLED",
]);

export const STORE_OPERATION_MOVEMENT_TYPES = Object.freeze({
  STORE_TRANSFER_OUT: "STORE_TRANSFER_OUT",
  STORE_TRANSFER_IN: "STORE_TRANSFER_IN",
  STORE_RETURN_TO_WAREHOUSE_OUT: "STORE_RETURN_TO_WAREHOUSE_OUT",
  STORE_RETURN_TO_WAREHOUSE_IN: "STORE_RETURN_TO_WAREHOUSE_IN",
  STORE_RETURN_REJECTED_BACK_TO_STORE: "STORE_RETURN_REJECTED_BACK_TO_STORE",
  STORE_RETURN_TO_SUPPLIER_OUT: "STORE_RETURN_TO_SUPPLIER_OUT",
  SUPPLIER_RETURN_REJECTED_BACK_TO_STORE: "SUPPLIER_RETURN_REJECTED_BACK_TO_STORE",
  SUPPLIER_REPLACEMENT_RECEIPT_STORE: "SUPPLIER_REPLACEMENT_RECEIPT_STORE",
});

export const STORE_RETURN_REASON_CODES = Object.freeze([
  "OVERSTOCK",
  "DISCONTINUED",
  "QUALITY_ISSUE",
  "EXPIRY_NEAR",
  "WRONG_ALLOCATION",
  "DAMAGED",
  "RECALL",
  "OTHER",
]);

export const STORE_DIRECT_RETURN_RESOLUTION_TYPES = Object.freeze([
  "REFUND",
  "REPLACEMENT",
  "CREDIT_NOTE",
  "EXCHANGE_PRODUCT",
  "REJECTED",
]);

const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const text = (value) => String(value ?? "").trim();
const quantity = (value) => Math.max(0, Math.floor(Number(value) || 0));
const timestamp = (input = {}) => input.changedAt || input.updatedAt || input.createdAt || new Date().toISOString();

function actorFor(input = {}) {
  return input.actor || {
    id: input.actorId || null,
    role: input.actorRole || input.role || null,
    locationId: input.locationId || null,
    isStoreManager: input.isStoreManager === true,
    isActive: input.isActive !== false,
  };
}

function makeId(input, prefix) {
  return input.createId ? input.createId(prefix) : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureArray(state, name) {
  state[name] = Array.isArray(state[name]) ? state[name] : [];
  return state[name];
}

function requireRole(actor, roles, message = "目前角色沒有執行此操作的權限") {
  if (!actor || actor.isActive === false || !roles.includes(actor.role)) throw new Error(`${message}，需要 ${roles.join(" 或 ")}`);
}

function requireEntity(entity, label) {
  if (!entity) throw new Error(`找不到${label}`);
  return entity;
}

function activeLocation(state, locationId, expectedType = null) {
  const location = ensureArray(state, "locations").find((item) => item.id === locationId);
  if (!location || location.isActive === false || (expectedType && location.type !== expectedType)) return null;
  return location;
}

function activeStore(state, locationId) {
  return activeLocation(state, locationId, "STORE");
}

function warehouse(state, locationId = null) {
  return ensureArray(state, "locations").find((item) => item.id === locationId && item.type === "WAREHOUSE" && item.isActive !== false)
    || ensureArray(state, "locations").find((item) => item.type === "WAREHOUSE" && item.isActive !== false)
    || (locationId === "warehouse" ? { id: "warehouse", type: "WAREHOUSE", isActive: true } : null);
}

function product(state, productId) {
  return ensureArray(state, "products").find((item) => item.id === productId);
}

function requireActiveProduct(state, productId) {
  const row = requireEntity(product(state, productId), "商品");
  if (row.isActive === false) throw new Error(`商品 ${row.name || productId} 已停用`);
  return row;
}

function balance(state, locationId, productId) {
  const inventory = ensureArray(state, "inventory");
  let row = inventory.find((item) => item.locationId === locationId && item.productId === productId);
  if (!row) {
    row = { id: makeId({}, "balance"), locationId, productId, onHandQty: 0, reservedQty: 0, returnInTransitQty: 0, transferInTransitQty: 0, updatedAt: timestamp({}) };
    inventory.push(row);
  }
  row.onHandQty = quantity(row.onHandQty);
  row.reservedQty = quantity(row.reservedQty);
  row.returnInTransitQty = quantity(row.returnInTransitQty);
  row.transferInTransitQty = quantity(row.transferInTransitQty);
  return row;
}

function availableQty(row) {
  return Math.max(0, quantity(row?.onHandQty) - quantity(row?.reservedQty));
}

function setting(state, locationId, productId) {
  const rows = ensureArray(state, "settings");
  let row = rows.find((item) => item.locationId === locationId && item.productId === productId);
  if (!row) {
    row = { id: makeId({}, "setting"), locationId, productId, safetyStockQty: 0, maximumStockQty: 0, minimumReplenishmentQty: 1, storeDistributionMultiple: 1, automaticReplenishmentEnabled: false };
    rows.push(row);
  }
  return row;
}

function safetyQty(state, locationId, productId) {
  return quantity(setting(state, locationId, productId).safetyStockQty);
}

function approvedUnshippedTransferQty(state, sourceLocationId, productId, excludedOrderId = null) {
  return ensureArray(state, "storeTransferOrders").filter((order) => order.id !== excludedOrderId
    && order.sourceLocationId === sourceLocationId
    && ["APPROVED", "PARTIALLY_SHIPPED"].includes(order.status))
    .reduce((sum, order) => sum + ensureArray(state, "storeTransferItems")
      .filter((item) => item.transferOrderId === order.id && item.productId === productId)
      .reduce((lineSum, item) => lineSum + Math.max(0, quantity(item.approvedQty) - quantity(item.shippedQty) - quantity(item.rejectedQty)), 0), 0);
}

function transferableQty(state, sourceLocationId, productId, excludedOrderId = null) {
  const row = balance(state, sourceLocationId, productId);
  return Math.max(0, availableQty(row) - approvedUnshippedTransferQty(state, sourceLocationId, productId, excludedOrderId) - safetyQty(state, sourceLocationId, productId));
}

function addAudit(state, input, action, entityType, entityId, detail, beforeData = null, afterData = null) {
  ensureArray(state, "auditLogs").unshift({
    id: makeId(input, "audit"), action, entityType, entityId: entityId || null,
    userId: actorFor(input).id || null, userRole: actorFor(input).role || null,
    detail: text(detail) || action, beforeData: clone(beforeData), afterData: clone(afterData), createdAt: timestamp(input),
  });
}

function addMovement(state, input, movementType, row) {
  const movements = ensureArray(state, "inventoryMovements");
  const operationId = text(input.operationId || row.operationId) || makeId(input, "store-operation");
  if (movements.some((item) => item.operationId === operationId && item.movementType === movementType && item.productId === row.productId && item.sourceId === row.sourceId)) return null;
  const movement = {
    id: makeId(input, "inventoryMovement"), operationId, locationId: row.locationId, productId: row.productId,
    movementType, quantity: Number(row.quantity) || 0, beforeQty: quantity(row.beforeQty), afterQty: quantity(row.afterQty),
    sourceType: row.sourceType || "STORE_OPERATION", sourceId: row.sourceId || null, sourceItemId: row.sourceItemId || null,
    referenceType: row.referenceType || "STORE_OPERATION", referenceId: row.referenceId || row.sourceId || null,
    fromLocationId: row.fromLocationId || null, toLocationId: row.toLocationId || null,
    batchNumber: text(row.batchNumber) || null, expiryDate: text(row.expiryDate) || null,
    createdBy: actorFor(input).id || null, createdAt: timestamp(input), note: text(row.note || input.note),
  };
  movements.unshift(movement);
  return movement;
}

function gateResult({ workflowType, entity, attemptedAction, blockingItems, responsibleRole, suggestedAction }) {
  const items = blockingItems.map((item) => ({
    field: item.field || null, item_id: item.item_id ?? item.itemId ?? null, itemId: item.item_id ?? item.itemId ?? null,
    product_id: item.product_id ?? item.productId ?? null, productId: item.product_id ?? item.productId ?? null,
    product_name: item.product_name ?? item.productName ?? null, productName: item.product_name ?? item.productName ?? null,
    rule_code: item.rule_code || item.ruleCode || "WORKFLOW_RULE_FAILED", ruleCode: item.rule_code || item.ruleCode || "WORKFLOW_RULE_FAILED",
    current_value: item.current_value ?? item.currentValue ?? null, currentValue: item.current_value ?? item.currentValue ?? null,
    required_value: item.required_value ?? item.requiredValue ?? null, requiredValue: item.required_value ?? item.requiredValue ?? null,
    message: text(item.message) || "尚未符合流程條件",
  }));
  const result = {
    valid: items.length === 0, error_code: items.length ? "WORKFLOW_BLOCKED" : null,
    workflow_type: workflowType, entity_id: entity?.id || null, entity_location_id: entity?.sourceLocationId || entity?.locationId || null,
    current_status: entity?.status || null, attempted_action: attemptedAction, blocking_items: items,
    message: items.length ? "目前資料未符合進入下一階段的必要條件" : "流程檢核通過",
    suggested_action: suggestedAction || (items.length ? "請依阻擋項目補齊資料後重新操作" : null), responsible_role: responsibleRole || null,
  };
  return { ...result, errorCode: result.error_code, workflowType: result.workflow_type, entityId: result.entity_id, entityLocationId: result.entity_location_id, currentStatus: result.current_status, attemptedAction: result.attempted_action, blockingItems: items, suggestedAction: result.suggested_action, responsibleRole: result.responsible_role };
}

function validationError(validation) {
  const error = new Error(validation.blocking_items.map((item) => item.message).join("；"));
  error.validation = validation;
  return error;
}

function assertValid(validation) {
  if (!validation.valid) throw validationError(validation);
}

function transact(sourceState, input, callback) {
  const state = clone(sourceState || {});
  normalizeStoreOperations(state);
  try {
    const result = callback(state, actorFor(input));
    return { committed: true, state, ...result };
  } catch (error) {
    return { committed: false, state: sourceState, error: error instanceof Error ? error : new Error(String(error)), errors: [error instanceof Error ? error.message : String(error)], validation: error?.validation || null };
  }
}

function normalizeTransferItem(item) {
  item.requestedQty = quantity(item.requestedQty);
  item.approvedQty = quantity(item.approvedQty);
  item.shippedQty = quantity(item.shippedQty);
  item.receivedQty = quantity(item.receivedQty);
  item.rejectedQty = quantity(item.rejectedQty);
  item.sourceAvailableQtySnapshot = item.sourceAvailableQtySnapshot == null ? null : quantity(item.sourceAvailableQtySnapshot);
  item.sourceSafetyStockSnapshot = item.sourceSafetyStockSnapshot == null ? null : quantity(item.sourceSafetyStockSnapshot);
  item.destinationOnHandQtySnapshot = item.destinationOnHandQtySnapshot == null ? null : quantity(item.destinationOnHandQtySnapshot);
  item.destinationSafetyStockSnapshot = item.destinationSafetyStockSnapshot == null ? null : quantity(item.destinationSafetyStockSnapshot);
  item.safetyStockOverride = item.safetyStockOverride === true;
  item.overrideReason = item.overrideReason || null;
  item.overriddenBy = item.overriddenBy || null;
  item.overriddenAt = item.overriddenAt || null;
  item.quantityAdjustmentReason = item.quantityAdjustmentReason || null;
  item.batchNumber = text(item.batchNumber);
  item.expiryDate = text(item.expiryDate);
  item.itemNote = item.itemNote || "";
  return item;
}

function normalizeWarehouseReturnItem(item) {
  item.returnQty = quantity(item.returnQty);
  item.shippedQty = quantity(item.shippedQty);
  item.receivedQty = quantity(item.receivedQty);
  item.rejectedQty = quantity(item.rejectedQty);
  item.rejectedReturnedQty = quantity(item.rejectedReturnedQty);
  item.inTransitQty = Math.max(0, item.shippedQty - item.receivedQty - item.rejectedQty);
  item.availableQtySnapshot = item.availableQtySnapshot == null ? null : quantity(item.availableQtySnapshot);
  item.batchNumber = text(item.batchNumber);
  item.expiryDate = text(item.expiryDate);
  item.reasonCode = item.reasonCode || "OTHER";
  item.note = item.note || "";
  item.rejectionReason = item.rejectionReason || null;
  return item;
}

function normalizeDirectReturnItem(item) {
  item.returnQty = quantity(item.returnQty);
  item.acceptedReturnQty = quantity(item.acceptedReturnQty);
  item.rejectedQty = quantity(item.rejectedQty);
  item.rejectedReturnedQty = quantity(item.rejectedReturnedQty);
  item.refundedQty = quantity(item.refundedQty);
  item.replacementQty = quantity(item.replacementQty);
  item.replacementReceivedQty = quantity(item.replacementReceivedQty);
  item.creditedQty = quantity(item.creditedQty);
  item.returnedQty = quantity(item.returnedQty);
  item.unresolvedQty = Math.max(0, item.returnQty - item.refundedQty - item.creditedQty - item.replacementReceivedQty - item.rejectedQty);
  item.availableQtySnapshot = item.availableQtySnapshot == null ? null : quantity(item.availableQtySnapshot);
  item.batchNumber = text(item.batchNumber);
  item.expiryDate = text(item.expiryDate);
  item.reasonCode = item.reasonCode || "OTHER";
  item.itemCondition = item.itemCondition || "";
  item.note = item.note || "";
  return item;
}

export function normalizeStoreOperations(state) {
  ["storeTransferOrders", "storeTransferItems", "storeReturnOrders", "storeReturnItems", "storeReturnAttachments", "inventory", "settings", "locations", "products", "suppliers", "monthlyProductSales", "supplierReturns", "supplierReturnItems", "supplierReturnAttachments", "inventoryMovements", "auditLogs"].forEach((name) => ensureArray(state, name));
  state.settings.forEach((row) => {
    row.safetyStockQty = quantity(row.safetyStockQty);
    row.maximumStockQty = quantity(row.maximumStockQty);
    row.minimumReplenishmentQty = row.minimumReplenishmentQty == null ? 1 : quantity(row.minimumReplenishmentQty);
    row.storeDistributionMultiple = Math.max(1, quantity(row.storeDistributionMultiple) || 1);
    row.automaticReplenishmentEnabled = row.automaticReplenishmentEnabled ?? row.replenishmentEnabled === true;
    row.replenishmentEnabled = row.replenishmentEnabled ?? row.automaticReplenishmentEnabled === true;
    row.updatedBy = row.updatedBy || row.lastModifiedBy || null;
    row.updatedAt = row.updatedAt || row.lastModifiedAt || null;
    row.lastModifiedReason = row.lastModifiedReason || row.reason || null;
    row.lastModifiedBy = row.lastModifiedBy || row.updatedBy || null;
    row.lastModifiedRole = row.lastModifiedRole || null;
  });
  state.storeTransferOrders.forEach((order) => {
    order.status = STORE_TRANSFER_STATUSES.includes(order.status) ? order.status : "DRAFT";
    order.items = Array.isArray(order.items) ? order.items : [];
    order.notes = order.notes || "";
    order.returnReason = order.returnReason || null;
  });
  state.storeTransferItems.forEach(normalizeTransferItem);
  state.storeReturnOrders.forEach((order) => {
    order.status = STORE_RETURN_TO_WAREHOUSE_STATUSES.includes(order.status) ? order.status : "DRAFT";
    order.items = Array.isArray(order.items) ? order.items : [];
    order.returnReason = order.returnReason || "";
    order.warehouseLocationId = order.warehouseLocationId || "warehouse";
  });
  state.storeReturnItems.forEach(normalizeWarehouseReturnItem);
  state.supplierReturns.forEach((order) => {
    if (order.sourceType !== "STORE") return;
    order.status = STORE_DIRECT_RETURN_STATUSES.includes(order.status) ? order.status : "DRAFT";
    order.items = Array.isArray(order.items) ? order.items : [];
    order.sourceLocationId = order.sourceLocationId || null;
    order.storeNote = order.storeNote || "";
    order.purchasingNote = order.purchasingNote || "";
    order.supplierResponse = order.supplierResponse || "";
  });
  state.supplierReturnItems.forEach((item) => {
    const order = state.supplierReturns.find((candidate) => candidate.id === item.returnOrderId);
    if (order?.sourceType === "STORE") normalizeDirectReturnItem(item);
  });
  return state;
}

function transferItems(state, orderId) {
  return ensureArray(state, "storeTransferItems").filter((item) => item.transferOrderId === orderId);
}

function warehouseReturnItems(state, orderId) {
  return ensureArray(state, "storeReturnItems").filter((item) => item.returnOrderId === orderId);
}

function directReturnItems(state, orderId) {
  return ensureArray(state, "supplierReturnItems").filter((item) => item.returnOrderId === orderId);
}

function itemInputRows(input, names = []) {
  for (const name of names) if (Array.isArray(input[name])) return input[name];
  return [];
}

function itemQty(row, keys) {
  for (const key of keys) if (row?.[key] !== undefined) return quantity(row[key]);
  return 0;
}

function findLineInput(rows, line) {
  return rows.find((row) => row.itemId === line.id || row.id === line.id || row.transferItemId === line.id || row.returnItemId === line.id || (row.productId && row.productId === line.productId));
}

function nextNumber(state, prefix, field, inputDate = null, collectionNames = []) {
  const date = String(inputDate || timestamp({})).slice(0, 10).replaceAll("-", "");
  const used = collectionNames.flatMap((name) => ensureArray(state, name)).map((row) => row[field]).filter(Boolean);
  let sequence = 1;
  let candidate = `${prefix}-${date}-${String(sequence).padStart(4, "0")}`;
  while (used.includes(candidate)) {
    sequence += 1;
    candidate = `${prefix}-${date}-${String(sequence).padStart(4, "0")}`;
  }
  return candidate;
}

function canUseStore(actor, locationId, manager = false) {
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "STORE" || actor.locationId !== locationId) return false;
  return !manager || actor.isStoreManager === true;
}

function actorLocationError(actor, locationId) {
  if (!canUseStore(actor, locationId)) throw new Error("門市帳號只能操作所屬門市資料");
}

function requireBatchAndExpiry(state, productRow, item, label = "商品") {
  if (productRow.batchTrackingEnabled === true && !text(item.batchNumber)) throw new Error(`${label}需要填寫批號`);
  if (productRow.expiryTrackingEnabled === true && !text(item.expiryDate)) throw new Error(`${label}需要填寫效期`);
}

export function validateStoreTransferGate(state, order, input = {}) {
  const blockingItems = [];
  const items = transferItems(state, order?.id);
  if (!items.length) blockingItems.push({ field: "items", ruleCode: "LINES_REQUIRED", message: "調撥單至少需要一項商品明細" });
  const source = activeStore(state, order?.sourceLocationId);
  const destination = activeStore(state, order?.destinationLocationId);
  if (!source || !destination) blockingItems.push({ field: "location", ruleCode: "STORE_ACTIVE_REQUIRED", message: "調出與調入門市都必須存在且啟用" });
  if (order?.sourceLocationId && order.sourceLocationId === order.destinationLocationId) blockingItems.push({ field: "destinationLocationId", ruleCode: "SOURCE_DESTINATION_DIFFERENT", message: "調出門市與調入門市不可相同" });
  items.forEach((item) => {
    const productRow = product(state, item.productId);
    const name = productRow?.name || item.productId || "商品";
    const qty = quantity(item.approvedQty || item.requestedQty);
    if (!productRow || productRow.isActive === false) blockingItems.push({ field: "productId", itemId: item.id, productId: item.productId, ruleCode: "PRODUCT_ACTIVE_REQUIRED", message: `${name}：商品不存在或已停用` });
    if (qty <= 0) blockingItems.push({ field: "requestedQty", itemId: item.id, productId: item.productId, ruleCode: "QUANTITY_POSITIVE", message: `${name}：調撥數量必須大於 0` });
    if (!source || !destination || qty <= 0) return;
    if (input.attemptedAction === "SUBMIT" || input.skipInventoryCheck === true) return;
    const max = transferableQty(state, order.sourceLocationId, item.productId, order.id);
    const override = item.safetyStockOverride === true || input.safetyStockOverride === true;
    if (qty > availableQty(balance(state, order.sourceLocationId, item.productId)) - approvedUnshippedTransferQty(state, order.sourceLocationId, item.productId, order.id)) {
      blockingItems.push({ field: "approvedQty", itemId: item.id, productId: item.productId, ruleCode: "TRANSFER_AVAILABLE_EXCEEDED", currentValue: qty, requiredValue: "不超過可調撥庫存", message: `${name}：調撥數量超過調出門市可用庫存` });
    } else if (qty > max && !override) {
      blockingItems.push({ field: "approvedQty", itemId: item.id, productId: item.productId, ruleCode: "SAFETY_STOCK_TRANSFER_LIMIT", currentValue: qty, requiredValue: max, message: `${name}：本商品調撥後將低於門市安全庫存${safetyQty(state, order.sourceLocationId, item.productId)}個，目前最多可調撥${max}個。` });
    } else if (override && !text(item.overrideReason || input.overrideReason)) {
      blockingItems.push({ field: "overrideReason", itemId: item.id, productId: item.productId, ruleCode: "SAFETY_STOCK_OVERRIDE_REASON_REQUIRED", message: `${name}：低於安全庫存的例外核准必須填寫原因` });
    }
  });
  return gateResult({ workflowType: "STORE_TRANSFER", entity: order, attemptedAction: input.attemptedAction || "SUBMIT", blockingItems, responsibleRole: "STORE", suggestedAction: "請補齊商品、數量、門市及安全庫存例外原因後重新送出" });
}

export function createStoreTransferDraft(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const source = requireEntity(activeStore(state, input.sourceLocationId), "調出門市");
    const destination = requireEntity(activeStore(state, input.destinationLocationId), "調入門市");
    if (source.id === destination.id) throw new Error("調出門市與調入門市不可相同");
    if (actor.role !== "ADMIN") actorLocationError(actor, destination.id);
    requireRole(actor, ["ADMIN", "STORE"], "只有門市人員或管理員可以建立門市調撥");
    const order = { id: makeId(input, "storeTransfer"), transferNumber: nextNumber(state, "ST", "transferNumber", input.requestedAt, ["storeTransferOrders"]), sourceLocationId: source.id, destinationLocationId: destination.id, status: "DRAFT", requestedBy: actor.id || null, requestedAt: timestamp(input), approvedBy: null, approvedAt: null, shippedBy: null, shippedAt: null, receivedBy: null, receivedAt: null, rejectedBy: null, rejectedAt: null, rejectReason: null, returnReason: null, notes: text(input.notes), createdAt: timestamp(input), updatedAt: timestamp(input) };
    const createdItems = (Array.isArray(input.items) ? input.items : []).map((raw) => {
      const productRow = requireActiveProduct(state, raw.productId);
      return normalizeTransferItem({ id: makeId(input, "storeTransferItem"), transferOrderId: order.id, productId: productRow.id, requestedQty: quantity(raw.requestedQty ?? raw.quantity), approvedQty: 0, shippedQty: 0, receivedQty: 0, rejectedQty: 0, sourceAvailableQtySnapshot: availableQty(balance(state, source.id, productRow.id)), sourceSafetyStockSnapshot: safetyQty(state, source.id, productRow.id), destinationOnHandQtySnapshot: quantity(balance(state, destination.id, productRow.id).onHandQty), destinationSafetyStockSnapshot: safetyQty(state, destination.id, productRow.id), batchNumber: raw.batchNumber, expiryDate: raw.expiryDate, itemNote: raw.itemNote || raw.note });
    });
    ensureArray(state, "storeTransferOrders").unshift(order);
    ensureArray(state, "storeTransferItems").push(...createdItems);
    addAudit(state, input, "STORE_TRANSFER_DRAFT_CREATED", "STORE_TRANSFER_ORDER", order.id, `${order.transferNumber} 建立調撥草稿`, null, { order, items: createdItems });
    return { order, items: createdItems };
  });
}

export function submitStoreTransfer(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(ensureArray(state, "storeTransferOrders").find((row) => row.id === input.transferOrderId), "調撥單");
    if (!canUseStore(actor, order.destinationLocationId)) requireRole(actor, ["ADMIN"], "只有調入門市人員可以送出調撥需求");
    if (!["DRAFT", "RETURNED"].includes(order.status)) throw new Error("目前調撥單不可送出");
    const validation = validateStoreTransferGate(state, order, { ...input, attemptedAction: "SUBMIT" });
    assertValid(validation);
    order.status = "PENDING_SOURCE_APPROVAL";
    order.requestedBy = actor.id || order.requestedBy;
    order.requestedAt = timestamp(input);
    order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_TRANSFER_SUBMITTED", "STORE_TRANSFER_ORDER", order.id, `${order.transferNumber} 已送調出門市審核`, null, order);
    return { order };
  });
}

export function approveStoreTransfer(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeTransferOrders.find((row) => row.id === input.transferOrderId), "調撥單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId, true)) throw new Error("只有調出門市店長或管理員可以核准調撥");
    if (order.status !== "PENDING_SOURCE_APPROVAL") throw new Error("目前調撥單不在待調出門市核准狀態");
    const rows = transferItems(state, order.id);
    const approvals = itemInputRows(input, ["items", "approvedItems"]);
    rows.forEach((item) => {
      const raw = findLineInput(approvals, item);
      const requested = quantity(item.requestedQty);
      const approved = raw ? itemQty(raw, ["approvedQty", "quantity", "qty"]) : requested;
      if (approved !== requested && !text(raw?.reason || raw?.adjustmentReason || input.adjustmentReason)) throw new Error(`${product(state, item.productId)?.name || "商品"}：修改核准數量時必須填寫原因`);
      if (approved <= 0) throw new Error(`${product(state, item.productId)?.name || "商品"}：核准數量必須大於 0`);
      if (approved > requested) throw new Error(`${product(state, item.productId)?.name || "商品"}：核准數量不可大於原申請數量`);
      const current = balance(state, order.sourceLocationId, item.productId);
      const maxWithoutSafety = Math.max(0, availableQty(current) - approvedUnshippedTransferQty(state, order.sourceLocationId, item.productId, order.id));
      const max = transferableQty(state, order.sourceLocationId, item.productId, order.id);
      const wantsOverride = raw?.safetyStockOverride === true || input.safetyStockOverride === true || approved > max;
      const overrideReason = text(raw?.overrideReason || input.overrideReason);
      if (approved > maxWithoutSafety) throw new Error(`${product(state, item.productId)?.name || "商品"}：核准數量超過目前可用庫存`);
      if (approved > max && !(wantsOverride && overrideReason && actor.role === "ADMIN" || wantsOverride && overrideReason && actor.isStoreManager === true)) throw new Error(`${product(state, item.productId)?.name || "商品"}：本商品調撥後將低於安全庫存，目前最多可調撥${max}個；例外核准需由店長或管理員填寫原因`);
      item.approvedQty = approved;
      item.sourceAvailableQtySnapshot = availableQty(current);
      item.sourceSafetyStockSnapshot = safetyQty(state, order.sourceLocationId, item.productId);
      item.destinationOnHandQtySnapshot = quantity(balance(state, order.destinationLocationId, item.productId).onHandQty);
      item.destinationSafetyStockSnapshot = safetyQty(state, order.destinationLocationId, item.productId);
      item.quantityAdjustmentReason = approved !== requested ? text(raw?.reason || raw?.adjustmentReason || input.adjustmentReason) : null;
      item.safetyStockOverride = approved > max;
      item.overrideReason = item.safetyStockOverride ? overrideReason : null;
      item.overriddenBy = item.safetyStockOverride ? actor.id || null : null;
      item.overriddenAt = item.safetyStockOverride ? timestamp(input) : null;
    });
    const before = clone(order);
    order.status = "APPROVED";
    order.approvedBy = actor.id || null;
    order.approvedAt = timestamp(input);
    order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_TRANSFER_APPROVED", "STORE_TRANSFER_ORDER", order.id, `${order.transferNumber} 已核准`, before, { order, items: rows });
    return { order, items: rows };
  });
}

export function returnStoreTransfer(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeTransferOrders.find((row) => row.id === input.transferOrderId), "調撥單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId, true)) throw new Error("只有調出門市店長或管理員可以退回調撥");
    if (order.status !== "PENDING_SOURCE_APPROVAL") throw new Error("目前調撥單不可退回修改");
    if (!text(input.reason)) throw new Error("退回調撥必須填寫原因");
    order.status = "RETURNED"; order.returnReason = text(input.reason); order.rejectedBy = actor.id || null; order.rejectedAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_TRANSFER_RETURNED", "STORE_TRANSFER_ORDER", order.id, order.returnReason, null, order);
    return { order };
  });
}

export function rejectStoreTransfer(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeTransferOrders.find((row) => row.id === input.transferOrderId), "調撥單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId, true)) throw new Error("只有調出門市店長或管理員可以拒絕調撥");
    if (!["PENDING_SOURCE_APPROVAL", "APPROVED"].includes(order.status)) throw new Error("目前調撥單不可拒絕");
    if (!text(input.reason)) throw new Error("拒絕調撥必須填寫原因");
    order.status = "REJECTED"; order.rejectReason = text(input.reason); order.rejectedBy = actor.id || null; order.rejectedAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_TRANSFER_REJECTED", "STORE_TRANSFER_ORDER", order.id, order.rejectReason, null, order);
    return { order };
  });
}

function shipQtyRows(input, line, rows, fieldNames) {
  const raw = findLineInput(rows, line);
  if (!rows.length) return Math.max(0, quantity(line.approvedQty) - quantity(line.shippedQty) - quantity(line.rejectedQty));
  return raw ? itemQty(raw, fieldNames) : 0;
}

export function shipStoreTransfer(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeTransferOrders.find((row) => row.id === input.transferOrderId), "調撥單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId, true)) throw new Error("只有調出門市店長或管理員可以執行調撥出貨");
    if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true };
    if (!["APPROVED", "PARTIALLY_SHIPPED"].includes(order.status)) throw new Error("目前調撥單不可出貨");
    const rows = transferItems(state, order.id);
    const shipmentRows = itemInputRows(input, ["items", "shipmentItems", "shippedItems"]);
    let moved = 0;
    rows.forEach((item) => {
      const remaining = Math.max(0, quantity(item.approvedQty) - quantity(item.shippedQty) - quantity(item.rejectedQty));
      const qty = shipQtyRows(input, item, shipmentRows, ["shippedQty", "quantity", "qty"]);
      if (!qty) return;
      if (qty > remaining) throw new Error(`${product(state, item.productId)?.name || "商品"}：出貨數量超過待出貨數量`);
      const productRow = requireActiveProduct(state, item.productId);
      requireBatchAndExpiry(state, productRow, item);
      const current = balance(state, order.sourceLocationId, item.productId);
      const available = availableQty(current);
      if (qty > available) throw new Error(`${productRow.name || "商品"}：出貨時可用庫存不足`);
      if (!item.safetyStockOverride && available - qty < safetyQty(state, order.sourceLocationId, item.productId)) throw new Error(`${productRow.name || "商品"}：出貨後不可低於安全庫存${safetyQty(state, order.sourceLocationId, item.productId)}個`);
      const beforeQty = current.onHandQty;
      current.onHandQty -= qty; current.updatedAt = timestamp(input);
      item.shippedQty += qty; item.updatedAt = timestamp(input); moved += qty;
      addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.STORE_TRANSFER_OUT, { locationId: order.sourceLocationId, productId: item.productId, quantity: -qty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "STORE_TRANSFER_ORDER", referenceId: order.id, fromLocationId: order.sourceLocationId, toLocationId: order.destinationLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.transferNumber });
    });
    if (!moved) throw new Error("本次至少需要出貨一項商品");
    const complete = rows.every((item) => quantity(item.shippedQty) + quantity(item.rejectedQty) >= quantity(item.approvedQty));
    order.status = complete ? "SHIPPED" : "PARTIALLY_SHIPPED"; order.shippedBy = actor.id || null; order.shippedAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_TRANSFER_SHIPPED", "STORE_TRANSFER_ORDER", order.id, `${order.transferNumber} 出貨 ${moved} 件`, null, { order, items: rows });
    return { order, items: rows, shippedQty: moved };
  });
}

export function receiveStoreTransfer(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeTransferOrders.find((row) => row.id === input.transferOrderId), "調撥單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.destinationLocationId)) throw new Error("只有調入門市人員或管理員可以簽收調撥");
    if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true };
    if (!["SHIPPED", "PARTIALLY_SHIPPED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("目前調撥單不可簽收");
    const rows = transferItems(state, order.id);
    const receiveRows = itemInputRows(input, ["items", "receiveItems", "receivedItems"]);
    let receivedTotal = 0;
    rows.forEach((item) => {
      const remaining = Math.max(0, quantity(item.shippedQty) - quantity(item.receivedQty) - quantity(item.rejectedQty));
      const raw = findLineInput(receiveRows, item);
      const receivedQty = receiveRows.length ? itemQty(raw, ["receivedQty", "quantity", "qty"]) : remaining;
      const rejectedQty = receiveRows.length ? itemQty(raw, ["rejectedQty", "rejectQty"]) : 0;
      if (receivedQty + rejectedQty > remaining) throw new Error(`${product(state, item.productId)?.name || "商品"}：簽收數量超過待簽收數量`);
      if (rejectedQty && !text(raw?.reason || input.reason)) throw new Error(`${product(state, item.productId)?.name || "商品"}：拒收數量必須填寫原因`);
      if (!receivedQty && !rejectedQty) return;
      if (receivedQty) {
        const current = balance(state, order.destinationLocationId, item.productId);
        const beforeQty = current.onHandQty; current.onHandQty += receivedQty; current.updatedAt = timestamp(input); item.receivedQty += receivedQty; receivedTotal += receivedQty;
        addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.STORE_TRANSFER_IN, { locationId: order.destinationLocationId, productId: item.productId, quantity: receivedQty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "STORE_TRANSFER_ORDER", referenceId: order.id, fromLocationId: order.sourceLocationId, toLocationId: order.destinationLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.transferNumber });
      }
      item.rejectedQty += rejectedQty;
      item.rejectionReason = rejectedQty ? text(raw?.reason || input.reason) : item.rejectionReason || null;
      item.updatedAt = timestamp(input);
    });
    if (!receivedTotal && !rows.some((item) => item.rejectedQty)) throw new Error("本次至少需要簽收或拒收一項商品");
    const complete = rows.every((item) => quantity(item.receivedQty) + quantity(item.rejectedQty) >= quantity(item.shippedQty));
    const anyAccepted = rows.some((item) => quantity(item.receivedQty) > 0);
    order.status = complete ? (anyAccepted ? "RECEIVED" : "REJECTED") : "PARTIALLY_RECEIVED"; order.receivedBy = actor.id || null; order.receivedAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_TRANSFER_RECEIVED", "STORE_TRANSFER_ORDER", order.id, `${order.transferNumber} 簽收 ${receivedTotal} 件`, null, { order, items: rows });
    return { order, items: rows, receivedQty: receivedTotal };
  });
}

export function updateStoreSafetyStock(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const location = requireEntity(activeStore(state, input.locationId), "門市");
    const productRow = requireActiveProduct(state, input.productId);
    if (!(actor.role === "ADMIN" || canUseStore(actor, location.id, true))) throw new Error("只有本門市店長或管理員可以修改安全庫存");
    const rawSafety = Number(input.safetyStockQty);
    const rawMaximum = input.maximumStockQty === undefined || input.maximumStockQty === "" ? null : Number(input.maximumStockQty);
    if (!Number.isFinite(rawSafety) || rawSafety < 0 || !Number.isInteger(rawSafety) || (rawMaximum !== null && (!Number.isFinite(rawMaximum) || rawMaximum < 0 || !Number.isInteger(rawMaximum)))) throw new Error("安全庫存與最大庫存必須是大於等於 0 的整數");
    const safety = quantity(rawSafety);
    const maximum = rawMaximum === null ? quantity(setting(state, location.id, productRow.id).maximumStockQty) : quantity(rawMaximum);
    if (maximum > 0 && maximum < safety) throw new Error("最大庫存不可小於安全庫存");
    if (!text(input.reason)) throw new Error("修改安全庫存必須填寫原因");
    const row = setting(state, location.id, productRow.id);
    const before = clone(row);
    Object.assign(row, { safetyStockQty: safety, maximumStockQty: maximum, automaticReplenishmentEnabled: input.replenishmentEnabled === undefined ? row.automaticReplenishmentEnabled !== false : input.replenishmentEnabled === true, replenishmentEnabled: input.replenishmentEnabled === undefined ? row.replenishmentEnabled !== false : input.replenishmentEnabled === true, effectiveFrom: input.effectiveFrom || row.effectiveFrom || null, effectiveTo: input.effectiveTo || row.effectiveTo || null, updatedBy: actor.id || null, updatedAt: timestamp(input), lastModifiedBy: actor.id || null, lastModifiedRole: actor.role || null, lastModifiedAt: timestamp(input), lastModifiedReason: text(input.reason) });
    addAudit(state, input, "STORE_SAFETY_STOCK_UPDATED", "LOCATION_PRODUCT_SETTING", row.id, text(input.reason), before, row);
    return { setting: row, before };
  });
}

export function getStoreSafetyStockRows(state, user = {}, filters = {}) {
  const normalized = normalizeStoreOperations(clone(state || {}));
  const scope = user.role === "STORE" ? [user.locationId] : normalized.locations.filter((row) => row.type === "STORE" && row.isActive !== false).map((row) => row.id);
  const query = text(filters.query).toLowerCase();
  return normalized.settings.filter((row) => scope.includes(row.locationId)).map((row) => {
    const productRow = product(normalized, row.productId) || {};
    const current = balance(normalized, row.locationId, row.productId);
    const sales = normalized.monthlyProductSales.filter((sale) => sale.locationId === row.locationId && sale.productId === row.productId).sort((a, b) => `${a.salesYear}-${a.salesMonth}`.localeCompare(`${b.salesYear}-${b.salesMonth}`)).slice(-6);
    const total = sales.reduce((sum, sale) => sum + quantity(sale.salesQty), 0);
    return { ...clone(row), productCode: productRow.productCode || "—", productName: productRow.name || "未知商品", specification: productRow.specification || "—", category: productRow.category || "未分類", locationName: normalized.locations.find((location) => location.id === row.locationId)?.name || row.locationId, onHandQty: quantity(current.onHandQty), availableQty: availableQty(current), sixMonthSalesTotal: total, averageMonthlySales: Number((total / 6).toFixed(2)), belowSafetyStock: quantity(current.onHandQty) < quantity(row.safetyStockQty) };
  }).filter((row) => !query || `${row.productCode} ${row.productName} ${row.specification} ${row.category}`.toLowerCase().includes(query)).filter((row) => filters.zeroSafety !== true || row.safetyStockQty === 0).filter((row) => filters.belowSafety !== true || row.belowSafetyStock).filter((row) => filters.replenishmentEnabled === undefined || row.replenishmentEnabled === filters.replenishmentEnabled);
}

export function validateStoreReturnToWarehouseGate(state, order, input = {}) {
  const blockingItems = [];
  const rows = warehouseReturnItems(state, order?.id);
  if (!rows.length) blockingItems.push({ field: "items", ruleCode: "LINES_REQUIRED", message: "門市退回總倉單至少需要一項商品明細" });
  if (!text(order?.returnReason)) blockingItems.push({ field: "returnReason", ruleCode: "RETURN_REASON_REQUIRED", message: "門市退回總倉必須填寫退貨原因" });
  if (!warehouse(state, order?.warehouseLocationId)) blockingItems.push({ field: "warehouseLocationId", ruleCode: "WAREHOUSE_ACTIVE_REQUIRED", message: "總倉不存在或尚未啟用" });
  rows.forEach((item) => {
    const productRow = product(state, item.productId);
    const name = productRow?.name || item.productId || "商品";
    if (!productRow || productRow.isActive === false) blockingItems.push({ field: "productId", itemId: item.id, productId: item.productId, ruleCode: "PRODUCT_ACTIVE_REQUIRED", message: `${name}：商品不存在或已停用` });
    if (quantity(item.returnQty) <= 0) blockingItems.push({ field: "returnQty", itemId: item.id, productId: item.productId, ruleCode: "QUANTITY_POSITIVE", message: `${name}：退貨數量必須大於 0` });
    if (productRow && productRow.batchTrackingEnabled === true && !text(item.batchNumber)) blockingItems.push({ field: "batchNumber", itemId: item.id, productId: item.productId, ruleCode: "BATCH_REQUIRED", message: `${name}：需要填寫批號` });
    if (productRow && productRow.expiryTrackingEnabled === true && !text(item.expiryDate)) blockingItems.push({ field: "expiryDate", itemId: item.id, productId: item.productId, ruleCode: "EXPIRY_REQUIRED", message: `${name}：需要填寫效期` });
    const current = balance(state, order?.sourceLocationId, item.productId);
    const remaining = Math.max(0, quantity(item.returnQty) - quantity(item.shippedQty));
    if (remaining > availableQty(current)) blockingItems.push({ field: "returnQty", itemId: item.id, productId: item.productId, ruleCode: "RETURN_AVAILABLE_EXCEEDED", currentValue: remaining, requiredValue: availableQty(current), message: `${name}：退貨量不可大於門市可用庫存` });
  });
  if (input.requireWarehouseApproval && !["APPROVED", "SHIPPED_TO_WAREHOUSE", "PARTIALLY_RECEIVED"].includes(order?.status)) blockingItems.push({ field: "status", ruleCode: "WAREHOUSE_APPROVAL_REQUIRED", message: "總倉尚未同意接收，不能寄回總倉" });
  return gateResult({ workflowType: "STORE_RETURN_WAREHOUSE", entity: order, attemptedAction: input.attemptedAction || "SUBMIT", blockingItems, responsibleRole: input.requireWarehouseApproval ? "WAREHOUSE" : "STORE", suggestedAction: "請補齊退貨原因、批號效期、可用庫存及總倉核准資料後重新操作" });
}

export function createStoreReturnToWarehouseDraft(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const source = requireEntity(activeStore(state, input.sourceLocationId || actor.locationId), "門市");
    const destination = requireEntity(warehouse(state, input.warehouseLocationId), "總倉");
    if (actor.role !== "ADMIN") actorLocationError(actor, source.id);
    requireRole(actor, ["ADMIN", "STORE"], "只有門市人員或管理員可以建立退回總倉單");
    const order = { id: makeId(input, "storeReturn"), returnNumber: nextNumber(state, "RTW", "returnNumber", input.createdAt, ["storeReturnOrders"]), sourceType: "STORE_TO_WAREHOUSE", sourceLocationId: source.id, warehouseLocationId: destination.id, status: "DRAFT", returnReason: text(input.returnReason), requestedBy: actor.id || null, approvedByStoreManager: null, approvedByWarehouse: null, shippedBy: null, shippedAt: null, createdAt: timestamp(input), updatedAt: timestamp(input), rejectedBy: null, rejectedAt: null, rejectReason: null, notes: text(input.notes) };
    const createdItems = (Array.isArray(input.items) ? input.items : []).map((raw) => { const productRow = requireActiveProduct(state, raw.productId); return normalizeWarehouseReturnItem({ id: makeId(input, "storeReturnItem"), returnOrderId: order.id, productId: productRow.id, sourceLocationId: source.id, warehouseLocationId: destination.id, returnQty: quantity(raw.returnQty ?? raw.quantity), shippedQty: 0, receivedQty: 0, rejectedQty: 0, rejectedReturnedQty: 0, availableQtySnapshot: availableQty(balance(state, source.id, productRow.id)), batchNumber: raw.batchNumber, expiryDate: raw.expiryDate, reasonCode: raw.reasonCode || "OTHER", note: raw.note }); });
    state.storeReturnOrders.unshift(order); state.storeReturnItems.push(...createdItems);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_DRAFT_CREATED", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 建立門市退回總倉草稿`, null, { order, items: createdItems });
    return { order, items: createdItems };
  });
}

export function submitStoreReturnToWarehouse(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (actor.role !== "ADMIN") actorLocationError(actor, order.sourceLocationId);
    if (!["DRAFT", "RETURNED_TO_STORE"].includes(order.status)) throw new Error("目前退回總倉單不可送出");
    const validation = validateStoreReturnToWarehouseGate(state, order, { attemptedAction: "SUBMIT" }); assertValid(validation);
    order.status = "PENDING_STORE_MANAGER_APPROVAL"; order.requestedBy = actor.id || order.requestedBy; order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_SUBMITTED", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 待門市店長核准`, null, order); return { order };
  });
}

export function approveStoreReturnToWarehouseByManager(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId, true)) throw new Error("只有原門市店長或管理員可以核准退回總倉");
    if (order.status !== "PENDING_STORE_MANAGER_APPROVAL") throw new Error("目前退回總倉單不在待門市店長核准狀態");
    const validation = validateStoreReturnToWarehouseGate(state, order, { attemptedAction: "STORE_MANAGER_APPROVE" }); assertValid(validation);
    order.status = "PENDING_WAREHOUSE_APPROVAL"; order.approvedByStoreManager = actor.id || null; order.approvedByStoreManagerAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_STORE_MANAGER_APPROVED", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 已由門市店長核准`, null, order); return { order };
  });
}

export function approveStoreReturnToWarehouse(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "WAREHOUSE"], "只有總倉或管理員可以核准接收門市退貨");
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (order.status !== "PENDING_WAREHOUSE_APPROVAL") throw new Error("目前退回總倉單不在待總倉核准狀態");
    const validation = validateStoreReturnToWarehouseGate(state, order, { attemptedAction: "WAREHOUSE_APPROVE" }); assertValid(validation);
    order.status = "APPROVED"; order.approvedByWarehouse = actor.id || null; order.approvedByWarehouseAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_APPROVED", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 總倉同意接收`, null, order); return { order };
  });
}

export function rejectStoreReturnToWarehouse(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "WAREHOUSE"], "只有總倉或管理員可以拒絕門市退貨");
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (!["PENDING_WAREHOUSE_APPROVAL", "APPROVED"].includes(order.status)) throw new Error("目前退回總倉單不可拒絕");
    if (!text(input.reason)) throw new Error("拒絕門市退貨必須填寫原因");
    order.status = "REJECTED"; order.rejectedBy = actor.id || null; order.rejectedAt = timestamp(input); order.rejectReason = text(input.reason); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_REJECTED", "STORE_RETURN_ORDER", order.id, order.rejectReason, null, order); return { order };
  });
}

export function shipStoreReturnToWarehouse(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true };
    if (actor.role !== "ADMIN") actorLocationError(actor, order.sourceLocationId);
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("目前退回總倉單不可寄出");
    const validation = validateStoreReturnToWarehouseGate(state, order, { attemptedAction: "SHIP_TO_WAREHOUSE", requireWarehouseApproval: true }); assertValid(validation);
    const rows = warehouseReturnItems(state, order.id); const shipRows = itemInputRows(input, ["items", "shipmentItems", "shippedItems"]); let moved = 0;
    rows.forEach((item) => {
      const remaining = Math.max(0, item.returnQty - item.shippedQty);
      const qty = shipRows.length ? shipQtyRows(input, item, shipRows, ["shippedQty", "quantity", "qty"]) : remaining;
      if (!qty) return;
      if (qty > remaining) throw new Error(`${product(state, item.productId)?.name || "商品"}：退回總倉出貨數量超過待出貨量`);
      const productRow = requireActiveProduct(state, item.productId); requireBatchAndExpiry(state, productRow, item);
      const current = balance(state, order.sourceLocationId, item.productId); if (qty > availableQty(current)) throw new Error(`${productRow.name || "商品"}：退回總倉出貨時可用庫存不足`);
      const beforeQty = current.onHandQty; current.onHandQty -= qty; current.returnInTransitQty += qty; current.updatedAt = timestamp(input); item.shippedQty += qty; item.inTransitQty += qty; item.updatedAt = timestamp(input); moved += qty;
      addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.STORE_RETURN_TO_WAREHOUSE_OUT, { locationId: order.sourceLocationId, productId: item.productId, quantity: -qty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "STORE_RETURN_ORDER", referenceId: order.id, fromLocationId: order.sourceLocationId, toLocationId: order.warehouseLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.returnNumber });
    });
    if (!moved) throw new Error("本次至少需要寄出一項退貨商品");
    order.status = "SHIPPED_TO_WAREHOUSE"; order.shippedBy = actor.id || null; order.shippedAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_SHIPPED", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 已寄回總倉 ${moved} 件`, null, { order, items: rows }); return { order, items: rows, shippedQty: moved };
  });
}

export function receiveStoreReturnToWarehouse(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    requireRole(actor, ["ADMIN", "WAREHOUSE"], "只有總倉或管理員可以收取門市退貨");
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true };
    if (!["SHIPPED_TO_WAREHOUSE", "PARTIALLY_RECEIVED", "RETURNED_TO_STORE"].includes(order.status)) throw new Error("目前退回總倉單不可收貨");
    const rows = warehouseReturnItems(state, order.id); const receiveRows = itemInputRows(input, ["items", "receiveItems", "receivedItems"]); let accepted = 0; let rejected = 0;
    rows.forEach((item) => {
      const pending = Math.max(0, item.shippedQty - item.receivedQty - item.rejectedQty); const raw = findLineInput(receiveRows, item); const receivedQty = receiveRows.length ? itemQty(raw, ["receivedQty", "quantity", "qty"]) : pending; const rejectedQty = receiveRows.length ? itemQty(raw, ["rejectedQty", "rejectQty"]) : 0;
      if (receivedQty + rejectedQty > pending) throw new Error(`${product(state, item.productId)?.name || "商品"}：總倉收貨數量超過在途數量`);
      if (rejectedQty && !text(raw?.reason || input.reason)) throw new Error(`${product(state, item.productId)?.name || "商品"}：拒收門市退貨必須填寫原因`);
      if (!receivedQty && !rejectedQty) return;
      if (receivedQty) { const current = balance(state, order.warehouseLocationId, item.productId); const beforeQty = current.onHandQty; current.onHandQty += receivedQty; current.updatedAt = timestamp(input); item.receivedQty += receivedQty; accepted += receivedQty; addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.STORE_RETURN_TO_WAREHOUSE_IN, { locationId: order.warehouseLocationId, productId: item.productId, quantity: receivedQty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "STORE_RETURN_ORDER", referenceId: order.id, fromLocationId: order.sourceLocationId, toLocationId: order.warehouseLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.returnNumber }); }
      if (rejectedQty) { item.rejectedQty += rejectedQty; item.rejectionReason = text(raw?.reason || input.reason); item.returnToStorePendingQty = quantity(item.returnToStorePendingQty) + rejectedQty; rejected += rejectedQty; }
      const sourceBalance = balance(state, order.sourceLocationId, item.productId); sourceBalance.returnInTransitQty = Math.max(0, sourceBalance.returnInTransitQty - receivedQty - rejectedQty); sourceBalance.updatedAt = timestamp(input); item.inTransitQty = Math.max(0, item.shippedQty - item.receivedQty - item.rejectedQty); item.updatedAt = timestamp(input);
    });
    if (!accepted && !rejected) throw new Error("本次至少需要收貨或拒收一項商品");
    const allAccounted = rows.every((item) => item.receivedQty + item.rejectedQty >= item.shippedQty); order.status = rejected ? "RETURNED_TO_STORE" : allAccounted ? "RECEIVED_BY_WAREHOUSE" : "PARTIALLY_RECEIVED"; order.receivedBy = actor.id || null; order.receivedAt = timestamp(input); order.updatedAt = timestamp(input);
    addAudit(state, input, "STORE_RETURN_WAREHOUSE_RECEIVED", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 總倉收貨 ${accepted} 件、拒收 ${rejected} 件`, null, { order, items: rows }); return { order, items: rows, receivedQty: accepted, rejectedQty: rejected };
  });
}

export function receiveRejectedStoreReturnAtStore(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const order = requireEntity(state.storeReturnOrders.find((row) => row.id === input.returnOrderId), "退回總倉單");
    if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId)) throw new Error("只有原門市人員或管理員可以簽收退回商品");
    if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true };
    if (order.status !== "RETURNED_TO_STORE") throw new Error("目前沒有待門市重新簽收的退貨");
    const rows = warehouseReturnItems(state, order.id); const receiveRows = itemInputRows(input, ["items", "receiveItems", "receivedItems"]); let total = 0;
    rows.forEach((item) => { const pending = Math.max(0, quantity(item.returnToStorePendingQty) - quantity(item.rejectedReturnedQty)); const raw = findLineInput(receiveRows, item); const qty = receiveRows.length ? itemQty(raw, ["receivedQty", "quantity", "qty"]) : pending; if (qty > pending) throw new Error(`${product(state, item.productId)?.name || "商品"}：重新簽收數量超過待退回數量`); if (!qty) return; const current = balance(state, order.sourceLocationId, item.productId); const beforeQty = current.onHandQty; current.onHandQty += qty; current.updatedAt = timestamp(input); item.rejectedReturnedQty += qty; total += qty; addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.STORE_RETURN_REJECTED_BACK_TO_STORE, { locationId: order.sourceLocationId, productId: item.productId, quantity: qty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "STORE_RETURN_ORDER", referenceId: order.id, fromLocationId: order.warehouseLocationId, toLocationId: order.sourceLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.returnNumber }); });
    if (!total) throw new Error("本次至少需要簽收一項退回商品");
    const resolved = rows.every((item) => item.receivedQty + item.rejectedReturnedQty >= item.shippedQty); order.status = resolved ? "RECEIVED_BY_WAREHOUSE" : "PARTIALLY_RECEIVED"; order.updatedAt = timestamp(input); addAudit(state, input, "STORE_RETURN_REJECTED_RECEIVED_AT_STORE", "STORE_RETURN_ORDER", order.id, `${order.returnNumber} 門市重新簽收 ${total} 件`, null, { order, items: rows }); return { order, items: rows, receivedQty: total };
  });
}

export function validateStoreSupplierReturnGate(state, order, input = {}) {
  const blockingItems = [];
  const rows = directReturnItems(state, order?.id);
  if (!rows.length) blockingItems.push({ field: "items", ruleCode: "LINES_REQUIRED", message: "門市直退廠商單至少需要一項商品明細" });
  if (!text(order?.returnReason)) blockingItems.push({ field: "returnReason", ruleCode: "RETURN_REASON_REQUIRED", message: "門市直退廠商必須填寫退貨原因" });
  if (input.requireStoreManagerApproval && !["PENDING_PURCHASING_REVIEW", "PENDING_SUPPLIER_CONFIRMATION", "SUPPLIER_CONFIRMED", "SHIPPED_TO_SUPPLIER", "WAITING_RESOLUTION", "PARTIALLY_RESOLVED", "RESOLVED"].includes(order?.status)) blockingItems.push({ field: "status", ruleCode: "STORE_MANAGER_APPROVAL_REQUIRED", message: "尚未經門市店長核准" });
  if (input.requirePurchasingReview && !["PENDING_SUPPLIER_CONFIRMATION", "SUPPLIER_CONFIRMED", "SHIPPED_TO_SUPPLIER", "WAITING_RESOLUTION", "PARTIALLY_RESOLVED", "RESOLVED"].includes(order?.status)) blockingItems.push({ field: "status", ruleCode: "PURCHASING_REVIEW_REQUIRED", message: "尚未經採購人員審核" });
  if (input.requireSupplierConfirmation && !["SUPPLIER_CONFIRMED", "SHIPPED_TO_SUPPLIER", "WAITING_RESOLUTION", "PARTIALLY_RESOLVED", "RESOLVED"].includes(order?.status)) blockingItems.push({ field: "status", ruleCode: "SUPPLIER_CONFIRMATION_REQUIRED", message: "廠商尚未確認接受退貨" });
  if (input.requireShippingConfiguration && !text(order?.returnAddress)) blockingItems.push({ field: "returnAddress", ruleCode: "RETURN_ADDRESS_REQUIRED", message: "尚未設定退貨地址" });
  if (input.requireShippingConfiguration && !text(order?.returnMethod)) blockingItems.push({ field: "returnMethod", ruleCode: "RETURN_METHOD_REQUIRED", message: "尚未設定退貨方式" });
  rows.forEach((item) => { const productRow = product(state, item.productId); const name = productRow?.name || item.productId || "商品"; if (!productRow || productRow.isActive === false) blockingItems.push({ field: "productId", itemId: item.id, productId: item.productId, ruleCode: "PRODUCT_ACTIVE_REQUIRED", message: `${name}：商品不存在或已停用` }); if (quantity(item.returnQty) <= 0) blockingItems.push({ field: "returnQty", itemId: item.id, productId: item.productId, ruleCode: "QUANTITY_POSITIVE", message: `${name}：退貨數量必須大於 0` }); if (productRow?.batchTrackingEnabled === true && !text(item.batchNumber)) blockingItems.push({ field: "batchNumber", itemId: item.id, productId: item.productId, ruleCode: "BATCH_REQUIRED", message: `${name}：需要填寫批號` }); if (productRow?.expiryTrackingEnabled === true && !text(item.expiryDate)) blockingItems.push({ field: "expiryDate", itemId: item.id, productId: item.productId, ruleCode: "EXPIRY_REQUIRED", message: `${name}：需要填寫效期` }); const current = balance(state, order?.sourceLocationId, item.productId); const remaining = Math.max(0, quantity(item.returnQty) - quantity(item.returnedQty)); if (remaining > availableQty(current)) blockingItems.push({ field: "returnQty", itemId: item.id, productId: item.productId, ruleCode: "RETURN_AVAILABLE_EXCEEDED", message: `${name}：退貨量不可大於門市可用庫存` }); });
  return gateResult({ workflowType: "STORE_RETURN_SUPPLIER", entity: order, attemptedAction: input.attemptedAction || "SUBMIT", blockingItems, responsibleRole: input.requirePurchasingReview ? "PURCHASING" : "STORE", suggestedAction: "請完成門市店長、採購、廠商確認及退貨地址／方式後重新操作" });
}

export function createStoreSupplierReturnDraft(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const source = requireEntity(activeStore(state, input.sourceLocationId || actor.locationId), "門市"); const supplier = requireEntity(ensureArray(state, "suppliers").find((row) => row.id === input.supplierId && row.isActive !== false), "供應商");
    if (actor.role !== "ADMIN") actorLocationError(actor, source.id); requireRole(actor, ["ADMIN", "STORE"], "只有門市人員或管理員可以建立門市直退廠商單");
    const order = { id: makeId(input, "storeSupplierReturn"), returnNumber: nextNumber(state, "RTS", "returnNumber", input.createdAt, ["supplierReturns"]), sourceType: "STORE", sourceLocationId: source.id, supplierId: supplier.id, orderingSupplierId: input.orderingSupplierId || supplier.id, payeeSupplierId: input.payeeSupplierId || null, sourceDemandOrderId: input.sourceDemandOrderId || null, sourcePurchaseOrderId: input.sourcePurchaseOrderId || null, status: "DRAFT", returnReason: text(input.returnReason), resolutionType: null, expectedResolutionDate: input.expectedResolutionDate || null, actualResolutionDate: null, returnAddress: text(input.returnAddress), returnMethod: text(input.returnMethod), storeNote: text(input.storeNote), purchasingNote: "", supplierResponse: "", createdBy: actor.id || null, approvedByStoreManager: null, approvedByPurchasing: null, shippedBy: null, shippedAt: null, resolvedBy: null, resolvedAt: null, rejectedBy: null, rejectedAt: null, rejectReason: null, createdAt: timestamp(input), updatedAt: timestamp(input) };
    const createdItems = (Array.isArray(input.items) ? input.items : []).map((raw) => { const productRow = requireActiveProduct(state, raw.productId); return normalizeDirectReturnItem({ id: makeId(input, "storeSupplierReturnItem"), returnOrderId: order.id, productId: productRow.id, sourceLocationId: source.id, warehouseLocationId: source.id, availableQtySnapshot: availableQty(balance(state, source.id, productRow.id)), returnQty: quantity(raw.returnQty ?? raw.quantity), acceptedReturnQty: 0, rejectedQty: 0, rejectedReturnedQty: 0, refundedQty: 0, replacementQty: 0, replacementReceivedQty: 0, creditedQty: 0, unresolvedQty: quantity(raw.returnQty ?? raw.quantity), returnedQty: 0, batchNumber: raw.batchNumber, expiryDate: raw.expiryDate, itemCondition: raw.itemCondition, reasonCode: raw.reasonCode || "OTHER", note: raw.note }); });
    state.supplierReturns.unshift(order); state.supplierReturnItems.push(...createdItems); addAudit(state, input, "STORE_SUPPLIER_RETURN_DRAFT_CREATED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 建立門市直退廠商草稿`, null, { order, items: createdItems }); return { order, items: createdItems };
  });
}

export function submitStoreSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (actor.role !== "ADMIN") actorLocationError(actor, order.sourceLocationId); if (!["DRAFT", "REJECTED"].includes(order.status)) throw new Error("目前門市直退廠商單不可送出"); const validation = validateStoreSupplierReturnGate(state, order, { attemptedAction: "SUBMIT" }); assertValid(validation); order.status = "PENDING_STORE_MANAGER_APPROVAL"; order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_SUBMITTED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 待門市店長核准`, null, order); return { order }; });
}

export function approveStoreSupplierReturnByManager(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (actor.role !== "ADMIN" && !canUseStore(actor, order.sourceLocationId, true)) throw new Error("只有原門市店長或管理員可以核准門市直退廠商"); if (order.status !== "PENDING_STORE_MANAGER_APPROVAL") throw new Error("目前門市直退廠商單不在待店長核准狀態"); const validation = validateStoreSupplierReturnGate(state, order, { attemptedAction: "STORE_MANAGER_APPROVE" }); assertValid(validation); order.status = "PENDING_PURCHASING_REVIEW"; order.approvedByStoreManager = actor.id || null; order.approvedByStoreManagerAt = timestamp(input); order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_STORE_MANAGER_APPROVED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 已由門市店長核准`, null, order); return { order }; });
}

export function reviewStoreSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { requireRole(actor, ["ADMIN", "PURCHASING"], "只有採購人員或管理員可以審核門市直退廠商"); const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (order.status !== "PENDING_PURCHASING_REVIEW") throw new Error("目前門市直退廠商單不在待採購審核狀態"); if (!text(input.returnAddress || order.returnAddress)) throw new Error("採購審核必須設定退貨地址"); if (!text(input.returnMethod || order.returnMethod)) throw new Error("採購審核必須設定退貨方式"); if (!input.resolutionType || !STORE_DIRECT_RETURN_RESOLUTION_TYPES.includes(input.resolutionType)) throw new Error("採購審核必須選擇退款、換貨或折讓方式"); order.returnAddress = text(input.returnAddress || order.returnAddress); order.returnMethod = text(input.returnMethod || order.returnMethod); order.expectedResolutionDate = input.expectedResolutionDate || order.expectedResolutionDate || null; order.resolutionType = input.resolutionType; order.purchasingNote = text(input.purchasingNote); order.approvedByPurchasing = actor.id || null; order.approvedByPurchasingAt = timestamp(input); order.status = "PENDING_SUPPLIER_CONFIRMATION"; order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_PURCHASING_REVIEWED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 採購審核完成`, null, order); return { order }; });
}

export function confirmStoreSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { requireRole(actor, ["ADMIN", "PURCHASING"], "只有採購人員或管理員可以登記廠商確認"); const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (order.status !== "PENDING_SUPPLIER_CONFIRMATION") throw new Error("目前門市直退廠商單不在待廠商確認狀態"); order.supplierResponse = text(input.supplierResponse); if (input.accepted === false) { if (!text(input.reason)) throw new Error("廠商拒絕退貨必須填寫原因"); order.status = "REJECTED"; order.rejectReason = text(input.reason); order.rejectedBy = actor.id || null; order.rejectedAt = timestamp(input); } else { order.status = "SUPPLIER_CONFIRMED"; order.supplierConfirmedAt = timestamp(input); } order.updatedAt = timestamp(input); addAudit(state, input, input.accepted === false ? "STORE_SUPPLIER_RETURN_REJECTED" : "STORE_SUPPLIER_RETURN_SUPPLIER_CONFIRMED", "SUPPLIER_RETURN_ORDER", order.id, input.accepted === false ? order.rejectReason : `${order.returnNumber} 廠商已確認`, null, order); return { order }; });
}

export function shipStoreSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (actor.role !== "ADMIN") actorLocationError(actor, order.sourceLocationId); if (!["SUPPLIER_CONFIRMED", "SHIPPED_TO_SUPPLIER"].includes(order.status)) throw new Error("廠商尚未確認，或門市直退廠商單不可寄出"); if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true }; const rows = directReturnItems(state, order.id); const shipRows = itemInputRows(input, ["items", "shipmentItems", "shippedItems"]); let moved = 0; rows.forEach((item) => { const remaining = Math.max(0, item.returnQty - item.returnedQty); const qty = shipQtyRows(input, { ...item, approvedQty: remaining, shippedQty: item.returnedQty, rejectedQty: 0 }, shipRows, ["shippedQty", "returnQty", "quantity", "qty"]); if (!qty) return; if (qty > remaining) throw new Error(`${product(state, item.productId)?.name || "商品"}：直退廠商出貨量超過申請量`); const productRow = requireActiveProduct(state, item.productId); requireBatchAndExpiry(state, productRow, item); const current = balance(state, order.sourceLocationId, item.productId); if (qty > availableQty(current)) throw new Error(`${productRow.name || "商品"}：直退廠商出貨時可用庫存不足`); const beforeQty = current.onHandQty; current.onHandQty -= qty; current.updatedAt = timestamp(input); item.returnedQty += qty; item.updatedAt = timestamp(input); moved += qty; addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.STORE_RETURN_TO_SUPPLIER_OUT, { locationId: order.sourceLocationId, productId: item.productId, quantity: -qty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "SUPPLIER_RETURN_ORDER", referenceId: order.id, fromLocationId: order.sourceLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.returnNumber }); }); if (!moved) throw new Error("本次至少需要寄出一項退貨商品"); order.status = "WAITING_RESOLUTION"; order.shippedBy = actor.id || null; order.shippedAt = timestamp(input); order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_SHIPPED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 已寄給廠商 ${moved} 件`, null, { order, items: rows }); return { order, items: rows, shippedQty: moved }; });
}

export function recordStoreSupplierReturnResolution(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { requireRole(actor, ["ADMIN", "PURCHASING"], "只有採購人員或管理員可以記錄門市直退廠商結果"); const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (!["WAITING_RESOLUTION", "PARTIALLY_RESOLVED"].includes(order.status)) throw new Error("門市直退廠商尚未進入處理結果階段"); const rows = directReturnItems(state, order.id); const resolutionRows = itemInputRows(input, ["items", "resolutionItems"]); const raw = resolutionRows.find((row) => row.itemId === input.returnOrderItemId || row.id === input.returnOrderItemId) || {}; const item = requireEntity(rows.find((row) => row.id === (input.returnOrderItemId || raw.itemId)), "退貨明細"); const type = input.resolutionType || raw.resolutionType; if (!STORE_DIRECT_RETURN_RESOLUTION_TYPES.includes(type)) throw new Error("門市直退廠商處理結果不合法"); const qty = Math.min(item.unresolvedQty, itemQty(input.returnOrderItemId ? input : raw, ["resolutionQty", "quantity", "qty"]) || item.unresolvedQty); if (!qty) throw new Error("處理數量必須大於 0"); if (type === "REFUND") item.refundedQty += qty; else if (type === "CREDIT_NOTE") item.creditedQty += qty; else if (["REPLACEMENT", "EXCHANGE_PRODUCT"].includes(type)) item.replacementQty += qty; else if (type === "REJECTED") item.rejectedQty += qty; item.unresolvedQty = Math.max(0, item.returnQty - item.refundedQty - item.creditedQty - item.replacementReceivedQty - item.rejectedQty); order.resolutionType = type; order.supplierResponse = text(input.supplierResponse || raw.supplierResponse); const needsStoreReturn = type === "REJECTED"; order.status = !needsStoreReturn && item.unresolvedQty === 0 && item.replacementQty <= item.replacementReceivedQty ? "RESOLVED" : "PARTIALLY_RESOLVED"; order.actualResolutionDate = order.status === "RESOLVED" ? timestamp(input).slice(0, 10) : null; order.resolvedAt = order.status === "RESOLVED" ? timestamp(input) : null; order.resolvedBy = order.status === "RESOLVED" ? actor.id || null : null; order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_RESOLUTION_RECORDED", "SUPPLIER_RETURN_ORDER_ITEM", item.id, `${type} ${qty} 件`, null, item); return { order, item }; });
}

export function receiveStoreSupplierRejected(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (actor.role !== "ADMIN") actorLocationError(actor, order.sourceLocationId); if (!["PARTIALLY_RESOLVED", "WAITING_RESOLUTION"].includes(order.status)) throw new Error("目前沒有待門市簽收的廠商拒退商品"); if (input.operationId && state.inventoryMovements.some((row) => row.operationId === input.operationId && row.sourceId === order.id)) return { order, idempotent: true }; const rows = directReturnItems(state, order.id); const receiveRows = itemInputRows(input, ["items", "receiveItems", "receivedItems"]); let total = 0; rows.forEach((item) => { const pending = Math.max(0, item.rejectedQty - item.rejectedReturnedQty); const raw = findLineInput(receiveRows, item); const qty = receiveRows.length ? itemQty(raw, ["receivedQty", "quantity", "qty"]) : pending; if (qty > pending) throw new Error(`${product(state, item.productId)?.name || "商品"}：重新簽收數量超過廠商拒退數量`); if (!qty) return; const current = balance(state, order.sourceLocationId, item.productId); const beforeQty = current.onHandQty; current.onHandQty += qty; current.updatedAt = timestamp(input); item.rejectedReturnedQty += qty; total += qty; addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.SUPPLIER_RETURN_REJECTED_BACK_TO_STORE, { locationId: order.sourceLocationId, productId: item.productId, quantity: qty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "SUPPLIER_RETURN_ORDER", referenceId: order.id, toLocationId: order.sourceLocationId, batchNumber: item.batchNumber, expiryDate: item.expiryDate, note: order.returnNumber }); }); if (!total) throw new Error("本次至少需要簽收一項廠商拒退商品"); const done = rows.every((item) => item.unresolvedQty === 0 && item.rejectedReturnedQty >= item.rejectedQty && item.replacementReceivedQty >= item.replacementQty); if (done) { order.status = "RESOLVED"; order.resolvedAt = timestamp(input); order.resolvedBy = actor.id || null; } order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_REJECTED_RECEIVED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 門市重新簽收 ${total} 件`, null, { order, items: rows }); return { order, items: rows, receivedQty: total }; });
}

export function receiveStoreSupplierReplacement(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); if (actor.role !== "ADMIN") actorLocationError(actor, order.sourceLocationId); requireRole(actor, ["ADMIN", "STORE"], "只有原門市人員或管理員可以簽收換貨商品"); const item = requireEntity(directReturnItems(state, order.id).find((row) => row.id === input.returnOrderItemId), "退貨明細"); const qty = quantity(input.receivedQty); if (!qty || qty > item.replacementQty - item.replacementReceivedQty) throw new Error("換貨到貨數量超過待收數量"); const productId = input.replacementProductId || item.productId; requireActiveProduct(state, productId); const current = balance(state, order.sourceLocationId, productId); const beforeQty = current.onHandQty; current.onHandQty += qty; current.updatedAt = timestamp(input); item.replacementReceivedQty += qty; item.replacementProductId = productId; item.unresolvedQty = Math.max(0, item.returnQty - item.refundedQty - item.creditedQty - item.replacementReceivedQty - item.rejectedQty); item.updatedAt = timestamp(input); addMovement(state, input, STORE_OPERATION_MOVEMENT_TYPES.SUPPLIER_REPLACEMENT_RECEIPT_STORE, { locationId: order.sourceLocationId, productId, quantity: qty, beforeQty, afterQty: current.onHandQty, sourceId: order.id, sourceItemId: item.id, referenceType: "SUPPLIER_RETURN_ORDER", referenceId: order.id, toLocationId: order.sourceLocationId, note: order.returnNumber }); if (item.unresolvedQty === 0 && item.rejectedReturnedQty >= item.rejectedQty) { order.status = "RESOLVED"; order.resolvedAt = timestamp(input); order.resolvedBy = actor.id || null; } else order.status = "PARTIALLY_RESOLVED"; order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_REPLACEMENT_RECEIVED", "SUPPLIER_RETURN_ORDER_ITEM", item.id, `${order.returnNumber} 門市簽收換貨 ${qty} 件`, null, item); return { order, item }; });
}

export function closeStoreSupplierReturn(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => { requireRole(actor, ["ADMIN", "PURCHASING"], "只有採購人員或管理員可以結案門市直退廠商"); const order = requireEntity(state.supplierReturns.find((row) => row.id === input.returnOrderId && row.sourceType === "STORE"), "門市直退廠商單"); const rows = directReturnItems(state, order.id); if (!rows.length || rows.some((item) => item.unresolvedQty > 0 || item.rejectedReturnedQty < item.rejectedQty || item.replacementReceivedQty < item.replacementQty)) throw new Error("門市直退廠商仍有未完成處理數量"); order.status = "RESOLVED"; order.resolvedAt = timestamp(input); order.resolvedBy = actor.id || null; order.updatedAt = timestamp(input); addAudit(state, input, "STORE_SUPPLIER_RETURN_CLOSED", "SUPPLIER_RETURN_ORDER", order.id, `${order.returnNumber} 已結案`, null, order); return { order }; });
}

export function getStoreOperationsForRole(state, user = {}) {
  const normalized = normalizeStoreOperations(clone(state || {}));
  const transferRows = normalized.storeTransferOrders.filter((order) => user.role === "ADMIN" || user.role === "WAREHOUSE" || user.role === "PURCHASING" || (user.role === "STORE" && [order.sourceLocationId, order.destinationLocationId].includes(user.locationId))).map((order) => ({ ...clone(order), items: transferItems(normalized, order.id).map(clone) }));
  const warehouseReturnRows = normalized.storeReturnOrders.filter((order) => user.role === "ADMIN" || user.role === "WAREHOUSE" || (user.role === "STORE" && order.sourceLocationId === user.locationId)).map((order) => ({ ...clone(order), items: warehouseReturnItems(normalized, order.id).map(clone) }));
  const supplierReturnRows = normalized.supplierReturns.filter((order) => order.sourceType === "STORE" && (user.role === "ADMIN" || user.role === "PURCHASING" || (user.role === "STORE" && order.sourceLocationId === user.locationId))).map((order) => ({ ...clone(order), purchasingNote: user.role === "STORE" ? "" : order.purchasingNote, items: directReturnItems(normalized, order.id).map((item) => user.role === "STORE" ? { ...clone(item), internalNote: "" } : clone(item)) }));
  return { transfers: transferRows, warehouseReturns: warehouseReturnRows, supplierReturns: supplierReturnRows, safetyStocks: getStoreSafetyStockRows(normalized, user) };
}

export function uploadStoreReturnAttachment(sourceState, input = {}) {
  return transact(sourceState, input, (state, actor) => {
    const returnOrderId = input.returnOrderId; const direct = state.supplierReturns.find((row) => row.id === returnOrderId && row.sourceType === "STORE"); const warehouseReturn = state.storeReturnOrders.find((row) => row.id === returnOrderId); const order = direct || warehouseReturn; if (!order) throw new Error("找不到門市退貨單"); const allowed = actor.role === "ADMIN" || (actor.role === "STORE" && order.sourceLocationId === actor.locationId) || (actor.role === "WAREHOUSE" && Boolean(warehouseReturn)) || (actor.role === "PURCHASING" && Boolean(direct)); if (!allowed) throw new Error("目前帳號無法查看或上傳此退貨附件"); const fileName = text(input.fileName); const fileType = text(input.fileType).toLowerCase(); const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : ""; if (!["pdf", "jpg", "jpeg", "png"].includes(extension) || !["application/pdf", "image/jpg", "image/jpeg", "image/png"].includes(fileType)) throw new Error("附件只允許 PDF、JPG、JPEG、PNG"); if (quantity(input.fileSize) <= 0 || quantity(input.fileSize) > 10 * 1024 * 1024) throw new Error("附件大小必須大於 0 且不得超過 10 MB"); if (!text(input.storageKey).startsWith("private/")) throw new Error("附件必須使用私有 storage key"); const attachment = { id: makeId(input, "storeReturnAttachment"), returnOrderId, returnOrderItemId: input.returnOrderItemId || null, attachmentType: input.attachmentType || "OTHER", fileName, fileType, fileSize: quantity(input.fileSize), storageKey: text(input.storageKey), uploadedBy: actor.id || null, uploadedAt: timestamp(input), isActive: true }; if (direct) state.supplierReturnAttachments.unshift(attachment); else state.storeReturnAttachments.unshift(attachment); addAudit(state, input, "STORE_RETURN_ATTACHMENT_UPLOADED", direct ? "SUPPLIER_RETURN_ORDER" : "STORE_RETURN_ORDER", returnOrderId, "門市退貨附件 metadata 已儲存（未記錄公開 URL）", null, { attachmentType: attachment.attachmentType, fileName: attachment.fileName, fileSize: attachment.fileSize }); return { attachment: { ...attachment, storageKey: undefined } }; });
}

export function validatePurchaseItemShortageGate(line, input = {}, products = []) {
  const rawShortageQty = Number(input.shortageQty);
  const shortageQty = quantity(input.shortageQty);
  const orderedQty = quantity(line?.orderedQty); const receivedQty = quantity(line?.receivedQty); const cancelledQty = quantity(line?.cancelledQty); const openRemainingQty = Math.max(0, orderedQty - receivedQty - cancelledQty); const blockingItems = [];
  if (!Number.isFinite(rawShortageQty) || !Number.isInteger(rawShortageQty) || rawShortageQty < 0) blockingItems.push({ field: "shortageQty", ruleCode: "SHORTAGE_QTY_NON_NEGATIVE", message: "缺貨數量不可小於 0 且必須是整數" });
  if (shortageQty > openRemainingQty) blockingItems.push({ field: "shortageQty", ruleCode: "SHORTAGE_QTY_EXCEEDS_OPEN", currentValue: shortageQty, requiredValue: openRemainingQty, message: `缺貨數量不可大於未到貨數量 ${openRemainingQty}` });
  const status = input.shortageStatus || line?.shortageStatus || "NONE";
  if (status !== "NONE" && !text(input.shortageReason)) blockingItems.push({ field: "shortageReason", ruleCode: "SHORTAGE_REASON_REQUIRED", message: "缺貨狀態不是無缺貨時必須填寫缺貨原因" });
  if (input.shortageReason === "OTHER" && !text(input.shortageNote)) blockingItems.push({ field: "shortageNote", ruleCode: "SHORTAGE_OTHER_NOTE_REQUIRED", message: "缺貨原因選擇其他時必須填寫說明" });
  if (input.alternativeProductId) { const alternative = products.find((item) => item.id === input.alternativeProductId); if (!alternative || alternative.isActive === false) blockingItems.push({ field: "alternativeProductId", ruleCode: "ALTERNATIVE_PRODUCT_ACTIVE_REQUIRED", message: "替代商品不存在或已停用" }); }
  return gateResult({ workflowType: "PURCHASE_ITEM_SHORTAGE", entity: { ...line, id: line?.id }, attemptedAction: input.attemptedAction || "UPDATE_SHORTAGE", blockingItems, responsibleRole: "PURCHASING", suggestedAction: "請修正缺貨數量、原因及替代商品後重新儲存" });
}
