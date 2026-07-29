import { calculateDemandLineAmount, evaluateStoreOrderCondition } from "./domain.js";
import { isProductPurchasable } from "./master-data-workflow.js";
import { validatePurchaseOrderConfirmation } from "./procurement-workflow.js";
import { validatePurchaseDeliveryConfiguration } from "./receiving-workflow.js";

export const WORKFLOW_TYPES = Object.freeze([
  "DEMAND_ORDER",
  "PURCHASE_ORDER",
  "SUPPLIER_DIRECT_RECEIPT",
  "WAREHOUSE_RECEIPT",
  "STORE_RECEIPT",
]);

const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const text = (value) => String(value ?? "").trim();
const quantity = (value) => Math.max(0, Math.floor(Number(value) || 0));
const makeId = (input, prefix) => input.createId ? input.createId(prefix) : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const at = (input = {}) => input.createdAt || input.changedAt || new Date().toISOString();
const ensureArray = (state, name) => { state[name] = Array.isArray(state[name]) ? state[name] : []; return state[name]; };

const ruleCodeForError = (error) => {
  const value = text(error);
  if (value.includes("一項商品") || value.includes("一項明細")) return "LINES_REQUIRED";
  if (value.includes("數量必須大於 0")) return "QUANTITY_POSITIVE";
  if (value.includes("不存在") || value.includes("已停用")) return "PRODUCT_ACTIVE_REQUIRED";
  if (value.includes("採購設定") || value.includes("有效供應品")) return "PRODUCT_PURCHASABLE_REQUIRED";
  if (value.includes("門市最低") || value.includes("最低需求") || value.includes("條件")) return "STORE_MINIMUM_CONDITION";
  if (value.includes("倍數")) return "PURCHASE_MULTIPLE";
  if (value.includes("最低採購量")) return "MINIMUM_ORDER_QUANTITY";
  if (value.includes("最低採購金額")) return "MINIMUM_ORDER_AMOUNT";
  if (value.includes("付款供應商")) return "PAYEE_SUPPLIER_ACTIVE";
  if (value.includes("配送") || value.includes("目的地") || value.includes("到貨日")) return "DELIVERY_CONFIGURATION";
  if (value.includes("原因") || value.includes("備註")) return "REASON_REQUIRED";
  return "WORKFLOW_RULE_FAILED";
};

export function createBlockingItem(input = {}) {
  const item = {
    field: text(input.field) || null,
    item_id: input.item_id ?? input.itemId ?? null,
    itemId: input.item_id ?? input.itemId ?? null,
    product_id: input.product_id ?? input.productId ?? null,
    productId: input.product_id ?? input.productId ?? null,
    product_name: text(input.product_name ?? input.productName) || null,
    productName: text(input.product_name ?? input.productName) || null,
    rule_code: text(input.rule_code ?? input.ruleCode) || "WORKFLOW_RULE_FAILED",
    ruleCode: text(input.rule_code ?? input.ruleCode) || "WORKFLOW_RULE_FAILED",
    current_value: input.current_value ?? input.currentValue ?? null,
    currentValue: input.current_value ?? input.currentValue ?? null,
    required_value: input.required_value ?? input.requiredValue ?? null,
    requiredValue: input.required_value ?? input.requiredValue ?? null,
    message: text(input.message) || "尚未符合流程條件",
  };
  return item;
}

function structuredResult({ workflowType, entityId, entityLocationId = null, currentStatus, attemptedAction, blockingItems, message, suggestedAction, responsibleRole }) {
  const items = blockingItems.map(createBlockingItem);
  const result = {
    valid: items.length === 0,
    error_code: items.length ? "WORKFLOW_BLOCKED" : null,
    workflow_type: workflowType,
    entity_id: entityId || null,
    entity_location_id: entityLocationId || null,
    current_status: currentStatus || null,
    attempted_action: attemptedAction || null,
    blocking_items: items,
    message: message || (items.length ? "目前資料未符合進入下一階段的必要條件" : "流程檢核通過"),
    suggested_action: suggestedAction || (items.length ? "請依阻擋項目補齊資料後重新操作" : null),
    responsible_role: responsibleRole || null,
  };
  // JS callers in the existing browser code use camelCase; API adapters can
  // use the snake_case contract above without a second translation layer.
  return { ...result, errorCode: result.error_code, workflowType: result.workflow_type, entityId: result.entity_id, entityLocationId: result.entity_location_id, currentStatus: result.current_status, attemptedAction: result.attempted_action, blockingItems: items, suggestedAction: result.suggested_action, responsibleRole: result.responsible_role };
}

