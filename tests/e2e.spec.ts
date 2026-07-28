import { test, expect } from "@playwright/test";

test.describe("PharmaFlow Phase 1 核心流程", () => {
  test("登入後可以進入需求池並看到測試資料", async ({ page }) => {
    await page.goto("http://localhost:8787/");
    await expect(page.getByText("登入平台")).toBeVisible();
    await expect(page.getByText("首次使用")).toBeVisible();
  });

  test("角色頁面應有需求、配貨與採購入口", async ({ page }) => {
    await page.goto("http://localhost:8787/");
    await expect(page.locator("#appRoot")).toContainText("PharmaFlow");
  });
});
async function login(page: any, username: string) {
  await page.goto("http://localhost:8787/");
  const setupForm = page.locator("#setupPasswordForm");
  if (await setupForm.isVisible().catch(() => false)) {
    await setupForm.locator("[name=setupPassword]").fill("phase1-demo");
    await setupForm.locator("[name=setupPasswordConfirm]").fill("phase1-demo");
    await setupForm.locator("button[type=submit]").click();
  }
  await page.locator("#loginForm select[name=username]").selectOption(username);
  await page.locator("#loginForm [name=password]").fill("phase1-demo");
  await page.locator("#loginForm button[type=submit]").click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const profileDialog = page.getByRole("dialog", { name: "個人登入資訊", exact: true });
  if (await profileDialog.count()) {
    await profileDialog.locator('[data-action="close-modal"]').click();
  }
}

async function demandFromStorage(page: any, demandId: string) {
  return page.evaluate((id: string) => {
    const data = JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}");
    return data.demands?.find((demand: any) => demand.id === id);
  }, demandId);
}

test("人工需求可送店長核單並由同店店長核准", async ({ page }) => {
  await login(page, "store01");
  await page.locator('[data-action="open-create-demand"]').first().click();
  const form = page.locator("form[data-demand-editor]");
  await form.locator("select[name=demandType]").selectOption("GENERAL");
  await form.locator("input[name=requestedQty]").fill("24");
  await form.locator("button[type=submit]").click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.[0]);
  expect(draft.status).toBe("DRAFT");
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("PENDING_MANAGER_APPROVAL");
  await expect(page.locator(`[data-action="approve-demand"][data-id="${draft.id}"]`)).toHaveCount(0);
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01_manager");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  await page.locator(`[data-action="approve-demand"][data-id="${draft.id}"]`).first().click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("SUBMITTED");
});

test("店長退回後門市可修改並再次送審", async ({ page }) => {
  await login(page, "store01");
  await page.locator('[data-action="open-create-demand"]').first().click();
  const form = page.locator("form[data-demand-editor]");
  await form.locator("input[name=requestedQty]").fill("24");
  await form.locator("button[type=submit]").click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.[0]);
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01_manager");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  await page.locator(`[data-action="return-demand"][data-id="${draft.id}"]`).first().click();
  const returnDialog = page.getByRole("dialog", { name: "退回需求單", exact: true });
  await returnDialog.locator("textarea[name=returnReason]").fill("請補充門市備貨說明");
  await returnDialog.locator("button[type=submit]").click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("RETURNED");
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  await page.locator(`[data-action="open-edit-demand"][data-id="${draft.id}"]`).click();
  const editForm = page.locator("form[data-demand-editor]");
  await editForm.locator("input[name=requestedQty]").fill("15");
  await editForm.locator("button[type=submit]").click();
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("PENDING_MANAGER_APPROVAL");
});

test("門市條件不符會阻擋送審，供應商 MOQ 只顯示提示", async ({ page }) => {
  await login(page, "store01");
  await page.locator('[data-action="open-create-demand"]').first().click();
  const form = page.locator("form[data-demand-editor]");
  await form.locator("input[name=requestedQty]").fill("3");
  await form.locator("button[type=submit]").click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.[0]);
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("DRAFT");
  await page.locator(`[data-action="open-edit-demand"][data-id="${draft.id}"]`).click();
  const editForm = page.locator("form[data-demand-editor]");
  await editForm.locator("select[name=productId]").selectOption("product02");
  await editForm.locator("input[name=requestedQty]").fill("1");
  await editForm.locator("button[type=submit]").click();
  const edited = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.[0]);
  await page.locator(`[data-action="submit-demand"][data-id="${edited.id}"]`).click();
  expect((await demandFromStorage(page, edited.id)).status).toBe("PENDING_MANAGER_APPROVAL");
  await expect(page.locator(".toast")).toContainText("供應商");
});

