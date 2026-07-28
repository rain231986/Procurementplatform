/*
 * Purchase receiving and store fulfilment boundary.
 *
 * The browser demo persists a single JSON document, therefore each exported
 * mutation clones the document and returns a committed state.  The same
 * boundary maps cleanly to a database transaction: inventory, movement,
 * receipt and demand progress are changed together or not at all.
 */

export const DELIVERY_MODES = Object.freeze([
  "SUPPLIER_DIRECT_TO_STORE",
  "WAREHOUSE_DISTRIBUTION",
]);

export const RECEIVING_STATUSES = Object.freeze([
  "WAITING_SUPPLIER_SHIPMENT",
  "WAITING_WAREHOUSE_RECEIPT",
  "WAITING_STORE_DIRECT_RECEIPT",
  "WAREHOUSE_RECEIVED",
  "WAITING_WAREHOUSE_ALLOCATION",
  "WAREHOUSE_SHIPPED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "SHORT_RECEIVED",
  "REJECTED",
  "CANCELLED",
]);

export const INVENTORY_MOVEMENT_TYPES = Object.freeze({
  PURCHASE_RECEIPT_WAREHOUSE: "PURCHASE_RECEIPT_WAREHOUSE",
  SUPPLIER_DIRECT_RECEIPT_STORE: "SUPPLIER_DIRECT_RECEIPT_STORE",
  WAREHOUSE_SHIPMENT_TO_STORE: "WAREHOUSE_SHIPMENT_TO_STORE",
  STORE_RECEIPT_FROM_WAREHOUSE: "STORE_RECEIPT_FROM_WAREHOUSE",
});

export const RECEIVING_ROLES = Object.freeze({
  supplierDirectReceipt: ["ADMIN", "STORE"],
  warehouseReceipt: ["ADMIN", "WAREHOUSE"],
  warehouseShipment: ["ADMIN", "WAREHOUSE"],
  warehouseStoreReceipt: ["ADMIN", "STORE"],
  plan: ["ADMIN", "PURCHASING"],
});

const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const quantity = (value) => Math.max(0, Math.floor(Number(value) || 0));
const text = (value) => String(value ?? "").trim();
const timestamp = (input = {}) => input.receivedAt || input.shippedAt || input.signedAt || input.changedAt || input.createdAt || new Date().toISOString();
const actor = (input = {}) => input.actor || { id: input.actorId || null, role: input.actorRole || input.role || null, locationId: input.locationId || null, isActive: input.isActive !== false };
const makeId = (input, prefix) => input.createId ? input.createId(prefix) : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function requireRole(user, roles, message) {
  if (!user || user.isActive === false || !roles.includes(user.role)) throw new Error(`${message}，需要 ${roles.join(" 或 ")}`);
}

function ensureArray(state, name) {
  state[name] = Array.isArray(state[name]) ? state[name] : [];
  return state[name];
}

function addAudit(state, input, action, entityType, entityId, detail) {
  ensureArray(state, "auditLogs").unshift({
    id: makeId(input, "audit"), action, entityType, entityId,
    userId: actor(input).id || null, userRole: actor(input).role || null,
    detail: text(detail) || action, createdAt: timestamp(input),
  });
}

function addMovement(state, input, movementType, row) {
  const movements = ensureArray(state, "inventoryMovements");
  const operationId = text(row.operationId || input.operationId) || makeId(input, "receiving-op");
  if (movements.some((item) => item.operationId === operationId && item.movementType === movementType && item.productId === row.productId)) return null;
  const movement = {
    id: makeId(input, "movement"), movementType, operationId,
    referenceType: row.referenceType || "PURCHASE_ORDER",
    referenceId: row.referenceId || null, purchaseOrderId: row.purchaseOrderId || null,
    purchaseOrderItemId: row.purchaseOrderItemId || null, allocationId: row.allocationId || null,
    productId: row.productId, quantity: quantity(row.quantity),
    fromLocationId: row.fromLocationId || null, toLocationId: row.toLocationId || null,
    locationId: row.locationId || row.toLocationId || row.fromLocationId || null,
    batchNumber: text(row.batchNumber) || null, expiryDate: text(row.expiryDate) || null,
    createdBy: actor(input).id || null, createdAt: timestamp(input), note: text(row.note || input.note),
  };
  movements.unshift(movement);
  return movement;
}

function getBalance(state, locationId, productId) {
  const inventory = ensureArray(state, "inventory");
  let balance = inventory.find((item) => item.locationId === locationId && item.productId === productId);
  if (!balance) {
    balance = { id: makeId({}, "balance"), locationId, productId, onHandQty: 0, reservedQty: 0, updatedAt: timestamp({}) };
    inventory.push(balance);
  }
  balance.onHandQty = quantity(balance.onHandQty);
  return balance;
}

function findOrder(state, orderId) {
  return ensureArray(state, "purchaseOrders").find((item) => item.id === orderId);
}

function findLine(state, itemId, orderId = null) {
  const order = orderId ? findOrder(state, orderId) : ensureArray(state, "purchaseOrders").find((candidate) => candidate.lines?.some((line) => line.id === itemId));
  return { order, line: order?.lines?.find((line) => line.id === itemId) };
}

