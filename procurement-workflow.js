export const PURCHASE_DEMAND_STATUSES = Object.freeze([
  "SUBMITTED",
  "PROCESSING",
  "PARTIALLY_ALLOCATED",
  "WAITING_PURCHASE",
]);

export const PURCHASE_ORDER_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_CONFIRMATION",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
]);

export const PURCHASE_SUGGESTION_STATUSES = Object.freeze([
  "WAITING_AGGREGATION",
  "UNDER_REVIEW",
  "DRAFT_PURCHASE_ORDER",
  "GROUPED",
  "ORDER_CREATED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "NO_GROUP",
  "CANCELLED",
  "REOPENED",
  "PENDING",
  "GENERATED",
  "DRAFT",
  "EXPIRED",
]);

export const PROCUREMENT_SOURCE_TYPES = Object.freeze([
  "DEMAND_SUGGESTION",
  "WAREHOUSE_REPLENISHMENT",
  "MANUAL_ADDITION",
  "MIXED",
]);

export const NO_GROUP_REASONS = Object.freeze([
  "MINIMUM_QUANTITY_NOT_MET",
  "PURCHASE_MULTIPLE_NOT_MET",
  "SUPPLIER_MINIMUM_AMOUNT_NOT_MET",
  "SUPPLIER_OUT_OF_STOCK",
  "SUPPLIER_DISCONTINUED",
  "PRICE_NOT_ACCEPTED",
  "PRODUCT_DISCONTINUED",
  "OTHER",
]);

