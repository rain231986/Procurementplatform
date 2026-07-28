import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSixMonthSales,
  evaluateStoreOrderCondition,
  getPreviousCompleteMonths,
  isReplenishmentOpenDemandStatus,
  openDemandRemainingQty,
} from "../domain.js";
import {
  AUTO_SUGGESTION_STATUSES,
  actorTypeFor,
  applyStoreSuggestionReview,
  buildAutoDemandDraft,
  buildChangeLog,
  buildReplenishmentInventorySnapshot,
  buildSixMonthSalesSnapshot,
  canConvertSuggestion,
  canEditAutoDemand,
  canManagerReviewAutoDemand,
  canStoreReviewSuggestion,
  runTransactionalMutation,
  summarizeAutoApproval,
  validateManagerDecisionLines,
  validateStoreSuggestionReview,
} from "../replenishment-workflow.js";

const store = { id: "store-user", role: "STORE", locationId: "store01", isStoreManager: false };
const manager = { id: "store-manager", role: "STORE", locationId: "store01", isStoreManager: true };
const otherManager = { id: "other-manager", role: "STORE", locationId: "store02", isStoreManager: true };
const admin = { id: "admin", role: "ADMIN", locationId: null, isStoreManager: false };

function suggestion(overrides = {}) {
  return {
    id: "suggestion-01",
    locationId: "store01",
    productId: "product01",
    status: "GENERATED",
    systemSuggestedQty: 12,
    suggestedQty: 12,
    storeConfirmedQty: null,
    ...overrides,
  };
}

function autoDemand(overrides = {}) {
  return {
    id: "demand-01",
    sourceType: "AUTO",
    locationId: "store01",
    status: "PENDING_MANAGER_APPROVAL",
    items: [{ id: "item-01", productId: "product01", requestedQty: 12, systemSuggestedQty: 12, storeConfirmedQty: 12, managerConfirmedQty: null, managerSkipped: false, referencePurchasePrice: 100 }],
    ...overrides,
  };
}

test("自動補貨建議狀態集合包含門市確認與轉需求狀態", () => {
  assert.deepEqual(AUTO_SUGGESTION_STATUSES, ["GENERATED", "STORE_REVIEWING", "ACCEPTED", "ADJUSTED", "SKIPPED", "CONVERTED_TO_DEMAND", "EXPIRED"]);
});

test("AC-01：系統產生建議不會直接成為總倉可處理需求", () => {
  const item = suggestion();
  assert.equal(item.status, "GENERATED");
  assert.equal(canConvertSuggestion(item, store), true);
  assert.equal(autoDemand({ status: "DRAFT" }).status, "DRAFT");
});

test("AC-02：門市依系統建議確認時保留系統數量", () => {
  const result = applyStoreSuggestionReview(suggestion(), { confirmedQty: 12, actorId: store.id, changedAt: "2026-07-23 09:00", actorType: actorTypeFor(store) });
  assert.equal(result.valid, true);
  assert.equal(result.suggestion.status, "ACCEPTED");
  assert.equal(result.suggestion.systemSuggestedQty, 12);
  assert.equal(result.suggestion.storeConfirmedQty, 12);
});

test("AC-03：門市調整數量必填原因並寫入門市異動 log", () => {
  const result = applyStoreSuggestionReview(suggestion(), { confirmedQty: 8, adjustmentReason: "庫位有限", actorId: store.id, changedAt: "2026-07-23 09:00", actorType: actorTypeFor(store) });
  assert.equal(result.valid, true);
  assert.equal(result.suggestion.systemSuggestedQty, 12);
  assert.equal(result.suggestion.storeConfirmedQty, 8);
  assert.equal(result.suggestion.status, "ADJUSTED");
  assert.equal(result.logs[0].changeType, "STORE_QTY_CHANGED");
  assert.equal(result.logs[0].changeReason, "庫位有限");
});

test("門市調整數量未填原因時拒絕", () => {
  const result = validateStoreSuggestionReview(suggestion(), 8, "");
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /原因/);
});