function demandItem(state, demandOrderId, demandOrderItemId, productId, locationId) {
  const demand = ensureArray(state, "demands").find((item) => item.id === demandOrderId && (!locationId || item.locationId === locationId));
  const item = demand?.items?.find((candidate) => candidate.id === demandOrderItemId || (!demandOrderItemId && candidate.productId === productId));
  return { demand, item };
}

function normalizePlan(plan, order, line) {
  plan.purchaseOrderId ||= order?.id || null;
  plan.purchaseOrderItemId ||= line?.id || null;
  plan.destinationLocationId ||= plan.locationId || plan.destination_location_id || null;
  plan.locationId ||= plan.destinationLocationId;
  plan.warehouseReceiptLocationId ||= plan.receiptLocationId || plan.warehouse_receipt_location_id || "warehouse";
  plan.deliveryMode = DELIVERY_MODES.includes(plan.deliveryMode) ? plan.deliveryMode : (line?.deliveryMode || "WAREHOUSE_DISTRIBUTION");
  plan.plannedDeliveryQty = quantity(plan.plannedDeliveryQty ?? plan.plannedDistributionQty ?? plan.confirmedAllocationQty ?? plan.suggestedDistributionQty);
  plan.suggestedDeliveryQty = quantity(plan.suggestedDeliveryQty ?? plan.suggestedDistributionQty ?? plan.suggestedAllocationQty);
  plan.expectedDeliveryDate ||= line?.expectedDeliveryDate || order?.expectedDeliveryDate || null;
  plan.actualAllocatedQty = quantity(plan.actualAllocatedQty);
  plan.shippedQty = quantity(plan.shippedQty ?? plan.actualAllocatedQty);
  plan.warehouseReceivedQty = quantity(plan.warehouseReceivedQty);
  plan.actualReceivedQty = quantity(plan.actualReceivedQty ?? plan.actual_received_qty);
  plan.signedQty = quantity(plan.signedQty ?? plan.actualReceivedQty);
  plan.signedBy ||= null;
  plan.signedAt ||= null;
  plan.shortReceivedQty = quantity(plan.shortReceivedQty);
  plan.rejectedQty = quantity(plan.rejectedQty);
  plan.exceptionReason ||= null;
  plan.batchNumber ||= null;
  plan.expiryDate ||= null;
  plan.signedNote ||= plan.note || "";
  const source = (line?.sourceAllocations || []).find((candidate) => candidate.locationId === plan.destinationLocationId && quantity(candidate.allocatedQty) > 0);
  plan.demandOrderId ||= plan.sourceDemandId || source?.demandOrderId || null;
  plan.demandOrderItemId ||= plan.sourceDemandItemId || source?.demandOrderItemId || null;
  if (plan.status === "PLANNED" || !RECEIVING_STATUSES.includes(plan.status)) {
    plan.status = plan.deliveryMode === "SUPPLIER_DIRECT_TO_STORE" ? "WAITING_STORE_DIRECT_RECEIPT" : "WAITING_WAREHOUSE_RECEIPT";
  }
  if (plan.deliveryMode === "WAREHOUSE_DISTRIBUTION" && plan.warehouseReceivedQty >= plan.plannedDeliveryQty && plan.plannedDeliveryQty > 0 && plan.actualReceivedQty < plan.plannedDeliveryQty) {
    plan.status = plan.shippedQty > 0 ? "WAREHOUSE_SHIPPED" : "WAITING_WAREHOUSE_ALLOCATION";
  }
  if (plan.signedQty >= plan.plannedDeliveryQty && plan.plannedDeliveryQty > 0) plan.status = "RECEIVED";
  return plan;
}

export function normalizeReceivingWorkflow(state) {
  ["purchaseOrderItemStoreAllocations", "purchaseOrderItemDistributionPlans", "purchaseReceiptLogs", "warehouseShipmentLogs", "storeReceiptLogs", "supplierDirectReceiptLogs", "inventoryMovements", "auditLogs", "demandPurchaseAllocations"].forEach((name) => ensureArray(state, name));
  ensureArray(state, "purchaseOrders").forEach((order) => {
    order.lines = Array.isArray(order.lines) ? order.lines : [];
    order.lines.forEach((line) => {
      line.deliveryMode = DELIVERY_MODES.includes(line.deliveryMode) ? line.deliveryMode : "WAREHOUSE_DISTRIBUTION";
      line.warehouseReceivedQty = quantity(line.warehouseReceivedQty);
      line.directReceivedQty = quantity(line.directReceivedQty);
      line.receivedQty = quantity(line.receivedQty);
      line.cancelledQty = quantity(line.cancelledQty);
      line.remainingQty = Math.max(0, quantity(line.orderedQty) - line.receivedQty - line.cancelledQty);
    });
  });
  const plans = state.purchaseOrderItemStoreAllocations;
  plans.forEach((plan) => {
    const { order, line } = findLine(state, plan.purchaseOrderItemId, plan.purchaseOrderId);
    normalizePlan(plan, order, line);
  });
  state.purchaseOrderItemDistributionPlans = plans;
  return state;
}