function primarySupplierProduct(state, productId) {
  return ensureArray(state, "supplierProducts").find((item) => item.productId === productId && item.isPrimary === true && item.isActive !== false)
    || ensureArray(state, "supplierProducts").find((item) => item.productId === productId && item.isActive !== false);
}

function activeCondition(state, locationId, productId) {
  return ensureArray(state, "storeOrderConditions").filter((row) => row.productId === productId && row.isActive !== false && (row.locationId === locationId || row.locationId === null || row.locationId === undefined)).sort((a, b) => Number(b.locationId === locationId) - Number(a.locationId === locationId))[0] || {};
}

function demandGateQuantity(item = {}, demand = {}) {
  const requestedQty = item.requestedQty;
  if (demand.sourceType === "AUTO") {
    const positiveFallback = [item.managerConfirmedQty, item.storeConfirmedQty, item.requestedQty, item.finalRequestedQty, item.approvedQty, item.systemSuggestedQty]
      .find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
    return quantity(positiveFallback ?? requestedQty);
  }
  const source = requestedQty !== null && requestedQty !== undefined && requestedQty !== ""
    ? requestedQty
    : item.finalRequestedQty ?? item.approvedQty;
  return quantity(source);
}

export function validateDemandOrderGate(state, demand, input = {}) {
  const blockingItems = [];
  const items = Array.isArray(demand?.items) ? demand.items : [];
  if (!items.length) blockingItems.push({ field: "items", ruleCode: "LINES_REQUIRED", message: "需求單至少需要一項商品明細" });
  const locationId = input.locationId || demand?.locationId;
  items.forEach((item, index) => {
    const product = ensureArray(state, "products").find((candidate) => candidate.id === item.productId);
    const relation = primarySupplierProduct(state, item.productId);
    const supplier = relation ? ensureArray(state, "suppliers").find((candidate) => candidate.id === relation.supplierId) : null;
    const qty = demandGateQuantity(item, demand);
    const amount = calculateDemandLineAmount(qty, item.referencePurchasePrice ?? relation?.purchasePrice ?? 0);
    const conditionRow = activeCondition(state, locationId, item.productId);
    const condition = evaluateStoreOrderCondition({ conditionMode: conditionRow.conditionMode, requestedQty: qty, lineAmount: amount, minimumQty: conditionRow.minimumQty, minimumAmount: conditionRow.minimumAmount });
    const name = product?.name || item.productId || `第 ${index + 1} 筆`;
    if (!product || product.isActive === false) blockingItems.push({ field: "productId", itemId: item.id, productId: item.productId, productName: name, ruleCode: "PRODUCT_ACTIVE_REQUIRED", currentValue: product?.isActive === false ? "已停用" : "不存在", requiredValue: "啟用商品", message: `${name}：商品不存在或已停用` });
    if (product && !isProductPurchasable(product)) blockingItems.push({ field: "productId", itemId: item.id, productId: item.productId, productName: name, ruleCode: "PRODUCT_PURCHASABLE_REQUIRED", currentValue: product.procurementStatus, requiredValue: "PURCHASABLE", message: `${name}：商品尚未完成採購設定` });
    if (!relation || relation.isActive === false || !supplier || supplier.isActive === false) blockingItems.push({ field: "supplierId", itemId: item.id, productId: item.productId, productName: name, ruleCode: "SUPPLIER_REQUIRED", currentValue: relation?.supplierId || null, requiredValue: "啟用中的商品供應商設定", message: `${name}：商品與供應商設定必須有效` });
    if (qty <= 0) blockingItems.push({ field: "requestedQty", itemId: item.id, productId: item.productId, productName: name, ruleCode: "QUANTITY_POSITIVE", currentValue: qty, requiredValue: "> 0", message: `${name}：需求數量必須大於 0` });
    if (!condition.eligible) blockingItems.push({ field: "storeOrderCondition", itemId: item.id, productId: item.productId, productName: name, ruleCode: "STORE_MINIMUM_CONDITION", currentValue: { quantity: qty, amount }, requiredValue: { minimumQty: condition.minimumQty, minimumAmount: condition.minimumAmount, mode: condition.mode }, message: `${name}：未符合門市最低需求條件` });
    if (!text(item.reason) && !text(item.notes) && !text(demand?.notes)) blockingItems.push({ field: "reason", itemId: item.id, productId: item.productId, productName: name, ruleCode: "REASON_REQUIRED", message: `${name}：需求原因或備註為必填` });
  });
  if (input.requireReason && !text(demand?.notes) && items.every((item) => !text(item.reason) && !text(item.notes))) blockingItems.push({ field: "notes", ruleCode: "REASON_REQUIRED", message: "此流程需要填寫需求原因或備註" });
  return structuredResult({ workflowType: "DEMAND_ORDER", entityId: demand?.id, entityLocationId: locationId, currentStatus: demand?.status, attemptedAction: input.attemptedAction || "SUBMIT", blockingItems, message: blockingItems.length ? "需求單無法進入下一階段，請先處理阻擋項目" : "需求單檢核通過", suggestedAction: "補齊商品、數量、供應商與門市條件後重新送出", responsibleRole: "STORE" });
}

