export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ceilToMultiple(value, multiple = 1) {
  const amount = Math.max(0, toNumber(value));
  const unit = Math.max(1, toNumber(multiple, 1));
  return Math.ceil(amount / unit) * unit;
}

export function calculateReplenishment(input) {
  const onHandQty = Math.max(0, toNumber(input.onHandQty));
  const reservedQty = Math.max(0, toNumber(input.reservedQty));
  const allocationInTransitQty = Math.max(0, toNumber(input.allocationInTransitQty));
  const purchaseInboundAllocatedQty = Math.max(0, toNumber(input.purchaseInboundAllocatedQty));
  const existingOpenDemandQty = Math.max(0, toNumber(input.existingOpenDemandQty));
  const safetyStockQty = Math.max(0, toNumber(input.safetyStockQty));
  const maximumStockQty = Math.max(0, toNumber(input.maximumStockQty));
  const minimumReplenishmentQty = Math.max(0, toNumber(input.minimumReplenishmentQty));
  const distributionMultiple = Math.max(1, toNumber(input.storeDistributionMultiple, 1));

  const projectedAvailableQty = Math.max(0, onHandQty - reservedQty + allocationInTransitQty + purchaseInboundAllocatedQty + existingOpenDemandQty);
  const eligible = input.automaticReplenishmentEnabled === true
    && projectedAvailableQty <= safetyStockQty
    && maximumStockQty > projectedAvailableQty;
  const rawRequiredQty = Math.max(0, maximumStockQty - projectedAvailableQty);
  const baseSuggestedQty = Math.max(rawRequiredQty, minimumReplenishmentQty);
  const suggestedQty = eligible ? ceilToMultiple(baseSuggestedQty, distributionMultiple) : 0;

  return {
    projectedAvailableQty,
    eligible,
    rawRequiredQty,
    baseSuggestedQty,
    suggestedQty,
    distributionMultiple,
  };
}

const REPLENISHMENT_OPEN_DEMAND_STATUSES = new Set([
  "SUBMITTED",
  "APPROVED",
  "PROCESSING",
  "PARTIALLY_ALLOCATED",
  "WAITING_PURCHASE",
]);

export function isReplenishmentOpenDemandStatus(status) {
  return REPLENISHMENT_OPEN_DEMAND_STATUSES.has(status);
}

export function openDemandRemainingQty(status, item = {}) {
  if (!isReplenishmentOpenDemandStatus(status)) return 0;

  const approvedQty = Math.max(0, toNumber(item.approvedQty));
  const requestedQty = Math.max(0, toNumber(item.requestedQty));
  const committedQty = approvedQty > 0 ? approvedQty : requestedQty;
  const allocatedQty = Math.max(0, toNumber(item.allocatedQty));
  const receivedQty = Math.max(0, toNumber(item.receivedQty), toNumber(item.completedReceivedQty), toNumber(item.signedReceivedQty));

  return Math.max(0, committedQty - allocatedQty - receivedQty);
}

const HUMAN_DEMAND_EDITABLE_STATUSES = new Set(["DRAFT", "RETURNED"]);

export function isHumanDemandEditableStatus(status) {
  return HUMAN_DEMAND_EDITABLE_STATUSES.has(status);
}

const WEAK_PASSWORD_FRAGMENTS = ["admin", "password", "123456", "qwerty", "letmein"];

export function passwordPolicyError(username, password) {
  const value = typeof password === "string" ? password : "";
  const normalizedPassword = value.toLocaleLowerCase("en-US");
  const normalizedUsername = String(username || "").trim().toLocaleLowerCase("en-US");

  if ([...value].length < 12) return "密碼長度至少需要 12 個字元";
  if (!/[A-Za-z]/.test(value)) return "密碼至少需要包含一個英文字母";
  if (!/[0-9]/.test(value)) return "密碼至少需要包含一個數字";
  if (normalizedUsername && normalizedPassword === normalizedUsername) return "密碼不得與 username 相同";
  if (WEAK_PASSWORD_FRAGMENTS.some((fragment) => normalizedPassword.includes(fragment))) return "密碼不可使用明顯弱密碼";
  return null;
}

export function calculateDemandLineAmount(requestedQty, referencePurchasePrice) {
  const quantity = Math.max(0, toNumber(requestedQty));
  const price = Math.max(0, toNumber(referencePurchasePrice));
  return Math.round(quantity * price * 100) / 100;
}