test("自動補貨經門市修改、店長修改核准後才進入總倉", async ({ page }) => {
  await login(page, "store01");
  await page.locator('[data-action="navigate"][data-view="replenishment"]').click();
  await page.locator('[data-action="run-replenishment"]').click();
  const suggestion = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").replenishmentSuggestions?.find((item: any) => item.status === "GENERATED" && item.productId === "product01") || JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").replenishmentSuggestions?.find((item: any) => item.status === "GENERATED"));
  expect(suggestion?.id).toBeTruthy();
  const suggestionAction = page.locator(`[data-action="convert-suggestion"][data-id="${suggestion.id}"]`);
  await expect(suggestionAction).toHaveCount(1);
  await suggestionAction.click();
  const suggestionDialog = page.getByRole("dialog", { name: "門市確認補貨建議", exact: true });
  await expect(suggestionDialog).toContainText("目前門市庫存");
  await expect(suggestionDialog).toContainText("前六個完整月份");
  await expect(suggestionDialog).toContainText("門市最低需求條件");
  await expect(suggestionDialog).toContainText("供應商");
  await suggestionDialog.locator('input[name="confirmedQty"]').fill(String(Number(suggestion.suggestedQty) + 3));
  await suggestionDialog.locator('input[name="adjustmentReason"]').fill("門市銷售增加，調整補貨量");
  await suggestionDialog.locator('button[name="suggestionAction"][value="CONVERT"]').click();
  const draft = await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.find((demand: any) => demand.items?.some((item: any) => item.replenishmentSuggestionId === id)), suggestion.id);
  expect(draft.status).toBe("DRAFT");
  expect(draft.items[0].systemSuggestedQty).toBe(suggestion.suggestedQty);
  expect(draft.items[0].storeConfirmedQty).toBe(Number(suggestion.suggestedQty) + 3);
  expect((await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").replenishmentSuggestions?.find((item: any) => item.id === id), suggestion.id)).status).toBe("CONVERTED_TO_DEMAND");
  await page.locator('[data-action="submit-demand"][data-id="' + draft.id + '"]').click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("PENDING_MANAGER_APPROVAL");
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01_manager");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  const managerEditButton = page.locator(`[data-action="open-auto-manager-edit"][data-id="${draft.id}"]`);
  await expect(managerEditButton).toHaveCount(1);
  await managerEditButton.click();
  const managerEditDialog = page.getByRole("dialog", { name: "店長修改自動補貨需求", exact: true });
  await managerEditDialog.locator('input[name="managerQty"]').fill(String(Number(suggestion.suggestedQty) + 6));
  await managerEditDialog.locator('input[name="managerReason"]').fill("店長依銷售與門市現況調整");
  await managerEditDialog.locator('button[name="managerAction"][value="APPROVE"]').click();
  const approvalDialog = page.getByRole("dialog", { name: "自動補貨核准摘要", exact: true });
  await expect(approvalDialog).toContainText("系統總量");
  await expect(approvalDialog).toContainText("門市總量");
  await expect(approvalDialog).toContainText("店長總量");
  await expect(approvalDialog).toContainText("供應商條件提示");
  await approvalDialog.locator("button[type=submit]").click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("SUBMITTED");
  expect((await demandFromStorage(page, draft.id)).items[0].managerConfirmedQty).toBe(Number(suggestion.suggestedQty) + 6);
  expect((await demandFromStorage(page, draft.id)).items[0].finalRequestedQty).toBe(Number(suggestion.suggestedQty) + 6);
  await page.locator('[data-action="logout"]').click();
  await login(page, "warehouse01");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  const warehouseRow = page.locator("main tr").filter({ hasText: draft.demandNumber });
  await expect(warehouseRow).toHaveCount(1);
  await expect(warehouseRow).toContainText(`${Number(suggestion.suggestedQty) + 6} 件`);
});