export function validatePurchaseOrderGate(state, order, input = {}) {
  const blockingItems = [];
  const base = input.attemptedAction === "MARK_ORDERED"
    ? { errors: order?.status === "PENDING_CONFIRMATION" ? [] : ["只有待確認採購單可以標記已下單"] }
    : validatePurchaseOrderConfirmation(order, { suppliers: state.suppliers || [], products: state.products || [], supplierProducts: state.supplierProducts || [], existingSuggestionIds: input.existingSuggestionIds || [] });
  base.errors.forEach((message) => blockingItems.push({ field: "purchaseOrder", itemId: order?.id, ruleCode: ruleCodeForError(message), message }));
  const ordering = (state.suppliers || []).find((supplier) => supplier.id === (order?.orderingSupplierId || order?.supplierId));
  const payee = (state.suppliers || []).find((supplier) => supplier.id === (order?.payeeSupplierId || order?.supplierId));
  if (!ordering || ordering.isActive === false) blockingItems.push({ field: "orderingSupplierId", ruleCode: "ORDERING_SUPPLIER_ACTIVE", currentValue: order?.orderingSupplierId || order?.supplierId, requiredValue: "啟用中的訂購供應商", message: "訂購供應商必須存在且啟用" });
  if (!payee || payee.isActive === false) blockingItems.push({ field: "payeeSupplierId", ruleCode: "PAYEE_SUPPLIER_ACTIVE", currentValue: order?.payeeSupplierId || null, requiredValue: "啟用中的付款供應商", message: "付款供應商必須存在且啟用" });
  const plans = (state.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderId === order?.id);
  const delivery = validatePurchaseDeliveryConfiguration(order, plans, { locations: state.locations || [] });
  delivery.blockingItems.forEach((item) => blockingItems.push(item));
  (order?.lines || []).forEach((line) => {
    const suggestion = (state.purchaseSuggestions || []).find((candidate) => candidate.id === (line.sourceSuggestionId || line.suggestionId));
    if (suggestion?.status === "NO_GROUP") blockingItems.push({ field: "sourceSuggestionId", itemId: line.id, productId: line.productId, ruleCode: "NO_GROUP_SUGGESTION", currentValue: "NO_GROUP", requiredValue: "重新開啟採購建議或移除明細", message: "此採購建議已標記無成團，不可直接確認" });
    if (!String(line.unitPrice ?? line.purchasePrice ?? "").trim()) blockingItems.push({ field: "unitPrice", itemId: line.id, productId: line.productId, ruleCode: "PRICE_REQUIRED", message: "採購單價為必填" });
  });
  return structuredResult({ workflowType: "PURCHASE_ORDER", entityId: order?.id, currentStatus: order?.status, attemptedAction: input.attemptedAction || "CONFIRM", blockingItems, message: blockingItems.length ? "採購單無法進入下一階段，請先處理阻擋項目" : "採購單檢核通過", suggestedAction: "補齊供應商、配送方式、目的地與採購條件後重新確認", responsibleRole: "PURCHASING" });
}