const PURCHASE_SUGGESTION_OPEN_STATUSES = new Set([
  "PENDING",
  "GENERATED",
  "DRAFT",
  "WAITING_AGGREGATION",
  "UNDER_REVIEW",
  "REOPENED",
]);
export const MANUAL_PURCHASE_ADD_REASONS = Object.freeze([
  "WAREHOUSE_STOCK",
  "UPCOMING_PROMOTION",
  "SEASONAL_STOCK",
  "PRICE_INCREASE",
  "SUPPLIER_PROMOTION",
  "MINIMUM_ORDER_AMOUNT",
  "PURCHASE_MULTIPLE",
  "NEW_PRODUCT",
  "EMERGENCY",
  "OTHER",
]);
const PURCHASE_ORDER_MUTABLE_FIELDS = new Set([
  "expectedDeliveryDate",
  "supplierContactName",
  "supplierContactPhone",
  "supplierContactEmail",
  "paymentTerms",
  "deliveryLocationId",
  "notes",
]);
const PURCHASE_ORDER_TRANSITIONS = {
  DRAFT: new Set(["PENDING_CONFIRMATION", "CANCELLED"]),
  PENDING_CONFIRMATION: new Set(["ORDERED", "CANCELLED"]),
  ORDERED: new Set(["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]),
  PARTIALLY_RECEIVED: new Set(["RECEIVED", "CLOSED"]),
  RECEIVED: new Set(["CLOSED"]),
  CLOSED: new Set(),
  CANCELLED: new Set(),
};

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function quantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function decimalText(value) {
  return String(value ?? "0").trim().replaceAll(",", "");
}

export function decimalToCents(value) {
  const text = decimalText(value);
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = match[3] || "";
  let cents = whole * 100n + BigInt((fraction.slice(0, 2) || "").padEnd(2, "0") || "0");
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1n;
  const signed = sign * cents;
  const numberValue = Number(signed);
  return Number.isSafeInteger(numberValue) ? numberValue : (signed < 0n ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
}

export function centsToDecimal(value) {
  const cents = BigInt(Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function normalizePurchaseMultiple(value) {
  return Math.max(1, quantity(value || 1));
}

export function isPurchaseDemandEligible(status) {
  return PURCHASE_DEMAND_STATUSES.includes(status);
}

export function calculatePurchaseQuantity(input = {}) {
  const demandAllocatedQty = quantity(input.demandAllocatedQty ?? input.demandQty);
  const warehouseSupplementQty = quantity(input.warehouseSupplementQty ?? input.warehouseBufferQty);
  const rawPurchaseQty = demandAllocatedQty + warehouseSupplementQty;
  const minimumOrderQuantity = quantity(input.minimumOrderQuantity);
  const purchaseMultiple = normalizePurchaseMultiple(input.purchaseMultiple);
  const minimumAdjustedQty = Math.max(rawPurchaseQty, minimumOrderQuantity);
  const suggestedPurchaseQty = minimumAdjustedQty === 0
    ? 0
    : Math.ceil(minimumAdjustedQty / purchaseMultiple) * purchaseMultiple;
  const overageQty = Math.max(0, suggestedPurchaseQty - rawPurchaseQty);
  const warehouseBufferQty = warehouseSupplementQty + overageQty;
  const unitPriceCents = Math.max(0, decimalToCents(input.unitPrice));
  const minimumAmountCents = Math.max(0, decimalToCents(input.supplierMinimumOrderAmount ?? input.minimumOrderAmount));
  const estimatedAmountCents = suggestedPurchaseQty * unitPriceCents;

  return {
    demandAllocatedQty,
    warehouseSupplementQty,
    rawPurchaseQty,
    minimumOrderQuantity,
    purchaseMultiple,
    minimumAdjustedQty,
    suggestedPurchaseQty,
    confirmedPurchaseQty: suggestedPurchaseQty,
    overageQty,
    warehouseBufferQty,
    estimatedAmountCents,
    minimumAmountCents,
    minimumAmountMet: estimatedAmountCents >= minimumAmountCents,
    minimumAmountShortfallCents: Math.max(0, minimumAmountCents - estimatedAmountCents),
  };
}

function findSupplierProduct(productId, supplierId, supplierProducts = []) {
  return supplierProducts.find((item) => item.productId === productId && item.supplierId === supplierId && item.isActive !== false)
    || supplierProducts.find((item) => item.productId === productId && item.supplierId === supplierId);
}

function primarySupplierProduct(product, supplierProducts = []) {
  return supplierProducts.find((item) => item.productId === product?.id && item.isPrimary === true && item.isActive !== false)
    || supplierProducts.find((item) => item.productId === product?.id && item.isActive !== false)
    || supplierProducts.find((item) => item.productId === product?.id);
}

function isProductPurchasable(product = {}) {
  return !product.procurementStatus || product.procurementStatus === "PURCHASABLE";
}

function supplierFor(supplierId, suppliers = []) {
  return suppliers.find((item) => item.id === supplierId) || { id: supplierId, minimumOrderAmount: 0, isActive: true };
}

function finalRequestedQty(item = {}) {
  const finalQty = item.finalRequestedQty;
  if (finalQty !== null && finalQty !== undefined && finalQty !== "") return quantity(finalQty);
  const approvedQty = quantity(item.approvedQty);
  return approvedQty > 0 ? approvedQty : quantity(item.requestedQty);
}

function signedReceivedQty(item = {}) {
  return Math.max(
    quantity(item.receivedQty),
    quantity(item.completedReceivedQty),
    quantity(item.signedReceivedQty),
  );
}

function purchaseAllocationTotals(demandOrderId, demandOrderItemId, allocations = []) {
  const rows = allocations.filter((row) => (
    row.demandOrderId === demandOrderId
      && row.demandOrderItemId === demandOrderItemId
  ));
  const gross = rows.reduce((sum, row) => sum + quantity(row.allocatedQty), 0);
  const received = rows.reduce((sum, row) => sum + quantity(row.receivedAllocatedQty ?? row.receivedQty), 0);
  const cancelled = rows.reduce((sum, row) => sum + quantity(row.cancelledAllocatedQty ?? row.cancelledQty), 0);
  return {
    gross,
    received,
    cancelled,
    active: Math.max(0, gross - cancelled),
  };
}

export function calculateDemandPurchaseShortage(demand, item, demandPurchaseAllocations = []) {
  const committedQty = finalRequestedQty(item);
  const warehouseAllocatedQty = quantity(item.allocatedQty);
  const completedReceivedQty = signedReceivedQty(item);
  const allocationTotals = purchaseAllocationTotals(demand?.id, item?.id, demandPurchaseAllocations);
  const legacyOrderedQty = allocationTotals.gross === 0
    ? Math.max(0, quantity(item.purchaseOrderedQty) - quantity(item.purchaseCancelledQty))
    : 0;
  const activePurchaseAllocatedQty = Math.max(allocationTotals.active, legacyOrderedQty);
  const cancelledDemandQty = quantity(item.cancelledQty);
  const shortageQty = Math.max(0, committedQty - warehouseAllocatedQty - completedReceivedQty - activePurchaseAllocatedQty - cancelledDemandQty);
  return {
    committedQty,
    warehouseAllocatedQty,
    completedReceivedQty,
    purchaseAllocatedQty: activePurchaseAllocatedQty,
    purchaseGrossAllocatedQty: allocationTotals.gross || legacyOrderedQty,
    purchaseReceivedQty: allocationTotals.received || quantity(item.purchaseReceivedQty),
    purchaseCancelledQty: allocationTotals.cancelled || quantity(item.purchaseCancelledQty),
    cancelledDemandQty,
    shortageQty,
  };
}

function suggestionKey(item) {
  return [
    item.supplierId,
    item.productId,
    item.purchaseUnit || "",
    normalizePurchaseMultiple(item.purchaseMultiple),
    quantity(item.minimumOrderQuantity),
    decimalToCents(item.supplierMinimumOrderAmount ?? item.minimumOrderAmount),
  ].join("|");
}

export function aggregatePurchaseSuggestions(input = {}) {
  const products = input.products || [];
  const suppliers = input.suppliers || [];
  const supplierProducts = input.supplierProducts || [];
  const demandPurchaseAllocations = input.demandPurchaseAllocations || [];
  const groups = new Map();

  const addGroup = ({ product, supplierProduct, supplierId, demandQty = 0, warehouseQty = 0, sourceAllocation = null, warehouseSource = null }) => {
    if (!product || !supplierProduct || !supplierId || !isProductPurchasable(product)) return;
    const supplier = supplierFor(supplierId, suppliers);
    const purchaseUnit = supplierProduct.purchaseUnit || product.baseUnit || "件";
    const minimumOrderQuantity = quantity(supplierProduct.minimumOrderQuantity);
    const purchaseMultiple = normalizePurchaseMultiple(supplierProduct.purchaseMultiple);
    const supplierMinimumOrderAmount = supplierProduct.minimumOrderAmount ?? supplier.minimumOrderAmount ?? 0;
    const key = suggestionKey({ supplierId, productId: product.id, purchaseUnit, purchaseMultiple, minimumOrderQuantity, supplierMinimumOrderAmount });
    const group = groups.get(key) || {
      key,
      supplierId,
      productId: product.id,
      purchaseUnit,
      purchaseMultiple,
      minimumOrderQuantity,
      supplierMinimumOrderAmount,
      purchasePrice: supplierProduct.purchasePrice ?? 0,
      supplierProductCode: supplierProduct.supplierProductCode || null,
      demandAllocatedQty: 0,
      warehouseSupplementQty: 0,
      sourceAllocations: [],
      warehouseSources: [],
    };
    group.demandAllocatedQty += quantity(demandQty);
    group.warehouseSupplementQty += quantity(warehouseQty);
    if (sourceAllocation?.allocatedQty > 0) group.sourceAllocations.push({ ...sourceAllocation, allocatedQty: quantity(sourceAllocation.allocatedQty) });
    if (warehouseSource && quantity(warehouseSource.qty) > 0) group.warehouseSources.push({ ...warehouseSource, qty: quantity(warehouseSource.qty) });
    groups.set(key, group);
  };

  for (const demand of input.demands || []) {
    if (!isPurchaseDemandEligible(demand.status)) continue;
    for (const item of demand.items || []) {
      const shortage = calculateDemandPurchaseShortage(demand, item, demandPurchaseAllocations).shortageQty;
      if (shortage <= 0) continue;
      const product = products.find((candidate) => candidate.id === item.productId && candidate.isActive !== false);
      const supplierProduct = primarySupplierProduct(product, supplierProducts);
      if (!product || !supplierProduct) continue;
      addGroup({
        product,
        supplierProduct,
        supplierId: supplierProduct.supplierId || product.supplierId,
        demandQty: shortage,
        sourceAllocation: {
          demandOrderId: demand.id,
          demandOrderItemId: item.id,
          demandNumber: demand.demandNumber || demand.id,
          demandType: demand.sourceType || "MANUAL",
          locationId: demand.locationId,
          allocatedQty: shortage,
        },
      });
    }
  }

  for (const supplement of input.warehouseSupplements || []) {
    const product = products.find((candidate) => candidate.id === supplement.productId && candidate.isActive !== false);
    const supplierProduct = findSupplierProduct(supplement.productId, supplement.supplierId, supplierProducts) || primarySupplierProduct(product, supplierProducts);
    const supplierId = supplement.supplierId || supplierProduct?.supplierId || product?.supplierId;
    addGroup({
      product,
      supplierProduct,
      supplierId,
      warehouseQty: supplement.qty ?? supplement.warehouseSupplementQty,
      warehouseSource: {
        sourceType: supplement.sourceType || "WAREHOUSE_SAFETY_STOCK",
        referenceId: supplement.referenceId || null,
        qty: supplement.qty ?? supplement.warehouseSupplementQty,
        reason: supplement.reason || null,
      },
    });
  }

  return [...groups.values()].map((group) => {
    const quantityResult = calculatePurchaseQuantity({
      demandAllocatedQty: group.demandAllocatedQty,
      warehouseSupplementQty: group.warehouseSupplementQty,
      minimumOrderQuantity: group.minimumOrderQuantity,
      purchaseMultiple: group.purchaseMultiple,
      unitPrice: group.purchasePrice,
      supplierMinimumOrderAmount: group.supplierMinimumOrderAmount,
    });
    const sourceLocationIds = [...new Set(group.sourceAllocations.map((source) => source.locationId).filter(Boolean))];
    return {
      ...group,
      ...quantityResult,
      rawPurchaseQty: quantityResult.rawPurchaseQty,
      suggestedPurchaseQty: quantityResult.suggestedPurchaseQty,
      confirmedPurchaseQty: quantityResult.suggestedPurchaseQty,
      sourceDemandIds: [...new Set(group.sourceAllocations.map((source) => source.demandOrderId))],
      sourceLocationIds,
      sourceDemandCount: new Set(group.sourceAllocations.map((source) => source.demandOrderId)).size,
      estimatedAmountCents: quantityResult.estimatedAmountCents,
      minimumAmountMet: quantityResult.minimumAmountMet,
      minimumAmountShortfallCents: quantityResult.minimumAmountShortfallCents,
    };
  });
}

export function mergePurchaseSuggestions(existing = [], calculated = [], input = {}) {
  const now = input.now || null;
  const createId = input.createId || ((prefix) => `${prefix}_${Date.now()}`);
  const next = existing.map((item) => ({ ...item }));
  const seenKeys = new Set();
  calculated.forEach((calculatedItem) => {
    const key = calculatedItem.key || suggestionKey(calculatedItem);
    seenKeys.add(key);
    const index = next.findIndex((item) => (
      (item.key || suggestionKey(item)) === key
        && PURCHASE_SUGGESTION_OPEN_STATUSES.has(item.status || "PENDING")
        && !item.purchaseOrderId
    ));
    if (index >= 0) {
      next[index] = { ...next[index], ...calculatedItem, key, status: next[index].status || "PENDING", updatedAt: now };
    } else {
      next.unshift({ id: createId("purchaseSuggestion"), ...calculatedItem, key, status: "PENDING", createdAt: now, updatedAt: now });
    }
  });
  next.forEach((item) => {
    const key = item.key || suggestionKey(item);
    if (PURCHASE_SUGGESTION_OPEN_STATUSES.has(item.status || "PENDING") && !seenKeys.has(key)) {
      item.status = "EXPIRED";
      item.expiredAt = now;
    }
  });
  return next;
}

export function calculatePurchaseOrderTotals(lines = [], input = {}) {
  const subtotalCents = lines.reduce((sum, line) => sum + quantity(line.orderedQty) * Math.max(0, decimalToCents(line.unitPrice ?? line.purchasePrice)), 0);
  const taxRateBasisPoints = Math.max(0, quantity(input.taxRateBasisPoints));
  const taxCents = Math.round(subtotalCents * taxRateBasisPoints / 10000);
  const totalCents = subtotalCents + taxCents;
  const minimumAmountCents = Math.max(0, decimalToCents(input.supplierMinimumOrderAmount ?? input.minimumOrderAmount));
  return {
    subtotalCents,
    taxCents,
    totalCents,
    subtotalAmount: centsToDecimal(subtotalCents),
    taxAmount: centsToDecimal(taxCents),
    totalAmount: centsToDecimal(totalCents),
    minimumAmountCents,
    minimumAmountMet: totalCents >= minimumAmountCents,
    minimumAmountShortfallCents: Math.max(0, minimumAmountCents - totalCents),
  };
}

function sourceAllocationsForSuggestion(suggestion = {}, orderedQty) {
  const sources = (suggestion.sourceAllocations || []).map((source) => ({ ...source, allocatedQty: quantity(source.allocatedQty) }));
  let remaining = quantity(orderedQty);
  return sources.map((source) => {
    const allocatedQty = Math.min(source.allocatedQty, remaining);
    remaining -= allocatedQty;
    return { ...source, allocatedQty };
  }).filter((source) => source.allocatedQty > 0);
}

export function calculateCombinedPurchaseQuantity(input = {}) {
  const suggestedPurchaseQty = quantity(input.suggestedPurchaseQty);
  const manualAddedQty = quantity(input.manualAddedQty);
  const combinedBaseQty = suggestedPurchaseQty + manualAddedQty;
  const minimumOrderQuantity = quantity(input.minimumOrderQuantity);
  const purchaseMultiple = normalizePurchaseMultiple(input.purchaseMultiple);
  const minimumAdjustedQty = combinedBaseQty > 0 ? Math.max(combinedBaseQty, minimumOrderQuantity) : 0;
  const confirmedPurchaseQty = minimumAdjustedQty > 0
    ? Math.ceil(minimumAdjustedQty / purchaseMultiple) * purchaseMultiple
    : 0;
  const demandAllocatedQty = quantity(input.demandAllocatedQty);
  const rawDemandQty = quantity(input.rawDemandQty);
  const rawPurchaseQty = quantity(input.rawPurchaseQty ?? rawDemandQty + quantity(input.warehouseSupplementQty));
  const rawPurchaseQtyBeforeManual = quantity(input.rawPurchaseQtyBeforeManual ?? rawPurchaseQty);
  return {
    suggestedPurchaseQty,
    manualAddedQty,
    combinedBaseQty,
    minimumOrderQuantity,
    purchaseMultiple,
    minimumAdjustedQty,
    confirmedPurchaseQty,
    rawDemandQty,
    rawPurchaseQty,
    rawPurchaseQtyBeforeManual,
    demandAllocatedQty,
    multipleOverageQty: Math.max(0, confirmedPurchaseQty - rawPurchaseQtyBeforeManual - manualAddedQty),
    warehouseBufferQty: Math.max(0, confirmedPurchaseQty - demandAllocatedQty),
  };
}

function purchaseConditionsMatch(line = {}, supplierProduct = {}, unitPrice) {
  return (
    String(line.purchaseUnit || "件") === String(supplierProduct.purchaseUnit || "件")
      && normalizePurchaseMultiple(line.purchaseMultiple) === normalizePurchaseMultiple(supplierProduct.purchaseMultiple)
      && quantity(line.minimumOrderQuantity) === quantity(supplierProduct.minimumOrderQuantity)
      && decimalToCents(line.unitPrice ?? line.purchasePrice) === decimalToCents(unitPrice ?? supplierProduct.purchasePrice)
  );
}

function lineTotals(line, input = {}) {
  const totals = calculatePurchaseOrderTotals([{ orderedQty: line.orderedQty, unitPrice: line.unitPrice }], { taxRateBasisPoints: input.taxRateBasisPoints || 0 });
  Object.assign(line, {
    lineSubtotal: totals.subtotalAmount,
    lineSubtotalCents: totals.subtotalCents,
    taxAmount: totals.taxAmount,
    taxAmountCents: totals.taxCents,
    lineTotal: totals.totalAmount,
    lineTotalCents: totals.totalCents,
  });
  return line;
}

function recalculateCombinedLine(line, input = {}) {
  const isSuggestionLine = Boolean(line.sourceSuggestionId || line.suggestionId);
  const manualAddedQty = quantity(line.manualAddedQty);
  const rawPurchaseQtyBeforeManual = isSuggestionLine
    ? quantity(line.rawPurchaseQtyBeforeManual ?? line.rawPurchaseQty)
    : 0;
  const rawPurchaseQty = isSuggestionLine
    ? rawPurchaseQtyBeforeManual + manualAddedQty
    : quantity(line.rawPurchaseQtyBeforeManual ?? manualAddedQty);
  const calculation = calculateCombinedPurchaseQuantity({
    suggestedPurchaseQty: isSuggestionLine ? line.suggestedPurchaseQty : 0,
    manualAddedQty,
    minimumOrderQuantity: line.minimumOrderQuantity,
    purchaseMultiple: line.purchaseMultiple,
    rawDemandQty: line.rawDemandQty,
    rawPurchaseQty,
    rawPurchaseQtyBeforeManual,
    warehouseSupplementQty: line.warehouseSupplementQty,
    demandAllocatedQty: line.demandAllocatedQty,
  });
  Object.assign(line, calculation, {
    rawPurchaseQty,
    rawPurchaseQtyBeforeManual,
    orderedQty: calculation.confirmedPurchaseQty,
    confirmedPurchaseQty: calculation.confirmedPurchaseQty,
    remainingQty: Math.max(0, calculation.confirmedPurchaseQty - quantity(line.receivedQty) - quantity(line.cancelledQty)),
  });
  line.procurementRawPurchaseQty = line.rawPurchaseQty;
  line.rawPurchaseQtyIncludingManual = line.rawPurchaseQty;
  line.demandSuggestedQty = quantity(line.rawDemandQty);
  line.warehouseReplenishmentQty = quantity(line.warehouseSupplementQty);
  line.systemSuggestedPurchaseQty = quantity(line.suggestedPurchaseQty);
  line.purchaserConfirmedQty = quantity(line.confirmedPurchaseQty);
  line.plannedStoreAllocationQty = quantity(line.plannedStoreAllocationQty ?? line.demandAllocatedQty);
  line.warehousePlannedRetentionQty = Math.max(0, line.confirmedPurchaseQty - line.plannedStoreAllocationQty);
  line.warehouseBufferQty = line.warehousePlannedRetentionQty;
  return lineTotals(line, input);
}

function lineSourceType({ demandQty = 0, warehouseQty = 0, manualQty = 0 } = {}) {
  const types = [];
  if (quantity(demandQty) > 0) types.push("DEMAND_SUGGESTION");
  if (quantity(warehouseQty) > 0) types.push("WAREHOUSE_REPLENISHMENT");
  if (quantity(manualQty) > 0) types.push("MANUAL_ADDITION");
  return types.length > 1 ? "MIXED" : types[0] || "MANUAL_ADDITION";
}

function manualEntryFromItem(item = {}, input = {}, quantityValue = quantity(item.manualAddedQty ?? item.orderedQty ?? item.quantity)) {
  const reason = String(item.manualAddReason ?? item.reason ?? item.manualReasonCode ?? "").trim();
  return {
    quantity: quantityValue,
    reason,
    reasonCode: item.manualReasonCode || null,
    reasonDetail: String(item.manualReasonDetail || "").trim() || null,
    addedBy: item.manualAddedBy || input.manualAddedBy || input.createdBy || null,
    addedAt: item.manualAddedAt || input.manualAddedAt || input.createdAt || null,
    notes: String(item.manualNotes ?? item.notes ?? "").trim(),
  };
}

export function validateManualPurchaseItem(item = {}, input = {}) {
  const errors = [];
  const supplierId = input.supplierId || item.supplierId;
  const quantityValue = quantity(item.manualAddedQty ?? item.orderedQty ?? item.quantity);
  const reasonCode = String(item.manualReasonCode || "").trim();
  const reason = String(item.manualAddReason ?? item.reason ?? reasonCode).trim();
  const product = (input.products || []).find((candidate) => candidate.id === item.productId);
  const supplier = (input.suppliers || []).find((candidate) => candidate.id === supplierId);
  const supplierProduct = findSupplierProduct(item.productId, supplierId, input.supplierProducts || []);
  if (!supplierId) errors.push("人工新增品項必須指定供應商");
  if (supplier && supplier.isActive === false) errors.push("供應商已停用");
  if (!product || product.isActive === false) errors.push(`${item.productId || "商品"}：商品不存在或已停用`);
  if (product && !isProductPurchasable(product)) errors.push(`${item.productId || "商品"}：商品尚未完成採購設定，不能建立採購單`);
  if (!supplierProduct || supplierProduct.isActive === false) errors.push(`${item.productId || "商品"}：商品不是此供應商的有效供應品`);
  if (item.supplierId && item.supplierId !== supplierId) errors.push(`${item.productId || "商品"}：不得加入其他供應商商品`);
  if (quantityValue <= 0) errors.push(`${item.productId || "商品"}：人工新增數量必須大於 0`);
  if (!reason) errors.push(`${item.productId || "商品"}：人工新增原因為必填`);
  if (item.manualReasonCode === "OTHER" && !String(item.manualReasonDetail || "").trim()) errors.push(`${item.productId || "商品"}：選擇其他原因時必須填寫說明`);
  return { valid: errors.length === 0, errors, quantity: quantityValue, reason, product, supplier, supplierProduct };
}

function buildSuggestionLine(suggestion, product, supplierProduct, orderId, input = {}) {
  const orderedQty = quantity(suggestion.confirmedPurchaseQty ?? suggestion.confirmedQty ?? suggestion.suggestedPurchaseQty ?? suggestion.suggestedQty);
  const unitPrice = suggestion.unitPrice ?? suggestion.purchasePrice ?? supplierProduct?.purchasePrice ?? 0;
  const sourceAllocations = sourceAllocationsForSuggestion(suggestion, orderedQty);
  const demandAllocatedQty = sourceAllocations.reduce((sum, source) => sum + source.allocatedQty, 0);
  const warehouseSupplementQty = quantity(suggestion.warehouseSupplementQty);
  const rawPurchaseQty = quantity(suggestion.rawPurchaseQty ?? demandAllocatedQty + warehouseSupplementQty);
  const rawDemandQty = quantity(suggestion.rawDemandQty ?? Math.max(0, rawPurchaseQty - warehouseSupplementQty));
  const suggestedPurchaseQty = quantity(suggestion.suggestedPurchaseQty ?? suggestion.suggestedQty ?? orderedQty);
  const warehouseBufferQty = Math.max(0, orderedQty - demandAllocatedQty);
  const multipleOverageQty = Math.max(0, suggestedPurchaseQty - rawPurchaseQty);
  const lineTotals = calculatePurchaseOrderTotals([{ orderedQty, unitPrice }], { taxRateBasisPoints: input.taxRateBasisPoints || 0 });
  return {
    id: input.createId ? input.createId("purchaseOrderItem") : `${orderId}_line_${Math.random().toString(36).slice(2, 7)}`,
    purchaseOrderId: orderId,
    productId: product.id,
    supplierProductCode: supplierProduct?.supplierProductCode || suggestion.supplierProductCode || null,
    purchaseUnit: supplierProduct?.purchaseUnit || suggestion.purchaseUnit || product.baseUnit || "件",
    purchaseMultiple: normalizePurchaseMultiple(supplierProduct?.purchaseMultiple ?? suggestion.purchaseMultiple),
    minimumOrderQuantity: quantity(supplierProduct?.minimumOrderQuantity ?? suggestion.minimumOrderQuantity),
    orderedQty,
    receivedQty: 0,
    cancelledQty: 0,
    remainingQty: orderedQty,
    unitPrice,
    purchasePrice: unitPrice,
    lineSubtotal: lineTotals.subtotalAmount,
    lineSubtotalCents: lineTotals.subtotalCents,
    taxAmount: lineTotals.taxAmount,
    taxAmountCents: lineTotals.taxCents,
    lineTotal: lineTotals.totalAmount,
    lineTotalCents: lineTotals.totalCents,
    giftQty: quantity(suggestion.giftQty),
    sourceType: lineSourceType({ demandQty: rawDemandQty, warehouseQty: warehouseSupplementQty }),
    sourceTypes: [
      ...(rawDemandQty > 0 ? ["DEMAND_SUGGESTION"] : []),
      ...(warehouseSupplementQty > 0 ? ["WAREHOUSE_REPLENISHMENT"] : []),
    ],
    purchaseSuggestionSourceType: "PURCHASE_SUGGESTION",
    suggestionId: suggestion.id || null,
    rawPurchaseQty,
    rawDemandQty,
    rawPurchaseQtyBeforeManual: rawPurchaseQty,
    demandAllocatedQty,
    warehouseSupplementQty,
    suggestedPurchaseQty,
    combinedBaseQty: suggestedPurchaseQty,
    manualAddedQty: 0,
    manualAddReason: null,
    manualReasonCode: null,
    manualReasonDetail: null,
    manualAddedBy: null,
    manualAddedAt: null,
    manualNotes: "",
    manualAddEntries: [],
    confirmedPurchaseQty: orderedQty,
    multipleOverageQty,
    warehouseBufferQty,
    demandSuggestedQty: rawDemandQty,
    warehouseReplenishmentQty: warehouseSupplementQty,
    rawPurchaseQtyIncludingManual: rawPurchaseQty,
    systemSuggestedPurchaseQty: suggestedPurchaseQty,
    purchaserConfirmedQty: orderedQty,
    plannedStoreAllocationQty: demandAllocatedQty,
    warehousePlannedRetentionQty: Math.max(0, orderedQty - demandAllocatedQty),
    sourceSuggestionId: suggestion.id || null,
    sourceDemandIds: [...new Set(sourceAllocations.map((source) => source.demandOrderId).filter(Boolean))],
    sourceAllocations,
    expectedDeliveryDate: suggestion.expectedDeliveryDate || input.expectedDeliveryDate || null,
    notes: suggestion.notes || "",
    createdAt: input.createdAt || null,
    updatedAt: input.createdAt || null,
  };
}

function buildManualLine(item, product, supplierProduct, orderId, input = {}) {
  const manualAddedQty = quantity(item.manualAddedQty ?? item.orderedQty ?? item.quantity);
  const unitPrice = item.unitPrice ?? item.purchasePrice ?? supplierProduct?.purchasePrice ?? 0;
  const reason = String(item.manualAddReason ?? item.reason ?? item.manualReasonCode ?? "").trim();
  const manualEntry = manualEntryFromItem(item, input, manualAddedQty);
  const id = input.createId ? input.createId("purchaseOrderItem") : `${orderId}_line_${Math.random().toString(36).slice(2, 7)}`;
  const line = {
    id,
    purchaseOrderId: orderId,
    productId: product.id,
    supplierProductCode: supplierProduct?.supplierProductCode || null,
    purchaseUnit: supplierProduct?.purchaseUnit || product.baseUnit || "件",
    purchaseMultiple: normalizePurchaseMultiple(supplierProduct?.purchaseMultiple),
    minimumOrderQuantity: quantity(supplierProduct?.minimumOrderQuantity),
    orderedQty: manualAddedQty,
    receivedQty: 0,
    cancelledQty: 0,
    remainingQty: manualAddedQty,
    unitPrice,
    purchasePrice: unitPrice,
    giftQty: quantity(item.giftQty),
    sourceType: "MANUAL_ADDITION",
    sourceTypes: ["MANUAL_ADDITION"],
    purchaseSuggestionSourceType: null,
    sourceSuggestionId: null,
    suggestionId: null,
    sourceDemandIds: [],
    sourceAllocations: [],
    rawDemandQty: 0,
    rawPurchaseQty: manualAddedQty,
    rawPurchaseQtyBeforeManual: 0,
    demandAllocatedQty: 0,
    warehouseSupplementQty: manualAddedQty,
    suggestedPurchaseQty: 0,
    combinedBaseQty: manualAddedQty,
    manualAddedQty,
    manualAddReason: reason || null,
    manualReasonCode: item.manualReasonCode || null,
    manualReasonDetail: String(item.manualReasonDetail || "").trim() || null,
    manualAddedBy: manualEntry.addedBy,
    manualAddedAt: manualEntry.addedAt,
    manualNotes: manualEntry.notes,
    manualAddEntries: reason ? [manualEntry] : [],
    confirmedPurchaseQty: manualAddedQty,
    multipleOverageQty: 0,
    warehouseBufferQty: manualAddedQty,
    demandSuggestedQty: 0,
    warehouseReplenishmentQty: 0,
    rawPurchaseQtyIncludingManual: manualAddedQty,
    systemSuggestedPurchaseQty: 0,
    purchaserConfirmedQty: manualAddedQty,
    plannedStoreAllocationQty: 0,
    warehousePlannedRetentionQty: manualAddedQty,
    expectedDeliveryDate: item.expectedDeliveryDate || input.expectedDeliveryDate || null,
    notes: item.notes || reason || "",
    createdAt: input.createdAt || null,
    updatedAt: input.createdAt || null,
  };
  if (input.applyPurchaseRounding === false) return lineTotals(line, input);
  return recalculateCombinedLine(line, input);
}

function mergeManualEntryIntoLine(line, item, input = {}) {
  const quantityValue = quantity(item.manualAddedQty ?? item.orderedQty ?? item.quantity);
  const entry = manualEntryFromItem(item, input, quantityValue);
  const entries = [...(line.manualAddEntries || []), entry];
  line.manualAddedQty = quantity(line.manualAddedQty) + quantityValue;
  line.manualAddEntries = entries;
  line.manualAddReason = entries.map((candidate) => candidate.reason).filter(Boolean).join("；") || null;
  line.manualReasonCode = item.manualReasonCode || line.manualReasonCode || null;
  line.manualReasonDetail = entry.reasonDetail || line.manualReasonDetail || null;
  line.manualAddedBy = entry.addedBy;
  line.manualAddedAt = entry.addedAt;
  line.manualNotes = [line.manualNotes, entry.notes].filter(Boolean).join("；");
  if (line.sourceSuggestionId || line.suggestionId) {
    line.sourceType = "MIXED";
    line.sourceTypes = [...new Set([...(line.sourceTypes || []), "MANUAL_ADDITION"])]
      .filter((type) => PROCUREMENT_SOURCE_TYPES.includes(type));
  } else {
    line.rawPurchaseQty = quantity(line.rawPurchaseQty) + quantityValue;
    line.warehouseSupplementQty = quantity(line.warehouseSupplementQty) + quantityValue;
  }
  line.notes = [line.notes, entry.notes || entry.reason].filter(Boolean).join("；");
  return recalculateCombinedLine(line, input);
}

export function mergePurchaseOrderItems(input = {}) {
  const errors = [];
  const lines = [];
  const lineByProduct = new Map();
  const supplierId = input.supplierId;
  const products = input.products || [];
  const supplierProducts = input.supplierProducts || [];
  const suggestions = input.suggestions || [];
  const manualItems = input.manualItems || input.items || [];
  const addLine = (line) => {
    const existing = lineByProduct.get(line.productId);
    if (existing) {
      errors.push(`${line.productId}：同一採購單不可重複建立相同商品明細`);
      return;
    }
    lineByProduct.set(line.productId, line);
    lines.push(line);
  };

  suggestions.forEach((suggestion) => {
    if (suggestion.supplierId && suggestion.supplierId !== supplierId) {
      errors.push(`${suggestion.productId || "商品"}：採購建議與採購單供應商不一致`);
      return;
    }
    const product = products.find((item) => item.id === suggestion.productId);
    const supplierProduct = findSupplierProduct(suggestion.productId, supplierId, supplierProducts) || suggestion;
    if (!product || product.isActive === false) errors.push(`${suggestion.productId || "商品"}：商品不存在或已停用`);
    if (product && !isProductPurchasable(product)) errors.push(`${suggestion.productId || "商品"}：商品尚未完成採購設定，不能建立採購單`);
    if (!supplierProduct || supplierProduct.isActive === false) errors.push(`${suggestion.productId || "商品"}：商品不是此供應商的有效供應品`);
    if (!product || !supplierProduct || supplierProduct.isActive === false) return;
    addLine(buildSuggestionLine(suggestion, product, supplierProduct, input.id, input));
  });

  manualItems.forEach((item) => {
    const validation = validateManualPurchaseItem(item, input);
    errors.push(...validation.errors);
    if (!validation.valid) return;
    const existing = lineByProduct.get(item.productId);
    if (existing) {
      const requestedUnitPrice = item.unitPrice ?? existing.unitPrice ?? validation.supplierProduct.purchasePrice ?? 0;
      if (!purchaseConditionsMatch(existing, validation.supplierProduct, requestedUnitPrice)) {
        errors.push(`${item.productId}：人工新增品項與既有建議的採購單位、單價、MOQ 或倍數不同，請先確認條件，不得靜默建立重複明細`);
        return;
      }
      mergeManualEntryIntoLine(existing, { ...item, unitPrice: requestedUnitPrice }, input);
      return;
    }
    addLine(buildManualLine(item, validation.product, validation.supplierProduct, input.id, input));
  });

  const hasSuggestion = lines.some((line) => line.sourceSuggestionId || line.suggestionId);
  const hasManual = lines.some((line) => quantity(line.manualAddedQty) > 0);
  const sourceType = hasSuggestion && hasManual ? "MIXED" : hasSuggestion ? "PURCHASE_SUGGESTION" : "MANUAL";
  return { valid: errors.length === 0, errors, lines, sourceType };
}

export function addManualPurchaseOrderItem(line, item = {}, input = {}) {
  const validation = validateManualPurchaseItem(item, input);
  if (!validation.valid) return { valid: false, errors: validation.errors, line };
  const next = clone(line);
  const requestedUnitPrice = item.unitPrice ?? next.unitPrice ?? validation.supplierProduct.purchasePrice ?? 0;
  if (!purchaseConditionsMatch(next, validation.supplierProduct, requestedUnitPrice)) {
    return {
      valid: false,
      errors: [`${item.productId}：人工新增品項與既有明細的採購單位、單價、MOQ 或倍數不同，請先確認條件，不得靜默建立重複明細`],
      line,
    };
  }
  mergeManualEntryIntoLine(next, { ...item, unitPrice: requestedUnitPrice }, input);
  return { valid: true, errors: [], line: next };
}

export function getProcurementPreviousCompleteMonths(referenceDate, count = 6) {
  const parsed = new Date(`${String(referenceDate || "").slice(0, 10)}T00:00:00Z`);
  const baseDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const months = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    const monthDate = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() - offset, 1));
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth() + 1;
    months.push({ year, month, label: `${year}-${String(month).padStart(2, "0")}` });
  }
  return months;
}

function numericField(row = {}, camelName, snakeName) {
  return quantity(row[camelName] ?? row[snakeName]);
}

function salesSnapshotForLocation(salesRows, locationId, productId, months) {
  const monthMap = new Map(
    (salesRows || [])
      .filter((row) => (row.locationId ?? row.location_id) === locationId && (row.productId ?? row.product_id) === productId)
      .map((row) => [`${numericField(row, "salesYear", "sales_year")}-${String(numericField(row, "salesMonth", "sales_month")).padStart(2, "0")}`, numericField(row, "salesQty", "sales_qty")]),
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
    recentMonthQty: values.length ? values[values.length - 1] : 0,
  };
}

function purchaseInboundForProduct(purchaseOrders, productId) {
  return (purchaseOrders || [])
    .filter((order) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status))
    .flatMap((order) => order.lines || [])
    .filter((line) => line.productId === productId)
    .reduce((sum, line) => {
      const remaining = line.remainingQty ?? (quantity(line.orderedQty) - quantity(line.receivedQty) - quantity(line.cancelledQty));
      return sum + Math.max(0, quantity(remaining));
    }, 0);
}

function pendingWarehouseAllocationForProduct(input, productId) {
  const lineById = new Map((input.purchaseOrders || []).flatMap((order) => (order.lines || []).map((line) => [line.id, line])));
  const planRows = input.purchaseOrderItemStoreAllocations?.length ? input.purchaseOrderItemStoreAllocations : (input.purchaseOrderItemDistributionPlans || []);
  return planRows
    .filter((plan) => plan.status !== "CANCELLED" && planLocationId(plan) && lineById.get(plan.purchaseOrderItemId)?.productId === productId)
    .reduce((sum, plan) => sum + Math.max(0, quantity(plan.plannedDistributionQty ?? plan.confirmedAllocationQty) - quantity(plan.actualAllocatedQty)), 0);
}

function storeInTransitForProduct(input, locationId, productId) {
  return (input.allocations || input.allocationOrders || [])
    .filter((allocation) => allocation.destinationLocationId === locationId && allocation.status !== "CANCELLED")
    .flatMap((allocation) => allocation.items || [])
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + Math.max(0, quantity(item.shippedQty ?? item.allocatedQty) - quantity(item.receivedQty)), 0);
}

