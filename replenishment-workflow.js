const STORE_REVIEWABLE_SUGGESTION_STATUSES = new Set(["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED"]);
const AUTO_DEMAND_EDITABLE_STATUSES = new Set(["DRAFT", "RETURNED"]);
const AUTO_DEMAND_LOCKED_STATUSES = new Set([
  "PENDING_MANAGER_APPROVAL",
  "SUBMITTED",
  "APPROVED",
  "PROCESSING",
  "PARTIALLY_ALLOCATED",
  "WAITING_PURCHASE",
  "COMPLETED",
  "CANCELLED",
]);

export const AUTO_SUGGESTION_STATUSES = Object.freeze([
  "GENERATED",
  "STORE_REVIEWING",
  "ACCEPTED",
  "ADJUSTED",
  "SKIPPED",
  "CONVERTED_TO_DEMAND",
  "EXPIRED",
]);

export const REPLENISHMENT_CHANGE_TYPES = Object.freeze([
  "STORE_QTY_CHANGED",
  "STORE_SKIPPED",
  "MANAGER_QTY_CHANGED",
  "MANAGER_ITEM_SKIPPED",
  "MANAGER_REQUIRED_DATE_CHANGED",
  "MANAGER_REASON_CHANGED",
  "MANAGER_NOTE_CHANGED",
  "MANAGER_RETURNED",
  "MANAGER_APPROVED",
]);