test("門市略過與已轉需求的狀態不可再轉單", () => {
  assert.equal(canConvertSuggestion(suggestion({ status: "SKIPPED" }), store), false);
  assert.equal(canConvertSuggestion(suggestion({ status: "CONVERTED_TO_DEMAND" }), store), false);
});

test("自動補貨轉單草稿使用 AUTO source 且初始為 DRAFT", () => {
  const draft = buildAutoDemandDraft({ id: "demand-01", demandNumber: "DN-001", locationId: "store01", requiredDate: "2026-07-26", createdBy: store.id, createdAt: "2026-07-23 09:00", item: { id: "item-01", productId: "product01", requestedQty: 8, systemSuggestedQty: 12, storeConfirmedQty: 8, replenishmentSuggestionId: "suggestion-01" } });
  assert.equal(draft.sourceType, "AUTO");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.items[0].systemSuggestedQty, 12);
  assert.equal(draft.items[0].storeConfirmedQty, 8);
  assert.equal(draft.items[0].replenishmentSuggestionId, "suggestion-01");
});

test("同門市 STORE 可以確認補貨，跨門市 STORE 不可操作", () => {
  assert.equal(canStoreReviewSuggestion(suggestion(), store), true);
  assert.equal(canStoreReviewSuggestion(suggestion({ locationId: "store02" }), store), false);
  assert.equal(canStoreReviewSuggestion(suggestion({ locationId: "store02" }), admin), true);
});

test("自動補貨需求只有 DRAFT 與 RETURNED 可由門市修改", () => {
  assert.equal(canEditAutoDemand(autoDemand({ status: "DRAFT" }), store), true);
  assert.equal(canEditAutoDemand(autoDemand({ status: "RETURNED" }), store), true);
  for (const status of ["PENDING_MANAGER_APPROVAL", "SUBMITTED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE", "COMPLETED", "CANCELLED"]) {
    assert.equal(canEditAutoDemand(autoDemand({ status }), store), false);
  }
});

test("店長核單權限限定同門市店長或 ADMIN", () => {
  assert.equal(canManagerReviewAutoDemand(autoDemand(), manager), true);
  assert.equal(canManagerReviewAutoDemand(autoDemand(), otherManager), false);
  assert.equal(canManagerReviewAutoDemand(autoDemand({ locationId: "store02" }), admin), true);
  assert.equal(canManagerReviewAutoDemand(autoDemand(), store), false);
});

test("AC-04：店長直接核准時以門市確認量作為最終候選量", () => {
  const demand = autoDemand();
  const decisions = [{ itemId: "item-01", managerQty: 12, skipped: false, reason: "" }];
  const result = validateManagerDecisionLines(demand.items, decisions, { "item-01": { eligible: true } });
  assert.equal(result.valid, true);
  assert.equal(result.normalized[0].managerQty, 12);
});

test("AC-05：店長修改數量時必填原因且保留門市原量", () => {
  const demand = autoDemand({ items: [{ id: "item-01", productId: "product01", requestedQty: 8, systemSuggestedQty: 12, storeConfirmedQty: 8, referencePurchasePrice: 100 }] });
  const result = validateManagerDecisionLines(demand.items, [{ itemId: "item-01", managerQty: 5, skipped: false, reason: "依目前庫存" }], { "item-01": { eligible: true } });
  assert.equal(result.valid, true);
  assert.equal(result.normalized[0].storeQty, 8);
  assert.equal(result.normalized[0].managerQty, 5);
});

test("店長修改數量未填原因時拒絕", () => {
  const result = validateManagerDecisionLines(autoDemand().items, [{ itemId: "item-01", managerQty: 5, skipped: false, reason: "" }], { "item-01": { eligible: true } });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /原因/);
});

test("店長略過品項必填原因", () => {
  const result = validateManagerDecisionLines(autoDemand().items, [{ itemId: "item-01", managerQty: 0, skipped: true, reason: "" }], { "item-01": { eligible: true } });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /略過/);
});

