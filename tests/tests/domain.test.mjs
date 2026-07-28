import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDemandLineAmount,
  calculatePurchaseSuggestion,
  calculateReplenishment,
  calculateSixMonthSales,
  ceilToMultiple,
  demandOutstanding,
  evaluateStoreOrderCondition,
  getPreviousCompleteMonths,
  isHumanDemandEditableStatus,
  isReplenishmentOpenDemandStatus,
  openDemandRemainingQty,
  summarizeSupplierDemand,
} from "../domain.js";

test("補貨建議只有在啟用且預估庫存低於安全庫存時觸發", () => {
  const result = calculateReplenishment({
    onHandQty: 4,
    reservedQty: 1,
    allocationInTransitQty: 0,
    purchaseInboundAllocatedQty: 0,
    existingOpenDemandQty: 0,
    safetyStockQty: 6,
    maximumStockQty: 20,
    minimumReplenishmentQty: 6,
    storeDistributionMultiple: 3,
    automaticReplenishmentEnabled: true,
  });

  assert.equal(result.projectedAvailableQty, 3);
  assert.equal(result.eligible, true);
  assert.equal(result.rawRequiredQty, 17);
  assert.equal(result.suggestedQty, 18);
});

test("自動補貨停用或庫存高於安全線時不產生建議", () => {
  const disabled = calculateReplenishment({ onHandQty: 1, safetyStockQty: 6, maximumStockQty: 20, automaticReplenishmentEnabled: false });
  const safe = calculateReplenishment({ onHandQty: 12, safetyStockQty: 6, maximumStockQty: 20, automaticReplenishmentEnabled: true });
  assert.equal(disabled.suggestedQty, 0);
  assert.equal(safe.suggestedQty, 0);
});

test("最低補貨量優先於原始需求量，並向上取整至門市倍數", () => {
  const result = calculateReplenishment({
    onHandQty: 9,
    safetyStockQty: 10,
    maximumStockQty: 15,
    minimumReplenishmentQty: 8,
    storeDistributionMultiple: 3,
    automaticReplenishmentEnabled: true,
  });
  assert.equal(result.rawRequiredQty, 6);
  assert.equal(result.baseSuggestedQty, 8);
  assert.equal(result.suggestedQty, 9);
  assert.equal(ceilToMultiple(8, 3), 9);
});

test("集中採購套用 MOQ 與供應商採購倍數", () => {
  const result = calculatePurchaseSuggestion({ shortageQty: 13, minimumOrderQuantity: 24, purchaseMultiple: 12 });
  assert.equal(result.suggestedQty, 24);
  assert.equal(result.overageQty, 11);
  assert.equal(calculatePurchaseSuggestion({ shortageQty: 25, minimumOrderQuantity: 24, purchaseMultiple: 12 }).suggestedQty, 36);
});

test("需求未完成數量不會變成負數", () => {
  assert.equal(demandOutstanding({ requestedQty: 10, receivedQty: 4 }), 6);
  assert.equal(demandOutstanding({ requestedQty: 10, receivedQty: 14 }), 0);
});

function replenishmentCase(status, demand) {
  const result = calculateReplenishment({
    onHandQty: 2,
    reservedQty: 0,
    allocationInTransitQty: 0,
    purchaseInboundAllocatedQty: 0,
    existingOpenDemandQty: openDemandRemainingQty(status, demand),
    safetyStockQty: 5,
    maximumStockQty: 10,
    minimumReplenishmentQty: 2,
    storeDistributionMultiple: 1,
    automaticReplenishmentEnabled: true,
  });

  return { result, openDemandQty: openDemandRemainingQty(status, demand) };
}

test("AC-01：未完成需求足以補足庫存時不產生新建議", () => {
  const { result, openDemandQty } = replenishmentCase("SUBMITTED", { requestedQty: 8, allocatedQty: 0, receivedQty: 0 });

  assert.equal(openDemandQty, 8);
  assert.equal(result.projectedAvailableQty, 10);
  assert.equal(result.suggestedQty, 0);
});

test("AC-02：未完成需求不足時只補足剩餘缺口", () => {
  const { result, openDemandQty } = replenishmentCase("SUBMITTED", { requestedQty: 3, allocatedQty: 0, receivedQty: 0 });

  assert.equal(openDemandQty, 3);
  assert.equal(result.projectedAvailableQty, 5);
  assert.equal(result.suggestedQty, 5);
});

test("AC-03：CANCELLED 需求不得計入補貨預估", () => {
  const { result, openDemandQty } = replenishmentCase("CANCELLED", { requestedQty: 3, allocatedQty: 0, receivedQty: 0 });

  assert.equal(isReplenishmentOpenDemandStatus("CANCELLED"), false);
  assert.equal(openDemandQty, 0);
  assert.equal(result.projectedAvailableQty, 2);
  assert.equal(result.suggestedQty, 8);
});

test("AC-04：COMPLETED 需求不得計入補貨預估", () => {
  const { result, openDemandQty } = replenishmentCase("COMPLETED", { requestedQty: 3, allocatedQty: 0, receivedQty: 0 });

  assert.equal(isReplenishmentOpenDemandStatus("COMPLETED"), false);
  assert.equal(openDemandQty, 0);
  assert.equal(result.projectedAvailableQty, 2);
  assert.equal(result.suggestedQty, 8);
});