function eventKey(event) {
  return [event.entityId || event.entity_id, event.attemptedAction || event.attempted_action, event.blockingCode || event.blocking_code, event.productId || event.product_id || ""].join("|");
}

export function recordWorkflowBlockEvents(sourceState, validation, input = {}) {
  const state = clone(sourceState || {});
  ensureArray(state, "workflowBlockEvents");
  ensureArray(state, "workflowNotifications");
  const createdAt = at(input);
  const responsibleRole = input.responsibleRole || validation.responsible_role || validation.responsibleRole || null;
  for (const item of validation.blocking_items || validation.blockingItems || []) {
    const event = {
      id: makeId(input, "workflowBlock"), workflowType: validation.workflow_type || validation.workflowType,
      entityType: input.entityType || (validation.workflow_type === "DEMAND_ORDER" ? "DEMAND" : "PURCHASE_ORDER"),
      entityId: validation.entity_id || validation.entityId, attemptedAction: validation.attempted_action || validation.attemptedAction,
      currentStatus: validation.current_status || validation.currentStatus, blockingCode: item.rule_code || item.ruleCode,
      blockingSummary: item.message, blockingDetails: clone(item), productId: item.product_id || item.productId || null,
      entityLocationId: validation.entity_location_id || validation.entityLocationId || input.entityLocationId || null,
      responsibleRole, isResolved: false, resolvedAt: null, resolvedBy: null, createdBy: input.actorId || input.actor?.id || null, createdAt,
    };
    if (!state.workflowBlockEvents.some((candidate) => !candidate.isResolved && eventKey(candidate) === eventKey(event))) {
      state.workflowBlockEvents.unshift(event);
      if (!state.workflowNotifications.some((notification) => !notification.isRead && notification.workflowBlockEventId === event.id)) state.workflowNotifications.unshift({ id: makeId(input, "workflowNotification"), workflowBlockEventId: event.id, recipientRole: responsibleRole, entityId: event.entityId, message: validation.message, isRead: false, createdAt });
    }
  }
  return { committed: true, state, events: state.workflowBlockEvents.filter((event) => event.entityId === validation.entity_id || event.entityId === validation.entityId) };
}

export function resolveWorkflowBlockEvents(sourceState, input = {}) {
  const state = clone(sourceState || {});
  ensureArray(state, "workflowBlockEvents");
  ensureArray(state, "workflowNotifications");
  const entityId = input.entityId || input.entity_id;
  const attemptedAction = input.attemptedAction || input.attempted_action;
  const blockingCode = input.blockingCode || input.blocking_code;
  let resolved = 0;
  state.workflowBlockEvents.forEach((event) => {
    if (event.isResolved || (entityId && event.entityId !== entityId) || (attemptedAction && event.attemptedAction !== attemptedAction) || (blockingCode && event.blockingCode !== blockingCode)) return;
    event.isResolved = true; event.resolvedAt = at(input); event.resolvedBy = input.actorId || input.actor?.id || null; resolved += 1;
  });
  state.workflowNotifications.filter((notification) => notification.entityId === entityId && !notification.isRead).forEach((notification) => { notification.isRead = true; notification.readAt = at(input); });
  return { committed: true, state, resolved };
}

export function getWorkflowBlockEventsForRole(state, user = {}, options = {}) {
  const events = ensureArray(state, "workflowBlockEvents").filter((event) => !options.unresolvedOnly || !event.isResolved);
  if (user.role === "ADMIN") return events;
  if (user.role === "STORE") return events.filter((event) => event.entityLocationId && event.entityLocationId === user.locationId);
  return events.filter((event) => event.responsibleRole === user.role || (user.role === "STORE" && event.entityLocationId === user.locationId));
}
