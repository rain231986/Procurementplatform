import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSupplierOperations,
  updateSupplierCommercialTerms,
  upsertSupplierBusinessRelation,
  snapshotPurchaseOrderSupplierTerms,
  calculateNextSupplierOrderDate,
  upsertSupplierOrderSchedule,
  getStoreSupplierSchedule,
  getStorePurchaseStatus,
  createSupplierBankAccount,
  switchPrimarySupplierBankAccount,
  verifySupplierBankAccount,
  disableSupplierBankAccount,
  getSupplierBankAccountsForRole,
  uploadSupplierAttachment,
  upsertProductIdentifier,
  updatePurchaseOrderItemTracking,
  getPurchaseOrderItemTrackingRows,
  updatePurchaseOrderItemShortage,
  cancelPurchaseOrderItemShortage,
  requeuePurchaseOrderItemShortage,
  setPurchaseOrderItemAlternative,
  createSupplierReturnDraft,
  updateSupplierReturnDraft,
  transitionSupplierReturn,
  recordSupplierReturnResolution,
  receiveSupplierReplacement,
  closeSupplierReturn,
  getSupplierReturnsForRole,
} from "../supplier-operations-workflow.js";

const actor = (role, id = role.toLowerCase()) => ({ actor: { id, role, isActive: true }, actorId: id, actorRole: role, changedAt: "2026-07-28 09:00", createId: (prefix) => `${prefix}_${id}_${Math.random().toString(36).slice(2, 6)}` });

function fixture() {
  const state = {
    suppliers: [
      { id: "s1", code: "S1", name: "訂購商 A", taxId: "12345678", isActive: true, paymentTerms: "月結 30 天", leadTimeDays: 3, minimumOrderAmount: "0.00" },
      { id: "s2", code: "S2", name: "付款商 B", taxId: "87654321", isActive: true, paymentTerms: "月結 45 天", leadTimeDays: 5, minimumOrderAmount: "0.00" },
      { id: "s3", code: "S3", name: "替代商 C", taxId: "11223344", isActive: true, paymentTerms: "現金", leadTimeDays: 2, minimumOrderAmount: "0.00" },
    ],
    products: [
      { id: "p1", productCode: "P-1", name: "商品一", baseUnit: "盒", isActive: true, batchTrackingEnabled: false, expiryTrackingEnabled: false },
      { id: "p2", productCode: "P-2", name: "批號商品", baseUnit: "盒", isActive: true, batchTrackingEnabled: true, expiryTrackingEnabled: true },
    ],
    supplierProducts: [{ id: "sp1", productId: "p1", supplierId: "s1", isPrimary: true, isActive: true, purchaseUnit: "盒", purchasePrice: "10.00", minimumOrderQuantity: 1, purchaseMultiple: 1 }],
    locations: [{ id: "warehouse", type: "WAREHOUSE", isActive: true }, { id: "store1", type: "STORE", isActive: true }],
    inventory: [{ id: "bal1", locationId: "warehouse", productId: "p1", onHandQty: 20, reservedQty: 2 }, { id: "bal2", locationId: "warehouse", productId: "p2", onHandQty: 10, reservedQty: 0 }],
    purchaseOrders: [{ id: "po1", purchaseOrderNumber: "PO-1", supplierId: "s1", status: "ORDERED", expectedDeliveryDate: "2026-07-30", lines: [{ id: "line1", productId: "p1", orderedQty: 12, receivedQty: 4, cancelledQty: 0, remainingQty: 8, sourceAllocations: [{ locationId: "store1", demandOrderId: "d1", demandOrderItemId: "di1" }] }] }],
    demands: [{ id: "d1", locationId: "store1", items: [{ id: "di1", productId: "p1", requestedQty: 12 }] }],
    auditLogs: [],
  };
  normalizeSupplierOperations(state);
  return state;
}

const committed = (result) => { assert.equal(result.committed, true, result.error?.message); return result.state; };
const failed = (result) => { assert.equal(result.committed, false); return result; };