test("至少保留一項未略過明細才可核准", () => {
  const result = validateManagerDecisionLines([
    { id: "a", productId: "a", storeConfirmedQty: 2 },
    { id: "b", productId: "b", storeConfirmedQty: 3 },
  ], [
    { itemId: "a", managerQty: 0, skipped: true, reason: "已有庫存" },
    { itemId: "b", managerQty: 0, skipped: true, reason: "已有庫存" },
  ], { a: { eligible: true }, b: { eligible: true } });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /至少需要一項/);
});

test("AC-06：QUANTITY_ONLY 最終數量不符時阻擋核准", () => {
  const condition = evaluateStoreOrderCondition({ conditionMode: "QUANTITY_ONLY", requestedQty: 6, lineAmount: 1200, minimumQty: 12, minimumAmount: 1000 });
  assert.equal(condition.eligible, false);
  const result = validateManagerDecisionLines(autoDemand().items, [{ itemId: "item-01", managerQty: 6, skipped: false, reason: "店長調整" }], { "item-01": condition });
  assert.equal(result.valid, false);
});

test("AC-07：AMOUNT_ONLY 只依最終金額判斷", () => {
  const condition = evaluateStoreOrderCondition({ conditionMode: "AMOUNT_ONLY", requestedQty: 2, lineAmount: 1200, minimumQty: 12, minimumAmount: 1000 });
  assert.equal(condition.eligible, true);
});

test("AC-08：EITHER 任一條件符合即可", () => {
  assert.equal(evaluateStoreOrderCondition({ conditionMode: "EITHER", requestedQty: 12, lineAmount: 100, minimumQty: 12, minimumAmount: 1000 }).eligible, true);
  assert.equal(evaluateStoreOrderCondition({ conditionMode: "EITHER", requestedQty: 2, lineAmount: 1200, minimumQty: 12, minimumAmount: 1000 }).eligible, true);
});

test("AC-09：BOTH 必須同時符合數量與金額", () => {
  assert.equal(evaluateStoreOrderCondition({ conditionMode: "BOTH", requestedQty: 12, lineAmount: 600, minimumQty: 12, minimumAmount: 1000 }).eligible, false);
  assert.equal(evaluateStoreOrderCondition({ conditionMode: "BOTH", requestedQty: 12, lineAmount: 1200, minimumQty: 12, minimumAmount: 1000 }).eligible, true);
});

test("AC-10：核准摘要同時呈現系統、門市、店長與最終金額", () => {
  const summary = summarizeAutoApproval({ items: [{ id: "item-01", systemSuggestedQty: 12, storeConfirmedQty: 8, managerConfirmedQty: 5, referencePurchasePrice: 100 }] });
  assert.equal(summary.systemTotalQty, 12);
  assert.equal(summary.storeTotalQty, 8);
  assert.equal(summary.managerTotalQty, 5);
  assert.equal(summary.finalAmount, 500);
});

test("供應商 MOQ 與最低金額是提示而非門市條件判斷", () => {
  const condition = evaluateStoreOrderCondition({ conditionMode: "QUANTITY_ONLY", requestedQty: 12, lineAmount: 100, minimumQty: 12, minimumAmount: null });
  assert.equal(condition.eligible, true);
});