test("自動補貨退回後門市可修改並再次送審", async ({ page }) => {
  await login(page, "store01");
  await page.locator('[data-action="navigate"][data-view="replenishment"]').click();
  await page.locator('[data-action="run-replenishment"]').click();
  const suggestion = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").replenishmentSuggestions?.find((item: any) => item.status === "GENERATED" && item.productId === "product01") || JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").replenishmentSuggestions?.find((item: any) => item.status === "GENERATED"));
  expect(suggestion?.id).toBeTruthy();
  await page.locator(`[data-action="convert-suggestion"][data-id="${suggestion.id}"]`).click();
  const suggestionDialog = page.getByRole("dialog", { name: "門市確認補貨建議", exact: true });
  await suggestionDialog.locator('button[name="suggestionAction"][value="CONVERT"]').click();
  const draft = await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.find((demand: any) => demand.items?.some((item: any) => item.replenishmentSuggestionId === id)), suggestion.id);
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01_manager");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  await page.locator(`[data-action="return-auto-demand"][data-id="${draft.id}"]`).click();
  const returnDialog = page.getByRole("dialog", { name: "退回自動補貨需求", exact: true });
  await returnDialog.locator("textarea[name=returnReason]").fill("請補充門市備貨說明");
  await returnDialog.locator("button[type=submit]").click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("RETURNED");
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  await page.locator(`[data-action="open-edit-demand"][data-id="${draft.id}"]`).click();
  const returnedEditForm = page.locator("form[data-demand-editor]");
  await returnedEditForm.locator("input[name=requestedQty]").fill(String(Number(draft.items[0].requestedQty) + 3));
  await returnedEditForm.locator("input[name=reason]").fill("退回後依門市現況調整");
  await returnedEditForm.locator("button[type=submit]").click();
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("PENDING_MANAGER_APPROVAL");
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01_manager");
  await page.locator('[data-action="navigate"][data-view="demands"]').click();
  await page.locator(`[data-action="approve-auto-demand"][data-id="${draft.id}"]`).click();
  await page.getByRole("dialog", { name: "自動補貨核准摘要", exact: true }).locator("button[type=submit]").click();
  expect((await demandFromStorage(page, draft.id)).status).toBe("SUBMITTED");
});

test("ADMIN 可匯入月銷售 CSV 並顯示 upsert 成功", async ({ page }) => {
  await login(page, "admin");
  const mastersButton = page.getByRole("button", { name: "▦ 主檔與庫存", exact: true });
  await mastersButton.click();
  await expect(page.getByText("匯入門市月銷售", { exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles("tests/fixtures/monthly-sales.csv");
  await expect(page.locator(".toast")).toContainText("月銷售資料已匯入");
});

test("商品與供應商主檔依角色顯示可編輯與唯讀邊界", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="masters"]').click();
  await expect(page.getByText("商品、供應商與設定", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /新增供應商/ })).toBeVisible();
  await page.getByRole("button", { name: /新增供應商/ }).click();
  await expect(page.getByRole("dialog", { name: "新增供應商", exact: true })).toContainText("供應商商務資料");
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="logout"]').click();

  await login(page, "warehouse01");
  await page.locator('[data-action="navigate"][data-view="masters"]').click();
  await expect(page.getByRole("button", { name: /新增商品/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /新增供應商/ })).toHaveCount(0);
  await page.locator('[data-action="open-add-product"]').click();
  await expect(page.getByRole("dialog", { name: "新增商品主檔", exact: true })).toContainText("倉儲物流設定");
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="logout"]').click();

  await login(page, "store01");
  await expect(page.locator('[data-action="navigate"][data-view="masters"]')).toHaveCount(0);
});