test("normalization creates all supplier operation collections", () => {
  const state = normalizeSupplierOperations({});
  assert.ok(Array.isArray(state.supplierReturns));
  assert.ok(Array.isArray(state.purchaseOrderItemFollowups));
  assert.ok(Array.isArray(state.productIdentifiers));
});

test("purchasing can save payment method and settlement fields", () => {
  const result = updateSupplierCommercialTerms(fixture(), { ...actor("PURCHASING"), supplierId: "s1", changes: { paymentMethod: "CHECK", settlementDays: 30, paymentTerms: "月結 30 天" } });
  const state = committed(result);
  assert.equal(state.suppliers.find((row) => row.id === "s1").paymentMethod, "CHECK");
});

test("OTHER payment method requires a note", () => {
  failed(updateSupplierCommercialTerms(fixture(), { ...actor("PURCHASING"), supplierId: "s1", changes: { paymentMethod: "OTHER" } }));
});

test("warehouse cannot change payment terms", () => {
  failed(updateSupplierCommercialTerms(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", changes: { paymentMethod: "CASH" } }));
});

test("supplier tax id format is validated", () => {
  failed(updateSupplierCommercialTerms(fixture(), { ...actor("PURCHASING"), supplierId: "s1", changes: { taxId: "ABC" } }));
});

test("duplicate supplier tax id is rejected for purchasing", () => {
  failed(updateSupplierCommercialTerms(fixture(), { ...actor("PURCHASING"), supplierId: "s1", changes: { taxId: "87654321" } }));
});

test("admin may explicitly record a tax id exception reason", () => {
  const result = updateSupplierCommercialTerms(fixture(), { ...actor("ADMIN"), supplierId: "s1", changes: { taxId: "87654321" }, taxIdExceptionReason: "同集團共用統編，已由財務確認" });
  assert.equal(committed(result).suppliers.find((row) => row.id === "s1").taxId, "87654321");
});

test("business relation keeps one default payee per ordering supplier", () => {
  let state = fixture();
  state = committed(upsertSupplierBusinessRelation(state, { ...actor("PURCHASING"), orderingSupplierId: "s1", payeeSupplierId: "s2", isDefault: true }));
  state = committed(upsertSupplierBusinessRelation(state, { ...actor("PURCHASING"), orderingSupplierId: "s1", payeeSupplierId: "s3", isDefault: true }));
  assert.equal(state.supplierBusinessRelations.filter((row) => row.orderingSupplierId === "s1" && row.isDefault).length, 1);
  assert.equal(state.supplierBusinessRelations.find((row) => row.orderingSupplierId === "s1" && row.isDefault).payeeSupplierId, "s3");
});

test("inactive payee cannot become a formal relation", () => {
  const state = fixture(); state.suppliers[1].isActive = false;
  failed(upsertSupplierBusinessRelation(state, { ...actor("PURCHASING"), orderingSupplierId: "s1", payeeSupplierId: "s2" }));
});

test("purchase order receives ordering and payee snapshots", () => {
  let state = fixture();
  state = committed(upsertSupplierBusinessRelation(state, { ...actor("PURCHASING"), orderingSupplierId: "s1", payeeSupplierId: "s2", isDefault: true }));
  state = committed(snapshotPurchaseOrderSupplierTerms(state, { ...actor("PURCHASING"), purchaseOrderId: "po1", orderingSupplierId: "s1", changeReason: "正式下單前確認付款對象" }));
  const order = state.purchaseOrders[0];
  assert.equal(order.payeeSupplierId, "s2");
  assert.equal(order.orderingSupplierSnapshot.name, "訂購商 A");
  assert.equal(order.payeeSupplierSnapshot.name, "付款商 B");
});

test("next order date follows interval days", () => {
  assert.equal(calculateNextSupplierOrderDate({ frequencyType: "INTERVAL_DAYS", intervalDays: 5, fromDate: "2026-07-28" }), "2026-08-02");
});

test("weekly schedule follows configured weekdays and monthly day", () => {
  assert.equal(calculateNextSupplierOrderDate({ frequencyType: "WEEKLY", weekdays: [1, 4], fromDate: "2026-07-28" }), "2026-07-30");
  assert.equal(calculateNextSupplierOrderDate({ frequencyType: "MONTHLY", dayOfMonth: 31, fromDate: "2026-07-28" }), "2026-08-31");
});

test("supplier schedule exposes only store-needed data", () => {
  let state = fixture();
  state = committed(upsertSupplierOrderSchedule(state, { ...actor("PURCHASING"), supplierId: "s1", frequencyType: "WEEKLY", nextOrderDate: "2026-08-03", expectedDeliveryDays: 3, storeVisibleNote: "每週一截單", internalNote: "不可給門市" }));
  const view = getStoreSupplierSchedule(state, { supplierId: "s1" });
  assert.equal(view.nextOrderDate, "2026-08-03");
  assert.equal(view.internalNote, undefined);
});

test("bank account is masked by default", () => {
  const state = committed(createSupplierBankAccount(fixture(), { ...actor("PURCHASING"), supplierId: "s1", bankName: "銀行", accountName: "訂購商 A", accountNumber: "123456789" }));
  assert.match(state.supplierBankAccounts[0].accountNumberMasked, /789$/);
  assert.equal(getSupplierBankAccountsForRole(state, "s1", { role: "PURCHASING", isActive: true })[0].accountNumber, undefined);
});

test("store and warehouse cannot view bank account records", () => {
  const state = committed(createSupplierBankAccount(fixture(), { ...actor("PURCHASING"), supplierId: "s1", bankName: "銀行", accountName: "訂購商 A", accountNumber: "123456789" }));
  assert.deepEqual(getSupplierBankAccountsForRole(state, "s1", { role: "STORE", isActive: true }), []);
  assert.deepEqual(getSupplierBankAccountsForRole(state, "s1", { role: "WAREHOUSE", isActive: true }), []);
});

test("switching primary bank account deactivates the old primary flag", () => {
  let state = committed(createSupplierBankAccount(fixture(), { ...actor("PURCHASING"), supplierId: "s1", bankName: "銀行", accountName: "A", accountNumber: "111111111", isPrimary: true }));
  state = committed(createSupplierBankAccount(state, { ...actor("PURCHASING"), supplierId: "s1", bankName: "銀行二", accountName: "A", accountNumber: "222222222" }));
  const second = state.supplierBankAccounts.find((row) => row.accountNumber === "222222222");
  state = committed(switchPrimarySupplierBankAccount(state, { ...actor("PURCHASING"), accountId: second.id }));
  assert.equal(state.supplierBankAccounts.filter((row) => row.isPrimary).length, 1);
  assert.equal(state.supplierBankAccounts.find((row) => row.id === second.id).isPrimary, true);
});

test("bank proof accepts private metadata without public URL", () => {
  let state = committed(createSupplierBankAccount(fixture(), { ...actor("PURCHASING"), supplierId: "s1", bankName: "銀行", accountName: "A", accountNumber: "333333333" }));
  const account = state.supplierBankAccounts[0];
  const result = uploadSupplierAttachment(state, { ...actor("PURCHASING"), supplierBankAccountId: account.id, attachmentType: "BANK_ACCOUNT_PROOF", fileName: "proof.pdf", fileType: "application/pdf", fileSize: 100, storageKey: "private/key/1" });
  state = committed(result);
  assert.equal(state.supplierBankAttachments[0].storageKey, "private/key/1");
  assert.equal(state.auditLogs[0].afterData.storageKey, undefined);
});

test("bank account can be verified and disabled with masked audit", () => {
  let state = committed(createSupplierBankAccount(fixture(), { ...actor("PURCHASING"), supplierId: "s1", bankName: "銀行", accountName: "A", accountNumber: "444444444", isPrimary: true }));
  const accountId = state.supplierBankAccounts[0].id;
  state = committed(verifySupplierBankAccount(state, { ...actor("PURCHASING"), accountId, verifiedNote: "已核對" }));
  assert.ok(state.supplierBankAccounts[0].verifiedAt);
  state = committed(disableSupplierBankAccount(state, { ...actor("PURCHASING"), accountId, reason: "更換收款帳戶" }));
  assert.equal(state.supplierBankAccounts[0].isActive, false);
  assert.equal(state.auditLogs[0].afterData.accountNumber, "＊＊＊＊44444");
});

test("bank attachment rejects oversized files", () => {
  const state = fixture(); state.supplierBankAccounts = [{ id: "b1", supplierId: "s1" }];
  failed(uploadSupplierAttachment(state, { ...actor("PURCHASING"), supplierBankAccountId: "b1", attachmentType: "BANK_ACCOUNT_PROOF", fileName: "proof.pdf", fileType: "application/pdf", fileSize: 10 * 1024 * 1024 + 1, storageKey: "private/key" }));
});

test("GTIN-14 and other fixed product identifiers are accepted", () => {
  let state = fixture();
  state = committed(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", identifierType: "GTIN14", value: "04710001000001" }));
  state = committed(upsertProductIdentifier(state, { ...actor("WAREHOUSE"), productId: "p1", identifierType: "EAN13", value: "4710001000001" }));
  state = committed(upsertProductIdentifier(state, { ...actor("WAREHOUSE"), productId: "p1", identifierType: "UPCA", value: "710001000001" }));
  state = committed(upsertProductIdentifier(state, { ...actor("WAREHOUSE"), productId: "p1", identifierType: "JAN", value: "49123456" }));
  state = committed(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p1", identifierType: "MANUFACTURER_ITEM_CODE", value: "maker-a-001" }));
  assert.equal(state.productIdentifiers.length, 5);
});

test("international product identifier uniqueness is enforced", () => {
  let state = committed(upsertProductIdentifier(fixture(), { ...actor("PURCHASING"), productId: "p1", identifierType: "UPCA", value: "710001000001" }));
  failed(upsertProductIdentifier(state, { ...actor("PURCHASING"), productId: "p2", identifierType: "UPCA", value: "710001000001" }));
});

test("store cannot maintain product identifiers", () => {
  failed(upsertProductIdentifier(fixture(), { ...actor("STORE"), productId: "p1", identifierType: "JAN", value: "49123456" }));
});

test("purchase follow-up updates the line and appends history", () => {
  const state = committed(updatePurchaseOrderItemTracking(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", followUpStatus: "DELAYED", supplierResponseNote: "供應商延後", storeVisibleNote: "預計下週到貨", internalNote: "採購已電話確認" }));
  assert.equal(state.purchaseOrders[0].lines[0].followUpStatus, "DELAYED");
  assert.equal(state.purchaseOrderItemFollowups.length, 1);
});

test("store tracking projection omits internal note and limits source store", () => {
  const state = committed(updatePurchaseOrderItemTracking(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", internalNote: "敏感採購備註", storeVisibleNote: "門市可見" }));
  const rows = getPurchaseOrderItemTrackingRows(state, { role: "STORE", locationId: "store1", isActive: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].internalNote, "");
  assert.equal(Object.hasOwn(rows[0], "payeeSupplierId"), false);
  assert.equal(Object.hasOwn(rows[0], "payeeSupplierName"), false);
  assert.equal(rows[0].storeVisibleNote, "門市可見");
});

test("warehouse tracking projection omits payee supplier fields", () => {
  const rows = getPurchaseOrderItemTrackingRows(fixture(), { role: "WAREHOUSE", isActive: true });
  assert.equal(Object.hasOwn(rows[0], "payeeSupplierId"), false);
  assert.equal(Object.hasOwn(rows[0], "payeeSupplierName"), false);
});

test("shortage quantities are projected per source store", () => {
  const source = fixture();
  source.locations.push({ id: "store2", type: "STORE", isActive: true });
  source.demands.push({ id: "d2", locationId: "store2", items: [{ id: "di2", productId: "p1", requestedQty: 6 }] });
  const line = source.purchaseOrders[0].lines[0];
  line.orderedQty = 18;
  line.remainingQty = 14;
  line.sourceAllocations.push({ locationId: "store2", demandOrderId: "d2", demandOrderItemId: "di2", allocatedQty: 6, receivedAllocatedQty: 0, cancelledAllocatedQty: 0 });
  normalizeSupplierOperations(source);
  let state = committed(updatePurchaseOrderItemShortage(source, { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 8, shortageReason: "SUPPLIER_NO_STOCK", storeVisibleShortageNote: "第一來源優先缺貨" }));
  const store1 = getStorePurchaseStatus(state, { role: "STORE", locationId: "store1", isActive: true })[0];
  const store2 = getStorePurchaseStatus(state, { role: "STORE", locationId: "store2", isActive: true })[0];
  assert.equal(store1.shortageQty, 8);
  assert.equal(store2.shortageQty, 0);
  assert.equal(store2.openQty, 6);
});

test("full shortage requeue remains visible to the source store after the original line closes", () => {
  let state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 8, shortageReason: "SUPPLIER_NO_STOCK" }));
  state = committed(requeuePurchaseOrderItemShortage(state, { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", reason: "重新詢價" }));
  const row = getStorePurchaseStatus(state, { role: "STORE", locationId: "store1", isActive: true })[0];
  assert.equal(row.requeuedQty, 8);
  assert.equal(row.shortageRequeueStatus, "REQUEUED");
});

test("shortage and follow-up status are written back to the source demand", () => {
  let state = committed(updatePurchaseOrderItemTracking(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", followUpStatus: "DELAYED", supplierResponseNote: "供應商延後", storeVisibleNote: "改期到貨" }));
  state = committed(updatePurchaseOrderItemShortage(state, { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 3, shortageReason: "SUPPLIER_NO_STOCK", storeVisibleShortageNote: "廠商部分缺貨" }));
  const item = state.demands[0].items[0];
  assert.equal(item.purchaseShortageQty, 3);
  assert.equal(item.procurementStatus, "PARTIAL_SHORTAGE");
  assert.equal(item.procurementStatusNote, "廠商部分缺貨");
  assert.equal(getStorePurchaseStatus(state, { role: "STORE", locationId: "store1", isActive: true })[0].storeVisibleNote, "廠商部分缺貨");
});

test("shortage cannot exceed the open quantity", () => {
  failed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 9, shortageReason: "SUPPLIER_NO_STOCK" }));
});

test("partial shortage keeps the original purchase line and received quantity", () => {
  const state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 3, shortageReason: "SUPPLIER_NO_STOCK" }));
  const line = state.purchaseOrders[0].lines[0];
  assert.equal(line.receivedQty, 4);
  assert.equal(line.remainingQty, 8);
  assert.equal(line.shortageQty, 3);
  assert.equal(line.shortageStatus, "PARTIAL_SHORTAGE");
});

test("cancelling shortage reduces cancelled and remaining quantities", () => {
  let state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 3, shortageReason: "SUPPLIER_NO_STOCK" }));
  state = committed(cancelPurchaseOrderItemShortage(state, { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", quantity: 2, reason: "供應商確認取消" }));
  const line = state.purchaseOrders[0].lines[0];
  assert.equal(line.cancelledQty, 2);
  assert.equal(line.remainingQty, 6);
  assert.equal(line.shortageQty, 1);
});

test("shortage can be requeued without rewriting the original purchase order", () => {
  let state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 3, shortageReason: "SUPPLIER_NO_STOCK" }));
  state = committed(requeuePurchaseOrderItemShortage(state, { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", reason: "重新詢價" }));
  assert.equal(state.shortageRequeueEntries[0].quantity, 3);
  assert.equal(state.purchaseOrders[0].lines[0].orderedQty, 12);
  assert.equal(state.purchaseOrders[0].lines[0].shortageQty, 0);
  assert.equal(state.purchaseOrders[0].lines[0].cancelledQty, 3);
  assert.equal(state.demands[0].items[0].procurementStatus, "REQUEUED");
});

test("alternative supplier/product is recorded on the original shortage line", () => {
  let state = committed(updatePurchaseOrderItemShortage(fixture(), { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", shortageQty: 3, shortageReason: "SUPPLIER_NO_STOCK" }));
  state = committed(setPurchaseOrderItemAlternative(state, { ...actor("PURCHASING"), purchaseOrderId: "po1", purchaseOrderItemId: "line1", alternativeSupplierId: "s3", alternativeProductId: "p2", note: "改由替代商供應" }));
  assert.equal(state.purchaseOrders[0].lines[0].shortageStatus, "ALTERNATIVE_AVAILABLE");
  assert.equal(state.purchaseOrders[0].lines[0].alternativeSupplierId, "s3");
});

test("return draft does not change inventory", () => {
  const source = fixture();
  const result = createSupplierReturnDraft(source, { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", returnReason: "外箱破損", items: [{ productId: "p1", returnQty: 3, reasonCode: "DAMAGED", unitPrice: 10 }] });
  const state = committed(result);
  assert.equal(state.inventory.find((row) => row.productId === "p1").onHandQty, 20);
  assert.equal(state.supplierReturns[0].status, "DRAFT");
});

test("warehouse can edit a return draft without changing inventory", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 2, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  const itemId = state.supplierReturnItems[0].id;
  state = committed(updateSupplierReturnDraft(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, returnOrderItemId: itemId, item: { returnQty: 4, reasonCode: "QUALITY_ISSUE", note: "補充檢驗結果" } }));
  assert.equal(state.supplierReturnItems[0].returnQty, 4);
  assert.equal(state.supplierReturns[0].totalQty, 4);
  assert.equal(state.inventory.find((row) => row.productId === "p1").onHandQty, 20);
});

test("tracked product return requires batch and expiry", () => {
  failed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "EXPIRY_ISSUE", items: [{ productId: "p2", returnQty: 1, reasonCode: "EXPIRED" }] }));
});

test("ready-to-return reserves warehouse inventory", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 3, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  assert.equal(state.inventory.find((row) => row.productId === "p1").returnReservedQty, 3);
});

test("return outbound decrements warehouse inventory and creates movement", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 3, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "RETURNED_TO_SUPPLIER" }));
  assert.equal(state.inventory.find((row) => row.productId === "p1").onHandQty, 17);
  assert.equal(state.inventoryMovements[0].movementType, "SUPPLIER_RETURN_OUTBOUND");
});