function qty(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function sameLocation(user, locationId) {
  return Boolean(user && user.isActive !== false && (user.role === "ADMIN" || (user.role === "STORE" && user.locationId === locationId)));
}

export function actorTypeFor(user) {
  if (user?.role === "ADMIN") return "ADMIN";
  return user?.isStoreManager === true ? "STORE_MANAGER" : "STORE_USER";
}

export function canStoreReviewSuggestion(suggestion, user) {
  return Boolean(suggestion && STORE_REVIEWABLE_SUGGESTION_STATUSES.has(suggestion.status) && sameLocation(user, suggestion.locationId));
}

export function canSkipSuggestion(suggestion, user) {
  return canStoreReviewSuggestion(suggestion, user);
}

export function canConvertSuggestion(suggestion, user) {
  return Boolean(suggestion && ["ACCEPTED", "ADJUSTED", "GENERATED", "STORE_REVIEWING"].includes(suggestion.status) && sameLocation(user, suggestion.locationId));
}

export function canEditAutoDemand(demand, user) {
  return Boolean(demand && demand.sourceType === "AUTO" && AUTO_DEMAND_EDITABLE_STATUSES.has(demand.status) && sameLocation(user, demand.locationId));
}

export function canSubmitAutoDemand(demand, user) {
  return canEditAutoDemand(demand, user) && ["STORE", "ADMIN"].includes(user.role);
}

export function canManagerReviewAutoDemand(demand, user) {
  return Boolean(
    demand
      && demand.sourceType === "AUTO"
      && demand.status === "PENDING_MANAGER_APPROVAL"
      && user?.isActive !== false
      && (user?.role === "ADMIN" || (user?.role === "STORE" && user.isStoreManager === true && user.locationId === demand.locationId)),
  );
}

export function canEditAutoDemandAfterSubmit(demand) {
  return Boolean(demand && demand.sourceType === "AUTO" && AUTO_DEMAND_LOCKED_STATUSES.has(demand.status));
}

export function validateStoreSuggestionReview(suggestion, confirmedQty, adjustmentReason = "") {
  const systemSuggestedQty = qty(suggestion?.systemSuggestedQty ?? suggestion?.suggestedQty);
  const nextQty = qty(confirmedQty);
  const reason = String(adjustmentReason || "").trim();
  const errors = [];
  if (!suggestion || !STORE_REVIEWABLE_SUGGESTION_STATUSES.has(suggestion.status)) errors.push("此補貨建議目前不可由門市確認");
  if (nextQty <= 0) errors.push("門市確認數量必須大於 0");
  if (nextQty !== systemSuggestedQty && !reason) errors.push("修改系統建議數量時必須填寫調整原因");
  return {
    valid: errors.length === 0,
    errors,
    systemSuggestedQty,
    storeConfirmedQty: nextQty,
    adjusted: nextQty !== systemSuggestedQty,
    adjustmentReason: reason || "依系統建議確認",
  };
}

export function applyStoreSuggestionReview(suggestion, input = {}) {
  const validation = validateStoreSuggestionReview(suggestion, input.confirmedQty, input.adjustmentReason);
  if (!validation.valid) return { suggestion: null, logs: [], ...validation };
  const beforeQty = qty(suggestion.storeConfirmedQty ?? suggestion.confirmedQty ?? validation.systemSuggestedQty);
  const nextSuggestion = {
    ...suggestion,
    status: validation.adjusted ? "ADJUSTED" : "ACCEPTED",
    systemSuggestedQty: validation.systemSuggestedQty,
    suggestedQty: validation.systemSuggestedQty,
    originalSuggestedQty: validation.systemSuggestedQty,
    storeConfirmedQty: validation.storeConfirmedQty,
    confirmedQty: validation.storeConfirmedQty,
    adjustmentReason: validation.adjustmentReason,
    storeAdjustmentReason: validation.adjusted ? validation.adjustmentReason : null,
    adjustedBy: input.actorId || suggestion.adjustedBy || null,
    adjustedAt: input.changedAt || suggestion.adjustedAt || null,
  };
  const logs = [];
  if (validation.adjusted || beforeQty !== validation.storeConfirmedQty) {
    logs.push({
      replenishmentSuggestionId: suggestion.id,
      demandOrderId: null,
      demandOrderItemId: null,
      changedBy: input.actorId || null,
      changedAt: input.changedAt || null,
      actorType: input.actorType || "STORE_USER",
      changeType: "STORE_QTY_CHANGED",
      fieldName: "store_confirmed_qty",
      beforeValue: { value: beforeQty },
      afterValue: { value: validation.storeConfirmedQty },
      changeReason: validation.adjustmentReason,
    });
  }
  return { suggestion: nextSuggestion, logs, ...validation };
}

export function buildReplenishmentInventorySnapshot(input = {}) {
  const onHandQty = qty(input.onHandQty);
  const reservedQty = qty(input.reservedQty);
  return {
    onHandQtySnapshot: onHandQty,
    reservedQtySnapshot: reservedQty,
    availableQtySnapshot: Math.max(0, onHandQty - reservedQty),
    calculatedAt: input.calculatedAt || null,
  };
}

export function inventorySnapshotChanged(snapshot = {}, input = {}) {
  const current = buildReplenishmentInventorySnapshot(input);
  return Boolean(snapshot && (
    (snapshot.onHandQtySnapshot ?? snapshot.onHandQty) !== current.onHandQtySnapshot
      || (snapshot.reservedQtySnapshot ?? snapshot.reservedQty) !== current.reservedQtySnapshot
  ));
}

export function buildSixMonthSalesSnapshot(sales = {}) {
  const months = Array.isArray(sales.months) ? sales.months.map((month) => ({ ...month, salesQty: Math.max(0, Number(month.salesQty) || 0) })) : [];
  const values = months.map((month) => month.salesQty);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  return {
    months,
    total,
    average: Math.round(average * 100) / 100,
    max: values.length ? Math.max(...values) : 0,
    min: values.length ? Math.min(...values) : 0,
  };
}

export function buildChangeLog(input = {}) {
  return {
    id: input.id || null,
    replenishmentSuggestionId: input.replenishmentSuggestionId || null,
    demandOrderId: input.demandOrderId || null,
    demandOrderItemId: input.demandOrderItemId || null,
    changedBy: input.changedBy || null,
    changedAt: input.changedAt || null,
    actorType: input.actorType || "ADMIN",
    changeType: input.changeType,
    fieldName: input.fieldName || null,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    changeReason: input.changeReason || null,
  };
}

export function buildAutoDemandItem(input = {}) {
  const systemSuggestedQty = qty(input.systemSuggestedQty);
  const storeConfirmedQty = qty(input.storeConfirmedQty ?? input.requestedQty ?? systemSuggestedQty);
  const requestedQty = qty(input.requestedQty ?? storeConfirmedQty);
  return {
    id: input.id || null,
    productId: input.productId,
    requestedQty,
    approvedQty: qty(input.approvedQty),
    allocatedQty: qty(input.allocatedQty),
    purchaseRequiredQty: qty(input.purchaseRequiredQty),
    purchaseOrderedQty: qty(input.purchaseOrderedQty),
    purchaseReceivedQty: qty(input.purchaseReceivedQty),
    receivedQty: qty(input.receivedQty),
    reason: input.reason || "安全庫存觸發",
    notes: input.notes || "",
    replenishmentSuggestionId: input.replenishmentSuggestionId || null,
    systemSuggestedQty,
    storeConfirmedQty,
    managerConfirmedQty: input.managerConfirmedQty === null || input.managerConfirmedQty === undefined ? null : qty(input.managerConfirmedQty),
    finalRequestedQty: input.finalRequestedQty === null || input.finalRequestedQty === undefined ? null : qty(input.finalRequestedQty),
    storeAdjustmentReason: input.storeAdjustmentReason || null,
    managerAdjustmentReason: input.managerAdjustmentReason || null,
    managerSkipped: input.managerSkipped === true,
    referencePurchasePrice: input.referencePurchasePrice ?? null,
    lineAmount: input.lineAmount ?? null,
    currentStockSnapshot: input.currentStockSnapshot ?? null,
    onHandQtySnapshot: input.onHandQtySnapshot ?? null,
    reservedQtySnapshot: input.reservedQtySnapshot ?? null,
    availableQtySnapshot: input.availableQtySnapshot ?? null,
    calculatedAt: input.calculatedAt || null,
    sixMonthSalesTotalSnapshot: input.sixMonthSalesTotalSnapshot ?? null,
    sixMonthAverageSnapshot: input.sixMonthAverageSnapshot ?? null,
    sixMonthSalesMaxSnapshot: input.sixMonthSalesMaxSnapshot ?? null,
    sixMonthSalesMinSnapshot: input.sixMonthSalesMinSnapshot ?? null,
    minimumQtySnapshot: input.minimumQtySnapshot ?? null,
    minimumAmountSnapshot: input.minimumAmountSnapshot ?? null,
    conditionModeSnapshot: input.conditionModeSnapshot || null,
    supplierMinimumQtySnapshot: input.supplierMinimumQtySnapshot ?? null,
    supplierMinimumAmountSnapshot: input.supplierMinimumAmountSnapshot ?? null,
    supplierPurchaseMultipleSnapshot: input.supplierPurchaseMultipleSnapshot ?? null,
  };
}

export function buildAutoDemandDraft(input = {}) {
  const now = input.createdAt || null;
  const item = buildAutoDemandItem({ ...input.item, id: input.item?.id || null });
  return {
    id: input.id || null,
    demandNumber: input.demandNumber || null,
    locationId: input.locationId,
    sourceType: "AUTO",
    demandType: "GENERAL",
    requiredDate: input.requiredDate,
    status: "DRAFT",
    notes: input.notes || "",
    requestedBy: input.createdBy || null,
    createdBy: input.createdBy || null,
    createdAt: now,
    submittedAt: null,
    managerApprovedBy: null,
    managerApprovedAt: null,
    returnedBy: null,
    returnedAt: null,
    returnReason: null,
    managerReason: null,
    items: [item],
  };
}

export function validateManagerDecisionLines(items = [], decisions = [], conditionByItemId = {}) {
  const decisionMap = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const errors = [];
  const normalized = items.map((item) => {
    const decision = decisionMap.get(item.id) || {};
    const skipped = decision.skipped === true;
    const managerQty = qty(decision.managerQty ?? item.storeConfirmedQty ?? item.requestedQty);
    const storeQty = qty(item.storeConfirmedQty ?? item.requestedQty);
    const reason = String(decision.reason || "").trim();
    if (skipped && !reason) errors.push(`${item.productId}：店長略過品項必須填寫原因`);
    if (!skipped && managerQty <= 0) errors.push(`${item.productId}：店長確認數量必須大於 0，或明確略過品項`);
    if (!skipped && managerQty !== storeQty && !reason) errors.push(`${item.productId}：店長修改數量時必須填寫原因`);
    const condition = conditionByItemId[item.id];
    if (!skipped && condition && condition.eligible === false) errors.push(`${item.productId}：最終數量未符合門市最低需求條件`);
    return { itemId: item.id, skipped, managerQty, storeQty, reason };
  });
  const activeCount = normalized.filter((item) => !item.skipped && item.managerQty > 0).length;
  if (!activeCount) errors.push("核准前至少需要一項未略過的需求明細");
  return { valid: errors.length === 0, errors, normalized, activeCount };
}

export function summarizeAutoApproval(input = {}) {
  const items = input.items || [];
  const decisions = input.decisions || items.map((item) => ({ itemId: item.id, managerQty: item.managerConfirmedQty ?? item.storeConfirmedQty ?? item.requestedQty, skipped: item.managerSkipped === true }));
  const decisionMap = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const rows = items.map((item) => {
    const decision = decisionMap.get(item.id) || {};
    const finalQty = decision.skipped ? 0 : qty(decision.managerQty ?? item.managerConfirmedQty ?? item.storeConfirmedQty ?? item.requestedQty);
    return {
      itemId: item.id,
      systemQty: qty(item.systemSuggestedQty ?? item.requestedQty),
      storeQty: qty(item.storeConfirmedQty ?? item.requestedQty),
      managerQty: finalQty,
      skipped: decision.skipped === true,
      lineAmount: Math.max(0, Number(item.referencePurchasePrice || 0)) * finalQty,
    };
  });
  return {
    itemCount: rows.filter((row) => !row.skipped).length,
    systemTotalQty: rows.reduce((sum, row) => sum + row.systemQty, 0),
    storeTotalQty: rows.reduce((sum, row) => sum + row.storeQty, 0),
    managerTotalQty: rows.reduce((sum, row) => sum + row.managerQty, 0),
    finalAmount: Math.round(rows.reduce((sum, row) => sum + row.lineAmount, 0) * 100) / 100,
    changedCount: rows.filter((row) => row.managerQty !== row.storeQty).length,
    skippedCount: rows.filter((row) => row.skipped).length,
    rows,
  };
}

export function runTransactionalMutation(target, mutation) {
  const snapshot = JSON.parse(JSON.stringify(target));
  try {
    const result = mutation(target);
    return { committed: true, result };
  } catch (error) {
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, snapshot);
    return { committed: false, error };
  }
}
