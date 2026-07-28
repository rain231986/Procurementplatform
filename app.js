import {
  availableInventory,
  calculateDemandLineAmount,
  calculateReplenishment,
  calculateSixMonthSales,
  createId,
  demandOutstanding,
  demandUnallocated,
  evaluateStoreOrderCondition,
  formatMoney,
  isHumanDemandEditableStatus,
  isoDate,
  isOpenDemandStatus,
  isReplenishmentOpenDemandStatus,
  getPreviousCompleteMonths,
  numberLabel,
  openDemandRemainingQty,
  passwordPolicyError,
  purchaseCoverage,
  summarizeSupplierDemand,
  toNumber,
} from "./domain.js";
import {
  actorTypeFor,
  applyStoreSuggestionReview,
  buildAutoDemandDraft,
  buildAutoDemandItem,
  buildChangeLog,
  buildReplenishmentInventorySnapshot,
  buildSixMonthSalesSnapshot,
  canConvertSuggestion,
  canEditAutoDemand,
  canManagerReviewAutoDemand,
  canSkipSuggestion,
  canStoreReviewSuggestion,
  canSubmitAutoDemand,
  inventorySnapshotChanged,
  runTransactionalMutation,
  summarizeAutoApproval,
  validateManagerDecisionLines,
  validateStoreSuggestionReview,
} from "./replenishment-workflow.js";
import {
  aggregatePurchaseSuggestions,
  applyPurchaseReceipt,
  buildDemandPurchaseAllocations,
  buildProcurementProductSnapshot,
  buildPurchaseOrderItemDistributionPlans,
  buildPurchaseOrderItemSources,
  canManagePurchaseOrders,
  canReceivePurchaseOrders,
  canViewPurchaseOrders,
  cancelPurchaseOrder as cancelProcurementOrder,
  calculatePurchaseOrderTotals,
  decimalToCents,
  centsToDecimal,
  closePurchaseOrder as closeProcurementOrder,
  createManualPurchaseOrderDraft,
  createPurchaseOrderDraft as buildPurchaseOrderDraft,
  getPurchaseOrderMetrics,
  markPurchaseSuggestionNoGroup,
  reopenPurchaseSuggestion,
  applyPurchaseOrderDistributionPlans,
  validatePurchaseOrderDistributionPlans,
  NO_GROUP_REASONS,
  addManualPurchaseOrderItem,
  mergePurchaseOrderItems,
  mergePurchaseSuggestions,
  orderSourceTrace,
  transitionPurchaseOrder,
  validatePurchaseOrderConfirmation,
} from "./procurement-workflow.js";
import {
  PRODUCT_PROCUREMENT_STATUSES,
  PRODUCT_PURCHASING_FIELDS,
  PRODUCT_WAREHOUSE_FIELDS,
  SUPPLIER_COMMERCIAL_FIELDS,
  SUPPLIER_RECEIVING_FIELDS,
  canAdjustInventory,
  canCreateProduct,
  canManageSupplierCommercial,
  canManageSupplierProducts,
  canManageSupplierReceiving,
  canViewMasterData,
  createProduct as createMasterProduct,
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
} from "./master-data-workflow.js";
import {
  SUPPLIER_PAYMENT_METHODS,
  SUPPLIER_IDENTIFIER_TYPES,
  SUPPLIER_ORDER_FREQUENCIES,
  PURCHASE_ITEM_FOLLOW_UP_STATUSES,
  PURCHASE_ITEM_SHORTAGE_STATUSES,
  PURCHASE_ITEM_SHORTAGE_REASONS,
  SUPPLIER_RETURN_SOURCES,
  SUPPLIER_RETURN_STATUSES,
  SUPPLIER_RETURN_REASON_CODES,
  SUPPLIER_RETURN_RESOLUTION_TYPES,
  normalizeSupplierOperations,
  canManageSupplierCommercialData,
  canManageSupplierReturns,
  canCreateSupplierReturn,
  canResolveSupplierReturn,
  canMaintainProductIdentifiers,
  getStoreSupplierSchedule,
  getPurchaseOrderItemTrackingRows,
  getStorePurchaseStatus,
  getSupplierBankAccountsForRole,
  getSupplierReturnsForRole,
  updateSupplierCommercialTerms,
  upsertSupplierBusinessRelation,
  snapshotPurchaseOrderSupplierTerms,
  upsertSupplierOrderSchedule,
  upsertProductIdentifier,
  updatePurchaseOrderItemTracking,
  updatePurchaseOrderItemShortage,
  cancelPurchaseOrderItemShortage,
  requeuePurchaseOrderItemShortage,
  setPurchaseOrderItemAlternative,
  createSupplierReturnDraft,
  updateSupplierReturnDraft,
  transitionSupplierReturn,
  uploadSupplierAttachment,
  createSupplierBankAccount,
  switchPrimarySupplierBankAccount,
  verifySupplierBankAccount,
  disableSupplierBankAccount,
  recordSupplierReturnResolution,
  receiveSupplierReplacement,
  closeSupplierReturn,
} from "./supplier-operations-workflow.js";

const STORAGE_KEY = "pharmacy-demand-platform.phase1.v1";
const SESSION_KEY = "pharmacy-demand-platform.session.v1";
const today = "2026-07-23";

const ROLE_LABELS = {
  ADMIN: "系統管理者",
  STORE: "門市",
  WAREHOUSE: "總倉",
  PURCHASING: "集中採購",
};

const STATUS_LABELS = {
  WAITING_AGGREGATION: "待彙整",
  UNDER_REVIEW: "採購檢視中",
  DRAFT_PURCHASE_ORDER: "採購單草稿",
  GROUPED: "已成團",
  ORDER_CREATED: "已建立採購單",
  NO_GROUP: "無成團",
  REOPENED: "已重新開啟",
  DRAFT: "草稿",
  PENDING_MANAGER_APPROVAL: "待店長核單",
  RETURNED: "已退回",
  SUBMITTED: "已送出",
  APPROVED: "已核准",
  PROCESSING: "處理中",
  PARTIALLY_ALLOCATED: "部分配貨",
  WAITING_PURCHASE: "待集中採購",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  PENDING: "待確認（舊資料）",
  GENERATED: "系統已產生",
  STORE_REVIEWING: "門市確認中",
  ACCEPTED: "已接受",
  ADJUSTED: "門市已調整",
  CONVERTED_TO_DEMAND: "已轉需求草稿",
  EXPIRED: "已失效",
  SKIPPED: "暫不補貨",
  PICKING: "揀貨中",
  SHIPPED: "已出貨",
  RECEIVED: "已簽收",
  ORDERED: "已下單",
  PARTIALLY_RECEIVED: "部分到貨",
  PENDING_CONFIRMATION: "待確認下單",
  CLOSED: "已結案",
  REQUEUED: "已重新採購",
  ALTERNATIVE_AVAILABLE: "已有替代來源",
  PARTIAL_SHORTAGE: "部分缺貨",
  FULL_SHORTAGE: "全部缺貨",
  TEMPORARY_OUT_OF_STOCK: "暫時缺貨",
  LONG_TERM_OUT_OF_STOCK: "長期缺貨",
  DISCONTINUED: "已停產／停售",
  BACKORDERED: "待補貨",
  RESOLVED: "已解決",
  NONE: "無缺貨",
  PENDING_PURCHASE_SETUP: "待完成採購設定",
  PURCHASABLE: "可採購",
  INACTIVE: "已停用",
};

const VIEW_META = {
  dashboard: { title: "營運總覽", subtitle: "掌握門市需求、總倉庫存與集中採購進度" },
  demands: { title: "門市需求池", subtitle: "人工需求與門市確認後的自動補貨，統一在這裡追蹤" },
  replenishment: { title: "自動補貨建議", subtitle: "依門市補貨參數計算可落地的建議數量" },
  allocations: { title: "總倉配貨作業", subtitle: "依可用庫存部分或全部配貨，缺口自動流入採購" },
  purchasing: { title: "集中採購", subtitle: "彙總跨門市缺口，依主要供應商與採購倍數建立採購單" },
  supplierOperations: { title: "供應商營運", subtitle: "管理訂貨週期、付款對象、逐品項缺貨追蹤與供應商退貨" },
  receipts: { title: "到貨與門市簽收", subtitle: "先登記總倉到貨，再由總倉出貨、門市完成簽收" },
  masters: { title: "主檔與庫存", subtitle: "管理商品、供應商、門市補貨參數與測試庫存" },
  users: { title: "使用者管理", subtitle: "管理 Phase 1 登入帳號、角色與所屬單位" },
  audit: { title: "操作紀錄", subtitle: "追蹤需求、配貨、採購與庫存的重要異動" },
};

const state = {
  data: loadData(),
  session: loadSession(),
  view: "dashboard",
  filters: {},
  modal: null,
  toast: null,
  revealBankAccounts: {},
};

document.addEventListener("DOMContentLoaded", () => {
  bindGlobalEvents();
  render();
});

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.version === 1) return normalizeData(saved);
  } catch (error) {
    console.warn("Unable to read demo data", error);
  }
  return normalizeData(seedData());
}

function normalizeData(data) {
  const normalized = data;
  normalized.users = normalized.users || [];
  normalized.suppliers = normalized.suppliers || [];
  normalized.supplierProducts = normalized.supplierProducts || [];
  normalized.demands = normalized.demands || [];
  normalized.monthlyProductSales = normalized.monthlyProductSales || [];
  normalized.storeOrderConditions = normalized.storeOrderConditions || [];
  normalized.auditLogs = normalized.auditLogs || [];
  normalized.replenishmentSuggestions = normalized.replenishmentSuggestions || [];
  normalized.replenishmentChangeLogs = normalized.replenishmentChangeLogs || [];
  normalized.purchaseSuggestions = normalized.purchaseSuggestions || [];
  normalized.purchaseOrders = normalized.purchaseOrders || [];
  normalized.demandPurchaseAllocations = normalized.demandPurchaseAllocations || [];
  normalized.purchaseOrderChangeLogs = normalized.purchaseOrderChangeLogs || [];
  normalized.purchaseTrackingNotes = normalized.purchaseTrackingNotes || [];
  normalized.purchaseReceiptLogs = normalized.purchaseReceiptLogs || [];
  normalized.purchaseOrderItemSources = normalized.purchaseOrderItemSources || normalized.purchaseOrderItemSourceRows || [];
  normalized.purchaseOrderItemStoreAllocations = normalized.purchaseOrderItemStoreAllocations || normalized.purchaseOrderItemDistributionPlans || [];
  normalized.purchaseOrderItemDistributionPlans = normalized.purchaseOrderItemStoreAllocations;
  normalized.procurementStatusLogs = normalized.procurementStatusLogs || [];
  normalizeMasterData(normalized);
  normalizeSupplierOperations(normalized);
  normalized.suppliers.forEach((supplier) => {
    supplier.minimumOrderAmount = Math.max(0, toNumber(supplier.minimumOrderAmount));
  });
  normalized.supplierProducts.forEach((supplierProduct) => {
    supplierProduct.minimumOrderAmount = Math.max(0, toNumber(supplierProduct.minimumOrderAmount));
  });
  normalized.users.forEach((user) => {
    user.isStoreManager = user.isStoreManager === true;
    user.passwordChangedAt = user.passwordChangedAt || null;
    user.mustChangePassword = user.mustChangePassword === true;
  });
  const passwordHash = normalized.users.find((user) => user.role === "STORE" && user.passwordHash)?.passwordHash || "";
  (normalized.locations || []).filter((location) => location.type === "STORE").forEach((location) => {
    const managerUsername = `${location.id}_manager`;
    if (!normalized.users.some((user) => user.username === managerUsername)) {
      normalized.users.push({
        id: `user_${location.id}_manager`,
        username: managerUsername,
        displayName: `${location.name} 店長`,
        role: "STORE",
        locationId: location.id,
        isStoreManager: true,
        isActive: true,
        passwordHash,
        passwordChangedAt: null,
        mustChangePassword: false,
      });
    }
  });
  normalized.demands.forEach((demand) => {
    demand.requestedBy = demand.requestedBy || demand.createdBy;
    demand.managerApprovedBy = demand.managerApprovedBy || null;
    demand.managerApprovedAt = demand.managerApprovedAt || null;
    demand.returnedBy = demand.returnedBy || null;
    demand.returnedAt = demand.returnedAt || null;
    demand.returnReason = demand.returnReason || null;
    demand.managerReason = demand.managerReason || null;
    demand.items = demand.items || [];
    demand.items.forEach((item) => {
      item.purchaseOrderedQty = toNumber(item.purchaseOrderedQty);
      item.purchaseReceivedQty = toNumber(item.purchaseReceivedQty);
      item.procurementStatus = item.procurementStatus || null;
      item.procurementStatusReason = item.procurementStatusReason || null;
      item.procurementStatusNote = item.procurementStatusNote || null;
      item.procurementStatusUpdatedAt = item.procurementStatusUpdatedAt || null;
      item.purchaseShortageQty = toNumber(item.purchaseShortageQty);
      item.purchaseOpenQty = toNumber(item.purchaseOpenQty);
      item.purchaseRequeuedQty = toNumber(item.purchaseRequeuedQty);
      item.purchaseLatestExpectedDeliveryDate = item.purchaseLatestExpectedDeliveryDate || null;
      item.purchaseNextAvailableDate = item.purchaseNextAvailableDate || null;
      item.purchaseFollowUpStatus = item.purchaseFollowUpStatus || null;
      item.purchaseStoreVisibleNote = item.purchaseStoreVisibleNote || null;
      item.purchaseReturnStatus = item.purchaseReturnStatus || null;
      item.purchaseSuggestionId = item.purchaseSuggestionId || null;
      item.referencePurchasePrice = item.referencePurchasePrice ?? null;
      item.lineAmount = item.lineAmount ?? null;
      item.currentStockSnapshot = item.currentStockSnapshot ?? null;
      item.sixMonthSalesTotalSnapshot = item.sixMonthSalesTotalSnapshot ?? null;
      item.sixMonthAverageSnapshot = item.sixMonthAverageSnapshot ?? null;
      item.minimumQtySnapshot = item.minimumQtySnapshot ?? null;
      item.minimumAmountSnapshot = item.minimumAmountSnapshot ?? null;
      item.conditionModeSnapshot = item.conditionModeSnapshot || null;
      item.supplierMinimumQtySnapshot = item.supplierMinimumQtySnapshot ?? null;
      item.supplierMinimumAmountSnapshot = item.supplierMinimumAmountSnapshot ?? null;
      item.supplierPurchaseMultipleSnapshot = item.supplierPurchaseMultipleSnapshot ?? null;
      if (demand.sourceType === "AUTO") {
        item.replenishmentSuggestionId = item.replenishmentSuggestionId || null;
        item.systemSuggestedQty = item.systemSuggestedQty ?? item.requestedQty ?? 0;
        item.storeConfirmedQty = item.storeConfirmedQty ?? item.requestedQty ?? 0;
        item.managerConfirmedQty = item.managerConfirmedQty ?? null;
        item.finalRequestedQty = item.finalRequestedQty ?? null;
        item.storeAdjustmentReason = item.storeAdjustmentReason || null;
        item.managerAdjustmentReason = item.managerAdjustmentReason || null;
        item.managerSkipped = item.managerSkipped === true;
        item.onHandQtySnapshot = item.onHandQtySnapshot ?? item.currentStockSnapshot ?? null;
        item.reservedQtySnapshot = item.reservedQtySnapshot ?? null;
        item.availableQtySnapshot = item.availableQtySnapshot ?? null;
        item.calculatedAt = item.calculatedAt || null;
        item.sixMonthSalesMaxSnapshot = item.sixMonthSalesMaxSnapshot ?? null;
        item.sixMonthSalesMinSnapshot = item.sixMonthSalesMinSnapshot ?? null;
      }
    });
  });
  normalized.replenishmentSuggestions.forEach((suggestion) => {
    if (suggestion.status === "PENDING") suggestion.status = "GENERATED";
    suggestion.systemSuggestedQty = Math.max(0, toNumber(suggestion.systemSuggestedQty ?? suggestion.originalSuggestedQty ?? suggestion.suggestedQty));
    suggestion.suggestedQty = suggestion.systemSuggestedQty;
    suggestion.originalSuggestedQty = suggestion.systemSuggestedQty;
    suggestion.storeConfirmedQty = suggestion.storeConfirmedQty ?? suggestion.confirmedQty ?? null;
    suggestion.managerConfirmedQty = suggestion.managerConfirmedQty ?? null;
    suggestion.finalRequestedQty = suggestion.finalRequestedQty ?? null;
    suggestion.storeAdjustmentReason = suggestion.storeAdjustmentReason || null;
    suggestion.managerAdjustmentReason = suggestion.managerAdjustmentReason || null;
    suggestion.onHandQtySnapshot = suggestion.onHandQtySnapshot ?? null;
    suggestion.reservedQtySnapshot = suggestion.reservedQtySnapshot ?? null;
    suggestion.availableQtySnapshot = suggestion.availableQtySnapshot ?? null;
    suggestion.calculatedAt = suggestion.calculatedAt || suggestion.createdAt || null;
    suggestion.sixMonthSalesSnapshot = suggestion.sixMonthSalesSnapshot || null;
    suggestion.demandId = suggestion.demandId || null;
  });
  normalized.purchaseSuggestions.forEach((suggestion) => {
    suggestion.status = suggestion.status || "PENDING";
    suggestion.procurementStatus = suggestion.procurementStatus || (suggestion.status === "PENDING" ? "WAITING_AGGREGATION" : suggestion.status);
    suggestion.key = suggestion.key || null;
    suggestion.rawPurchaseQty = toNumber(suggestion.rawPurchaseQty ?? suggestion.shortageQty);
    suggestion.shortageQty = suggestion.rawPurchaseQty;
    suggestion.demandAllocatedQty = toNumber(suggestion.demandAllocatedQty ?? suggestion.shortageQty);
    suggestion.warehouseSupplementQty = toNumber(suggestion.warehouseSupplementQty);
    suggestion.suggestedPurchaseQty = toNumber(suggestion.suggestedPurchaseQty ?? suggestion.suggestedQty);
    suggestion.suggestedQty = suggestion.suggestedPurchaseQty;
    suggestion.confirmedPurchaseQty = suggestion.confirmedPurchaseQty ?? suggestion.confirmedQty ?? suggestion.suggestedPurchaseQty;
    suggestion.confirmedQty = suggestion.confirmedPurchaseQty;
    suggestion.warehouseBufferQty = toNumber(suggestion.warehouseBufferQty ?? suggestion.overageQty);
    suggestion.demandSuggestedQty = toNumber(suggestion.demandSuggestedQty ?? suggestion.rawDemandQty ?? suggestion.demandAllocatedQty);
    suggestion.warehouseReplenishmentQty = toNumber(suggestion.warehouseReplenishmentQty ?? suggestion.warehouseSupplementQty);
    suggestion.systemSuggestedPurchaseQty = toNumber(suggestion.systemSuggestedPurchaseQty ?? suggestion.suggestedPurchaseQty);
    suggestion.purchaserConfirmedQty = toNumber(suggestion.purchaserConfirmedQty ?? suggestion.confirmedPurchaseQty);
    suggestion.plannedStoreAllocationQty = toNumber(suggestion.plannedStoreAllocationQty);
    suggestion.warehouseBufferQty = toNumber(suggestion.warehouseBufferQty ?? Math.max(0, suggestion.purchaserConfirmedQty - suggestion.plannedStoreAllocationQty));
    suggestion.noGroupReason = suggestion.noGroupReason || null;
    suggestion.noGroupNote = suggestion.noGroupNote || null;
    suggestion.noGroupBy = suggestion.noGroupBy || null;
    suggestion.noGroupAt = suggestion.noGroupAt || null;
    suggestion.noGroupHistory = suggestion.noGroupHistory || [];
    suggestion.sourceAllocations = suggestion.sourceAllocations || [];
    suggestion.sourceDemandIds = suggestion.sourceDemandIds || suggestion.sourceAllocations.map((source) => source.demandOrderId);
    suggestion.sourceLocationIds = suggestion.sourceLocationIds || [];
  });
  normalized.purchaseOrders.forEach((order) => {
    order.sourceType = order.sourceType || (order.lines?.some((line) => line.sourceDemandIds?.length) ? "PURCHASE_SUGGESTION" : "MANUAL");
    order.status = order.status === "PENDING" ? "DRAFT" : order.status || "DRAFT";
    order.orderDate = order.orderDate || today;
    order.expectedDeliveryDate = order.expectedDeliveryDate || order.orderDate;
    order.actualFirstReceivedDate = order.actualFirstReceivedDate || order.firstReceivedAt || null;
    order.actualCompletedDate = order.actualCompletedDate || null;
    order.currency = order.currency || "TWD";
    order.taxType = order.taxType || "NONE";
    order.notes = order.notes || "";
    order.lines = order.lines || [];
    order.lines.forEach((line) => {
      line.purchaseOrderId = line.purchaseOrderId || order.id;
      line.sourceSuggestionId = line.sourceSuggestionId || line.suggestionId || null;
      line.suggestionId = line.suggestionId || line.sourceSuggestionId || null;
      line.sourceType = line.sourceType || (line.sourceSuggestionId ? "PURCHASE_SUGGESTION" : "MANUAL_WAREHOUSE_STOCK");
      line.receivedQty = toNumber(line.receivedQty);
      line.cancelledQty = toNumber(line.cancelledQty);
      line.remainingQty = Math.max(0, toNumber(line.orderedQty) - line.receivedQty - line.cancelledQty);
      line.purchasePrice = line.purchasePrice ?? line.unitPrice ?? 0;
      line.unitPrice = line.unitPrice ?? line.purchasePrice;
      line.sourceAllocations = line.sourceAllocations || [];
      line.sourceTypes = line.sourceTypes || (line.sourceType ? [line.sourceType] : []);
      line.sourceType = line.sourceType || (line.sourceSuggestionId ? "DEMAND_SUGGESTION" : "MANUAL_ADDITION");
      if (line.sourceType === "PURCHASE_SUGGESTION") {
        line.purchaseSuggestionSourceType = "PURCHASE_SUGGESTION";
        line.sourceType = "DEMAND_SUGGESTION";
      }
      if (line.sourceType === "MANUAL_WAREHOUSE_STOCK" || line.sourceType === "MANUAL") line.sourceType = "MANUAL_ADDITION";
      line.sourceTypes = [...new Set(line.sourceTypes.map((type) => type === "PURCHASE_SUGGESTION" || type === "MANUAL_WAREHOUSE_STOCK" || type === "MANUAL" ? (line.sourceSuggestionId ? "DEMAND_SUGGESTION" : "MANUAL_ADDITION") : type))];
      if (!line.sourceAllocations.length && line.sourceDemandIds?.length) {
        let sourceQty = toNumber(line.orderedQty);
        line.sourceDemandIds.forEach((demandId) => {
          const demand = normalized.demands.find((item) => item.id === demandId);
          (demand?.items || []).filter((item) => item.productId === line.productId).forEach((item) => {
            const requested = Math.min(sourceQty, Math.max(0, toNumber(item.purchaseRequiredQty || item.requestedQty) - toNumber(item.purchaseReceivedQty)));
            if (requested > 0) {
              line.sourceAllocations.push({ demandOrderId: demand.id, demandOrderItemId: item.id, demandNumber: demand.demandNumber, demandType: demand.sourceType, locationId: demand.locationId, allocatedQty: requested, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 });
              sourceQty -= requested;
            }
          });
        });
      }
      const sourceDemandQty = line.sourceAllocations.reduce((sum, source) => sum + toNumber(source.allocatedQty), 0);
      line.rawPurchaseQty = toNumber(line.rawPurchaseQty ?? sourceDemandQty + toNumber(line.warehouseSupplementQty));
      line.rawDemandQty = toNumber(line.rawDemandQty ?? Math.max(0, line.rawPurchaseQty - toNumber(line.warehouseSupplementQty)));
      line.rawPurchaseQtyBeforeManual = toNumber(line.rawPurchaseQtyBeforeManual ?? (line.sourceSuggestionId ? line.rawPurchaseQty : 0));
      line.demandAllocatedQty = toNumber(line.demandAllocatedQty ?? sourceDemandQty);
      line.warehouseSupplementQty = toNumber(line.warehouseSupplementQty);
      line.suggestedPurchaseQty = toNumber(line.suggestedPurchaseQty ?? line.orderedQty);
      line.combinedBaseQty = toNumber(line.combinedBaseQty ?? line.suggestedPurchaseQty + toNumber(line.manualAddedQty));
      line.manualAddedQty = toNumber(line.manualAddedQty);
      if (line.manualAddedQty > 0) line.sourceTypes = [...new Set([...line.sourceTypes, "MANUAL_ADDITION"])]
      line.manualAddReason = line.manualAddReason || null;
      line.manualReasonCode = line.manualReasonCode || null;
      line.manualReasonDetail = line.manualReasonDetail || null;
      line.manualAddedBy = line.manualAddedBy || null;
      line.manualAddedAt = line.manualAddedAt || null;
      line.manualNotes = line.manualNotes || "";
      line.manualAddEntries = line.manualAddEntries || [];
      line.confirmedPurchaseQty = toNumber(line.confirmedPurchaseQty ?? line.orderedQty);
      line.multipleOverageQty = toNumber(line.multipleOverageQty ?? Math.max(0, line.suggestedPurchaseQty - line.rawPurchaseQty));
      line.warehouseBufferQty = toNumber(line.warehouseBufferQty ?? Math.max(0, toNumber(line.orderedQty) - sourceDemandQty));
      line.demandSuggestedQty = toNumber(line.demandSuggestedQty ?? line.rawDemandQty);
      line.warehouseReplenishmentQty = toNumber(line.warehouseReplenishmentQty ?? line.warehouseSupplementQty);
      if (!line.sourceSuggestionId && line.sourceType === "MANUAL_ADDITION") line.warehouseReplenishmentQty = 0;
      line.rawPurchaseQtyIncludingManual = toNumber(line.rawPurchaseQtyIncludingManual ?? line.rawPurchaseQty);
      line.systemSuggestedPurchaseQty = toNumber(line.systemSuggestedPurchaseQty ?? line.suggestedPurchaseQty);
      line.purchaserConfirmedQty = toNumber(line.purchaserConfirmedQty ?? line.confirmedPurchaseQty);
      line.plannedStoreAllocationQty = toNumber(line.plannedStoreAllocationQty);
      line.warehousePlannedRetentionQty = toNumber(line.warehousePlannedRetentionQty ?? Math.max(0, line.confirmedPurchaseQty - line.plannedStoreAllocationQty));
      line.purchaseOrderItemSourceRows = line.purchaseOrderItemSourceRows || [];
      if (line.sourceSuggestionId && line.manualAddedQty > 0) line.sourceType = "MIXED";
    });
    const hasSuggestionLine = order.lines.some((line) => Boolean(line.sourceSuggestionId || line.suggestionId));
    const hasManualLine = order.lines.some((line) => toNumber(line.manualAddedQty) > 0);
    order.sourceType = hasSuggestionLine && hasManualLine ? "MIXED" : hasSuggestionLine ? "PURCHASE_SUGGESTION" : hasManualLine ? "MANUAL" : order.sourceType;
    const totals = getPurchaseOrderMetrics(order);
    order.subtotalAmount = order.subtotalAmount ?? order.lines.reduce((sum, line) => sum + toNumber(line.orderedQty) * toNumber(line.unitPrice), 0).toFixed(2);
    order.totalAmount = order.totalAmount ?? order.subtotalAmount;
    order.supplierMinimumOrderAmount = order.supplierMinimumOrderAmount ?? "0.00";
    order.minimumAmountMet = order.minimumAmountMet ?? true;
    order.updatedAt = order.updatedAt || order.createdAt || `${today} 09:00`;
    if (totals.receivedQty > 0 && !order.actualFirstReceivedDate) order.actualFirstReceivedDate = order.lastReceivedAt || null;
  });
  normalized.purchaseOrders.forEach((order) => {
    const existingPlans = normalized.purchaseOrderItemStoreAllocations.filter((plan) => plan.purchaseOrderId === order.id);
    const defaultPlans = buildPurchaseOrderItemDistributionPlans(order, { locations: normalized.locations || [], existingPlans, createdAt: order.createdAt || `${today} 09:00`, createdBy: order.createdBy, createId });
    const planResult = applyPurchaseOrderDistributionPlans(order, defaultPlans, { locations: normalized.locations || [] });
    if (planResult.committed) {
      order.lines = planResult.order.lines;
      normalized.purchaseOrderItemStoreAllocations = normalized.purchaseOrderItemStoreAllocations.filter((plan) => plan.purchaseOrderId !== order.id).concat(planResult.plans);
      normalized.purchaseOrderItemDistributionPlans = normalized.purchaseOrderItemStoreAllocations;
    }
    const sourceLineIds = new Set(order.lines.map((line) => line.id));
    const existingSources = normalized.purchaseOrderItemSources.filter((source) => sourceLineIds.has(source.purchaseOrderItemId));
    if (!existingSources.length) normalized.purchaseOrderItemSources.push(...buildPurchaseOrderItemSources(order, { createdAt: order.createdAt || `${today} 09:00`, createdBy: order.createdBy, createId }));
    (order.lines || []).forEach((line) => {
      line.sourceAllocations.forEach((source) => {
        if (!normalized.demandPurchaseAllocations.some((allocation) => allocation.purchaseOrderItemId === line.id && allocation.demandOrderItemId === source.demandOrderItemId)) {
          normalized.demandPurchaseAllocations.push({ id: createId("demandPurchaseAllocation"), demandOrderId: source.demandOrderId, demandOrderItemId: source.demandOrderItemId, purchaseOrderId: order.id, purchaseOrderItemId: line.id, allocatedQty: toNumber(source.allocatedQty), receivedAllocatedQty: toNumber(source.receivedAllocatedQty), cancelledAllocatedQty: toNumber(source.cancelledAllocatedQty), createdAt: order.createdAt || `${today} 09:00`, updatedAt: order.updatedAt || `${today} 09:00` });
        }
      });
    });
  });
  return normalized;
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function seedData() {
  const locations = [
    { id: "store01", code: "STORE01", name: "民生門市", type: "STORE", address: "台北市松山區民生東路" },
    { id: "store02", code: "STORE02", name: "中山門市", type: "STORE", address: "台北市中山區南京東路" },
    { id: "store03", code: "STORE03", name: "板橋門市", type: "STORE", address: "新北市板橋區文化路" },
    { id: "store04", code: "STORE04", name: "台中門市", type: "STORE", address: "台中市西區公益路" },
    { id: "store05", code: "STORE05", name: "高雄門市", type: "STORE", address: "高雄市左營區博愛路" },
    { id: "warehouse", code: "WH01", name: "中央總倉", type: "WAREHOUSE", address: "桃園市蘆竹區物流園區" },
  ];
  const suppliers = [
    { id: "sup01", code: "SUP-001", name: "康健醫藥股份有限公司", taxId: "24567890", contact: "王小姐", contactName: "王小姐", phone: "02-2211-7788", email: "sales@kangjian.example", address: "台北市內湖區物流路 1 號", leadTimeDays: 3, minimumOrderAmount: 5000, paymentTerms: "月結 30 天", paymentMethod: "BANK_TRANSFER", paymentMethodNote: "匯款日為每月 25 日", settlementDays: 30, billingCycle: "MONTHLY", invoiceRequirement: "REQUIRED", currency: "TWD", supplierPublicNote: "門市缺貨請於下單前備註。", deliveryNote: "工作日上午配送", deliveryTimeNote: "09:00-12:00", receivingNote: "需附完整送貨單", isActive: true, version: 1, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "sup02", code: "SUP-002", name: "安泰藥品有限公司", taxId: "35678901", contact: "林先生", contactName: "林先生", phone: "04-2312-8899", email: "service@antai.example", address: "台中市西屯區工業路 2 號", leadTimeDays: 5, minimumOrderAmount: 3000, paymentTerms: "月結 45 天", paymentMethod: "MONTHLY_SETTLEMENT", paymentMethodNote: "", settlementDays: 45, billingCycle: "MONTHLY", invoiceRequirement: "REQUIRED", currency: "TWD", supplierPublicNote: "冷藏商品需提前一天確認。", deliveryNote: "到貨前一日電話通知", deliveryTimeNote: "13:00-17:00", receivingNote: "冷藏品請優先點收", isActive: true, version: 1, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "sup03", code: "SUP-003", name: "日新保健有限公司", taxId: "46789012", contact: "陳小姐", contactName: "陳小姐", phone: "07-558-1033", email: "hello@risshin.example", address: "高雄市左營區博愛路 3 號", leadTimeDays: 7, minimumOrderAmount: 5000, paymentTerms: "月結 30 天", paymentMethod: "BANK_TRANSFER", paymentMethodNote: "付款對象由採購主檔指定", settlementDays: 30, billingCycle: "MONTHLY", invoiceRequirement: "REQUIRED", currency: "TWD", supplierPublicNote: "週二、四固定配送。", deliveryNote: "週二、四固定配送", deliveryTimeNote: "10:00-16:00", receivingNote: "外箱需標示批號", isActive: true, version: 1, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
  ];
  const productNames = [
    ["舒敏感冒膠囊", "24粒/盒", "一般藥品"], ["兒童退燒糖漿", "60ml/瓶", "兒童用藥"],
    ["高單位維他命D", "60錠/瓶", "保健食品"], ["速效感冒錠", "20錠/盒", "一般藥品"],
    ["兒童舒熱懸液", "60ml/瓶", "兒童用藥"], ["護眼葉黃素膠囊", "30粒/盒", "保健食品"],
    ["成人綜合維他命", "90錠/瓶", "保健食品"], ["口罩醫療用", "50片/盒", "醫療用品"],
    ["酒精棉片", "100片/盒", "醫療用品"], ["抗菌洗手乳", "500ml/瓶", "日用品"],
    ["維生素C發泡錠", "20錠/管", "保健食品"], ["關節保養錠", "60錠/瓶", "保健食品"],
    ["血壓計標準型", "1台/盒", "醫療器材"], ["冰涼退熱貼", "6片/盒", "日用品"],
    ["紗布繃帶組", "10入/盒", "醫療用品"], ["鼻炎噴劑", "15ml/瓶", "一般藥品"],
    ["腸胃舒緩錠", "30錠/盒", "一般藥品"], ["護唇修護膏", "4g/條", "日用品"],
    ["成人口罩立體型", "30片/盒", "醫療用品"], ["鈣鎂鋅錠", "90錠/瓶", "保健食品"],
  ];
  const products = productNames.map(([name, specification, category], index) => ({
    id: `product${String(index + 1).padStart(2, "0")}`,
    productCode: `PH-${String(index + 1).padStart(4, "0")}`,
    barcode: `4710001${String(index + 1).padStart(6, "0")}`,
    name,
    specification,
    category,
    baseUnit: specification.split("/")[1] || "件",
    supplierId: `sup${String((index % 3) + 1).padStart(2, "0")}`,
    defaultSupplierId: `sup${String((index % 3) + 1).padStart(2, "0")}`,
    procurementStatus: "PURCHASABLE",
    casePackQty: index % 3 === 0 ? 12 : 6,
    storeDistributionUnit: specification.split("/")[1] || "件",
    storeDistributionMultiple: index % 3 === 0 ? 3 : 1,
    warehouseLocationCode: `A-${String(index + 1).padStart(2, "2")}`,
    batchTrackingEnabled: index % 5 === 0,
    expiryTrackingEnabled: index % 4 === 0,
    minimumShelfLifeDays: index % 4 === 0 ? 180 : 0,
    storageNote: index % 5 === 0 ? "需依批號先進先出" : "",
    isActive: true,
    version: 1,
    createdAt: `${today} 09:00`,
    updatedAt: `${today} 09:00`,
  }));
  const supplierProducts = products.map((product, index) => ({
    id: `sp${String(index + 1).padStart(2, "0")}`,
    productId: product.id,
    supplierId: product.supplierId,
    supplierProductCode: `${product.productCode}-S`,
    purchaseUnit: product.baseUnit,
    purchaseMultiple: index % 3 === 0 ? 12 : index % 3 === 1 ? 6 : 1,
    minimumOrderQuantity: index % 4 === 0 ? 24 : 12,
    minimumOrderAmount: suppliers.find((supplier) => supplier.id === product.supplierId)?.minimumOrderAmount || 0,
    purchasePrice: 80 + index * 7,
    leadTimeDays: suppliers.find((supplier) => supplier.id === product.supplierId)?.leadTimeDays || 0,
    isPrimary: true,
    isActive: true,
    version: 1,
    createdAt: `${today} 09:00`,
    updatedAt: `${today} 09:00`,
  }));
  const supplierBusinessRelations = [
    { id: "sbr_sup01", orderingSupplierId: "sup01", payeeSupplierId: "sup01", isDefault: true, isActive: true, note: "訂購與付款同一供應商", createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "sbr_sup02", orderingSupplierId: "sup02", payeeSupplierId: "sup02", isDefault: true, isActive: true, note: "訂購與付款同一供應商", createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "sbr_sup03", orderingSupplierId: "sup03", payeeSupplierId: "sup02", isDefault: true, isActive: true, note: "日新保健由安泰藥品代收款", createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
  ];
  const supplierOrderSchedules = [
    { id: "schedule_sup01", supplierId: "sup01", frequencyType: "WEEKLY", intervalDays: 7, cutoffTime: "15:00", expectedDeliveryDays: 3, nextOrderDate: "2026-07-27", nextExpectedDeliveryDate: "2026-07-30", storeVisibleNote: "每週一 15:00 截單，工作日上午配送。", internalNote: "採購需先檢查最低金額。", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "schedule_sup02", supplierId: "sup02", frequencyType: "BIWEEKLY", intervalDays: 14, cutoffTime: "11:00", expectedDeliveryDays: 5, nextOrderDate: "2026-07-29", nextExpectedDeliveryDate: "2026-08-03", storeVisibleNote: "隔週三 11:00 截單；冷藏品請提前備註。", internalNote: "月結 45 天。", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "schedule_sup03", supplierId: "sup03", frequencyType: "WEEKLY", intervalDays: 7, cutoffTime: "16:00", expectedDeliveryDays: 7, nextOrderDate: "2026-07-28", nextExpectedDeliveryDate: "2026-08-04", storeVisibleNote: "每週二、四配送；預估 7 天到貨。", internalNote: "付款對象為安泰藥品。", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
  ];
  const supplierBankAccounts = [{ id: "bank_sup01_01", supplierId: "sup01", payeeSupplierId: "sup01", bankName: "示範銀行", bankCode: "000", branchName: "內湖分行", branchCode: "001", accountName: "康健醫藥股份有限公司", accountNumber: "123456789012", accountNumberMasked: "＊＊＊＊＊＊＊89012", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` }];
  const productIdentifiers = [
    { id: "identifier_product01_gtin", productId: "product01", identifierType: "GTIN14", value: "04710001000001", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "identifier_product01_ean", productId: "product01", identifierType: "EAN13", value: "4710001000001", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "identifier_product01_upc", productId: "product01", identifierType: "UPCA", value: "710001000001", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "identifier_product01_jan", productId: "product01", identifierType: "JAN", value: "49123456", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "identifier_product01_mfg", productId: "product01", identifierType: "MANUFACTURER_ITEM_CODE", value: "KJ-PH-0001", isPrimary: true, isActive: true, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
  ];
  const settings = [];
  const inventory = [];
  locations.forEach((location, locationIndex) => {
    products.forEach((product, productIndex) => {
      if (location.type === "STORE") {
        settings.push({
          id: `setting_${location.id}_${product.id}`,
          locationId: location.id,
          productId: product.id,
          safetyStockQty: productIndex % 4 === 0 ? 12 : 8,
          maximumStockQty: productIndex % 4 === 0 ? 36 : 24,
          minimumReplenishmentQty: productIndex % 3 === 0 ? 6 : 4,
          storeDistributionMultiple: productIndex % 3 === 0 ? 3 : 1,
          automaticReplenishmentEnabled: productIndex < 12,
        });
        const lowStock = productIndex === 0 || productIndex === 5;
        inventory.push({
          id: `balance_${location.id}_${product.id}`,
          locationId: location.id,
          productId: product.id,
          onHandQty: lowStock ? (locationIndex % 2) : 10 + ((locationIndex + productIndex) % 14),
          reservedQty: lowStock ? 1 : (productIndex % 7 === 0 ? 2 : 0),
          updatedAt: today,
        });
      } else {
        inventory.push({
          id: `balance_${location.id}_${product.id}`,
          locationId: location.id,
          productId: product.id,
          onHandQty: productIndex === 0 ? 12 : productIndex === 5 ? 8 : 36 + ((productIndex * 5) % 48),
          reservedQty: productIndex % 6 === 0 ? 6 : 0,
          updatedAt: today,
        });
      }
    });
  });
  const storeUsers = locations.filter((location) => location.type === "STORE").flatMap((location) => [
    { id: `user_${location.id}`, username: location.id, displayName: `${location.name} 門市人員`, role: "STORE", locationId: location.id, isStoreManager: false, isActive: true, passwordHash: "", passwordChangedAt: null, mustChangePassword: false },
    { id: `user_${location.id}_manager`, username: `${location.id}_manager`, displayName: `${location.name} 店長`, role: "STORE", locationId: location.id, isStoreManager: true, isActive: true, passwordHash: "", passwordChangedAt: null, mustChangePassword: false },
  ]);
  const users = [
    { id: "user_admin", username: "admin", displayName: "系統管理者", role: "ADMIN", locationId: null, isStoreManager: false, isActive: true, passwordHash: "", passwordChangedAt: null, mustChangePassword: false },
    ...storeUsers,
    { id: "user_warehouse", username: "warehouse01", displayName: "總倉作業員", role: "WAREHOUSE", locationId: "warehouse", isStoreManager: false, isActive: true, passwordHash: "", passwordChangedAt: null, mustChangePassword: false },
    { id: "user_buyer", username: "buyer01", displayName: "集中採購專員", role: "PURCHASING", locationId: null, isStoreManager: false, isActive: true, passwordHash: "", passwordChangedAt: null, mustChangePassword: false },
  ];
  const monthlyProductSales = [
    ...getPreviousCompleteMonths(today).map(({ year, month }, index) => ({ id: `sale_store01_product01_${year}${String(month).padStart(2, "0")}`, locationId: "store01", productId: "product01", salesYear: year, salesMonth: month, salesQty: [8, 12, 10, 14, 9, 11][index], createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` })),
    { id: "sale_store01_product06_202601", locationId: "store01", productId: "product06", salesYear: 2026, salesMonth: 1, salesQty: 5, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "sale_store01_product06_202603", locationId: "store01", productId: "product06", salesYear: 2026, salesMonth: 3, salesQty: 7, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "sale_store02_product01_202606", locationId: "store02", productId: "product01", salesYear: 2026, salesMonth: 6, salesQty: 20, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
  ];
  const storeOrderConditions = [
    { id: "condition_store01_product01", locationId: "store01", productId: "product01", minimumQty: 12, minimumAmount: 1000, conditionMode: "BOTH", isActive: true, effectiveFrom: null, effectiveTo: null, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
    { id: "condition_all_product06", locationId: null, productId: "product06", minimumQty: 6, minimumAmount: null, conditionMode: "QUANTITY_ONLY", isActive: true, effectiveFrom: null, effectiveTo: null, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` },
  ];
  const demands = [
    {
      id: "demand_demo_01", demandNumber: "DN-202607-001", locationId: "store01", sourceType: "MANUAL", demandType: "URGENT", requiredDate: "2026-07-24", status: "SUBMITTED", notes: "流感季急件，請優先處理。", createdBy: "user_store01", createdAt: "2026-07-21 09:18", submittedAt: "2026-07-21 09:22",
      items: [{ id: "ditem_01", productId: "product01", requestedQty: 24, approvedQty: 24, allocatedQty: 12, purchaseRequiredQty: 12, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 0, reason: "近期客人詢問增加", notes: "" }],
    },
    {
      id: "demand_demo_02", demandNumber: "DN-202607-002", locationId: "store03", sourceType: "AUTO", demandType: "GENERAL", requiredDate: "2026-07-28", status: "APPROVED", notes: "由自動補貨建議轉入。", createdBy: "user_store03", createdAt: "2026-07-20 14:05", submittedAt: "2026-07-20 14:06",
      items: [{ id: "ditem_02", productId: "product06", requestedQty: 18, approvedQty: 18, allocatedQty: 0, purchaseRequiredQty: 18, purchaseOrderedQty: 18, purchaseReceivedQty: 0, receivedQty: 0, reason: "安全庫存觸發", notes: "" }],
    },
    {
      id: "demand_demo_03", demandNumber: "DN-202607-003", locationId: "store02", sourceType: "MANUAL", demandType: "CUSTOMER_ORDER", requiredDate: "2026-07-23", status: "COMPLETED", notes: "客訂已於今日完成簽收。", createdBy: "user_store02", createdAt: "2026-07-18 11:30", submittedAt: "2026-07-18 11:31",
      items: [{ id: "ditem_03", productId: "product03", requestedQty: 12, approvedQty: 12, allocatedQty: 12, purchaseRequiredQty: 0, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 12, reason: "客戶預訂", notes: "" }],
    },
    {
      id: "demand_demo_04", demandNumber: "DN-202607-004", locationId: "store04", sourceType: "MANUAL", demandType: "PROMOTION", requiredDate: "2026-07-31", status: "DRAFT", notes: "週末健康檢測活動備貨。", createdBy: "user_store04", createdAt: "2026-07-22 08:46", submittedAt: null,
      items: [{ id: "ditem_04", productId: "product11", requestedQty: 30, approvedQty: 0, allocatedQty: 0, purchaseRequiredQty: 0, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 0, reason: "活動備貨", notes: "" }],
    },
  ];
  const allocations = [
    { id: "allocation_demo_01", allocationNumber: "AL-202607-001", sourceLocationId: "warehouse", destinationLocationId: "store01", demandOrderId: "demand_demo_01", status: "SHIPPED", shippedAt: "2026-07-21 16:10", receivedAt: null, createdBy: "user_warehouse", createdAt: "2026-07-21 15:44", items: [{ id: "aitem_01", productId: "product01", requestedQty: 24, allocatedQty: 12, shippedQty: 12, receivedQty: 0 }] },
  ];
  const purchaseOrders = [
    { id: "po_demo_01", purchaseOrderNumber: "PO-202607-001", supplierId: "sup03", orderDate: "2026-07-20", expectedDeliveryDate: "2026-07-27", status: "PARTIALLY_RECEIVED", notes: "集中採購：葉黃素缺口", createdBy: "user_buyer", createdAt: "2026-07-20 15:20", lines: [{ id: "poline_01", productId: "product06", orderedQty: 24, purchasePrice: 115, receivedQty: 0, sourceDemandIds: ["demand_demo_02"] }] },
  ];
  return {
    version: 1,
    locations,
    suppliers,
    products,
    supplierProducts,
    supplierBusinessRelations,
    supplierOrderSchedules,
    supplierBankAccounts,
    supplierBankAttachments: [],
    productIdentifiers,
    settings,
    inventory,
    users,
    monthlyProductSales,
    storeOrderConditions,
    demands,
    replenishmentSuggestions: [],
    replenishmentChangeLogs: [],
    allocations,
    purchaseSuggestions: [],
    purchaseOrders,
    demandPurchaseAllocations: [],
    purchaseOrderChangeLogs: [],
    purchaseTrackingNotes: [],
    purchaseReceiptLogs: [],
    purchaseOrderItemSources: [],
    purchaseOrderItemStoreAllocations: [],
    purchaseOrderItemDistributionPlans: [],
    procurementStatusLogs: [],
    supplierReturns: [],
    supplierReturnItems: [],
    supplierReturnAttachments: [],
    purchaseOrderItemFollowups: [],
    shortageRequeueEntries: [],
    inventoryMovements: [],
    auditLogs: [
      { id: "audit_01", createdAt: "2026-07-22 08:40", userId: "user_admin", action: "登入", entityType: "SESSION", entityId: "user_admin", detail: "系統管理者登入示範環境" },
      { id: "audit_02", createdAt: "2026-07-21 16:10", userId: "user_warehouse", action: "配貨出貨", entityType: "ALLOCATION", entityId: "allocation_demo_01", detail: "AL-202607-001 已出貨 12 盒" },
      { id: "audit_03", createdAt: "2026-07-20 15:20", userId: "user_buyer", action: "建立採購單", entityType: "PURCHASE_ORDER", entityId: "po_demo_01", detail: "PO-202607-001，日新保健，24 盒" },
    ],
  };
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    event.preventDefault();
    handleAction(actionTarget.dataset.action, actionTarget.dataset);
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "loginForm") {
      event.preventDefault();
      handleLogin(new FormData(event.target));
    }
    if (event.target.id === "setupPasswordForm") {
      event.preventDefault();
      handlePasswordSetup(new FormData(event.target));
    }
    if (event.target.id === "changePasswordForm") {
      event.preventDefault();
      handlePasswordChange(new FormData(event.target));
    }
    if (event.target.id === "entityForm") {
      event.preventDefault();
      const formData = new FormData(event.target);
      if (event.submitter?.name) formData.set(event.submitter.name, event.submitter.value);
      handleModalSubmit(formData);
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-filter-key]")) {
      state.filters[event.target.dataset.filterKey] = event.target.type === "checkbox" ? String(event.target.checked) : event.target.value;
      renderContent();
    }
    if (event.target.matches("[data-demand-input]")) refreshDemandEditorInsights(event.target.closest("form"));
    if (event.target.matches("[data-purchase-product-search]")) {
      const query = String(event.target.value || "").trim().toLowerCase();
      const select = event.target.closest("form")?.querySelector("[data-purchase-manual-product]");
      select?.querySelectorAll("option[data-purchase-search]").forEach((option) => {
        option.hidden = Boolean(query && !String(option.dataset.purchaseSearch || "").includes(query));
      });
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-filter-key]")) {
      state.filters[event.target.dataset.filterKey] = event.target.type === "checkbox" ? String(event.target.checked) : event.target.value;
      renderContent();
    }
    if (event.target.matches("[data-demand-product-select]")) refreshDemandEditorInsights(event.target.closest("form"));
    if (event.target.matches("#salesCsvInput")) handleSalesCsvImport(event.target.files?.[0]);
  });
  window.addEventListener("storage", () => {
    state.data = loadData();
    state.session = loadSession();
    render();
  });
}

function handleAction(action, data = {}) {
  switch (action) {
    case "navigate":
      if (data.view && !canView(data.view)) return showToast("目前帳號無法查看此模組", "error");
      state.view = data.view || "dashboard";
      state.filters = {};
      render();
      break;
    case "logout":
      writeSession(null);
      state.session = null;
      state.revealBankAccounts = {};
      state.data = loadData();
      state.view = "dashboard";
      render();
      break;
    case "reset-demo":
      if (window.confirm("確定要重設本機示範資料嗎？所有新增需求、配貨與採購異動都會清除。")) {
        state.data = normalizeData(seedData());
        saveData();
        showToast("示範資料已重設", "success");
        render();
      }
      break;
    case "open-create-demand":
      openModal("create-demand");
      break;
    case "open-edit-demand":
      openModal("edit-demand", { demandId: data.id });
      break;
    case "delete-demand":
      deleteDemand(data.id);
      break;
    case "add-demand-line":
      addDemandLineEditor();
      break;
    case "remove-demand-line":
      removeDemandLineEditor(data.index);
      break;
    case "submit-demand":
      submitDemand(data.id);
      break;
    case "approve-demand":
      approveDemand(data.id);
      break;
    case "return-demand":
      openModal("return-demand", { demandId: data.id });
      break;
    case "return-auto-demand":
      openModal("return-auto-demand", { demandId: data.id });
      break;
    case "open-demand":
      if (!canAccessDemand(getDemand(data.id))) return showToast("目前 Session 無法查看此需求", "error");
      openModal("demand-detail", { demandId: data.id });
      break;
    case "open-auto-manager-edit":
      openModal("auto-manager-edit", { demandId: data.id });
      break;
    case "approve-auto-demand":
      openModal("auto-manager-approval", { demandId: data.id });
      break;
    case "run-replenishment":
      runReplenishment(data.scope || "mine");
      break;
    case "batch-accept-suggestions":
      batchAcceptSuggestions(data.scope || "mine");
      break;
    case "convert-suggestion":
      beginSuggestionReview(data.id);
      break;
    case "skip-suggestion":
      openModal("skip-suggestion", { suggestionId: data.id });
      break;
    case "open-allocation":
      openModal("allocation", { demandId: data.id });
      break;
    case "create-allocation":
      createAllocation(data.id, data.mode || "available");
      break;
    case "ship-allocation":
      shipAllocation(data.id);
      break;
    case "open-receive-allocation":
      openModal("receive-allocation", { allocationId: data.id });
      break;
    case "generate-purchase":
      generatePurchaseSuggestions();
      break;
    case "create-purchase-order":
      openModal("create-purchase-order", { suggestionIds: data.suggestionIds || data.id });
      break;
    case "mark-no-group":
      openModal("no-group", { suggestionIds: data.suggestionIds || data.id, supplierId: data.supplierId || "" });
      break;
    case "mark-no-group-batch":
      openModal("no-group", { suggestionIds: "", supplierId: data.supplierId || "" });
      break;
    case "reopen-purchase-suggestion":
      reopenPurchaseSuggestionStatus(data.id);
      break;
    case "open-manual-purchase-order":
      openModal("manual-purchase-order");
      break;
    case "focus-purchase-manual":
      document.querySelector("[data-purchase-manual-product]")?.focus();
      break;
    case "open-purchase-order":
      openModal("purchase-order-detail", { purchaseOrderId: data.id });
      break;
    case "copy-purchase-order":
      copyPurchaseOrder(data.id);
      break;
    case "edit-purchase-order":
      openModal("edit-purchase-order", { purchaseOrderId: data.id });
      break;
    case "confirm-purchase-order":
      confirmPurchaseOrder(data.id);
      break;
    case "order-purchase-order":
      markPurchaseOrderOrdered(data.id);
      break;
    case "cancel-purchase-order":
      openModal("cancel-purchase-order", { purchaseOrderId: data.id, remainingOnly: data.remainingOnly === "true" });
      break;
    case "close-purchase-order":
      closePurchaseOrder(data.id);
      break;
    case "open-purchase-tracking":
      openModal("purchase-tracking", { purchaseOrderId: data.id });
      break;
    case "open-supplier-terms":
      if (!canManageSupplierCommercialData(currentUser())) return showToast("只有採購人員或管理員可以管理供應商商務條件", "error");
      openModal("supplier-terms", { supplierId: data.id });
      break;
    case "open-supplier-schedule":
      if (!canManageSupplierCommercialData(currentUser())) return showToast("只有採購人員或管理員可以管理訂貨週期", "error");
      openModal("supplier-schedule", { supplierId: data.id });
      break;
    case "open-supplier-bank":
      if (!canManageSupplierCommercialData(currentUser())) return showToast("只有採購人員或管理員可以管理銀行帳戶", "error");
      openModal("supplier-bank", { supplierId: data.id });
      break;
    case "set-primary-bank":
      setPrimaryBank(data.id);
      break;
    case "verify-bank":
      verifyBank(data.id);
      break;
    case "disable-bank":
      disableBank(data.id);
      break;
    case "reveal-bank-account":
      if (!canManageSupplierCommercialData(currentUser())) return showToast("只有採購人員或管理員可以查看完整銀行帳號", "error");
      state.revealBankAccounts[data.supplierId] = true;
      render();
      break;
    case "open-identifiers":
      if (!canMaintainProductIdentifiers(currentUser())) return showToast("目前帳號無法維護商品國際代碼", "error");
      openModal("product-identifiers", { productId: data.id });
      break;
    case "open-item-followup":
      if (!canManageSupplierCommercialData(currentUser())) return showToast("只有採購人員或管理員可以更新逐品項追蹤", "error");
      openModal("purchase-item-followup", { purchaseOrderId: data.orderId, purchaseOrderItemId: data.itemId });
      break;
    case "open-item-shortage":
      if (!canManageSupplierCommercialData(currentUser())) return showToast("只有採購人員或管理員可以處理逐品項缺貨", "error");
      openModal("purchase-item-shortage", { purchaseOrderId: data.orderId, purchaseOrderItemId: data.itemId });
      break;
    case "open-return-create":
      if (!canCreateSupplierReturn(currentUser())) return showToast("只有總倉或管理員可以建立供應商退貨", "error");
      openModal("supplier-return-create");
      break;
    case "open-return-detail":
      openModal("supplier-return-detail", { returnOrderId: data.id });
      break;
    case "open-edit-return":
      openModal("supplier-return-edit", { returnOrderId: data.id, returnOrderItemId: data.itemId });
      break;
    case "submit-supplier-return":
      changeSupplierReturnStatus(data.id, "PENDING_SUPPLIER_CONFIRMATION");
      break;
    case "confirm-supplier-return":
      changeSupplierReturnStatus(data.id, "SUPPLIER_CONFIRMED");
      break;
    case "ready-supplier-return":
      changeSupplierReturnStatus(data.id, "READY_TO_RETURN");
      break;
    case "return-outbound":
      changeSupplierReturnStatus(data.id, "RETURNED_TO_SUPPLIER");
      break;
    case "waiting-return-resolution":
      changeSupplierReturnStatus(data.id, "WAITING_RESOLUTION");
      break;
    case "open-return-resolution":
      openModal("supplier-return-resolution", { returnOrderId: data.id, returnOrderItemId: data.itemId });
      break;
    case "open-return-attachment":
      if (!canManageSupplierReturns(currentUser())) return showToast("目前帳號無法上傳退貨附件", "error");
      openModal("supplier-return-attachment", { returnOrderId: data.id, returnOrderItemId: data.itemId });
      break;
    case "receive-replacement":
      openModal("supplier-replacement", { returnOrderItemId: data.itemId });
      break;
    case "close-supplier-return":
      closeSupplierReturnStatus(data.id);
      break;
    case "export-purchase-csv":
      exportPurchaseCsv();
      break;
    case "print-purchase-order":
      printPurchaseOrder(data.id);
      break;
    case "open-receive-po":
      openModal("receive-purchase", { purchaseOrderId: data.id });
      break;
    case "open-add-product":
      if (!canCreateProduct(currentUser())) return showToast("目前帳號無法新增商品主檔", "error");
      openModal("add-product");
      break;
    case "open-edit-product":
      if (!canViewMasterData(currentUser())) return showToast("目前帳號無法查看商品主檔", "error");
      openModal("edit-product", { productId: data.id });
      break;
    case "open-add-supplier":
      if (!canManageSupplierCommercial(currentUser())) return showToast("只有採購人員或管理員可以新增供應商", "error");
      openModal("add-supplier");
      break;
    case "open-edit-supplier":
      if (!canViewMasterData(currentUser())) return showToast("目前帳號無法查看供應商主檔", "error");
      openModal("edit-supplier", { supplierId: data.id });
      break;
    case "open-add-supplier-product":
      if (!canManageSupplierProducts(currentUser())) return showToast("只有採購人員或管理員可以維護商品供應商設定", "error");
      openModal("add-supplier-product", { productId: data.productId });
      break;
    case "open-edit-supplier-product":
      if (!canManageSupplierProducts(currentUser())) return showToast("只有採購人員或管理員可以維護商品供應商設定", "error");
      openModal("edit-supplier-product", { supplierProductId: data.id });
      break;
    case "set-primary-supplier":
      setPrimarySupplierStatus(data.productId, data.id);
      break;
    case "open-sales-csv":
      document.getElementById("salesCsvInput")?.click();
      break;
    case "open-adjust-inventory":
      if (!canAdjustInventory(currentUser())) return showToast("只有倉管或管理員可以調整庫存", "error");
      openModal("adjust-inventory", { locationId: data.locationId, productId: data.productId });
      break;
    case "open-add-user":
      openModal("add-user");
      break;
    case "toggle-user":
      toggleUser(data.id);
      break;
    case "open-profile":
      openModal("profile");
      break;
    case "close-modal":
      closeModal();
      break;
    default:
      break;
  }
}

async function handlePasswordSetup(formData) {
  const password = String(formData.get("setupPassword") || "");
  const confirmPassword = String(formData.get("setupPasswordConfirm") || "");
  if (password.length < 6) return showToast("示範密碼至少需要 6 個字元", "error");
  if (password !== confirmPassword) return showToast("兩次輸入的密碼不一致", "error");
  const hash = await hashPassword(password);
  state.data.users = state.data.users.map((user) => ({ ...user, passwordHash: hash, passwordChangedAt: user.passwordChangedAt || `${today} 09:00`, mustChangePassword: false }));
  saveData();
  showToast("本機示範密碼已設定，請使用帳號登入", "success");
  render();
}

async function handlePasswordChange(formData) {
  const user = currentUser();
  const password = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  if (!user || user.mustChangePassword !== true) return;
  const policyError = passwordPolicyError(user.username, password);
  if (policyError) return showToast(policyError, "error");
  if (password !== confirmPassword) return showToast("兩次輸入的密碼不一致", "error");
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = `${today} 09:00`;
  user.mustChangePassword = false;
  addAudit("修改密碼", "USER", user.id, "強制密碼變更完成");
  saveData();
  state.view = "dashboard";
  showToast("密碼已更新，歡迎使用系統", "success");
  render();
}

async function handleLogin(formData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const user = state.data.users.find((item) => item.username === username);
  if (!user || !user.isActive) return showToast("帳號不存在或已停用", "error");
  if (!user.passwordHash) return showToast("請先在左側設定本機示範密碼", "error");
  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) return showToast("帳號或密碼錯誤", "error");
  user.lastLoginAt = `${today} 09:00`;
  addAudit("登入", "SESSION", user.id, `${user.displayName} 登入平台`);
  state.session = { userId: user.id, signedInAt: Date.now() };
  writeSession(state.session);
  state.view = "dashboard";
  showToast(`歡迎回來，${user.displayName}`, "success");
  render();
}

async function hashPassword(value) {
  if (window.crypto?.subtle) {
    const buffer = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Array.from(value).reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0).toString(16);
}

function writeSession(session) {
  state.session = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function saveData() {
  const persisted = typeof structuredClone === "function" ? structuredClone(state.data) : JSON.parse(JSON.stringify(state.data));
  persisted.supplierBankAccounts = (persisted.supplierBankAccounts || []).map((account) => ({ ...account, accountNumber: account.accountNumberMasked || account.accountNumber || "" }));
  persisted.supplierBankAttachments = (persisted.supplierBankAttachments || []).map(({ storageKey, ...attachment }) => ({ ...attachment, storageKey: "[PRIVATE_STORAGE_KEY]" }));
  persisted.supplierReturnAttachments = (persisted.supplierReturnAttachments || []).map(({ storageKey, ...attachment }) => ({ ...attachment, storageKey: "[PRIVATE_STORAGE_KEY]" }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function render() {
  const root = document.getElementById("appRoot");
  if (!state.session) {
    root.innerHTML = renderLogin();
    return;
  }
  const user = currentUser();
  if (!user || !user.isActive) {
    writeSession(null);
    root.innerHTML = renderLogin();
    return;
  }
  if (user.mustChangePassword === true) {
    root.innerHTML = renderMandatoryPasswordChange(user);
    return;
  }
  root.innerHTML = renderShell(user);
  renderContent();
  if (state.toast) {
    window.setTimeout(() => {
      state.toast = null;
      const toast = document.querySelector(".toast");
      toast?.remove();
    }, 2600);
  }
}

function renderMandatoryPasswordChange(user) {
  return `<div class="password-change-page"><section class="password-change-card"><div class="brand-lockup"><span class="brand-mark large">藥</span><div><span class="brand-name">PharmaFlow</span><span class="brand-caption">安全性要求</span></div></div><span class="section-kicker">PASSWORD CHANGE REQUIRED</span><h1>請先更新管理員密碼</h1><p>這個帳號的密碼已由主機端重設。完成修改後才能繼續使用平台。</p><form id="changePasswordForm" class="form-stack"><label class="field"><span>新密碼</span><input name="newPassword" type="password" autocomplete="new-password" minlength="12" required /></label><label class="field"><span>確認新密碼</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label><div class="password-policy-note">至少 12 個字元，包含英文字母與數字；不得使用 username 或明顯弱密碼。</div><button class="button primary full" type="submit">更新密碼並繼續</button></form><button class="side-text-button password-logout" data-action="logout">登出</button></section></div>`;
}

function renderLogin() {
  const hasPassword = state.data.users.some((user) => user.passwordHash);
  return `<div class="login-page">
    <section class="login-visual">
      <div class="brand-lockup"><span class="brand-mark large">藥</span><div><span class="brand-name">PharmaFlow</span><span class="brand-caption">供應協作平台 · Phase 1</span></div></div>
      <div class="login-message"><span class="section-kicker">PHARMACY SUPPLY CONTROL</span><h1>讓每一個缺口，<br><em>都有下一步。</em></h1><p>從門市需求、總倉配貨到集中採購，用同一條流程追蹤供應進度。</p></div>
      <div class="login-flow"><div><b>01</b><span>門市提需求</span></div><i>→</i><div><b>02</b><span>總倉配貨</span></div><i>→</i><div><b>03</b><span>採購補缺口</span></div></div>
      <p class="login-note">本版本為流程驗證工具，資料僅儲存在此瀏覽器。</p>
    </section>
    <section class="login-card-wrap">
      <div class="login-card">
        <div class="login-card-head"><span class="section-kicker">WELCOME BACK</span><h2>登入平台</h2><p>請使用 Phase 1 測試帳號進入工作台。</p></div>
        <form id="loginForm" class="form-stack">
          <label class="field"><span>帳號</span><select name="username" required>${state.data.users.map((user) => `<option value="${escapeHtml(user.username)}">${escapeHtml(user.username)} · ${escapeHtml(user.displayName)}</option>`).join("")}</select></label>
          <label class="field"><span>密碼</span><input name="password" type="password" autocomplete="current-password" placeholder="輸入本機示範密碼" required /></label>
          <button class="button primary full" type="submit">登入工作台 <span>↗</span></button>
        </form>
        ${!hasPassword ? `<div class="setup-box"><div><strong>首次使用</strong><p>先設定一組只保存在此瀏覽器的示範密碼。</p></div><form id="setupPasswordForm" class="setup-form"><input name="setupPassword" type="password" minlength="6" placeholder="設定至少 6 個字元" required /><input name="setupPasswordConfirm" type="password" minlength="6" placeholder="再次輸入" required /><button class="button secondary full" type="submit">建立本機登入密碼</button></form></div>` : `<div class="login-hint"><span class="status-dot green"></span>示範資料已就緒 · 帳號密碼由本機設定</div>`}
        <div class="demo-accounts"><span class="label">測試角色</span><div>${Object.entries(ROLE_LABELS).map(([role, label]) => `<span class="role-tag ${role.toLowerCase()}">${label}</span>`).join("")}</div></div>
      </div>
      <span class="login-footer">Taipei · Asia/Taipei · 內部流程驗證版</span>
    </section>
    ${state.toast ? renderToast() : ""}
  </div>`;
}

function renderShell(user) {
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup"><span class="brand-mark">藥</span><div><span class="brand-name">PharmaFlow</span><span class="brand-caption">供應協作平台</span></div></div>
      <div class="workspace-switch"><span class="workspace-icon">⌘</span><div><span>目前工作區</span><strong>Phase 1 驗證環境</strong></div><span class="chevron">⌄</span></div>
       <nav class="side-nav"><span class="nav-label">工作台</span>${renderNavButton("dashboard", "總覽", "⌂")}${renderNavButton("demands", "門市需求池", "▤", demandCount())}${canView("replenishment") ? renderNavButton("replenishment", "自動補貨建議", "↻", pendingSuggestionCount()) : ""}${canView("allocations") ? renderNavButton("allocations", "總倉配貨作業", "⇥", allocationCount()) : ""}${canView("purchasing") ? renderNavButton("purchasing", "集中採購", "◫", purchaseGapCount()) : ""}${canView("supplierOperations") ? renderNavButton("supplierOperations", "供應商營運", "⌁", supplierReturnCount()) : ""}${canView("receipts") ? renderNavButton("receipts", "到貨與簽收", "✓", receiptCount()) : ""}<span class="nav-label secondary">管理</span>${canView("masters") ? renderNavButton("masters", "主檔與庫存", "▦") : ""}${canView("users") ? renderNavButton("users", "使用者管理", "♙") : ""}${canView("audit") ? renderNavButton("audit", "操作紀錄", "◷") : ""}</nav>
      <div class="sidebar-bottom"><div class="health-card"><span class="status-dot green"></span><div><strong>系統運作正常</strong><span>本機資料儲存已啟用</span></div></div><button class="side-text-button" data-action="reset-demo">↺ 重設示範資料</button></div>
    </aside>
    <main class="main-content">
      <header class="topbar"><div class="breadcrumb"><span>PharmaFlow</span><b>/</b><strong>${escapeHtml(VIEW_META[state.view]?.title || VIEW_META.dashboard.title)}</strong></div><div class="top-actions"><button class="icon-button ghost" data-action="open-profile" aria-label="查看個人資訊">◉</button><button class="user-menu" data-action="open-profile"><span class="avatar ${user.role.toLowerCase()}">${escapeHtml(user.displayName.slice(0, 1))}</span><span class="user-text"><b>${escapeHtml(user.displayName)}</b><small>${ROLE_LABELS[user.role]}${user.locationId ? ` · ${locationName(user.locationId)}` : ""}</small></span><span class="chevron">⌄</span></button></div></header>
      <div id="pageContent"></div>
    </main>
    ${state.modal ? renderModal() : ""}
    ${state.toast ? renderToast() : ""}
  </div>`;
}

function renderNavButton(view, label, icon, count = 0) {
  return `<button class="nav-item ${state.view === view ? "active" : ""}" data-action="navigate" data-view="${view}"><span class="nav-icon">${icon}</span><span>${label}</span>${count ? `<em>${count}</em>` : ""}</button>`;
}

function renderContent() {
  const target = document.getElementById("pageContent");
  if (!target) return;
  const page = state.view === "dashboard" ? renderDashboard() : state.view === "demands" ? renderDemands() : state.view === "replenishment" ? renderReplenishment() : state.view === "allocations" ? renderAllocations() : state.view === "purchasing" ? renderPurchasing() : state.view === "supplierOperations" ? renderSupplierOperations() : state.view === "receipts" ? renderReceipts() : state.view === "masters" ? renderMasters() : state.view === "users" ? renderUsers() : renderAudit();
  const salesImportControls = state.view === "masters" && currentUser()?.role === "ADMIN" ? `<input id="salesCsvInput" type="file" accept=".csv,text/csv" hidden />${renderSalesImportPanel()}` : "";
  target.innerHTML = `<div class="page-wrap">${salesImportControls}${page}${state.toast ? renderToast() : ""}</div>`;
  if (state.view === "purchasing") {
    target.querySelector(".procurement-filter-panel")?.insertAdjacentHTML("afterend", renderPurchaseSupplierWorkbench(visiblePurchaseSuggestions(), currentUser()));
  }
}

function renderPageIntro(eyebrow, title, description, actions = "") {
  return `<div class="page-intro"><div><span class="section-kicker">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
}

function renderDashboard() {
  const user = currentUser();
  const demands = visibleDemands();
  const openDemands = demands.filter((demand) => !["COMPLETED", "CANCELLED"].includes(demand.status));
  const suggestions = visibleSuggestions().filter((item) => ["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED"].includes(item.status));
  const allocations = visibleAllocations();
  const gap = purchaseGapCount();
  const roleFocus = user.role === "STORE" ? { kicker: "STORE CONTROL", title: `${locationName(user.locationId)}，今天先處理這些事`, desc: "需求進度與待簽收狀態集中在一個畫面，減少來回確認。" } : user.role === "WAREHOUSE" ? { kicker: "WAREHOUSE CONTROL", title: "把缺口變成下一張配貨單", desc: "先看全門市需求，再用總倉可用量決定全部或部分配貨。" } : user.role === "PURCHASING" ? { kicker: "PURCHASING CONTROL", title: "跨門市缺口，集中一次採購", desc: "依主要供應商、MOQ 與採購倍數彙總採購建議。" } : { kicker: "OPERATIONS CONTROL", title: "供應流程總覽", desc: "這裡是藥局門市、總倉與採購部門的共同作業入口。" };
  const metrics = user.role === "STORE" ? [
    metric("未完成需求", openDemands.length, "張", "blue", "demands"), metric("待確認補貨", suggestions.length, "筆", "violet", "replenishment"), metric("待簽收配貨", allocations.filter((item) => item.status === "SHIPPED").length, "張", "amber", "receipts"), metric("本月已完成", demands.filter((demand) => demand.status === "COMPLETED").length, "張", "green", "demands"),
  ] : user.role === "WAREHOUSE" ? [
    metric("待處理需求", openDemands.filter((item) => ["SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(item.status)).length, "張", "blue", "allocations"), metric("待揀貨配貨", allocations.filter((item) => item.status === "PICKING").length, "張", "violet", "allocations"), metric("已出貨未簽收", allocations.filter((item) => item.status === "SHIPPED").length, "張", "amber", "receipts"), metric("待採購缺口", gap, "項", "red", "purchasing"),
  ] : user.role === "PURCHASING" ? [
    metric("待採購商品", gap, "項", "red", "purchasing"), metric("進行中採購單", state.data.purchaseOrders.filter((po) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)).length, "張", "blue", "purchasing"), metric("未到貨數量", pendingPurchaseQty(), "件", "amber", "receipts"), metric("本月已到貨", receivedPurchaseQty(), "件", "green", "receipts"),
  ] : [
    metric("未完成需求", openDemands.length, "張", "blue", "demands"), metric("待採購缺口", gap, "項", "red", "purchasing"), metric("總倉可用 SKU", warehouseSkuCount(), "項", "green", "masters"), metric("今日操作紀錄", state.data.auditLogs.filter((item) => item.createdAt.startsWith(today)).length, "筆", "violet", "audit"),
  ];
  const attention = buildAttentionItems(user);
  return `${renderPageIntro(roleFocus.kicker, roleFocus.title, roleFocus.desc, user.role === "STORE" ? button("open-create-demand", "＋ 新增人工需求", "primary") : user.role === "WAREHOUSE" ? button("navigate", "檢視待配貨", "primary", { view: "allocations" }) : user.role === "PURCHASING" ? button("generate-purchase", "↻ 更新採購建議", "primary") : button("navigate", "開啟需求池", "primary", { view: "demands" }))}
    <div class="metric-grid">${metrics.join("")}</div>
    <div class="dashboard-grid"><section class="panel focus-panel"><div class="panel-heading"><div><span class="section-kicker">NEXT ACTIONS</span><h2>今日工作焦點</h2></div><span class="live-chip"><i></i>即時摘要</span></div><div class="attention-list">${attention.map(renderAttentionItem).join("") || emptyState("目前沒有需要立即處理的事項", "系統會在需求、配貨或採購狀態變更時更新。")}</div></section><section class="panel flow-panel"><div class="panel-heading"><div><span class="section-kicker">PHASE 1 FLOW</span><h2>供應流程</h2></div><span class="progress-caption">${workflowProgress()}% 完成</span></div>${renderFlow()}</section></div>
    <div class="dashboard-grid lower"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">RECENT DEMANDS</span><h2>最近需求</h2></div><button class="text-button" data-action="navigate" data-view="demands">查看全部 →</button></div>${renderCompactDemandList(demands.slice(0, 4))}</section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">INVENTORY SIGNAL</span><h2>總倉庫存訊號</h2></div><button class="text-button" data-action="navigate" data-view="masters">查看庫存 →</button></div>${renderInventorySignals()}</section></div>`;
}

function metric(label, value, suffix, tone, view) {
  return `<button class="metric-card ${tone}" data-action="navigate" data-view="${view}"><span>${label}</span><strong>${numberLabel(value)}<small>${suffix}</small></strong><em>查看詳情 ↗</em></button>`;
}

function button(action, label, tone = "secondary", data = {}) {
  const attrs = Object.entries({ ...data, action }).map(([key, value]) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeHtml(value)}"`).join(" ");
  return `<button class="button ${tone}" ${attrs}>${label}</button>`;
}

function renderFlow() {
  const steps = [
    ["demand", "門市提需求", "人工或補貨建議"], ["allocate", "總倉判斷", "全部 / 部分配貨"], ["purchase", "集中採購", "補足總倉缺口"], ["receive", "到貨與簽收", "需求完成結案"],
  ];
  return `<div class="flow-list">${steps.map(([icon, title, detail], index) => `<div class="flow-step"><span class="flow-number">0${index + 1}</span><span class="flow-symbol ${icon}">${index === 0 ? "↗" : index === 1 ? "⇥" : index === 2 ? "◫" : "✓"}</span><div><strong>${title}</strong><small>${detail}</small></div>${index < steps.length - 1 ? `<i class="flow-line"></i>` : ""}</div>`).join("")}</div>`;
}

function renderDemands() {
  const user = currentUser();
  const search = String(state.filters.demandsSearch || "").toLowerCase();
  const status = state.filters.demandsStatus || "ALL";
  const demands = visibleDemands().filter((demand) => {
    const text = `${demand.demandNumber} ${locationName(demand.locationId)} ${demand.items.map((item) => productName(item.productId)).join(" ")}`.toLowerCase();
    return (!search || text.includes(search)) && (status === "ALL" || demand.status === status);
  });
  const actions = user.role === "STORE" || user.role === "ADMIN" ? button("open-create-demand", "＋ 新增人工需求", "primary") : "";
  const pendingForManager = managerPendingDemands(user);
  const managerQueue = canReviewAsManager(user) ? `<section class="panel table-panel manager-queue"><div class="panel-heading compact"><div><span class="section-kicker">MANAGER REVIEW</span><h2>待核需求</h2></div><span class="table-count">${pendingForManager.length} 筆</span></div><div class="table-wrap"><table class="demand-review-table"><thead><tr><th>需求單</th><th>門市</th><th>建立人</th><th>明細</th><th>參考金額</th><th>狀態</th><th>操作</th></tr></thead><tbody>${pendingForManager.map(renderDemandRow).join("") || emptyRow(7, "目前沒有待核需求")}</tbody></table></div></section>` : "";
  return `${renderPageIntro("DEMAND WORKSPACE", "門市需求池", "人工需求先保存草稿，再送店長核單；店長核准後才會正式進入總倉處理佇列。", actions)}
    <div class="summary-strip"><div><span>目前顯示</span><strong>${demands.length}<small> 張需求</small></strong></div><div><span>待店長核單</span><strong class="violet-text">${visibleDemands().filter((item) => item.status === "PENDING_MANAGER_APPROVAL").length}</strong></div><div><span>待總倉處理</span><strong class="blue-text">${visibleDemands().filter((item) => ["SUBMITTED", "APPROVED"].includes(item.status)).length}</strong></div><div><span>門市資料隔離</span><strong class="green-text">${user.role === "STORE" ? locationName(user.locationId) : "全域"}</strong></div></div>
    ${managerQueue}
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="demandsSearch" value="${escapeHtml(state.filters.demandsSearch || "")}" placeholder="搜尋需求單號、門市或商品" /></label><select data-filter-key="demandsStatus"><option value="ALL">全部狀態</option>${Object.entries(STATUS_LABELS).filter(([key]) => ["DRAFT", "PENDING_MANAGER_APPROVAL", "RETURNED", "SUBMITTED", "APPROVED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE", "COMPLETED", "CANCELLED"].includes(key)).map(([key, label]) => `<option value="${key}" ${status === key ? "selected" : ""}>${label}</option>`).join("")}</select><span class="toolbar-spacer"></span><span class="table-count">${demands.length} 筆</span></div><div class="table-wrap"><table class="demand-list-table"><thead><tr><th>需求單</th><th>門市</th><th>來源 / 類型</th><th>需求日</th><th>明細</th><th>進度</th><th>操作</th></tr></thead><tbody>${demands.map(renderDemandRow).join("") || emptyRow(7, "目前沒有符合條件的需求")}</tbody></table></div></section>`;
}

function renderDemandRow(demand) {
  const user = currentUser();
  const total = demand.items.reduce((sum, item) => sum + toNumber(item.requestedQty), 0);
  const received = demand.items.reduce((sum, item) => sum + toNumber(item.receivedQty), 0);
  const amount = demand.items.reduce((sum, item) => sum + demandLineAmount(item), 0);
  const buttons = [button("open-demand", "查看", "ghost small", { id: demand.id })];
  if (canEditHumanDemand(demand, user) || canEditAutoDemand(demand, user)) buttons.push(button("open-edit-demand", "修改", "secondary small", { id: demand.id }));
  if (canSubmitHumanDemand(demand, user) || canSubmitAutoDemand(demand, user)) buttons.push(button("submit-demand", "送店長核單", "primary small", { id: demand.id }));
  if (canDeleteHumanDemand(demand, user)) buttons.push(button("delete-demand", "刪除", "ghost small", { id: demand.id }));
  if (canApproveDemand(demand, user)) {
    buttons.push(button("approve-demand", "核准並送總倉", "primary small", { id: demand.id }));
    buttons.push(button("return-demand", "退回", "ghost small", { id: demand.id }));
  } else if (canManagerReviewAutoDemand(demand, user)) {
    buttons.push(button("approve-auto-demand", "核准並送出", "primary small", { id: demand.id }));
    buttons.push(button("open-auto-manager-edit", "修改後核准", "secondary small", { id: demand.id }));
    buttons.push(button("return-auto-demand", "退回", "ghost small", { id: demand.id }));
  }
  return `<tr><td><strong class="mono">${demand.demandNumber}</strong><small class="cell-sub">${demand.createdAt}</small></td><td><strong>${locationName(demand.locationId)}</strong><small class="cell-sub">${demand.createdBy === currentUser()?.id ? "由我建立" : "跨單位需求"}</small></td><td><span class="source-chip ${demand.sourceType.toLowerCase()}">${demand.sourceType === "AUTO" ? "自動補貨" : "人工需求"}</span><small class="cell-sub">${demandTypeLabel(demand.demandType)}</small></td><td><strong>${demand.requiredDate}</strong><small class="cell-sub">${demand.requiredDate < today ? "已逾期" : "交期"}</small></td><td><strong>${demand.items.length} 項 · ${numberLabel(total)} 件</strong><small class="cell-sub">參考 ${formatMoney(amount)} 元 · 已收 ${numberLabel(received)} 件</small></td><td>${statusChip(demand.status)}</td><td><div class="row-actions">${buttons.join("")}</div></td></tr>`;
}

function renderReplenishment() {
  const user = currentUser();
  const suggestions = visibleSuggestions().filter((item) => {
    const status = state.filters.replenishmentStatus || "ALL";
    const search = String(state.filters.replenishmentSearch || "").toLowerCase();
    const text = `${productName(item.productId)} ${locationName(item.locationId)} ${item.reason || ""}`.toLowerCase();
    return (status === "ALL" || item.status === status) && (!search || text.includes(search));
  });
  const batchCandidates = suggestions.filter((item) => ["GENERATED", "STORE_REVIEWING"].includes(item.status));
  const actions = `${batchCandidates.length ? button("batch-accept-suggestions", `✓ 批次接受 ${batchCandidates.length} 筆`, "secondary", { scope: user.role === "ADMIN" ? "all" : "mine" }) : ""} ${button("run-replenishment", user.role === "ADMIN" ? "↻ 執行全部門市計算" : "↻ 重新計算本門市", "primary", { scope: user.role === "ADMIN" ? "all" : "mine" })}`;
  return `${renderPageIntro("REPLENISHMENT ENGINE", "自動補貨建議", "建議先由門市確認，再轉為正式需求；系統不會直接產生採購單。", actions)}
    <div class="formula-callout"><div class="formula-icon">ƒx</div><div><strong>計算邏輯已依 Phase 1 規則執行</strong><span>預估可用 = 現有 − 保留 + 配貨在途 + 採購入庫 + 未完成需求；低於安全庫存時，向上調整至門市配貨倍數。</span></div><button class="text-button" data-action="navigate" data-view="audit">查看紀錄 →</button></div>
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="replenishmentSearch" value="${escapeHtml(state.filters.replenishmentSearch || "")}" placeholder="搜尋商品、門市或建議原因" /></label><select data-filter-key="replenishmentStatus"><option value="ALL">全部狀態</option>${["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED", "CONVERTED_TO_DEMAND", "SKIPPED", "EXPIRED"].map((key) => `<option value="${key}" ${(state.filters.replenishmentStatus || "ALL") === key ? "selected" : ""}>${STATUS_LABELS[key]}</option>`).join("")}</select><span class="toolbar-spacer"></span><span class="table-count">${suggestions.length} 筆</span></div><div class="table-wrap"><table class="replenishment-table"><thead><tr><th>門市 / 商品</th><th>庫存快照</th><th>六個月銷售</th><th>安全 / 目標</th><th>系統 / 門市數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>${suggestions.map(renderSuggestionRow).join("") || emptyRow(7, "尚未產生補貨建議，請先執行計算")}</tbody></table></div></section>`;
}

function renderSuggestionRow(suggestion) {
  const settings = getSetting(suggestion.locationId, suggestion.productId);
  const actionable = ["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED"].includes(suggestion.status);
  const buttons = actionable
    ? [button("convert-suggestion", suggestion.status === "GENERATED" || suggestion.status === "STORE_REVIEWING" ? "確認並建立草稿" : "建立需求草稿", "primary small", { id: suggestion.id }), button("skip-suggestion", "暫不補貨", "ghost small", { id: suggestion.id })]
    : suggestion.demandId ? [button("open-demand", "查看來源需求", "ghost small", { id: suggestion.demandId })] : [];
  const sales = suggestion.sixMonthSalesSnapshot || {};
  const balance = getBalance(suggestion.locationId, suggestion.productId);
  const available = availableInventory(balance);
  const changed = inventorySnapshotChanged(suggestion, balance);
  const systemQty = suggestion.systemSuggestedQty ?? suggestion.suggestedQty;
  const preview = demandLinePreview({ productId: suggestion.productId, requestedQty: suggestion.storeConfirmedQty ?? systemQty }, suggestion.locationId, { useSnapshots: false });
  const condition = preview.condition;
  const supplierSummary = { requestedQty: suggestion.storeConfirmedQty ?? systemQty, amount: preview.lineAmount };
  const supplierStatus = supplierWarningMessage(supplierSummary, preview.supplierMinimumQty, preview.supplierMinimumAmount, preview.supplierPurchaseMultiple);
  const salesRows = (sales.months || []).map((month) => `<span><b>${escapeHtml(month.label)}</b><strong>${numberLabel(month.salesQty)}</strong></span>`).join("");
  return `<tr><td><strong>${locationName(suggestion.locationId)}</strong><small class="cell-sub">${productCode(suggestion.productId)} · ${productName(suggestion.productId)}</small><small class="cell-sub">${escapeHtml(preview.product?.specification || "未提供規格")} · 主要供應商：${escapeHtml(supplierName(preview.supplierId))}</small></td><td><strong class="big-cell">${numberLabel(available)} 件</strong><small class="cell-sub">現有 ${numberLabel(balance.onHandQty)} · 保留 ${numberLabel(balance.reservedQty)} · 可用 ${numberLabel(available)}</small><small class="cell-sub">計算快照 ${numberLabel(suggestion.availableQtySnapshot ?? 0)} · ${snapshotCalculatedAt(suggestion)}</small>${changed ? `<div class="inventory-change-warning">⚠ 庫存已變動</div>` : ""}</td><td><strong>${numberLabel(sales.total ?? 0)} 件</strong><small class="cell-sub">平均 ${numberLabel(sales.average ?? 0)} · 最大 ${numberLabel(sales.max ?? 0)} · 最小 ${numberLabel(sales.min ?? 0)}</small><div class="mini-sales-grid suggestion-sales-grid">${salesRows}</div></td><td><strong>${numberLabel(settings.safetyStockQty)} / ${numberLabel(settings.maximumStockQty)}</strong><small class="cell-sub">安全庫存 / 最高庫存 · 最低補貨 ${numberLabel(settings.minimumReplenishmentQty)} · 倍數 ${numberLabel(settings.storeDistributionMultiple)}</small><div class="condition-alert compact-condition ${condition.eligible ? "ok" : "blocked"}"><span>${condition.eligible ? "✓" : "⚠"} ${escapeHtml(conditionModeLabel(condition.mode))}</span><strong>${escapeHtml(conditionMessage(condition))}</strong><small>最低 ${condition.minimumQty === null ? "未設定" : `${numberLabel(condition.minimumQty)} 件`} · ${condition.minimumAmount === null ? "未設定" : `${formatMoney(condition.minimumAmount)} 元`}</small></div></td><td><strong class="accent-number">${numberLabel(systemQty)} 件</strong><small class="cell-sub">門市 ${suggestion.storeConfirmedQty == null ? "尚未確認" : `${numberLabel(suggestion.storeConfirmedQty)} 件`}</small><small class="cell-sub">單價 ${formatMoney(preview.referencePurchasePrice)} 元 · 需求金額 ${formatMoney(preview.lineAmount)} 元</small><div class="supplier-alert compact-supplier-alert"><strong>ⓘ ${escapeHtml(supplierStatus)}</strong></div></td><td>${statusChip(suggestion.status)}${changed ? `<small class="warning-text">⚠ 請重新確認</small>` : ""}</td><td><div class="row-actions">${buttons.join("")}</div></td></tr>`;
}

function renderAllocations() {
  const demands = visibleDemands().filter((demand) => ["SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(demand.status));
  const allocationHistory = state.data.allocations.filter((item) => ["PICKING", "SHIPPED", "RECEIVED"].includes(item.status));
  return `${renderPageIntro("WAREHOUSE DESK", "總倉配貨作業", "依總倉可用庫存處理需求；建立配貨後才能揀貨與出貨。", `<span class="inline-stat"><b>${demands.length}</b> 待處理需求</span>`)}
    <div class="warehouse-hero"><div class="warehouse-hero-icon">⇥</div><div><span class="section-kicker">AVAILABLE INVENTORY</span><strong>總倉可用庫存 ${numberLabel(totalWarehouseAvailable())} 件</strong><span>已扣除保留量；每次配貨都會留下庫存異動紀錄。</span></div><button class="button light" data-action="navigate" data-view="masters">查看總倉庫存</button></div>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">DEMAND QUEUE</span><h2>待配貨需求</h2></div><span class="table-count">${demands.length} 張</span></div><div class="table-wrap"><table class="allocation-demand-table"><thead><tr><th>需求單</th><th>門市</th><th>需求明細</th><th>需求量</th><th>已配 / 缺口</th><th>狀態</th><th>操作</th></tr></thead><tbody>${demands.map(renderAllocationDemandRow).join("") || emptyRow(7, "目前沒有待配貨需求")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">ALLOCATION ORDERS</span><h2>配貨單進度</h2></div><span class="table-count">${allocationHistory.length} 張</span></div><div class="table-wrap"><table class="allocation-history-table"><thead><tr><th>配貨單</th><th>送往門市</th><th>來源需求</th><th>數量</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody>${allocationHistory.map(renderAllocationRow).join("") || emptyRow(7, "尚未建立配貨單")}</tbody></table></div></section>`;
}

function renderAllocationDemandRow(demand) {
  const totals = demandTotals(demand);
  return `<tr><td><strong class="mono">${demand.demandNumber}</strong><small class="cell-sub">${demand.sourceType === "AUTO" ? "自動補貨轉單" : "門市人工需求"}</small></td><td><strong>${locationName(demand.locationId)}</strong></td><td><strong>${demand.items.length} 項</strong><small class="cell-sub">${demand.items.slice(0, 2).map((item) => productName(item.productId)).join("、")}${demand.items.length > 2 ? "…" : ""}</small></td><td><strong>${numberLabel(totals.requested)} 件</strong></td><td><span class="qty-progress">${numberLabel(totals.allocated)} / ${numberLabel(totals.shortage)}</span><small class="cell-sub">已配 / 尚缺</small></td><td>${statusChip(demand.status)}</td><td><div class="row-actions">${button("open-allocation", "處理配貨", "primary small", { id: demand.id })}</div></td></tr>`;
}

function renderAllocationRow(allocation) {
  const total = allocation.items.reduce((sum, item) => sum + toNumber(item.shippedQty), 0);
  return `<tr><td><strong class="mono">${allocation.allocationNumber}</strong><small class="cell-sub">${allocation.createdAt}</small></td><td><strong>${locationName(allocation.destinationLocationId)}</strong></td><td><strong class="mono">${demandNumber(allocation.demandOrderId)}</strong></td><td><strong>${numberLabel(total)} 件</strong><small class="cell-sub">${allocation.items.length} 項</small></td><td>${statusChip(allocation.status)}</td><td>${allocation.shippedAt || allocation.createdAt}</td><td>${allocation.status === "PICKING" ? button("ship-allocation", "標記出貨", "primary small", { id: allocation.id }) : allocation.status === "SHIPPED" ? `<span class="muted-text">等待門市簽收</span>` : `<span class="muted-text">已完成</span>`}</td></tr>`;
}

function renderPurchasing() {
  const user = currentUser();
  const suggestions = visiblePurchaseSuggestions();
  const orders = visiblePurchaseOrders();
  const canManage = canManagePurchaseOrders(user);
  const actions = `${button("generate-purchase", "↻ 重新彙總採購建議", "primary")}${canManage ? button("open-manual-purchase-order", "＋ 手動新增採購單", "secondary") : ""}${button("export-purchase-csv", "匯出 CSV", "ghost")}`;
  const suggestionQty = suggestions.reduce((sum, item) => sum + toNumber(item.suggestedPurchaseQty ?? item.suggestedQty), 0);
  const activeOrders = orders.filter((order) => ["DRAFT", "PENDING_CONFIRMATION", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(order.status));
  const tracking = orders.filter((order) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) && getPurchaseOrderMetrics(order).remainingQty > 0);
  return `${renderPageIntro("PURCHASING DESK", "集中採購與採購單管理", "把已核准且總倉無法配足的需求彙總成採購建議，保留供應商條件、總倉備貨與門市來源追蹤。", `<div class="page-actions-stack">${actions}</div>`)}
    <div class="purchase-summary"><div><span>待採購需求缺口</span><strong>${numberLabel(openPurchaseDemandQty())}<small> 件</small></strong><em>僅含核准後開放採購狀態</em></div><div><span>系統建議採購量</span><strong>${numberLabel(suggestionQty)}<small> 件</small></strong><em>已套用 MOQ 與採購倍數</em></div><div><span>進行中採購單</span><strong>${activeOrders.length}<small> 張</small></strong><em>草稿、下單及到貨中</em></div><div><span>未到貨數量</span><strong>${numberLabel(tracking.reduce((sum, order) => sum + getPurchaseOrderMetrics(order).remainingQty, 0))}<small> 件</small></strong><em>可由總倉登記到貨</em></div></div>
    ${renderProcurementFilters()}
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">PURCHASE SUGGESTIONS</span><h2>集中採購建議</h2></div><span class="table-count">${suggestions.length} 筆 · 依供應商彙總</span></div><div class="table-wrap"><table class="purchase-suggestion-table"><thead><tr><th>供應商 / 商品</th><th>採購單位</th><th>來源門市 / 需求</th><th>原始需求 / 總倉補充</th><th>MOQ / 倍數</th><th>建議 / 確認</th><th>多買備貨</th><th>金額 / 最低金額</th><th>操作</th></tr></thead><tbody>${suggestions.map(renderPurchaseSuggestionRow).join("") || emptyRow(9, "目前沒有待建立的採購建議")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">PURCHASE ORDERS</span><h2>採購單管理</h2></div><span class="table-count">${orders.length} 張</span></div><div class="table-wrap"><table class="purchase-order-table"><thead><tr><th>採購單</th><th>供應商 / 狀態</th><th>品項 / 數量</th><th>下單 / 預計到貨</th><th>已到 / 剩餘</th><th>金額</th><th>操作</th></tr></thead><tbody>${orders.map(renderPurchaseOrderRow).join("") || emptyRow(7, "尚未建立採購單")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">OUTSTANDING TRACKING</span><h2>採購未到貨追蹤</h2></div><span class="table-count">${tracking.length} 張</span></div><div class="table-wrap"><table class="purchase-tracking-table"><thead><tr><th>採購單 / 供應商</th><th>商品</th><th>訂購 / 已到 / 未到</th><th>預計到貨</th><th>來源門市</th><th>最近聯繫</th><th>操作</th></tr></thead><tbody>${tracking.map(renderPurchaseTrackingRow).join("") || emptyRow(7, "目前沒有未到貨採購單")}</tbody></table></div></section>`;
}

function renderProcurementSnapshotHtml(productId, options = {}) {
  const snapshot = buildProcurementProductSnapshot({
    productId,
    locations: state.data.locations || [],
    inventory: state.data.inventory || [],
    monthlyProductSales: state.data.monthlyProductSales || [],
    demands: state.data.demands || [],
    allocations: state.data.allocations || [],
    purchaseOrders: state.data.purchaseOrders || [],
    purchaseOrderItemStoreAllocations: state.data.purchaseOrderItemStoreAllocations || [],
    referenceDate: today,
  });
  const user = currentUser();
  const stores = user?.role === "STORE" ? snapshot.stores.filter((store) => store.locationId === user.locationId) : snapshot.stores;
  const monthLabels = snapshot.months.map((month) => month.label).join("、");
  const companyTotal = {
    locationName: "五店合計",
    inventory: snapshot.storeInventoryTotal,
    sales: snapshot.companySales,
    allocatedInTransitQty: stores.reduce((sum, store) => sum + toNumber(store.allocatedInTransitQty), 0),
    openDemandQty: stores.reduce((sum, store) => sum + toNumber(store.openDemandQty), 0),
    isCompanyTotal: true,
    isWarehouse: false,
  };
  const rows = user?.role === "STORE" ? stores.map((store) => ({ ...store, isWarehouse: false })) : [...stores.map((store) => ({ ...store, isWarehouse: false })), companyTotal, { ...snapshot.warehouse, isWarehouse: true }];
  const monthHeaders = snapshot.months.map((month) => `<th>${escapeHtml(month.label)}</th>`).join("");
  return `<details class="procurement-snapshot"><summary>查看 ${escapeHtml(productName(productId))} 的五店與總倉庫存、六個完整月份銷售</summary><p class="modal-note">銷售月份：${escapeHtml(monthLabels)}；總倉銷售顯示 N/A。配貨數量是規劃值，不代表實際庫存，也不會直接異動庫存。</p><div class="table-wrap"><table class="procurement-snapshot-table"><thead><tr><th>據點</th><th>現有 / 保留</th><th>可用庫存</th><th>採購未到 / 已配貨未簽收</th><th>待配貨 / 未完成需求</th>${monthHeaders}<th>六個月合計</th><th>月平均 / 最高 / 最低</th><th>預計配貨</th></tr></thead><tbody>${rows.map((row) => { const planned = row.isCompanyTotal ? stores.reduce((sum, store) => sum + toNumber(options.plannedByStore?.[store.locationId]), 0) : toNumber(options.plannedByStore?.[row.locationId]); const monthCells = row.sales ? row.sales.months.map((month) => `<td>${numberLabel(month.salesQty)}</td>`).join("") : snapshot.months.map(() => "<td>N/A</td>").join(""); const inboundOrTransit = row.isWarehouse ? numberLabel(row.purchaseInboundQty || 0) : numberLabel(row.allocatedInTransitQty || 0); const pendingOrDemand = row.isWarehouse ? numberLabel(row.pendingAllocationQty || 0) : numberLabel(row.openDemandQty || 0); const salesStats = row.sales ? `${numberLabel(row.sales.average)} / ${numberLabel(row.sales.max)} / ${numberLabel(row.sales.min)}` : "N/A"; return `<tr class="${row.isCompanyTotal ? "snapshot-total-row" : ""}"><td class="snapshot-location"><strong>${escapeHtml(row.locationName)}</strong>${row.isWarehouse ? "<small>總倉</small>" : row.isCompanyTotal ? "<small>門市合計</small>" : "<small>門市</small>"}</td><td>${numberLabel(row.inventory.onHandQty)} / ${numberLabel(row.inventory.reservedQty)} 件</td><td><strong>${numberLabel(row.inventory.availableQty)} 件</strong></td><td>${inboundOrTransit} 件</td><td>${pendingOrDemand} 件</td>${monthCells}<td>${row.sales ? numberLabel(row.sales.total) : "N/A"}</td><td>${salesStats}</td><td>${row.isWarehouse ? "—" : `${numberLabel(planned)} 件`}</td></tr>`; }).join("")}</tbody></table></div></details>`;
}

function renderPurchaseOrderPlanSummary(order) {
  const plans = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderId === order.id);
  if (!plans.length) return "";
  return `<section class="detail-section purchase-plan-summary"><h3>門市配貨規劃與總倉留存</h3>${order.lines.map((line) => { const rows = plans.filter((plan) => plan.purchaseOrderItemId === line.id); const planned = rows.reduce((sum, plan) => sum + toNumber(plan.plannedDistributionQty ?? plan.confirmedAllocationQty), 0); return `<article class="purchase-progress-card"><div><strong>${escapeHtml(productName(line.productId))}</strong><small>確認採購 ${numberLabel(line.confirmedPurchaseQty ?? line.orderedQty)} 件</small></div><div><strong>${numberLabel(planned)} 件配貨 · ${numberLabel(Math.max(0, toNumber(line.orderedQty) - planned))} 件總倉留存</strong><small>${rows.map((plan) => `${escapeHtml(locationName(plan.destinationLocationId || plan.locationId))} ${numberLabel(plan.plannedDistributionQty ?? plan.confirmedAllocationQty)} 件`).join(" · ")}</small></div></article>`; }).join("")}</section>`;
}

function renderPurchaseSupplierWorkbench(suggestions, user) {
  if (!suggestions.length) return "";
  const groups = [...suggestions.reduce((map, suggestion) => {
    const rows = map.get(suggestion.supplierId) || [];
    rows.push(suggestion);
    map.set(suggestion.supplierId, rows);
    return map;
  }, new Map()).entries()];
  return `<section class="panel purchase-supplier-workbench"><div class="panel-heading compact"><div><span class="section-kicker">SUPPLIER WORKBENCH</span><h2>依供應商分組的採購工作台</h2></div><span class="table-count">${groups.length} 家供應商</span></div><div class="supplier-workbench-grid">${groups.map(([supplierId, rows]) => {
    const supplier = state.data.suppliers.find((item) => item.id === supplierId) || {};
    const itemCount = rows.length;
    const suggestedQty = rows.reduce((sum, row) => sum + toNumber(row.suggestedPurchaseQty), 0);
    const manualQty = rows.reduce((sum, row) => sum + toNumber(row.manualAddedQty), 0);
    const plannedQty = rows.reduce((sum, row) => sum + toNumber(row.confirmedPurchaseQty ?? row.purchaserConfirmedQty ?? row.suggestedPurchaseQty), 0);
    const amount = rows.reduce((sum, row) => sum + toNumber(row.confirmedPurchaseQty ?? row.purchaserConfirmedQty ?? row.suggestedPurchaseQty) * decimalToCents(row.purchasePrice), 0);
    const minimumAmountCents = Math.max(0, decimalToCents(supplier.minimumOrderAmount ?? 0));
    const minimumAmountMet = amount >= minimumAmountCents;
    const minimumShortfallCents = Math.max(0, minimumAmountCents - amount);
    const itemConditionFailures = rows.filter((row) => {
      const multiple = Math.max(1, Math.floor(toNumber(row.purchaseMultiple || 1)));
      const confirmed = toNumber(row.confirmedPurchaseQty ?? row.purchaserConfirmedQty ?? row.suggestedPurchaseQty);
      return confirmed < toNumber(row.minimumOrderQuantity) || (confirmed > 0 && confirmed % multiple !== 0);
    }).length;
    const conditionFailureCount = itemConditionFailures + (minimumAmountMet || !rows.length ? 0 : 1);
    const selectedIds = rows.filter((row) => !row.purchaseOrderId && row.status !== "NO_GROUP").map((row) => row.id).join(",");
    const openRows = rows.filter((row) => !row.purchaseOrderId && row.status !== "NO_GROUP");
    const actions = canManagePurchaseOrders(user) ? `${openRows.length ? button("create-purchase-order", "建立此供應商採購單", "primary small", { suggestionIds: selectedIds }) : ""}${openRows.length ? button("mark-no-group-batch", "整批標記無成團", "danger small", { supplierId }) : ""}` : "";
    return `<article class="supplier-workbench-card"><div class="section-row"><div><strong>${escapeHtml(supplier.name || supplierName(supplierId))}</strong><small>${itemCount} 項商品 · ${numberLabel(new Set(rows.flatMap((row) => row.sourceLocationIds || [])).size)} 門市來源</small></div><span class="status-chip ${rows.some((row) => row.status === "NO_GROUP") ? "no_group" : "pending"}">${rows.some((row) => row.status === "NO_GROUP") ? "含無成團" : "待處理"}</span></div><div class="supplier-workbench-metrics"><span>系統建議 <b>${numberLabel(suggestedQty)} 件</b></span><span>人工新增 <b>${numberLabel(manualQty)} 件</b></span><span>預計採購總數 <b>${numberLabel(plannedQty)} 件</b></span><span>目前選取金額 <b>${centsToDecimal(amount)} 元</b></span><span>最低採購金額 <b>${escapeHtml(String(supplier.minimumOrderAmount ?? "0"))} 元</b></span><span>${minimumAmountMet ? "最低金額已達標" : `尚差 ${centsToDecimal(minimumShortfallCents)} 元`} <b>${minimumAmountMet ? "✓" : "⚠"}</b></span><span>未達條件商品/批次 <b>${numberLabel(conditionFailureCount)}</b></span></div><div class="supplier-workbench-products">${rows.map((row) => `<div><strong>${escapeHtml(productName(row.productId))} · ${numberLabel(row.suggestedPurchaseQty)} 件</strong>${renderProcurementSnapshotHtml(row.productId)}</div>`).join("")}</div><div class="row-actions">${actions}</div></article>`;
  }).join("")}</div></section>`;
}

function renderPurchaseSuggestionRow(suggestion) {
  const product = state.data.products.find((item) => item.id === suggestion.productId);
  const purchaseUnit = suggestion.purchaseUnit || product?.baseUnit || "件";
  const sourceLocations = (suggestion.sourceLocationIds || suggestion.sourceDemandIds?.map((id) => getDemand(id)?.locationId) || []).filter(Boolean).map(locationName);
  const sourceSummary = (suggestion.sourceAllocations || []).map((source) => `${locationName(source.locationId)} · ${demandNumber(source.demandOrderId)} · ${numberLabel(source.allocatedQty)} 件`).join("；");
  const amount = suggestion.estimatedAmountCents !== undefined ? centsToDecimal(toNumber(suggestion.estimatedAmountCents)) : formatMoney(toNumber(suggestion.suggestedPurchaseQty ?? suggestion.suggestedQty) * toNumber(suggestion.purchasePrice));
  const minAmount = suggestion.minimumAmountCents !== undefined ? centsToDecimal(toNumber(suggestion.minimumAmountCents)) : String(suggestion.supplierMinimumOrderAmount ?? "0.00");
  const canManage = canManagePurchaseOrders(currentUser());
  const action = suggestion.purchaseOrderId
    ? button("open-purchase-order", "查看已轉採購單", "ghost small", { id: suggestion.purchaseOrderId })
    : canManage && suggestion.status === "NO_GROUP" ? button("reopen-purchase-suggestion", "重新開啟", "secondary small", { id: suggestion.id })
      : canManage ? `${button("create-purchase-order", "建立草稿", "primary small", { id: suggestion.id })}${button("mark-no-group", "標記無成團", "danger small", { id: suggestion.id })}` : `<span class="muted-text">採購人員處理</span>`;
  return `<tr><td><strong>${escapeHtml(supplierName(suggestion.supplierId))}</strong><small class="cell-sub">${escapeHtml(productCode(suggestion.productId))} · ${escapeHtml(product?.name || productName(suggestion.productId))}</small><small class="cell-sub">${escapeHtml(product?.specification || "未提供規格")}</small></td><td><strong>${escapeHtml(purchaseUnit)}</strong><small class="cell-sub">供應商品號 ${escapeHtml(suggestion.supplierProductCode || "—")}</small></td><td><strong>${sourceLocations.join("、") || "總倉備貨"}</strong><small class="cell-sub">${numberLabel(suggestion.sourceDemandCount || suggestion.sourceDemandIds?.length || 0)} 張需求 · ${numberLabel(suggestion.demandAllocatedQty)} 件需求</small>${sourceSummary ? `<small class="cell-sub">${escapeHtml(sourceSummary)}</small>` : ""}</td><td><strong class="red-text big-cell">${numberLabel(suggestion.rawPurchaseQty)} 件</strong><small class="cell-sub">需求 ${numberLabel(suggestion.demandAllocatedQty)} · 總倉補充 ${numberLabel(suggestion.warehouseSupplementQty)}</small></td><td><strong>${numberLabel(suggestion.minimumOrderQuantity)} / ${numberLabel(suggestion.purchaseMultiple)}</strong><small class="cell-sub">MOQ / 採購倍數</small></td><td><strong class="accent-number big-cell">${numberLabel(suggestion.suggestedPurchaseQty)} 件</strong><small class="cell-sub">確認 ${numberLabel(suggestion.confirmedPurchaseQty)} 件</small></td><td><strong>${numberLabel(suggestion.warehouseBufferQty)} 件</strong><small class="cell-sub">因 MOQ/倍數增加，列總倉備貨</small></td><td><strong>${amount} 元</strong><small class="cell-sub">最低 ${minAmount} 元 · ${suggestion.minimumAmountMet ? "已達標" : `尚差 ${centsToDecimal(suggestion.minimumAmountShortfallCents)} 元`}</small></td><td><div class="row-actions">${statusChip(suggestion.status)}${action}</div></td></tr>`;
}

function renderPurchaseOrderRow(order) {
  const metrics = getPurchaseOrderMetrics(order);
  const canManage = canManagePurchaseOrders(currentUser());
  const canReceive = canReceivePurchaseOrders(currentUser());
  const canEdit = canManage && ["DRAFT", "PENDING_CONFIRMATION"].includes(order.status);
  const actions = [
    button("open-purchase-order", "查看詳情", "ghost small", { id: order.id }),
    canEdit ? button("edit-purchase-order", "編輯", "secondary small", { id: order.id }) : "",
    canManage && order.status === "DRAFT" ? button("confirm-purchase-order", "確認採購單", "primary small", { id: order.id }) : "",
    canManage && order.status === "PENDING_CONFIRMATION" ? button("order-purchase-order", "標記已下單", "primary small", { id: order.id }) : "",
    canReceive && ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) ? button("open-receive-po", "登記到貨", "primary small", { id: order.id }) : "",
    canManage && ["DRAFT", "PENDING_CONFIRMATION", "ORDERED"].includes(order.status) ? button("cancel-purchase-order", "取消", "danger small", { id: order.id }) : "",
    canManage && order.status === "PARTIALLY_RECEIVED" && metrics.remainingQty > 0 ? button("cancel-purchase-order", "取消剩餘", "danger small", { id: order.id, remainingOnly: true }) : "",
    canManage && ["RECEIVED", "PARTIALLY_RECEIVED", "ORDERED"].includes(order.status) && metrics.remainingQty === 0 ? button("close-purchase-order", "結案", "secondary small", { id: order.id }) : "",
    canManage && ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) ? button("open-purchase-tracking", "更新追蹤", "ghost small", { id: order.id }) : "",
  ].filter(Boolean).join("");
  return `<tr><td><strong class="mono">${escapeHtml(order.purchaseOrderNumber)}</strong><small class="cell-sub">${order.orderDate} · ${escapeHtml(order.sourceType || "MIXED")}</small></td><td><strong>${escapeHtml(supplierName(order.supplierId))}</strong><small class="cell-sub">${statusChip(order.status)}</small></td><td><strong>${numberLabel(order.lines.length)} 項 · ${numberLabel(metrics.orderedQty)} 件</strong><small class="cell-sub">${order.lines.map((line) => productName(line.productId)).join("、")}</small></td><td><strong>${escapeHtml(order.orderDate || "—")}</strong><small class="cell-sub">預計 ${escapeHtml(order.expectedDeliveryDate || "—")}</small></td><td><strong class="big-cell">${numberLabel(metrics.receivedQty)} / ${numberLabel(metrics.remainingQty)}</strong><small class="cell-sub">已到 / 未到（取消 ${numberLabel(metrics.cancelledQty)}）</small></td><td><strong>${escapeHtml(String(order.totalAmount || "0.00"))} 元</strong><small class="cell-sub">最低金額 ${order.minimumAmountMet ? "已達標" : "未達標/例外"}</small></td><td><div class="row-actions">${actions || `<span class="muted-text">僅供查看</span>`}</div></td></tr>`;
}

function renderProcurementFilters() {
  const sourceOptions = [{ id: "ALL", name: "全部來源門市" }, ...(state.data.locations || []).filter((location) => location.type === "STORE")];
  return `<section class="panel procurement-filter-panel"><div class="toolbar procurement-filter-grid"><label class="search-field"><span>⌕</span><input data-filter-key="purchaseSearch" value="${escapeHtml(state.filters.purchaseSearch || "")}" placeholder="搜尋採購單、供應商、商品或門市" /></label><label class="field-inline"><span>需求單號</span><input data-filter-key="purchaseDemandNumber" value="${escapeHtml(state.filters.purchaseDemandNumber || "")}" placeholder="DN-" /></label><select data-filter-key="purchaseStatus"><option value="ALL">全部採購單狀態</option>${["DRAFT", "PENDING_CONFIRMATION", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"].map((status) => `<option value="${status}" ${(state.filters.purchaseStatus || "ALL") === status ? "selected" : ""}>${STATUS_LABELS[status]}</option>`).join("")}</select><select data-filter-key="purchaseSourceLocation">${sourceOptions.map((location) => `<option value="${location.id}" ${(state.filters.purchaseSourceLocation || "ALL") === location.id ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}</select><select data-filter-key="purchaseSort"><option value="LATEST" ${(state.filters.purchaseSort || "LATEST") === "LATEST" ? "selected" : ""}>最新建立</option><option value="EXPECTED" ${state.filters.purchaseSort === "EXPECTED" ? "selected" : ""}>最早預計到貨</option><option value="AMOUNT" ${state.filters.purchaseSort === "AMOUNT" ? "selected" : ""}>採購金額</option><option value="REMAINING" ${state.filters.purchaseSort === "REMAINING" ? "selected" : ""}>未到貨數量</option><option value="OVERDUE" ${state.filters.purchaseSort === "OVERDUE" ? "selected" : ""}>逾期天數</option></select><label class="field-inline"><span>下單日期起</span><input data-filter-key="purchaseOrderDateFrom" type="date" value="${escapeHtml(state.filters.purchaseOrderDateFrom || "")}" /></label><label class="field-inline"><span>下單日期迄</span><input data-filter-key="purchaseOrderDateTo" type="date" value="${escapeHtml(state.filters.purchaseOrderDateTo || "")}" /></label><label class="field-inline"><span>預計到貨起</span><input data-filter-key="purchaseExpectedDateFrom" type="date" value="${escapeHtml(state.filters.purchaseExpectedDateFrom || "")}" /></label><label class="field-inline"><span>預計到貨迄</span><input data-filter-key="purchaseExpectedDateTo" type="date" value="${escapeHtml(state.filters.purchaseExpectedDateTo || "")}" /></label><label class="checkbox-field compact-checkbox"><input type="checkbox" data-filter-key="purchaseOverdue" ${state.filters.purchaseOverdue === "true" ? "checked" : ""} /><span>只看逾期未到</span></label><label class="checkbox-field compact-checkbox"><input type="checkbox" data-filter-key="purchasePartial" ${state.filters.purchasePartial === "true" ? "checked" : ""} /><span>只看部分到貨</span></label><label class="checkbox-field compact-checkbox"><input type="checkbox" data-filter-key="purchaseException" ${state.filters.purchaseException === "true" ? "checked" : ""} /><span>只看例外下單</span></label></div></section>`;
}

function renderPurchaseTrackingRow(order) {
  const metrics = getPurchaseOrderMetrics(order);
  const lines = order.lines || [];
  const sources = [...new Set(lines.flatMap((line) => (line.sourceAllocations || []).map((source) => locationName(source.locationId))))].filter(Boolean);
  const note = state.data.purchaseTrackingNotes.find((item) => item.purchaseOrderId === order.id);
  const overdueDays = purchaseOverdueDays(order);
  const vendorStatus = note?.vendorStatus === "SHORTAGE" ? "廠商缺貨" : note?.vendorStatus === "PARTIAL" ? "部分供貨" : note?.vendorStatus === "CONFIRMED" ? "已確認到貨日" : "尚待回覆";
  return `<tr><td><strong class="mono">${escapeHtml(order.purchaseOrderNumber)}</strong><small class="cell-sub">${escapeHtml(supplierName(order.supplierId))}</small></td><td><strong>${lines.map((line) => productName(line.productId)).join("、")}</strong><small class="cell-sub">${numberLabel(lines.length)} 項</small></td><td><strong class="big-cell">${numberLabel(metrics.orderedQty)} / ${numberLabel(metrics.receivedQty)} / ${numberLabel(metrics.remainingQty)}</strong><small class="cell-sub">訂購 / 已到 / 未到 · ${metrics.receivedQty > 0 ? "部分到貨" : "尚未到貨"}</small></td><td><strong>${escapeHtml(order.expectedDeliveryDate || "—")}</strong><small class="cell-sub">${overdueDays > 0 ? `⚠ 已逾期 ${overdueDays} 天` : "尚未到期"}</small></td><td>${escapeHtml(sources.join("、") || "總倉備貨")}</td><td><strong>${escapeHtml(note?.contactDate || "尚未聯繫")}</strong><small class="cell-sub">${escapeHtml(vendorStatus)}</small></td><td>${canManagePurchaseOrders(currentUser()) ? button("open-purchase-tracking", "更新追蹤", "secondary small", { id: order.id }) : `<span class="muted-text">採購人員處理</span>`}</td></tr>`;
}

function renderReceipts() {
  const user = currentUser();
  const incoming = visibleAllocations().filter((item) => item.status === "SHIPPED");
  const purchaseOrders = state.data.purchaseOrders.filter((item) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(item.status));
  return `${renderPageIntro("RECEIVING DESK", "到貨與門市簽收", user.role === "STORE" ? "確認實收數量與差異原因，簽收後會增加門市庫存並更新需求狀態。" : "採購到貨先進入總倉；配貨出貨後，門市才能完成最後簽收。", user.role === "STORE" ? `<span class="inline-stat"><b>${incoming.length}</b> 待簽收</span>` : `<span class="inline-stat"><b>${purchaseOrders.length}</b> 張待到貨採購單</span>`)}
    ${user.role !== "STORE" ? `<section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">WAREHOUSE RECEIVING</span><h2>採購到貨</h2></div><button class="text-button" data-action="navigate" data-view="purchasing">查看採購單 →</button></div><div class="table-wrap"><table class="purchase-receiving-table"><thead><tr><th>採購單</th><th>供應商</th><th>品項</th><th>預計到貨</th><th>狀態</th><th>待到貨</th><th>操作</th></tr></thead><tbody>${purchaseOrders.map(renderPurchaseOrderRow).join("") || emptyRow(7, "目前沒有待登記到貨採購單")}</tbody></table></div></section>` : ""}
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">STORE RECEIVING</span><h2>待簽收配貨單</h2></div><span class="table-count">${incoming.length} 張</span></div><div class="table-wrap"><table class="receiving-table"><thead><tr><th>配貨單</th><th>需求單</th><th>出貨日期</th><th>配送品項</th><th>數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>${incoming.map(renderIncomingRow).join("") || emptyRow(7, "目前沒有待簽收配貨單")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">RECEIVING HISTORY</span><h2>最近簽收紀錄</h2></div></div><div class="table-wrap"><table class="receiving-history-table"><thead><tr><th>配貨單</th><th>門市</th><th>簽收時間</th><th>實收數量</th><th>狀態</th></tr></thead><tbody>${visibleAllocations().filter((item) => item.status === "RECEIVED").slice(0, 8).map((item) => `<tr><td class="mono">${item.allocationNumber}</td><td>${locationName(item.destinationLocationId)}</td><td>${item.receivedAt || "—"}</td><td>${numberLabel(item.items.reduce((sum, line) => sum + line.receivedQty, 0))} 件</td><td>${statusChip(item.status)}</td></tr>`).join("") || emptyRow(5, "尚未有簽收紀錄")}</tbody></table></div></section>`;
}

function renderIncomingRow(allocation) {
  const total = allocation.items.reduce((sum, line) => sum + line.shippedQty, 0);
  return `<tr><td><strong class="mono">${allocation.allocationNumber}</strong></td><td><strong>${demandNumber(allocation.demandOrderId)}</strong></td><td>${allocation.shippedAt || "—"}</td><td><strong>${allocation.items.map((line) => productName(line.productId)).join("、")}</strong></td><td>${numberLabel(total)} 件</td><td>${statusChip(allocation.status)}</td><td>${button("open-receive-allocation", "開始簽收", "primary small", { id: allocation.id })}</td></tr>`;
}

function renderMasters() {
  const user = currentUser();
  if (!canViewMasterData(user)) return emptyState("無法查看主檔", "目前帳號沒有商品、供應商與庫存主檔的管理權限。");
  const products = state.data.products;
  const search = String(state.filters.masterSearch || "").toLowerCase();
  const filtered = products.filter((product) => `${product.productCode} ${product.name} ${product.barcode} ${product.specification} ${supplierName(product.defaultSupplierId || product.supplierId)} ${product.procurementStatus}`.toLowerCase().includes(search));
  const warehouseBalances = state.data.inventory.filter((balance) => balance.locationId === "warehouse");
  const headerActions = [
    canCreateProduct(user) ? button("open-add-product", "＋ 新增商品", "primary") : "",
    canManageSupplierCommercial(user) ? button("open-add-supplier", "＋ 新增供應商", "secondary") : "",
    canAdjustInventory(user) ? button("open-adjust-inventory", "＋ 調整總倉庫存", "secondary", { locationId: "warehouse" }) : "",
  ].join(" ");
  const productRows = filtered.map((product) => {
    const balance = getBalance("warehouse", product.id);
    const primary = state.data.supplierProducts.find((item) => item.productId === product.id && item.isPrimary && item.isActive !== false);
    const settings = state.data.settings.filter((item) => item.productId === product.id);
    const actions = [button("open-edit-product", "查看 / 編輯", "secondary small", { id: product.id })];
    if (canAdjustInventory(user)) actions.push(button("open-adjust-inventory", "調整庫存", "ghost small", { locationId: "warehouse", productId: product.id }));
    return `<tr><td><strong>${escapeHtml(product.name)}</strong><small class="cell-sub mono">${escapeHtml(product.productCode)} · ${escapeHtml(product.barcode)}</small></td><td><span>${escapeHtml(product.category || "未分類")}</span><small class="cell-sub">${escapeHtml(product.specification || "未提供規格")} · ${escapeHtml(product.baseUnit)}</small></td><td>${escapeHtml(supplierName(primary?.supplierId || product.defaultSupplierId || product.supplierId))}<small class="cell-sub">${primary ? `交期 ${numberLabel(primary.leadTimeDays ?? supplierLeadTime(primary.supplierId))} 天` : "尚未設定主要供應商"}</small></td><td><strong class="big-cell">${numberLabel(balance?.onHandQty || 0)}</strong><small class="cell-sub">可用 ${numberLabel(availableInventory(balance))}</small></td><td><span>${settings.length} 門市</span><small class="cell-sub">安全庫存 ${numberLabel(settings.reduce((sum, item) => sum + toNumber(item.safetyStockQty), 0))}</small></td><td><span class="master-procurement-status ${String(product.procurementStatus || "").toLowerCase()}">${escapeHtml(STATUS_LABELS[product.procurementStatus] || product.procurementStatus || "待設定")}</span><small class="cell-sub">${product.isActive ? "商品啟用" : "商品停用"}</small></td><td><div class="row-actions">${actions.join("")}</div></td></tr>`;
  }).join("");
  const supplierRows = state.data.suppliers.map((supplier) => {
    const commercialAction = canManageSupplierCommercial(user) ? button("open-edit-supplier", "編輯商務", "secondary small", { id: supplier.id }) : "";
    const receivingAction = canManageSupplierReceiving(user) ? button("open-edit-supplier", "編輯收貨", "ghost small", { id: supplier.id }) : "";
    return `<tr><td><strong>${escapeHtml(supplier.name)}</strong><small class="cell-sub mono">${escapeHtml(supplier.code)}${supplier.taxId ? ` · 統編 ${escapeHtml(supplier.taxId)}` : ""}</small></td><td>${escapeHtml(supplier.contactName || supplier.contact || "未提供")}<small class="cell-sub">${escapeHtml(supplier.phone || "")} · ${escapeHtml(supplier.email || "")}</small></td><td><strong>${formatMoney(supplier.minimumOrderAmount || 0)} 元</strong><small class="cell-sub">${supplier.leadTimeDays} 天 · ${escapeHtml(supplier.paymentTerms || "未設定付款條件")}</small></td><td>${supplier.isActive ? `<span class="status active">啟用</span>` : `<span class="status muted">停用</span>`}</td><td><div class="row-actions">${commercialAction}${receivingAction}</div></td></tr>`;
  }).join("");
  const relationRows = state.data.supplierProducts.map((relation) => `<tr><td>${escapeHtml(productName(relation.productId))}<small class="cell-sub mono">${escapeHtml(productCode(relation.productId))}</small></td><td>${escapeHtml(supplierName(relation.supplierId))}</td><td>${escapeHtml(relation.supplierProductCode || "未設定")}<small class="cell-sub">${escapeHtml(relation.purchaseUnit || "件")}</small></td><td>${formatMoney(relation.purchasePrice || 0)} 元<small class="cell-sub">最低 ${numberLabel(relation.minimumOrderQuantity)} · 倍數 ${numberLabel(relation.purchaseMultiple)}</small></td><td>${relation.isPrimary ? `<span class="status active">主要供應商</span>` : "—"}<small class="cell-sub">${relation.isActive === false ? "已停用" : "啟用"}</small></td><td>${canManageSupplierProducts(user) ? `<div class="row-actions">${button("open-edit-supplier-product", "編輯", "secondary small", { id: relation.id })}${!relation.isPrimary && relation.isActive !== false ? button("set-primary-supplier", "設為主要", "ghost small", { id: relation.id, productId: relation.productId }) : ""}</div>` : "<span class=\"readonly-label\">唯讀</span>"}</td></tr>`).join("");
  return `${renderPageIntro("MASTER DATA", "商品、供應商與設定", "採購維護商務條件，倉管維護物流設定；無權限欄位保留唯讀顯示，所有修改都會保存前後差異。", headerActions)}
    <div class="master-permission-callout"><strong>目前角色：${escapeHtml(ROLE_LABELS[user?.role] || "未知")}</strong><span>${user?.role === "PURCHASING" ? "可維護供應商與採購條件，商品基本資料可提出修改；庫存與倉儲欄位唯讀。" : user?.role === "WAREHOUSE" ? "可新增商品、維護基本資料與物流設定，供應商商務及採購欄位唯讀。" : "可管理全部商品、供應商及相關設定。"}</span></div>
    <div class="master-grid"><section class="panel master-stat"><span class="section-kicker">ACTIVE PRODUCTS</span><strong>${products.filter((p) => p.isActive).length}<small> / ${products.length}</small></strong><span>商品主檔</span></section><section class="panel master-stat"><span class="section-kicker">PURCHASABLE</span><strong>${products.filter((p) => p.procurementStatus === "PURCHASABLE").length}</strong><span>已完成採購設定</span></section><section class="panel master-stat"><span class="section-kicker">SUPPLIERS</span><strong>${state.data.suppliers.filter((supplier) => supplier.isActive !== false).length}<small> / ${state.data.suppliers.length}</small></strong><span>啟用供應商</span></section><section class="panel master-stat"><span class="section-kicker">WAREHOUSE SKUs</span><strong>${warehouseSkuCount()}</strong><span>有可用量 SKU</span></section></div>
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="masterSearch" value="${escapeHtml(state.filters.masterSearch || "")}" placeholder="搜尋商品代碼、名稱、條碼、規格或供應商" /></label><span class="toolbar-spacer"></span><span class="table-count">${filtered.length} 項商品</span></div><div class="table-wrap"><table class="master-product-table"><thead><tr><th>商品代碼 / 名稱</th><th>規格 / 分類 / 單位</th><th>主要供應商</th><th>總倉庫存</th><th>門市補貨參數</th><th>採購狀態 / 啟用</th><th>最後修改 / 操作</th></tr></thead><tbody>${productRows || emptyRow(7, "找不到商品")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">SUPPLIERS</span><h2>供應商主檔</h2></div><span class="table-count">${state.data.suppliers.length} 家</span></div><div class="table-wrap"><table class="master-supplier-table"><thead><tr><th>供應商</th><th>聯絡資料</th><th>採購條件</th><th>狀態</th><th>操作</th></tr></thead><tbody>${supplierRows || emptyRow(5, "尚未建立供應商")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">SUPPLIER PRODUCTS</span><h2>商品供應商設定</h2></div><span class="table-count">${state.data.supplierProducts.length} 筆</span></div><div class="table-wrap"><table class="master-supplier-product-table"><thead><tr><th>商品</th><th>供應商</th><th>供應商商品編號 / 採購單位</th><th>單價 / MOQ / 倍數</th><th>主要 / 啟用</th><th>操作</th></tr></thead><tbody>${relationRows || emptyRow(6, "尚未建立商品供應商設定")}</tbody></table></div></section>
    <div class="two-column"><section class="panel"><div class="panel-heading compact"><div><span class="section-kicker">REPLENISHMENT SETTINGS</span><h2>補貨參數範例</h2></div></div><div class="stack-list">${state.data.settings.filter((item) => item.locationId === "store01").slice(0, 6).map((item) => `<div class="list-row"><div><strong>${escapeHtml(productName(item.productId))}</strong><small>${escapeHtml(locationName(item.locationId))} · 自動補貨 ${item.automaticReplenishmentEnabled ? "開啟" : "關閉"}</small></div><span class="setting-pill">${item.safetyStockQty} / ${item.maximumStockQty} · ×${item.storeDistributionMultiple}</span></div>`).join("")}</div></section><section class="panel"><div class="panel-heading compact"><div><span class="section-kicker">READ-ONLY BOUNDARY</span><h2>庫存與銷售</h2></div></div><p class="panel-note">採購可查看庫存及前六個完整月份銷售；實際庫存只能由倉管執行庫存調整，並保留異動紀錄。</p>${products.slice(0, 2).map((product) => renderProcurementSnapshotHtml(product.id)).join("")}</section></div>`;
}

function renderSupplierOperations() {
  const user = currentUser();
  if (!canManageSupplierReturns(user)) return emptyState("無法查看供應商營運", "目前帳號沒有供應商退貨與採購逐品項追蹤權限。");
  const canCommercial = canManageSupplierCommercialData(user);
  const canReturn = canCreateSupplierReturn(user);
  const trackingRows = getPurchaseOrderItemTrackingRows(state.data, user);
  const returns = getSupplierReturnsForRole(state.data, user);
  const identifiers = (state.data.productIdentifiers || []).filter((item) => item.isActive !== false);
  const supplierCards = state.data.suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => {
    const schedule = getStoreSupplierSchedule(state.data, { supplierId: supplier.id });
    const accounts = getSupplierBankAccountsForRole(state.data, supplier.id, user);
    const relation = state.data.supplierBusinessRelations.find((item) => item.orderingSupplierId === supplier.id && item.isDefault && item.isActive !== false);
    const payee = relation?.payeeSupplierId ? supplierName(relation.payeeSupplierId) : supplier.name;
    const commercial = canCommercial ? `<div class="supplier-ops-meta"><span>付款方式 <b>${escapeHtml(supplier.paymentMethod || "未設定")}</b></span><span>付款對象 <b>${escapeHtml(payee)}</b></span><span>付款條件 <b>${escapeHtml(supplier.paymentTerms || "未設定")}</b></span><span>銀行帳戶 <b>${numberLabel(accounts.length)} 筆</b></span></div>` : `<div class="supplier-ops-meta"><span>交期 <b>${numberLabel(supplier.leadTimeDays)} 天</b></span><span>訂貨週期 <b>${escapeHtml(schedule?.frequencyType || "未設定")}</b></span><span>下次訂貨 <b>${escapeHtml(schedule?.nextOrderDate || "—")}</b></span></div>`;
    const actions = `${canCommercial ? `${button("open-supplier-terms", "付款／對象", "secondary small", { id: supplier.id })}${button("open-supplier-schedule", "訂貨週期", "secondary small", { id: supplier.id })}${button("open-supplier-bank", "銀行帳戶", "secondary small", { id: supplier.id })}` : ""}`;
    return `<article class="supplier-ops-card"><div class="section-row"><div><strong>${escapeHtml(supplier.name)}</strong><small>${escapeHtml(supplier.code || supplier.id)} · ${escapeHtml(supplier.contactName || supplier.contact || "未提供聯絡人")}</small></div><span class="status active">${supplier.isActive ? "啟用" : "停用"}</span></div>${commercial}<div class="supplier-ops-schedule"><strong>門市可見訂貨資訊</strong><span>${escapeHtml(schedule?.frequencyType || "尚未設定頻率")} · 下次訂貨 ${escapeHtml(schedule?.nextOrderDate || "—")} · 預計到貨 ${numberLabel(schedule?.expectedDeliveryDays || supplier.leadTimeDays)} 天</span><small>${escapeHtml(schedule?.storeVisibleNote || supplier.supplierPublicNote || "尚無門市提示")}</small></div><div class="row-actions">${actions}</div></article>`;
  }).join("");
  const tracking = trackingRows.map((row) => {
    const product = state.data.products.find((item) => item.id === row.productId) || {};
    const actions = canCommercial ? `${button("open-item-followup", "更新聯繫", "secondary small", { orderId: row.purchaseOrderId, itemId: row.purchaseOrderItemId })}${row.shortageQty > 0 ? button("open-item-shortage", "缺貨處理", "danger small", { orderId: row.purchaseOrderId, itemId: row.purchaseOrderItemId }) : ""}` : "";
    const supplierContext = canCommercial ? `${row.orderingSupplierName} → ${row.payeeSupplierName}` : row.orderingSupplierName;
    const sourceStores = (row.sourceLocationIds || []).map((locationId) => locationName(locationId)).join("、") || "總倉人工備貨";
    const trackingStatus = row.shortageRequeueStatus === "NO_GROUP" ? "NO_GROUP" : row.shortageRequeueStatus === "REQUEUED" ? "REQUEUED" : row.shortageRequeueStatus === "ALTERNATIVE" ? "ALTERNATIVE_AVAILABLE" : row.shortageStatus || "NONE";
    return `<tr><td><strong class="mono">${escapeHtml(row.purchaseOrderNumber || "—")}</strong><small class="cell-sub">${escapeHtml(supplierContext)}</small><small class="cell-sub">來源門市：${escapeHtml(sourceStores)}</small></td><td><strong>${escapeHtml(product.name || row.productId)}</strong><small class="cell-sub">${escapeHtml(product.productCode || "—")} · ${escapeHtml(product.specification || "未提供規格")}</small></td><td><strong class="big-cell">${numberLabel(row.orderedQty)} / ${numberLabel(row.receivedQty)} / ${numberLabel(row.openQty)}</strong><small class="cell-sub">訂購 / 已到 / 尚未到貨 · 缺貨 ${numberLabel(row.shortageQty)} · 重新採購 ${numberLabel(row.requeuedQty || 0)}</small></td><td>${statusChip(trackingStatus)}<small class="cell-sub">${escapeHtml(row.shortageReason || "—")}</small></td><td><strong>${escapeHtml(row.latestExpectedDeliveryDate || "—")}</strong><small class="cell-sub">原始 ${escapeHtml(row.originalExpectedDeliveryDate || "—")} · 最後更新 ${escapeHtml(row.lastFollowedUpAt || "—")}</small></td><td><strong>${escapeHtml(row.followUpStatus || "PENDING")}</strong><small class="cell-sub">${escapeHtml(row.supplierResponseNote || row.storeVisibleShortageNote || row.storeVisibleNote || "尚無供應商回覆")}</small></td><td>${actions || "—"}</td></tr>`;
  }).join("");
  const returnRows = returns.map((order) => `<tr><td><strong class="mono">${escapeHtml(order.returnNumber)}</strong><small class="cell-sub">${escapeHtml(supplierName(order.supplierId))} · ${escapeHtml(order.createdAt || "—")}</small></td><td>${statusChip(order.status)}<small class="cell-sub">${escapeHtml(order.returnReason || "未填原因")}</small></td><td><strong>${numberLabel(order.totalQty)} 件</strong><small class="cell-sub">${order.items.length} 項 · 預估 ${escapeHtml(order.estimatedAmount)} 元</small></td><td>${order.items.map((item) => escapeHtml(productName(item.productId))).join("、")}</td><td><div class="row-actions">${button("open-return-detail", "查看處理", "secondary small", { id: order.id })}${canReturn && order.status === "DRAFT" ? button("submit-supplier-return", "送供應商確認", "primary small", { id: order.id }) : ""}${canResolveSupplierReturn(user) && ["SUPPLIER_CONFIRMED", "WAITING_RESOLUTION", "PARTIALLY_RESOLVED"].includes(order.status) ? button("open-return-resolution", "登記結果", "secondary small", { id: order.id }) : ""}</div></td></tr>`).join("");
  const identifierRows = identifiers.map((item) => `<tr><td>${escapeHtml(productName(item.productId))}</td><td><strong>${escapeHtml(item.identifierType)}</strong></td><td class="mono">${escapeHtml(item.value)}</td><td>${canMaintainProductIdentifiers(user) ? button("open-identifiers", "編輯五碼", "ghost small", { id: item.productId }) : "唯讀"}</td></tr>`).join("");
  return `${renderPageIntro("SUPPLIER OPERATIONS", "供應商主檔、退貨與未到貨追蹤", "採購管理付款與供應商條件，總倉處理退貨與替代品入庫；逐品項追蹤只將必要資訊回傳來源門市。", `<div class="page-actions-stack">${canReturn ? button("open-return-create", "＋ 建立供應商退貨", "primary") : ""}${canCommercial ? button("open-supplier-terms", "管理供應商條件", "secondary", { id: state.data.suppliers[0]?.id || "" }) : ""}</div>`)}
    <div class="supplier-ops-summary"><div><span>逐品項未到貨</span><strong>${numberLabel(trackingRows.length)}</strong></div><div><span>有缺貨明細</span><strong>${numberLabel(trackingRows.filter((row) => row.shortageQty > 0).length)}</strong></div><div><span>處理中退貨</span><strong>${numberLabel(returns.filter((order) => !["RESOLVED", "CANCELLED"].includes(order.status)).length)}</strong></div><div><span>商品國際代碼</span><strong>${numberLabel(identifiers.length)}</strong></div></div>
    <section class="panel supplier-ops-grid"><div class="panel-heading compact"><div><span class="section-kicker">SUPPLIER MASTER</span><h2>供應商商務與訂貨週期</h2></div><span class="table-count">${state.data.suppliers.length} 家</span></div><div class="supplier-ops-card-grid">${supplierCards || emptyState("尚無供應商", "")}</div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">ITEM FOLLOW-UP</span><h2>採購明細缺貨與未到貨追蹤</h2></div><span class="table-count">${trackingRows.length} 筆</span></div><div class="table-wrap"><table class="purchase-tracking-table supplier-item-tracking-table"><thead><tr><th>採購單／訂購→付款</th><th>商品／商品碼</th><th>訂購／已到／尚未到</th><th>缺貨狀態</th><th>原始／最新日期</th><th>供應商回覆</th><th>操作</th></tr></thead><tbody>${tracking || emptyRow(7, "目前沒有待追蹤的採購明細")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">SUPPLIER RETURNS</span><h2>供應商退貨處理</h2></div><span class="table-count">${returns.length} 張</span></div><div class="table-wrap"><table class="purchase-tracking-table"><thead><tr><th>退貨單／供應商</th><th>狀態／原因</th><th>數量／金額</th><th>商品</th><th>操作</th></tr></thead><tbody>${returnRows || emptyRow(5, "尚未建立供應商退貨")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">INTERNATIONAL IDENTIFIERS</span><h2>商品國際／製造商代碼</h2></div><span class="table-count">GTIN-14 · EAN-13 · UPC-A · JAN · 製造商料號</span></div><div class="table-wrap"><table class="master-supplier-product-table"><thead><tr><th>商品</th><th>類型</th><th>代碼</th><th>操作</th></tr></thead><tbody>${identifierRows || emptyRow(4, "尚未登錄商品國際代碼")}</tbody></table></div></section>`;
}

function masterActionButton(action, label, tone = "secondary", data = {}) {
  const attrs = Object.entries({ ...data, action }).map(([key, value]) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeHtml(value)}"`).join(" ");
  return `<button type="button" class="button ${tone}" ${attrs}>${label}</button>`;
}

function readonlyLabel(canEdit) {
  return canEdit ? "可編輯" : "唯讀";
}

function masterTextField(label, name, value, canEdit, options = {}) {
  const type = options.type || "text";
  const required = options.required ? "required" : "";
  const min = options.min === undefined ? "" : `min="${escapeHtml(options.min)}"`;
  const step = options.step === undefined ? "" : `step="${escapeHtml(options.step)}"`;
  return `<label class="field master-field"><span>${label}<small class="field-permission ${canEdit ? "editable" : "readonly"}">${readonlyLabel(canEdit)}</small></span><input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${required} ${min} ${step} ${canEdit ? "" : "readonly"} /></label>`;
}

function masterCheckboxField(label, name, checked, canEdit) {
  return `<label class="checkbox-field master-checkbox-field"><input name="${name}" value="true" type="checkbox" ${checked ? "checked" : ""} ${canEdit ? "" : "disabled"} /><span>${label}<small class="field-permission ${canEdit ? "editable" : "readonly"}">${readonlyLabel(canEdit)}</small></span></label>`;
}

function renderMasterAuditHistory(entityType, entityId) {
  const logs = state.data.auditLogs.filter((log) => log.entityType === entityType && log.entityId === entityId).slice(0, 8);
  if (!logs.length) return `<p class="panel-note">尚無此資料的異動紀錄。</p>`;
  return `<div class="master-audit-list">${logs.map((log) => `<article class="master-audit-row"><div><strong>${escapeHtml(log.action)}</strong><small>${escapeHtml(userName(log.userId))} · ${escapeHtml(log.userRole || ROLE_LABELS[state.data.users.find((user) => user.id === log.userId)?.role] || "")}</small></div><time>${escapeHtml(log.createdAt || "")}</time><p>${escapeHtml(log.detail || "")}</p><details><summary>查看前後差異</summary><pre>${escapeHtml(JSON.stringify({ before: log.beforeData, after: log.afterData }, null, 2))}</pre></details></article>`).join("")}</div>`;
}

function renderProductMasterModal(productId) {
  const product = state.data.products.find((item) => item.id === productId);
  const user = currentUser();
  if (!product || !canViewMasterData(user)) return emptyState("找不到商品", "此商品不存在或目前帳號無法查看。");
  const fullBasic = ["ADMIN", "WAREHOUSE"].includes(user.role);
  const purchasingBasic = user.role === "PURCHASING" || user.role === "ADMIN";
  const warehouseEditable = user.role === "WAREHOUSE" || user.role === "ADMIN";
  const purchasingEditable = canManageSupplierProducts(user);
  const relations = state.data.supplierProducts.filter((item) => item.productId === product.id);
  const primary = relations.find((item) => item.isPrimary && item.isActive !== false);
  const suppliersWithRelations = relations.map((relation) => state.data.suppliers.find((supplier) => supplier.id === relation.supplierId)).filter(Boolean);
  const relationRows = relations.map((relation) => `<article class="master-relation-card"><div><strong>${escapeHtml(supplierName(relation.supplierId))}</strong><small>${escapeHtml(relation.supplierProductCode || "未設定供應商商品編號")} · ${escapeHtml(relation.purchaseUnit || "件")}</small></div><div><strong>${formatMoney(relation.purchasePrice || 0)} 元</strong><small>最低 ${numberLabel(relation.minimumOrderQuantity)} · 倍數 ${numberLabel(relation.purchaseMultiple)} · 交期 ${numberLabel(relation.leadTimeDays)} 天</small></div><div>${relation.isPrimary ? `<span class="status active">主要供應商</span>` : relation.isActive === false ? `<span class="status muted">已停用</span>` : ""}</div><div>${purchasingEditable ? masterActionButton("open-edit-supplier-product", "編輯", "secondary small", { id: relation.id }) : `<span class="readonly-label">採購設定唯讀</span>`}</div></article>`).join("");
  const primaryOptions = relations.filter((relation) => relation.isActive !== false).map((relation) => `<option value="${escapeHtml(relation.supplierId)}" ${primary?.supplierId === relation.supplierId ? "selected" : ""}>${escapeHtml(supplierName(relation.supplierId))}</option>`).join("");
  const canSubmit = fullBasic || purchasingBasic || warehouseEditable;
  return `<form id="entityForm" class="modal-form master-product-form" data-master-product-form><div class="detail-meta"><span class="mono">${escapeHtml(product.productCode)}</span><span class="master-procurement-status ${String(product.procurementStatus || "").toLowerCase()}">${escapeHtml(STATUS_LABELS[product.procurementStatus] || product.procurementStatus || "待設定")}</span><span>${product.isActive ? "商品啟用" : "商品停用"}</span></div><input type="hidden" name="productId" value="${escapeHtml(product.id)}" /><input type="hidden" name="version" value="${escapeHtml(product.version || 1)}" /><input type="hidden" name="updatedAt" value="${escapeHtml(product.updatedAt || "")}" /><section class="master-form-section"><div class="section-row"><div><h3>基本資料</h3><p class="modal-note">共同基本資料由倉管/管理員維護；採購人員可修改名稱、規格與分類，所有異動保留前後內容。</p></div><span class="readonly-label">${fullBasic ? "倉儲可編輯" : purchasingBasic ? "採購可提修改" : "唯讀"}</span></div><div class="form-grid">${masterTextField("商品編號", "productCode", product.productCode, fullBasic, { required: true })}${masterTextField("條碼", "barcode", product.barcode, fullBasic, { required: true })}${masterTextField("商品名稱", "name", product.name, fullBasic || purchasingBasic, { required: true })}${masterTextField("規格", "specification", product.specification, fullBasic || purchasingBasic, { required: true })}${masterTextField("分類", "category", product.category, fullBasic || purchasingBasic, { required: true })}${masterTextField("基本單位", "baseUnit", product.baseUnit, fullBasic, { required: true })}</div>${masterCheckboxField("商品啟用", "isActive", product.isActive, fullBasic)}</section><section class="master-form-section"><div class="section-row"><div><h3>倉儲物流設定</h3><p class="modal-note">倉管負責儲位、箱入數、配貨及批號/效期設定；採購與門市只能查看。</p></div><span class="readonly-label">${readonlyLabel(warehouseEditable)}</span></div><div class="form-grid">${masterTextField("箱入數", "casePackQty", product.casePackQty, warehouseEditable, { type: "number", min: 0, step: 1 })}${masterTextField("門市配貨單位", "storeDistributionUnit", product.storeDistributionUnit, warehouseEditable)}${masterTextField("門市配貨倍數", "storeDistributionMultiple", product.storeDistributionMultiple, warehouseEditable, { type: "number", min: 1, step: 1 })}${masterTextField("總倉儲位", "warehouseLocationCode", product.warehouseLocationCode, warehouseEditable)}${masterTextField("最低可接受效期天數", "minimumShelfLifeDays", product.minimumShelfLifeDays, warehouseEditable, { type: "number", min: 0, step: 1 })}</div><div class="form-grid">${masterCheckboxField("批號管理", "batchTrackingEnabled", product.batchTrackingEnabled, warehouseEditable)}${masterCheckboxField("效期管理", "expiryTrackingEnabled", product.expiryTrackingEnabled, warehouseEditable)}</div>${masterTextField("倉儲備註", "storageNote", product.storageNote, warehouseEditable)}</section><section class="master-form-section"><div class="section-row"><div><h3>供應商與採購條件</h3><p class="modal-note">採購/管理員可維護供應商關係與主要供應商；倉管可查看但不得修改採購價格、MOQ 或倍數。</p></div><span class="readonly-label">${readonlyLabel(purchasingEditable)}</span></div>${purchasingEditable ? `<div class="form-grid"><label class="field"><span>主要供應商<small class="field-permission editable">可編輯</small></span><select name="defaultSupplierId"><option value="">暫無主要供應商</option>${primaryOptions}</select></label><label class="checkbox-field"><input name="allowNoPrimary" value="true" type="checkbox" /><span>確認商品暫無主要供應商<small>清除主要供應商時必須明確確認。</small></span></label></div>` : `<div class="readonly-master-value"><span>主要供應商</span><strong>${escapeHtml(primary ? supplierName(primary.supplierId) : "尚未設定")}</strong></div>`}<div class="master-relation-list">${relationRows || `<p class="panel-note">尚未建立商品供應商關係${purchasingEditable ? "，可新增設定。" : "。"}</p>`}</div>${purchasingEditable ? masterActionButton("open-add-supplier-product", "＋ 新增商品供應商設定", "secondary", { productId: product.id }) : ""}</section><section class="master-form-section"><div class="section-row"><div><h3>各地點庫存與前六個完整月份銷售</h3><p class="modal-note">庫存調整只能由倉管或管理員執行；採購可查看資訊但不能直接修改實際庫存。</p></div></div>${renderProcurementSnapshotHtml(product.id)}</section><section class="master-form-section"><div class="section-row"><div><h3>異動紀錄</h3><p class="modal-note">共同欄位、物流設定、供應商關係及主要供應商切換均保留前後內容。</p></div></div>${renderMasterAuditHistory("PRODUCT", product.id)}${relations.map((relation) => renderMasterAuditHistory("SUPPLIER_PRODUCT", relation.id)).join("")}</section><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button>${canSubmit ? `<button type="submit" class="button primary">儲存商品設定</button>` : ""}</div></form>`;
}

function renderSupplierModal(supplierId = null) {
  const user = currentUser();
  const supplier = supplierId ? state.data.suppliers.find((item) => item.id === supplierId) : null;
  const commercialEditable = canManageSupplierCommercial(user);
  const receivingEditable = canManageSupplierReceiving(user);
  if (!supplier && !commercialEditable) return emptyState("無法新增供應商", "只有採購人員或管理員可以新增供應商。");
  if (supplier && !commercialEditable && !receivingEditable) return emptyState("無法編輯供應商", "目前帳號只有查詢權限。");
  const current = supplier || { code: "", name: "", taxId: "", contactName: "", phone: "", email: "", address: "", leadTimeDays: 0, minimumOrderAmount: "0.00", paymentTerms: "", deliveryNote: "", deliveryTimeNote: "", receivingNote: "", isActive: true, version: 1, updatedAt: "" };
  return `<form id="entityForm" class="modal-form supplier-master-form"><input type="hidden" name="supplierId" value="${escapeHtml(supplier?.id || "")}" /><input type="hidden" name="version" value="${escapeHtml(current.version || 1)}" /><input type="hidden" name="updatedAt" value="${escapeHtml(current.updatedAt || "")}" /><section class="master-form-section"><div class="section-row"><div><h3>供應商商務資料</h3><p class="modal-note">採購負責供應商名稱、統編、聯絡資料、交貨天數、最低採購金額與付款條件。</p></div><span class="readonly-label">${readonlyLabel(commercialEditable)}</span></div><div class="form-grid">${masterTextField("供應商代碼", "code", current.code, commercialEditable, { required: true })}${masterTextField("供應商名稱", "name", current.name, commercialEditable, { required: true })}${masterTextField("統一編號", "taxId", current.taxId, commercialEditable)}${masterTextField("聯絡人", "contactName", current.contactName || current.contact, commercialEditable)}${masterTextField("電話", "phone", current.phone, commercialEditable)}${masterTextField("電子郵件", "email", current.email, commercialEditable, { type: "email" })}${masterTextField("地址", "address", current.address, commercialEditable)}${masterTextField("交貨天數", "leadTimeDays", current.leadTimeDays, commercialEditable, { type: "number", min: 0, step: 1 })}${masterTextField("最低採購金額", "minimumOrderAmount", current.minimumOrderAmount, commercialEditable, { type: "number", min: 0, step: "0.01" })}${masterTextField("付款條件", "paymentTerms", current.paymentTerms, commercialEditable)}</div>${masterCheckboxField("供應商啟用", "isActive", current.isActive, commercialEditable)}</section><section class="master-form-section"><div class="section-row"><div><h3>物流收貨備註</h3><p class="modal-note">倉管只能維護配送、收貨注意事項及送貨時段；不得修改商務欄位。</p></div><span class="readonly-label">${readonlyLabel(receivingEditable)}</span></div>${masterTextField("交貨備註", "deliveryNote", current.deliveryNote, receivingEditable)}${masterTextField("送貨時段", "deliveryTimeNote", current.deliveryTimeNote, receivingEditable)}${masterTextField("收貨注意事項", "receivingNote", current.receivingNote, receivingEditable)}</section><section class="master-form-section"><div class="section-row"><div><h3>供應商異動紀錄</h3></div></div>${renderMasterAuditHistory("SUPPLIER", supplier?.id)}</section><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button>${supplier || commercialEditable ? `<button type="submit" class="button primary">${supplier ? "儲存供應商修改" : "建立供應商"}</button>` : ""}</div></form>`;
}

function renderSupplierProductModal(supplierProductId = null, productId = null) {
  const user = currentUser();
  if (!canManageSupplierProducts(user)) return emptyState("無法修改商品供應商設定", "只有採購人員或管理員可以新增或修改商品供應商關係。");
  const relation = supplierProductId ? state.data.supplierProducts.find((item) => item.id === supplierProductId) : null;
  const product = state.data.products.find((item) => item.id === (relation?.productId || productId));
  if (!product) return emptyState("找不到商品", "請從商品詳情重新開啟。");
  const supplierOptions = state.data.suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${(relation?.supplierId || "") === supplier.id ? "selected" : ""}>${escapeHtml(supplier.name)}（${escapeHtml(supplier.code)}）</option>`).join("");
  const current = relation || { supplierId: "", supplierProductCode: "", purchaseUnit: product.baseUnit, purchasePrice: "0.00", minimumOrderQuantity: 1, purchaseMultiple: 1, minimumOrderAmount: "0.00", leadTimeDays: 0, isPrimary: false, isActive: true, version: 1 };
  return `<form id="entityForm" class="modal-form supplier-product-master-form"><input type="hidden" name="supplierProductId" value="${escapeHtml(relation?.id || "")}" /><input type="hidden" name="productId" value="${escapeHtml(product.id)}" /><input type="hidden" name="version" value="${escapeHtml(current.version || 1)}" /><input type="hidden" name="productVersion" value="${escapeHtml(product.version || 1)}" /><div class="detail-meta"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.productCode)}</span><span class="readonly-label">${relation ? "編輯供應商設定" : "新增供應商設定"}</span></div><div class="form-grid">${relation ? `<label class="field"><span>供應商</span><input value="${escapeHtml(supplierName(relation.supplierId))}" readonly /></label>` : `<label class="field"><span>供應商</span><select name="supplierId" required><option value="">請選擇供應商</option>${supplierOptions}</select></label>`}${masterTextField("供應商商品編號", "supplierProductCode", current.supplierProductCode, true, { required: true })}${masterTextField("採購單位", "purchaseUnit", current.purchaseUnit, true, { required: true })}${masterTextField("參考採購單價", "purchasePrice", current.purchasePrice, true, { type: "number", min: 0, step: "0.01", required: true })}${masterTextField("最低採購量", "minimumOrderQuantity", current.minimumOrderQuantity, true, { type: "number", min: 1, step: 1, required: true })}${masterTextField("採購倍數", "purchaseMultiple", current.purchaseMultiple, true, { type: "number", min: 1, step: 1, required: true })}${masterTextField("供應商最低採購金額", "minimumOrderAmount", current.minimumOrderAmount, true, { type: "number", min: 0, step: "0.01" })}${masterTextField("交貨天數", "leadTimeDays", current.leadTimeDays, true, { type: "number", min: 0, step: 1 })}</div><div class="form-grid">${masterCheckboxField("主要供應商", "isPrimary", current.isPrimary, true)}${masterCheckboxField("供應關係啟用", "isActive", current.isActive, true)}</div><div class="modal-note">設定主要供應商會在同一交易中取消同商品其他主要標記；停用目前主要供應商前，必須指定替代供應商或明確確認暫無主要供應商。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button type="submit" class="button primary">${relation ? "儲存採購設定" : "建立商品供應商設定"}</button></div></form>`;
}

function renderSalesImportPanel() {
  return `<section class="panel sales-import-panel"><div><span class="section-kicker">MONTHLY PRODUCT SALES</span><h3>匯入門市月銷售</h3><p>CSV 欄位：location_code、product_code、sales_year、sales_month、sales_qty；相同門市、商品與年月會更新原資料。</p></div><div class="sales-import-meta"><strong>${state.data.monthlyProductSales.length}</strong><span>筆月銷售資料</span><button class="text-button" data-action="open-sales-csv">選擇 CSV</button></div></section>`;
}

function renderUsers() {
  return `${renderPageIntro("ACCESS CONTROL", "使用者管理", "Phase 1 使用簡化帳號密碼與四種角色；門市資料範圍綁定登入帳號的 location_id。", button("open-add-user", "＋ 新增使用者", "primary"))}
    <div class="permission-callout"><div class="formula-icon">◎</div><div><strong>資料隔離規則</strong><span>STORE 只能讀寫所屬門市；WAREHOUSE 可處理所有門市需求；ADMIN 可使用全部功能。</span></div></div>
    <section class="panel table-panel"><div class="table-wrap"><table class="user-table"><thead><tr><th>使用者</th><th>角色</th><th>所屬單位</th><th>狀態</th><th>最後登入</th><th>操作</th></tr></thead><tbody>${state.data.users.map((user) => `<tr><td><div class="user-cell"><span class="avatar ${user.role.toLowerCase()}">${user.displayName.slice(0, 1)}</span><div><strong>${user.displayName}</strong><small class="cell-sub mono">${user.username}</small></div></div></td><td><span class="role-tag ${user.role.toLowerCase()}">${ROLE_LABELS[user.role]}</span></td><td>${user.locationId ? locationName(user.locationId) : "全域"}</td><td>${user.isActive ? `<span class="status active">啟用</span>` : `<span class="status muted">停用</span>`}</td><td>${user.lastLoginAt || "尚未登入"}</td><td>${user.id === currentUser().id ? `<span class="muted-text">目前帳號</span>` : button("toggle-user", user.isActive ? "停用" : "啟用", "ghost small", { id: user.id })}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderAudit() {
  const search = String(state.filters.auditSearch || "").toLowerCase();
  const logs = state.data.auditLogs.filter((log) => `${log.action} ${log.detail} ${userName(log.userId)} ${log.entityType}`.toLowerCase().includes(search));
  return `${renderPageIntro("AUDIT TRAIL", "操作紀錄", "保留重要操作的操作者、資料類型與結果，協助流程驗證與問題追溯。", `<span class="inline-stat"><b>${state.data.auditLogs.length}</b> 筆紀錄</span>`)}
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="auditSearch" value="${escapeHtml(state.filters.auditSearch || "")}" placeholder="搜尋操作者、動作或內容" /></label><span class="toolbar-spacer"></span><span class="table-count">${logs.length} 筆</span></div><div class="table-wrap"><table class="audit-table"><thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>資料類型</th><th>內容</th></tr></thead><tbody>${logs.map((log) => `<tr><td class="mono">${log.createdAt}</td><td>${userName(log.userId)}</td><td><strong>${log.action}</strong></td><td><span class="entity-chip">${log.entityType}</span></td><td>${escapeHtml(log.detail)}</td></tr>`).join("") || emptyRow(5, "目前沒有符合條件的紀錄")}</tbody></table></div></section>`;
}

function renderAttentionItem(item) {
  return `<button class="attention-item ${item.tone}" data-action="navigate" data-view="${item.view}"><span class="attention-icon">${item.icon}</span><span><strong>${item.title}</strong><small>${item.detail}</small></span><b>→</b></button>`;
}

function renderCompactDemandList(demands) {
  if (!demands.length) return emptyState("目前沒有需求", "建立一筆需求後，會在這裡顯示處理進度。");
  return `<div class="compact-list">${demands.map((demand) => `<button class="compact-row" data-action="open-demand" data-id="${demand.id}"><span class="compact-mark ${demand.status.toLowerCase()}">${demand.sourceType === "AUTO" ? "↻" : "↗"}</span><span><strong>${demand.demandNumber}</strong><small>${locationName(demand.locationId)} · ${demand.items.length} 項商品</small></span><span class="row-end">${statusChip(demand.status)}</span></button>`).join("")}</div>`;
}

function renderInventorySignals() {
  const signals = state.data.products.map((product) => ({ product, balance: getBalance("warehouse", product.id) })).sort((a, b) => availableInventory(a.balance) - availableInventory(b.balance)).slice(0, 4);
  return `<div class="signal-list">${signals.map(({ product, balance }) => { const available = availableInventory(balance); const tone = available < 18 ? "danger" : available < 30 ? "warn" : "ok"; return `<div class="signal-row"><span class="signal-bar ${tone}"><i style="width:${Math.min(100, available * 1.6)}%"></i></span><div><strong>${product.name}</strong><small>${product.productCode} · ${product.category}</small></div><b>${numberLabel(available)}<small> 可用</small></b></div>`; }).join("")}</div>`;
}

function renderSupplierPayeeField(orderingSupplierId, selectedPayeeId = "") {
  const relation = state.data.supplierBusinessRelations.find((item) => item.orderingSupplierId === orderingSupplierId && item.isDefault && item.isActive !== false);
  const selected = selectedPayeeId || relation?.payeeSupplierId || orderingSupplierId || "";
  const options = state.data.suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${supplier.id === selected ? "selected" : ""}>${escapeHtml(supplier.name)}（${escapeHtml(supplier.code || supplier.id)}）</option>`).join("");
  return `<label class="field"><span>付款供應商</span><select name="payeeSupplierId" required>${options}</select><small class="field-help">正式採購單會保存訂購供應商與付款供應商快照。</small></label>`;
}

function renderModal() {
  const modal = state.modal;
  const title = modal.type === "supplier-return-edit" ? "編輯供應商退貨草稿" : modalTitle(modal.type);
  let content = modal.type === "create-demand" ? renderDemandEditorModal() : modal.type === "edit-demand" ? renderDemandEditorModal(modal.demandId) : modal.type === "demand-detail" ? renderDemandDetailModal(modal.demandId) : ["return-demand", "return-auto-demand"].includes(modal.type) ? renderReturnDemandModal(modal.demandId) : modal.type === "confirm-suggestion" ? renderSuggestionModal(modal.suggestionId) : modal.type === "skip-suggestion" ? renderSkipSuggestionModal(modal.suggestionId) : modal.type === "auto-manager-edit" ? renderAutoManagerEditModal(modal.demandId) : modal.type === "auto-manager-approval" ? renderAutoManagerApprovalModal(modal.demandId) : modal.type === "allocation" ? renderAllocationModal(modal.demandId) : modal.type === "receive-allocation" ? renderReceiveAllocationModal(modal.allocationId) : modal.type === "receive-purchase" ? renderReceivePurchaseModal(modal.purchaseOrderId) : modal.type === "create-purchase-order" ? renderCreatePurchaseOrderModal(modal.suggestionIds) : modal.type === "manual-purchase-order" ? renderManualPurchaseOrderModal() : modal.type === "purchase-order-detail" ? renderPurchaseOrderDetailModal(modal.purchaseOrderId) : modal.type === "edit-purchase-order" ? renderEditPurchaseOrderModalV2(modal.purchaseOrderId) : modal.type === "cancel-purchase-order" ? renderCancelPurchaseOrderModal(modal.purchaseOrderId, modal.remainingOnly) : modal.type === "purchase-tracking" ? renderPurchaseTrackingModal(modal.purchaseOrderId) : modal.type === "supplier-terms" ? renderSupplierTermsModal(modal.supplierId) : modal.type === "supplier-schedule" ? renderSupplierScheduleModal(modal.supplierId) : modal.type === "supplier-bank" ? renderSupplierBankModal(modal.supplierId) : modal.type === "product-identifiers" ? renderProductIdentifiersModal(modal.productId) : modal.type === "purchase-item-followup" ? renderPurchaseItemFollowupModal(modal.purchaseOrderId, modal.purchaseOrderItemId) : modal.type === "purchase-item-shortage" ? renderPurchaseItemShortageModal(modal.purchaseOrderId, modal.purchaseOrderItemId) : modal.type === "supplier-return-create" ? renderSupplierReturnCreateModal() : modal.type === "supplier-return-detail" ? renderSupplierReturnDetailModal(modal.returnOrderId) : modal.type === "supplier-return-resolution" ? renderSupplierReturnResolutionModal(modal.returnOrderId, modal.returnOrderItemId) : modal.type === "supplier-return-attachment" ? renderSupplierReturnAttachmentModal(modal.returnOrderId, modal.returnOrderItemId) : modal.type === "supplier-replacement" ? renderSupplierReplacementModal(modal.returnOrderItemId) : modal.type === "add-product" ? renderAddProductModal() : modal.type === "edit-product" ? renderProductMasterModal(modal.productId) : modal.type === "add-supplier" ? renderSupplierModal() : modal.type === "edit-supplier" ? renderSupplierModal(modal.supplierId) : modal.type === "add-supplier-product" ? renderSupplierProductModal(null, modal.productId) : modal.type === "edit-supplier-product" ? renderSupplierProductModal(modal.supplierProductId, modal.productId) : modal.type === "adjust-inventory" ? renderAdjustInventoryModal(modal) : modal.type === "add-user" ? renderAddUserModal() : renderProfileModal();
  if (modal.type === "add-user") content = content.replace('<div class="modal-note">', `${renderStoreManagerField()}<div class="modal-note">`);
  if (modal.type === "supplier-return-edit") content = renderSupplierReturnEditModal(modal.returnOrderId, modal.returnOrderItemId);
  if (modal.type === "no-group") content = renderNoGroupModal(modal.suggestionIds, modal.supplierId);
  if (modal.type === "create-purchase-order") {
    const selected = String(modal.suggestionIds || "").split(",").map((id) => id.trim()).filter(Boolean);
    const supplierId = state.data.purchaseSuggestions.find((suggestion) => selected.includes(suggestion.id))?.supplierId;
    const productIds = [...new Set(state.data.supplierProducts.filter((item) => item.supplierId === supplierId && item.isActive !== false).map((item) => item.productId))];
    if (supplierId) content = content.replace('<input type="hidden" name="purchaseAction" value="suggestion" />', `${renderSupplierPayeeField(supplierId)}<input type="hidden" name="purchaseAction" value="suggestion" />`);
    if (supplierId && productIds.length) content = content.replace("</form>", `<section class="detail-section procurement-modal-snapshots"><h3>供應商商品庫存與完整月份銷售</h3>${productIds.map((productId) => renderProcurementSnapshotHtml(productId)).join("")}</section></form>`);
  }
  if (modal.type === "manual-purchase-order") {
    const firstSupplier = state.data.suppliers.find((supplier) => supplier.isActive !== false);
    if (firstSupplier) content = content.replace('<input type="hidden" name="purchaseAction" value="manual" />', `${renderSupplierPayeeField(firstSupplier.id)}<input type="hidden" name="purchaseAction" value="manual" />`);
  }
  if (modal.type === "purchase-order-detail") {
    const detailOrder = state.data.purchaseOrders.find((order) => order.id === modal.purchaseOrderId);
    if (detailOrder) content += `${renderPurchaseOrderPlanSummary(detailOrder)}${renderPurchaseOrderSupplierContext(detailOrder)}`;
  }
  if (modal.type === "supplier-return-detail") {
    const returnOrder = state.data.supplierReturns.find((order) => order.id === modal.returnOrderId);
    const returnItem = state.data.supplierReturnItems.find((item) => item.returnOrderId === modal.returnOrderId);
    if (returnOrder && returnItem && canCreateSupplierReturn(currentUser()) && returnOrder.status === "DRAFT") {
      content = content.replace('<div class="modal-actions">', `${button("open-edit-return", "編輯草稿", "secondary", { id: returnOrder.id, itemId: returnItem.id })}<div class="modal-actions">`);
    }
  }
  if (modal.type === "edit-purchase-order") {
    const editOrder = state.data.purchaseOrders.find((order) => order.id === modal.purchaseOrderId);
    if (editOrder) {
      content = content.replace('<div class="form-grid"><label class="field"><span>預計到貨日</span>', `<div class="form-grid">${renderSupplierPayeeField(editOrder.orderingSupplierId || editOrder.supplierId, editOrder.payeeSupplierId)}<label class="field"><span>預計到貨日</span>`);
      content = content.replace("</form>", `${editOrder.lines.map((line) => renderPurchaseOrderDistributionEditor(editOrder, line)).join("")}</form>`);
    }
  }
  if (modal.type === "purchase-item-followup") {
    const { line } = purchaseLineByRef(modal.purchaseOrderId, modal.purchaseOrderItemId);
    const history = state.data.purchaseOrderItemFollowups.filter((item) => item.purchaseOrderItemId === modal.purchaseOrderItemId).slice(0, 8);
    if (line) {
      const followupHistory = `<section class="detail-section followup-history"><div class="section-row"><h3>逐次聯繫歷程</h3><span>${history.length} 筆</span></div>${history.map((item) => `<div class="audit-mini-row"><strong>${escapeHtml(item.createdAt || "—")}</strong><span>${escapeHtml(item.followUpStatus || "—")} · ${escapeHtml(item.supplierResponse || "無供應商回覆")}</span><small>門市提示：${escapeHtml(item.storeVisibleNote || "—")} · 下次追蹤：${escapeHtml(item.nextFollowUpAt || "—")}</small></div>`).join("") || '<p class="muted-text">尚無逐次聯繫紀錄</p>'}</section>`;
      content = content.replace('<div class="modal-actions">', `${masterTextField("供應商下一可供貨日", "supplierNextAvailableDate", line.supplierNextAvailableDate || "", true, { type: "date" })}${masterTextField("本次聯繫備註", "followUpNote", line.followUpNote || "", true)}${followupHistory}<div class="modal-actions">`);
    }
  }
  if (modal.type === "purchase-item-shortage") {
    const { line } = purchaseLineByRef(modal.purchaseOrderId, modal.purchaseOrderItemId);
    if (line) {
      const supplierOptions = state.data.suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${supplier.id === line.alternativeSupplierId ? "selected" : ""}>${escapeHtml(supplier.name)}</option>`).join("");
      const productOptions = state.data.products.filter((product) => product.isActive !== false).map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === line.alternativeProductId ? "selected" : ""}>${escapeHtml(product.productCode)} · ${escapeHtml(product.name)}</option>`).join("");
      const alternativeFields = `<section class="detail-section alternative-source-fields"><div class="section-row"><h3>替代供應來源（可選）</h3><span>缺貨動作選「替代來源」時使用</span></div><div class="form-grid"><label class="field"><span>替代供應商</span><select name="alternativeSupplierId"><option value="">待採購人員指定</option>${supplierOptions}</select></label><label class="field"><span>替代商品</span><select name="alternativeProductId"><option value="">沿用原商品</option>${productOptions}</select></label></div></section>`;
      content = content.replace('<option value="CANCEL">取消缺貨數量</option>', '<option value="ALTERNATIVE">設定替代供應來源</option><option value="CANCEL">取消缺貨數量</option>');
      content = content.replace('<div class="modal-actions">', `${masterTextField("供應商下一可供貨日", "supplierNextAvailableDate", line.supplierNextAvailableDate || "", true, { type: "date" })}${alternativeFields}<div class="modal-actions">`);
    }
  }
  if (modal.type === "edit-supplier-product") {
    const relation = state.data.supplierProducts.find((item) => item.id === modal.supplierProductId);
    if (relation?.isPrimary) {
      const replacements = state.data.supplierProducts.filter((item) => item.productId === relation.productId && item.id !== relation.id && item.isActive !== false).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(supplierName(item.supplierId))} · ${escapeHtml(item.supplierProductCode || "未設定")}</option>`).join("");
      const primaryExit = `<div class="form-grid"><label class="field"><span>替代主要供應商（停用/取消主要時）</span><select name="replacementSupplierProductId"><option value="">不指定</option>${replacements}</select></label><label class="checkbox-field"><input name="allowNoPrimary" value="true" type="checkbox" /><span>確認商品暫無主要供應商<small>只有明確確認後才可清除主要供應商。</small></span></label></div>`;
      content = content.replace('<div class="modal-note">', `${primaryExit}<div class="modal-note">`);
    }
  }
  return `<div class="modal-backdrop" role="presentation"><section class="modal-card ${["demand-detail", "create-demand", "edit-demand", "auto-manager-edit", "auto-manager-approval", "create-purchase-order", "manual-purchase-order", "purchase-order-detail", "edit-purchase-order", "cancel-purchase-order", "purchase-tracking", "supplier-terms", "supplier-bank", "product-identifiers", "purchase-item-followup", "purchase-item-shortage", "supplier-return-create", "supplier-return-detail", "supplier-return-resolution", "supplier-return-attachment", "edit-product", "add-supplier", "edit-supplier", "add-supplier-product", "edit-supplier-product"].includes(modal.type) ? "wide-modal" : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><span class="section-kicker">${modal.type === "profile" ? "ACCOUNT" : "PHASE 1 ACTION"}</span><h2 id="modalTitle">${title}</h2></div><button class="icon-button" data-action="close-modal" aria-label="關閉">×</button></div>${content}</section></div>`;
}

function renderPurchaseOrderSupplierContext(order) {
  const user = currentUser();
  const canSeeInternal = canManageSupplierCommercialData(user);
  const identifierLabel = (productId) => (state.data.productIdentifiers || []).filter((item) => item.productId === productId && item.isActive !== false).map((item) => `${item.identifierType} ${item.value}`).join(" · ") || "尚無國際代碼";
  return `<section class="detail-section purchase-supplier-context"><h3>供應商對象、付款與逐品項狀態</h3><div class="detail-grid"><div><span>訂購供應商</span><strong>${escapeHtml(order.orderingSupplierSnapshot?.name || supplierName(order.orderingSupplierId || order.supplierId))}</strong></div><div><span>付款供應商</span><strong>${escapeHtml(order.payeeSupplierSnapshot?.name || supplierName(order.payeeSupplierId))}</strong></div><div><span>付款條件／方式</span><strong>${escapeHtml(order.paymentTerms || "—")} · ${escapeHtml(order.paymentMethod || "—")}</strong></div><div><span>供應商訂貨週期</span><strong>${escapeHtml(order.orderFrequency || "—")} · ${escapeHtml(order.supplierScheduleSnapshot?.nextOrderDate || "—")}</strong></div></div><div class="table-wrap"><table class="detail-table"><thead><tr><th>商品代碼／國際碼</th><th>已到／尚未到</th><th>逐品項追蹤</th><th>缺貨</th><th>門市可見備註${canSeeInternal ? "／採購內部備註" : ""}</th></tr></thead><tbody>${(order.lines || []).map((line) => `<tr><td><strong>${escapeHtml(productName(line.productId))}</strong><small>${escapeHtml(productCode(line.productId))}</small><small class="mono">${escapeHtml(identifierLabel(line.productId))}</small></td><td>${numberLabel(line.receivedQty)} / ${numberLabel(line.remainingQty)} 件</td><td>${escapeHtml(line.followUpStatus || "PENDING")}<small>${escapeHtml(line.supplierResponseNote || "尚無回覆")} · 下次 ${escapeHtml(line.nextFollowUpAt || "—")}</small></td><td>${statusChip(line.shortageStatus || "NONE")}<small>${numberLabel(line.shortageQty)} 件 · ${escapeHtml(line.shortageReason || "—")}</small></td><td>${escapeHtml(line.storeVisibleNote || "—")}${canSeeInternal ? `<small>內部：${escapeHtml(line.internalNote || "—")}</small>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderStoreManagerField() {
  return `<label class="checkbox-field"><input type="checkbox" name="isStoreManager" value="true" /><span><strong>此 STORE 使用者為店長</strong><small>可檢視並核准相同門市的人工需求。</small></span></label>`;
}

function renderNoGroupModal(suggestionIds = "", supplierId = "") {
  const ids = String(suggestionIds || "").split(",").map((id) => id.trim()).filter(Boolean);
  const suggestions = ids.length
    ? state.data.purchaseSuggestions.filter((suggestion) => ids.includes(suggestion.id) && !suggestion.purchaseOrderId)
    : state.data.purchaseSuggestions.filter((suggestion) => suggestion.supplierId === supplierId && !suggestion.purchaseOrderId && !["EXPIRED", "CANCELLED", "NO_GROUP"].includes(suggestion.status));
  if (!suggestions.length) return emptyState("沒有可標記的採購建議", "已建立採購單或已完成的建議不可標記無成團。");
  const reasonLabels = { MINIMUM_QUANTITY_NOT_MET: "未達供應商最低數量", PURCHASE_MULTIPLE_NOT_MET: "未達採購倍數", SUPPLIER_MINIMUM_AMOUNT_NOT_MET: "未達供應商最低金額", SUPPLIER_OUT_OF_STOCK: "供應商缺貨", SUPPLIER_DISCONTINUED: "供應商停供", PRICE_NOT_ACCEPTED: "價格未接受", PRODUCT_DISCONTINUED: "商品停產", OTHER: "其他" };
  const impact = suggestions.map((suggestion) => {
    const sources = (suggestion.sourceAllocations || []).map((source) => `<li>${escapeHtml(locationName(source.locationId))} · ${escapeHtml(demandNumber(source.demandOrderId))} · 尚待採購 ${numberLabel(source.allocatedQty)} 件</li>`).join("");
    return `<article class="no-group-impact-card"><strong>${escapeHtml(productName(suggestion.productId))}</strong><span>建議 ${numberLabel(suggestion.suggestedPurchaseQty)} 件</span><ul>${sources || "<li>無門市需求來源，列為總倉備貨</li>"}</ul></article>`;
  }).join("");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="source-chip manual">NO GROUP</span><strong>${supplierId ? escapeHtml(supplierName(supplierId)) : "採購建議"}</strong><small>確認前請檢查供應商、商品、受影響門市與需求；標記後不會建立採購單，來源與歷程會保留。</small></div><section class="no-group-impact"><h3>本次受影響範圍</h3>${impact}</section><label class="field"><span>無成團原因</span><select name="noGroupReason" required>${Object.entries(reasonLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label class="field"><span>說明（其他原因必填）</span><textarea name="noGroupNote" placeholder="請記錄供應商回覆、價格或數量原因"></textarea></label><input type="hidden" name="suggestionIds" value="${escapeHtml(suggestions.map((suggestion) => suggestion.id).join(","))}" /><input type="hidden" name="supplierId" value="${escapeHtml(supplierId || suggestions[0]?.supplierId || "")}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button danger" type="submit">確認標記無成團</button></div></form>`;
}

function renderDemandEditorModal(demandId = null) {
  const demand = demandId ? getDemand(demandId) : null;
  const user = currentUser();
  const locationId = user?.role === "STORE" ? user.locationId : demand?.locationId || "store01";
  const items = demand?.items?.length ? demand.items : [{ productId: state.data.products.find((product) => product.isActive)?.id || "", requestedQty: 6, reason: "", notes: "" }];
  const summaryLines = items.map((item) => demandLinePreview(item, locationId, { useSnapshots: false }));
  const supplierSummaries = summarizeSupplierDemand(summaryLines);
  const actionLabel = demand ? "儲存修改" : "建立草稿";
  return `<form id="entityForm" class="modal-form demand-editor" data-demand-editor data-demand-id="${demand?.id || ""}"><div class="demand-scope-note"><span>需求門市</span><strong>${locationName(locationId)}</strong><small>門市由登入 Session 決定，不接受前端指定其他門市。</small></div><div class="form-grid"><label class="field"><span>需求類型</span><select name="demandType" required>${["GENERAL", "URGENT", "CUSTOMER_ORDER", "PROMOTION", "NEW_PRODUCT", "OTHER"].map((type) => `<option value="${type}" ${demand?.demandType === type ? "selected" : ""}>${demandTypeLabel(type)}</option>`).join("")}</select></label><label class="field"><span>希望到貨日</span><input name="requiredDate" type="date" value="${demand?.requiredDate || "2026-07-25"}" required /></label></div><div class="section-row demand-lines-heading"><div><h3>商品明細</h3><small>選擇商品後會顯示庫存、前六個完整月份銷售、門市條件與供應商提示。</small></div><button type="button" class="button secondary small" data-action="add-demand-line">＋ 新增商品</button></div><div id="demandLines" class="demand-lines">${items.map((item, index) => renderDemandLineEditor(item, index, locationId, supplierSummaries)).join("")}</div><div class="supplier-summary-box" data-demand-supplier-summary>${renderSupplierSummaryHtml(supplierSummaries)}</div><label class="field"><span>需求單備註</span><textarea name="notes" placeholder="補充門市、配送或驗收資訊">${escapeHtml(demand?.notes || "")}</textarea></label><div class="modal-note"><b>送審規則：</b>儲存草稿時可暫不符合門市最低需求條件；執行「送店長核單」時才會驗證，廠商最低訂購量與金額只提示、不阻擋送審。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">${actionLabel}</button></div></form>`;
}

function renderDemandLineEditor(item, index, locationId, supplierSummaries) {
  const productId = item.productId || state.data.products.find((product) => product.isActive)?.id || "";
  const productOptions = state.data.products.filter((product) => product.isActive).map((product) => `<option value="${product.id}" ${product.id === productId ? "selected" : ""}>${product.productCode} · ${product.name} · ${product.specification}</option>`).join("");
  return `<div class="demand-line-editor" data-demand-line data-line-index="${index}"><div class="form-grid"><label class="field"><span>商品</span><select name="productId" data-demand-product-select required>${productOptions}</select></label><label class="field"><span>需求數量</span><input name="requestedQty" data-demand-input type="number" min="1" step="1" value="${Math.max(1, toNumber(item.requestedQty, 1))}" required /></label></div><label class="field"><span>明細原因（急件 / 客訂 / 活動 / 其他必填）</span><input name="reason" data-demand-input type="text" value="${escapeHtml(item.reason || "")}" placeholder="例如：客人預訂、活動備貨" /></label><div class="demand-line-insight" data-demand-line-insight>${renderDemandLineInsightHtml(productId, item.requestedQty, locationId, supplierSummaries, {}, { useSnapshots: false })}</div><button type="button" class="text-button demand-remove-line" data-action="remove-demand-line" data-index="${index}">移除此商品明細</button></div>`;
}

function renderDemandDetailModal(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand) return emptyState("找不到需求", "這筆資料可能已被重設。");
  const locationId = demand.locationId;
  const useCurrentAutoValues = demand.sourceType === "AUTO" && ["DRAFT", "RETURNED", "PENDING_MANAGER_APPROVAL"].includes(demand.status);
  const previewOptions = useCurrentAutoValues ? { useSnapshots: false } : {};
  const lines = demand.items.map((item) => demandLinePreview(item, locationId, previewOptions));
  const supplierSummaries = summarizeSupplierDemand(lines);
  const actions = [button("close-modal", "關閉", "ghost")];
  if (canEditHumanDemand(demand, user) || canEditAutoDemand(demand, user)) actions.unshift(button("open-edit-demand", "修改需求", "secondary", { id: demand.id }));
  if (canSubmitHumanDemand(demand, user) || canSubmitAutoDemand(demand, user)) actions.unshift(button("submit-demand", "送店長核單", "primary", { id: demand.id }));
  if (canDeleteHumanDemand(demand, user)) actions.unshift(button("delete-demand", "刪除草稿", "ghost", { id: demand.id }));
  if (canApproveDemand(demand, user)) {
    actions.unshift(button("return-demand", "退回修改", "ghost", { id: demand.id }));
    actions.unshift(button("approve-demand", "核准並送出總倉", "primary", { id: demand.id }));
  } else if (canManagerReviewAutoDemand(demand, user)) {
    actions.unshift(button("return-auto-demand", "退回修改", "ghost", { id: demand.id }));
    actions.unshift(button("open-auto-manager-edit", "修改後核准", "secondary", { id: demand.id }));
    actions.unshift(button("approve-auto-demand", "核准並送出總倉", "primary", { id: demand.id }));
  }
  const reviewMeta = demand.status === "RETURNED" ? `<div class="return-reason"><strong>店長退回原因</strong><p>${escapeHtml(demand.returnReason || "未提供原因")}</p><small>${demand.returnedAt || ""} · ${userName(demand.returnedBy)}</small></div>` : "";
  const autoComparison = demand.sourceType === "AUTO" ? renderAutoDemandComparison(demand) : "";
  return `<div class="detail-meta"><span class="mono">${demand.demandNumber}</span>${statusChip(demand.status)}<span class="source-chip ${demand.sourceType.toLowerCase()}">${demand.sourceType === "AUTO" ? "自動補貨" : "人工需求"}</span></div><div class="detail-grid"><div><span>門市</span><strong>${locationName(locationId)}</strong></div><div><span>需求日</span><strong>${demand.requiredDate}</strong></div><div><span>建立人</span><strong>${userName(demand.requestedBy || demand.createdBy)}</strong></div><div><span>建立時間</span><strong>${demand.createdAt}</strong></div><div><span>參考總數量</span><strong>${numberLabel(lines.reduce((sum, line) => sum + line.requestedQty, 0))} 件</strong></div><div><span>參考總金額</span><strong>${formatMoney(lines.reduce((sum, line) => sum + line.lineAmount, 0))} 元</strong></div><div><span>核准人</span><strong>${userName(demand.managerApprovedBy)}</strong></div><div><span>核准時間</span><strong>${demand.managerApprovedAt || "—"}</strong></div></div>${reviewMeta}${autoComparison}<div class="detail-section"><div class="section-row"><h3>需求明細與條件判斷</h3><span>${demand.items.length} 項</span></div><div class="demand-detail-lines">${demand.items.map((item) => `<article class="demand-detail-line"><div class="detail-line-heading"><strong>${productName(item.productId)}</strong><span>${numberLabel(item.finalRequestedQty ?? item.requestedQty)} 件需求</span></div>${renderDemandLineInsightHtml(item.productId, item.finalRequestedQty ?? item.requestedQty, locationId, supplierSummaries, item, previewOptions)}</article>`).join("")}</div></div><div class="supplier-summary-box">${renderSupplierSummaryHtml(supplierSummaries)}</div>${renderDemandPurchaseProgress(demand)}<div class="detail-note"><span>備註</span><p>${escapeHtml(demand.notes || "無")}</p></div><div class="modal-actions">${actions.join("")}</div>`;
}

function collectDemandLines(formData) {
  const productIds = formData.getAll("productId");
  const quantities = formData.getAll("requestedQty");
  const reasons = formData.getAll("reason");
  return productIds.map((productId, index) => ({
    productId: String(productId || "").trim(),
    requestedQty: Math.max(1, Math.floor(toNumber(quantities[index], 1))),
    reason: String(reasons[index] || "").trim(),
    notes: "",
  })).filter((line) => line.productId);
}

function demandLineReasonError(demandType, lines) {
  const requiresReason = ["URGENT", "CUSTOMER_ORDER", "PROMOTION", "NEW_PRODUCT", "OTHER"].includes(demandType);
  return requiresReason && lines.some((line) => !line.reason)
    ? "急件、客訂、活動、新品與其他需求的每一筆商品明細都必須填寫原因"
    : "";
}

function buildDemandItem(line, itemId = null) {
  return {
    id: itemId || createId("ditem"),
    productId: line.productId,
    requestedQty: Math.max(1, Math.floor(toNumber(line.requestedQty, 1))),
    approvedQty: 0,
    allocatedQty: 0,
    purchaseRequiredQty: 0,
    purchaseOrderedQty: 0,
    purchaseReceivedQty: 0,
    receivedQty: 0,
    reason: line.reason || "",
    notes: line.notes || "",
    referencePurchasePrice: null,
    lineAmount: null,
    currentStockSnapshot: null,
    onHandQtySnapshot: null,
    reservedQtySnapshot: null,
    availableQtySnapshot: null,
    calculatedAt: null,
    sixMonthSalesTotalSnapshot: null,
    sixMonthAverageSnapshot: null,
    sixMonthSalesMaxSnapshot: null,
    sixMonthSalesMinSnapshot: null,
    minimumQtySnapshot: null,
    minimumAmountSnapshot: null,
    conditionModeSnapshot: null,
    supplierMinimumQtySnapshot: null,
    supplierMinimumAmountSnapshot: null,
    supplierPurchaseMultipleSnapshot: null,
    replenishmentSuggestionId: null,
    systemSuggestedQty: null,
    storeConfirmedQty: null,
    managerConfirmedQty: null,
    finalRequestedQty: null,
    storeAdjustmentReason: null,
    managerAdjustmentReason: null,
    managerSkipped: false,
  };
}

function getStoreOrderCondition(locationId, productId) {
  const rows = (state.data.storeOrderConditions || []).filter((condition) => {
    if (condition.productId !== productId || condition.isActive === false) return false;
    if (condition.effectiveFrom && String(condition.effectiveFrom) > today) return false;
    if (condition.effectiveTo && String(condition.effectiveTo) < today) return false;
    return condition.locationId === locationId || condition.locationId === null || condition.locationId === undefined;
  });
  return rows.sort((left, right) => Number(right.locationId === locationId) - Number(left.locationId === locationId))[0] || null;
}

function demandLinePreview(item = {}, locationId, options = {}) {
  const product = state.data.products.find((candidate) => candidate.id === item.productId);
  const primarySupplierProduct = state.data.supplierProducts.find((candidate) => candidate.productId === item.productId && candidate.isPrimary)
    || state.data.supplierProducts.find((candidate) => candidate.productId === item.productId);
  const supplierId = product?.supplierId || primarySupplierProduct?.supplierId || null;
  const supplierProduct = getSupplierProduct(item.productId, supplierId) || primarySupplierProduct || {};
  const supplier = state.data.suppliers.find((candidate) => candidate.id === supplierId) || null;
  const useSnapshots = options.useSnapshots !== false;
  const hasSnapshot = (key) => useSnapshots && item[key] !== null && item[key] !== undefined;
  const referencePurchasePrice = hasSnapshot("referencePurchasePrice") ? toNumber(item.referencePurchasePrice) : Math.max(0, toNumber(supplierProduct.purchasePrice));
  const requestedQty = Math.max(0, toNumber(item.requestedQty));
  const lineAmount = hasSnapshot("lineAmount") ? Math.max(0, toNumber(item.lineAmount)) : calculateDemandLineAmount(requestedQty, referencePurchasePrice);
  const sales = calculateSixMonthSales(state.data.monthlyProductSales || [], locationId, item.productId, today);
  const conditionRow = getStoreOrderCondition(locationId, item.productId);
  const condition = evaluateStoreOrderCondition({
    conditionMode: hasSnapshot("conditionModeSnapshot") ? item.conditionModeSnapshot : conditionRow?.conditionMode,
    requestedQty,
    lineAmount,
    minimumQty: hasSnapshot("minimumQtySnapshot") ? item.minimumQtySnapshot : conditionRow?.minimumQty,
    minimumAmount: hasSnapshot("minimumAmountSnapshot") ? item.minimumAmountSnapshot : conditionRow?.minimumAmount,
  });
  const balance = getBalance(locationId, item.productId);
  const inventorySnapshot = buildReplenishmentInventorySnapshot({
    onHandQty: balance?.onHandQty,
    reservedQty: balance?.reservedQty,
    calculatedAt: item.calculatedAt,
  });
  const hasInventorySnapshot = item.onHandQtySnapshot !== null && item.onHandQtySnapshot !== undefined;
  return {
    product,
    supplier,
    supplierProduct,
    supplierId,
    requestedQty,
    referencePurchasePrice,
    lineAmount,
    currentStock: Math.max(0, toNumber(balance?.onHandQty)),
    currentReserved: Math.max(0, toNumber(balance?.reservedQty)),
    currentAvailable: inventorySnapshot.availableQtySnapshot,
    stockSnapshot: item.currentStockSnapshot === null || item.currentStockSnapshot === undefined ? null : Math.max(0, toNumber(item.currentStockSnapshot)),
    onHandQtySnapshot: item.onHandQtySnapshot === null || item.onHandQtySnapshot === undefined ? null : Math.max(0, toNumber(item.onHandQtySnapshot)),
    reservedQtySnapshot: item.reservedQtySnapshot === null || item.reservedQtySnapshot === undefined ? null : Math.max(0, toNumber(item.reservedQtySnapshot)),
    availableQtySnapshot: item.availableQtySnapshot === null || item.availableQtySnapshot === undefined ? null : Math.max(0, toNumber(item.availableQtySnapshot)),
    inventoryChanged: hasInventorySnapshot && inventorySnapshotChanged(item, { onHandQty: balance?.onHandQty, reservedQty: balance?.reservedQty }),
    sales,
    condition,
    supplierMinimumQty: hasSnapshot("supplierMinimumQtySnapshot") ? Math.max(0, toNumber(item.supplierMinimumQtySnapshot)) : Math.max(0, toNumber(supplierProduct.minimumOrderQuantity)),
    supplierMinimumAmount: hasSnapshot("supplierMinimumAmountSnapshot") ? Math.max(0, toNumber(item.supplierMinimumAmountSnapshot)) : Math.max(0, toNumber(supplierProduct.minimumOrderAmount ?? supplier?.minimumOrderAmount)),
    supplierPurchaseMultiple: hasSnapshot("supplierPurchaseMultipleSnapshot") ? Math.max(1, toNumber(item.supplierPurchaseMultipleSnapshot, 1)) : Math.max(1, toNumber(supplierProduct.purchaseMultiple, 1)),
  };
}

function conditionModeLabel(mode) {
  return { QUANTITY_ONLY: "只看數量", AMOUNT_ONLY: "只看金額", EITHER: "數量或金額擇一", BOTH: "數量且金額" }[mode] || mode || "未設定";
}

function conditionMessage(condition) {
  if (!condition.minimumQty && !condition.minimumAmount) return "未設定門市最低需求條件，視為符合";
  if (condition.eligible) return "符合門市最低需求條件";
  const shortages = [];
  if (condition.minimumQty !== null && condition.quantityShortage > 0) shortages.push(`數量還差 ${numberLabel(condition.quantityShortage)} 件`);
  if (condition.minimumAmount !== null && condition.amountShortage > 0) shortages.push(`金額還差 ${formatMoney(condition.amountShortage)} 元`);
  if (condition.mode === "EITHER") return `數量與金額皆未達成（${shortages.join("、")}）`;
  return `未達門市條件（${shortages.join("、")}）`;
}

function supplierWarningMessage(summary, minimumQty, minimumAmount, purchaseMultiple) {
  const warnings = [];
  if (minimumQty > 0 && summary.requestedQty < minimumQty) warnings.push(`供應商最低數量 ${numberLabel(minimumQty)} 件`);
  if (purchaseMultiple > 1 && summary.requestedQty % purchaseMultiple !== 0) warnings.push(`採購倍數 ${numberLabel(purchaseMultiple)}`);
  if (minimumAmount > 0 && summary.amount < minimumAmount) warnings.push(`供應商最低金額 ${formatMoney(minimumAmount)} 元`);
  return warnings.length ? `${warnings.join("、")}；僅提示，不阻擋送審` : "符合供應商提示條件；僅提示，不阻擋送審";
}

function renderDemandLineInsightHtml(productId, requestedQty, locationId, supplierSummaries = [], snapshot = {}, options = {}) {
  const line = demandLinePreview({ ...snapshot, productId, requestedQty }, locationId, options);
  const summary = supplierSummaries.find((candidate) => candidate.supplierId === line.supplierId) || { supplierId: line.supplierId, requestedQty: line.requestedQty, amount: line.lineAmount };
  const salesRows = line.sales.months.map((month) => `<span><b>${escapeHtml(month.label)}</b><strong>${numberLabel(month.salesQty)}</strong></span>`).join("");
  const supplierStatus = supplierWarningMessage(summary, line.supplierMinimumQty, line.supplierMinimumAmount, line.supplierPurchaseMultiple);
  const stockSnapshot = line.stockSnapshot === null && line.onHandQtySnapshot === null ? "" : `<small>快照可用 ${numberLabel(line.availableQtySnapshot ?? line.stockSnapshot)} 件 · 計算 ${snapshotCalculatedAt(snapshot)}</small>`;
  const inventoryChanged = line.inventoryChanged ? `<div class="inventory-change-warning">⚠ 庫存已變動：目前可用 ${numberLabel(line.currentAvailable)} 件，請重新確認</div>` : "";
  const schedule = getStoreSupplierSchedule(state.data, { supplierId: line.supplierId, productId });
  const scheduleHtml = schedule ? `<div class="supplier-schedule-public"><span>供應商訂貨資訊</span><strong>${escapeHtml(schedule.frequencyType)} · 下次訂貨 ${escapeHtml(schedule.nextOrderDate || "—")}</strong><small>截單 ${escapeHtml(schedule.cutoffTime || "—")} · 預計到貨 ${numberLabel(schedule.expectedDeliveryDays)} 天 · ${escapeHtml(schedule.storeVisibleNote || "尚無門市提示")}</small></div>` : "";
  return `<div class="demand-product-head"><div><strong>${escapeHtml(productCode(productId))} · ${escapeHtml(productName(productId))}</strong><small>${escapeHtml(line.product?.specification || "未提供規格")} · 主要供應商：${escapeHtml(supplierName(line.supplierId))}</small></div><span class="demand-line-qty">${numberLabel(line.requestedQty)} 件</span></div><div class="demand-info-grid"><div><span>目前門市庫存</span><strong>${numberLabel(line.currentStock)} 件</strong><small>保留 ${numberLabel(line.currentReserved)} · 可用 ${numberLabel(line.currentAvailable)} 件</small>${stockSnapshot}</div><div><span>參考進貨價</span><strong>${formatMoney(line.referencePurchasePrice)} 元</strong></div><div><span>明細金額</span><strong>${formatMoney(line.lineAmount)} 元</strong></div><div><span>前六個完整月份</span><strong>${numberLabel(line.sales.total)} 件</strong><small>平均 ${numberLabel(line.sales.average)} · 最大 ${numberLabel(line.sales.max ?? 0)} · 最小 ${numberLabel(line.sales.min ?? 0)}</small></div></div>${inventoryChanged}<div class="mini-sales"><span class="mini-sales-title">月銷售（不含當月）</span><div class="mini-sales-grid">${salesRows}</div></div><div class="condition-alert ${line.condition.eligible ? "ok" : "blocked"}"><div><span>門市最低需求條件 · ${escapeHtml(conditionModeLabel(line.condition.mode))}</span><strong>${line.condition.eligible ? "✓ " : "⚠ "}${escapeHtml(conditionMessage(line.condition))}</strong></div><small>${line.condition.minimumQty === null ? "最低數量未設定" : `最低 ${numberLabel(line.condition.minimumQty)} 件`} · ${line.condition.minimumAmount === null ? "最低金額未設定" : `最低 ${formatMoney(line.condition.minimumAmount)} 元`}</small></div><div class="supplier-alert"><div><span>供應商提示 · ${escapeHtml(supplierName(line.supplierId))}</span><strong>ⓘ ${escapeHtml(supplierStatus)}</strong></div><small>本單供應商彙總 ${numberLabel(summary.requestedQty)} 件 / ${formatMoney(summary.amount)} 元；MOQ ${numberLabel(line.supplierMinimumQty)} 件 · 倍數 ${numberLabel(line.supplierPurchaseMultiple)}</small></div>${scheduleHtml}`;
}

function renderSupplierSummaryHtml(summaries = []) {
  if (!summaries.length) return `<div class="supplier-summary-empty">尚未選擇商品，送審時會依供應商重新彙總。</div>`;
  return `<div class="supplier-summary-heading"><strong>供應商彙總與提示</strong><small>供應商最低量、倍數與最低金額只提示，不阻擋送審。</small></div><div class="supplier-summary-list">${summaries.map((summary) => {
    const supplierProduct = state.data.supplierProducts.find((item) => item.supplierId === summary.supplierId);
    const supplier = state.data.suppliers.find((item) => item.id === summary.supplierId);
    const minimumQty = Math.max(0, toNumber(supplierProduct?.minimumOrderQuantity));
    const minimumAmount = Math.max(0, toNumber(supplierProduct?.minimumOrderAmount ?? supplier?.minimumOrderAmount));
    const purchaseMultiple = Math.max(1, toNumber(supplierProduct?.purchaseMultiple, 1));
    return `<div class="supplier-summary-row"><div><strong>${escapeHtml(supplier?.name || "未指定供應商")}</strong><small>${numberLabel(summary.requestedQty)} 件 · ${formatMoney(summary.amount)} 元</small></div><span>${escapeHtml(supplierWarningMessage(summary, minimumQty, minimumAmount, purchaseMultiple))}</span></div>`;
  }).join("")}</div>`;
}

function refreshDemandEditorInsights(form) {
  if (!form?.matches("[data-demand-editor]")) return;
  const locationId = currentUser()?.role === "STORE" ? currentUser().locationId : "store01";
  const rows = [...form.querySelectorAll("[data-demand-line]")];
  const previews = rows.map((row) => demandLinePreview({
    productId: row.querySelector("[name='productId']")?.value || "",
    requestedQty: row.querySelector("[name='requestedQty']")?.value || 0,
  }, locationId, { useSnapshots: false }));
  const summaries = summarizeSupplierDemand(previews);
  rows.forEach((row, index) => {
    const productId = row.querySelector("[name='productId']")?.value || "";
    const requestedQty = row.querySelector("[name='requestedQty']")?.value || 0;
    const insight = row.querySelector("[data-demand-line-insight]");
    if (insight) insight.innerHTML = renderDemandLineInsightHtml(productId, requestedQty, locationId, summaries, {}, { useSnapshots: false });
    if (!previews[index].product) row.classList.add("invalid-demand-line");
    else row.classList.remove("invalid-demand-line");
  });
  const summaryElement = form.querySelector("[data-demand-supplier-summary]");
  if (summaryElement) summaryElement.innerHTML = renderSupplierSummaryHtml(summaries);
}

function addDemandLineEditor() {
  const form = document.querySelector("form[data-demand-editor]");
  const container = form?.querySelector("#demandLines");
  if (!form || !container) return;
  const indices = [...container.querySelectorAll("[data-line-index]")].map((row) => toNumber(row.dataset.lineIndex));
  const index = indices.length ? Math.max(...indices) + 1 : 0;
  const locationId = currentUser()?.role === "STORE" ? currentUser().locationId : "store01";
  container.insertAdjacentHTML("beforeend", renderDemandLineEditor({ productId: "", requestedQty: 1, reason: "", notes: "" }, index, locationId, []));
  refreshDemandEditorInsights(form);
}

function removeDemandLineEditor(index) {
  const form = document.querySelector("form[data-demand-editor]");
  const rows = [...(form?.querySelectorAll("[data-demand-line]") || [])];
  if (rows.length <= 1) return showToast("需求單至少需要一筆商品明細", "error");
  rows.find((row) => String(row.dataset.lineIndex) === String(index))?.remove();
  refreshDemandEditorInsights(form);
}

function validateDemandForApproval(demand, locationId) {
  const lines = (demand.items || []).map((item) => demandLinePreview(item, locationId, { useSnapshots: false }));
  const errors = [];
  lines.forEach((line, index) => {
    if (!line.product) errors.push(`第 ${index + 1} 筆商品不存在`);
    if (line.requestedQty <= 0) errors.push(`第 ${index + 1} 筆需求數量必須大於 0`);
    if (!line.condition.eligible) errors.push(`${productName(line.product?.id)}：${conditionMessage(line.condition)}`);
  });
  const reasonError = demandLineReasonError(demand.demandType, demand.items || []);
  if (reasonError) errors.push(reasonError);
  return { valid: errors.length === 0 && lines.length > 0, lines, errors };
}

function applyDemandSnapshots(demand, lines) {
  demand.items.forEach((item, index) => {
    const line = lines[index];
    if (!line) return;
    item.referencePurchasePrice = line.referencePurchasePrice;
    item.lineAmount = line.lineAmount;
    item.currentStockSnapshot = line.currentStock;
    item.onHandQtySnapshot = line.currentStock;
    item.reservedQtySnapshot = line.currentReserved;
    item.availableQtySnapshot = line.currentAvailable;
    item.calculatedAt = `${today} 10:00`;
    item.sixMonthSalesTotalSnapshot = line.sales.total;
    item.sixMonthAverageSnapshot = Math.round(line.sales.average * 100) / 100;
    item.sixMonthSalesMaxSnapshot = line.sales.max ?? 0;
    item.sixMonthSalesMinSnapshot = line.sales.min ?? 0;
    item.minimumQtySnapshot = line.condition.minimumQty;
    item.minimumAmountSnapshot = line.condition.minimumAmount;
    item.conditionModeSnapshot = line.condition.mode;
    item.supplierMinimumQtySnapshot = line.supplierMinimumQty;
    item.supplierMinimumAmountSnapshot = line.supplierMinimumAmount;
    item.supplierPurchaseMultipleSnapshot = line.supplierPurchaseMultiple;
  });
}

function demandLineAmount(item) {
  if (item.lineAmount !== null && item.lineAmount !== undefined) return Math.max(0, toNumber(item.lineAmount));
  const product = state.data.products.find((candidate) => candidate.id === item.productId);
  const supplierProduct = getSupplierProduct(item.productId, product?.supplierId);
  return calculateDemandLineAmount(item.requestedQty, supplierProduct?.purchasePrice);
}

function canReviewAsManager(user = currentUser()) {
  return Boolean(user && (user.role === "ADMIN" || (user.role === "STORE" && user.isStoreManager === true && user.locationId)));
}

function managerPendingDemands(user = currentUser()) {
  if (!canReviewAsManager(user)) return [];
  return state.data.demands.filter((demand) => ["MANUAL", "AUTO"].includes(demand.sourceType) && demand.status === "PENDING_MANAGER_APPROVAL" && (user.role === "ADMIN" || demand.locationId === user.locationId));
}

function canEditHumanDemand(demand, user = currentUser()) {
  return Boolean(demand && demand.sourceType === "MANUAL" && isHumanDemandEditableStatus(demand.status) && user && (user.role === "ADMIN" || (user.role === "STORE" && demand.locationId === user.locationId)));
}

function canSubmitHumanDemand(demand, user = currentUser()) {
  return canEditHumanDemand(demand, user) && ["STORE", "ADMIN"].includes(user.role);
}

function canDeleteHumanDemand(demand, user = currentUser()) {
  return canEditHumanDemand(demand, user) && demand.status === "DRAFT";
}

function canApproveDemand(demand, user = currentUser()) {
  return Boolean(demand && demand.sourceType === "MANUAL" && demand.status === "PENDING_MANAGER_APPROVAL" && canReviewAsManager(user) && (user.role === "ADMIN" || demand.locationId === user.locationId));
}

function renderReturnDemandModal(demandId) {
  const demand = getDemand(demandId);
  if (!demand) return emptyState("找不到需求單", "此需求可能已被刪除或不在目前使用者的門市範圍內。");
  return `<form id="entityForm" class="modal-form return-demand-form"><div class="detail-meta"><span class="mono">${escapeHtml(demand.demandNumber)}</span>${statusChip(demand.status)}<span>${escapeHtml(locationName(demand.locationId))}</span></div><div class="modal-note">退回後需求單會回到「已退回」，門市人員可修改明細、數量與原因，再次送店長核單。</div><label class="field"><span>退回原因</span><textarea name="returnReason" required minlength="2" placeholder="請說明需要補充或修正的內容"></textarea></label><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">退回並通知修改</button></div></form>`;
}

function renderSuggestionReviewInsight(suggestion, requestedQty) {
  const snapshot = {
    productId: suggestion.productId,
    requestedQty,
    currentStockSnapshot: suggestion.onHandQtySnapshot,
    onHandQtySnapshot: suggestion.onHandQtySnapshot,
    reservedQtySnapshot: suggestion.reservedQtySnapshot,
    availableQtySnapshot: suggestion.availableQtySnapshot,
    calculatedAt: suggestion.calculatedAt,
  };
  return `<div class="demand-line-insight suggestion-review-insight">${renderDemandLineInsightHtml(suggestion.productId, requestedQty, suggestion.locationId, [], snapshot, { useSnapshots: false })}</div>`;
}

function renderSuggestionModal(suggestionId) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return emptyState("找不到補貨建議", "請重新執行計算。");
  const systemQty = suggestion.systemSuggestedQty ?? suggestion.suggestedQty;
  const storeQty = suggestion.storeConfirmedQty ?? systemQty;
  const isAlreadyReviewed = ["ACCEPTED", "ADJUSTED"].includes(suggestion.status);
  return `<form id="entityForm" class="modal-form"><div class="suggestion-highlight"><span class="flow-symbol demand">↻</span><div><strong>${productName(suggestion.productId)}</strong><small>${locationName(suggestion.locationId)} · 系統建議 ${numberLabel(systemQty)} 件 · ${statusChip(suggestion.status)}</small></div><b>${numberLabel(storeQty)}<small>門市確認件</small></b></div>${renderSuggestionReviewInsight(suggestion, storeQty)}<div class="form-grid"><label class="field"><span>門市確認數量</span><input name="confirmedQty" type="number" min="1" step="1" value="${storeQty}" required /></label><label class="field"><span>調整原因（若修改必填）</span><input name="adjustmentReason" value="${escapeHtml(suggestion.storeAdjustmentReason || "")}" placeholder="例如：門市庫位有限" /></label><label class="field"><span>希望到貨日</span><input name="requiredDate" type="date" value="${suggestion.requiredDate || addDays(today, 3)}" required /></label><label class="field"><span>需求單備註</span><input name="notes" value="${escapeHtml(suggestion.notes || "")}" placeholder="補充門市配送資訊" /></label></div><input type="hidden" name="suggestionId" value="${suggestion.id}" /><div class="modal-note"><b>流程：</b>門市確認會先保存 ACCEPTED/ADJUSTED；建立草稿後才進入店長核單，未核准前不會送總倉或建立採購單。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button>${isAlreadyReviewed ? `<button class="button secondary" type="submit" name="suggestionAction" value="SAVE">儲存門市確認</button>` : `<button class="button secondary" type="submit" name="suggestionAction" value="SAVE">只儲存確認</button>`}<button class="button primary" type="submit" name="suggestionAction" value="CONVERT">${isAlreadyReviewed ? "建立需求草稿" : "確認並建立需求草稿"}</button></div></form>`;
}

function renderSkipSuggestionModal(suggestionId) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return emptyState("找不到補貨建議", "請重新整理後再試。 ");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span>${escapeHtml(productName(suggestion.productId))}</span>${statusChip(suggestion.status)}<span>${escapeHtml(locationName(suggestion.locationId))}</span></div><div class="modal-note">略過後會保留系統建議與異動紀錄，不會建立需求草稿；如要再次評估請重新執行補貨計算。</div><label class="field"><span>暫不補貨原因</span><textarea name="skipReason" required minlength="2" placeholder="例如：門市已自行補足庫存"></textarea></label><input type="hidden" name="suggestionId" value="${suggestion.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存略過</button></div></form>`;
}

function renderAutoDemandComparison(demand) {
  const summary = summarizeAutoApproval({ items: demand.items });
  const rows = demand.items.map((item) => `<div class="auto-compare-row"><strong>${escapeHtml(productName(item.productId))}</strong><span>系統 ${numberLabel(item.systemSuggestedQty ?? item.requestedQty)} 件</span><span>門市 ${numberLabel(item.storeConfirmedQty ?? item.requestedQty)} 件</span><span>店長 ${item.managerConfirmedQty == null ? "尚未確認" : `${numberLabel(item.managerConfirmedQty)} 件`}</span><b>最終 ${item.finalRequestedQty == null ? "待核准" : `${numberLabel(item.finalRequestedQty)} 件`}</b>${item.managerSkipped ? `<em>店長略過：${escapeHtml(item.managerAdjustmentReason || "已標記略過")}</em>` : ""}</div>`).join("");
  return `<section class="auto-comparison"><div class="section-row"><div><h3>自動補貨數量保留</h3><small>原始系統建議不會被門市或店長覆寫。</small></div><span>${summary.changedCount} 項店長調整 · ${summary.skippedCount} 項略過</span></div><div class="auto-comparison-summary"><div><span>系統總量</span><strong>${numberLabel(summary.systemTotalQty)} 件</strong></div><div><span>門市總量</span><strong>${numberLabel(summary.storeTotalQty)} 件</strong></div><div><span>店長總量</span><strong>${numberLabel(summary.managerTotalQty)} 件</strong></div><div><span>目前最終金額</span><strong>${formatMoney(summary.finalAmount)} 元</strong></div></div><div class="auto-comparison-list">${rows}</div></section>`;
}

function autoManagerDecisions(demand) {
  return demand.items.map((item) => ({
    itemId: item.id,
    managerQty: item.managerConfirmedQty ?? item.storeConfirmedQty ?? item.requestedQty,
    skipped: item.managerSkipped === true,
    reason: item.managerAdjustmentReason || "",
  }));
}

function autoManagerConditionMap(demand, decisions = autoManagerDecisions(demand)) {
  const decisionMap = new Map(decisions.map((decision) => [decision.itemId, decision]));
  return Object.fromEntries(demand.items.map((item) => {
    const decision = decisionMap.get(item.id) || {};
    const line = demandLinePreview(item, demand.locationId, { useSnapshots: false });
    const preview = demandLinePreview({ ...item, requestedQty: decision.managerQty ?? item.requestedQty }, demand.locationId, { useSnapshots: false });
    return [item.id, decision.skipped ? { eligible: true } : preview.condition];
  }));
}

function renderAutoManagerEditModal(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand || !canManagerReviewAutoDemand(demand, user)) return emptyState("無法修改此自動補貨需求", "只允許同門市店長或 ADMIN 操作待核需求。");
  const decisions = autoManagerDecisions(demand);
  const decisionMap = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const previewLines = demand.items.map((item) => demandLinePreview({ ...item, requestedQty: decisionMap.get(item.id)?.managerQty }, demand.locationId, { useSnapshots: false }));
  const supplierSummaries = summarizeSupplierDemand(previewLines);
  return `<form id="entityForm" class="modal-form auto-manager-editor" data-auto-manager-editor><input type="hidden" name="demandId" value="${demand.id}" /><div class="detail-meta"><span class="mono">${escapeHtml(demand.demandNumber)}</span>${statusChip(demand.status)}<span>${escapeHtml(locationName(demand.locationId))}</span></div><div class="modal-note"><b>店長核單：</b>可修改最終數量、希望到貨日、原因與備註；修改數量或略過品項必須填寫原因，儲存後仍維持待核，按「核准並送出」才會進入總倉。</div><div class="form-grid"><label class="field"><span>希望到貨日</span><input name="requiredDate" type="date" value="${escapeHtml(demand.requiredDate)}" required /></label><label class="field"><span>店長核單備註</span><input name="notes" value="${escapeHtml(demand.notes || "")}" placeholder="補充核單或配送資訊" /></label><label class="field"><span>店長修改總原因</span><input name="managerReasonHeader" value="${escapeHtml(demand.managerReason || "")}" placeholder="例如：依目前庫存調整"></label></div><div class="auto-manager-lines">${demand.items.map((item) => { const decision = decisionMap.get(item.id); return `<article class="auto-manager-line"><input type="hidden" name="itemId" value="${item.id}" /><div class="auto-manager-line-head"><div><strong>${escapeHtml(productName(item.productId))}</strong><small>系統 ${numberLabel(item.systemSuggestedQty ?? item.requestedQty)} 件 · 門市 ${numberLabel(item.storeConfirmedQty ?? item.requestedQty)} 件</small></div><label class="checkbox-field compact-check"><input type="checkbox" name="managerSkip" value="${item.id}" ${decision.skipped ? "checked" : ""} /><span><strong>本項略過</strong></span></label></div><div class="form-grid"><label class="field"><span>店長確認數量</span><input name="managerQty" type="number" min="0" step="1" value="${toNumber(decision.managerQty)}" required /></label><label class="field"><span>修改 / 略過原因</span><input name="managerReason" value="${escapeHtml(decision.reason)}" placeholder="數量不同或略過時必填" /></label></div><div class="demand-line-insight">${renderDemandLineInsightHtml(item.productId, decision.managerQty, demand.locationId, supplierSummaries, item, { useSnapshots: false })}</div></article>`; }).join("")}</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button secondary" type="submit" name="managerAction" value="SAVE">儲存修改（維持待核）</button><button class="button primary" type="submit" name="managerAction" value="APPROVE">儲存修改並進入核准摘要</button></div></form>`;
}

function renderAutoManagerApprovalModal(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand || !canManagerReviewAutoDemand(demand, user)) return emptyState("無法核准此自動補貨需求", "此需求可能已被其他流程處理。");
  const decisions = autoManagerDecisions(demand);
  const conditionMap = autoManagerConditionMap(demand, decisions);
  const validation = validateManagerDecisionLines(demand.items, decisions, conditionMap);
  const summary = summarizeAutoApproval({ items: demand.items, decisions });
  const warnings = supplierWarningsForDemand(demand, decisions);
  return `<form id="entityForm" class="modal-form auto-approval-summary-form"><input type="hidden" name="demandId" value="${demand.id}" /><div class="detail-meta"><span class="mono">${escapeHtml(demand.demandNumber)}</span>${statusChip(demand.status)}<span>${escapeHtml(locationName(demand.locationId))}</span></div><div class="approval-summary-grid"><div><span>品項數</span><strong>${numberLabel(summary.itemCount)} 項</strong></div><div><span>系統總量</span><strong>${numberLabel(summary.systemTotalQty)} 件</strong></div><div><span>門市總量</span><strong>${numberLabel(summary.storeTotalQty)} 件</strong></div><div><span>店長總量</span><strong>${numberLabel(summary.managerTotalQty)} 件</strong></div><div><span>最終金額</span><strong>${formatMoney(summary.finalAmount)} 元</strong></div><div><span>調整 / 略過</span><strong>${summary.changedCount} / ${summary.skippedCount}</strong></div></div><div class="auto-approval-table">${summary.rows.map((row) => `<div><strong>${escapeHtml(productName(demand.items.find((item) => item.id === row.itemId)?.productId))}</strong><span>系統 ${numberLabel(row.systemQty)} · 門市 ${numberLabel(row.storeQty)} · 店長 ${numberLabel(row.managerQty)} 件</span><b>${row.skipped ? "略過" : `${formatMoney(row.lineAmount)} 元`}</b></div>`).join("")}</div><div class="condition-summary ${validation.valid ? "ok" : "blocked"}"><strong>${validation.valid ? "✓ 最終數量符合門市最低需求條件" : "⚠ 尚不能核准"}</strong>${validation.valid ? "" : `<p>${escapeHtml(validation.errors.join(" "))}</p>`}</div><div class="supplier-summary-box">${renderSupplierWarningSummaryHtml(warnings)}</div><div class="modal-note">供應商 MOQ、採購倍數與最低金額只提示，不阻擋核准；門市最低需求條件不符合時必須先修改或略過品項。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="open-auto-manager-edit" data-id="${demand.id}">返回修改</button><button class="button primary" type="submit" ${validation.valid ? "" : "disabled"}>核准並送出總倉</button></div></form>`;
}

function renderAllocationModal(demandId) {
  const demand = getDemand(demandId);
  if (!demand) return emptyState("找不到需求", "請重新整理需求池。");
  return `<div class="allocation-summary"><div><span>需求單</span><strong class="mono">${demand.demandNumber}</strong></div><div><span>配送門市</span><strong>${locationName(demand.locationId)}</strong></div><div><span>總倉可用</span><strong class="green-text">${numberLabel(totalWarehouseAvailable())} 件</strong></div></div><div class="allocation-lines">${demand.items.map((item) => { const balance = getBalance("warehouse", item.productId); const need = demandOutstanding(item); const canAllocate = Math.min(need, availableInventory(balance)); return `<div class="allocation-line"><div><strong>${productName(item.productId)}</strong><small>${productCode(item.productId)} · 需求 ${numberLabel(item.requestedQty)} 件</small></div><div class="allocation-qty"><span>已配 ${numberLabel(item.allocatedQty)}</span><strong>${numberLabel(canAllocate)}<small> 可立即配</small></strong><span>缺口 ${numberLabel(Math.max(0, need - canAllocate))}</span></div></div>`; }).join("")}</div><div class="modal-note"><b>配貨檢查：</b>本次配貨會扣減總倉可用庫存並建立配貨單；不足數量會保留在採購缺口。</div><div class="modal-actions"><button class="button ghost" data-action="close-modal">取消</button><button class="button secondary" data-action="create-allocation" data-id="${demand.id}" data-mode="shortage">部分配貨 / 轉採購</button><button class="button primary" data-action="create-allocation" data-id="${demand.id}" data-mode="available">依可用量建立配貨單</button></div>`;
}

function renderReceiveAllocationModal(allocationId) {
  const allocation = state.data.allocations.find((item) => item.id === allocationId);
  if (!allocation) return emptyState("找不到配貨單", "請重新整理待簽收清單。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${allocation.allocationNumber}</span><span class="source-chip manual">配送至 ${locationName(allocation.destinationLocationId)}</span></div>${allocation.items.map((item) => `<div class="receive-line"><div><strong>${productName(item.productId)}</strong><small>應收 ${numberLabel(item.shippedQty)} 件</small></div><label class="field"><span>實收數量</span><input name="received_${item.id}" type="number" min="0" max="${item.shippedQty}" step="1" value="${item.shippedQty}" required /></label></div>`).join("")}<label class="field"><span>差異原因 / 備註</span><textarea name="receiveNotes" placeholder="若實收與出貨數量不同，請填寫原因"></textarea></label><input type="hidden" name="allocationId" value="${allocation.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">確認簽收並增加門市庫存</button></div></form>`;
}

function renderReceivePurchaseModal(purchaseOrderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return emptyState("找不到採購單", "請重新整理採購單列表。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${escapeHtml(order.purchaseOrderNumber)}</span><span class="source-chip auto">${escapeHtml(supplierName(order.supplierId))}</span><span>${statusChip(order.status)}</span></div><label class="field"><span>到貨日期</span><input name="receivedAt" type="date" value="${today}" min="${order.orderDate || today}" required /></label>${order.lines.map((line) => { const remaining = Math.max(0, toNumber(line.orderedQty) - toNumber(line.receivedQty) - toNumber(line.cancelledQty)); return `<div class="receive-line"><div><strong>${escapeHtml(productName(line.productId))}</strong><small>已到 ${numberLabel(line.receivedQty)} · 待到 ${numberLabel(remaining)} 件 · 單位 ${escapeHtml(line.purchaseUnit || "件")}</small></div><label class="field"><span>本次到貨</span><input name="received_${line.id}" type="number" min="0" max="${remaining}" step="1" value="0" required /></label><label class="field"><span>贈品實收</span><input name="gift_${line.id}" type="number" min="0" step="1" value="0" /></label></div>`; }).join("")}<label class="field"><span>到貨備註</span><textarea name="receiveNotes" placeholder="例如：部分到貨、批號待補"></textarea></label><input type="hidden" name="purchaseOrderId" value="${order.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">確認到貨並入總倉</button></div></form>`;
}

function manualPurchaseReasonOptionsHtml() {
  return [["WAREHOUSE_STOCK", "總倉安全庫存補充"], ["UPCOMING_PROMOTION", "預期活動備貨"], ["SEASONAL_STOCK", "季節性備貨"], ["PRICE_INCREASE", "即將調價"], ["MINIMUM_ORDER_AMOUNT", "補足供應商最低採購金額"], ["PURCHASE_MULTIPLE", "補足採購倍數"], ["SUPPLIER_PROMOTION", "廠商促銷"], ["NEW_PRODUCT", "新品備貨"], ["EMERGENCY", "緊急備貨"], ["OTHER", "其他"]].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function renderCreatePurchaseOrderModal(suggestionIds = "") {
  const selectedIds = new Set(String(suggestionIds || "").split(",").map((id) => id.trim()).filter(Boolean));
  const first = state.data.purchaseSuggestions.find((item) => selectedIds.has(item.id) && !item.purchaseOrderId && item.status !== "NO_GROUP");
  const supplierId = first?.supplierId || state.data.suppliers.find((item) => item.isActive !== false)?.id;
  const suggestions = visiblePurchaseSuggestions().filter((item) => item.supplierId === supplierId && !item.purchaseOrderId && item.status !== "NO_GROUP");
  if (!suggestions.length) return emptyState("找不到可轉採購單的建議", "請先重新彙總採購建議，或確認該建議尚未被其他採購單使用。");
  const supplier = state.data.suppliers.find((item) => item.id === supplierId) || {};
  const manualProducts = [];
  const seenProducts = new Set();
  state.data.supplierProducts.filter((item) => item.supplierId === supplierId && item.isActive !== false).forEach((supplierProduct) => {
    const product = state.data.products.find((item) => item.id === supplierProduct.productId && item.isActive !== false);
    if (!product || seenProducts.has(product.id)) return;
    seenProducts.add(product.id);
    manualProducts.push({ product, supplierProduct });
  });
  const manualOptions = manualProducts.map(({ product, supplierProduct }) => {
    const searchText = [product.productCode, product.name, product.barcode, product.specification, supplierProduct.supplierProductCode].filter(Boolean).join(" ");
    return `<option value="${escapeHtml(product.id)}" data-purchase-search="${escapeHtml(searchText.toLowerCase())}">${escapeHtml(product.productCode || "—")} · ${escapeHtml(product.name)} · ${escapeHtml(product.specification || "未提供規格")} · 供應商貨號 ${escapeHtml(supplierProduct.supplierProductCode || "—")} · ${escapeHtml(supplierProduct.purchaseUnit || product.baseUnit || "件")} · MOQ ${numberLabel(supplierProduct.minimumOrderQuantity)} / 倍數 ${numberLabel(supplierProduct.purchaseMultiple)}</option>`;
  }).join("");
  const reasonOptions = manualPurchaseReasonOptionsHtml();
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="source-chip auto">PURCHASE SUGGESTION</span><strong>${escapeHtml(supplier.name || supplierName(supplierId))}</strong><small>先選取採購建議；草稿編輯時仍可新增同一供應商的其他啟用商品。</small></div><div class="purchase-source-selection">${suggestions.map((suggestion) => `<label class="purchase-select-card"><input type="checkbox" name="suggestion_${suggestion.id}" value="true" ${selectedIds.has(suggestion.id) ? "checked" : ""} /><span><strong>${escapeHtml(productName(suggestion.productId))}</strong><small>${numberLabel(suggestion.rawPurchaseQty)} 件需求 · 建議 ${numberLabel(suggestion.suggestedPurchaseQty)} 件 · MOQ ${numberLabel(suggestion.minimumOrderQuantity)} · 倍數 ${numberLabel(suggestion.purchaseMultiple)}</small></span><b>${centsToDecimal(toNumber(suggestion.estimatedAmountCents))} 元</b></label><div class="form-grid"><label class="field"><span>確認數量</span><input name="confirmedQty_${suggestion.id}" type="number" min="1" step="1" value="${numberLabel(suggestion.confirmedPurchaseQty || suggestion.suggestedPurchaseQty).replaceAll(",", "")}" /></label><label class="field"><span>採購單價</span><input name="price_${suggestion.id}" type="number" min="0" step="0.01" value="${escapeHtml(String(suggestion.purchasePrice ?? 0))}" /></label></div>`).join("")}</div><section class="purchase-edit-line purchase-manual-add-section"><div class="section-row"><div><h3>新增同供應商商品</h3><p class="modal-note">人工數量不會分配給門市需求；若商品已在建議中，會合併成同一列並重新計算 MOQ、倍數與總倉備貨。</p></div><button type="button" class="button secondary small" data-action="focus-purchase-manual">＋ 新增同供應商商品</button></div><label class="search-field"><span>⌕</span><input data-purchase-product-search type="search" placeholder="搜尋商品代碼、名稱、條碼、規格或供應商貨號" /></label><div class="form-grid"><label class="field"><span>商品（僅限 ${escapeHtml(supplier.name || supplierName(supplierId))} 啟用供應品）</span><select name="manualProductId" data-purchase-manual-product><option value="">不新增人工品項</option>${manualOptions}</select></label><label class="field"><span>人工新增數量</span><input name="manualAddedQty" type="number" min="1" step="1" value="1" /></label><label class="field"><span>採購單價</span><input name="manualUnitPrice" type="number" min="0" step="0.01" value="0" /></label><label class="field"><span>新增原因類別</span><select name="manualReasonCode"><option value="">請選擇</option>${reasonOptions}</select></label></div><div class="form-grid"><label class="field"><span>人工新增原因（選擇商品後必填）</span><input name="manualAddReason" placeholder="例如：總倉安全庫存補充" /></label><label class="field"><span>其他原因說明</span><input name="manualReasonDetail" placeholder="選擇其他時必填" /></label></div></section><div class="form-grid"><label class="field"><span>採購日期</span><input name="orderDate" type="date" value="${today}" required /></label><label class="field"><span>預計到貨日</span><input name="expectedDeliveryDate" type="date" value="${addDays(today, supplier.leadTimeDays || 0)}" required /></label></div><label class="field"><span>例外下單原因（未達 MOQ、倍數或最低金額時必填）</span><textarea name="overrideReason" placeholder="若條件未達標，請說明供應商確認、急件或合併採購原因"></textarea></label><label class="field"><span>採購備註</span><textarea name="notes" placeholder="可填付款、交貨或聯絡事項"></textarea></label><input type="hidden" name="purchaseAction" value="suggestion" /><input type="hidden" name="supplierId" value="${supplierId}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立採購單草稿</button></div></form>`;
}

function renderManualPurchaseOrderModal() {
  const supplier = state.data.suppliers.find((item) => item.isActive !== false);
  const supplierId = supplier?.id || "";
  const options = state.data.supplierProducts.filter((item) => item.isActive !== false).map((item) => `<option value="${item.productId}" data-supplier-id="${item.supplierId}" data-price="${escapeHtml(String(item.purchasePrice ?? 0))}">${escapeHtml(supplierName(item.supplierId))} · ${escapeHtml(productCode(item.productId))} ${escapeHtml(productName(item.productId))} · MOQ ${numberLabel(item.minimumOrderQuantity)} / 倍數 ${numberLabel(item.purchaseMultiple)}</option>`).join("");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="source-chip manual">MANUAL</span><small>手動新增且沒有門市來源的數量，預設列為總倉備貨。</small></div><div class="form-grid"><label class="field"><span>供應商</span><select name="supplierId" required>${state.data.suppliers.filter((item) => item.isActive !== false).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select></label><label class="field"><span>商品（須為供應商供應品）</span><select name="productId" required>${options}</select></label></div><div class="form-grid"><label class="field"><span>採購數量</span><input name="orderedQty" type="number" min="1" step="1" value="1" required /></label><label class="field"><span>採購單價</span><input name="unitPrice" type="number" min="0" step="0.01" value="0" required /></label></div><div class="form-grid"><label class="field"><span>採購日期</span><input name="orderDate" type="date" value="${today}" required /></label><label class="field"><span>預計到貨日</span><input name="expectedDeliveryDate" type="date" value="${addDays(today, supplier?.leadTimeDays || 0)}" required /></label></div><label class="field"><span>手動新增原因（必填）</span><textarea name="manualReason" required placeholder="例如：總倉安全庫存補充、核准的備貨計畫"></textarea></label><label class="field"><span>備註</span><textarea name="notes"></textarea></label><input type="hidden" name="purchaseAction" value="manual" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立手動採購單草稿</button></div></form>`;
}

function renderPurchaseOrderDetailModal(purchaseOrderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return emptyState("找不到採購單", "請重新整理採購單列表。");
  const metrics = getPurchaseOrderMetrics(order);
  const trace = orderSourceTrace(order);
  const canManage = canManagePurchaseOrders(currentUser());
  const canReceive = canReceivePurchaseOrders(currentUser());
  return `<div class="purchase-detail"><div class="detail-meta"><span class="mono">${escapeHtml(order.purchaseOrderNumber)}</span><span>${statusChip(order.status)}</span><span class="source-chip ${String(order.sourceType).toLowerCase()}">${escapeHtml(order.sourceType || "MIXED")}</span></div><div class="detail-grid"><div><span>供應商</span><strong>${escapeHtml(supplierName(order.supplierId))}</strong></div><div><span>聯絡人</span><strong>${escapeHtml(order.supplierContactName || "—")}</strong></div><div><span>採購/預計到貨</span><strong>${escapeHtml(order.orderDate || "—")} / ${escapeHtml(order.expectedDeliveryDate || "—")}</strong></div><div><span>訂購/已到/未到</span><strong class="big-cell">${numberLabel(metrics.orderedQty)} / ${numberLabel(metrics.receivedQty)} / ${numberLabel(metrics.remainingQty)}</strong></div><div><span>採購金額</span><strong>${escapeHtml(String(order.totalAmount || "0.00"))} 元</strong></div><div><span>供應商最低金額</span><strong>${order.minimumAmountMet ? "已達標" : `未達標 · 尚差 ${escapeHtml(String(order.minimumAmountShortfall || "0.00"))} 元`}</strong></div></div><section class="detail-section"><h3>商品明細（建議與人工品項合併）</h3><div class="table-wrap"><table class="detail-table"><thead><tr><th>商品 / 來源</th><th>單位 / MOQ / 倍數</th><th>原始需求 / 需求分配 / 人工新增</th><th>建議 / 最終 / 已到 / 剩餘</th><th>單價 / 小計</th><th>總倉備貨 / 倍數增加</th></tr></thead><tbody>${order.lines.map((line) => `<tr><td><strong>${escapeHtml(productName(line.productId))}</strong><small>${escapeHtml(productCode(line.productId))} · ${escapeHtml(line.supplierProductCode || "—")}</small><small>${line.sourceSuggestionId ? "採購建議" : "總倉人工備貨"}${line.manualAddedQty ? ` · 人工：${escapeHtml(line.manualAddReason || "未填原因")} · ${escapeHtml(userName(line.manualAddedBy))} · ${escapeHtml(line.manualAddedAt || "—")}` : ""}</small></td><td>${escapeHtml(line.purchaseUnit || "件")}<small>MOQ ${numberLabel(line.minimumOrderQuantity)} · 倍數 ${numberLabel(line.purchaseMultiple)}</small></td><td>${numberLabel(line.rawDemandQty ?? line.rawPurchaseQty)} / ${numberLabel(line.demandAllocatedQty)} / ${numberLabel(line.manualAddedQty)}</td><td><strong>${numberLabel(line.suggestedPurchaseQty)} / ${numberLabel(line.confirmedPurchaseQty ?? line.orderedQty)} / ${numberLabel(line.receivedQty)} / ${numberLabel(line.remainingQty)}</strong></td><td>${escapeHtml(String(line.unitPrice || "0.00"))} / ${escapeHtml(String(line.lineSubtotal || "0.00"))}</td><td>${numberLabel(line.warehouseBufferQty)} / ${numberLabel(line.multipleOverageQty)} 件</td></tr>`).join("")}</tbody></table></div></section><section class="detail-section"><h3>來源需求與總倉備貨</h3>${trace.map((row) => `<div class="source-trace-card"><strong>${escapeHtml(productName(row.productId))}</strong><span>總倉備貨 ${numberLabel(row.warehouseBufferQty)} 件</span>${row.sources.map((source) => `<small>${escapeHtml(locationName(source.locationId))} · ${escapeHtml(demandNumber(source.demandOrderId))} · 分配 ${numberLabel(source.allocatedQty)} · 已到 ${numberLabel(source.receivedAllocatedQty)} · 取消 ${numberLabel(source.cancelledAllocatedQty)}</small>`).join("") || "<small>無門市來源需求</small>"}</div>`).join("")}</section>${renderPurchaseOrderHistory(order)}<section class="detail-section"><h3>操作與狀態</h3><p>${escapeHtml(order.notes || "無備註")}</p><div class="modal-actions">${canManage && order.status === "DRAFT" ? button("confirm-purchase-order", "確認採購單", "primary", { id: order.id }) : ""}${canManage && order.status === "PENDING_CONFIRMATION" ? button("order-purchase-order", "標記已下單", "primary", { id: order.id }) : ""}${canReceive && ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) ? button("open-receive-po", "登記到貨", "primary", { id: order.id }) : ""}${canManage && ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) ? button("open-purchase-tracking", "更新未到貨追蹤", "secondary", { id: order.id }) : ""}${canManage ? button("copy-purchase-order", "複製成草稿", "secondary", { id: order.id }) : ""}${button("print-purchase-order", "列印採購單", "ghost", { id: order.id })}</div></section></div>`;
}

function renderPurchaseOrderHistory(order) {
  const receipts = (state.data.purchaseReceiptLogs || []).filter((log) => log.purchaseOrderId === order.id);
  const changes = (state.data.purchaseOrderChangeLogs || []).filter((log) => log.purchaseOrderId === order.id);
  return `<section class="detail-section"><h3>到貨紀錄</h3>${receipts.map((log) => `<div class="audit-mini-row"><strong>${escapeHtml(log.receivedAt || "—")}</strong><span>${escapeHtml(userName(log.receivedBy))} · ${numberLabel(Object.values(log.lines || {}).reduce((sum, value) => sum + toNumber(value), 0))} 件</span><small>${escapeHtml(log.note || "無備註")}</small></div>`).join("") || "<p class=\"muted-text\">尚無到貨紀錄</p>"}</section><section class="detail-section"><h3>異動紀錄</h3>${changes.map((log) => `<div class="audit-mini-row"><strong>${escapeHtml(log.changedAt || "—")}</strong><span>${escapeHtml(userName(log.changedBy))} · ${escapeHtml(log.reason || "未填原因")}</span><small>修改前：${escapeHtml(JSON.stringify(log.beforeData || {}))}</small><small>修改後：${escapeHtml(JSON.stringify(log.afterData || {}))}</small></div>`).join("") || "<p class=\"muted-text\">尚無採購單異動紀錄</p>"}</section>`;
}

function renderEditPurchaseOrderModal(purchaseOrderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return emptyState("找不到採購單", "請重新整理採購單列表。");
  if (!canManagePurchaseOrders(currentUser()) || !["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) return emptyState("此採購單已鎖定", "只有草稿或待確認採購單可以修改主要內容。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${escapeHtml(order.purchaseOrderNumber)}</span>${statusChip(order.status)}</div>${order.lines.map((line) => `<div class="purchase-edit-line"><strong>${escapeHtml(productName(line.productId))}</strong><div class="form-grid"><label class="field"><span>採購數量</span><input name="qty_${line.id}" type="number" min="1" step="1" value="${numberLabel(line.orderedQty).replaceAll(",", "")}" /></label><label class="field"><span>採購單價</span><input name="price_${line.id}" type="number" min="0" step="0.01" value="${escapeHtml(String(line.unitPrice || 0))}" /></label></div></div>`).join("")}<div class="form-grid"><label class="field"><span>預計到貨日</span><input name="expectedDeliveryDate" type="date" value="${escapeHtml(order.expectedDeliveryDate || today)}" min="${escapeHtml(order.orderDate || today)}" required /></label><label class="field"><span>聯絡人</span><input name="supplierContactName" value="${escapeHtml(order.supplierContactName || "")}" /></label></div><label class="field"><span>修改原因</span><textarea name="editReason" ${order.status === "PENDING_CONFIRMATION" ? "required" : ""} placeholder="待確認採購單的重要欄位異動請填寫原因"></textarea></label><label class="field"><span>備註</span><textarea name="notes">${escapeHtml(order.notes || "")}</textarea></label><input type="hidden" name="purchaseOrderId" value="${order.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存採購單修改</button></div></form>`;
}

function renderPurchaseOrderDistributionEditor(order, line) {
  const existingPlans = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderItemId === line.id);
  const plans = existingPlans.length ? existingPlans : buildPurchaseOrderItemDistributionPlans({ ...order, lines: [line] }, { locations: state.data.locations || [] });
  const rows = (state.data.locations || []).filter((location) => location.type === "STORE" && location.isActive !== false).map((location) => {
    const plan = plans.find((candidate) => (candidate.destinationLocationId || candidate.locationId) === location.id) || { sourceDemandQty: 0, suggestedDistributionQty: 0, plannedDistributionQty: 0, planningReason: "" };
    const plannedQty = toNumber(plan.plannedDistributionQty ?? plan.confirmedAllocationQty);
    const sourceDemandQty = toNumber(plan.sourceDemandQty);
    return `<div class="distribution-plan-row"><strong>${escapeHtml(location.name)}</strong><span>系統建議 ${numberLabel(plan.suggestedDistributionQty ?? plan.suggestedAllocationQty)} · 尚待需求 ${numberLabel(sourceDemandQty)} · 已實配 ${numberLabel(plan.actualAllocatedQty)} · 超出 ${numberLabel(Math.max(0, plannedQty - sourceDemandQty))}</span><input name="distribution_${line.id}_${location.id}" type="number" min="0" step="1" value="${numberLabel(plannedQty).replaceAll(",", "")}" aria-label="${escapeHtml(location.name)} 採購確認配貨量" /><input name="distributionReason_${line.id}_${location.id}" value="${escapeHtml(plan.planningReason || plan.allocationReason || "")}" placeholder="調整原因（如超出需求或與建議不同）" aria-label="${escapeHtml(location.name)} 配貨原因" /></div>`;
  }).join("");
  const plannedQty = plans.reduce((sum, plan) => sum + toNumber(plan.plannedDistributionQty ?? plan.confirmedAllocationQty), 0);
  return `<details class="distribution-plan-editor"><summary>門市配貨規劃：${numberLabel(plannedQty)} / ${numberLabel(line.orderedQty)} 件，總倉留存 ${numberLabel(Math.max(0, toNumber(line.orderedQty) - plannedQty))} 件</summary><p class="modal-note">預計配貨只是規劃，不會直接扣減門市或總倉實際庫存；配貨合計不得超過採購人員確認數量。</p><div class="distribution-plan-grid">${rows}</div></details>`;
}

function renderEditPurchaseOrderModalV2(purchaseOrderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return emptyState("找不到採購單", "這筆資料可能已被重設。");
  if (!canManagePurchaseOrders(currentUser()) || !["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) return emptyState("採購單不可編輯", "只有草稿與待確認採購單可由採購人員修改。");
  const products = state.data.supplierProducts.filter((item) => item.supplierId === order.supplierId && item.isActive !== false).map((item) => `<option value="${item.productId}">${escapeHtml(productCode(item.productId))} · ${escapeHtml(productName(item.productId))} · MOQ ${numberLabel(item.minimumOrderQuantity)} / 倍數 ${numberLabel(item.purchaseMultiple)}</option>`).join("");
  const reasonOptions = manualPurchaseReasonOptionsHtml();
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${escapeHtml(order.purchaseOrderNumber)}</span>${statusChip(order.status)}<span class="source-chip ${String(order.sourceType).toLowerCase()}">${escapeHtml(order.sourceType || "MIXED")}</span></div><p class="modal-note">草稿可新增或移除明細；同一商品會合併成一列，來源需求分配不會被人工新增數量占用；已下單後不可新增或移除。</p>${order.lines.map((line) => `<div class="purchase-edit-line"><div class="section-row"><strong>${escapeHtml(productName(line.productId))}</strong><label class="checkbox-field compact-checkbox"><input name="remove_${line.id}" value="true" type="checkbox" /><span>移除此明細</span></label></div><div class="form-grid"><label class="field"><span>最終採購數量</span><input name="qty_${line.id}" type="number" min="1" step="1" value="${numberLabel(line.orderedQty).replaceAll(",", "")}" required /></label><label class="field"><span>採購單價</span><input name="price_${line.id}" type="number" min="0" step="0.01" value="${escapeHtml(String(line.unitPrice || 0))}" required /></label><label class="field"><span>贈品數量</span><input name="gift_${line.id}" type="number" min="0" step="1" value="${numberLabel(line.giftQty)}" /></label></div><small class="purchase-line-source">來源：${line.sourceSuggestionId ? "採購建議" : "總倉人工備貨"}${line.manualAddedQty ? ` · 人工新增 ${numberLabel(line.manualAddedQty)} 件 · ${escapeHtml(line.manualAddReason || "未填原因")}` : ""} · 需求分配 ${numberLabel(line.demandAllocatedQty)} 件 · 總倉備貨 ${numberLabel(line.warehouseBufferQty)} 件 · MOQ ${numberLabel(line.minimumOrderQuantity)} / 倍數 ${numberLabel(line.purchaseMultiple)}</small></div>`).join("")}<section class="purchase-edit-line"><div class="section-row"><div><h3>新增同供應商商品（可選）</h3><p class="modal-note">只列出目前供應商的啟用供應品；若與既有建議同商品且單位、單價、MOQ、倍數一致，會合併為 MIXED。</p></div></div><label class="search-field"><span>⌕</span><input data-purchase-product-search type="search" placeholder="搜尋商品代碼、名稱、條碼、規格或供應商貨號" /></label><div class="form-grid"><label class="field"><span>商品</span><select name="newProductId" data-purchase-manual-product><option value="">不新增</option>${products}</select></label><label class="field"><span>人工新增數量</span><input name="newQty" type="number" min="1" step="1" value="1" /></label><label class="field"><span>採購單價（空白沿用既有明細）</span><input name="newPrice" type="number" min="0" step="0.01" value="0" /></label><label class="field"><span>贈品數量</span><input name="newGiftQty" type="number" min="0" step="1" value="0" /></label></div><div class="form-grid"><label class="field"><span>人工新增原因類別</span><select name="newManualReasonCode"><option value="">請選擇</option>${reasonOptions}</select></label><label class="field"><span>人工新增原因（必填）</span><input name="newManualReason" placeholder="例如：總倉安全庫存補充" /></label><label class="field"><span>其他原因說明</span><input name="newManualReasonDetail" placeholder="選擇其他時必填" /></label></div></section><div class="form-grid"><label class="field"><span>預計到貨日</span><input name="expectedDeliveryDate" type="date" value="${escapeHtml(order.expectedDeliveryDate || today)}" min="${escapeHtml(order.orderDate || today)}" required /></label><label class="field"><span>聯絡人</span><input name="supplierContactName" value="${escapeHtml(order.supplierContactName || "")}" /></label><label class="field"><span>聯絡電話</span><input name="supplierContactPhone" value="${escapeHtml(order.supplierContactPhone || "")}" /></label><label class="field"><span>聯絡 Email</span><input name="supplierContactEmail" type="email" value="${escapeHtml(order.supplierContactEmail || "")}" /></label><label class="field"><span>付款條件</span><input name="paymentTerms" value="${escapeHtml(order.paymentTerms || "")}" /></label></div><label class="field"><span>修改原因</span><textarea name="editReason" ${order.status === "PENDING_CONFIRMATION" ? "required" : ""} placeholder="待確認採購單的重要欄位異動請填寫原因"></textarea></label><label class="field"><span>備註</span><textarea name="notes">${escapeHtml(order.notes || "")}</textarea></label><input type="hidden" name="purchaseOrderId" value="${order.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存採購單修改</button></div></form>`;
}

function renderCancelPurchaseOrderModal(purchaseOrderId, remainingOnly = false) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return emptyState("找不到採購單", "請重新整理採購單列表。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${escapeHtml(order.purchaseOrderNumber)}</span><span>${remainingOnly ? "只取消尚未到貨數量" : "取消整張採購單"}</span></div><div class="warning-callout">⚠ ${remainingOnly ? "已到貨數量會保留，未滿足需求會重新回到待採購池。" : "取消後不得新增到貨或重新啟用。"}</div><label class="field"><span>取消原因（必填）</span><textarea name="cancelReason" required placeholder="例如：供應商缺貨、採購需求取消"></textarea></label><input type="hidden" name="purchaseOrderId" value="${order.id}" /><input type="hidden" name="remainingOnly" value="${remainingOnly ? "true" : "false"}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">返回</button><button class="button danger" type="submit">${remainingOnly ? "取消剩餘數量" : "取消整張採購單"}</button></div></form>`;
}

function renderPurchaseTrackingModal(purchaseOrderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  const previous = state.data.purchaseTrackingNotes.find((item) => item.purchaseOrderId === purchaseOrderId) || {};
  if (!order) return emptyState("找不到採購單", "請重新整理採購單列表。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${escapeHtml(order.purchaseOrderNumber)}</span><span>${escapeHtml(supplierName(order.supplierId))}</span></div><div class="form-grid"><label class="field"><span>新預計到貨日</span><input name="expectedDeliveryDate" type="date" value="${escapeHtml(order.expectedDeliveryDate || today)}" min="${escapeHtml(order.orderDate || today)}" required /></label><label class="field"><span>最後聯繫日期</span><input name="contactDate" type="date" value="${escapeHtml(previous.contactDate || today)}" /></label></div><label class="field"><span>廠商回覆狀態</span><select name="vendorStatus"><option ${previous.vendorStatus === "CONFIRMED" ? "selected" : ""} value="CONFIRMED">已確認到貨日</option><option ${previous.vendorStatus === "PARTIAL" ? "selected" : ""} value="PARTIAL">部分供貨</option><option ${previous.vendorStatus === "SHORTAGE" ? "selected" : ""} value="SHORTAGE">廠商缺貨</option><option ${previous.vendorStatus === "PENDING" || !previous.vendorStatus ? "selected" : ""} value="PENDING">尚待回覆</option></select></label><label class="field"><span>追蹤備註</span><textarea name="trackingNote" placeholder="記錄廠商回覆、下一次聯繫日期或缺貨原因">${escapeHtml(previous.note || "")}</textarea></label><input type="hidden" name="purchaseOrderId" value="${order.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存未到貨追蹤</button></div></form>`;
}

function renderAddProductModal() {
  const user = currentUser();
  if (!canCreateProduct(user)) return emptyState("無法新增商品", "只有採購人員、倉管或管理員可以建立商品主檔。");
  const full = ["ADMIN", "WAREHOUSE"].includes(user.role);
  const purchasing = ["ADMIN", "PURCHASING"].includes(user.role);
  const supplierOptions = state.data.suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}（${escapeHtml(supplier.code)}）</option>`).join("");
  return `<form id="entityForm" class="modal-form wide-master-form"><section class="master-form-section"><div class="section-row"><div><h3>商品基本資料</h3><p class="modal-note">建立商品時需先填商品編號、條碼、名稱與基本單位；商品若尚未完成供應商條件，會標記為「待完成採購設定」。</p></div><span class="readonly-label">${ROLE_LABELS[user.role]}</span></div><div class="form-grid">${masterTextField("商品編號", "productCode", "", true, { required: true })}${masterTextField("條碼", "barcode", "", true, { required: true })}${masterTextField("商品名稱", "name", "", true, { required: true })}${masterTextField("規格", "specification", "", true)}${masterTextField("分類", "category", "一般藥品", true)}${masterTextField("基本單位", "baseUnit", "件", true, { required: true })}</div></section><section class="master-form-section"><div class="section-row"><div><h3>倉儲物流設定</h3><p class="modal-note">${full ? "倉管與管理員可在建立時一併設定箱入數、配貨及批號/效期規則。" : "目前角色不能修改倉儲物流設定；建立後由倉管補充。"}</p></div><span class="readonly-label">${readonlyLabel(full)}</span></div><div class="form-grid">${masterTextField("箱入數", "casePackQty", "0", full, { type: "number", min: 0, step: 1 })}${masterTextField("門市配貨單位", "storeDistributionUnit", "件", full)}${masterTextField("門市配貨倍數", "storeDistributionMultiple", "1", full, { type: "number", min: 1, step: 1 })}${masterTextField("總倉儲位", "warehouseLocationCode", "", full)}${masterTextField("最低可接受效期天數", "minimumShelfLifeDays", "0", full, { type: "number", min: 0, step: 1 })}</div><div class="form-grid">${masterCheckboxField("批號管理", "batchTrackingEnabled", false, full)}${masterCheckboxField("效期管理", "expiryTrackingEnabled", false, full)}</div>${masterTextField("倉儲備註", "storageNote", "", full)}</section><section class="master-form-section"><div class="section-row"><div><h3>初始供應商與採購條件（可選）</h3><p class="modal-note">${purchasing ? "採購人員或管理員可在建立商品時直接建立第一筆商品供應商設定；留白則由採購後續補齊。" : "目前角色只能先建立商品基本資料，供應商與採購條件由採購人員補齊。"}</p></div><span class="readonly-label">${readonlyLabel(purchasing)}</span></div><div class="form-grid">${purchasing ? `<label class="field"><span>供應商<small class="field-permission editable">可編輯</small></span><select name="supplierId"><option value="">暫不設定</option>${supplierOptions}</select></label>${masterTextField("供應商商品編號", "supplierProductCode", "", true)}${masterTextField("採購單位", "purchaseUnit", "件", true)}${masterTextField("參考採購單價", "purchasePrice", "0", true, { type: "number", min: 0, step: "0.01" })}${masterTextField("最低採購量", "minimumOrderQuantity", "1", true, { type: "number", min: 1, step: 1 })}${masterTextField("採購倍數", "purchaseMultiple", "1", true, { type: "number", min: 1, step: 1 })}${masterTextField("供應商最低採購金額", "minimumOrderAmount", "0", true, { type: "number", min: 0, step: "0.01" })}${masterTextField("交貨天數", "leadTimeDays", "0", true, { type: "number", min: 0, step: 1 })}${masterCheckboxField("設為主要供應商", "isPrimary", true, true)}${masterCheckboxField("供應關係啟用", "supplierProductIsActive", true, true)}` : `<div class="readonly-master-value"><span>採購設定</span><strong>由採購人員建立商品供應商關係後才可採購</strong></div>`}</div></section><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立商品</button></div></form>`;
}

function renderAdjustInventoryModal(modal) {
  const productOptions = state.data.products.map((product) => `<option value="${product.id}" ${modal.productId === product.id ? "selected" : ""}>${product.productCode} · ${product.name}</option>`).join("");
  const locationOptions = state.data.locations.map((location) => `<option value="${location.id}" ${modal.locationId === location.id ? "selected" : ""}>${location.code} · ${location.name}</option>`).join("");
  return `<form id="entityForm" class="modal-form"><div class="form-grid"><label class="field"><span>地點</span><select name="locationId">${locationOptions}</select></label><label class="field"><span>商品</span><select name="productId">${productOptions}</select></label></div><div class="inventory-adjust-card"><span>目前數量</span><strong>${numberLabel(getBalance(modal.locationId || "warehouse", modal.productId || state.data.products[0].id)?.onHandQty || 0)} 件</strong><small>只允許調整為 0 以上的整數</small></div><label class="field"><span>調整後數量</span><input name="onHandQty" type="number" min="0" step="1" value="${getBalance(modal.locationId || "warehouse", modal.productId || state.data.products[0].id)?.onHandQty || 0}" required /></label><label class="field"><span>調整原因</span><textarea name="reason" required placeholder="例如：盤點差異、報廢、初始補登"></textarea></label><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存庫存調整</button></div></form>`;
}

function renderAddUserModal() {
  return `<form id="entityForm" class="modal-form"><div class="form-grid"><label class="field"><span>帳號</span><input name="username" pattern="[a-zA-Z0-9_]+" required /></label><label class="field"><span>顯示名稱</span><input name="displayName" required /></label></div><div class="form-grid"><label class="field"><span>角色</span><select name="role">${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}">${label}</option>`).join("")}</select></label><label class="field"><span>所屬單位（門市必選）</span><select name="locationId"><option value="">全域 / 不綁定</option>${state.data.locations.map((location) => `<option value="${location.id}">${location.name}</option>`).join("")}</select></label></div><div class="modal-note">新增帳號後會要求使用者在此瀏覽器重新設定示範密碼；正式環境應由後端 seed 與密碼雜湊處理。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立使用者</button></div></form>`;
}

function renderProfileModal() {
  const user = currentUser();
  return `<div class="profile-card"><span class="avatar ${user.role.toLowerCase()} large-avatar">${user.displayName.slice(0, 1)}</span><div><span class="section-kicker">SIGNED IN AS</span><h3>${user.displayName}</h3><p>${user.username} · ${ROLE_LABELS[user.role]}</p><p>${user.locationId ? locationName(user.locationId) : "全域管理範圍"}</p></div></div><div class="profile-note">目前為瀏覽器本機流程驗證版。切換角色請登出後使用另一個測試帳號。</div><div class="modal-actions"><button class="button ghost" data-action="close-modal">關閉</button><button class="button secondary" data-action="logout">登出</button></div>`;
}

function supplierById(id) { return state.data.suppliers.find((item) => item.id === id) || null; }
function purchaseLineByRef(orderId, itemId) { const order = state.data.purchaseOrders.find((item) => item.id === orderId); return { order, line: order?.lines?.find((item) => item.id === itemId) }; }

function renderSupplierTermsModal(supplierId) {
  const supplier = supplierById(supplierId);
  const user = currentUser();
  if (!supplier || !canManageSupplierCommercialData(user)) return emptyState("無法編輯供應商條件", "只有採購人員或管理員可以管理付款、付款對象與銀行資料。");
  const relation = state.data.supplierBusinessRelations.find((item) => item.orderingSupplierId === supplier.id && item.isDefault && item.isActive !== false);
  const payeeOptions = state.data.suppliers.filter((item) => item.isActive !== false).map((item) => `<option value="${escapeHtml(item.id)}" ${(relation?.payeeSupplierId || supplier.id) === item.id ? "selected" : ""}>${escapeHtml(item.name)}（${escapeHtml(item.code || item.id)}）</option>`).join("");
  return `<form id="entityForm" class="modal-form wide-master-form"><input type="hidden" name="supplierId" value="${escapeHtml(supplier.id)}" /><section class="master-form-section"><div class="section-row"><div><h3>供應商付款與商務資料</h3><p class="modal-note">只保存付款條件，不執行付款或會計傳票；付款方式選「其他」時必須填寫說明。</p></div><span class="readonly-label">${ROLE_LABELS[user.role]}</span></div><div class="form-grid"><label class="field"><span>付款方式</span><select name="paymentMethod">${SUPPLIER_PAYMENT_METHODS.map((method) => `<option value="${method}" ${supplier.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}</select></label>${masterTextField("付款方式說明", "paymentMethodNote", supplier.paymentMethodNote, true)}${masterTextField("付款條件", "paymentTerms", supplier.paymentTerms, true)}${masterTextField("結算天數", "settlementDays", supplier.settlementDays, true, { type: "number", min: 0, step: 1 })}${masterTextField("帳單週期", "billingCycle", supplier.billingCycle, true)}${masterTextField("發票要求", "invoiceRequirement", supplier.invoiceRequirement, true)}${masterTextField("幣別", "currency", supplier.currency, true)}${masterTextField("門市可見供應商備註", "supplierPublicNote", supplier.supplierPublicNote, true)}</div></section><section class="master-form-section"><div class="section-row"><div><h3>訂購供應商／付款供應商</h3><p class="modal-note">採購單建立時預設帶入；草稿可切換，正式下單後需填寫異動原因並留下 audit。</p></div></div><div class="form-grid"><label class="field"><span>付款供應商</span><select name="payeeSupplierId">${payeeOptions}</select></label>${masterCheckboxField("設為此訂購供應商預設付款對象", "isDefaultRelation", true, true)}</div>${masterTextField("關係備註", "relationNote", relation?.note || "", true)}</section><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存付款與供應商關係</button></div></form>`;
}

function renderSupplierScheduleModal(supplierId) {
  const supplier = supplierById(supplierId);
  const schedule = state.data.supplierOrderSchedules.find((item) => item.supplierId === supplierId && item.isPrimary && item.isActive !== false) || state.data.supplierOrderSchedules.find((item) => item.supplierId === supplierId && item.isActive !== false) || {};
  const weekdayLabels = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]];
  const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
  return `<form id="entityForm" class="modal-form"><input type="hidden" name="supplierId" value="${escapeHtml(supplierId)}" /><input type="hidden" name="scheduleId" value="${escapeHtml(schedule.id || "")}" /><div class="detail-meta"><strong>${escapeHtml(supplier?.name || "供應商")}</strong><span>門市可見訂貨資訊</span></div><div class="form-grid"><label class="field"><span>訂貨頻率</span><select name="frequencyType">${SUPPLIER_ORDER_FREQUENCIES.map((type) => `<option value="${type}" ${schedule.frequencyType === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>${masterTextField("間隔天數", "intervalDays", schedule.intervalDays || 1, true, { type: "number", min: 1, step: 1 })}${masterTextField("每月訂貨日", "dayOfMonth", schedule.dayOfMonth || "", true, { type: "number", min: 1, max: 31, step: 1 })}${masterTextField("截單時間", "cutoffTime", schedule.cutoffTime || "", true, { type: "time" })}${masterTextField("預計到貨天數", "expectedDeliveryDays", schedule.expectedDeliveryDays ?? supplier?.leadTimeDays ?? 0, true, { type: "number", min: 0, step: 1 })}${masterTextField("下次訂貨日", "nextOrderDate", schedule.nextOrderDate || today, true, { type: "date" })}${masterTextField("下次預計到貨日", "nextExpectedDeliveryDate", schedule.nextExpectedDeliveryDate || "", true, { type: "date" })}</div><fieldset class="weekday-picker"><legend>每週訂貨日（可複選）</legend>${weekdayLabels.map(([value, label]) => `<label class="checkbox-field compact-checkbox"><input type="checkbox" name="weekdays" value="${value}" ${weekdays.includes(value) ? "checked" : ""} /><span>星期${label}</span></label>`).join("")}</fieldset>${masterTextField("門市可見提示", "storeVisibleNote", schedule.storeVisibleNote || "", true)}${masterTextField("採購內部備註", "internalNote", schedule.internalNote || "", true)}<div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存訂貨週期</button></div></form>`;
}

function renderSupplierBankModal(supplierId) {
  const supplier = supplierById(supplierId);
  const reveal = state.revealBankAccounts[supplierId] === true;
  const accounts = getSupplierBankAccountsForRole(state.data, supplierId, currentUser(), { reveal });
  return `<div class="modal-form"><div class="detail-meta"><strong>${escapeHtml(supplier?.name || "供應商")}</strong><span>銀行帳戶預設遮罩；完整帳號只在本次授權操作中暫時顯示，附件只使用私有 storage key</span></div><div class="stack-list">${accounts.map((account) => `<div class="list-row"><div><strong>${escapeHtml(account.bankName || "未填銀行")} · ${escapeHtml(account.accountName || "未填戶名")}</strong><small>${escapeHtml(account.accountNumber || account.accountNumberMasked || "—")} · ${account.isPrimary ? "主要帳戶" : "一般帳戶"} · ${account.verifiedAt ? "已驗證" : "待驗證"}</small></div><div class="row-actions">${!account.accountNumber ? button("reveal-bank-account", "查看完整帳號", "ghost small", { id: account.id, supplierId }) : ""}${account.isPrimary ? "" : button("set-primary-bank", "設為主要", "ghost small", { id: account.id })}${!account.verifiedAt ? button("verify-bank", "標記已驗證", "secondary small", { id: account.id }) : ""}${button("disable-bank", "停用", "danger small", { id: account.id })}</div></div>`).join("") || `<p class="panel-note">尚未建立銀行帳戶。</p>`}</div><form id="entityForm" class="modal-form"><input type="hidden" name="supplierId" value="${escapeHtml(supplierId)}" /><h3>新增銀行帳戶</h3><div class="form-grid">${masterTextField("銀行名稱", "bankName", "", true, { required: true })}${masterTextField("銀行代碼", "bankCode", "", true)}${masterTextField("分行名稱", "branchName", "", true)}${masterTextField("戶名", "accountName", "", true, { required: true })}${masterTextField("銀行帳號", "accountNumber", "", true, { required: true })}${masterCheckboxField("設為主要帳戶", "isPrimary", true, true)}</div><label class="field"><span>存摺封面／帳戶證明（PDF/JPG/PNG，最大 10 MB）</span><input name="bankProof" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></label><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">關閉</button><button class="button primary" type="submit">新增帳戶與附件 metadata</button></div></form></div>`;
}

function renderProductIdentifiersModal(productId) {
  const product = state.data.products.find((item) => item.id === productId);
  const rows = state.data.productIdentifiers.filter((item) => item.productId === productId && item.isActive !== false);
  const values = Object.fromEntries(rows.map((item) => [item.identifierType, item.value]));
  return `<form id="entityForm" class="modal-form wide-master-form"><input type="hidden" name="productId" value="${escapeHtml(productId)}" /><div class="detail-meta"><strong>${escapeHtml(product?.name || "商品")}</strong><span>${escapeHtml(product?.productCode || "—")}</span></div><p class="modal-note">五種欄位會依類型驗證長度；相同類型與值不得被不同商品重複使用。</p><div class="form-grid">${masterTextField("GTIN-14", "identifier_GTIN14", values.GTIN14 || "", true)}${masterTextField("EAN-13", "identifier_EAN13", values.EAN13 || "", true)}${masterTextField("UPC-A", "identifier_UPCA", values.UPCA || "", true)}${masterTextField("JAN Code", "identifier_JAN", values.JAN || "", true)}${masterTextField("製造商料號", "identifier_MANUFACTURER_ITEM_CODE", values.MANUFACTURER_ITEM_CODE || "", true)}${masterTextField("其他代碼", "identifier_OTHER", values.OTHER || "", true)}</div><div class="detail-section"><h3>目前已登錄代碼</h3>${rows.map((row) => `<div class="audit-mini-row"><strong>${escapeHtml(row.identifierType)}</strong><span class="mono">${escapeHtml(row.value)}</span><small>${escapeHtml(row.note || "")}</small></div>`).join("") || `<p class="muted-text">尚未登錄</p>`}</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存商品代碼</button></div></form>`;
}

function renderPurchaseItemFollowupModal(orderId, itemId) {
  const { order, line } = purchaseLineByRef(orderId, itemId);
  if (!order || !line) return emptyState("找不到採購明細", "請重新整理追蹤清單。");
  return `<form id="entityForm" class="modal-form"><input type="hidden" name="purchaseOrderId" value="${escapeHtml(orderId)}" /><input type="hidden" name="purchaseOrderItemId" value="${escapeHtml(itemId)}" /><div class="detail-meta"><strong>${escapeHtml(productName(line.productId))}</strong><span>${escapeHtml(order.purchaseOrderNumber)}</span></div><div class="form-grid"><label class="field"><span>明細追蹤狀態</span><select name="followUpStatus">${PURCHASE_ITEM_FOLLOW_UP_STATUSES.map((status) => `<option value="${status}" ${line.followUpStatus === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>${masterTextField("聯繫日期", "contactDate", (line.lastFollowedUpAt || today).slice(0, 10), true, { type: "date" })}${masterTextField("下次追蹤日", "nextFollowUpAt", line.nextFollowUpAt || "", true, { type: "date" })}${masterTextField("最新預計到貨日", "revisedExpectedDeliveryDate", line.revisedExpectedDeliveryDate || order.expectedDeliveryDate || "", true, { type: "date" })}</div>${masterTextField("供應商回覆", "supplierResponseNote", line.supplierResponseNote, true)}${masterTextField("門市可見備註", "storeVisibleNote", line.storeVisibleNote, true)}${masterTextField("採購內部備註", "internalNote", line.internalNote, true)}<div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存逐品項追蹤</button></div></form>`;
}

function renderPurchaseItemShortageModal(orderId, itemId) {
  const { order, line } = purchaseLineByRef(orderId, itemId);
  if (!order || !line) return emptyState("找不到採購明細", "請重新整理追蹤清單。");
  return `<form id="entityForm" class="modal-form"><input type="hidden" name="purchaseOrderId" value="${escapeHtml(orderId)}" /><input type="hidden" name="purchaseOrderItemId" value="${escapeHtml(itemId)}" /><div class="detail-meta"><strong>${escapeHtml(productName(line.productId))}</strong><span>尚未到貨 ${numberLabel(line.remainingQty)} 件 · 既有缺貨 ${numberLabel(line.shortageQty)} 件</span></div><div class="form-grid"><label class="field"><span>缺貨數量</span><input name="shortageQty" type="number" min="0" max="${line.remainingQty}" step="1" value="${line.shortageQty}" required /></label><label class="field"><span>缺貨狀態</span><select name="shortageStatus">${PURCHASE_ITEM_SHORTAGE_STATUSES.map((status) => `<option value="${status}" ${line.shortageStatus === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label class="field"><span>缺貨原因</span><select name="shortageReason"><option value="">請選擇</option>${PURCHASE_ITEM_SHORTAGE_REASONS.map((reason) => `<option value="${reason}" ${line.shortageReason === reason ? "selected" : ""}>${reason}</option>`).join("")}</select></label><label class="field"><span>後續動作</span><select name="shortageAction"><option value="UPDATE">只更新缺貨</option><option value="REQUEUE">重新納入採購池</option><option value="NO_GROUP">標記無成團</option><option value="CANCEL">取消缺貨數量</option></select></label></div>${masterTextField("門市可見缺貨提示", "storeVisibleShortageNote", line.storeVisibleShortageNote || line.storeVisibleNote, true)}${masterTextField("缺貨內部備註／取消原因", "shortageNote", line.shortageNote || line.shortageResolutionReason, true, { required: true })}<div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存缺貨處理</button></div></form>`;
}

function renderSupplierReturnCreateModal() {
  const supplierOptions = state.data.suppliers.filter((item) => item.isActive !== false).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  const productOptions = state.data.products.filter((item) => item.isActive !== false).map((item) => `<option value="${item.id}">${escapeHtml(item.productCode)} · ${escapeHtml(item.name)}</option>`).join("");
  return `<form id="entityForm" class="modal-form wide-modal-form"><div class="form-grid"><label class="field"><span>供應商</span><select name="supplierId" required>${supplierOptions}</select></label><label class="field"><span>退貨來源</span><select name="sourceType">${SUPPLIER_RETURN_SOURCES.map((source) => `<option value="${source}">${source}</option>`).join("")}</select></label></div><div class="form-grid"><label class="field"><span>商品</span><select name="productId" required>${productOptions}</select></label>${masterTextField("退貨數量", "returnQty", "1", true, { type: "number", min: 1, step: 1, required: true })}${masterTextField("批號（若商品啟用批號）", "batchNumber", "", true)}${masterTextField("效期（若商品啟用效期）", "expiryDate", "", true, { type: "date" })}${masterTextField("單價", "unitPrice", "0", true, { type: "number", min: 0, step: "0.01" })}</div><div class="form-grid">${masterTextField("來源採購單（可選）", "sourcePurchaseOrderId", "", true)}${masterTextField("來源採購明細（可選）", "sourcePurchaseOrderItemId", "", true)}${masterTextField("來源收貨紀錄（可選）", "sourceReceiptId", "", true)}${masterTextField("預計處理日期", "expectedResolutionDate", "", true, { type: "date" })}</div><label class="field"><span>退貨原因</span><select name="reasonCode">${SUPPLIER_RETURN_REASON_CODES.map((reason) => `<option value="${reason}">${reason}</option>`).join("")}</select></label>${masterTextField("退貨說明", "returnReason", "", true)}${masterTextField("總倉備註", "warehouseNote", "", true)}<div class="modal-note">草稿只建立退貨資料，不異動庫存；送出確認、準備退貨與正式出庫會在各自交易中留下 movement 與 audit。填入採購明細可避免同一明細重複建立處理中的退貨。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立退貨草稿</button></div></form>`;
}

function renderSupplierReturnEditModal(returnOrderId, returnOrderItemId) {
  const order = state.data.supplierReturns.find((item) => item.id === returnOrderId);
  const item = state.data.supplierReturnItems.find((row) => row.id === returnOrderItemId && row.returnOrderId === returnOrderId);
  if (!order || !item) return emptyState("找不到退貨草稿", "請重新整理退貨資料。");
  const productOptions = state.data.products.filter((product) => product.isActive !== false).map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === item.productId ? "selected" : ""}>${escapeHtml(product.productCode)} · ${escapeHtml(product.name)}</option>`).join("");
  return `<form id="entityForm" class="modal-form wide-modal-form"><input type="hidden" name="returnOrderId" value="${escapeHtml(returnOrderId)}" /><input type="hidden" name="returnOrderItemId" value="${escapeHtml(returnOrderItemId)}" /><div class="form-grid"><label class="field"><span>商品</span><select name="productId" required>${productOptions}</select></label>${masterTextField("退貨數量", "returnQty", item.returnQty, true, { type: "number", min: 1, step: 1, required: true })}${masterTextField("批號", "batchNumber", item.batchNumber, true)}${masterTextField("效期", "expiryDate", item.expiryDate, true, { type: "date" })}${masterTextField("單價", "unitPrice", item.unitPrice, true, { type: "number", min: 0, step: "0.01" })}</div><label class="field"><span>退貨原因</span><select name="reasonCode">${SUPPLIER_RETURN_REASON_CODES.map((reason) => `<option value="${reason}" ${item.reasonCode === reason ? "selected" : ""}>${reason}</option>`).join("")}</select></label>${masterTextField("退貨說明", "returnReason", order.returnReason, true)}${masterTextField("總倉備註", "warehouseNote", order.warehouseNote, true)}${masterTextField("預計處理日期", "expectedResolutionDate", order.expectedResolutionDate || "", true, { type: "date" })}${masterTextField("明細備註", "note", item.note, true)}<div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存退貨草稿</button></div></form>`;
}

function renderSupplierReturnDetailModal(returnOrderId) {
  const order = state.data.supplierReturns.find((item) => item.id === returnOrderId);
  const user = currentUser();
  if (!order) return emptyState("找不到退貨單", "請重新整理退貨清單。");
  const items = state.data.supplierReturnItems.filter((item) => item.returnOrderId === order.id);
  const actions = `${canCreateSupplierReturn(user) && order.status === "DRAFT" ? button("submit-supplier-return", "送供應商確認", "primary", { id: order.id }) : ""}${canResolveSupplierReturn(user) && order.status === "PENDING_SUPPLIER_CONFIRMATION" ? button("confirm-supplier-return", "供應商已確認", "primary", { id: order.id }) : ""}${canResolveSupplierReturn(user) && order.status === "SUPPLIER_CONFIRMED" ? button("ready-supplier-return", "準備退貨出庫", "primary", { id: order.id }) : ""}${canCreateSupplierReturn(user) && order.status === "READY_TO_RETURN" ? button("return-outbound", "執行退貨出庫", "danger", { id: order.id }) : ""}${canCreateSupplierReturn(user) && order.status === "RETURNED_TO_SUPPLIER" ? button("waiting-return-resolution", "進入供應商處理", "secondary", { id: order.id }) : ""}`;
  return `<div class="purchase-detail"><div class="detail-meta"><span class="mono">${escapeHtml(order.returnNumber)}</span>${statusChip(order.status)}<span>${escapeHtml(supplierName(order.supplierId))}</span></div><div class="detail-grid"><div><span>來源</span><strong>${escapeHtml(order.sourceType)}</strong></div><div><span>退貨數量</span><strong class="big-cell">${numberLabel(order.totalQty)} 件</strong></div><div><span>預估金額</span><strong>${escapeHtml(order.estimatedAmount)} 元</strong></div><div><span>建立時間</span><strong>${escapeHtml(order.createdAt || "—")}</strong></div></div><section class="detail-section"><h3>退貨明細</h3>${items.map((item) => `<article class="purchase-progress-card"><div><strong>${escapeHtml(productName(item.productId))}</strong><small>${numberLabel(item.returnQty)} 件 · ${escapeHtml(item.batchNumber || "無批號")} · ${escapeHtml(item.expiryDate || "無效期")}</small></div><div><strong>未完成 ${numberLabel(item.unresolvedQty)} 件</strong><small>退回 ${numberLabel(item.returnedQty)} · 退款 ${numberLabel(item.refundedQty)} · 折讓 ${numberLabel(item.creditedQty)} · 替代品 ${numberLabel(item.replacementReceivedQty)} / ${numberLabel(item.replacementQty)}</small></div><div>${canManageSupplierReturns(user) ? button("open-return-attachment", "上傳退貨附件", "ghost small", { id: order.id, itemId: item.id }) : ""}${canResolveSupplierReturn(user) && ["RETURNED_TO_SUPPLIER", "WAITING_RESOLUTION", "PARTIALLY_RESOLVED", "REJECTED_BY_SUPPLIER"].includes(order.status) ? button("open-return-resolution", "登記處理結果", "secondary small", { id: order.id, itemId: item.id }) : ""}${canCreateSupplierReturn(user) && item.replacementQty > item.replacementReceivedQty ? button("receive-replacement", "登記替代品到貨", "primary small", { itemId: item.id }) : ""}</div></article>`).join("")}</section><div class="modal-actions">${actions}${canResolveSupplierReturn(user) && order.status === "PARTIALLY_RESOLVED" ? button("close-supplier-return", "結案", "secondary", { id: order.id }) : ""}<button class="button ghost" data-action="close-modal">關閉</button></div></div>`;
}

function renderSupplierReturnAttachmentModal(returnOrderId, returnOrderItemId) {
  return `<form id="entityForm" class="modal-form"><input type="hidden" name="returnOrderId" value="${escapeHtml(returnOrderId)}" /><input type="hidden" name="returnOrderItemId" value="${escapeHtml(returnOrderItemId)}" /><label class="field"><span>附件類型</span><select name="attachmentType"><option value="DAMAGE_PHOTO">損壞照片</option><option value="EXPIRY_PHOTO">效期照片</option><option value="SUPPLIER_APPROVAL">供應商同意</option><option value="WAYBILL">退貨託運單</option><option value="RETURN_RECEIPT">退貨簽收</option><option value="REFUND_PROOF">退款／折讓證明</option><option value="OTHER">其他</option></select></label><label class="field"><span>檔案（PDF/JPG/PNG，最大 10 MB）</span><input name="returnAttachment" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required /></label><p class="modal-note">只寫入附件 metadata 與私有 storage key；門市不會取得附件內容或下載 URL。</p><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">上傳附件</button></div></form>`;
}

function renderSupplierReturnResolutionModal(returnOrderId, returnOrderItemId) {
  const order = state.data.supplierReturns.find((item) => item.id === returnOrderId);
  const item = state.data.supplierReturnItems.find((row) => row.id === returnOrderItemId) || state.data.supplierReturnItems.find((row) => row.returnOrderId === returnOrderId);
  if (!order || !item) return emptyState("找不到退貨明細", "請重新整理退貨資料。");
  return `<form id="entityForm" class="modal-form"><input type="hidden" name="returnOrderItemId" value="${escapeHtml(item.id)}" /><div class="detail-meta"><strong>${escapeHtml(productName(item.productId))}</strong><span>${escapeHtml(order.returnNumber)}</span></div><div class="form-grid"><label class="field"><span>處理結果</span><select name="resolutionType">${SUPPLIER_RETURN_RESOLUTION_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}</select></label>${masterTextField("處理數量", "resolutionQty", String(item.unresolvedQty || item.returnQty), true, { type: "number", min: 1, max: item.returnQty, step: 1 })}${masterTextField("確認金額", "confirmedAmount", item.confirmedAmount || item.estimatedAmount, true, { type: "number", min: 0, step: "0.01" })}</div>${masterTextField("供應商回覆", "supplierResponse", item.supplierResponse, true)}<div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存退貨處理結果</button></div></form>`;
}

function renderSupplierReplacementModal(returnOrderItemId) {
  const item = state.data.supplierReturnItems.find((row) => row.id === returnOrderItemId);
  return `<form id="entityForm" class="modal-form"><input type="hidden" name="returnOrderItemId" value="${escapeHtml(returnOrderItemId)}" /><div class="detail-meta"><strong>${escapeHtml(productName(item?.productId || ""))}</strong><span>替代品只入總倉庫存，不直接增加門市庫存</span></div>${masterTextField("本次替代品到貨數量", "receivedQty", "1", true, { type: "number", min: 1, max: Math.max(1, (item?.replacementQty || 0) - (item?.replacementReceivedQty || 0)), step: 1, required: true })}${masterTextField("替代商品 ID（留白沿用原商品）", "replacementProductId", "", true)}<div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">登記替代品到貨</button></div></form>`;
}

function handleModalSubmit(formData) {
  const type = state.modal?.type;
  if (type === "create-demand") createDemand(formData);
  if (type === "edit-demand") updateDemand(state.modal.demandId, formData);
  if (type === "return-demand") returnDemand(state.modal.demandId, formData);
  if (type === "return-auto-demand") returnAutoDemand(state.modal.demandId, formData);
  if (type === "confirm-suggestion") confirmSuggestion(formData);
  if (type === "skip-suggestion") skipSuggestion(String(formData.get("suggestionId")), String(formData.get("skipReason") || ""));
  if (type === "auto-manager-edit") saveAutoManagerDecision(state.modal.demandId, formData, String(formData.get("managerAction") || "SAVE") === "APPROVE");
  if (type === "auto-manager-approval") finalizeAutoManagerApproval(state.modal.demandId);
  if (type === "receive-allocation") receiveAllocation(formData);
  if (type === "receive-purchase") receivePurchase(formData);
  if (type === "create-purchase-order") createPurchaseOrder(formData);
  if (type === "no-group") markNoGroup(formData);
  if (type === "manual-purchase-order") createManualPurchaseOrder(formData);
  if (type === "edit-purchase-order") updatePurchaseOrder(formData);
  if (type === "cancel-purchase-order") cancelPurchaseOrder(formData);
  if (type === "purchase-tracking") savePurchaseTracking(formData);
  if (type === "supplier-terms") saveSupplierTerms(formData);
  if (type === "supplier-schedule") saveSupplierSchedule(formData);
  if (type === "supplier-bank") saveSupplierBank(formData);
  if (type === "product-identifiers") saveProductIdentifiers(formData);
  if (type === "purchase-item-followup") savePurchaseItemFollowup(formData);
  if (type === "purchase-item-shortage") savePurchaseItemShortage(formData);
  if (type === "supplier-return-create") saveSupplierReturnDraft(formData);
  if (type === "supplier-return-edit") saveSupplierReturnDraftEdit(formData);
  if (type === "supplier-return-resolution") saveSupplierReturnResolution(formData);
  if (type === "supplier-replacement") saveSupplierReplacement(formData);
  if (type === "supplier-return-attachment") saveSupplierReturnAttachment(formData);
  if (type === "add-product") addProduct(formData);
  if (type === "edit-product") updateProductMaster(formData);
  if (type === "add-supplier") addSupplier(formData);
  if (type === "edit-supplier") updateSupplierMaster(formData);
  if (type === "add-supplier-product") addSupplierProduct(formData);
  if (type === "edit-supplier-product") updateSupplierProductMaster(formData);
  if (type === "adjust-inventory") adjustInventory(formData);
  if (type === "add-user") addUser(formData);
}

function commitSupplierOperation(result, successMessage) {
  if (!result?.committed) return showToast(result?.error?.message || "供應商營運資料儲存失敗，資料未更新", "error");
  state.data = normalizeData(result.state);
  saveData();
  closeModal();
  showToast(successMessage, "success");
  render();
}

function supplierOperationActor(user, extra = {}) { return { ...extra, actor: { id: user.id, role: user.role, locationId: user.locationId, isActive: user.isActive !== false }, actorId: user.id, actorRole: user.role, changedAt: `${today} 09:00`, createId }; }

function saveSupplierTerms(formData) {
  const user = currentUser();
  if (!canManageSupplierCommercialData(user)) return showToast("目前角色無法更新供應商付款資料", "error");
  const supplierId = String(formData.get("supplierId") || "");
  const terms = updateSupplierCommercialTerms(state.data, supplierOperationActor(user, { supplierId, changes: { paymentMethod: String(formData.get("paymentMethod") || ""), paymentMethodNote: String(formData.get("paymentMethodNote") || "").trim(), paymentTerms: String(formData.get("paymentTerms") || "").trim(), settlementDays: masterFormNumber(formData, "settlementDays"), billingCycle: String(formData.get("billingCycle") || "").trim(), invoiceRequirement: String(formData.get("invoiceRequirement") || "").trim(), currency: String(formData.get("currency") || "TWD").trim(), supplierPublicNote: String(formData.get("supplierPublicNote") || "").trim() } }));
  if (!terms.committed) return showToast(terms.error?.message || "付款條件儲存失敗", "error");
  const relation = upsertSupplierBusinessRelation(terms.state, supplierOperationActor(user, { orderingSupplierId: supplierId, payeeSupplierId: String(formData.get("payeeSupplierId") || "") || null, isDefault: formData.has("isDefaultRelation"), note: String(formData.get("relationNote") || "").trim() }));
  commitSupplierOperation(relation, "供應商付款與訂購／付款對象已更新");
}

function saveSupplierSchedule(formData) {
  const user = currentUser();
  const result = upsertSupplierOrderSchedule(state.data, supplierOperationActor(user, { id: String(formData.get("scheduleId") || "") || undefined, supplierId: String(formData.get("supplierId") || ""), frequencyType: String(formData.get("frequencyType") || "MANUAL"), intervalDays: masterFormNumber(formData, "intervalDays", 1), weekdays: formData.getAll("weekdays").map(Number), dayOfMonth: masterFormNumber(formData, "dayOfMonth"), cutoffTime: String(formData.get("cutoffTime") || "") || null, expectedDeliveryDays: masterFormNumber(formData, "expectedDeliveryDays"), nextOrderDate: String(formData.get("nextOrderDate") || "") || null, nextExpectedDeliveryDate: String(formData.get("nextExpectedDeliveryDate") || "") || null, storeVisibleNote: String(formData.get("storeVisibleNote") || "").trim(), internalNote: String(formData.get("internalNote") || "").trim() }));
  commitSupplierOperation(result, "供應商訂貨週期已更新");
}

function saveSupplierBank(formData) {
  const user = currentUser();
  const supplierId = String(formData.get("supplierId") || "");
  const result = createSupplierBankAccount(state.data, supplierOperationActor(user, { supplierId, bankName: String(formData.get("bankName") || ""), bankCode: String(formData.get("bankCode") || ""), branchName: String(formData.get("branchName") || ""), accountName: String(formData.get("accountName") || ""), accountNumber: String(formData.get("accountNumber") || ""), isPrimary: formData.has("isPrimary") }));
  if (!result.committed) return showToast(result.error?.message || "銀行帳戶新增失敗", "error");
  const file = formData.get("bankProof");
  let nextState = result.state;
  if (file && file.name && file.size) {
    const attachment = uploadSupplierAttachment(nextState, supplierOperationActor(user, { supplierBankAccountId: result.account.id, attachmentType: "BANK_ACCOUNT_PROOF", fileName: file.name, fileType: file.type || "application/octet-stream", fileSize: file.size, storageKey: `private/supplier-bank/${result.account.id}/${createId("proof")}` }));
    if (!attachment.committed) return showToast(attachment.error?.message || "銀行附件 metadata 儲存失敗", "error");
    nextState = attachment.state;
  }
  state.data = normalizeData(nextState); saveData(); closeModal(); showToast("供應商銀行帳戶已新增，敏感資料未公開", "success"); render();
}

function setPrimaryBank(accountId) {
  const user = currentUser();
  const result = switchPrimarySupplierBankAccount(state.data, supplierOperationActor(user, { accountId }));
  commitSupplierOperation(result, "主要銀行帳戶已切換");
}

function verifyBank(accountId) {
  const user = currentUser();
  const result = verifySupplierBankAccount(state.data, supplierOperationActor(user, { accountId, verifiedNote: "已由採購人員核對佐證附件" }));
  commitSupplierOperation(result, "銀行帳戶已標記為已驗證");
}

function disableBank(accountId) {
  const user = currentUser();
  const reason = window.prompt("請輸入停用銀行帳戶原因");
  if (!reason) return;
  const result = disableSupplierBankAccount(state.data, supplierOperationActor(user, { accountId, reason }));
  commitSupplierOperation(result, "銀行帳戶已停用");
}

function saveProductIdentifiers(formData) {
  const user = currentUser();
  if (!canMaintainProductIdentifiers(user)) return showToast("目前角色無法維護商品代碼", "error");
  let nextState = state.data;
  for (const identifierType of SUPPLIER_IDENTIFIER_TYPES) {
    const value = String(formData.get(`identifier_${identifierType}`) || "").trim();
    const existing = nextState.productIdentifiers.find((item) => item.productId === String(formData.get("productId")) && item.identifierType === identifierType && item.isActive !== false);
    if (!value) {
      if (!existing) continue;
      const cleared = upsertProductIdentifier(nextState, supplierOperationActor(user, { id: existing.id, productId: String(formData.get("productId")), identifierType, clear: true }));
      if (!cleared.committed) return showToast(cleared.error?.message || `${identifierType} 清除失敗`, "error");
      nextState = cleared.state;
      continue;
    }
    const result = upsertProductIdentifier(nextState, supplierOperationActor(user, { id: existing?.id, productId: String(formData.get("productId")), identifierType, value, isPrimary: true }));
    if (!result.committed) return showToast(result.error?.message || `${identifierType} 儲存失敗`, "error");
    nextState = result.state;
  }
  state.data = normalizeData(nextState); saveData(); closeModal(); showToast("商品國際／製造商代碼已更新", "success"); render();
}

function savePurchaseItemFollowup(formData) {
  const user = currentUser();
  const result = updatePurchaseOrderItemTracking(state.data, supplierOperationActor(user, { purchaseOrderId: String(formData.get("purchaseOrderId")), purchaseOrderItemId: String(formData.get("purchaseOrderItemId")), followUpStatus: String(formData.get("followUpStatus") || "CONTACTED"), contactDate: String(formData.get("contactDate") || today), nextFollowUpAt: String(formData.get("nextFollowUpAt") || "") || null, revisedExpectedDeliveryDate: String(formData.get("revisedExpectedDeliveryDate") || "") || null, supplierNextAvailableDate: String(formData.get("supplierNextAvailableDate") || "") || null, followUpNote: String(formData.get("followUpNote") || ""), supplierResponseNote: String(formData.get("supplierResponseNote") || ""), storeVisibleNote: String(formData.get("storeVisibleNote") || ""), internalNote: String(formData.get("internalNote") || "") }));
  commitSupplierOperation(result, "採購明細逐品項追蹤已更新");
}

function savePurchaseItemShortage(formData) {
  const user = currentUser();
  const base = { purchaseOrderId: String(formData.get("purchaseOrderId")), purchaseOrderItemId: String(formData.get("purchaseOrderItemId")), shortageQty: masterFormNumber(formData, "shortageQty"), shortageStatus: String(formData.get("shortageStatus") || "PARTIAL_SHORTAGE"), shortageReason: String(formData.get("shortageReason") || ""), shortageNote: String(formData.get("shortageNote") || ""), supplierNextAvailableDate: String(formData.get("supplierNextAvailableDate") || "") || null, storeVisibleShortageNote: String(formData.get("storeVisibleShortageNote") || "") };
  const action = String(formData.get("shortageAction") || "UPDATE");
  if (action === "CANCEL") {
    const cancel = cancelPurchaseOrderItemShortage(state.data, supplierOperationActor(user, { ...base, quantity: base.shortageQty, reason: base.shortageNote }));
    return commitSupplierOperation(cancel, "採購明細缺貨已取消，原始採購單仍保留");
  }
  const update = updatePurchaseOrderItemShortage(state.data, supplierOperationActor(user, base));
  if (!update.committed) return showToast(update.error?.message || "缺貨更新失敗", "error");
  if (["REQUEUE", "NO_GROUP"].includes(action)) {
    const requeue = requeuePurchaseOrderItemShortage(update.state, supplierOperationActor(user, { purchaseOrderId: base.purchaseOrderId, purchaseOrderItemId: base.purchaseOrderItemId, action, reason: base.shortageNote }));
    return commitSupplierOperation(requeue, action === "NO_GROUP" ? "缺貨已標記無成團" : "缺貨已重新納入採購池");
  }
  if (action === "ALTERNATIVE") {
    const alternative = setPurchaseOrderItemAlternative(update.state, supplierOperationActor(user, { ...base, alternativeSupplierId: String(formData.get("alternativeSupplierId") || "") || null, alternativeProductId: String(formData.get("alternativeProductId") || "") || null, note: base.shortageNote }));
    return commitSupplierOperation(alternative, "替代供應來源已記錄，原始缺貨已保留追蹤鏈");
  }
  commitSupplierOperation(update, "採購明細缺貨狀態已更新");
}

function saveSupplierReturnDraft(formData) {
  const user = currentUser();
  const result = createSupplierReturnDraft(state.data, supplierOperationActor(user, { supplierId: String(formData.get("supplierId")), sourceType: String(formData.get("sourceType") || "WAREHOUSE_STOCK"), sourcePurchaseOrderId: String(formData.get("sourcePurchaseOrderId") || "") || null, sourceReceiptId: String(formData.get("sourceReceiptId") || "") || null, expectedResolutionDate: String(formData.get("expectedResolutionDate") || "") || null, returnReason: String(formData.get("returnReason") || ""), warehouseNote: String(formData.get("warehouseNote") || ""), items: [{ productId: String(formData.get("productId")), purchaseOrderItemId: String(formData.get("sourcePurchaseOrderItemId") || "") || null, returnQty: masterFormNumber(formData, "returnQty", 1), batchNumber: String(formData.get("batchNumber") || ""), expiryDate: String(formData.get("expiryDate") || ""), unitPrice: masterFormNumber(formData, "unitPrice"), reasonCode: String(formData.get("reasonCode") || "OTHER") }] }));
  commitSupplierOperation(result, "供應商退貨草稿已建立，尚未異動庫存");
}

function saveSupplierReturnDraftEdit(formData) {
  const user = currentUser();
  const result = updateSupplierReturnDraft(state.data, supplierOperationActor(user, {
    returnOrderId: String(formData.get("returnOrderId") || ""),
    returnOrderItemId: String(formData.get("returnOrderItemId") || ""),
    item: {
      productId: String(formData.get("productId") || ""),
      returnQty: masterFormNumber(formData, "returnQty", 1),
      batchNumber: String(formData.get("batchNumber") || ""),
      expiryDate: String(formData.get("expiryDate") || ""),
      unitPrice: masterFormNumber(formData, "unitPrice"),
      reasonCode: String(formData.get("reasonCode") || "OTHER"),
      note: String(formData.get("note") || "")
    },
    returnReason: String(formData.get("returnReason") || ""),
    warehouseNote: String(formData.get("warehouseNote") || ""),
    expectedResolutionDate: String(formData.get("expectedResolutionDate") || "") || null
  }));
  commitSupplierOperation(result, "供應商退貨草稿已更新");
}

function changeSupplierReturnStatus(returnOrderId, status) {
  const user = currentUser();
  const result = transitionSupplierReturn(state.data, supplierOperationActor(user, { returnOrderId, status }));
  if (!result.committed) return showToast(result.error?.message || "退貨單狀態更新失敗", "error");
  state.data = normalizeData(result.state); saveData(); showToast(`退貨單已更新為 ${status}`, "success"); render();
}

function saveSupplierReturnResolution(formData) {
  const user = currentUser();
  const result = recordSupplierReturnResolution(state.data, supplierOperationActor(user, { returnOrderItemId: String(formData.get("returnOrderItemId")), resolutionType: String(formData.get("resolutionType")), resolutionQty: masterFormNumber(formData, "resolutionQty"), confirmedAmount: String(formData.get("confirmedAmount") || "0"), supplierResponse: String(formData.get("supplierResponse") || "") }));
  commitSupplierOperation(result, "供應商退貨處理結果已記錄");
}

function saveSupplierReplacement(formData) {
  const user = currentUser();
  const result = receiveSupplierReplacement(state.data, supplierOperationActor(user, { returnOrderItemId: String(formData.get("returnOrderItemId")), receivedQty: masterFormNumber(formData, "receivedQty"), replacementProductId: String(formData.get("replacementProductId") || "") || null }));
  commitSupplierOperation(result, "替代品已入總倉庫存，未直接異動門市庫存");
}

function saveSupplierReturnAttachment(formData) {
  const user = currentUser();
  const file = formData.get("returnAttachment");
  if (!file || !file.name || !file.size) return showToast("請選擇退貨附件", "error");
  const result = uploadSupplierAttachment(state.data, supplierOperationActor(user, { returnOrderId: String(formData.get("returnOrderId")), returnOrderItemId: String(formData.get("returnOrderItemId")), attachmentType: String(formData.get("attachmentType") || "OTHER"), fileName: file.name, fileType: file.type || "application/octet-stream", fileSize: file.size, storageKey: `private/supplier-return/${String(formData.get("returnOrderId"))}/${createId("return-proof")}` }));
  commitSupplierOperation(result, "供應商退貨附件 metadata 已儲存");
}

function closeSupplierReturnStatus(returnOrderId) {
  const user = currentUser();
  const result = closeSupplierReturn(state.data, supplierOperationActor(user, { returnOrderId }));
  commitSupplierOperation(result, "供應商退貨已結案");
}

function createDemand(formData) {
  const user = currentUser();
  const demandType = String(formData.get("demandType"));
  if (!user || !["STORE", "ADMIN"].includes(user.role)) return showToast("只有門市人員或管理者可以建立人工需求", "error");
  const lines = collectDemandLines(formData);
  const reasonError = demandLineReasonError(demandType, lines);
  if (reasonError) return showToast(reasonError, "error");
  if (!lines.length) return showToast("至少需要一筆商品明細", "error");
  const demandId = createId("demand");
  const demandNumber = nextNumber("DN");
  const locationId = user.role === "STORE" ? user.locationId : "store01";
  state.data.demands.unshift({ id: demandId, demandNumber, locationId, sourceType: "MANUAL", demandType, requiredDate: String(formData.get("requiredDate")), status: "DRAFT", notes: String(formData.get("notes") || "").trim(), requestedBy: user.id, createdBy: user.id, createdAt: `${today} 09:00`, submittedAt: null, managerApprovedBy: null, managerApprovedAt: null, returnedBy: null, returnedAt: null, returnReason: null, items: lines.map((line) => buildDemandItem(line)) });
  addAudit("建立人工需求草稿", "DEMAND", demandId, `${demandNumber} · ${lines.length} 項商品`);
  saveData();
  closeModal();
  state.view = "demands";
  showToast(`${demandNumber} 已建立草稿`, "success");
  render();
}

function updateDemand(demandId, formData) {
  const demand = getDemand(demandId);
  const user = currentUser();
  const isAuto = demand?.sourceType === "AUTO";
  if (!demand || !(canEditHumanDemand(demand, user) || canEditAutoDemand(demand, user))) return showToast("只有自己門市的草稿或退回需求可以修改", "error");
  const lines = collectDemandLines(formData);
  const demandType = String(formData.get("demandType"));
  const reasonError = demandLineReasonError(demandType, lines);
  if (reasonError) return showToast(reasonError, "error");
  if (!lines.length) return showToast("至少需要一筆商品明細", "error");
  if (isAuto && (lines.length !== demand.items.length || lines.some((line, index) => line.productId !== demand.items[index]?.productId))) return showToast("自動補貨需求需保留原建議商品，只能調整數量、日期、原因與備註", "error");
  if (isAuto && lines.some((line, index) => toNumber(line.requestedQty) !== toNumber(demand.items[index]?.systemSuggestedQty ?? demand.items[index]?.requestedQty) && !line.reason)) return showToast("調整自動補貨數量時必須填寫修改原因", "error");
  demand.demandType = demandType;
  demand.requiredDate = String(formData.get("requiredDate"));
  demand.notes = String(formData.get("notes") || "").trim();
  const previousItems = demand.items;
  demand.items = lines.map((line, index) => {
    const previous = previousItems[index];
    if (!isAuto) return buildDemandItem(line, previous?.id);
    return buildAutoDemandItem({
      ...previous,
      id: previous?.id || createId("ditem"),
      productId: line.productId,
      requestedQty: line.requestedQty,
      storeConfirmedQty: line.requestedQty,
      managerConfirmedQty: null,
      finalRequestedQty: null,
      storeAdjustmentReason: line.requestedQty !== toNumber(previous?.systemSuggestedQty ?? previous?.requestedQty) ? line.reason : previous?.storeAdjustmentReason,
      managerSkipped: false,
      reason: line.reason || previous?.reason || "安全庫存觸發",
      notes: line.notes || previous?.notes || "",
    });
  });
  if (isAuto) {
    demand.items.forEach((item, index) => {
      const previous = previousItems[index];
      if (toNumber(previous?.storeConfirmedQty ?? previous?.requestedQty) === toNumber(item.storeConfirmedQty)) return;
      const suggestion = state.data.replenishmentSuggestions.find((candidate) => candidate.id === item.replenishmentSuggestionId);
      appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: item.replenishmentSuggestionId, demandOrderId: demand.id, demandOrderItemId: item.id, changedBy: user.id, changedAt: `${today} 09:00`, actorType: actorTypeFor(user), changeType: "STORE_QTY_CHANGED", fieldName: "store_confirmed_qty", beforeValue: { value: previous?.storeConfirmedQty ?? previous?.requestedQty ?? 0 }, afterValue: { value: item.storeConfirmedQty }, changeReason: item.storeAdjustmentReason })], suggestion);
      if (suggestion) {
        suggestion.storeConfirmedQty = item.storeConfirmedQty;
        suggestion.confirmedQty = item.storeConfirmedQty;
        suggestion.storeAdjustmentReason = item.storeAdjustmentReason;
      }
    });
  }
  addAudit(isAuto ? "修改自動補貨需求草稿" : "修改人工需求草稿", "DEMAND", demand.id, `${demand.demandNumber} · ${lines.length} 項商品`);
  saveData();
  closeModal();
  showToast(isAuto ? "自動補貨需求草稿已儲存" : "人工需求草稿已儲存", "success");
  render();
}

function submitDemand(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (demand?.sourceType === "AUTO") return submitAutoDemand(demandId);
  if (!demand || !canSubmitHumanDemand(demand, user)) return showToast("只有自己門市的草稿或退回需求可以送店長核單", "error");
  const validation = validateDemandForApproval(demand, demand.locationId);
  if (!validation.valid) return showToast(validation.errors.join(" "), "error");
  applyDemandSnapshots(demand, validation.lines);
  demand.status = "PENDING_MANAGER_APPROVAL";
  demand.returnReason = null;
  addAudit("送店長核單", "DEMAND", demand.id, `${demand.demandNumber} 已送店長審核`);
  saveData();
  showToast("需求已送店長核單", "success");
  closeModal();
  render();
}

function submitAutoDemand(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand || !canSubmitAutoDemand(demand, user)) return showToast("只有同門市門市人員可以送自動補貨需求核單", "error");
  const validation = validateDemandForApproval(demand, demand.locationId);
  if (!validation.valid) return showToast(validation.errors.join(" "), "error");
  const transaction = runTransactionalMutation(state.data, () => {
    applyDemandSnapshots(demand, validation.lines);
    demand.items.forEach((item) => {
      item.storeConfirmedQty = Math.max(0, toNumber(item.requestedQty));
      item.managerConfirmedQty = null;
      item.finalRequestedQty = null;
      item.managerAdjustmentReason = null;
      item.managerSkipped = false;
    });
    demand.status = "PENDING_MANAGER_APPROVAL";
    demand.returnReason = null;
    demand.submittedAt = null;
    demand.managerApprovedBy = null;
    demand.managerApprovedAt = null;
    addAudit("自動補貨送店長核單", "DEMAND", demand.id, `${demand.demandNumber} 已送店長審核`);
  });
  if (!transaction.committed) return showToast("送店長核單失敗，資料已回復", "error");
  saveData();
  showToast("自動補貨需求已送店長核單", "success");
  closeModal();
  render();
}

function approveDemand(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand || !canApproveDemand(demand, user)) return showToast("只有同門市店長或管理者可以核准待核需求", "error");
  const validation = validateDemandForApproval(demand, demand.locationId);
  if (!validation.valid) return showToast(`最新門市需求條件未符合：${validation.errors.join(" ")}`, "error");
  applyDemandSnapshots(demand, validation.lines);
  demand.items.forEach((item) => { item.approvedQty = item.requestedQty; });
  demand.status = "SUBMITTED";
  demand.managerApprovedBy = user.id;
  demand.managerApprovedAt = `${today} 10:00`;
  demand.submittedAt = `${today} 10:00`;
  addAudit("店長核准並送出總倉", "DEMAND", demand.id, `${demand.demandNumber} 已核准，正式送總倉`);
  saveData();
  closeModal();
  showToast("需求已核准並送出總倉", "success");
  render();
}

function returnDemand(demandId, formData) {
  const demand = getDemand(demandId);
  const user = currentUser();
  const reason = String(formData.get("returnReason") || "").trim();
  if (!demand || !canApproveDemand(demand, user)) return showToast("只有同門市店長或管理者可以退回需求", "error");
  if (!reason) return showToast("退回需求必須填寫原因", "error");
  demand.status = "RETURNED";
  demand.returnedBy = user.id;
  demand.returnedAt = `${today} 10:00`;
  demand.returnReason = reason;
  addAudit("店長退回需求", "DEMAND", demand.id, `${demand.demandNumber} · ${reason}`);
  saveData();
  closeModal();
  showToast("需求已退回，建立人可修改後重新送審", "success");
  render();
}

function saveAutoManagerDecision(demandId, formData, approveAfterSave = false) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand || !canManagerReviewAutoDemand(demand, user)) return showToast("只有同門市店長或管理者可以修改自動補貨待核需求", "error");
  const itemIds = formData.getAll("itemId").map(String);
  const managerQtys = formData.getAll("managerQty");
  const reasons = formData.getAll("managerReason");
  const skipIds = new Set(formData.getAll("managerSkip").map(String));
  const decisions = itemIds.map((itemId, index) => ({ itemId, managerQty: Math.max(0, Math.floor(toNumber(managerQtys[index]))), skipped: skipIds.has(itemId), reason: String(reasons[index] || "").trim() }));
  const conditionMap = approveAfterSave ? autoManagerConditionMap(demand, decisions) : {};
  const validation = validateManagerDecisionLines(demand.items, decisions, conditionMap);
  if (!validation.valid) return showToast(validation.errors.join(" "), "error");
  const requiredDate = String(formData.get("requiredDate") || demand.requiredDate);
  const notes = String(formData.get("notes") || "").trim();
  const nextManagerReason = String(formData.get("managerReasonHeader") || "").trim();
  const contentChanged = demand.requiredDate !== requiredDate || (demand.notes || "") !== notes || (demand.managerReason || "") !== nextManagerReason;
  if (contentChanged && !nextManagerReason) return showToast("店長修改交期、備註或主要內容時必須填寫修改原因", "error");
  const transaction = runTransactionalMutation(state.data, () => {
    const firstSuggestionId = demand.items.find((item) => item.replenishmentSuggestionId)?.replenishmentSuggestionId || null;
    const beforeRequiredDate = demand.requiredDate;
    const beforeNotes = demand.notes || "";
    const beforeManagerReason = demand.managerReason || "";
    demand.requiredDate = requiredDate;
    demand.notes = notes;
    demand.managerReason = nextManagerReason || null;
    if (beforeRequiredDate !== requiredDate) appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: firstSuggestionId, demandOrderId: demand.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_REQUIRED_DATE_CHANGED", fieldName: "required_date", beforeValue: { value: beforeRequiredDate }, afterValue: { value: requiredDate } })], null);
    if (beforeNotes !== notes) appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: firstSuggestionId, demandOrderId: demand.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_NOTE_CHANGED", fieldName: "notes", beforeValue: { value: beforeNotes }, afterValue: { value: notes } })], null);
    if (beforeManagerReason !== (demand.managerReason || "")) appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: firstSuggestionId, demandOrderId: demand.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_REASON_CHANGED", fieldName: "manager_reason", beforeValue: { value: beforeManagerReason }, afterValue: { value: demand.managerReason || "" } })], null);
    validation.normalized.forEach((decision) => {
      const item = demand.items.find((candidate) => candidate.id === decision.itemId);
      if (!item) return;
      const beforeQty = toNumber(item.managerConfirmedQty ?? item.storeConfirmedQty ?? item.requestedQty);
      const beforeSkipped = item.managerSkipped === true;
      const beforeReason = item.managerAdjustmentReason || "";
      item.managerSkipped = decision.skipped;
      item.managerConfirmedQty = decision.skipped ? 0 : decision.managerQty;
      item.managerAdjustmentReason = decision.reason || null;
      const suggestion = state.data.replenishmentSuggestions.find((candidate) => candidate.id === item.replenishmentSuggestionId);
      if (suggestion) {
        suggestion.managerConfirmedQty = decision.skipped ? 0 : decision.managerQty;
        suggestion.managerAdjustmentReason = decision.reason || null;
      }
      if (beforeQty !== item.managerConfirmedQty) appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: item.replenishmentSuggestionId, demandOrderId: demand.id, demandOrderItemId: item.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_QTY_CHANGED", fieldName: "manager_confirmed_qty", beforeValue: { value: beforeQty }, afterValue: { value: item.managerConfirmedQty }, changeReason: decision.reason })], suggestion);
      if (!beforeSkipped && decision.skipped) appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: item.replenishmentSuggestionId, demandOrderId: demand.id, demandOrderItemId: item.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_ITEM_SKIPPED", fieldName: "manager_skipped", beforeValue: { value: false }, afterValue: { value: true }, changeReason: decision.reason })], suggestion);
      if (beforeReason !== decision.reason) appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: item.replenishmentSuggestionId, demandOrderId: demand.id, demandOrderItemId: item.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_REASON_CHANGED", fieldName: "manager_adjustment_reason", beforeValue: { value: beforeReason }, afterValue: { value: decision.reason } })], suggestion);
    });
    addAudit("店長修改自動補貨需求", "DEMAND", demand.id, `${demand.demandNumber} · ${validation.normalized.filter((item) => !item.skipped && item.managerQty !== item.storeQty).length} 項數量調整`);
  });
  if (!transaction.committed) return showToast("店長修改失敗，資料已回復", "error");
  saveData();
  closeModal();
  if (approveAfterSave) {
    openModal("auto-manager-approval", { demandId: demand.id });
    return;
  }
  showToast("店長修改已儲存，需求仍待核准", "success");
  render();
}

function finalizeAutoManagerApproval(demandId) {
  const demand = getDemand(demandId);
  const user = currentUser();
  if (!demand || !canManagerReviewAutoDemand(demand, user)) return showToast("只有同門市店長或管理者可以核准自動補貨需求", "error");
  const decisions = autoManagerDecisions(demand);
  const conditionMap = autoManagerConditionMap(demand, decisions);
  const decisionValidation = validateManagerDecisionLines(demand.items, decisions, conditionMap);
  if (!decisionValidation.valid) return showToast(decisionValidation.errors.join(" "), "error");
  const finalDemand = { ...demand, items: demand.items.filter((item) => !item.managerSkipped).map((item) => ({ ...item, requestedQty: toNumber(item.managerConfirmedQty ?? item.storeConfirmedQty ?? item.requestedQty) })) };
  const finalValidation = validateDemandForApproval(finalDemand, demand.locationId);
  if (!finalValidation.valid) return showToast(`最新門市需求條件未符合：${finalValidation.errors.join(" ")}`, "error");
  const transaction = runTransactionalMutation(state.data, () => {
    const finalByItemId = new Map(finalValidation.lines.map((line, index) => [finalDemand.items[index].id, line]));
    const activeItems = [];
    demand.items.forEach((item) => {
      const managerQty = toNumber(item.managerConfirmedQty ?? item.storeConfirmedQty ?? item.requestedQty);
      const suggestion = state.data.replenishmentSuggestions.find((candidate) => candidate.id === item.replenishmentSuggestionId);
      if (item.managerSkipped) {
        if (suggestion) {
          suggestion.managerConfirmedQty = 0;
          suggestion.finalRequestedQty = 0;
        }
        return;
      }
      item.requestedQty = managerQty;
      item.managerConfirmedQty = managerQty;
      item.finalRequestedQty = managerQty;
      item.approvedQty = managerQty;
      item.managerSkipped = false;
      applyDemandSnapshots({ items: [item] }, [finalByItemId.get(item.id)]);
      if (suggestion) {
        suggestion.managerConfirmedQty = managerQty;
        suggestion.finalRequestedQty = managerQty;
        appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: suggestion.id, demandOrderId: demand.id, demandOrderItemId: item.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_APPROVED", fieldName: "final_requested_qty", beforeValue: { value: suggestion.storeConfirmedQty }, afterValue: { value: managerQty }, changeReason: item.managerAdjustmentReason })], suggestion);
      }
      activeItems.push(item);
    });
    demand.items = activeItems;
    demand.status = "SUBMITTED";
    demand.managerApprovedBy = user.id;
    demand.managerApprovedAt = `${today} 10:00`;
    demand.submittedAt = `${today} 10:00`;
    demand.returnReason = null;
    addAudit("店長核准自動補貨並送出總倉", "DEMAND", demand.id, `${demand.demandNumber} · ${activeItems.length} 項 · ${numberLabel(activeItems.reduce((sum, item) => sum + item.finalRequestedQty, 0))} 件`);
  });
  if (!transaction.committed) return showToast("核准失敗，資料已回復", "error");
  saveData();
  closeModal();
  showToast("自動補貨需求已核准並送出總倉", "success");
  render();
}

function returnAutoDemand(demandId, formData) {
  const demand = getDemand(demandId);
  const user = currentUser();
  const reason = String(formData.get("returnReason") || "").trim();
  if (!demand || !canManagerReviewAutoDemand(demand, user)) return showToast("只有同門市店長或管理者可以退回自動補貨需求", "error");
  if (!reason) return showToast("退回需求必須填寫原因", "error");
  const transaction = runTransactionalMutation(state.data, () => {
    demand.status = "RETURNED";
    demand.returnedBy = user.id;
    demand.returnedAt = `${today} 10:00`;
    demand.returnReason = reason;
    demand.managerReason = null;
    demand.managerApprovedBy = null;
    demand.managerApprovedAt = null;
    demand.submittedAt = null;
    demand.items.forEach((item) => {
      const suggestion = state.data.replenishmentSuggestions.find((candidate) => candidate.id === item.replenishmentSuggestionId);
      item.managerConfirmedQty = null;
      item.finalRequestedQty = null;
      item.managerAdjustmentReason = null;
      item.managerSkipped = false;
      if (suggestion) {
        suggestion.managerConfirmedQty = null;
        suggestion.finalRequestedQty = null;
        suggestion.managerAdjustmentReason = null;
        appendReplenishmentChangeLogs([buildChangeLog({ replenishmentSuggestionId: suggestion.id, demandOrderId: demand.id, demandOrderItemId: item.id, changedBy: user.id, changedAt: `${today} 10:00`, actorType: actorTypeFor(user), changeType: "MANAGER_RETURNED", fieldName: "status", beforeValue: { value: "PENDING_MANAGER_APPROVAL" }, afterValue: { value: "RETURNED" }, changeReason: reason })], suggestion);
      }
    });
    addAudit("店長退回自動補貨需求", "DEMAND", demand.id, `${demand.demandNumber} · ${reason}`);
  });
  if (!transaction.committed) return showToast("退回失敗，資料已回復", "error");
  saveData();
  closeModal();
  showToast("自動補貨需求已退回，門市可修改後重新送審", "success");
  render();
}

function deleteDemand(demandId) {
  const demand = getDemand(demandId);
  if (!demand || !canDeleteHumanDemand(demand, currentUser())) return showToast("只有尚未送審的草稿可以刪除", "error");
  if (!window.confirm(`確定刪除 ${demand.demandNumber} 草稿嗎？`)) return;
  state.data.demands = state.data.demands.filter((item) => item.id !== demand.id);
  addAudit("刪除人工需求草稿", "DEMAND", demand.id, demand.demandNumber);
  saveData();
  closeModal();
  showToast("人工需求草稿已刪除", "success");
  render();
}

function runReplenishment(scope) {
  const user = currentUser();
  if (!(["ADMIN", "STORE"].includes(user.role))) return showToast("只有管理者或門市可以執行補貨計算", "error");
  const locationIds = scope === "all" && user.role === "ADMIN" ? state.data.locations.filter((location) => location.type === "STORE").map((location) => location.id) : [user.role === "STORE" ? user.locationId : "store01"];
  const created = [];
  const runId = createId("run");
  locationIds.forEach((locationId) => {
    state.data.settings.filter((setting) => setting.locationId === locationId && setting.automaticReplenishmentEnabled).forEach((setting) => {
      const existingSuggestion = state.data.replenishmentSuggestions.find((item) => item.locationId === locationId && item.productId === setting.productId && ["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED"].includes(item.status));
      const existingAutoDemand = state.data.demands.some((demand) => demand.sourceType === "AUTO" && demand.locationId === locationId && !["COMPLETED", "CANCELLED"].includes(demand.status) && demand.items.some((item) => item.productId === setting.productId && !item.managerSkipped));
      if (existingSuggestion || existingAutoDemand) return;
      const balance = getBalance(locationId, setting.productId) || {};
      const result = calculateReplenishment({
        onHandQty: balance.onHandQty,
        reservedQty: balance.reservedQty,
        allocationInTransitQty: allocationInTransit(locationId, setting.productId),
        purchaseInboundAllocatedQty: purchaseInbound(locationId, setting.productId),
        existingOpenDemandQty: existingOpenDemand(locationId, setting.productId),
        safetyStockQty: setting.safetyStockQty,
        maximumStockQty: setting.maximumStockQty,
        minimumReplenishmentQty: setting.minimumReplenishmentQty,
        storeDistributionMultiple: setting.storeDistributionMultiple,
        automaticReplenishmentEnabled: setting.automaticReplenishmentEnabled,
      });
      if (result.eligible && result.suggestedQty > 0) {
        const calculatedAt = `${today} 09:00`;
        const inventorySnapshot = buildReplenishmentInventorySnapshot({ onHandQty: balance.onHandQty, reservedQty: balance.reservedQty, calculatedAt });
        const salesSnapshot = buildSixMonthSalesSnapshot(calculateSixMonthSales(state.data.monthlyProductSales || [], locationId, setting.productId, today));
        const suggestion = { id: createId("suggestion"), locationId, productId: setting.productId, status: "GENERATED", createdAt: calculatedAt, calculatedAt, runId, replenishmentRunId: runId, ...result, systemSuggestedQty: result.suggestedQty, originalSuggestedQty: result.suggestedQty, storeConfirmedQty: null, managerConfirmedQty: null, finalRequestedQty: null, confirmedQty: null, storeAdjustmentReason: null, managerAdjustmentReason: null, demandId: null, inventoryChanged: false, ...inventorySnapshot, sixMonthSalesSnapshot: salesSnapshot, reason: `低於安全庫存 ${setting.safetyStockQty} 件` };
        state.data.replenishmentSuggestions.unshift(suggestion);
        created.push(suggestion);
      }
    });
  });
  addAudit("執行自動補貨計算", "REPLENISHMENT_RUN", createId("run"), `${locationIds.map(locationName).join("、")} · 產生 ${created.length} 筆建議`);
  saveData();
  state.view = "replenishment";
  showToast(created.length ? `已產生 ${created.length} 筆補貨建議` : "沒有新增建議，既有待確認資料已保留", "success");
  render();
}

function beginSuggestionReview(suggestionId) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === String(suggestionId));
  const user = currentUser();
  if (!suggestion || !canConvertSuggestion(suggestion, user)) return showToast("此建議已處理或目前帳號無權限操作", "error");
  if (suggestion.status === "GENERATED") {
    suggestion.status = "STORE_REVIEWING";
    suggestion.reviewStartedAt = `${today} 09:00`;
    saveData();
  }
  openModal("confirm-suggestion", { suggestionId: suggestion.id });
}

function batchAcceptSuggestions(scope) {
  const user = currentUser();
  if (!(user && ["ADMIN", "STORE"].includes(user.role))) return showToast("只有管理者或門市可以批次接受補貨建議", "error");
  const locationIds = scope === "all" && user.role === "ADMIN"
    ? state.data.locations.filter((location) => location.type === "STORE").map((location) => location.id)
    : [user.role === "STORE" ? user.locationId : "store01"];
  const candidates = state.data.replenishmentSuggestions.filter((suggestion) => locationIds.includes(suggestion.locationId) && ["GENERATED", "STORE_REVIEWING"].includes(suggestion.status) && canStoreReviewSuggestion(suggestion, user));
  if (!candidates.length) return showToast("目前沒有可批次接受的補貨建議", "success");
  const transaction = runTransactionalMutation(state.data, () => {
    candidates.forEach((suggestion) => {
      const review = applyStoreSuggestionReview(suggestion, {
        confirmedQty: suggestion.systemSuggestedQty ?? suggestion.suggestedQty,
        actorId: user.id,
        actorType: actorTypeFor(user),
        changedAt: `${today} 09:00`,
      });
      if (!review.valid) throw new Error(review.errors.join(" "));
      Object.assign(suggestion, review.suggestion);
      appendReplenishmentChangeLogs(review.logs, suggestion);
    });
    addAudit("批次接受自動補貨建議", "REPLENISHMENT_SUGGESTION", candidates[0].id, `${candidates.length} 筆建議已接受`);
  });
  if (!transaction.committed) return showToast("批次接受失敗，資料已回復", "error");
  saveData();
  showToast(`已接受 ${candidates.length} 筆補貨建議，請逐筆建立需求草稿`, "success");
  render();
}

function confirmSuggestion(formData) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === String(formData.get("suggestionId")));
  const user = currentUser();
  if (!suggestion || !canConvertSuggestion(suggestion, user)) return showToast("此建議已處理或目前帳號無權限操作", "error");
  const confirmedQty = Math.max(1, Math.floor(toNumber(formData.get("confirmedQty"))));
  const adjustmentReason = String(formData.get("adjustmentReason") || "").trim();
  const review = applyStoreSuggestionReview(suggestion, { confirmedQty, adjustmentReason, actorId: user.id, actorType: actorTypeFor(user), changedAt: `${today} 09:00` });
  if (!review.valid) return showToast(review.errors.join(" "), "error");
  const action = String(formData.get("suggestionAction") || "CONVERT");
  const requiredDate = String(formData.get("requiredDate") || addDays(today, 3));
  const notes = String(formData.get("notes") || "").trim();
  const transaction = runTransactionalMutation(state.data, () => {
    Object.assign(suggestion, review.suggestion, { requiredDate, notes });
    appendReplenishmentChangeLogs(review.logs, suggestion);
    if (action === "SAVE") return;
    if (state.data.demands.some((demand) => demand.sourceType === "AUTO" && demand.locationId === suggestion.locationId && demand.items.some((item) => item.replenishmentSuggestionId === suggestion.id))) throw new Error("此補貨建議已轉成需求");
    const supplierProduct = getSupplierProduct(suggestion.productId, state.data.products.find((product) => product.id === suggestion.productId)?.supplierId);
    const condition = getStoreOrderCondition(suggestion.locationId, suggestion.productId);
    const demandId = createId("demand");
    const draft = buildAutoDemandDraft({
      id: demandId,
      demandNumber: nextNumber("DN"),
      locationId: suggestion.locationId,
      requiredDate,
      notes: notes || `由自動補貨建議轉入；${suggestion.adjustmentReason}`,
      createdBy: user.id,
      createdAt: `${today} 09:00`,
      item: {
        id: createId("ditem"),
        productId: suggestion.productId,
        requestedQty: review.storeConfirmedQty,
        systemSuggestedQty: review.systemSuggestedQty,
        storeConfirmedQty: review.storeConfirmedQty,
        storeAdjustmentReason: suggestion.storeAdjustmentReason,
        replenishmentSuggestionId: suggestion.id,
        referencePurchasePrice: supplierProduct?.purchasePrice ?? null,
        currentStockSnapshot: suggestion.onHandQtySnapshot,
        onHandQtySnapshot: suggestion.onHandQtySnapshot,
        reservedQtySnapshot: suggestion.reservedQtySnapshot,
        availableQtySnapshot: suggestion.availableQtySnapshot,
        calculatedAt: suggestion.calculatedAt,
        sixMonthSalesTotalSnapshot: suggestion.sixMonthSalesSnapshot?.total ?? null,
        sixMonthAverageSnapshot: suggestion.sixMonthSalesSnapshot?.average ?? null,
        sixMonthSalesMaxSnapshot: suggestion.sixMonthSalesSnapshot?.max ?? null,
        sixMonthSalesMinSnapshot: suggestion.sixMonthSalesSnapshot?.min ?? null,
        minimumQtySnapshot: condition?.minimumQty ?? null,
        minimumAmountSnapshot: condition?.minimumAmount ?? null,
        conditionModeSnapshot: condition?.conditionMode ?? null,
        supplierMinimumQtySnapshot: supplierProduct?.minimumOrderQuantity ?? null,
        supplierMinimumAmountSnapshot: supplierProduct?.minimumOrderAmount ?? null,
        supplierPurchaseMultipleSnapshot: supplierProduct?.purchaseMultiple ?? null,
        reason: suggestion.adjustmentReason || "安全庫存觸發",
      },
    });
    state.data.demands.unshift(draft);
    suggestion.status = "CONVERTED_TO_DEMAND";
    suggestion.demandId = demandId;
    addAudit("門市確認補貨並建立需求草稿", "REPLENISHMENT_SUGGESTION", suggestion.id, `${productName(suggestion.productId)} · ${numberLabel(review.storeConfirmedQty)} 件 · 需求仍待店長核單`);
  });
  if (!transaction.committed) return showToast(transaction.error?.message || "補貨建議處理失敗，資料已回復", "error");
  saveData();
  closeModal();
  state.view = action === "SAVE" ? "replenishment" : "demands";
  showToast(action === "SAVE" ? "門市確認已儲存" : "補貨建議已轉為需求草稿，等待店長核單", "success");
  render();
}

function skipSuggestion(id, reason) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === id);
  const user = currentUser();
  if (!suggestion || !canSkipSuggestion(suggestion, user)) return showToast("此建議已處理或目前帳號無權限操作", "error");
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) return showToast("暫不補貨必須填寫原因", "error");
  const transaction = runTransactionalMutation(state.data, () => {
    const before = suggestion.status;
    suggestion.status = "SKIPPED";
    suggestion.storeConfirmedQty = 0;
    suggestion.confirmedQty = 0;
    suggestion.storeAdjustmentReason = trimmedReason;
    appendReplenishmentChangeLogs([buildChangeLog({ changeType: "STORE_SKIPPED", fieldName: "status", beforeValue: { value: before }, afterValue: { value: "SKIPPED" }, changeReason: trimmedReason, changedBy: user.id, changedAt: `${today} 09:00`, actorType: actorTypeFor(user) })], suggestion);
    addAudit("門市略過補貨建議", "REPLENISHMENT_SUGGESTION", id, `${productName(suggestion.productId)} · ${trimmedReason}`);
  });
  if (!transaction.committed) return showToast("略過補貨建議失敗，資料已回復", "error");
  saveData();
  closeModal();
  showToast("補貨建議已略過", "success");
  render();
}

function createAllocation(demandId, mode) {
  const demand = getDemand(demandId);
  if (!demand || !["ADMIN", "WAREHOUSE"].includes(currentUser().role)) return showToast("目前帳號無法建立配貨單", "error");
  if (!["SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(demand.status)) return showToast("此需求目前不可配貨", "error");
  const lines = [];
  let allocatedAny = false;
  demand.items.forEach((item) => {
    const need = demandOutstanding(item);
    const balance = getBalance("warehouse", item.productId);
    const available = availableInventory(balance);
    const qty = mode === "shortage" ? Math.min(need, available) : Math.min(need, available);
    if (qty > 0) {
      item.allocatedQty += qty;
      item.approvedQty = item.approvedQty || item.requestedQty;
      allocatedAny = true;
      balance.onHandQty -= qty;
      lines.push({ id: createId("aitem"), productId: item.productId, requestedQty: item.requestedQty, allocatedQty: qty, shippedQty: qty, receivedQty: 0 });
    }
    item.purchaseRequiredQty = Math.max(0, item.requestedQty - item.allocatedQty - item.receivedQty);
  });
  const remaining = demand.items.reduce((sum, item) => sum + demandUnallocated(item) + purchaseCoverage(item), 0);
  const shortage = demand.items.reduce((sum, item) => sum + Math.max(0, item.requestedQty - item.allocatedQty - item.receivedQty), 0);
  demand.status = shortage > 0 ? (allocatedAny ? "PARTIALLY_ALLOCATED" : "WAITING_PURCHASE") : "PROCESSING";
  if (allocatedAny) {
    const allocationId = createId("allocation");
    state.data.allocations.unshift({ id: allocationId, allocationNumber: nextNumber("AL"), sourceLocationId: "warehouse", destinationLocationId: demand.locationId, demandOrderId: demand.id, status: "PICKING", shippedAt: null, receivedAt: null, createdBy: currentUser().id, createdAt: `${today} 09:00`, items: lines });
    addAudit("建立配貨單", "ALLOCATION", allocationId, `${demand.demandNumber} · ${lines.reduce((sum, line) => sum + line.allocatedQty, 0)} 件 · 尚缺 ${shortage} 件`);
  } else {
    addAudit("轉入集中採購", "DEMAND", demand.id, `${demand.demandNumber} 無總倉可用庫存，尚缺 ${shortage} 件`);
  }
  saveData();
  closeModal();
  state.view = allocatedAny ? "allocations" : "purchasing";
  showToast(allocatedAny ? `已建立配貨單，${shortage ? `另有 ${shortage} 件進入採購缺口` : "可標記出貨"}` : "已轉入集中採購缺口", "success");
  render();
}

function shipAllocation(allocationId) {
  const allocation = state.data.allocations.find((item) => item.id === allocationId);
  if (!allocation || allocation.status !== "PICKING") return showToast("此配貨單目前不可出貨", "error");
  allocation.status = "SHIPPED";
  allocation.shippedAt = `${today} 16:20`;
  addAudit("配貨出貨", "ALLOCATION", allocation.id, `${allocation.allocationNumber} 已出貨至 ${locationName(allocation.destinationLocationId)}`);
  saveData();
  showToast("配貨單已出貨，等待門市簽收", "success");
  render();
}

function receiveAllocation(formData) {
  const allocation = state.data.allocations.find((item) => item.id === String(formData.get("allocationId")));
  const user = currentUser();
  if (!allocation || allocation.status !== "SHIPPED" || (user.role === "STORE" && allocation.destinationLocationId !== user.locationId)) return showToast("沒有權限或此配貨單不可簽收", "error");
  allocation.items.forEach((line) => {
    const receivedQty = Math.min(line.shippedQty, Math.max(0, toNumber(formData.get(`received_${line.id}`))));
    line.receivedQty = receivedQty;
    const balance = getBalance(allocation.destinationLocationId, line.productId);
    balance.onHandQty += receivedQty;
    const demand = getDemand(allocation.demandOrderId);
    const demandItem = demand?.items.find((item) => item.productId === line.productId);
    if (demandItem) demandItem.receivedQty += receivedQty;
  });
  allocation.status = "RECEIVED";
  allocation.receivedAt = `${today} 17:00`;
  const demand = getDemand(allocation.demandOrderId);
  if (demand) {
    const allComplete = demand.items.every((item) => demandOutstanding(item) === 0);
    const anyGap = demand.items.some((item) => demandOutstanding(item) > 0);
    demand.status = allComplete ? "COMPLETED" : anyGap ? "PARTIALLY_ALLOCATED" : "PROCESSING";
  }
  addAudit("門市簽收", "ALLOCATION", allocation.id, `${allocation.allocationNumber} · ${locationName(allocation.destinationLocationId)} · ${String(formData.get("receiveNotes") || "無差異備註")}`);
  saveData();
  closeModal();
  showToast("簽收完成，門市庫存已更新", "success");
  render();
}

function generatePurchaseSuggestions() {
  const user = currentUser();
  if (!user || !canViewPurchaseOrders(user) || user.role === "STORE") return showToast("目前帳號無法產生採購建議", "error");
  const calculated = aggregatePurchaseSuggestions({
    demands: state.data.demands,
    products: state.data.products,
    suppliers: state.data.suppliers,
    supplierProducts: state.data.supplierProducts,
    demandPurchaseAllocations: state.data.demandPurchaseAllocations,
    warehouseSupplements: state.data.warehousePurchaseSupplements || [],
  });
  const before = state.data.purchaseSuggestions.length;
  state.data.purchaseSuggestions = mergePurchaseSuggestions(state.data.purchaseSuggestions, calculated, { now: `${today} 09:00`, createId });
  const created = Math.max(0, state.data.purchaseSuggestions.length - before);
  addAudit("產生集中採購建議", "PURCHASE_SUGGESTION", createId("run"), `掃描 ${state.data.demands.length} 張需求，彙總 ${calculated.length} 組，新增 ${created} 筆`);
  saveData();
  state.view = "purchasing";
  showToast(calculated.length ? `已完成 ${calculated.length} 組集中採購彙總` : "目前沒有符合條件的待採購需求", "success");
  render();
}

function initializePurchaseOrderPlanning(order, user) {
  const existingPlans = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderId === order.id);
  const plans = buildPurchaseOrderItemDistributionPlans(order, { locations: state.data.locations || [], existingPlans, createdAt: `${today} 09:00`, createdBy: user?.id, createId });
  const result = applyPurchaseOrderDistributionPlans(order, plans, { locations: state.data.locations || [] });
  if (!result.committed) return result;
  state.data.purchaseOrderItemStoreAllocations = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderId !== order.id).concat(result.plans);
  state.data.purchaseOrderItemDistributionPlans = state.data.purchaseOrderItemStoreAllocations;
  state.data.purchaseOrderItemSources = (state.data.purchaseOrderItemSources || []).filter((source) => !result.order.lines.some((line) => line.id === source.purchaseOrderItemId)).concat(buildPurchaseOrderItemSources(result.order, { createdAt: `${today} 09:00`, createdBy: user?.id, createId }));
  return result;
}

function createPurchaseOrder(formData) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有集中採購或管理者可以建立採購單", "error");
  const suggestions = state.data.purchaseSuggestions.filter((suggestion) => formData.get(`suggestion_${suggestion.id}`) === "true" && !suggestion.purchaseOrderId && suggestion.status !== "NO_GROUP");
  if (!suggestions.length) return showToast("請至少勾選一筆尚未轉單的採購建議", "error");
  const supplierId = String(formData.get("supplierId") || suggestions[0].supplierId);
  if (suggestions.some((suggestion) => suggestion.supplierId !== supplierId)) return showToast("不同供應商不得建立在同一張採購單", "error");
  const supplier = state.data.suppliers.find((item) => item.id === supplierId);
  const suggestionInputs = suggestions.map((suggestion) => ({
    ...suggestion,
    confirmedPurchaseQty: Math.max(0, Math.floor(toNumber(formData.get(`confirmedQty_${suggestion.id}`) || suggestion.confirmedPurchaseQty || suggestion.suggestedPurchaseQty))),
    purchasePrice: String(formData.get(`price_${suggestion.id}`) ?? suggestion.purchasePrice ?? 0),
    expectedDeliveryDate: String(formData.get("expectedDeliveryDate") || ""),
  }));
  const manualProductId = String(formData.get("manualProductId") || "").trim();
  const manualSupplierProduct = manualProductId ? getSupplierProduct(manualProductId, supplierId) : null;
  const manualItems = manualProductId ? [{
    productId: manualProductId,
    supplierId,
    manualAddedQty: Math.max(0, Math.floor(toNumber(formData.get("manualAddedQty")))),
    unitPrice: String(toNumber(formData.get("manualUnitPrice")) > 0 ? formData.get("manualUnitPrice") : manualSupplierProduct?.purchasePrice ?? 0),
    manualReasonCode: String(formData.get("manualReasonCode") || "").trim() || null,
    manualAddReason: String(formData.get("manualAddReason") || "").trim(),
    manualReasonDetail: String(formData.get("manualReasonDetail") || "").trim(),
    manualAddedBy: user.id,
    manualAddedAt: `${today} 09:00`,
    expectedDeliveryDate: String(formData.get("expectedDeliveryDate") || ""),
  }] : [];
  const orderId = createId("purchaseOrder");
  let order = buildPurchaseOrderDraft({
    id: orderId,
    purchaseOrderNumber: nextPurchaseOrderNumber(),
    supplierId,
    supplier,
    products: state.data.products,
    supplierProducts: state.data.supplierProducts,
    suppliers: state.data.suppliers,
    suggestions: suggestionInputs,
    manualItems,
    orderDate: String(formData.get("orderDate") || today),
    expectedDeliveryDate: String(formData.get("expectedDeliveryDate") || today),
    createdBy: user.id,
    createdAt: `${today} 09:00`,
    notes: String(formData.get("notes") || "").trim(),
    overrideReason: String(formData.get("overrideReason") || "").trim() || null,
  });
  if (order.validationErrors?.length) return showToast(order.validationErrors.slice(0, 2).join("；"), "error");
  const initialPlans = buildPurchaseOrderItemDistributionPlans(order, { locations: state.data.locations || [], createdAt: `${today} 09:00`, createdBy: user.id, createId });
  const plannedOrder = applyPurchaseOrderDistributionPlans(order, initialPlans, { locations: state.data.locations || [] });
  if (!plannedOrder.committed) return showToast(plannedOrder.errors.slice(0, 2).join("、") || "門市配貨規劃無法建立", "error");
  order = plannedOrder.order;
  state.data.purchaseOrders.unshift(order);
  const supplierSnapshot = snapshotPurchaseOrderSupplierTerms(state.data, supplierOperationActor(user, { purchaseOrderId: order.id, orderingSupplierId: supplierId, payeeSupplierId: String(formData.get("payeeSupplierId") || "") || undefined }));
  if (!supplierSnapshot.committed) {
    state.data.purchaseOrders = state.data.purchaseOrders.filter((candidate) => candidate.id !== order.id);
    return showToast(supplierSnapshot.error?.message || "採購單供應商快照建立失敗", "error");
  }
  state.data = supplierSnapshot.state;
  order = state.data.purchaseOrders.find((candidate) => candidate.id === order.id);
  state.data.demandPurchaseAllocations.push(...buildDemandPurchaseAllocations(order).map((allocation) => ({ ...allocation, id: createId("demandPurchaseAllocation") })));
  state.data.purchaseOrderItemStoreAllocations = (state.data.purchaseOrderItemStoreAllocations || []).concat(plannedOrder.plans);
  state.data.purchaseOrderItemDistributionPlans = state.data.purchaseOrderItemStoreAllocations;
  state.data.purchaseOrderItemSources = (state.data.purchaseOrderItemSources || []).concat(buildPurchaseOrderItemSources(order, { createdAt: `${today} 09:00`, createdBy: user.id, createId }));
  suggestions.forEach((suggestion) => {
    suggestion.status = "DRAFT_PURCHASE_ORDER";
    suggestion.legacyStatus = "DRAFT";
    suggestion.procurementStatus = "ORDER_CREATED";
    suggestion.purchaseOrderId = order.id;
    suggestion.purchaseOrderItemId = order.lines.find((line) => line.sourceSuggestionId === suggestion.id)?.id || null;
    suggestion.confirmedPurchaseQty = suggestionInputs.find((item) => item.id === suggestion.id)?.confirmedPurchaseQty || suggestion.suggestedPurchaseQty;
    suggestion.confirmedBy = user.id;
    suggestion.confirmedAt = `${today} 09:00`;
  });
  syncDemandPurchaseProgress();
  addPurchaseAudit("PURCHASE_ORDER_CREATED_FROM_SUGGESTION", order.id, `建立 ${order.purchaseOrderNumber}，${order.lines.length} 項，來源建議 ${suggestions.length} 筆`);
  saveData();
  closeModal();
  showToast(`${order.purchaseOrderNumber} 已建立草稿，請先完成條件確認`, "success");
  render();
}

function markNoGroup(formData) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有採購人員或管理員可以標記無成團", "error");
  const result = markPurchaseSuggestionNoGroup(state.data, { suggestionIds: String(formData.get("suggestionIds") || ""), supplierId: String(formData.get("supplierId") || ""), reason: String(formData.get("noGroupReason") || ""), note: String(formData.get("noGroupNote") || "").trim(), actorId: user.id, actorRole: user.role, changedAt: `${today} 09:00`, createId });
  if (!result.committed) return showToast(result.error?.message || "無法標記無成團", "error");
  state.data = result.state;
  syncDemandPurchaseProgress();
  saveData();
  closeModal();
  showToast("採購建議已標記為無成團", "success");
  render();
}

function reopenPurchaseSuggestionStatus(suggestionId) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有採購人員或管理員可以重新開啟", "error");
  const result = reopenPurchaseSuggestion(state.data, { suggestionId, actorId: user.id, actorRole: user.role, changedAt: `${today} 09:00`, createId });
  if (!result.committed) return showToast(result.error?.message || "無法重新開啟採購建議", "error");
  state.data = result.state;
  syncDemandPurchaseProgress();
  saveData();
  showToast("採購建議已重新開啟", "success");
  render();
}

function copyPurchaseOrder(orderId) {
  const user = currentUser();
  const source = state.data.purchaseOrders.find((item) => item.id === orderId);
  if (!canManagePurchaseOrders(user) || !source) return showToast("目前帳號無法複製採購單", "error");
  const supplier = state.data.suppliers.find((item) => item.id === source.supplierId);
  const order = createManualPurchaseOrderDraft({
    id: createId("purchaseOrder"),
    purchaseOrderNumber: nextPurchaseOrderNumber(),
    supplierId: source.supplierId,
    supplier,
    products: state.data.products,
    supplierProducts: state.data.supplierProducts,
    items: (source.lines || []).map((line) => ({ productId: line.productId, orderedQty: toNumber(line.orderedQty), unitPrice: String(line.unitPrice ?? line.purchasePrice ?? 0), reason: `複製 ${source.purchaseOrderNumber}，重新確認總倉備貨` })),
    orderDate: today,
    expectedDeliveryDate: source.expectedDeliveryDate && source.expectedDeliveryDate >= today ? source.expectedDeliveryDate : today,
    createdBy: user.id,
    createdAt: `${today} 09:00`,
    notes: `由 ${source.purchaseOrderNumber} 複製；未沿用原需求分配。`,
  });
  order.manualReason = `複製 ${source.purchaseOrderNumber}`;
  const planned = initializePurchaseOrderPlanning(order, user);
  if (!planned.committed) return showToast(planned.errors?.slice(0, 2).join("、") || "門市配貨規劃無法建立", "error");
  Object.assign(order, planned.order);
  state.data.purchaseOrders.unshift(order);
  addPurchaseAudit("PURCHASE_ORDER_COPIED", order.id, `由 ${source.purchaseOrderNumber} 複製為 ${order.purchaseOrderNumber}`);
  saveData();
  showToast(`${order.purchaseOrderNumber} 已建立複製草稿`, "success");
  render();
}

function receivePurchase(formData) {
  const user = currentUser();
  if (!canReceivePurchaseOrders(user)) return showToast("只有總倉或管理者可以登記採購到貨", "error");
  const receivedByLine = {};
  state.data.purchaseOrders.find((item) => item.id === String(formData.get("purchaseOrderId")))?.lines.forEach((line) => { receivedByLine[line.id] = toNumber(formData.get(`received_${line.id}`)); });
  const result = applyPurchaseReceipt(state.data, { orderId: String(formData.get("purchaseOrderId")), receivedByLine, actorId: user.id, actorRole: user.role, receivedAt: String(formData.get("receivedAt") || today), note: String(formData.get("receiveNotes") || "").trim(), auditId: createId("audit") });
  if (!result.committed) return showToast(result.error?.message || "採購到貨失敗，資料已回復", "error");
  state.data = result.state;
  delete state.data.__receiptAt;
  const order = state.data.purchaseOrders.find((item) => item.id === String(formData.get("purchaseOrderId")));
  state.data.purchaseReceiptLogs.unshift({ id: createId("purchaseReceipt"), purchaseOrderId: order?.id, receivedAt: formData.get("receivedAt") || today, receivedBy: user.id, note: String(formData.get("receiveNotes") || "").trim(), lines: receivedByLine });
  syncDemandPurchaseProgress();
  saveData();
  closeModal();
  state.view = "receipts";
  showToast(`已將 ${result.totalReceived} 件採購到貨加入總倉庫存`, "success");
  render();
}

function createManualPurchaseOrder(formData) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有集中採購或管理者可以建立手動採購單", "error");
  const supplierId = String(formData.get("supplierId") || "");
  const productId = String(formData.get("productId") || "");
  const reason = String(formData.get("manualReason") || "").trim();
  const supplierProduct = getSupplierProduct(productId, supplierId);
  if (!supplierId || !productId || !supplierProduct || supplierProduct.isActive === false) return showToast("手動商品必須是此供應商的有效供應品", "error");
  if (!reason) return showToast("手動新增採購單必須填寫原因", "error");
  const supplier = state.data.suppliers.find((item) => item.id === supplierId);
   let order = createManualPurchaseOrderDraft({ id: createId("purchaseOrder"), purchaseOrderNumber: nextPurchaseOrderNumber(), supplierId, supplier, products: state.data.products, supplierProducts: state.data.supplierProducts, items: [{ productId, orderedQty: toNumber(formData.get("orderedQty")), unitPrice: String(formData.get("unitPrice") || supplierProduct.purchasePrice || 0), reason }], orderDate: String(formData.get("orderDate") || today), expectedDeliveryDate: String(formData.get("expectedDeliveryDate") || today), createdBy: user.id, createdAt: `${today} 09:00`, notes: String(formData.get("notes") || "").trim() });
  if (order.validationErrors?.length) return showToast(order.validationErrors.slice(0, 2).join("；"), "error");
  order.manualReason = reason;
  const planned = initializePurchaseOrderPlanning(order, user);
  if (!planned.committed) return showToast(planned.errors?.slice(0, 2).join("、") || "門市配貨規劃無法建立", "error");
  Object.assign(order, planned.order);
  state.data.purchaseOrders.unshift(order);
  const supplierSnapshot = snapshotPurchaseOrderSupplierTerms(state.data, supplierOperationActor(user, { purchaseOrderId: order.id, orderingSupplierId: supplierId, payeeSupplierId: String(formData.get("payeeSupplierId") || "") || undefined }));
  if (!supplierSnapshot.committed) {
    state.data.purchaseOrders = state.data.purchaseOrders.filter((candidate) => candidate.id !== order.id);
    return showToast(supplierSnapshot.error?.message || "採購單供應商快照建立失敗", "error");
  }
  state.data = supplierSnapshot.state;
  order = state.data.purchaseOrders.find((candidate) => candidate.id === order.id);
  addPurchaseAudit("PURCHASE_ORDER_CREATED_MANUAL", order.id, `手動建立 ${order.purchaseOrderNumber}，原因：${reason}`);
  saveData();
  closeModal();
  showToast(`${order.purchaseOrderNumber} 已建立手動草稿`, "success");
  render();
}

function confirmPurchaseOrder(orderId) {
  const user = currentUser();
  const order = state.data.purchaseOrders.find((item) => item.id === orderId);
  if (!canManagePurchaseOrders(user) || !order) return showToast("目前帳號無法確認此採購單", "error");
  const planned = initializePurchaseOrderPlanning(order, user);
  if (!planned.committed) return showToast(planned.errors?.slice(0, 2).join("、") || "門市配貨規劃無法確認", "error");
  Object.assign(order, planned.order);
  const existingSuggestionIds = state.data.purchaseOrders.filter((item) => item.id !== order.id && item.status !== "CANCELLED").flatMap((item) => item.lines.map((line) => line.sourceSuggestionId).filter(Boolean));
  const validation = validatePurchaseOrderConfirmation(order, { suppliers: state.data.suppliers, products: state.data.products, supplierProducts: state.data.supplierProducts, existingSuggestionIds });
  if (!validation.valid) return showToast(validation.errors.slice(0, 2).join("；"), "error");
  Object.assign(order, validation.totals, { totalAmount: validation.totals.totalAmount, subtotalAmount: validation.totals.subtotalAmount, taxAmount: validation.totals.taxAmount, minimumAmountMet: validation.minimumAmountMet, minimumAmountShortfall: centsToDecimal(validation.minimumAmountShortfallCents), overrideReason: validation.overrideReason || null, overriddenBy: validation.overrideRequired ? user.id : null, overriddenAt: validation.overrideRequired ? `${today} 09:00` : null });
  const transition = transitionPurchaseOrder(order, "PENDING_CONFIRMATION", { actorId: user.id, changedAt: `${today} 09:00` });
  if (!transition.valid) return showToast(transition.errors.join("；"), "error");
  Object.assign(order, transition.order);
  state.data.purchaseSuggestions.filter((suggestion) => suggestion.purchaseOrderId === order.id).forEach((suggestion) => { suggestion.status = "GROUPED"; suggestion.procurementStatus = "GROUPED"; });
  syncDemandPurchaseProgress();
  addPurchaseAudit(validation.overrideRequired ? "PURCHASE_ORDER_EXCEPTION_CONFIRMED" : "PURCHASE_ORDER_CONFIRMED", order.id, validation.overrideRequired ? `例外下單：${validation.overrideReason}` : "採購條件檢核通過");
  saveData();
  showToast(`${order.purchaseOrderNumber} 已進入待下單狀態`, "success");
  render();
}

function markPurchaseOrderOrdered(orderId) {
  const user = currentUser();
  const order = state.data.purchaseOrders.find((item) => item.id === orderId);
  if (!canManagePurchaseOrders(user) || !order) return showToast("目前帳號無法標記採購單", "error");
  const transition = transitionPurchaseOrder(order, "ORDERED", { actorId: user.id, changedAt: `${today} 09:00` });
  if (!transition.valid) return showToast(transition.errors.join("；"), "error");
  Object.assign(order, transition.order);
  order.lines.flatMap((line) => line.sourceAllocations || []).forEach((source) => {
    const demand = getDemand(source.demandOrderId);
    if (demand && ["SUBMITTED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(demand.status)) demand.status = "WAITING_PURCHASE";
  });
  state.data.purchaseSuggestions.filter((suggestion) => suggestion.purchaseOrderId === order.id).forEach((suggestion) => { suggestion.status = "ORDERED"; suggestion.procurementStatus = "ORDERED"; suggestion.orderedAt = `${today} 09:00`; });
  syncDemandPurchaseProgress();
  addPurchaseAudit("PURCHASE_ORDER_MARKED_ORDERED", order.id, `${order.purchaseOrderNumber} 已向供應商下單`);
  saveData();
  showToast(`${order.purchaseOrderNumber} 已標記為已下單`, "success");
  render();
}

function updatePurchaseOrder(formData) {
  const user = currentUser();
  let order = state.data.purchaseOrders.find((item) => item.id === String(formData.get("purchaseOrderId")));
  if (!canManagePurchaseOrders(user) || !order || !["DRAFT", "PENDING_CONFIRMATION"].includes(order.status)) return showToast("此採購單目前不可修改", "error");
  const reason = String(formData.get("editReason") || "").trim();
  if (order.status === "PENDING_CONFIRMATION" && !reason) return showToast("待確認採購單修改重要欄位必須填寫原因", "error");
  const before = JSON.parse(JSON.stringify(order));
  const beforeData = JSON.parse(JSON.stringify(state.data));
  const rollbackEdit = () => { state.data = JSON.parse(JSON.stringify(beforeData)); };
  const payeeSupplierId = String(formData.get("payeeSupplierId") || "").trim();
  if (!payeeSupplierId || !state.data.suppliers.some((supplier) => supplier.id === payeeSupplierId && supplier.isActive !== false)) return showToast("付款供應商必須是啟用中的供應商", "error");
  order.expectedDeliveryDate = String(formData.get("expectedDeliveryDate") || order.expectedDeliveryDate);
  order.supplierContactName = String(formData.get("supplierContactName") || "").trim();
  order.supplierContactPhone = String(formData.get("supplierContactPhone") || order.supplierContactPhone || "").trim();
  order.supplierContactEmail = String(formData.get("supplierContactEmail") || order.supplierContactEmail || "").trim();
  order.paymentTerms = String(formData.get("paymentTerms") || order.paymentTerms || "").trim();
  order.notes = String(formData.get("notes") || "").trim();
  const removedLineIds = order.lines.filter((line) => formData.get(`remove_${line.id}`) === "true").map((line) => line.id);
  let nextLines = [];
  for (const line of order.lines) {
    if (removedLineIds.includes(line.id)) continue;
    line.orderedQty = Math.max(0, Math.floor(toNumber(formData.get(`qty_${line.id}`) || line.orderedQty)));
    if (line.orderedQty <= 0) { rollbackEdit(); return showToast("採購數量必須大於 0", "error"); }
    const linkedQty = (state.data.demandPurchaseAllocations || []).filter((allocation) => allocation.purchaseOrderItemId === line.id).reduce((sum, allocation) => sum + Math.max(0, toNumber(allocation.allocatedQty) - toNumber(allocation.cancelledAllocatedQty)), 0);
    if (line.orderedQty < linkedQty) { rollbackEdit(); return showToast(`${productName(line.productId)} 的採購量不可低於既有需求分配 ${linkedQty} 件`, "error"); }
    line.confirmedPurchaseQty = line.orderedQty;
    line.unitPrice = String(formData.get(`price_${line.id}`) ?? line.unitPrice ?? 0);
    line.purchasePrice = line.unitPrice;
    line.giftQty = Math.max(0, Math.floor(toNumber(formData.get(`gift_${line.id}`) ?? line.giftQty)));
    line.remainingQty = Math.max(0, line.orderedQty - toNumber(line.receivedQty) - toNumber(line.cancelledQty));
    const sourceDemandQty = (line.sourceAllocations || []).reduce((sum, source) => sum + toNumber(source.allocatedQty), 0);
    line.warehouseBufferQty = Math.max(0, line.orderedQty - sourceDemandQty);
    const totals = calculatePurchaseOrderTotals([{ orderedQty: line.orderedQty, unitPrice: line.unitPrice }], { taxRateBasisPoints: 0 });
    line.lineSubtotal = totals.subtotalAmount;
    line.lineTotal = totals.totalAmount;
    line.updatedAt = `${today} 09:00`;
    nextLines.push(line);
  }
  const newProductId = String(formData.get("newProductId") || "").trim();
  if (newProductId) {
    const supplierProduct = getSupplierProduct(newProductId, order.supplierId);
    if (!supplierProduct || supplierProduct.isActive === false) { rollbackEdit(); return showToast("新增商品不是此供應商的啟用供應商品", "error"); }
    const newQty = Math.floor(toNumber(formData.get("newQty")));
    const newReason = String(formData.get("newManualReason") || formData.get("newLineNotes") || "").trim();
    const newReasonCode = String(formData.get("newManualReasonCode") || "").trim() || null;
    const newReasonDetail = String(formData.get("newManualReasonDetail") || "").trim();
    const enteredPrice = toNumber(formData.get("newPrice"));
    const newItem = {
      productId: newProductId,
      supplierId: order.supplierId,
      manualAddedQty: newQty,
      unitPrice: enteredPrice > 0 ? String(formData.get("newPrice")) : undefined,
      manualReasonCode: newReasonCode,
      manualAddReason: newReason,
      manualReasonDetail: newReasonDetail,
      manualAddedBy: user.id,
      manualAddedAt: `${today} 09:00`,
      manualNotes: newReasonDetail,
      expectedDeliveryDate: order.expectedDeliveryDate,
    };
    if (newQty <= 0) { rollbackEdit(); return showToast("人工新增數量必須大於 0", "error"); }
    const existingLineIndex = nextLines.findIndex((line) => line.productId === newProductId);
    if (existingLineIndex >= 0) {
      const merged = addManualPurchaseOrderItem(nextLines[existingLineIndex], newItem, { supplierId: order.supplierId, suppliers: state.data.suppliers, products: state.data.products, supplierProducts: state.data.supplierProducts, createdBy: user.id, createdAt: `${today} 09:00` });
      if (!merged.valid) { rollbackEdit(); return showToast(merged.errors.slice(0, 2).join("；"), "error"); }
      merged.line.giftQty = toNumber(merged.line.giftQty) + Math.max(0, Math.floor(toNumber(formData.get("newGiftQty"))));
      nextLines[existingLineIndex] = merged.line;
    } else {
      const draft = mergePurchaseOrderItems({ id: order.id, supplierId: order.supplierId, supplier: state.data.suppliers.find((item) => item.id === order.supplierId), suppliers: state.data.suppliers, products: state.data.products, supplierProducts: state.data.supplierProducts, manualItems: [newItem], createdBy: user.id, createdAt: `${today} 09:00`, expectedDeliveryDate: order.expectedDeliveryDate });
      if (!draft.valid || !draft.lines[0]) { rollbackEdit(); return showToast(draft.errors.slice(0, 2).join("；") || "人工新增品項無效", "error"); }
      const newLine = draft.lines[0];
      newLine.giftQty = Math.max(0, Math.floor(toNumber(formData.get("newGiftQty"))));
      newLine.purchaseOrderId = order.id;
      nextLines.push(newLine);
    }
    if (order.sourceType === "PURCHASE_SUGGESTION") order.sourceType = "MIXED";
  }
  if (!nextLines.length) { rollbackEdit(); return showToast("採購單至少需要一項商品明細", "error"); }
  const candidateOrder = { ...order, lines: nextLines };
  const retainedPlans = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderId === order.id && !removedLineIds.includes(plan.purchaseOrderItemId));
  const candidatePlans = buildPurchaseOrderItemDistributionPlans(candidateOrder, { locations: state.data.locations || [], existingPlans: retainedPlans, createdAt: `${today} 09:00`, createdBy: user.id, createId });
  candidatePlans.forEach((plan) => {
    const planField = formData.get(`distribution_${plan.purchaseOrderItemId}_${plan.destinationLocationId}`);
    const reasonField = formData.get(`distributionReason_${plan.purchaseOrderItemId}_${plan.destinationLocationId}`);
    if (planField !== null && planField !== "") plan.plannedDistributionQty = Math.max(0, Math.floor(toNumber(planField)));
    plan.confirmedAllocationQty = plan.plannedDistributionQty;
    if (reasonField !== null) {
      plan.planningReason = String(reasonField || "").trim();
      plan.allocationReason = plan.planningReason;
    }
  });
  const planned = applyPurchaseOrderDistributionPlans(candidateOrder, candidatePlans, { locations: state.data.locations || [] });
  if (!planned.committed) { rollbackEdit(); return showToast(planned.errors.slice(0, 2).join("、") || "門市配貨規劃不合法", "error"); }
  nextLines = planned.order.lines;
  if (removedLineIds.length) {
    state.data.demandPurchaseAllocations = (state.data.demandPurchaseAllocations || []).filter((allocation) => !removedLineIds.includes(allocation.purchaseOrderItemId));
    state.data.purchaseSuggestions.filter((suggestion) => suggestion.purchaseOrderId === order.id && removedLineIds.includes(suggestion.purchaseOrderItemId)).forEach((suggestion) => {
      suggestion.purchaseOrderId = null;
      suggestion.purchaseOrderItemId = null;
      suggestion.status = "PENDING";
      suggestion.procurementStatus = "WAITING_AGGREGATION";
    });
  }
  order.lines = nextLines;
  state.data.purchaseOrderItemStoreAllocations = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderId !== order.id).concat(planned.plans);
  state.data.purchaseOrderItemDistributionPlans = state.data.purchaseOrderItemStoreAllocations;
  state.data.purchaseOrderItemSources = (state.data.purchaseOrderItemSources || []).filter((source) => !order.lines.some((line) => line.id === source.purchaseOrderItemId)).concat(buildPurchaseOrderItemSources(order, { createdAt: `${today} 09:00`, createdBy: user.id, createId }));
  if (order.sourceType === "MIXED" && !order.lines.some((line) => (line.sourceAllocations || []).length)) order.sourceType = "MANUAL";
  const totals = calculatePurchaseOrderTotals(order.lines, { supplierMinimumOrderAmount: order.supplierMinimumOrderAmount });
  Object.assign(order, totals, { subtotalAmount: totals.subtotalAmount, taxAmount: totals.taxAmount, totalAmount: totals.totalAmount, minimumAmountMet: totals.minimumAmountMet, minimumAmountShortfall: centsToDecimal(totals.minimumAmountShortfallCents), updatedAt: `${today} 09:00` });
  const supplierSnapshot = snapshotPurchaseOrderSupplierTerms(state.data, supplierOperationActor(user, { purchaseOrderId: order.id, orderingSupplierId: order.orderingSupplierId || order.supplierId, payeeSupplierId, changeReason: reason }));
  if (!supplierSnapshot.committed) { rollbackEdit(); return showToast(supplierSnapshot.error?.message || "付款供應商快照更新失敗，資料未異動", "error"); }
  state.data = supplierSnapshot.state;
  order = state.data.purchaseOrders.find((candidate) => candidate.id === order.id);
  syncDemandPurchaseProgress();
  state.data.purchaseOrderChangeLogs.unshift({ id: createId("purchaseOrderChange"), purchaseOrderId: order.id, changedBy: user.id, changedAt: `${today} 09:00`, beforeData: before, afterData: JSON.parse(JSON.stringify(order)), reason });
  addPurchaseAudit("PURCHASE_ORDER_UPDATED", order.id, reason || "更新採購單內容");
  saveData();
  closeModal();
  showToast("採購單修改已儲存", "success");
  render();
}

function cancelPurchaseOrder(formData) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有集中採購或管理者可以取消採購單", "error");
  const result = cancelProcurementOrder(state.data, { orderId: String(formData.get("purchaseOrderId")), remainingOnly: String(formData.get("remainingOnly")) === "true", reason: String(formData.get("cancelReason") || "").trim(), actorId: user.id, cancelledAt: `${today} 09:00` });
  if (!result.committed) return showToast(result.error?.message || "取消失敗，資料未異動", "error");
  state.data = result.state;
  syncDemandPurchaseProgress();
  saveData();
  closeModal();
  showToast("採購單取消資料已更新，未滿足需求已回到採購池", "success");
  render();
}

function closePurchaseOrder(orderId) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有集中採購或管理者可以結案", "error");
  const result = closeProcurementOrder(state.data, { orderId, actorId: user.id, closedAt: `${today} 09:00` });
  if (!result.committed) return showToast(result.error?.message || "此採購單尚未符合結案條件", "error");
  state.data = result.state;
  addPurchaseAudit("PURCHASE_ORDER_CLOSED", orderId, "採購單已結案");
  saveData();
  showToast("採購單已結案", "success");
  render();
}

function savePurchaseTracking(formData) {
  const user = currentUser();
  if (!canManagePurchaseOrders(user)) return showToast("只有集中採購或管理者可以更新未到貨追蹤", "error");
  const order = state.data.purchaseOrders.find((item) => item.id === String(formData.get("purchaseOrderId")));
  if (!order || !["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) return showToast("此採購單目前不在未到貨追蹤範圍", "error");
  order.expectedDeliveryDate = String(formData.get("expectedDeliveryDate") || order.expectedDeliveryDate);
  order.updatedAt = `${today} 09:00`;
  const current = state.data.purchaseTrackingNotes.find((item) => item.purchaseOrderId === order.id);
  const record = { id: current?.id || createId("purchaseTracking"), purchaseOrderId: order.id, supplierId: order.supplierId, contactDate: String(formData.get("contactDate") || today), vendorStatus: String(formData.get("vendorStatus") || "PENDING"), note: String(formData.get("trackingNote") || "").trim(), updatedBy: user.id, updatedAt: `${today} 09:00` };
  if (current) Object.assign(current, record); else state.data.purchaseTrackingNotes.unshift(record);
  addPurchaseAudit("PURCHASE_TRACKING_UPDATED", order.id, `${record.vendorStatus} · ${record.note || "無備註"}`);
  saveData();
  closeModal();
  showToast("未到貨追蹤已更新", "success");
  render();
}

function exportPurchaseCsv() {
  const rows = [["採購單號", "供應商", "狀態", "商品", "訂購數量", "已到貨", "未到貨", "採購金額"]];
  visiblePurchaseOrders().forEach((order) => {
    const metrics = getPurchaseOrderMetrics(order);
    order.lines.forEach((line) => rows.push([order.purchaseOrderNumber, supplierName(order.supplierId), STATUS_LABELS[order.status] || order.status, productName(line.productId), line.orderedQty, line.receivedQty, line.remainingQty, line.lineTotal || order.totalAmount || "0.00"]));
  });
  const csv = `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `purchase-orders-${today}.csv`; link.click(); URL.revokeObjectURL(url);
  showToast("採購單 CSV 已匯出", "success");
}

function printPurchaseOrder(orderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === orderId);
  if (!order) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return showToast("瀏覽器封鎖列印視窗，請允許彈出視窗後重試", "error");
  printWindow.document.write(`<title>${escapeHtml(order.purchaseOrderNumber)}</title><h1>${escapeHtml(order.purchaseOrderNumber)}</h1><p>供應商：${escapeHtml(supplierName(order.supplierId))}　狀態：${escapeHtml(STATUS_LABELS[order.status] || order.status)}</p><table border="1" cellspacing="0" cellpadding="8"><tr><th>商品</th><th>數量</th><th>單價</th><th>小計</th></tr>${order.lines.map((line) => `<tr><td>${escapeHtml(productName(line.productId))}</td><td>${line.orderedQty}</td><td>${escapeHtml(String(line.unitPrice || "0.00"))}</td><td>${escapeHtml(String(line.lineSubtotal || "0.00"))}</td></tr>`).join("")}</table>`);
  printWindow.document.close(); printWindow.focus(); printWindow.print();
}

function masterActorInput(user, extra = {}) {
  return { ...extra, actor: { id: user.id, role: user.role, isActive: user.isActive !== false }, actorId: user.id, actorRole: user.role, changedAt: `${today} 09:00`, createId };
}

function masterFormText(formData, name, fallback = "") {
  const value = formData.get(name);
  return value === null ? fallback : String(value).trim();
}

function masterFormNumber(formData, name, fallback = 0) {
  const value = formData.get(name);
  return value === null || value === "" ? fallback : toNumber(value, fallback);
}

function masterFormBoolean(formData, name, fallback = false) {
  return formData.has(name) ? formData.get(name) === "true" : fallback;
}

function commitMasterMutation(result, successMessage) {
  if (!result?.committed) return showToast(result?.error?.message || "主檔儲存失敗，資料未更新", "error");
  state.data = normalizeData(result.state);
  saveData();
  closeModal();
  showToast(successMessage, "success");
  render();
}

function addProduct(formData) {
  const user = currentUser();
  if (!canCreateProduct(user)) return showToast("只有採購人員、倉管或管理員可以建立商品主檔", "error");
  const purchasingEnabled = ["ADMIN", "PURCHASING"].includes(user.role);
  const supplierId = purchasingEnabled ? masterFormText(formData, "supplierId") : "";
  const basic = {
    productCode: masterFormText(formData, "productCode"),
    barcode: masterFormText(formData, "barcode"),
    name: masterFormText(formData, "name"),
    specification: masterFormText(formData, "specification"),
    category: masterFormText(formData, "category"),
    baseUnit: masterFormText(formData, "baseUnit", "件"),
    isActive: true,
  };
  const full = ["ADMIN", "WAREHOUSE"].includes(user.role);
  const warehouse = full ? {
    casePackQty: masterFormNumber(formData, "casePackQty"),
    storeDistributionUnit: masterFormText(formData, "storeDistributionUnit", basic.baseUnit),
    storeDistributionMultiple: masterFormNumber(formData, "storeDistributionMultiple", 1),
    warehouseLocationCode: masterFormText(formData, "warehouseLocationCode"),
    batchTrackingEnabled: masterFormBoolean(formData, "batchTrackingEnabled"),
    expiryTrackingEnabled: masterFormBoolean(formData, "expiryTrackingEnabled"),
    minimumShelfLifeDays: masterFormNumber(formData, "minimumShelfLifeDays"),
    storageNote: masterFormText(formData, "storageNote"),
  } : {};
  const purchasing = supplierId ? {
    supplierId,
    supplierProductCode: masterFormText(formData, "supplierProductCode"),
    purchaseUnit: masterFormText(formData, "purchaseUnit", basic.baseUnit),
    purchasePrice: masterFormNumber(formData, "purchasePrice"),
    minimumOrderQuantity: masterFormNumber(formData, "minimumOrderQuantity", 1),
    purchaseMultiple: masterFormNumber(formData, "purchaseMultiple", 1),
    minimumOrderAmount: masterFormNumber(formData, "minimumOrderAmount"),
    leadTimeDays: masterFormNumber(formData, "leadTimeDays"),
    isPrimary: masterFormBoolean(formData, "isPrimary", true),
    isActive: masterFormBoolean(formData, "supplierProductIsActive", true),
  } : {};
  const result = createMasterProduct(state.data, masterActorInput(user, { basic, warehouse, purchasing, createId }));
  if (!result.committed) return showToast(result.error?.message || "商品主檔建立失敗，資料未更新", "error");
  state.data = normalizeData(result.state);
  const productId = result.product.id;
  state.data.inventory = state.data.inventory || [];
  state.data.settings = state.data.settings || [];
  if (!state.data.inventory.some((balance) => balance.locationId === "warehouse" && balance.productId === productId)) state.data.inventory.push({ id: createId("balance"), locationId: "warehouse", productId, onHandQty: 0, reservedQty: 0, updatedAt: today });
  (state.data.locations || []).filter((location) => location.type === "STORE").forEach((location) => {
    if (!state.data.inventory.some((balance) => balance.locationId === location.id && balance.productId === productId)) state.data.inventory.push({ id: createId("balance"), locationId: location.id, productId, onHandQty: 0, reservedQty: 0, updatedAt: today });
    if (!state.data.settings.some((setting) => setting.locationId === location.id && setting.productId === productId)) state.data.settings.push({ id: createId("setting"), locationId: location.id, productId, safetyStockQty: 0, maximumStockQty: 0, minimumReplenishmentQty: 1, storeDistributionMultiple: result.product.storeDistributionMultiple || 1, automaticReplenishmentEnabled: false });
  });
  addAudit("建立商品主檔", "PRODUCT", productId, `${result.product.productCode} · ${result.product.name} · ${STATUS_LABELS[result.product.procurementStatus] || result.product.procurementStatus}`);
  saveData();
  closeModal();
  showToast("商品主檔已建立", "success");
  render();
}

function updateProductMaster(formData) {
  const user = currentUser();
  if (!canViewMasterData(user)) return showToast("目前帳號無法修改商品主檔", "error");
  const productId = masterFormText(formData, "productId");
  const product = state.data.products.find((item) => item.id === productId);
  if (!product) return showToast("找不到商品主檔", "error");
  const full = ["ADMIN", "WAREHOUSE"].includes(user.role);
  const basic = full ? {
    productCode: masterFormText(formData, "productCode", product.productCode),
    barcode: masterFormText(formData, "barcode", product.barcode),
    name: masterFormText(formData, "name", product.name),
    specification: masterFormText(formData, "specification", product.specification),
    category: masterFormText(formData, "category", product.category),
    baseUnit: masterFormText(formData, "baseUnit", product.baseUnit),
    isActive: masterFormBoolean(formData, "isActive", product.isActive),
  } : { name: masterFormText(formData, "name", product.name), specification: masterFormText(formData, "specification", product.specification), category: masterFormText(formData, "category", product.category) };
  const warehouse = full ? {
    casePackQty: masterFormNumber(formData, "casePackQty", product.casePackQty),
    storeDistributionUnit: masterFormText(formData, "storeDistributionUnit", product.storeDistributionUnit),
    storeDistributionMultiple: masterFormNumber(formData, "storeDistributionMultiple", product.storeDistributionMultiple),
    warehouseLocationCode: masterFormText(formData, "warehouseLocationCode", product.warehouseLocationCode),
    batchTrackingEnabled: masterFormBoolean(formData, "batchTrackingEnabled", product.batchTrackingEnabled),
    expiryTrackingEnabled: masterFormBoolean(formData, "expiryTrackingEnabled", product.expiryTrackingEnabled),
    minimumShelfLifeDays: masterFormNumber(formData, "minimumShelfLifeDays", product.minimumShelfLifeDays),
    storageNote: masterFormText(formData, "storageNote", product.storageNote),
  } : null;
  const purchasing = ["ADMIN", "PURCHASING"].includes(user.role) ? {} : null;
  if (purchasing) {
    const selectedSupplierId = masterFormText(formData, "defaultSupplierId", product.defaultSupplierId || "");
    if (selectedSupplierId !== (product.defaultSupplierId || "")) {
      purchasing.defaultSupplierId = selectedSupplierId || null;
      purchasing.allowNoPrimary = masterFormBoolean(formData, "allowNoPrimary");
    }
  }
  const result = updateProductMasterData(state.data, masterActorInput(user, {
    productId,
    basic,
    warehouse: warehouse || undefined,
    purchasing: purchasing || undefined,
    expectedVersion: masterFormNumber(formData, "version", product.version),
    expectedUpdatedAt: masterFormText(formData, "updatedAt", product.updatedAt || ""),
  }));
  commitMasterMutation(result, "商品主檔與設定已更新");
}

function addSupplier(formData) {
  const user = currentUser();
  if (!canManageSupplierCommercial(user)) return showToast("只有採購人員或管理員可以建立供應商", "error");
  const commercial = {
    code: masterFormText(formData, "code"), name: masterFormText(formData, "name"), taxId: masterFormText(formData, "taxId"),
    contactName: masterFormText(formData, "contactName"), phone: masterFormText(formData, "phone"), email: masterFormText(formData, "email"), address: masterFormText(formData, "address"),
    leadTimeDays: masterFormNumber(formData, "leadTimeDays"), minimumOrderAmount: masterFormNumber(formData, "minimumOrderAmount"), paymentTerms: masterFormText(formData, "paymentTerms"), isActive: masterFormBoolean(formData, "isActive", true),
  };
  commitMasterMutation(createSupplier(state.data, masterActorInput(user, { commercial })), "供應商主檔已建立");
}

function updateSupplierMaster(formData) {
  const user = currentUser();
  if (!canViewMasterData(user)) return showToast("目前帳號無法修改供應商主檔", "error");
  const supplierId = masterFormText(formData, "supplierId");
  const supplier = state.data.suppliers.find((item) => item.id === supplierId);
  if (!supplier) return showToast("找不到供應商主檔", "error");
  const baseInput = { supplierId, expectedVersion: masterFormNumber(formData, "version", supplier.version), expectedUpdatedAt: masterFormText(formData, "updatedAt", supplier.updatedAt || "") };
  const commercial = canManageSupplierCommercial(user) ? {
    code: masterFormText(formData, "code", supplier.code), name: masterFormText(formData, "name", supplier.name), taxId: masterFormText(formData, "taxId", supplier.taxId), contactName: masterFormText(formData, "contactName", supplier.contactName), phone: masterFormText(formData, "phone", supplier.phone), email: masterFormText(formData, "email", supplier.email), address: masterFormText(formData, "address", supplier.address), leadTimeDays: masterFormNumber(formData, "leadTimeDays", supplier.leadTimeDays), minimumOrderAmount: masterFormNumber(formData, "minimumOrderAmount", supplier.minimumOrderAmount), paymentTerms: masterFormText(formData, "paymentTerms", supplier.paymentTerms), isActive: masterFormBoolean(formData, "isActive", supplier.isActive),
  } : null;
  const receiving = canManageSupplierReceiving(user) ? { deliveryNote: masterFormText(formData, "deliveryNote", supplier.deliveryNote), deliveryTimeNote: masterFormText(formData, "deliveryTimeNote", supplier.deliveryTimeNote), receivingNote: masterFormText(formData, "receivingNote", supplier.receivingNote) } : null;
  let result = { committed: true, state: state.data, supplier };
  if (commercial) result = updateSupplierCommercialData(state.data, masterActorInput(user, { ...baseInput, changes: commercial }));
  if (!result.committed) return commitMasterMutation(result, "");
  if (receiving) result = updateSupplierReceivingNotes(result.state, masterActorInput(user, { ...baseInput, expectedVersion: result.supplier.version, expectedUpdatedAt: result.supplier.updatedAt, changes: receiving }));
  commitMasterMutation(result, "供應商主檔與收貨設定已更新");
}

function addSupplierProduct(formData) {
  const user = currentUser();
  if (!canManageSupplierProducts(user)) return showToast("只有採購人員或管理員可以建立商品供應商設定", "error");
  const changes = {
    supplierProductCode: masterFormText(formData, "supplierProductCode"), purchaseUnit: masterFormText(formData, "purchaseUnit", "件"), purchasePrice: masterFormNumber(formData, "purchasePrice"), minimumOrderQuantity: masterFormNumber(formData, "minimumOrderQuantity", 1), purchaseMultiple: masterFormNumber(formData, "purchaseMultiple", 1), minimumOrderAmount: masterFormNumber(formData, "minimumOrderAmount"), leadTimeDays: masterFormNumber(formData, "leadTimeDays"), isPrimary: masterFormBoolean(formData, "isPrimary"), isActive: masterFormBoolean(formData, "isActive", true),
  };
  commitMasterMutation(createSupplierProduct(state.data, masterActorInput(user, { productId: masterFormText(formData, "productId"), supplierId: masterFormText(formData, "supplierId"), changes })), "商品供應商設定已建立");
}

function updateSupplierProductMaster(formData) {
  const user = currentUser();
  if (!canManageSupplierProducts(user)) return showToast("只有採購人員或管理員可以修改商品供應商設定", "error");
  const relationId = masterFormText(formData, "supplierProductId");
  const relation = state.data.supplierProducts.find((item) => item.id === relationId);
  if (!relation) return showToast("找不到商品供應商設定", "error");
  const changes = {
    supplierProductCode: masterFormText(formData, "supplierProductCode", relation.supplierProductCode), purchaseUnit: masterFormText(formData, "purchaseUnit", relation.purchaseUnit), purchasePrice: masterFormNumber(formData, "purchasePrice", relation.purchasePrice), minimumOrderQuantity: masterFormNumber(formData, "minimumOrderQuantity", relation.minimumOrderQuantity), purchaseMultiple: masterFormNumber(formData, "purchaseMultiple", relation.purchaseMultiple), minimumOrderAmount: masterFormNumber(formData, "minimumOrderAmount", relation.minimumOrderAmount), leadTimeDays: masterFormNumber(formData, "leadTimeDays", relation.leadTimeDays), isPrimary: masterFormBoolean(formData, "isPrimary", relation.isPrimary), isActive: masterFormBoolean(formData, "isActive", relation.isActive),
  };
  const result = updateSupplierProductSettings(state.data, masterActorInput(user, { supplierProductId: relationId, productId: masterFormText(formData, "productId", relation.productId), changes, expectedVersion: masterFormNumber(formData, "version", relation.version), expectedUpdatedAt: masterFormText(formData, "updatedAt", relation.updatedAt || ""), expectedProductVersion: masterFormNumber(formData, "productVersion", state.data.products.find((item) => item.id === relation.productId)?.version || 1), replacementSupplierProductId: masterFormText(formData, "replacementSupplierProductId") || null, allowNoPrimary: masterFormBoolean(formData, "allowNoPrimary") }));
  commitMasterMutation(result, "商品供應商設定已更新");
}

function setPrimarySupplierStatus(productId, supplierProductId) {
  const user = currentUser();
  if (!canManageSupplierProducts(user)) return showToast("只有採購人員或管理員可以切換主要供應商", "error");
  const product = state.data.products.find((item) => item.id === productId);
  const relation = state.data.supplierProducts.find((item) => item.id === supplierProductId && item.productId === productId);
  if (!product || !relation) return showToast("找不到商品供應商設定", "error");
  const result = setPrimarySupplier(state.data, masterActorInput(user, { productId, supplierProductId, expectedVersion: product.version, expectedUpdatedAt: product.updatedAt || "", expectedSupplierProductVersion: relation.version, expectedSupplierProductUpdatedAt: relation.updatedAt || "" }));
  if (result.committed) {
    state.data = normalizeData(result.state);
    saveData();
    showToast("主要供應商已切換", "success");
    render();
  } else showToast(result.error?.message || "主要供應商切換失敗，資料未更新", "error");
}

function adjustInventory(formData) {
  const user = currentUser();
  if (!canAdjustInventory(user)) return showToast("只有倉管或管理員可以調整庫存", "error");
  const locationId = String(formData.get("locationId"));
  const productId = String(formData.get("productId"));
  const balance = getBalance(locationId, productId);
  const before = balance.onHandQty;
  const after = Math.max(0, Math.floor(toNumber(formData.get("onHandQty"))));
  balance.onHandQty = after; balance.updatedAt = today;
  addAudit("人工調整庫存", "INVENTORY", balance.id, `${locationName(locationId)} · ${productName(productId)} · ${before} → ${after} 件 · ${String(formData.get("reason"))}`);
  saveData(); closeModal(); showToast("庫存調整已儲存", "success"); render();
}

async function handleSalesCsvImport(file) {
  if (!file) return;
  if (currentUser()?.role !== "ADMIN") return showToast("只有 ADMIN 可以匯入月銷售資料", "error");
  try {
    const rows = parseCsvRows(await file.text());
    if (rows.length < 2) return showToast("CSV 至少需要標題列與一筆資料", "error");
    const headers = rows[0].map((header) => String(header).replace(/^\uFEFF/, "").trim().toLowerCase());
    const requiredHeaders = ["location_code", "product_code", "sales_year", "sales_month", "sales_qty"];
    const missingHeader = requiredHeaders.find((header) => !headers.includes(header));
    if (missingHeader) return showToast(`CSV 缺少欄位：${missingHeader}`, "error");
    const indexOf = (header) => headers.indexOf(header);
    const imports = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row.some((value) => String(value || "").trim())) continue;
      const locationCode = String(row[indexOf("location_code")] || "").trim().toUpperCase();
      const productCodeValue = String(row[indexOf("product_code")] || "").trim();
      const location = state.data.locations.find((candidate) => candidate.code.toUpperCase() === locationCode && candidate.type === "STORE");
      const product = state.data.products.find((candidate) => candidate.productCode === productCodeValue);
      const year = Math.floor(toNumber(row[indexOf("sales_year")], NaN));
      const month = Math.floor(toNumber(row[indexOf("sales_month")], NaN));
      const salesQty = toNumber(row[indexOf("sales_qty")], NaN);
      if (!location || !product || !Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(salesQty) || salesQty < 0) {
        return showToast(`CSV 第 ${rowIndex + 1} 列資料格式錯誤`, "error");
      }
      imports.push({ locationId: location.id, productId: product.id, salesYear: year, salesMonth: month, salesQty: Math.max(0, salesQty) });
    }
    state.data.monthlyProductSales = state.data.monthlyProductSales || [];
    imports.forEach((record) => {
      const existing = state.data.monthlyProductSales.find((row) => row.locationId === record.locationId && row.productId === record.productId && row.salesYear === record.salesYear && row.salesMonth === record.salesMonth);
      if (existing) {
        Object.assign(existing, record, { updatedAt: `${today} 09:00` });
      } else {
        state.data.monthlyProductSales.push({ id: createId("monthlySales"), ...record, createdAt: `${today} 09:00`, updatedAt: `${today} 09:00` });
      }
    });
    addAudit("匯入月銷售", "MONTHLY_PRODUCT_SALES", createId("salesImport"), `匯入 ${imports.length} 筆，依門市、商品與年月 upsert`);
    saveData();
    const input = document.getElementById("salesCsvInput");
    if (input) input.value = "";
    showToast(`月銷售資料已匯入 ${imports.length} 筆`, "success");
    render();
  } catch (error) {
    console.warn("Unable to import monthly sales CSV", error);
    showToast("CSV 讀取失敗，請確認檔案編碼與欄位格式", "error");
  }
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => String(value || "").trim())) rows.push(row);
  }
  return rows;
}

function addUser(formData) {
  const username = String(formData.get("username") || "").trim();
  if (state.data.users.some((user) => user.username === username)) return showToast("帳號已存在", "error");
  const userId = createId("user");
  const role = String(formData.get("role"));
  const user = { id: userId, username, displayName: String(formData.get("displayName")), role, locationId: String(formData.get("locationId")) || null, isStoreManager: role === "STORE" && formData.get("isStoreManager") === "true", isActive: true, passwordHash: "", passwordChangedAt: null, mustChangePassword: false };
  if (user.role === "STORE" && !user.locationId) return showToast("STORE 使用者必須綁定門市", "error");
  state.data.users.push(user);
  addAudit("建立使用者", "USER", userId, `${user.username} · ${ROLE_LABELS[user.role]} · ${user.locationId ? locationName(user.locationId) : "全域"}`);
  saveData(); closeModal(); showToast("使用者已建立，首次登入前需設定本機示範密碼", "success"); render();
}

function toggleUser(userId) {
  const user = state.data.users.find((item) => item.id === userId);
  if (!user || user.id === currentUser().id) return;
  user.isActive = !user.isActive;
  addAudit(user.isActive ? "啟用使用者" : "停用使用者", "USER", user.id, `${user.displayName} · ${user.username}`);
  saveData(); showToast(user.isActive ? "使用者已啟用" : "使用者已停用", "success"); render();
}

function openModal(type, options = {}) { state.modal = { type, ...options }; render(); }
function closeModal() { state.modal = null; render(); }
function showToast(message, tone = "success") { state.toast = { message, tone }; window.setTimeout(() => { state.toast = null; document.querySelector(".toast")?.remove(); }, 2800); }

function modalTitle(type) { if (type === "no-group") return "標記無成團"; return { "create-demand": "新增人工需求", "edit-demand": "修改需求", "demand-detail": "需求單詳情", "return-demand": "退回需求單", "return-auto-demand": "退回自動補貨需求", "confirm-suggestion": "門市確認補貨建議", "skip-suggestion": "暫不補貨", "auto-manager-edit": "店長修改自動補貨需求", "auto-manager-approval": "自動補貨核准摘要", allocation: "建立總倉配貨單", "receive-allocation": "門市簽收", "receive-purchase": "採購到貨登記", "create-purchase-order": "由採購建議建立草稿", "manual-purchase-order": "手動新增採購單", "purchase-order-detail": "採購單詳情與來源追蹤", "edit-purchase-order": "編輯採購單", "cancel-purchase-order": "取消採購單", "purchase-tracking": "未到貨追蹤", "supplier-terms": "供應商付款與付款對象", "supplier-schedule": "供應商訂貨週期", "supplier-bank": "供應商銀行帳戶與附件", "product-identifiers": "商品國際／製造商代碼", "purchase-item-followup": "採購明細聯繫追蹤", "purchase-item-shortage": "採購明細缺貨處理", "supplier-return-create": "建立供應商退貨草稿", "supplier-return-detail": "供應商退貨處理", "supplier-return-resolution": "登記供應商退貨結果", "supplier-return-attachment": "上傳退貨附件", "supplier-replacement": "登記替代品到貨", "add-product": "新增商品主檔", "edit-product": "商品主檔與設定", "add-supplier": "新增供應商", "edit-supplier": "供應商資料與收貨設定", "add-supplier-product": "新增商品供應商設定", "edit-supplier-product": "編輯商品供應商設定", "adjust-inventory": "人工調整庫存", "add-user": "新增使用者", profile: "個人登入資訊" }[type] || "操作"; }

function currentUser() { return state.data.users.find((user) => user.id === state.session?.userId) || null; }
function canView(view) { const role = currentUser()?.role; return view === "dashboard" || view === "demands" || (view === "replenishment" && ["ADMIN", "STORE"].includes(role)) || (view === "allocations" && ["ADMIN", "WAREHOUSE"].includes(role)) || (view === "purchasing" && ["ADMIN", "PURCHASING", "WAREHOUSE"].includes(role)) || (view === "supplierOperations" && ["ADMIN", "PURCHASING", "WAREHOUSE"].includes(role)) || (view === "receipts" && ["ADMIN", "STORE", "WAREHOUSE", "PURCHASING"].includes(role)) || (view === "masters" && canViewMasterData(currentUser())) || (view === "users" && role === "ADMIN") || (view === "audit" && role === "ADMIN"); }
function visiblePurchaseSuggestions() {
  const user = currentUser();
  const search = String(state.filters.purchaseSearch || "").trim().toLowerCase();
  const sourceLocation = state.filters.purchaseSourceLocation || "ALL";
  const demandNumberSearch = String(state.filters.purchaseDemandNumber || "").trim().toLowerCase();
  return (state.data.purchaseSuggestions || []).filter((suggestion) => {
    if (["EXPIRED", "COMPLETED", "CANCELLED"].includes(suggestion.status)) return false;
    if (user?.role === "STORE" && !(suggestion.sourceLocationIds || []).includes(user.locationId)) return false;
    if (sourceLocation !== "ALL" && !(suggestion.sourceLocationIds || []).includes(sourceLocation)) return false;
    const demandNumbers = (suggestion.sourceAllocations || []).map((source) => source.demandNumber || getDemand(source.demandOrderId)?.demandNumber || source.demandOrderId).join(" ");
    if (demandNumberSearch && !demandNumbers.toLowerCase().includes(demandNumberSearch)) return false;
    const haystack = `${supplierName(suggestion.supplierId)} ${productName(suggestion.productId)} ${(suggestion.sourceLocationIds || []).map(locationName).join(" ")} ${demandNumbers}`.toLowerCase();
    return !search || haystack.includes(search);
  });
}
function visiblePurchaseOrders() {
  const user = currentUser();
  const search = String(state.filters.purchaseSearch || "").trim().toLowerCase();
  const status = state.filters.purchaseStatus || "ALL";
  const overdueOnly = state.filters.purchaseOverdue === "true";
  const partialOnly = state.filters.purchasePartial === "true";
  const exceptionOnly = state.filters.purchaseException === "true";
  const sourceLocation = state.filters.purchaseSourceLocation || "ALL";
  const demandNumberSearch = String(state.filters.purchaseDemandNumber || "").trim().toLowerCase();
  const orderDateFrom = state.filters.purchaseOrderDateFrom || "";
  const orderDateTo = state.filters.purchaseOrderDateTo || "";
  const expectedDateFrom = state.filters.purchaseExpectedDateFrom || "";
  const expectedDateTo = state.filters.purchaseExpectedDateTo || "";
  const filtered = (state.data.purchaseOrders || []).filter((order) => {
    if (status !== "ALL" && order.status !== status) return false;
    const metrics = getPurchaseOrderMetrics(order);
    if (overdueOnly && !(metrics.remainingQty > 0 && order.expectedDeliveryDate && order.expectedDeliveryDate < today)) return false;
    if (partialOnly && order.status !== "PARTIALLY_RECEIVED") return false;
    if (exceptionOnly && !String(order.overrideReason || "").trim()) return false;
    if (orderDateFrom && String(order.orderDate || "") < orderDateFrom) return false;
    if (orderDateTo && String(order.orderDate || "") > orderDateTo) return false;
    if (expectedDateFrom && String(order.expectedDeliveryDate || "") < expectedDateFrom) return false;
    if (expectedDateTo && String(order.expectedDeliveryDate || "") > expectedDateTo) return false;
    if (user?.role === "STORE") {
      const own = order.lines.some((line) => (line.sourceAllocations || []).some((source) => source.locationId === user.locationId));
      if (!own) return false;
    }
    const sources = order.lines.flatMap((line) => line.sourceAllocations || []);
    if (sourceLocation !== "ALL" && !sources.some((source) => source.locationId === sourceLocation)) return false;
    const demandNumbers = sources.map((source) => source.demandNumber || getDemand(source.demandOrderId)?.demandNumber || source.demandOrderId).join(" ");
    if (demandNumberSearch && !demandNumbers.toLowerCase().includes(demandNumberSearch)) return false;
    const sourceText = sources.map((source) => locationName(source.locationId)).join(" ");
    const haystack = `${order.purchaseOrderNumber} ${supplierName(order.supplierId)} ${order.lines.map((line) => productName(line.productId)).join(" ")} ${sourceText} ${demandNumbers}`.toLowerCase();
    return !search || haystack.includes(search);
  });
  const sort = state.filters.purchaseSort || "LATEST";
  return filtered.sort((left, right) => {
    if (sort === "EXPECTED") return String(left.expectedDeliveryDate || "9999-12-31").localeCompare(String(right.expectedDeliveryDate || "9999-12-31"));
    if (sort === "AMOUNT") return toNumber(right.totalAmount) - toNumber(left.totalAmount);
    if (sort === "REMAINING") return getPurchaseOrderMetrics(right).remainingQty - getPurchaseOrderMetrics(left).remainingQty;
    if (sort === "OVERDUE") return purchaseOverdueDays(right) - purchaseOverdueDays(left);
    return String(right.createdAt || right.orderDate || "").localeCompare(String(left.createdAt || left.orderDate || ""));
  });
}
function purchaseOverdueDays(order) {
  if (!order?.expectedDeliveryDate || getPurchaseOrderMetrics(order).remainingQty <= 0 || order.expectedDeliveryDate >= today) return 0;
  return Math.max(0, Math.floor((Date.parse(`${today}T00:00:00`) - Date.parse(`${order.expectedDeliveryDate}T00:00:00`)) / 86400000));
}
function openPurchaseDemandQty() {
  const suggestions = aggregatePurchaseSuggestions({ demands: state.data.demands, products: state.data.products, suppliers: state.data.suppliers, supplierProducts: state.data.supplierProducts, demandPurchaseAllocations: state.data.demandPurchaseAllocations });
  return suggestions.reduce((sum, suggestion) => sum + toNumber(suggestion.demandAllocatedQty), 0);
}
function purchaseSourceProgress(line, demandOrderId, demandOrderItemId) {
  const sources = Array.isArray(line?.sourceAllocations) ? line.sourceAllocations : [];
  let remainingShortage = Math.max(0, toNumber(line?.shortageQty));
  const progress = { openQty: 0, shortageQty: 0, requeuedQty: 0 };
  sources.forEach((source) => {
    const openQty = Math.max(0, toNumber(source.allocatedQty) - toNumber(source.receivedAllocatedQty) - toNumber(source.cancelledAllocatedQty));
    const shortageQty = Math.min(openQty, remainingShortage);
    remainingShortage -= shortageQty;
    if (source.demandOrderId !== demandOrderId || source.demandOrderItemId !== demandOrderItemId) return;
    progress.openQty += openQty;
    progress.shortageQty += shortageQty;
    progress.requeuedQty += Math.max(0, toNumber(source.requeuedQty));
  });
  return progress;
}

function syncDemandPurchaseProgress() {
  state.data.demands.forEach((demand) => demand.items.forEach((item) => {
    const rows = (state.data.demandPurchaseAllocations || []).filter((allocation) => allocation.demandOrderId === demand.id && allocation.demandOrderItemId === item.id);
    const ordered = rows.reduce((sum, allocation) => sum + Math.max(0, toNumber(allocation.allocatedQty) - toNumber(allocation.cancelledAllocatedQty)), 0);
    const received = rows.reduce((sum, allocation) => sum + toNumber(allocation.receivedAllocatedQty), 0);
    item.purchaseOrderedQty = ordered;
    item.purchaseReceivedQty = received;
    const committed = toNumber(item.finalRequestedQty ?? (toNumber(item.approvedQty) > 0 ? item.approvedQty : item.requestedQty));
    item.purchaseRequiredQty = Math.max(0, committed - toNumber(item.allocatedQty) - toNumber(item.receivedQty) - ordered - toNumber(item.cancelledQty));
    const sourceSuggestions = (state.data.purchaseSuggestions || []).filter((suggestion) => (suggestion.sourceAllocations || []).some((source) => source.demandOrderId === demand.id && source.demandOrderItemId === item.id));
    const sourceOrders = (state.data.purchaseOrders || []).filter((order) => (order.lines || []).some((line) => (line.sourceAllocations || []).some((source) => source.demandOrderId === demand.id && source.demandOrderItemId === item.id)));
    const sourceSuggestion = sourceSuggestions[sourceSuggestions.length - 1];
    const sourceOrder = sourceOrders[sourceOrders.length - 1];
    const statusFromOrder = { DRAFT: "DRAFT_PURCHASE_ORDER", PENDING_CONFIRMATION: "GROUPED", ORDERED: "ORDERED", PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED", RECEIVED: "RECEIVED", CLOSED: "RECEIVED", CANCELLED: "CANCELLED" }[sourceOrder?.status];
    item.procurementStatus = sourceSuggestion?.status === "NO_GROUP" ? "NO_GROUP" : statusFromOrder || sourceSuggestion?.procurementStatus || item.procurementStatus || null;
    item.procurementStatusReason = sourceSuggestion?.noGroupReason || item.procurementStatusReason || null;
    item.procurementStatusNote = sourceSuggestion?.noGroupNote || item.procurementStatusNote || null;
    item.procurementStatusUpdatedAt = sourceSuggestion?.noGroupAt || sourceOrder?.updatedAt || item.procurementStatusUpdatedAt || null;
    const sourceLine = sourceOrder?.lines?.find((line) => (line.sourceAllocations || []).some((source) => source.demandOrderId === demand.id && source.demandOrderItemId === item.id));
    if (sourceLine) {
      const sourceProgress = purchaseSourceProgress(sourceLine, demand.id, item.id);
      item.purchaseShortageQty = sourceProgress.shortageQty;
      item.purchaseOpenQty = sourceProgress.openQty;
      item.purchaseRequeuedQty = sourceProgress.requeuedQty;
      item.purchaseLatestExpectedDeliveryDate = sourceLine.revisedExpectedDeliveryDate || sourceOrder.expectedDeliveryDate || null;
      item.purchaseNextAvailableDate = sourceLine.supplierNextAvailableDate || null;
      item.purchaseFollowUpStatus = sourceLine.followUpStatus || null;
      item.purchaseStoreVisibleNote = sourceLine.storeVisibleShortageNote || sourceLine.storeVisibleNote || sourceLine.supplierResponseNote || null;
      if (item.purchaseShortageQty > 0 || item.purchaseRequeuedQty > 0 || ["REQUEUED", "NO_GROUP", "ALTERNATIVE"].includes(sourceLine.shortageRequeueStatus)) {
        item.procurementStatus = sourceLine.shortageRequeueStatus === "NO_GROUP" ? "NO_GROUP" : sourceLine.shortageRequeueStatus === "REQUEUED" ? "REQUEUED" : sourceLine.shortageRequeueStatus === "ALTERNATIVE" ? "ALTERNATIVE_AVAILABLE" : sourceLine.shortageStatus;
        item.procurementStatusReason = sourceLine.shortageReason || item.procurementStatusReason;
        item.procurementStatusNote = item.purchaseStoreVisibleNote || sourceLine.shortageNote || item.procurementStatusNote;
        item.procurementStatusUpdatedAt = sourceLine.shortageConfirmedAt || sourceLine.lastFollowedUpAt || item.procurementStatusUpdatedAt;
      }
    }
  }));
  (state.data.purchaseSuggestions || []).forEach((suggestion) => {
    if (!suggestion.purchaseOrderId) return;
    const order = (state.data.purchaseOrders || []).find((candidate) => candidate.id === suggestion.purchaseOrderId);
    const status = { DRAFT: "DRAFT_PURCHASE_ORDER", PENDING_CONFIRMATION: "GROUPED", ORDERED: "ORDERED", PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED", RECEIVED: "RECEIVED", CLOSED: "RECEIVED", CANCELLED: "CANCELLED" }[order?.status];
    if (status) suggestion.procurementStatus = status;
  });
}
function renderDemandProcurementStatus(demand) {
  const statusItems = (demand.items || []).filter((item) => item.procurementStatus);
  if (!statusItems.length) return "";
  return `<section class="detail-section purchase-progress-section"><div class="section-row"><h3>集中採購狀態</h3><span>僅顯示本門市商品</span></div><div class="purchase-progress-list">${statusItems.map((item) => { const noGroup = item.procurementStatus === "NO_GROUP"; const reason = item.procurementStatusReason ? procurementReasonLabel(item.procurementStatusReason) : "採購流程進行中"; const updatedAt = item.procurementStatusUpdatedAt || "—"; return `<article class="purchase-progress-card ${noGroup ? "no-group-progress" : ""}"><div><strong>${escapeHtml(productName(item.productId))}</strong><small>採購狀態 ${statusChip(item.procurementStatus)}</small></div><div><strong>${escapeHtml(noGroup ? `無成團原因：${reason}` : reason)}</strong><small>${escapeHtml(item.procurementStatusNote || (noGroup ? "本次未建立採購單；採購人員可重新開啟採購。" : "狀態會在採購人員更新後同步"))} · 處理日期 ${escapeHtml(updatedAt)}</small></div></article>`; }).join("")}</div></section>`;
}

function renderDemandPurchaseProgress(demand) {
  const rows = (state.data.demandPurchaseAllocations || []).filter((allocation) => allocation.demandOrderId === demand.id);
  if (!rows.length) return renderDemandProcurementStatus(demand);
  return `<section class="detail-section purchase-progress-section"><div class="section-row"><h3>集中採購進度</h3><span>僅顯示本門市來源</span></div><div class="purchase-progress-list">${rows.map((allocation) => {
    const order = state.data.purchaseOrders.find((item) => item.id === allocation.purchaseOrderId);
    const line = order?.lines.find((item) => item.id === allocation.purchaseOrderItemId);
    if (!line) return "";
    const sourceProgress = purchaseSourceProgress(line, demand.id, allocation.demandOrderItemId);
    const remaining = sourceProgress.openQty;
    const shortageQty = sourceProgress.shortageQty;
    const requeuedQty = sourceProgress.requeuedQty;
    const planned = (state.data.purchaseOrderItemStoreAllocations || []).filter((plan) => plan.purchaseOrderItemId === allocation.purchaseOrderItemId && (plan.destinationLocationId || plan.locationId) === demand.locationId).reduce((sum, plan) => sum + toNumber(plan.plannedDistributionQty ?? plan.confirmedAllocationQty), 0);
    const schedule = getStoreSupplierSchedule(state.data, { supplierId: order.orderingSupplierId || order.supplierId, productId: line.productId });
    const shortage = shortageQty ? ` · 缺貨 ${numberLabel(shortageQty)} 件（${line.shortageStatus || "處理中"}）` : "";
    const requeue = requeuedQty ? ` · 已重新採購 ${numberLabel(requeuedQty)} 件` : "";
    const status = line.shortageRequeueStatus === "NO_GROUP" ? "NO_GROUP" : line.shortageRequeueStatus === "REQUEUED" ? "REQUEUED" : line.shortageRequeueStatus === "ALTERNATIVE" ? "ALTERNATIVE_AVAILABLE" : order.status;
    const statusUpdatedAt = line.shortageConfirmedAt || line.lastFollowedUpAt || order.updatedAt || "—";
    return `<article class="purchase-progress-card"><div><strong>${escapeHtml(order.purchaseOrderNumber || "採購單")}</strong><small>${escapeHtml(productName(line.productId))} · 預計 ${escapeHtml(line.revisedExpectedDeliveryDate || order.expectedDeliveryDate || "—")}</small></div><div><strong>${numberLabel(allocation.allocatedQty)} / ${numberLabel(allocation.receivedAllocatedQty)} / ${numberLabel(remaining)} 件</strong><small>採購分配 / 已到貨 / 尚未到貨 · 預計配貨 ${numberLabel(planned)} 件 · ${STATUS_LABELS[status] || status || "—"}${shortage}${requeue}</small><small>供應商訂貨：${escapeHtml(schedule?.frequencyType || "—")} · 下次訂貨 ${escapeHtml(schedule?.nextOrderDate || "—")} · 下一可供貨日 ${escapeHtml(line.supplierNextAvailableDate || "—")} · 最後更新 ${escapeHtml(statusUpdatedAt)} · ${escapeHtml(line.storeVisibleShortageNote || line.storeVisibleNote || schedule?.storeVisibleNote || "尚無門市提示")}</small></div></article>`;
  }).join("")}</div></section>`;
}
function addPurchaseAudit(action, entityId, detail) { addAudit(action, "PURCHASE_ORDER", entityId, detail); }
function nextPurchaseOrderNumber() {
  const stamp = today.replaceAll("-", "");
  const used = new Set((state.data.purchaseOrders || []).map((order) => order.purchaseOrderNumber));
  let sequence = 1;
  let candidate = `PO-${stamp}-${String(sequence).padStart(4, "0")}`;
  while (used.has(candidate)) { sequence += 1; candidate = `PO-${stamp}-${String(sequence).padStart(4, "0")}`; }
  return candidate;
}
function visibleDemands() {
  const user = currentUser();
  return state.data.demands.filter((demand) => {
    if (user?.role === "STORE" && demand.locationId !== user.locationId) return false;
    if (user?.role === "WAREHOUSE" && demand.sourceType === "AUTO" && !["SUBMITTED", "APPROVED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE", "COMPLETED"].includes(demand.status)) return false;
    return true;
  });
}
function visibleSuggestions() { const user = currentUser(); return state.data.replenishmentSuggestions.filter((item) => user?.role !== "STORE" || item.locationId === user.locationId); }
function visibleAllocations() { const user = currentUser(); return state.data.allocations.filter((item) => user?.role !== "STORE" || item.destinationLocationId === user.locationId); }
function canAccessDemand(demand) {
  const user = currentUser();
  if (!demand || !user) return false;
  if (user.role === "STORE" && demand.locationId !== user.locationId) return false;
  if (user.role === "WAREHOUSE" && demand.sourceType === "AUTO" && !["SUBMITTED", "APPROVED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE", "COMPLETED"].includes(demand.status)) return false;
  return true;
}
function getDemand(id) { return state.data.demands.find((demand) => demand.id === id); }
function demandNumber(id) { return getDemand(id)?.demandNumber || "—"; }
function demandTotals(demand) { return demand.items.reduce((totals, item) => ({ requested: totals.requested + toNumber(item.requestedQty), allocated: totals.allocated + toNumber(item.allocatedQty) + toNumber(item.receivedQty), shortage: totals.shortage + Math.max(0, demandOutstanding(item)) }), { requested: 0, allocated: 0, shortage: 0 }); }
function getBalance(locationId, productId) { let balance = state.data.inventory.find((item) => item.locationId === locationId && item.productId === productId); if (!balance) { balance = { id: createId("balance"), locationId, productId, onHandQty: 0, reservedQty: 0, updatedAt: today }; state.data.inventory.push(balance); } return balance; }
function getSetting(locationId, productId) { return state.data.settings.find((item) => item.locationId === locationId && item.productId === productId) || { safetyStockQty: 0, maximumStockQty: 0, minimumReplenishmentQty: 1, storeDistributionMultiple: 1, automaticReplenishmentEnabled: false }; }
function getSupplierProduct(productId, supplierId) { return state.data.supplierProducts.find((item) => item.productId === productId && item.supplierId === supplierId); }
function productName(id) { return state.data.products.find((product) => product.id === id)?.name || "未知商品"; }
function productCode(id) { return state.data.products.find((product) => product.id === id)?.productCode || "—"; }
function supplierName(id) { return state.data.suppliers.find((supplier) => supplier.id === id)?.name || "未指定供應商"; }
function supplierLeadTime(id) { return state.data.suppliers.find((supplier) => supplier.id === id)?.leadTimeDays || 0; }
function locationName(id) { return state.data.locations.find((location) => location.id === id)?.name || "未指定單位"; }
function userName(id) { return state.data.users.find((user) => user.id === id)?.displayName || "系統"; }
function demandTypeLabel(type) { return { GENERAL: "一般需求", URGENT: "急件", CUSTOMER_ORDER: "客訂", PROMOTION: "活動備貨", NEW_PRODUCT: "新品", OTHER: "其他" }[type] || type; }
const PROCUREMENT_REASON_LABELS = {
  MINIMUM_QUANTITY_NOT_MET: "未達供應商最低採購量",
  PURCHASE_MULTIPLE_NOT_MET: "不符合採購倍數",
  SUPPLIER_MINIMUM_AMOUNT_NOT_MET: "未達供應商最低採購金額",
  SUPPLIER_OUT_OF_STOCK: "供應商目前缺貨",
  SUPPLIER_DISCONTINUED: "供應商停止供貨",
  PRICE_NOT_ACCEPTED: "採購價格未接受",
  PRODUCT_DISCONTINUED: "商品已停售",
  REQUEUED: "已重新納入採購池",
  ALTERNATIVE_AVAILABLE: "已有替代供應來源",
  OTHER: "其他原因",
};
function procurementReasonLabel(reason) { return PROCUREMENT_REASON_LABELS[reason] || reason || "未提供原因"; }
function statusChip(status) { return `<span class="status-chip ${String(status).toLowerCase()}">${STATUS_LABELS[status] || status}</span>`; }
function emptyRow(colspan, text) { return `<tr><td colspan="${colspan}">${emptyState(text, "")}</td></tr>`; }
function emptyState(title, detail) { return `<div class="empty-state"><span>◌</span><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
function renderToast() { return `<div class="toast ${state.toast.tone}"><span>${state.toast.tone === "error" ? "!" : "✓"}</span>${escapeHtml(state.toast.message)}</div>`; }
function addAudit(action, entityType, entityId, detail) { state.data.auditLogs.unshift({ id: createId("audit"), createdAt: `${today} 09:00`, userId: currentUser()?.id || "system", action, entityType, entityId, detail }); }
function appendReplenishmentChangeLogs(logs = [], suggestion = null) {
  state.data.replenishmentChangeLogs = state.data.replenishmentChangeLogs || [];
  logs.filter(Boolean).forEach((log) => state.data.replenishmentChangeLogs.unshift({ ...log, id: log.id || createId("replenishmentLog"), replenishmentSuggestionId: log.replenishmentSuggestionId || suggestion?.id || null, changedAt: log.changedAt || `${today} 09:00` }));
}
function snapshotCalculatedAt(snapshot = {}) { return snapshot.calculatedAt || "未記錄"; }
function supplierWarningsForDemand(demand, decisions = autoManagerDecisions(demand)) {
  const decisionMap = new Map(decisions.map((decision) => [decision.itemId, decision]));
  const previews = demand.items.filter((item) => !decisionMap.get(item.id)?.skipped).map((item) => {
    const decision = decisionMap.get(item.id) || {};
    return demandLinePreview({ ...item, requestedQty: decision.managerQty ?? item.requestedQty }, demand.locationId, { useSnapshots: false });
  });
  return summarizeSupplierDemand(previews).map((summary) => {
    const representative = previews.find((line) => line.supplierId === summary.supplierId) || {};
    return { supplierId: summary.supplierId, supplierName: supplierName(summary.supplierId), requestedQty: summary.requestedQty, amount: summary.amount, minimumQty: representative.supplierMinimumQty || 0, minimumAmount: representative.supplierMinimumAmount || 0, purchaseMultiple: representative.supplierPurchaseMultiple || 1, message: supplierWarningMessage(summary, representative.supplierMinimumQty || 0, representative.supplierMinimumAmount || 0, representative.supplierPurchaseMultiple || 1) };
  });
}
function renderSupplierWarningSummaryHtml(warnings = []) { return warnings.length ? `<div class="supplier-summary-heading"><strong>供應商條件提示</strong><small>只提示，不阻擋店長核准；數量已依供應商彙總。</small></div><div class="supplier-summary-list">${warnings.map((warning) => `<div class="supplier-summary-row"><div><strong>${escapeHtml(warning.supplierName)}</strong><small>${numberLabel(warning.requestedQty)} 件 · ${formatMoney(warning.amount)} 元</small></div><span>ⓘ ${escapeHtml(warning.message)}</span></div>`).join("")}</div>` : `<div class="supplier-summary-empty">沒有可彙總的供應商品項。</div>`; }
function nextNumber(prefix) { const stamp = today.replaceAll("-", "").slice(2); const count = prefix === "DN" ? state.data.demands.length + 1 : prefix === "AL" ? state.data.allocations.length + 1 : state.data.purchaseOrders.length + 1; return `${prefix}-${stamp}-${String(count).padStart(3, "0")}`; }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00+08:00`); date.setDate(date.getDate() + toNumber(days)); return date.toISOString().slice(0, 10); }
function allocationInTransit(locationId, productId) { return state.data.allocations.filter((item) => item.destinationLocationId === locationId && ["PICKING", "SHIPPED"].includes(item.status)).reduce((sum, allocation) => sum + allocation.items.filter((line) => line.productId === productId).reduce((lineSum, line) => lineSum + Math.max(0, line.shippedQty - line.receivedQty), 0), 0); }
function purchaseInbound(locationId, productId) { return 0; }
function existingOpenDemand(locationId, productId) { return state.data.demands.filter((demand) => demand.locationId === locationId && isReplenishmentOpenDemandStatus(demand.status)).reduce((sum, demand) => sum + demand.items.filter((item) => item.productId === productId).reduce((itemSum, item) => itemSum + openDemandRemainingQty(demand.status, item), 0), 0); }
function demandCount() { return visibleDemands().filter((item) => isOpenDemandStatus(item.status)).length; }
function pendingSuggestionCount() { return visibleSuggestions().filter((item) => ["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED"].includes(item.status)).length; }
function allocationCount() { return state.data.allocations.filter((item) => item.status === "PICKING").length; }
function purchaseGapCount() { const seen = new Set(); state.data.demands.forEach((demand) => demand.items.forEach((item) => { if (purchaseCoverage(item) > 0) seen.add(item.productId); })); return seen.size; }
function receiptCount() { return visibleAllocations().filter((item) => item.status === "SHIPPED").length; }
function supplierReturnCount() { return (state.data.supplierReturns || []).filter((item) => !["RESOLVED", "CANCELLED"].includes(item.status)).length; }
function pendingPurchaseQty() { return state.data.purchaseOrders.filter((order) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)).reduce((sum, order) => sum + getPurchaseOrderMetrics(order).remainingQty, 0); }
function receivedPurchaseQty() { return state.data.purchaseOrders.reduce((sum, order) => sum + getPurchaseOrderMetrics(order).receivedQty, 0); }
function totalWarehouseAvailable() { return state.data.inventory.filter((item) => item.locationId === "warehouse").reduce((sum, item) => sum + availableInventory(item), 0); }
function warehouseSkuCount() { return state.data.inventory.filter((item) => item.locationId === "warehouse" && availableInventory(item) > 0).length; }
function buildAttentionItems(user) { const items = []; if (user.role === "STORE") { if (pendingSuggestionCount()) items.push({ icon: "↻", title: `${pendingSuggestionCount()} 筆自動補貨建議待確認`, detail: "確認後才會轉成正式需求", view: "replenishment", tone: "violet" }); if (receiptCount()) items.push({ icon: "✓", title: `${receiptCount()} 張配貨單待簽收`, detail: "簽收後會增加門市庫存", view: "receipts", tone: "amber" }); } else if (user.role === "WAREHOUSE") { const queue = state.data.demands.filter((item) => ["SUBMITTED", "APPROVED"].includes(item.status)).length; if (queue) items.push({ icon: "⇥", title: `${queue} 張需求等待配貨`, detail: "依總倉可用量建立配貨單", view: "allocations", tone: "blue" }); if (purchaseGapCount()) items.push({ icon: "◫", title: `${purchaseGapCount()} 項缺口待採購`, detail: "已配不足的數量會保留追蹤", view: "purchasing", tone: "red" }); } else if (user.role === "PURCHASING") { if (purchaseGapCount()) items.push({ icon: "◫", title: `${purchaseGapCount()} 項商品待建立採購單`, detail: "依供應商 MOQ 與倍數處理", view: "purchasing", tone: "red" }); if (pendingPurchaseQty()) items.push({ icon: "↓", title: `${numberLabel(pendingPurchaseQty())} 件採購品項未到貨`, detail: "可登記部分到貨", view: "receipts", tone: "amber" }); } else { if (demandCount()) items.push({ icon: "▤", title: `${demandCount()} 張需求尚未結案`, detail: "跨門市需求池等待處理", view: "demands", tone: "blue" }); if (purchaseGapCount()) items.push({ icon: "◫", title: `${purchaseGapCount()} 項採購缺口`, detail: "查看跨門市缺口彙總", view: "purchasing", tone: "red" }); } return items.slice(0, 4); }
function workflowProgress() { const total = state.data.demands.length || 1; const completed = state.data.demands.filter((item) => item.status === "COMPLETED").length; return Math.round((completed / total) * 100); }