test("return outbound cannot be executed twice", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 1, reasonCode: "DAMAGED" }] }));
  const id = state.supplierReturns[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: id, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: id, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: id, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: id, status: "RETURNED_TO_SUPPLIER" }));
  failed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: id, status: "RETURNED_TO_SUPPLIER" }));
});

test("return attachment is private and store access is rejected", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 1, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  const itemId = state.supplierReturnItems[0].id;
  state = committed(uploadSupplierAttachment(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, returnOrderItemId: itemId, attachmentType: "DAMAGE_PHOTO", fileName: "damage.jpg", fileType: "image/jpeg", fileSize: 100, storageKey: "private/returns/damage.jpg" }));
  assert.equal(state.supplierReturnAttachments[0].storageKey, "private/returns/damage.jpg");
  failed(uploadSupplierAttachment(state, { ...actor("STORE"), returnOrderId: orderId, returnOrderItemId: itemId, attachmentType: "DAMAGE_PHOTO", fileName: "damage.jpg", fileType: "image/jpeg", fileSize: 100, storageKey: "private/returns/other.jpg" }));
  assert.throws(() => getSupplierReturnsForRole(state, { role: "STORE", locationId: "store1", isActive: true }));
});

test("refund resolution completes a returned item", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 2, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id; const itemId = state.supplierReturnItems[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "RETURNED_TO_SUPPLIER" }));
  state = committed(recordSupplierReturnResolution(state, { ...actor("PURCHASING"), returnOrderItemId: itemId, resolutionType: "REFUND", resolutionQty: 2, confirmedAmount: "20.00" }));
  assert.equal(state.supplierReturns[0].status, "RESOLVED");
  assert.equal(state.supplierReturnItems[0].refundedQty, 2);
});