function openDemandForStore(input, locationId, productId) {
  const openStatuses = new Set(input.openDemandStatuses || PURCHASE_DEMAND_STATUSES);
  return (input.demands || [])
    .filter((demand) => demand.locationId === locationId && (!demand.status || openStatuses.has(demand.status)))
    .flatMap((demand) => demand.items || [])
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => {
      const committed = quantity(item.finalRequestedQty ?? (quantity(item.approvedQty) > 0 ? item.approvedQty : item.requestedQty));
      const fulfilled = quantity(item.allocatedQty) + quantity(item.receivedQty) + quantity(item.cancelledQty);
      return sum + Math.max(0, committed - fulfilled);
    }, 0);
}

export function buildProcurementProductSnapshot(input = {}) {
  const locations = input.locations || [];
  const stores = locations.filter((location) => location.type === "STORE" && location.isActive !== false);
  const warehouse = locations.find((location) => location.id === (input.warehouseLocationId || "warehouse") && location.type === "WAREHOUSE")
    || locations.find((location) => location.type === "WAREHOUSE")
    || { id: input.warehouseLocationId || "warehouse", name: "中央總倉", type: "WAREHOUSE" };
  const inventoryRows = input.inventory || input.inventoryBalances || [];
  const salesRows = input.monthlyProductSales || [];
  const productId = input.productId;
  const months = getProcurementPreviousCompleteMonths(input.referenceDate, 6);
  const inventoryFor = (locationId) => {
    const row = inventoryRows.find((item) => (item.locationId ?? item.location_id) === locationId && (item.productId ?? item.product_id) === productId);
    const onHandQty = numericField(row, "onHandQty", "on_hand_qty");
    const reservedQty = numericField(row, "reservedQty", "reserved_qty");
    return { locationId, onHandQty, reservedQty, availableQty: Math.max(0, onHandQty - reservedQty), hasBalance: Boolean(row) };
  };
  const storeRows = stores.map((location) => ({
    locationId: location.id,
    locationName: location.name,
    inventory: inventoryFor(location.id),
    sales: salesSnapshotForLocation(salesRows, location.id, productId, months),
    allocatedInTransitQty: storeInTransitForProduct(input, location.id, productId),
    openDemandQty: openDemandForStore(input, location.id, productId),
  }));
  const warehouseInventory = inventoryFor(warehouse.id);
  const purchaseInboundQty = purchaseInboundForProduct(input.purchaseOrders, productId);
  const pendingWarehouseAllocationQty = pendingWarehouseAllocationForProduct(input, productId);
  const storeInventoryTotal = storeRows.reduce((total, row) => ({
    onHandQty: total.onHandQty + row.inventory.onHandQty,
    reservedQty: total.reservedQty + row.inventory.reservedQty,
    availableQty: total.availableQty + row.inventory.availableQty,
  }), { onHandQty: 0, reservedQty: 0, availableQty: 0 });
  const companySalesTotal = storeRows.reduce((sum, row) => sum + row.sales.total, 0);
  const companySalesMonths = months.map((month, index) => ({ ...month, salesQty: storeRows.reduce((sum, row) => sum + row.sales.months[index].salesQty, 0) }));
  const companySalesValues = companySalesMonths.map((month) => month.salesQty);
  const companySales = {
    months: companySalesMonths,
    total: companySalesTotal,
    average: companySalesTotal / months.length,
    max: companySalesValues.length ? Math.max(...companySalesValues) : 0,
    min: companySalesValues.length ? Math.min(...companySalesValues) : 0,
    stores: storeRows.map((row) => ({ locationId: row.locationId, total: row.sales.total, share: companySalesTotal > 0 ? row.sales.total / companySalesTotal : 0 })),
  };
  return {
    productId,
    months,
    stores: storeRows,
    warehouse: {
      locationId: warehouse.id,
      locationName: warehouse.name,
      inventory: warehouseInventory,
      sales: null,
      purchaseInboundQty,
      pendingAllocationQty: pendingWarehouseAllocationQty,
    },
    storeInventoryTotal,
    companyInventory: {
      onHandQty: storeInventoryTotal.onHandQty + warehouseInventory.onHandQty,
      reservedQty: storeInventoryTotal.reservedQty + warehouseInventory.reservedQty,
      availableQty: storeInventoryTotal.availableQty + warehouseInventory.availableQty,
    },
    companySales,
  };
}