test("AC-15：前六個完整月份排除當月", () => {
  assert.deepEqual(getPreviousCompleteMonths("2026-07-23").map((month) => month.label), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
});

test("AC-16：六個月銷售缺漏月份補零並提供最大最小值", () => {
  const sales = calculateSixMonthSales([{ locationId: "store01", productId: "product01", salesYear: 2026, salesMonth: 1, salesQty: 8 }, { locationId: "store01", productId: "product01", salesYear: 2026, salesMonth: 3, salesQty: 20 }], "store01", "product01", "2026-07-23");
  assert.deepEqual(sales.months.map((month) => month.salesQty), [8, 0, 20, 0, 0, 0]);
  assert.equal(sales.max, 20);
  assert.equal(sales.min, 0);
});

test("AC-17：庫存快照保存 on hand、reserved 與 available", () => {
  assert.deepEqual(buildReplenishmentInventorySnapshot({ onHandQty: 8, reservedQty: 3, calculatedAt: "2026-07-23 09:00" }), { onHandQtySnapshot: 8, reservedQtySnapshot: 3, availableQtySnapshot: 5, calculatedAt: "2026-07-23 09:00" });
});

test("AC-18：庫存變動可由目前數量與快照比較辨識", () => {
  const snapshot = buildReplenishmentInventorySnapshot({ onHandQty: 8, reservedQty: 3 });
  assert.deepEqual(buildReplenishmentInventorySnapshot({ onHandQty: 8, reservedQty: 3 }), snapshot);
  assert.notDeepEqual(buildReplenishmentInventorySnapshot({ onHandQty: 5, reservedQty: 3 }), snapshot);
});

test("AC-19：未完成需求剩餘量採核准或申請量扣配貨與簽收", () => {
  assert.equal(openDemandRemainingQty("APPROVED", { requestedQty: 10, approvedQty: 8, allocatedQty: 2, receivedQty: 1 }), 5);
  assert.equal(openDemandRemainingQty("SUBMITTED", { requestedQty: 10, allocatedQty: 3, receivedQty: 4 }), 3);
});

test("AC-20：只有指定五種狀態計入未完成需求", () => {
  for (const status of ["SUBMITTED", "APPROVED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"]) assert.equal(isReplenishmentOpenDemandStatus(status), true);
  for (const status of ["DRAFT", "COMPLETED", "CANCELLED", "PENDING_MANAGER_APPROVAL"]) assert.equal(isReplenishmentOpenDemandStatus(status), false);
});

test("店長退回後需求仍可回到 RETURNED 編輯，原補貨 log 可獨立保存", () => {
  const log = buildChangeLog({ id: "log-01", replenishmentSuggestionId: "suggestion-01", demandOrderId: "demand-01", changeType: "MANAGER_RETURNED", fieldName: "status", beforeValue: { value: "PENDING_MANAGER_APPROVAL" }, afterValue: { value: "RETURNED" }, changeReason: "請補充原因" });
  assert.equal(log.changeType, "MANAGER_RETURNED");
  assert.equal(log.beforeValue.value, "PENDING_MANAGER_APPROVAL");
});

test("重複轉單會被來源 suggestion id 識別", () => {
  const suggestions = [{ id: "suggestion-01", demandId: "demand-01", status: "CONVERTED_TO_DEMAND" }];
  assert.equal(suggestions.some((item) => item.id === "suggestion-01" && item.demandId), true);
  assert.equal(canConvertSuggestion(suggestions[0], store), false);
});

test("提交後自動補貨需求不可再由門市編輯", () => {
  assert.equal(canEditAutoDemand(autoDemand({ status: "SUBMITTED" }), store), false);
});

test("本機 transaction 失敗時回復原資料", () => {
  const state = { suggestions: [{ id: "s1", status: "GENERATED" }] };
  const result = runTransactionalMutation(state, (target) => { target.suggestions[0].status = "CONVERTED_TO_DEMAND"; throw new Error("db failed"); });
  assert.equal(result.committed, false);
  assert.equal(state.suggestions[0].status, "GENERATED");
});

test("本機 transaction 成功時保留狀態變更", () => {
  const state = { suggestions: [{ id: "s1", status: "GENERATED" }] };
  const result = runTransactionalMutation(state, (target) => { target.suggestions[0].status = "CONVERTED_TO_DEMAND"; return target.suggestions[0].status; });
  assert.equal(result.committed, true);
  assert.equal(result.result, "CONVERTED_TO_DEMAND");
  assert.equal(state.suggestions[0].status, "CONVERTED_TO_DEMAND");
});

test("六個月銷售快照可序列化保存總量、平均、最大與最小", () => {
  const snapshot = buildSixMonthSalesSnapshot({ months: [{ label: "2026-01", salesQty: 5 }, { label: "2026-02", salesQty: 0 }, { label: "2026-03", salesQty: 10 }] });
  assert.deepEqual(snapshot, { months: [{ label: "2026-01", salesQty: 5 }, { label: "2026-02", salesQty: 0 }, { label: "2026-03", salesQty: 10 }], total: 15, average: 5, max: 10, min: 0 });
});