export function evaluateStoreOrderCondition(input = {}) {
  const mode = input.conditionMode || "QUANTITY_ONLY";
  const requestedQty = Math.max(0, toNumber(input.requestedQty));
  const lineAmount = Math.max(0, toNumber(input.lineAmount));
  const minimumQty = input.minimumQty === null || input.minimumQty === undefined || input.minimumQty === ""
    ? null
    : Math.max(0, toNumber(input.minimumQty));
  const minimumAmount = input.minimumAmount === null || input.minimumAmount === undefined || input.minimumAmount === ""
    ? null
    : Math.max(0, toNumber(input.minimumAmount));
  const quantityMet = minimumQty === null || requestedQty >= minimumQty;
  const amountMet = minimumAmount === null || lineAmount >= minimumAmount;
  const eligible = mode === "AMOUNT_ONLY"
    ? amountMet
    : mode === "EITHER"
      ? (quantityMet || amountMet)
      : mode === "BOTH"
        ? (quantityMet && amountMet)
        : quantityMet;

  return {
    mode,
    requestedQty,
    lineAmount,
    minimumQty,
    minimumAmount,
    quantityMet,
    amountMet,
    eligible,
    quantityShortage: minimumQty === null ? 0 : Math.max(0, minimumQty - requestedQty),
    amountShortage: minimumAmount === null ? 0 : Math.max(0, minimumAmount - lineAmount),
  };
}

export function getPreviousCompleteMonths(referenceDate, count = 6) {
  const parsed = new Date(`${String(referenceDate).slice(0, 10)}T00:00:00Z`);
  const baseDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const months = [];
  const currentMonth = baseDate.getUTCMonth();
  const currentYear = baseDate.getUTCFullYear();
  for (let offset = count; offset >= 1; offset -= 1) {
    const monthDate = new Date(Date.UTC(currentYear, currentMonth - offset, 1));
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth() + 1;
    months.push({ year, month, label: `${year}-${String(month).padStart(2, "0")}` });
  }
  return months;
}

export function calculateSixMonthSales(salesRows = [], locationId, productId, referenceDate) {
  const months = getPreviousCompleteMonths(referenceDate, 6);
  const monthMap = new Map(
    salesRows
      .filter((row) => row.locationId === locationId && row.productId === productId)
      .map((row) => [`${toNumber(row.salesYear)}-${String(toNumber(row.salesMonth)).padStart(2, "0")}`, Math.max(0, toNumber(row.salesQty))]),
  );
  const monthValues = months.map((month) => ({ ...month, salesQty: monthMap.get(month.label) || 0 }));
  const total = monthValues.reduce((sum, month) => sum + month.salesQty, 0);
  const values = monthValues.map((month) => month.salesQty);
  return {
    months: monthValues,
    total,
    average: total / months.length,
    max: values.length ? Math.max(...values) : 0,
    min: values.length ? Math.min(...values) : 0,
  };
}

export function summarizeSupplierDemand(lines = []) {
  const summaries = new Map();
  lines.forEach((line) => {
    const supplierId = line.supplierId || "UNASSIGNED";
    const summary = summaries.get(supplierId) || { supplierId, requestedQty: 0, amount: 0 };
    summary.requestedQty += Math.max(0, toNumber(line.requestedQty));
    summary.amount = Math.round((summary.amount + Math.max(0, toNumber(line.lineAmount))) * 100) / 100;
    summaries.set(supplierId, summary);
  });
  return [...summaries.values()];
}

export function calculatePurchaseSuggestion(input) {
  const shortageQty = Math.max(0, toNumber(input.shortageQty));
  const minimumOrderQuantity = Math.max(0, toNumber(input.minimumOrderQuantity));
  const purchaseMultiple = Math.max(1, toNumber(input.purchaseMultiple, 1));
  const suggestedQty = ceilToMultiple(Math.max(shortageQty, minimumOrderQuantity), purchaseMultiple);

  return {
    shortageQty,
    minimumOrderQuantity,
    purchaseMultiple,
    suggestedQty,
    overageQty: Math.max(0, suggestedQty - shortageQty),
  };
}

export function availableInventory(balance) {
  return Math.max(0, toNumber(balance?.onHandQty) - toNumber(balance?.reservedQty));
}

export function demandOutstanding(item) {
  return Math.max(0, toNumber(item.requestedQty) - toNumber(item.receivedQty));
}

export function demandUnallocated(item) {
  return Math.max(0, toNumber(item.requestedQty) - toNumber(item.allocatedQty) - toNumber(item.receivedQty));
}

export function purchaseCoverage(item) {
  return Math.max(0, toNumber(item.purchaseRequiredQty) - toNumber(item.purchaseOrderedQty) - toNumber(item.purchaseReceivedQty));
}

export function isOpenDemandStatus(status) {
  return !["COMPLETED", "CANCELLED"].includes(status);
}

export function formatMoney(value) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(Math.round(toNumber(value)));
}

export function createId(prefix = "id") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function isoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function numberLabel(value) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(toNumber(value));
}