function storeLocationsForPlans(input = {}) {
  return (input.locations || input.storeLocations || []).filter((location) => location.type === "STORE" && location.isActive !== false);
}

function planKey(purchaseOrderItemId, destinationLocationId) {
  return `${purchaseOrderItemId}::${destinationLocationId}`;
}

function planLocationId(plan = {}) {
  return plan.destinationLocationId ?? plan.locationId ?? null;
}

export function calculateWarehousePlannedRetentionQty(confirmedOrderQty, plans = []) {
  const plannedDistributionQty = plans.reduce((sum, plan) => sum + quantity(plan.plannedDistributionQty ?? plan.confirmedAllocationQty), 0);
  const confirmedQty = quantity(confirmedOrderQty);
  return {
    confirmedOrderQty: confirmedQty,
    plannedDistributionQty,
    warehousePlannedRetentionQty: Math.max(0, confirmedQty - plannedDistributionQty),
    overAllocatedQty: Math.max(0, plannedDistributionQty - confirmedQty),
  };
}

export function buildPurchaseOrderItemDistributionPlans(order, input = {}) {
  const locations = storeLocationsForPlans(input);
  const existing = new Map((input.existingPlans || []).map((plan) => [planKey(plan.purchaseOrderItemId, planLocationId(plan)), plan]));
  const createdAt = input.createdAt || null;
  const plans = (order?.lines || []).flatMap((line) => {
    const sourceDemandByLocation = new Map();
    (line.sourceAllocations || []).forEach((source) => {
      if (!source.locationId) return;
      sourceDemandByLocation.set(source.locationId, (sourceDemandByLocation.get(source.locationId) || 0) + quantity(source.allocatedQty));
    });
    return locations.map((location) => {
      const sourceDemandQty = sourceDemandByLocation.get(location.id) || 0;
      const previous = existing.get(planKey(line.id, location.id));
      const suggestedDistributionQty = sourceDemandQty;
      return {
        id: previous?.id || (input.createId ? input.createId("distributionPlan") : `${line.id}_distribution_${location.id}`),
        purchaseOrderId: order.id,
        purchaseOrderItemId: line.id,
        destinationLocationId: location.id,
        locationId: location.id,
        sourceDemandQty,
        suggestedDistributionQty,
        suggestedAllocationQty: suggestedDistributionQty,
        plannedDistributionQty: previous ? quantity(previous.plannedDistributionQty ?? previous.confirmedAllocationQty) : suggestedDistributionQty,
        confirmedAllocationQty: previous ? quantity(previous.confirmedAllocationQty ?? previous.plannedDistributionQty) : suggestedDistributionQty,
        deliveryMode: previous?.deliveryMode || line.deliveryMode || "WAREHOUSE_DISTRIBUTION",
        warehouseReceiptLocationId: previous?.warehouseReceiptLocationId || line.warehouseReceiptLocationId || order.warehouseReceiptLocationId || "warehouse",
        plannedDeliveryQty: previous ? quantity(previous.plannedDeliveryQty ?? previous.plannedDistributionQty ?? previous.confirmedAllocationQty) : suggestedDistributionQty,
        expectedDeliveryDate: previous?.expectedDeliveryDate || line.expectedDeliveryDate || order.expectedDeliveryDate || null,
        actualAllocatedQty: quantity(previous?.actualAllocatedQty),
        actualReceivedQty: quantity(previous?.actualReceivedQty),
        allocationReason: previous?.allocationReason || previous?.planningReason || null,
        planningReason: previous?.planningReason || (suggestedDistributionQty > 0 ? "依來源需求自動帶入" : ""),
        createdBy: previous?.createdBy || input.createdBy || null,
        updatedBy: input.updatedBy || input.createdBy || previous?.updatedBy || null,
        createdAt: previous?.createdAt || createdAt,
        updatedAt: createdAt,
      };
    });
  });
  return plans;
}