test("return status is written back to the linked source demand", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "PURCHASE_RECEIPT", sourcePurchaseOrderId: "po1", items: [{ productId: "p1", purchaseOrderItemId: "line1", returnQty: 1, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  const itemId = state.supplierReturnItems[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  assert.equal(state.demands[0].items[0].purchaseReturnStatus, "RETURN_PROCESSING");
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "RETURNED_TO_SUPPLIER" }));
  state = committed(recordSupplierReturnResolution(state, { ...actor("PURCHASING"), returnOrderItemId: itemId, resolutionType: "REFUND", resolutionQty: 1 }));
  assert.equal(state.demands[0].items[0].purchaseReturnStatus, "RETURN_RESOLVED");
});

test("supplier rejection can be resolved without outbound inventory movement", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 1, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  const itemId = state.supplierReturnItems[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "REJECTED_BY_SUPPLIER" }));
  state = committed(recordSupplierReturnResolution(state, { ...actor("PURCHASING"), returnOrderItemId: itemId, resolutionType: "REJECTED", resolutionQty: 1, supplierResponse: "供應商拒絕" }));
  assert.equal(state.supplierReturns[0].status, "RESOLVED");
  assert.equal(state.inventory.find((row) => row.productId === "p1").onHandQty, 20);
});

test("rejected supplier resolution is recorded and can complete the return item", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 1, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id;
  const itemId = state.supplierReturnItems[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "RETURNED_TO_SUPPLIER" }));
  state = committed(recordSupplierReturnResolution(state, { ...actor("PURCHASING"), returnOrderItemId: itemId, resolutionType: "REJECTED", resolutionQty: 1, supplierResponse: "廠商拒絕退貨" }));
  assert.equal(state.supplierReturnItems[0].rejectedQty, 1);
  assert.equal(state.supplierReturnItems[0].unresolvedQty, 0);
  assert.equal(state.supplierReturns[0].status, "RESOLVED");
});