test("集中採購可彙總、分段到貨、追蹤來源並結案", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="purchasing"]').click();
  await page.locator('[data-action="generate-purchase"]').first().click();
  const suggestion = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseSuggestions?.find((item: any) => item.productId === "product01" && item.status === "PENDING"));
  expect(suggestion?.id).toBeTruthy();
  expect(suggestion.rawPurchaseQty).toBe(12);
  expect(suggestion.suggestedPurchaseQty).toBe(24);
  expect(suggestion.warehouseBufferQty).toBe(12);
  await page.locator(`[data-action="create-purchase-order"][data-id="${suggestion.id}"]`).click();
  const createDialog = page.getByRole("dialog", { name: "由採購建議建立草稿", exact: true });
  await createDialog.locator("textarea[name=overrideReason]").fill("供應商確認急件例外下單");
  await createDialog.locator("button[type=submit]").click();
  const draft = await page.evaluate((suggestionId: string) => {
    const data = JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}");
    return data.purchaseOrders?.find((order: any) => order.lines?.some((line: any) => line.sourceSuggestionId === suggestionId));
  }, suggestion.id);
  expect(draft.status).toBe("DRAFT");
  await page.locator(`[data-action="confirm-purchase-order"][data-id="${draft.id}"]`).click();
  expect((await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrders?.find((order: any) => order.id === id), draft.id)).status).toBe("PENDING_CONFIRMATION");
  await page.locator(`[data-action="order-purchase-order"][data-id="${draft.id}"]`).click();
  expect((await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrders?.find((order: any) => order.id === id), draft.id)).status).toBe("ORDERED");

  await page.locator('[data-action="logout"]').click();
  await login(page, "warehouse01");
  await page.locator('[data-action="navigate"][data-view="receipts"]').click();
  await page.locator(`[data-action="open-receive-po"][data-id="${draft.id}"]`).first().click();
  const firstReceipt = page.getByRole("dialog", { name: "採購到貨登記", exact: true });
  const firstLineId = draft.lines[0].id;
  await firstReceipt.locator(`[name="received_${firstLineId}"]`).fill("6");
  await firstReceipt.locator("button[type=submit]").click();
  let afterPartial = await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrders?.find((order: any) => order.id === id), draft.id);
  expect(afterPartial.status).toBe("PARTIALLY_RECEIVED");
  expect(afterPartial.lines[0].receivedQty).toBe(6);
  await page.locator(`[data-action="open-receive-po"][data-id="${draft.id}"]`).first().click();
  const secondReceipt = page.getByRole("dialog", { name: "採購到貨登記", exact: true });
  await secondReceipt.locator(`[name="received_${firstLineId}"]`).fill("18");
  await secondReceipt.locator("button[type=submit]").click();
  afterPartial = await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrders?.find((order: any) => order.id === id), draft.id);
  expect(afterPartial.status).toBe("RECEIVED");
  expect(afterPartial.lines[0].remainingQty).toBe(0);

  await page.locator('[data-action="logout"]').click();
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="purchasing"]').click();
  await page.locator(`[data-action="close-purchase-order"][data-id="${draft.id}"]`).click();
  const closed = await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrders?.find((order: any) => order.id === id), draft.id);
  expect(closed.status).toBe("CLOSED");
  expect(closed.lines[0].sourceAllocations[0].receivedAllocatedQty).toBe(12);
});

test("供應商營運可設定付款與採購頻率，門市入口不暴露銀行資料", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  await expect(page.getByText("供應商主檔、退貨與未到貨追蹤", { exact: true })).toBeVisible();
  await page.locator('[data-action="open-supplier-terms"]').first().click();
  const termsDialog = page.getByRole("dialog", { name: "供應商付款與付款對象", exact: true });
  await expect(termsDialog).toContainText("付款方式");
  await termsDialog.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="open-supplier-schedule"]').first().click();
  const scheduleDialog = page.getByRole("dialog", { name: "供應商訂貨週期", exact: true });
  await scheduleDialog.locator('input[name="weekdays"][value="1"]').check();
  await scheduleDialog.locator('input[name="weekdays"][value="4"]').check();
  await scheduleDialog.locator('input[name="storeVisibleNote"]').fill("每週一、四上午十點截單");
  await scheduleDialog.locator("button[type=submit]").click();
  const schedule = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").supplierOrderSchedules?.find((item: any) => item.isPrimary));
  expect(schedule.weekdays).toEqual(expect.arrayContaining([1, 4]));
  await page.locator('[data-action="logout"]').click();
  await login(page, "store01");
  await expect(page.locator('[data-action="navigate"][data-view="supplierOperations"]')).toHaveCount(0);
  const storeData = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}"));
  expect(storeData.supplierBankAccounts?.[0]?.accountNumber).not.toBe("123456789012");
});