export function validatePurchaseOrderDistributionPlans(order, plans = [], input = {}) {
  const errors = [];
  plans = (plans || []).map((plan) => ({
    ...plan,
    destinationLocationId: plan.destinationLocationId ?? plan.locationId,
    suggestedDistributionQty: plan.suggestedDistributionQty ?? plan.suggestedAllocationQty ?? plan.sourceDemandQty,
    plannedDistributionQty: plan.plannedDistributionQty ?? plan.confirmedAllocationQty ?? 0,
    actualAllocatedQty: plan.actualAllocatedQty ?? plan.actual_allocated_qty ?? 0,
    actualReceivedQty: plan.actualReceivedQty ?? plan.actual_received_qty ?? 0,
    planningReason: plan.planningReason ?? plan.allocationReason ?? "",
  }));
  const locations = storeLocationsForPlans(input);
  const storeIds = new Set(locations.map((location) => location.id));
  const planMap = new Map();
  plans.forEach((plan) => {
    const key = planKey(plan.purchaseOrderItemId, plan.destinationLocationId);
    if (planMap.has(key)) errors.push(`${plan.purchaseOrderItemId}/${plan.destinationLocationId}：同一商品與門市只能有一筆配貨規劃`);
    planMap.set(key, plan);
    const rawPlannedQty = Number(plan.plannedDistributionQty);
    if (!Number.isFinite(rawPlannedQty) || !Number.isInteger(rawPlannedQty)) errors.push(`${plan.purchaseOrderItemId}/${plan.destinationLocationId}：預計配貨量必須是非負整數`);
    if (rawPlannedQty < 0) errors.push(`${plan.purchaseOrderItemId}/${plan.destinationLocationId}：預計配貨量不得小於 0`);
    if (!storeIds.has(plan.destinationLocationId)) errors.push(`${plan.purchaseOrderItemId}：配貨目的地必須是啟用中的 STORE`);
    if (quantity(plan.plannedDistributionQty) !== Number(plan.plannedDistributionQty ?? 0)) errors.push(`${plan.purchaseOrderItemId}/${plan.destinationLocationId}：預計配貨量必須是非負整數`);
    if (quantity(plan.plannedDistributionQty) < 0) errors.push(`${plan.purchaseOrderItemId}/${plan.destinationLocationId}：預計配貨量不得小於 0`);
  });
  const summaries = [];
  (order?.lines || []).forEach((line) => {
    const linePlans = plans.filter((plan) => plan.purchaseOrderItemId === line.id);
    locations.forEach((location) => {
      if (!linePlans.some((plan) => plan.destinationLocationId === location.id)) errors.push(`${line.productId}/${location.id}：缺少門市配貨規劃`);
    });
    linePlans.forEach((plan) => {
      const suggested = quantity(plan.suggestedDistributionQty);
      const planned = quantity(plan.plannedDistributionQty);
      if (planned !== suggested && !String(plan.planningReason || "").trim()) errors.push(`${line.productId}/${plan.destinationLocationId}：修改預計配貨量必須填寫原因`);
      if (planned > quantity(plan.sourceDemandQty) && !String(plan.planningReason || "").trim()) errors.push(`${line.productId}/${plan.destinationLocationId}：超過原始需求的配貨量必須填寫原因`);
    });
    const summary = calculateWarehousePlannedRetentionQty(line.confirmedOrderQty ?? line.confirmedPurchaseQty ?? line.orderedQty, linePlans);
    if (summary.overAllocatedQty > 0) errors.push(`${line.productId}：門市預計配貨合計超過採購量 ${summary.overAllocatedQty} 件`);
    summaries.push({ purchaseOrderItemId: line.id, ...summary, unmetDemandByLocation: linePlans.map((plan) => ({ destinationLocationId: plan.destinationLocationId, unmetDemandQty: Math.max(0, quantity(plan.sourceDemandQty) - quantity(plan.plannedDistributionQty)) })), plans: linePlans });
  });
  return { valid: errors.length === 0, errors, summaries };
}

export function applyPurchaseOrderDistributionPlans(order, plans = [], input = {}) {
  const validation = validatePurchaseOrderDistributionPlans(order, plans, input);
  if (!validation.valid) return { committed: false, order, plans, ...validation };
  const nextOrder = clone(order);
  const summaryMap = new Map(validation.summaries.map((summary) => [summary.purchaseOrderItemId, summary]));
  nextOrder.lines = (nextOrder.lines || []).map((line) => ({
    ...line,
    plannedStoreAllocationQty: summaryMap.get(line.id)?.plannedDistributionQty || 0,
    warehousePlannedRetentionQty: summaryMap.get(line.id)?.warehousePlannedRetentionQty || 0,
    warehouseBufferQty: summaryMap.get(line.id)?.warehousePlannedRetentionQty || 0,
  }));
  return { committed: true, order: nextOrder, plans: clone(validation.summaries.flatMap((summary) => summary.plans)), ...validation };
}