test("replacement receipt adds only warehouse inventory", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 2, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id; const itemId = state.supplierReturnItems[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "RETURNED_TO_SUPPLIER" }));
  state = committed(recordSupplierReturnResolution(state, { ...actor("PURCHASING"), returnOrderItemId: itemId, resolutionType: "REPLACEMENT", resolutionQty: 2 }));
  state = committed(receiveSupplierReplacement(state, { ...actor("WAREHOUSE"), returnOrderItemId: itemId, receivedQty: 2 }));
  assert.equal(state.inventory.find((row) => row.locationId === "warehouse" && row.productId === "p1").onHandQty, 20);
  assert.equal(state.supplierReturns[0].status, "RESOLVED");
});

test("return cannot close while unresolved quantities remain", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 2, reasonCode: "DAMAGED" }] }));
  failed(closeSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: state.supplierReturns[0].id }));
});

test("return closes after the supplier resolution is complete", () => {
  let state = committed(createSupplierReturnDraft(fixture(), { ...actor("WAREHOUSE"), supplierId: "s1", sourceType: "DAMAGED", items: [{ productId: "p1", returnQty: 1, reasonCode: "DAMAGED" }] }));
  const orderId = state.supplierReturns[0].id; const itemId = state.supplierReturnItems[0].id;
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "PENDING_SUPPLIER_CONFIRMATION" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "SUPPLIER_CONFIRMED" }));
  state = committed(transitionSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId, status: "READY_TO_RETURN" }));
  state = committed(transitionSupplierReturn(state, { ...actor("WAREHOUSE"), returnOrderId: orderId, status: "RETURNED_TO_SUPPLIER" }));
  state = committed(recordSupplierReturnResolution(state, { ...actor("PURCHASING"), returnOrderItemId: itemId, resolutionType: "CREDIT_NOTE", resolutionQty: 1 }));
  state = committed(closeSupplierReturn(state, { ...actor("PURCHASING"), returnOrderId: orderId }));
  assert.equal(state.supplierReturns[0].status, "RESOLVED");
});
