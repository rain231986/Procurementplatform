/*
 * One vocabulary for workflow data shown to operators.
 *
 * Codes remain stable for integrations and database records; pages, exports
 * and validation messages use these dictionaries so an English code cannot
 * accidentally leak into an operator-facing screen.
 */

export const DELIVERY_MODE_LABELS = Object.freeze({
  SUPPLIER_DIRECT_TO_STORE: "廠商直送門市",
  WAREHOUSE_DISTRIBUTION: "總倉配貨",
  MIXED: "混合配送",
});

export const RECEIVING_STATUS_LABELS = Object.freeze({
  WAITING_SUPPLIER_SHIPMENT: "等待廠商出貨",
  WAITING_WAREHOUSE_RECEIPT: "等待總倉收貨",
  WAITING_STORE_DIRECT_RECEIPT: "等待門市直送簽收",
  WAREHOUSE_RECEIVED: "總倉已收貨",
  WAITING_WAREHOUSE_ALLOCATION: "等待總倉配貨",
  WAREHOUSE_SHIPPED: "總倉已出貨",
  PARTIALLY_RECEIVED: "部分簽收",
  RECEIVED: "已簽收",
  SHORT_RECEIVED: "短收",
  REJECTED: "拒收",
  CANCELLED: "已取消",
});

export const FOLLOW_UP_STATUS_LABELS = Object.freeze({
  NOT_DUE: "尚未到期",
  DUE_TODAY: "今日應追蹤",
  OVERDUE: "逾期未回覆",
  SUPPLIER_CONTACTED: "已聯繫供應商",
  WAITING_SUPPLIER_REPLY: "等待供應商回覆",
  DELIVERY_RESCHEDULED: "已改期到貨",
  PARTIALLY_RECEIVED: "部分到貨",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  // Legacy Phase 1 values remain accepted and are mapped to the new labels.
  PENDING: "尚未到期",
  CONTACTED: "已聯繫供應商",
  CONFIRMED: "已確認到貨日",
  DELAYED: "已改期到貨",
  PARTIAL: "部分到貨",
  SHORTAGE: "缺貨待處理",
  RESOLVED: "已完成",
});

export const FOLLOW_UP_STATUS_CODES = Object.freeze([
  "NOT_DUE",
  "DUE_TODAY",
  "OVERDUE",
  "SUPPLIER_CONTACTED",
  "WAITING_SUPPLIER_REPLY",
  "DELIVERY_RESCHEDULED",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED",
]);

export const SHORTAGE_STATUS_LABELS = Object.freeze({
  PENDING_CONFIRMATION: "等待確認",
  PARTIAL_SHORTAGE: "部分缺貨",
  FULL_SHORTAGE: "全部缺貨",
  TEMPORARY_OUT_OF_STOCK: "暫時缺貨",
  LONG_TERM_OUT_OF_STOCK: "長期缺貨",
  BACKORDERED: "廠商欠貨",
  ALTERNATIVE_AVAILABLE: "可提供替代商品",
  DISCONTINUED: "停止供應",
  RESOLVED: "已解決",
  CANCELLED: "已取消",
  NONE: "無缺貨",
});

export const SHORTAGE_REASON_LABELS = Object.freeze({
  SUPPLIER_NO_STOCK: "廠商無庫存",
  PRODUCTION_DELAY: "生產延遲",
  IMPORT_DELAY: "進口延遲",
  LOGISTICS_DELAY: "物流延遲",
  ALLOCATION_LIMIT: "廠商限量供應",
  PRODUCT_DISCONTINUED: "商品停止供應",
  ORDER_QUANTITY_NOT_MET: "未達廠商接單數量",
  PRICE_NOT_CONFIRMED: "價格尚未確認",
  UNKNOWN: "原因待確認",
  OTHER: "其他",
});

export const WORKFLOW_STATUS_LABELS = Object.freeze({
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
  PENDING: "待確認",
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
  BACKORDERED: "待補貨",
  RESOLVED: "已解決",
  NONE: "無缺貨",
  PENDING_PURCHASE_SETUP: "待完成採購設定",
  PURCHASABLE: "可採購",
  INACTIVE: "已停用",
  ...RECEIVING_STATUS_LABELS,
  ...FOLLOW_UP_STATUS_LABELS,
  ...SHORTAGE_STATUS_LABELS,
});

export function statusLabel(code, domain = "workflow") {
  const dictionaries = {
    delivery: DELIVERY_MODE_LABELS,
    receiving: RECEIVING_STATUS_LABELS,
    followUp: FOLLOW_UP_STATUS_LABELS,
    shortage: SHORTAGE_STATUS_LABELS,
    workflow: WORKFLOW_STATUS_LABELS,
  };
  return dictionaries[domain]?.[code] || WORKFLOW_STATUS_LABELS[code] || code || "—";
}

export function deliveryModeLabel(code) {
  return statusLabel(code, "delivery");
}

export function buildStatusOptions(codes, domain = "workflow", selected = "") {
  return codes.map((code) => `<option value="${code}" ${code === selected ? "selected" : ""}>${statusLabel(code, domain)}</option>`).join("");
}