function transact(sourceState, input, callback) {
  const state = clone(sourceState || {});
  normalizeReceivingWorkflow(state);
  try {
    const result = callback(state, actor(input));
    return { committed: true, state, ...result };
  } catch (error) {
    return { committed: false, state: sourceState, error: error instanceof Error ? error : new Error(String(error)), errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function planRows(state, lineId, mode = null) {
  return ensureArray(state, "purchaseOrderItemStoreAllocations").filter((plan) => plan.purchaseOrderItemId === lineId && (!mode || plan.deliveryMode === mode));
}

function lineReceivedQty(line) {
  return quantity(line.receivedQty ?? quantity(line.warehouseReceivedQty) + quantity(line.directReceivedQty));
}

function refreshOrderStatus(order) {
  const lines = order?.lines || [];
  const complete = lines.length > 0 && lines.every((line) => lineReceivedQty(line) + quantity(line.cancelledQty) >= quantity(line.orderedQty));
  const received = lines.some((line) => lineReceivedQty(line) > 0);
  order.status = complete ? "RECEIVED" : received ? "PARTIALLY_RECEIVED" : order.status;
  order.actualFirstReceivedDate ||= received ? order.lastReceivedAt || null : null;
  if (complete) order.actualCompletedDate ||= order.lastReceivedAt || null;
  return order;
}

function updateDemandProgress(state, demandOrderId, demandOrderItemId, receivedQty, input, { purchase = false } = {}) {
  const { demand, item } = demandItem(state, demandOrderId, demandOrderItemId);
  if (!item) return;
  if (purchase) item.purchaseReceivedQty = quantity(item.purchaseReceivedQty) + quantity(receivedQty);
  else item.receivedQty = quantity(item.receivedQty) + quantity(receivedQty);
  item.purchaseOpenQty = Math.max(0, quantity(item.requestedQty ?? item.approvedQty) - quantity(item.allocatedQty) - quantity(item.receivedQty) - quantity(item.purchaseReceivedQty));
  if (demand && item.purchaseOpenQty <= 0 && quantity(item.receivedQty) >= quantity(item.requestedQty ?? item.approvedQty)) demand.status = "COMPLETED";
  else if (demand && quantity(item.receivedQty) > 0) demand.status = "PARTIALLY_ALLOCATED";
  if (demand) { demand.updatedAt = timestamp(input); }
}

function allocatePurchaseReceiptToDemand(state, line, receivedQty, input) {
  let remaining = quantity(receivedQty);
  const rows = ensureArray(state, "demandPurchaseAllocations").filter((row) => row.purchaseOrderItemId === line.id);
  for (const row of rows) {
    const open = Math.max(0, quantity(row.allocatedQty) - quantity(row.receivedAllocatedQty) - quantity(row.cancelledAllocatedQty));
    const take = Math.min(open, remaining);
    if (!take) continue;
    row.receivedAllocatedQty = quantity(row.receivedAllocatedQty) + take;
    row.receivedQty = quantity(row.receivedQty) + take;
    row.updatedAt = timestamp(input);
    updateDemandProgress(state, row.demandOrderId, row.demandOrderItemId, take, input, { purchase: true });
    remaining -= take;
    if (!remaining) break;
  }
  return quantity(receivedQty) - remaining;
}

function normalizeException(input, key) {
  return text(input[`${key}Reason`] || input.exceptionReason || input.receiveNotes || input.note);
}

function validateTrackedProduct(state, productId, input, key = "") {
  const product = ensureArray(state, "products").find((item) => item.id === productId);
  const batch = text(input[`batch_${key}`] || input.batchNumber);
  const expiry = text(input[`expiry_${key}`] || input.expiryDate);
  if (product?.batchTrackingEnabled && !batch) throw new Error(`${product.name || productId}：此商品需要批號`);
  if (product?.expiryTrackingEnabled && !expiry) throw new Error(`${product.name || productId}：此商品需要效期`);
  return { batchNumber: batch || null, expiryDate: expiry || null };
}

function validateShortOrReject(requested, pending, input, key) {
  if (requested >= pending) return;
  const markedShort = input.shortReceived === true || input.shortReceived === "true" || input.isShort === true || input.isShort === "true";
  const rejected = input.rejected === true || input.rejected === "true";
  if (!markedShort && !rejected) return;
  if (!normalizeException(input, key)) throw new Error("短收或拒收必須填寫差異原因");
}

function updatePlanAfterReceipt(plan, signedQty, input, { rejected = 0, shortage = 0 } = {}) {
  plan.actualReceivedQty = quantity(plan.actualReceivedQty) + quantity(signedQty);
  plan.signedQty = quantity(plan.signedQty) + quantity(signedQty);
  plan.shortReceivedQty = quantity(plan.shortReceivedQty) + quantity(shortage);
  plan.rejectedQty = quantity(plan.rejectedQty) + quantity(rejected);
  plan.signedBy = actor(input).id || null;
  plan.signedAt = timestamp(input);
  plan.exceptionReason = normalizeException(input, plan.id);
  plan.signedNote = text(input.note || input.receiveNotes);
  if (plan.signedQty >= plan.plannedDeliveryQty && plan.plannedDeliveryQty > 0) plan.status = "RECEIVED";
  else if (rejected && plan.signedQty === 0) plan.status = "REJECTED";
  else if (shortage || rejected) plan.status = "SHORT_RECEIVED";
  else plan.status = "PARTIALLY_RECEIVED";
}

function updateAllocationStatus(allocation) {
  const items = allocation?.items || [];
  const shipped = items.reduce((sum, item) => sum + quantity(item.shippedQty), 0);
  const received = items.reduce((sum, item) => sum + quantity(item.receivedQty), 0);
  const planned = items.reduce((sum, item) => sum + quantity(item.allocatedQty), 0);
  if (received >= planned && planned > 0) allocation.status = "RECEIVED";
  else if (received > 0) allocation.status = "PARTIALLY_RECEIVED";
  else if (shipped >= planned && planned > 0) allocation.status = "SHIPPED";
  else if (shipped > 0) allocation.status = "PARTIALLY_SHIPPED";
  return allocation;
}

export function validatePurchaseDeliveryConfiguration(order, plans = [], input = {}) {
  const blockingItems = [];
  const rows = plans.length ? plans : [];
  const lineMap = new Map((order?.lines || []).map((line) => [line.id, line]));
  if (!order || !order.lines?.length) blockingItems.push({ field: "lines", ruleCode: "PURCHASE_LINES_REQUIRED", message: "採購單至少需要一項商品" });
  for (const line of order?.lines || []) {
    const linePlans = rows.filter((plan) => plan.purchaseOrderItemId === line.id);
    if (!linePlans.length) {
      blockingItems.push({ field: "deliveryMode", itemId: line.id, productId: line.productId, ruleCode: "DELIVERY_MODE_REQUIRED", message: "必須指定配送方式與目的地" });
      continue;
    }
    const plannedTotal = linePlans.reduce((sum, plan) => sum + quantity(plan.plannedDeliveryQty), 0);
    if (plannedTotal > quantity(line.orderedQty)) blockingItems.push({ field: "plannedDeliveryQty", itemId: line.id, productId: line.productId, ruleCode: "DELIVERY_QTY_EXCEEDS_PURCHASE", currentValue: plannedTotal, requiredValue: line.orderedQty, message: "門市預計配送量不可超過採購量" });
    for (const plan of linePlans) {
      if (!DELIVERY_MODES.includes(plan.deliveryMode)) blockingItems.push({ field: "deliveryMode", itemId: plan.id, productId: line.productId, ruleCode: "DELIVERY_MODE_REQUIRED", currentValue: plan.deliveryMode, requiredValue: DELIVERY_MODES.join(" / "), message: "必須指定廠商直送門市或總倉配貨" });
      if (!plan.destinationLocationId) blockingItems.push({ field: "destinationLocationId", itemId: plan.id, productId: line.productId, ruleCode: "DESTINATION_REQUIRED", message: "必須指定收貨門市" });
      const destination = (input.locations || []).find((location) => location.id === plan.destinationLocationId);
      if (plan.deliveryMode === "SUPPLIER_DIRECT_TO_STORE" && destination && destination.type !== "STORE") blockingItems.push({ field: "destinationLocationId", itemId: plan.id, productId: line.productId, ruleCode: "DIRECT_DESTINATION_MUST_STORE", currentValue: plan.destinationLocationId, requiredValue: "STORE", message: "廠商直送的目的地必須是門市" });
      if (plan.deliveryMode === "WAREHOUSE_DISTRIBUTION" && destination && destination.type !== "STORE") blockingItems.push({ field: "destinationLocationId", itemId: plan.id, productId: line.productId, ruleCode: "WAREHOUSE_DISTRIBUTION_DESTINATION_REQUIRED", currentValue: plan.destinationLocationId, requiredValue: "STORE", message: "總倉配貨仍需指定門市配貨目的地" });
      if (plan.deliveryMode === "WAREHOUSE_DISTRIBUTION" && !plan.warehouseReceiptLocationId) blockingItems.push({ field: "warehouseReceiptLocationId", itemId: plan.id, productId: line.productId, ruleCode: "WAREHOUSE_RECEIPT_LOCATION_REQUIRED", message: "總倉配貨必須指定總倉收貨地點" });
      const warehouseReceiptLocation = (input.locations || []).find((location) => location.id === plan.warehouseReceiptLocationId);
      if (plan.deliveryMode === "WAREHOUSE_DISTRIBUTION" && warehouseReceiptLocation && warehouseReceiptLocation.type !== "WAREHOUSE") blockingItems.push({ field: "warehouseReceiptLocationId", itemId: plan.id, productId: line.productId, ruleCode: "WAREHOUSE_RECEIPT_LOCATION_MUST_WAREHOUSE", currentValue: plan.warehouseReceiptLocationId, requiredValue: "WAREHOUSE", message: "總倉收貨地點必須是總倉" });
      const expected = plan.expectedDeliveryDate || line.expectedDeliveryDate || order.expectedDeliveryDate;
      if (!expected) blockingItems.push({ field: "expectedDeliveryDate", itemId: plan.id, productId: line.productId, ruleCode: "EXPECTED_DATE_REQUIRED", message: "必須填寫預計到貨日" });
      if (expected && order.orderDate && expected < order.orderDate) blockingItems.push({ field: "expectedDeliveryDate", itemId: plan.id, productId: line.productId, ruleCode: "EXPECTED_DATE_INVALID", currentValue: expected, requiredValue: `不得早於 ${order.orderDate}`, message: "預計到貨日不得早於採購日期" });
    }
  }
  return { valid: blockingItems.length === 0, blockingItems, orderId: order?.id || null, lineMap };
}

export function updatePurchaseDeliveryPlans(sourceState, input = {}) {
  return transact(sourceState, input, (state, user) => {
    requireRole(user, RECEIVING_ROLES.plan, "只有採購人員或管理員可以設定配送方式");
    const order = findOrder(state, input.orderId);
    if (!order || !["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) throw new Error("只有草稿或待確認採購單可以設定配送方式");
    const requestedPlans = Array.isArray(input.plans) ? input.plans : [];
    const plans = ensureArray(state, "purchaseOrderItemStoreAllocations");
    for (const line of order.lines || []) {
      const linePlans = requestedPlans.filter((candidate) => candidate.purchaseOrderItemId === line.id);
      if (linePlans.length) {
        for (let index = plans.length - 1; index >= 0; index -= 1) if (plans[index].purchaseOrderItemId === line.id) plans.splice(index, 1);
        for (const candidate of linePlans) plans.push(normalizePlan({ ...candidate, purchaseOrderId: order.id }, order, line));
      }
      const modes = linePlans.map((candidate) => candidate.deliveryMode).filter(Boolean);
      if (modes.length) line.deliveryMode = modes[0];
    }
    const validation = validatePurchaseDeliveryConfiguration(order, plans.filter((plan) => plan.purchaseOrderId === order.id), { locations: state.locations || [] });
    if (!validation.valid) throw new Error(validation.blockingItems.map((item) => item.message).join("；"));
    addAudit(state, input, "PURCHASE_DELIVERY_PLANS_UPDATED", "PURCHASE_ORDER", order.id, "採購配送方式與門市目的地已更新");
    return { order, plans: plans.filter((plan) => plan.purchaseOrderId === order.id) };
  });
}

export function receiveWarehousePurchase(sourceState, input = {}) {
  return transact(sourceState, input, (state, user) => {
    requireRole(user, RECEIVING_ROLES.warehouseReceipt, "只有總倉或管理員可以登記總倉收貨");
    const existingReceipt = ensureArray(state, "purchaseReceiptLogs").find((log) => input.operationId && log.operationId === input.operationId);
    if (existingReceipt) return { order: findOrder(state, input.orderId), totalReceived: 0, idempotent: true };
    const order = findOrder(state, input.orderId);
    if (!order || !["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("此採購單目前不可登記總倉收貨");
    const receivedByLine = input.receivedByLine || {};
    let totalReceived = 0;
    for (const line of order.lines || []) {
      const requested = quantity(receivedByLine[line.id]);
      if (!requested) continue;
      const linePlans = planRows(state, line.id, "WAREHOUSE_DISTRIBUTION");
      const allPlans = planRows(state, line.id);
      if (!linePlans.length && allPlans.some((plan) => plan.deliveryMode === "SUPPLIER_DIRECT_TO_STORE")) throw new Error(`${line.productId}：此品項設定為廠商直送，不得登記總倉收貨`);
      const planned = linePlans.length ? linePlans.reduce((sum, plan) => sum + Math.max(0, plan.plannedDeliveryQty - plan.warehouseReceivedQty), 0) : Math.max(0, quantity(line.orderedQty) - lineReceivedQty(line) - quantity(line.cancelledQty));
      const pendingLine = Math.max(0, quantity(line.orderedQty) - lineReceivedQty(line) - quantity(line.cancelledQty));
      if (requested > Math.min(planned, pendingLine)) throw new Error(`${line.productId}：總倉收貨數量不得超過此配送方式的未收數量`);
      const tracking = validateTrackedProduct(state, line.productId, input, line.id);
      const balance = getBalance(state, "warehouse", line.productId);
      balance.onHandQty += requested; balance.updatedAt = timestamp(input);
      line.warehouseReceivedQty += requested; line.receivedQty = lineReceivedQty(line) + requested; line.remainingQty = Math.max(0, quantity(line.orderedQty) - line.receivedQty - quantity(line.cancelledQty));
      let remaining = requested;
      for (const plan of linePlans) {
        const take = Math.min(remaining, Math.max(0, plan.plannedDeliveryQty - plan.warehouseReceivedQty));
        if (!take) continue;
        plan.warehouseReceivedQty += take;
        plan.batchNumber = tracking.batchNumber;
        plan.expiryDate = tracking.expiryDate;
        plan.status = plan.warehouseReceivedQty >= plan.plannedDeliveryQty ? "WAREHOUSE_RECEIVED" : "PARTIALLY_RECEIVED";
        remaining -= take;
      }
      addMovement(state, input, INVENTORY_MOVEMENT_TYPES.PURCHASE_RECEIPT_WAREHOUSE, { operationId: input.operationId || `${order.id}:${line.id}:${timestamp(input)}`, purchaseOrderId: order.id, purchaseOrderItemId: line.id, productId: line.productId, quantity: requested, toLocationId: "warehouse", batchNumber: tracking.batchNumber, expiryDate: tracking.expiryDate, note: input.note });
      allocatePurchaseReceiptToDemand(state, line, requested, input);
      totalReceived += requested;
    }
    if (!totalReceived) throw new Error("本次至少需要登記一項總倉到貨數量");
    order.lastReceivedAt = timestamp(input); order.lastReceiptNote = text(input.note); order.updatedAt = timestamp(input); refreshOrderStatus(order);
    ensureArray(state, "purchaseReceiptLogs").unshift({ id: makeId(input, "purchaseReceipt"), purchaseOrderId: order.id, receiptType: "PURCHASE_RECEIPT_WAREHOUSE", movementType: INVENTORY_MOVEMENT_TYPES.PURCHASE_RECEIPT_WAREHOUSE, operationId: input.operationId || null, receivedAt: timestamp(input), receivedBy: user.id || null, note: text(input.note), lines: receivedByLine });
    addAudit(state, input, order.status === "RECEIVED" ? "PURCHASE_RECEIVED_WAREHOUSE" : "PURCHASE_PARTIALLY_RECEIVED_WAREHOUSE", "PURCHASE_ORDER", order.id, `總倉收貨 ${totalReceived} 件`);
    return { order, totalReceived };
  });
}

export function shipWarehouseAllocation(sourceState, input = {}) {
  return transact(sourceState, input, (state, user) => {
    requireRole(user, RECEIVING_ROLES.warehouseShipment, "只有總倉或管理員可以執行總倉出貨");
    const existingShipment = ensureArray(state, "warehouseShipmentLogs").find((log) => input.operationId && log.operationId === input.operationId);
    if (existingShipment) return { allocation: ensureArray(state, "allocations").find((item) => item.id === input.allocationId), totalShipped: 0, idempotent: true };
    const allocation = ensureArray(state, "allocations").find((item) => item.id === input.allocationId);
    if (!allocation || !["PICKING", "PARTIALLY_SHIPPED"].includes(allocation.status)) throw new Error("此配貨單目前不可出貨");
    const shipByLine = input.shipByLine || input.shipQtyByItem || {};
    let total = 0;
    for (const item of allocation.items || []) {
      const planned = quantity(item.allocatedQty);
      const already = quantity(item.shippedQty);
      const requested = quantity(shipByLine[item.id] ?? (item.shippedQty ? 0 : planned));
      if (requested > Math.max(0, planned - already)) throw new Error(`${item.productId}：出貨量不得超過未出貨配貨量`);
      if (!requested) continue;
      const balance = getBalance(state, "warehouse", item.productId);
      if (quantity(balance.onHandQty) - quantity(balance.reservedQty) < requested) throw new Error(`${item.productId}：總倉可用庫存不足，無法出貨`);
      balance.onHandQty -= requested; balance.updatedAt = timestamp(input);
      item.shippedQty = already + requested;
      const { line } = findLine(state, item.purchaseOrderItemId);
      const linePlans = planRows(state, item.purchaseOrderItemId, "WAREHOUSE_DISTRIBUTION").filter((plan) => (plan.destinationLocationId || plan.locationId) === allocation.destinationLocationId);
      let remainingPlanQty = requested;
      for (const plan of linePlans) {
        const take = Math.min(remainingPlanQty, Math.max(0, plan.plannedDeliveryQty - plan.actualAllocatedQty));
        if (!take) continue;
        plan.actualAllocatedQty += take;
        plan.shippedQty = plan.actualAllocatedQty;
        plan.status = plan.actualAllocatedQty >= plan.plannedDeliveryQty ? "WAREHOUSE_SHIPPED" : "WAITING_WAREHOUSE_ALLOCATION";
        remainingPlanQty -= take;
        if (!remainingPlanQty) break;
      }
      const shipmentPlan = linePlans.find((plan) => plan.batchNumber || plan.expiryDate);
      addMovement(state, input, INVENTORY_MOVEMENT_TYPES.WAREHOUSE_SHIPMENT_TO_STORE, { operationId: input.operationId || `${allocation.id}:${item.id}:${already + requested}`, allocationId: allocation.id, purchaseOrderId: line?.purchaseOrderId, purchaseOrderItemId: line?.id || item.purchaseOrderItemId, productId: item.productId, quantity: requested, fromLocationId: "warehouse", toLocationId: allocation.destinationLocationId, batchNumber: shipmentPlan?.batchNumber, expiryDate: shipmentPlan?.expiryDate, note: input.note });
      total += requested;
    }
    if (!total) throw new Error("本次至少需要輸入一項總倉出貨數量");
    allocation.shippedAt = allocation.shippedAt || timestamp(input); updateAllocationStatus(allocation);
    ensureArray(state, "warehouseShipmentLogs").unshift({ id: makeId(input, "warehouseShipment"), allocationId: allocation.id, shippedAt: timestamp(input), shippedBy: user.id || null, operationId: input.operationId || null, note: text(input.note), lines: shipByLine });
    addAudit(state, input, "WAREHOUSE_SHIPMENT_TO_STORE", "ALLOCATION", allocation.id, `總倉出貨 ${total} 件至 ${allocation.destinationLocationId}`);
    return { allocation, totalShipped: total };
  });
}

export function receiveWarehouseDistributionStore(sourceState, input = {}) {
  return transact(sourceState, input, (state, user) => {
    requireRole(user, RECEIVING_ROLES.warehouseStoreReceipt, "只有收貨門市或管理員可以簽收總倉配貨");
    const existingReceipt = ensureArray(state, "storeReceiptLogs").find((log) => input.operationId && log.operationId === input.operationId);
    if (existingReceipt) return { allocation: ensureArray(state, "allocations").find((item) => item.id === input.allocationId), totalReceived: 0, idempotent: true };
    const allocation = ensureArray(state, "allocations").find((item) => item.id === input.allocationId);
    if (!allocation || !["SHIPPED", "PARTIALLY_SHIPPED", "PARTIALLY_RECEIVED"].includes(allocation.status)) throw new Error("此配貨單目前不可簽收");
    if (user.role === "STORE" && allocation.destinationLocationId !== user.locationId) throw new Error("門市只能簽收本門市的配貨單");
    const receivedByLine = input.receivedByLine || {};
    let total = 0;
    for (const item of allocation.items || []) {
      const pending = Math.max(0, quantity(item.shippedQty) - quantity(item.receivedQty));
      const requested = quantity(receivedByLine[item.id]);
      if (requested > pending) throw new Error(`${item.productId}：簽收量不得超過已出貨未簽收數量`);
      if (!requested) continue;
      validateShortOrReject(requested, pending, input, item.id);
      const markedShort = input.shortReceived === true || input.shortReceived === "true" || input.isShort === true || input.isShort === "true";
      const tracking = validateTrackedProduct(state, item.productId, input, item.id);
      const balance = getBalance(state, allocation.destinationLocationId, item.productId);
      balance.onHandQty += requested; balance.updatedAt = timestamp(input);
      item.receivedQty = quantity(item.receivedQty) + requested;
      const demand = ensureArray(state, "demands").find((candidate) => candidate.id === allocation.demandOrderId);
      const demandLine = demand?.items?.find((candidate) => candidate.productId === item.productId);
      if (demandLine) demandLine.receivedQty = quantity(demandLine.receivedQty) + requested;
      let remainingPlanQty = requested;
      for (const plan of planRows(state, item.purchaseOrderItemId, "WAREHOUSE_DISTRIBUTION").filter((candidate) => (candidate.destinationLocationId || candidate.locationId) === allocation.destinationLocationId)) {
        if (!remainingPlanQty) break;
        const pendingPlan = Math.max(0, plan.shippedQty - plan.actualReceivedQty);
        const take = Math.min(remainingPlanQty, pendingPlan);
        if (take) updatePlanAfterReceipt(plan, take, input, { shortage: markedShort ? Math.max(0, pendingPlan - take) : 0 });
        remainingPlanQty -= take;
      }
      addMovement(state, input, INVENTORY_MOVEMENT_TYPES.STORE_RECEIPT_FROM_WAREHOUSE, { operationId: input.operationId || `${allocation.id}:${item.id}:${item.receivedQty}`, allocationId: allocation.id, purchaseOrderItemId: item.purchaseOrderItemId, productId: item.productId, quantity: requested, fromLocationId: "warehouse", toLocationId: allocation.destinationLocationId, batchNumber: tracking.batchNumber, expiryDate: tracking.expiryDate, note: input.note });
      total += requested;
    }
    if (!total) throw new Error("本次至少需要輸入一項門市簽收數量");
    allocation.receivedAt = timestamp(input); updateAllocationStatus(allocation);
    ensureArray(state, "storeReceiptLogs").unshift({ id: makeId(input, "storeReceipt"), allocationId: allocation.id, locationId: allocation.destinationLocationId, signedAt: timestamp(input), signedBy: user.id || null, movementType: INVENTORY_MOVEMENT_TYPES.STORE_RECEIPT_FROM_WAREHOUSE, operationId: input.operationId || null, note: text(input.note), lines: receivedByLine });
    const demand = ensureArray(state, "demands").find((candidate) => candidate.id === allocation.demandOrderId);
    if (demand) {
      const complete = (demand.items || []).every((item) => quantity(item.receivedQty) >= quantity(item.requestedQty ?? item.approvedQty));
      if (complete) demand.status = "COMPLETED"; else if (demand.items.some((item) => quantity(item.receivedQty) > 0)) demand.status = "PARTIALLY_ALLOCATED";
    }
    addAudit(state, input, "STORE_RECEIPT_FROM_WAREHOUSE", "ALLOCATION", allocation.id, `門市簽收 ${total} 件`);
    return { allocation, totalReceived: total };
  });
}

export function receiveSupplierDirectStore(sourceState, input = {}) {
  return transact(sourceState, input, (state, user) => {
    requireRole(user, RECEIVING_ROLES.supplierDirectReceipt, "只有收貨門市或管理員可以簽收廠商直送");
    const existingReceipt = ensureArray(state, "supplierDirectReceiptLogs").find((log) => input.operationId && log.operationId === input.operationId);
    if (existingReceipt) return { order: findOrder(state, existingReceipt.purchaseOrderId), plan: ensureArray(state, "purchaseOrderItemStoreAllocations").find((candidate) => candidate.id === existingReceipt.planId), totalReceived: 0, idempotent: true };
    const plans = ensureArray(state, "purchaseOrderItemStoreAllocations");
    const plan = plans.find((candidate) => (input.planId && candidate.id === input.planId) || (!input.planId && candidate.purchaseOrderItemId === input.purchaseOrderItemId && candidate.deliveryMode === "SUPPLIER_DIRECT_TO_STORE" && (!input.destinationLocationId || candidate.destinationLocationId === input.destinationLocationId)));
    if (!plan || plan.deliveryMode !== "SUPPLIER_DIRECT_TO_STORE") throw new Error("找不到廠商直送門市配送規劃");
    const order = findOrder(state, plan.purchaseOrderId);
    const line = order?.lines?.find((candidate) => candidate.id === plan.purchaseOrderItemId);
    if (!order || !line || !["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("此採購單目前不可登記廠商直送簽收");
    if (user.role === "STORE" && plan.destinationLocationId !== user.locationId) throw new Error("門市只能簽收本門市的廠商直送商品");
    const pending = Math.max(0, plan.plannedDeliveryQty - plan.signedQty);
    const requested = quantity(input.signedQty ?? input.receivedQty);
    const rejected = input.rejected === true || input.rejected === "true" ? Math.max(0, pending - requested) : 0;
    const markedShort = input.shortReceived === true || input.shortReceived === "true" || input.isShort === true || input.isShort === "true";
    if (requested > pending) throw new Error("直送簽收量不得超過此門市規劃數量");
    if (!requested && !rejected && !markedShort) throw new Error("本次至少需要輸入簽收數量、標記短收或標記拒收");
    validateShortOrReject(requested, pending, input, plan.id);
    const tracking = validateTrackedProduct(state, line.productId, input, plan.id);
    if (requested) {
      const balance = getBalance(state, plan.destinationLocationId, line.productId);
      balance.onHandQty += requested; balance.updatedAt = timestamp(input);
      addMovement(state, input, INVENTORY_MOVEMENT_TYPES.SUPPLIER_DIRECT_RECEIPT_STORE, { operationId: input.operationId || `${plan.id}:${plan.signedQty + requested}`, purchaseOrderId: order.id, purchaseOrderItemId: line.id, productId: line.productId, quantity: requested, toLocationId: plan.destinationLocationId, batchNumber: tracking.batchNumber, expiryDate: tracking.expiryDate, note: input.note });
      updateDemandProgress(state, plan.demandOrderId, plan.demandOrderItemId, requested, input);
      const demandSource = (line.sourceAllocations || []).find((source) => source.demandOrderId === plan.demandOrderId && source.demandOrderItemId === plan.demandOrderItemId);
      if (demandSource) demandSource.receivedAllocatedQty = quantity(demandSource.receivedAllocatedQty) + requested;
    }
    updatePlanAfterReceipt(plan, requested, input, { rejected, shortage: markedShort ? Math.max(0, pending - requested - rejected) : 0 });
    line.directReceivedQty += requested; line.receivedQty = lineReceivedQty(line) + requested; line.remainingQty = Math.max(0, quantity(line.orderedQty) - line.receivedQty - quantity(line.cancelledQty));
    order.lastReceivedAt = timestamp(input); order.lastReceiptNote = text(input.note); order.updatedAt = timestamp(input); refreshOrderStatus(order);
    ensureArray(state, "supplierDirectReceiptLogs").unshift({ id: makeId(input, "directReceipt"), purchaseOrderId: order.id, purchaseOrderItemId: line.id, planId: plan.id, destinationLocationId: plan.destinationLocationId, signedQty: requested, rejectedQty: rejected, signedBy: user.id || null, signedAt: timestamp(input), operationId: input.operationId || null, note: text(input.note) });
    addAudit(state, input, rejected ? "SUPPLIER_DIRECT_RECEIPT_SHORT_OR_REJECTED" : "SUPPLIER_DIRECT_RECEIPT_STORE", "PURCHASE_ORDER_ITEM_STORE_ALLOCATION", plan.id, `廠商直送 ${requested} 件至 ${plan.destinationLocationId}`);
    return { order, plan, totalReceived: requested, rejectedQty: rejected };
  });
}

export function getPurchaseOrderDeliveryPlans(state, orderId, user = null) {
  normalizeReceivingWorkflow(state);
  const plans = ensureArray(state, "purchaseOrderItemStoreAllocations").filter((plan) => !orderId || plan.purchaseOrderId === orderId);
  if (user?.role === "STORE") return plans.filter((plan) => plan.destinationLocationId === user.locationId).map((plan) => ({ ...plan, internalNote: undefined }));
  return plans;
}

export function getReceivingRowsForRole(state, user = null) {
  normalizeReceivingWorkflow(state);
  const rows = [];
  for (const order of ensureArray(state, "purchaseOrders")) {
    for (const line of order.lines || []) {
      const plans = planRows(state, line.id);
      for (const plan of plans) {
        if (user?.role === "STORE" && plan.destinationLocationId !== user.locationId) continue;
        const pending = plan.deliveryMode === "SUPPLIER_DIRECT_TO_STORE" ? Math.max(0, plan.plannedDeliveryQty - plan.signedQty) : Math.max(0, plan.shippedQty - plan.actualReceivedQty);
        if (pending <= 0 || ["CANCELLED", "RECEIVED", "REJECTED"].includes(plan.status)) continue;
        rows.push({ ...plan, purchaseOrderId: order.id, purchaseOrderNumber: order.purchaseOrderNumber, purchaseOrderItemId: line.id, productId: line.productId, productName: state.products?.find((product) => product.id === line.productId)?.name || line.productId, supplierId: order.orderingSupplierId || order.supplierId, pendingQty: pending, deliveryMode: plan.deliveryMode });
      }
    }
  }
  return rows;
}
