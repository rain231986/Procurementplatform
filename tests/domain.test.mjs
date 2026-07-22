import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePurchaseSuggestion,
  calculateReplenishment,
  ceilToMultiple,
  demandOutstanding,
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
