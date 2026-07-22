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

  const projectedAvailableQty = onHandQty - reservedQty + allocationInTransitQty + purchaseInboundAllocatedQty + existingOpenDemandQty;
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