export function buildPurchaseOrderItemSources(order, input = {}) {
  const createdAt = input.createdAt || order?.createdAt || null;
  const createdBy = input.createdBy || order?.createdBy || null;
  return (order?.lines || []).flatMap((line) => {
    const rows = [];
    (line.sourceAllocations || []).forEach((source) => {
      const sourceQty = quantity(source.allocatedQty);
      if (sourceQty <= 0) return;
      rows.push({
        id: source.id || (input.createId ? input.createId("purchaseOrderItemSource") : null),
        purchaseOrderItemId: line.id,
        sourceType: "DEMAND_SUGGESTION",
        demandOrderId: source.demandOrderId || null,
        demandOrderItemId: source.demandOrderItemId || null,
        purchaseSuggestionId: line.sourceSuggestionId || line.suggestionId || null,
        sourceLocationId: source.locationId || null,
        sourceQty,
        manualReason: null,
        createdBy: source.createdBy || createdBy,
        createdAt: source.createdAt || createdAt,
      });
    });
    const warehouseQty = quantity(line.warehouseReplenishmentQty ?? line.warehouseSupplementQty);
    if (warehouseQty > 0 && (line.sourceSuggestionId || line.suggestionId)) {
      rows.push({
        id: input.createId ? input.createId("purchaseOrderItemSource") : null,
        purchaseOrderItemId: line.id,
        sourceType: "WAREHOUSE_REPLENISHMENT",
        demandOrderId: null,
        demandOrderItemId: null,
        purchaseSuggestionId: line.sourceSuggestionId || line.suggestionId || null,
        sourceLocationId: line.deliveryLocationId || order?.deliveryLocationId || "warehouse",
        sourceQty: warehouseQty,
        manualReason: null,
        createdBy,
        createdAt,
      });
    }
    const entries = (line.manualAddEntries || []).filter((entry) => quantity(entry.quantity) > 0);
    if (entries.length) {
      entries.forEach((entry) => rows.push({
        id: input.createId ? input.createId("purchaseOrderItemSource") : null,
        purchaseOrderItemId: line.id,
        sourceType: "MANUAL_ADDITION",
        demandOrderId: null,
        demandOrderItemId: null,
        purchaseSuggestionId: line.sourceSuggestionId || line.suggestionId || null,
        sourceLocationId: line.deliveryLocationId || order?.deliveryLocationId || "warehouse",
        sourceQty: quantity(entry.quantity),
        manualReason: entry.reason || entry.reasonDetail || line.manualAddReason || null,
        createdBy: entry.addedBy || createdBy,
        createdAt: entry.addedAt || createdAt,
      }));
    } else if (quantity(line.manualAddedQty) > 0) {
      rows.push({
        id: input.createId ? input.createId("purchaseOrderItemSource") : null,
        purchaseOrderItemId: line.id,
        sourceType: "MANUAL_ADDITION",
        demandOrderId: null,
        demandOrderItemId: null,
        purchaseSuggestionId: line.sourceSuggestionId || line.suggestionId || null,
        sourceLocationId: line.deliveryLocationId || order?.deliveryLocationId || "warehouse",
        sourceQty: quantity(line.manualAddedQty),
        manualReason: line.manualAddReason || line.manualReasonDetail || null,
        createdBy: line.manualAddedBy || createdBy,
        createdAt: line.manualAddedAt || createdAt,
      });
    }
    return rows;
  });
}

function noGroupSourceRefs(suggestion) {
  return (suggestion?.sourceAllocations || []).map((source) => ({
    demandOrderId: source.demandOrderId || null,
    demandOrderItemId: source.demandOrderItemId || null,
    sourceQty: quantity(source.allocatedQty),
  })).filter((source) => source.demandOrderId && source.demandOrderItemId);
}

function appendProcurementStatusLog(state, row) {
  state.procurementStatusLogs = state.procurementStatusLogs || [];
  state.procurementStatusLogs.unshift(row);
}

function updateDemandProcurementStatus(state, source, input, status, reason, note) {
  const demand = (state.demands || []).find((candidate) => candidate.id === source.demandOrderId);
  const item = demand?.items?.find((candidate) => candidate.id === source.demandOrderItemId);
  if (!item) return;
  item.procurementStatus = status;
  item.procurementStatusReason = reason || null;
  item.procurementStatusNote = note || null;
  item.procurementStatusUpdatedAt = input.changedAt || input.createdAt || null;
  item.purchaseSuggestionId = input.suggestionId || item.purchaseSuggestionId || null;
  appendProcurementStatusLog(state, {
    id: input.createId ? input.createId("procurementStatusLog") : null,
    demandOrderId: source.demandOrderId,
    demandOrderItemId: source.demandOrderItemId,
    purchaseSuggestionId: input.suggestionId || null,
    purchaseOrderId: null,
    previousStatus: item.procurementStatusBefore || null,
    nextStatus: status,
    reason: reason || null,
    note: note || null,
    changedBy: input.actorId || null,
    changedAt: input.changedAt || input.createdAt || null,
  });
  delete item.procurementStatusBefore;
}

export function markPurchaseSuggestionNoGroup(sourceState, input = {}) {
  const original = clone(sourceState);
  const state = clone(sourceState);
  try {
    if (!canManagePurchaseOrders({ role: input.actorRole || input.role, isActive: input.isActive !== false })) throw new Error("只有採購人員或管理員可以標記無成團");
    const reason = String(input.reason || input.noGroupReason || "").trim();
    const note = String(input.note || input.noGroupNote || "").trim();
    if (!NO_GROUP_REASONS.includes(reason)) throw new Error("無成團原因不合法");
    if (reason === "OTHER" && !note) throw new Error("選擇其他原因時必須填寫說明");
    const requestedIds = input.suggestionIds || input.suggestionId;
    const ids = Array.isArray(requestedIds)
      ? requestedIds
      : String(requestedIds || "").split(",").map((id) => id.trim()).filter(Boolean);
    let suggestions = (state.purchaseSuggestions || []).filter((suggestion) => ids.includes(suggestion.id));
    if (!suggestions.length && input.supplierId) {
      suggestions = (state.purchaseSuggestions || []).filter((suggestion) => suggestion.supplierId === input.supplierId && !suggestion.purchaseOrderId && PURCHASE_SUGGESTION_OPEN_STATUSES.has(suggestion.status || "PENDING"));
    }
    if (!suggestions.length) throw new Error("找不到可標記無成團的採購建議");
    if (suggestions.some((suggestion) => suggestion.purchaseOrderId || ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(suggestion.status))) throw new Error("已建立採購單或已下單的建議不可標記無成團");
    const changedAt = input.changedAt || input.createdAt || null;
    suggestions.forEach((suggestion) => {
      const previousStatus = suggestion.procurementStatus || suggestion.status || "WAITING_AGGREGATION";
      suggestion.status = "NO_GROUP";
      suggestion.procurementStatus = "NO_GROUP";
      suggestion.noGroupReason = reason;
      suggestion.noGroupNote = note || null;
      suggestion.noGroupBy = input.actorId || null;
      suggestion.noGroupAt = changedAt;
      suggestion.noGroupHistory = [...(suggestion.noGroupHistory || []), { status: "NO_GROUP", reason, note: note || null, changedBy: input.actorId || null, changedAt }];
      noGroupSourceRefs(suggestion).forEach((source) => {
        const demand = (state.demands || []).find((candidate) => candidate.id === source.demandOrderId);
        const item = demand?.items?.find((candidate) => candidate.id === source.demandOrderItemId);
        if (!item) return;
        item.procurementStatusBefore = item.procurementStatus || null;
        updateDemandProcurementStatus(state, source, { ...input, suggestionId: suggestion.id }, "NO_GROUP", reason, note);
      });
      appendProcurementStatusLog(state, {
        id: input.createId ? input.createId("procurementStatusLog") : null,
        purchaseSuggestionId: suggestion.id,
        previousStatus,
        nextStatus: "NO_GROUP",
        reason,
        note: note || null,
        changedBy: input.actorId || null,
        changedAt,
      });
      state.auditLogs = state.auditLogs || [];
      state.auditLogs.unshift({
        id: input.auditId || (input.createId ? input.createId("audit") : null),
        action: "PURCHASE_SUGGESTION_NO_GROUP",
        entityType: "PURCHASE_SUGGESTION",
        entityId: suggestion.id,
        userId: input.actorId || null,
        detail: reason,
        metadata: { reason, sourceDemandIds: [...new Set(noGroupSourceRefs(suggestion).map((source) => source.demandOrderId))] },
        createdAt: changedAt,
      });
    });
    return { committed: true, state, updatedSuggestions: suggestions.map((suggestion) => suggestion.id) };
  } catch (error) {
    return { committed: false, state: original, updatedSuggestions: [], error };
  }
}

export function reopenPurchaseSuggestion(sourceState, input = {}) {
  const original = clone(sourceState);
  const state = clone(sourceState);
  try {
    if (!canManagePurchaseOrders({ role: input.actorRole || input.role, isActive: input.isActive !== false })) throw new Error("只有採購人員或管理員可以重新開啟採購建議");
    const suggestion = (state.purchaseSuggestions || []).find((item) => item.id === input.suggestionId);
    if (!suggestion || suggestion.status !== "NO_GROUP") throw new Error("只有無成團採購建議可以重新開啟");
    const changedAt = input.changedAt || input.createdAt || null;
    const nextStatus = input.nextStatus === "WAITING_AGGREGATION" ? "WAITING_AGGREGATION" : "REOPENED";
    suggestion.status = nextStatus;
    suggestion.procurementStatus = nextStatus;
    suggestion.reopenedBy = input.actorId || null;
    suggestion.reopenedAt = changedAt;
    suggestion.noGroupHistory = [...(suggestion.noGroupHistory || []), { status: nextStatus, reason: suggestion.noGroupReason || null, note: suggestion.noGroupNote || null, changedBy: input.actorId || null, changedAt }];
    noGroupSourceRefs(suggestion).forEach((source) => {
      const demand = (state.demands || []).find((candidate) => candidate.id === source.demandOrderId);
      const item = demand?.items?.find((candidate) => candidate.id === source.demandOrderItemId);
      if (!item) return;
      item.procurementStatus = nextStatus;
      item.procurementStatusUpdatedAt = changedAt;
      appendProcurementStatusLog(state, { id: input.createId ? input.createId("procurementStatusLog") : null, demandOrderId: source.demandOrderId, demandOrderItemId: source.demandOrderItemId, purchaseSuggestionId: suggestion.id, previousStatus: "NO_GROUP", nextStatus, reason: suggestion.noGroupReason || null, note: suggestion.noGroupNote || null, changedBy: input.actorId || null, changedAt });
    });
    state.auditLogs = state.auditLogs || [];
    state.auditLogs.unshift({ id: input.auditId || (input.createId ? input.createId("audit") : null), action: "PURCHASE_SUGGESTION_REOPENED", entityType: "PURCHASE_SUGGESTION", entityId: suggestion.id, userId: input.actorId || null, detail: suggestion.noGroupReason || "", metadata: { previousNoGroupAt: suggestion.noGroupAt || null }, createdAt: changedAt });
    return { committed: true, state, suggestion };
  } catch (error) {
    return { committed: false, state: original, error };
  }
}

