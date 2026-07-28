import test from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_MODE_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  RECEIVING_STATUS_LABELS,
  SHORTAGE_REASON_LABELS,
  SHORTAGE_STATUS_LABELS,
  buildStatusOptions,
  statusLabel,
} from "../workflow-status-dictionary.js";

function assertChineseDictionary(dictionary) {
  Object.entries(dictionary).forEach(([code, label]) => {
    assert.equal(typeof label, "string");
    assert.ok(label.trim().length > 0, `${code} needs a label`);
    assert.notEqual(label, code, `${code} must not leak to the UI`);
  });
}

test("delivery, receiving, tracking and shortage dictionaries cover operator labels", () => {
  [DELIVERY_MODE_LABELS, RECEIVING_STATUS_LABELS, FOLLOW_UP_STATUS_LABELS, SHORTAGE_STATUS_LABELS, SHORTAGE_REASON_LABELS].forEach(assertChineseDictionary);
  assert.equal(statusLabel("SUPPLIER_DIRECT_TO_STORE", "delivery"), "廠商直送門市");
  assert.equal(statusLabel("WAITING_WAREHOUSE_RECEIPT", "receiving"), "等待總倉收貨");
  assert.equal(statusLabel("OVERDUE", "followUp"), "逾期未回覆");
  assert.equal(statusLabel("FULL_SHORTAGE", "shortage"), "全部缺貨");
  assert.match(buildStatusOptions(["NOT_DUE", "OVERDUE"], "followUp"), /尚未到期/);
});