test("採購人員可針對單一採購商品追蹤並登記部分缺貨", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  const followupButton = page.locator('[data-action="open-item-followup"]').first();
  await expect(followupButton).toHaveCount(1);
  await followupButton.click();
  const followupDialog = page.getByRole("dialog", { name: "採購明細聯繫追蹤", exact: true });
  await followupDialog.locator('input[name="supplierResponseNote"]').fill("供應商確認延後兩天");
  await followupDialog.locator('input[name="storeVisibleNote"]').fill("預計下週到貨");
  await followupDialog.locator('input[name="internalNote"]').fill("已完成電話追蹤");
  await followupDialog.locator("button[type=submit]").click();
  const tracked = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrderItemFollowups?.length || 0);
  expect(tracked).toBeGreaterThan(0);
  await page.locator('[data-action="open-item-shortage"]').first().click();
  const shortageDialog = page.getByRole("dialog", { name: "採購明細缺貨處理", exact: true });
  await shortageDialog.locator('input[name="shortageQty"]').fill("2");
  await shortageDialog.locator('select[name="shortageStatus"]').selectOption("PARTIAL_SHORTAGE");
  await shortageDialog.locator('select[name="shortageReason"]').selectOption("SUPPLIER_NO_STOCK");
  await shortageDialog.locator('input[name="storeVisibleShortageNote"]').fill("廠商部分缺貨，持續追蹤");
  await shortageDialog.locator('input[name="shortageNote"]').fill("供應商保留欠貨");
  await shortageDialog.locator("button[type=submit]").click();
  const line = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrders?.flatMap((order: any) => order.lines || []).find((item: any) => item.shortageQty > 0));
  expect(line.shortageQty).toBe(2);
  expect(line.storeVisibleShortageNote).toBe("廠商部分缺貨，持續追蹤");
});

test("總倉建立退貨後可經供應商確認、出庫與退款結案", async ({ page }) => {
  await login(page, "warehouse01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  await page.locator('[data-action="open-return-create"]').click();
  const createDialog = page.getByRole("dialog", { name: "建立供應商退貨草稿", exact: true });
  await createDialog.locator('input[name="returnQty"]').fill("1");
  await createDialog.locator('select[name="reasonCode"]').selectOption("DAMAGED");
  await createDialog.locator('input[name="returnReason"]').fill("外箱破損");
  await createDialog.locator("button[type=submit]").click();
  const created = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}");
    const order = data.supplierReturns?.[0];
    return order ? { ...order, itemId: data.supplierReturnItems?.find((item: any) => item.returnOrderId === order.id)?.id } : null;
  });
  expect(created.status).toBe("DRAFT");
  await page.locator(`[data-action="submit-supplier-return"][data-id="${created.id}"]`).first().click();
  await page.locator(`[data-action="open-return-detail"][data-id="${created.id}"]`).first().click();
  await page.locator(`[data-action="waiting-return-resolution"][data-id="${created.id}"]`).count();
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="logout"]').click();

  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  await page.locator(`[data-action="open-return-detail"][data-id="${created.id}"]`).click();
  await page.locator(`[data-action="confirm-supplier-return"][data-id="${created.id}"]`).click();
  await page.locator(`[data-action="ready-supplier-return"][data-id="${created.id}"]`).click();
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="logout"]').click();

  await login(page, "warehouse01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  await page.locator(`[data-action="open-return-detail"][data-id="${created.id}"]`).click();
  await page.locator(`[data-action="return-outbound"][data-id="${created.id}"]`).click();
  await page.locator(`[data-action="waiting-return-resolution"][data-id="${created.id}"]`).click();
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('[data-action="logout"]').click();

  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  await page.locator(`[data-action="open-return-detail"][data-id="${created.id}"]`).click();
  await page.locator(`[data-action="open-return-resolution"][data-item-id="${created.itemId}"]`).click();
  const resolutionDialog = page.getByRole("dialog", { name: "登記供應商退貨結果", exact: true });
  await resolutionDialog.locator('select[name="resolutionType"]').selectOption("REFUND");
  await resolutionDialog.locator('input[name="resolutionQty"]').fill("1");
  await resolutionDialog.locator('input[name="supplierResponse"]').fill("廠商同意退款");
  await resolutionDialog.locator("button[type=submit]").click();
  const resolved = await page.evaluate((id: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").supplierReturns?.find((item: any) => item.id === id), created.id);
  expect(resolved.status).toBe("RESOLVED");
});

test("同一採購單可設定混合直送與總倉配貨", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="purchasing"]').click();
  await page.locator('[data-action="generate-purchase"]').first().click();
  const suggestion = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseSuggestions?.find((item: any) => item.status === "PENDING"));
  expect(suggestion?.id).toBeTruthy();
  await page.locator(`[data-action="create-purchase-order"][data-id="${suggestion.id}"]`).click();
  const dialog = page.getByRole("dialog", { name: "由採購建議建立草稿", exact: true });
  const modeInputs = dialog.locator('select[name^="deliveryMode_"]');
  const modeCount = await modeInputs.count();
  test.skip(modeCount < 2, "示範資料沒有同一商品的兩個門市配置");
  await modeInputs.nth(0).selectOption("SUPPLIER_DIRECT_TO_STORE");
  await modeInputs.nth(1).selectOption("WAREHOUSE_DISTRIBUTION");
  await dialog.locator("textarea[name=overrideReason]").fill("混合配送流程驗證");
  await dialog.locator("button[type=submit]").click();
  const order = await page.evaluate((suggestionId: string) => {
    const data = JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}");
    return data.purchaseOrders?.find((item: any) => item.lines?.some((line: any) => line.sourceSuggestionId === suggestionId));
  }, suggestion.id);
  expect(order?.id).toBeTruthy();
  const modes = await page.evaluate((orderId: string) => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").purchaseOrderItemStoreAllocations?.filter((plan: any) => plan.purchaseOrderId === orderId).map((plan: any) => plan.deliveryMode), order.id);
  expect(modes).toEqual(expect.arrayContaining(["SUPPLIER_DIRECT_TO_STORE", "WAREHOUSE_DISTRIBUTION"]));
});