function basePurchaseOrder(input = {}) {
  const supplier = input.supplier || {};
  const orderDate = input.orderDate || null;
  const expectedDeliveryDate = input.expectedDeliveryDate || orderDate;
  const lines = input.lines || [];
  const minimumOrderAmount = input.supplierMinimumOrderAmount ?? supplier.minimumOrderAmount ?? 0;
  const totals = calculatePurchaseOrderTotals(lines, { supplierMinimumOrderAmount: minimumOrderAmount, taxRateBasisPoints: input.taxRateBasisPoints || 0 });
  return {
    id: input.id,
    purchaseOrderNumber: input.purchaseOrderNumber,
    supplierId: input.supplierId,
    status: "DRAFT",
    sourceType: input.sourceType || "PURCHASE_SUGGESTION",
    orderDate,
    expectedDeliveryDate,
    actualFirstReceivedDate: null,
    actualCompletedDate: null,
    currency: input.currency || "TWD",
    taxType: input.taxType || "NONE",
    subtotalAmount: totals.subtotalAmount,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    subtotalAmountCents: totals.subtotalCents,
    taxAmountCents: totals.taxCents,
    totalAmountCents: totals.totalCents,
    supplierMinimumOrderAmount: String(minimumOrderAmount ?? "0"),
    minimumAmountMet: totals.minimumAmountMet,
    minimumAmountShortfall: centsToDecimal(totals.minimumAmountShortfallCents),
    overrideReason: input.overrideReason || null,
    overriddenBy: input.overrideReason ? input.createdBy || null : null,
    overriddenAt: input.overrideReason ? input.createdAt || null : null,
    notes: input.notes || "",
    supplierContactName: input.supplierContactName || supplier.contact || supplier.contactName || "",
    supplierContactPhone: input.supplierContactPhone || supplier.phone || "",
    supplierContactEmail: input.supplierContactEmail || supplier.email || "",
    paymentTerms: input.paymentTerms || "",
    deliveryLocationId: input.deliveryLocationId || "warehouse",
    createdBy: input.createdBy || null,
    confirmedBy: null,
    orderedBy: null,
    cancelledBy: null,
    closedBy: null,
    createdAt: input.createdAt || null,
    confirmedAt: null,
    orderedAt: null,
    cancelledAt: null,
    closedAt: null,
    updatedAt: input.createdAt || null,
    validationErrors: input.validationErrors || [],
    lines,
  };
}

export function createPurchaseOrderDraft(input = {}) {
  const merged = mergePurchaseOrderItems(input);
  return basePurchaseOrder({
    ...input,
    lines: merged.lines,
    sourceType: input.sourceType || merged.sourceType,
    validationErrors: merged.errors,
  });
}

export function createManualPurchaseOrderDraft(input = {}) {
  return createPurchaseOrderDraft({
    ...input,
    suggestions: [],
    manualItems: input.items || input.manualItems || [],
    sourceType: "MANUAL",
    applyPurchaseRounding: false,
  });
}

export function validatePurchaseOrderConfirmation(order, input = {}) {
  const errors = [];
  const supplier = (input.suppliers || []).find((item) => item.id === order?.supplierId);
  const products = input.products || [];
  const supplierProducts = input.supplierProducts || [];
  const overrideReason = String(order?.overrideReason || "").trim();
  const lines = order?.lines || [];
  if (!order || order.status !== "DRAFT") errors.push("只有草稿採購單可以確認");
  if (!lines.length) errors.push("採購單至少需要一項商品");
  if (supplier && supplier.isActive === false) errors.push("供應商已停用");
  if (!supplier && order?.supplierId) errors.push("找不到供應商");
  const duplicateIds = new Set(input.existingSuggestionIds || []);
  const lineSuggestionIds = new Set();
  const lineProductIds = new Set();
  let quantityException = false;
  let minimumQuantityException = false;
  lines.forEach((line) => {
    const product = products.find((item) => item.id === line.productId);
    const supplierProduct = findSupplierProduct(line.productId, order?.supplierId, supplierProducts);
    const orderedQty = quantity(line.orderedQty);
    const unitPriceCents = decimalToCents(line.unitPrice ?? line.purchasePrice);
    const multiple = normalizePurchaseMultiple(line.purchaseMultiple ?? supplierProduct?.purchaseMultiple);
    const minimumQty = quantity(line.minimumOrderQuantity ?? supplierProduct?.minimumOrderQuantity);
    if (lineProductIds.has(line.productId)) errors.push(`${line.productId || "商品"}：同一採購單不可重複建立相同商品明細`);
    lineProductIds.add(line.productId);
    if (!product || product.isActive === false) errors.push(`${line.productId || "商品"}：商品不存在或已停用`);
    if (product && !isProductPurchasable(product)) errors.push(`${line.productId || "商品"}：商品尚未完成採購設定，不能確認採購單`);
    if (!supplierProduct || supplierProduct.isActive === false) errors.push(`${line.productId || "商品"}：商品不是此供應商的有效供應品`);
    if (orderedQty <= 0) errors.push(`${line.productId || "商品"}：採購數量必須大於 0`);
    if (unitPriceCents < 0) errors.push(`${line.productId || "商品"}：採購單價不得小於 0`);
    if (order?.expectedDeliveryDate && order.orderDate && order.expectedDeliveryDate < order.orderDate) errors.push("預計到貨日不得早於採購日期");
    if (orderedQty > 0 && orderedQty % multiple !== 0) {
      quantityException = true;
      if (!overrideReason) errors.push(`${line.productId || "商品"}：採購數量不符合採購倍數 ${multiple}`);
    }
    if (orderedQty > 0 && orderedQty < minimumQty) {
      minimumQuantityException = true;
      if (!overrideReason) errors.push(`${line.productId || "商品"}：採購數量未達最低採購量 ${minimumQty}`);
    }
    const suggestionId = line.sourceSuggestionId || line.suggestionId;
    if (suggestionId) {
      if (lineSuggestionIds.has(suggestionId) || duplicateIds.has(suggestionId)) errors.push("同一採購建議不得重複建立採購單");
      lineSuggestionIds.add(suggestionId);
    }
    if (["MANUAL_ADDITION", "MANUAL_WAREHOUSE_STOCK"].includes(line.sourceType) && (quantity(line.demandAllocatedQty) > 0 || (line.sourceAllocations || []).length)) {
      errors.push(`${line.productId || "商品"}：人工備貨明細不得建立門市需求分配`);
    }
  });
  const supplierMinimumOrderAmount = order?.supplierMinimumOrderAmount ?? supplier?.minimumOrderAmount ?? 0;
  const totals = calculatePurchaseOrderTotals(lines, { supplierMinimumOrderAmount, taxRateBasisPoints: order?.taxRateBasisPoints || 0 });
  const amountException = !totals.minimumAmountMet;
  if (amountException && !overrideReason) errors.push(`未達供應商最低採購金額，尚差 ${centsToDecimal(totals.minimumAmountShortfallCents)} 元`);
  return {
    valid: errors.length === 0,
    errors,
    overrideRequired: Boolean(quantityException || minimumQuantityException || amountException),
    overrideReason,
    minimumAmountMet: totals.minimumAmountMet,
    minimumAmountShortfallCents: totals.minimumAmountShortfallCents,
    totals,
  };
}

export function buildDemandPurchaseAllocations(order) {
  return (order?.lines || []).flatMap((line) => (line.sourceAllocations || []).filter((source) => quantity(source.allocatedQty) > 0).map((source) => ({
    id: source.id || null,
    demandOrderId: source.demandOrderId,
    demandOrderItemId: source.demandOrderItemId,
    purchaseOrderId: order.id,
    purchaseOrderItemId: line.id,
    allocatedQty: quantity(source.allocatedQty),
    receivedAllocatedQty: quantity(source.receivedAllocatedQty),
    cancelledAllocatedQty: quantity(source.cancelledAllocatedQty),
    createdAt: source.createdAt || order.createdAt || null,
    updatedAt: source.updatedAt || order.createdAt || null,
  })));
}

export function getPurchaseOrderMetrics(order = {}) {
  const lines = order.lines || [];
  const orderedQty = lines.reduce((sum, line) => sum + quantity(line.orderedQty), 0);
  const receivedQty = lines.reduce((sum, line) => sum + quantity(line.receivedQty), 0);
  const cancelledQty = lines.reduce((sum, line) => sum + quantity(line.cancelledQty), 0);
  const remainingQty = lines.reduce((sum, line) => sum + Math.max(0, quantity(line.orderedQty) - quantity(line.receivedQty) - quantity(line.cancelledQty)), 0);
  return { orderedQty, receivedQty, cancelledQty, remainingQty, lineCount: lines.length, hasReceipt: receivedQty > 0, complete: remainingQty === 0 };
}

export function transitionPurchaseOrder(order, nextStatus, input = {}) {
  const errors = [];
  const currentStatus = order?.status;
  const allowed = PURCHASE_ORDER_TRANSITIONS[currentStatus] || new Set();
  if (!order || !PURCHASE_ORDER_STATUSES.includes(nextStatus) || !allowed.has(nextStatus)) errors.push(`採購單不可由 ${currentStatus || "未知"} 轉為 ${nextStatus}`);
  if (nextStatus === "ORDERED" && currentStatus !== "PENDING_CONFIRMATION") errors.push("只有待確認採購單可以標記已下單");
  if (nextStatus === "CLOSED" && getPurchaseOrderMetrics(order).remainingQty > 0) errors.push("尚有未到貨或未取消數量，不能結案");
  if (nextStatus === "CANCELLED") {
    if (!String(input.reason || "").trim()) errors.push("取消採購單必須填寫原因");
    if (currentStatus === "ORDERED" && getPurchaseOrderMetrics(order).hasReceipt) errors.push("已有到貨紀錄，只能取消剩餘數量並結案");
    if (currentStatus === "PARTIALLY_RECEIVED") errors.push("部分到貨採購單只能取消剩餘數量");
  }
  if (errors.length) return { valid: false, errors, order };
  const changedAt = input.changedAt || input.orderedAt || input.closedAt || input.cancelledAt || null;
  const next = { ...clone(order), status: nextStatus, updatedAt: changedAt };
  if (nextStatus === "PENDING_CONFIRMATION") { next.confirmedBy = input.actorId || null; next.confirmedAt = changedAt; }
  if (nextStatus === "ORDERED") { next.orderedBy = input.actorId || null; next.orderedAt = changedAt; }
  if (nextStatus === "CANCELLED") { next.cancelledBy = input.actorId || null; next.cancelledAt = changedAt; next.cancelReason = String(input.reason || "").trim(); }
  if (nextStatus === "CLOSED") { next.closedBy = input.actorId || null; next.closedAt = changedAt; }
  return { valid: true, errors: [], order: next };
}

export function canEditPurchaseOrderField(status, field) {
  if (status === "DRAFT" || status === "PENDING_CONFIRMATION") return true;
  if (status === "ORDERED" || status === "PARTIALLY_RECEIVED") return PURCHASE_ORDER_MUTABLE_FIELDS.has(field);
  return false;
}

function updateRemaining(line) {
  line.receivedQty = quantity(line.receivedQty);
  line.cancelledQty = quantity(line.cancelledQty);
  line.remainingQty = Math.max(0, quantity(line.orderedQty) - line.receivedQty - line.cancelledQty);
  return line.remainingQty;
}