test("未完成需求剩餘量優先使用核准量，並扣除已配貨與已簽收", () => {
  for (const status of ["SUBMITTED", "APPROVED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"]) {
    assert.equal(isReplenishmentOpenDemandStatus(status), true);
  }

  assert.equal(openDemandRemainingQty("APPROVED", { requestedQty: 10, approvedQty: 6, allocatedQty: 2, receivedQty: 1 }), 3);
  assert.equal(openDemandRemainingQty("PROCESSING", { requestedQty: 10, allocatedQty: 12, receivedQty: 2 }), 0);
  assert.equal(openDemandRemainingQty("DRAFT", { requestedQty: 10, allocatedQty: 0, receivedQty: 0 }), 0);
});
test("人工需求只有草稿與退回可編輯", () => {
  assert.equal(isHumanDemandEditableStatus("DRAFT"), true);
  assert.equal(isHumanDemandEditableStatus("RETURNED"), true);
  for (const status of ["PENDING_MANAGER_APPROVAL", "SUBMITTED", "PROCESSING", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE", "COMPLETED", "CANCELLED"]) {
    assert.equal(isHumanDemandEditableStatus(status), false);
  }
});

test("需求明細金額依數量與參考進貨價計算", () => {
  assert.equal(calculateDemandLineAmount(5, 80), 400);
  assert.equal(calculateDemandLineAmount(-2, 80), 0);
  assert.equal(calculateDemandLineAmount(3, 12.345), 37.04);
});

test("門市數量制條件不足時不可送店長核單", () => {
  const result = evaluateStoreOrderCondition({ conditionMode: "QUANTITY_ONLY", requestedQty: 3, lineAmount: 9999, minimumQty: 5, minimumAmount: 100 });
  assert.equal(result.quantityMet, false);
  assert.equal(result.amountMet, true);
  assert.equal(result.eligible, false);
  assert.equal(result.quantityShortage, 2);
});

test("門市金額制條件只檢查明細金額", () => {
  const result = evaluateStoreOrderCondition({ conditionMode: "AMOUNT_ONLY", requestedQty: 2, lineAmount: 600, minimumQty: 10, minimumAmount: 500 });
  assert.equal(result.eligible, true);
  assert.equal(result.quantityMet, false);
  assert.equal(result.amountMet, true);
});

test("門市擇一條件符合數量或金額即可", () => {
  const quantityPasses = evaluateStoreOrderCondition({ conditionMode: "EITHER", requestedQty: 10, lineAmount: 10, minimumQty: 10, minimumAmount: 1000 });
  const amountPasses = evaluateStoreOrderCondition({ conditionMode: "EITHER", requestedQty: 1, lineAmount: 1000, minimumQty: 10, minimumAmount: 1000 });
  const bothFail = evaluateStoreOrderCondition({ conditionMode: "EITHER", requestedQty: 1, lineAmount: 1, minimumQty: 10, minimumAmount: 1000 });
  assert.equal(quantityPasses.eligible, true);
  assert.equal(amountPasses.eligible, true);
  assert.equal(bothFail.eligible, false);
});

test("門市雙重條件必須同時符合數量與金額", () => {
  assert.equal(evaluateStoreOrderCondition({ conditionMode: "BOTH", requestedQty: 10, lineAmount: 100, minimumQty: 10, minimumAmount: 100 }).eligible, true);
  assert.equal(evaluateStoreOrderCondition({ conditionMode: "BOTH", requestedQty: 10, lineAmount: 99, minimumQty: 10, minimumAmount: 100 }).eligible, false);
});

test("前六個完整月份不包含參考日當月", () => {
  assert.deepEqual(getPreviousCompleteMonths("2026-07-22"), [
    { year: 2026, month: 1, label: "2026-01" },
    { year: 2026, month: 2, label: "2026-02" },
    { year: 2026, month: 3, label: "2026-03" },
    { year: 2026, month: 4, label: "2026-04" },
    { year: 2026, month: 5, label: "2026-05" },
    { year: 2026, month: 6, label: "2026-06" },
  ]);
});

test("月銷售缺漏月份補零且隔離門市與商品", () => {
  const result = calculateSixMonthSales([
    { locationId: "store01", productId: "product01", salesYear: 2026, salesMonth: 1, salesQty: 5 },
    { locationId: "store01", productId: "product01", salesYear: 2026, salesMonth: 3, salesQty: 7 },
    { locationId: "store02", productId: "product01", salesYear: 2026, salesMonth: 6, salesQty: 99 },
    { locationId: "store01", productId: "product02", salesYear: 2026, salesMonth: 6, salesQty: 88 },
  ], "store01", "product01", "2026-07-22");
  assert.deepEqual(result.months.map((month) => month.salesQty), [5, 0, 7, 0, 0, 0]);
  assert.equal(result.total, 12);
  assert.equal(result.average, 2);
});

test("供應商彙總依供應商合計數量與金額", () => {
  assert.deepEqual(summarizeSupplierDemand([
    { supplierId: "sup01", requestedQty: 3, lineAmount: 120 },
    { supplierId: "sup01", requestedQty: 2, lineAmount: 80 },
    { supplierId: "sup02", requestedQty: 1, lineAmount: 50 },
  ]), [
    { supplierId: "sup01", requestedQty: 5, amount: 200 },
    { supplierId: "sup02", requestedQty: 1, amount: 50 },
  ]);
});