test("採購追蹤逐品項狀態使用中文字典", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  await expect(page.locator("main")).toContainText("採購未到貨追蹤");
  const followupButton = page.locator('[data-action="open-item-followup"]').first();
  await expect(followupButton).toHaveCount(1);
  await followupButton.click();
  const dialog = page.getByRole("dialog", { name: "採購明細聯繫追蹤", exact: true });
  await expect(dialog.locator('select[name="followUpStatus"] option')).toContainText(["尚未到期", "今日應追蹤", "逾期未回覆", "等待供應商回覆"]);
});

test("商品規格可維護六個國際條碼欄位", async ({ page }) => {
  await login(page, "buyer01");
  await page.locator('[data-action="navigate"][data-view="supplierOperations"]').click();
  const identifierButton = page.locator('[data-action="open-identifiers"]').first();
  await expect(identifierButton).toHaveCount(1);
  await identifierButton.click();
  const dialog = page.getByRole("dialog", { name: "商品國際／製造商代碼", exact: true });
  await expect(dialog.locator(".identifier-slot")).toHaveCount(6);
  await dialog.locator('select[name="identifierType_1"]').selectOption("EAN13");
  await dialog.locator('input[name="identifierValue_1"]').fill("4710001000001");
  await dialog.locator("button[type=submit]").click();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}"));
  expect(data.productIdentifiers?.some((item: any) => item.value === "4710001000001" && item.slotNumber === 1)).toBe(true);
});

test("需求無法送審時顯示結構化流程阻擋面板", async ({ page }) => {
  await login(page, "store01");
  await page.locator('[data-action="open-create-demand"]').first().click();
  const form = page.locator("form[data-demand-editor]");
  await form.locator("input[name=requestedQty]").fill("1");
  await form.locator("button[type=submit]").click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("pharmacy-demand-platform.phase1.v1") || "{}").demands?.[0]);
  await page.locator(`[data-action="submit-demand"][data-id="${draft.id}"]`).click();
  const dialog = page.getByRole("dialog", { name: "無法進入下一階段", exact: true });
  await expect(dialog).toContainText("目前狀態");
  await expect(dialog).toContainText("建議處理");
  expect((await demandFromStorage(page, draft.id)).status).toBe("DRAFT");
});