function updateDemandPurchaseFields(state, demandOrderId, demandOrderItemId) {
  const demand = (state.demands || []).find((item) => item.id === demandOrderId);
  const item = demand?.items?.find((candidate) => candidate.id === demandOrderItemId);
  if (!item) return;
  const allocations = (state.demandPurchaseAllocations || []).filter((row) => row.demandOrderId === demandOrderId && row.demandOrderItemId === demandOrderItemId);
  const ordered = allocations.reduce((sum, row) => sum + Math.max(0, quantity(row.allocatedQty) - quantity(row.cancelledAllocatedQty)), 0);
  const received = allocations.reduce((sum, row) => sum + quantity(row.receivedAllocatedQty), 0);
  item.purchaseOrderedQty = ordered;
  item.purchaseReceivedQty = received;
  const committed = finalRequestedQty(item);
  item.purchaseRequiredQty = Math.max(0, committed - quantity(item.allocatedQty) - signedReceivedQty(item) - ordered - quantity(item.cancelledQty));
  if (item.purchaseRequiredQty > 0 && isPurchaseDemandEligible(demand.status)) demand.status = "WAITING_PURCHASE";
}

function allocateReceiptToDemand(state, line, receivedQty) {
  let remaining = receivedQty;
  const rows = (state.demandPurchaseAllocations || []).filter((row) => row.purchaseOrderItemId === line.id);
  for (const row of rows) {
    const open = Math.max(0, quantity(row.allocatedQty) - quantity(row.receivedAllocatedQty) - quantity(row.cancelledAllocatedQty));
    const take = Math.min(open, remaining);
    if (take <= 0) continue;
    row.receivedAllocatedQty = quantity(row.receivedAllocatedQty) + take;
    row.updatedAt = state.__receiptAt || null;
    const demand = (state.demands || []).find((item) => item.id === row.demandOrderId);
    const item = demand?.items?.find((candidate) => candidate.id === row.demandOrderItemId);
    if (item) item.purchaseReceivedQty = quantity(item.purchaseReceivedQty) + take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return remaining;
}

export function applyPurchaseReceipt(sourceState, input = {}) {
  const state = clone(sourceState);
  const actorRole = input.actorRole;
  const order = (state.purchaseOrders || []).find((item) => item.id === input.orderId);
  try {
    if (!canReceivePurchaseOrders({ role: actorRole, isActive: true })) throw new Error("只有總倉或管理者可以登記採購到貨");
    if (!order || !["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("此採購單目前不可登記到貨");
    const receivedAt = input.receivedAt || null;
    state.__receiptAt = receivedAt;
    let totalReceived = 0;
    for (const line of order.lines || []) {
      const requested = quantity(input.receivedByLine?.[line.id]);
      const remaining = Math.max(0, quantity(line.orderedQty) - quantity(line.receivedQty) - quantity(line.cancelledQty));
      if (requested > remaining) throw new Error(`${line.productId}：到貨數量不得大於剩餘數量 ${remaining}`);
      if (requested <= 0) continue;
      const balance = (state.inventory || []).find((item) => item.locationId === "warehouse" && item.productId === line.productId);
      if (!balance) throw new Error(`${line.productId}：找不到總倉庫存餘額`);
      balance.onHandQty = quantity(balance.onHandQty) + requested;
      balance.updatedAt = receivedAt;
      line.receivedQty = quantity(line.receivedQty) + requested;
      updateRemaining(line);
      allocateReceiptToDemand(state, line, requested);
      totalReceived += requested;
    }
    if (totalReceived <= 0) throw new Error("本次至少需要登記一項到貨數量");
    const metrics = getPurchaseOrderMetrics(order);
    order.status = metrics.remainingQty === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED";
    order.actualFirstReceivedDate = order.actualFirstReceivedDate || receivedAt;
    order.actualCompletedDate = metrics.remainingQty === 0 ? (order.actualCompletedDate || receivedAt) : null;
    order.lastReceivedAt = receivedAt;
    order.lastReceiptNote = input.note || "";
    order.updatedAt = receivedAt;
    (state.auditLogs || (state.auditLogs = [])).unshift({
      id: input.auditId || null,
      action: metrics.remainingQty === 0 ? "PURCHASE_RECEIVED" : "PURCHASE_PARTIALLY_RECEIVED",
      entityType: "PURCHASE_ORDER",
      entityId: order.id,
      userId: input.actorId || null,
      detail: input.note || "",
      createdAt: receivedAt,
    });
    (state.demands || []).forEach((demand) => (demand.items || []).forEach((item) => updateDemandPurchaseFields(state, demand.id, item.id)));
    delete state.__receiptAt;
    return { committed: true, state, order, totalReceived };
  } catch (error) {
    delete state.__receiptAt;
    return { committed: false, state: clone(sourceState), error };
  }
}

function cancelLineRemaining(line, quantityToCancel) {
  const remaining = Math.max(0, quantity(line.orderedQty) - quantity(line.receivedQty) - quantity(line.cancelledQty));
  const amount = Math.min(remaining, quantityToCancel);
  line.cancelledQty = quantity(line.cancelledQty) + amount;
  updateRemaining(line);
  return amount;
}

function cancelAllocationRemaining(state, line, amount, cancelledAt) {
  let remaining = amount;
  const rows = (state.demandPurchaseAllocations || []).filter((row) => row.purchaseOrderItemId === line.id);
  for (const row of rows) {
    const open = Math.max(0, quantity(row.allocatedQty) - quantity(row.receivedAllocatedQty) - quantity(row.cancelledAllocatedQty));
    const take = Math.min(open, remaining);
    if (take <= 0) continue;
    row.cancelledAllocatedQty = quantity(row.cancelledAllocatedQty) + take;
    row.updatedAt = cancelledAt;
    remaining -= take;
    if (remaining <= 0) break;
  }
}

export function cancelPurchaseOrder(sourceOrOrder, input = {}) {
  const isState = Boolean(sourceOrOrder && Array.isArray(sourceOrOrder.purchaseOrders));
  const state = isState ? clone(sourceOrOrder) : null;
  const order = isState ? state.purchaseOrders.find((item) => item.id === input.orderId) : sourceOrOrder;
  const reason = String(input.reason || "").trim();
  try {
    if (!reason) throw new Error("取消採購單必須填寫原因");
    if (!order) throw new Error("找不到採購單");
    const metrics = getPurchaseOrderMetrics(order);
    if (input.remainingOnly) {
      if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("此採購單目前不可取消剩餘數量");
      for (const line of order.lines || []) {
        const cancelled = cancelLineRemaining(line, input.lineQuantities?.[line.id] ?? getPurchaseOrderMetrics({ lines: [line] }).remainingQty);
        cancelAllocationRemaining(state || { demandPurchaseAllocations: [] }, line, cancelled, input.cancelledAt || null);
      }
      if (state) {
        (state.demands || []).forEach((demand) => (demand.items || []).forEach((item) => updateDemandPurchaseFields(state, demand.id, item.id)));
        const stateOrder = state.purchaseOrders.find((item) => item.id === order.id);
        stateOrder.cancelReason = reason;
        stateOrder.updatedAt = input.cancelledAt || null;
        (state.auditLogs || (state.auditLogs = [])).unshift({ action: "PURCHASE_REMAINING_CANCELLED", entityType: "PURCHASE_ORDER", entityId: order.id, userId: input.actorId || null, detail: reason, createdAt: input.cancelledAt || null });
        return { committed: true, state, order: stateOrder };
      }
      return { committed: true, order: { ...order, lines: order.lines.map((line) => ({ ...line })), cancelReason: reason } };
    }
    const transition = transitionPurchaseOrder(order, "CANCELLED", input);
    if (!transition.valid) throw new Error(transition.errors.join("；"));
    const cancelledOrder = transition.order;
    cancelledOrder.lines = (cancelledOrder.lines || []).map((line) => {
      const copy = { ...line };
      const cancelled = cancelLineRemaining(copy, getPurchaseOrderMetrics({ lines: [copy] }).remainingQty);
      cancelAllocationRemaining(state || { demandPurchaseAllocations: [] }, copy, cancelled, input.cancelledAt || null);
      return copy;
    });
    if (state) {
      const index = state.purchaseOrders.findIndex((item) => item.id === order.id);
      state.purchaseOrders[index] = cancelledOrder;
      (state.demands || []).forEach((demand) => (demand.items || []).forEach((item) => updateDemandPurchaseFields(state, demand.id, item.id)));
      (state.auditLogs || (state.auditLogs = [])).unshift({ action: "PURCHASE_CANCELLED", entityType: "PURCHASE_ORDER", entityId: order.id, userId: input.actorId || null, detail: reason, createdAt: input.cancelledAt || null });
      return { committed: true, state, order: cancelledOrder };
    }
    return { committed: true, order: cancelledOrder };
  } catch (error) {
    return isState ? { committed: false, state: clone(sourceOrOrder), error } : { committed: false, order: sourceOrOrder, error };
  }
}

export function closePurchaseOrder(sourceOrOrder, input = {}) {
  const isState = Boolean(sourceOrOrder && Array.isArray(sourceOrOrder.purchaseOrders));
  const state = isState ? clone(sourceOrOrder) : null;
  const order = isState ? state.purchaseOrders.find((item) => item.id === input.orderId) : sourceOrOrder;
  const metrics = getPurchaseOrderMetrics(order || {});
  try {
    if (!order || !["RECEIVED", "PARTIALLY_RECEIVED", "ORDERED"].includes(order.status)) throw new Error("此採購單目前不可結案");
    if (metrics.remainingQty > 0) throw new Error("尚有未到貨或未取消數量，不能結案");
    const result = transitionPurchaseOrder(order, "CLOSED", input);
    if (!result.valid) throw new Error(result.errors.join("；"));
    if (!state) return { committed: true, order: result.order };
    const index = state.purchaseOrders.findIndex((item) => item.id === order.id);
    state.purchaseOrders[index] = result.order;
    (state.auditLogs || (state.auditLogs = [])).unshift({ action: "PURCHASE_CLOSED", entityType: "PURCHASE_ORDER", entityId: order.id, userId: input.actorId || null, detail: "", createdAt: input.closedAt || null });
    return { committed: true, state, order: result.order };
  } catch (error) {
    return isState ? { committed: false, state: clone(sourceOrOrder), error } : { committed: false, order: sourceOrOrder, error };
  }
}

export function orderSourceTrace(order = {}) {
  return (order.lines || []).map((line) => ({
    purchaseOrderItemId: line.id,
    productId: line.productId,
    warehouseBufferQty: quantity(line.warehouseBufferQty),
    sources: (line.sourceAllocations || []).map((source) => ({
      demandOrderId: source.demandOrderId,
      demandOrderItemId: source.demandOrderItemId,
      demandNumber: source.demandNumber || null,
      locationId: source.locationId || null,
      allocatedQty: quantity(source.allocatedQty),
      receivedAllocatedQty: quantity(source.receivedAllocatedQty),
      cancelledAllocatedQty: quantity(source.cancelledAllocatedQty),
    })),
  }));
}

export function canManagePurchaseOrders(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "PURCHASING"].includes(user?.role));
}

export function canReceivePurchaseOrders(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "WAREHOUSE"].includes(user?.role));
}

export function canViewPurchaseOrders(user) {
  return Boolean(user?.isActive !== false && ["ADMIN", "PURCHASING", "WAREHOUSE", "STORE"].includes(user?.role));
}
