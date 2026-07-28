# 測試方式

## 純函式測試

`tests/domain.test.mjs` 覆蓋：

- 自動補貨觸發條件與預估庫存。
- 最低補貨量與門市配貨倍數向上取整。
- 供應商 MOQ 與採購倍數向上取整。
- 需求未完成數量不會小於零。

在已安裝 Node.js LTS 的環境執行：

```bash
npm run test:unit
```

## Playwright 流程測試

`tests/e2e.spec.ts` 提供登入頁、需求/店長流程與集中採購主流程。完整 e2e 執行前需安裝 Playwright、先啟動 `start-local-server.ps1`，再執行：

```bash
npm run test:e2e
```

## 手動驗證劇本

1. 首次開啟先設定本機示範密碼，再使用 `store01` 登入。
2. 在「自動補貨建議」執行本門市計算，確認建議量符合安全庫存、最低量與門市倍數。
3. 在「門市需求池」建立草稿，確認條件後送店長核單。
4. 登出改用同門市的 `store01_manager`，核准或退回需求；退回後以 `store01` 修改並再次送審。
5. 核准後再由 `warehouse01` 建立配貨單並標記出貨，最後用 `store01` 在「到貨與簽收」輸入實收數量完成簽收。
6. 使用 `buyer01` 產生集中採購建議，確認供應商 MOQ/倍數/最低金額，建立草稿、確認、標記已下單。
7. 使用 `warehouse01` 登記部分到貨與剩餘到貨，確認採購單、來源分配與總倉庫存同步；再由 `buyer01` 查看來源追蹤並結案。
8. 用 `admin` 查看主檔、使用者與操作紀錄；用「重設示範資料」恢復固定 seed。

目前系統 PATH 沒有 Node.js/npm；本次使用工作區 bundled Node 執行單元測試與 production build，Playwright、TypeScript compiler 與 ESLint 則尚未配置。

## 人工需求模組回歸範圍

`tests/domain.test.mjs` 現在涵蓋：

- `DRAFT` / `RETURNED` 可編輯，其他人工需求狀態不可編輯。
- 門市最低條件四種模式：數量、金額、擇一、雙重條件。
- 前六個完整月份、不含當月、缺漏月份補零、門市/商品隔離。
- 明細金額、供應商彙總與既有自動補貨 AC-01～AC-04。

執行方式：

```powershell
npm run test:unit
npm run test:e2e
```

人工需求瀏覽器驗收至少包含：門市建立草稿、送店長核單、一般門市不可核單、同店店長核准/退回、退回後修改再送審、條件不符阻擋、供應商 MOQ 僅提示、六個月份銷售與目前庫存顯示，以及 ADMIN CSV upsert。現有專案尚未配置 TypeScript compiler 或 ESLint；若執行環境未提供 `tsc`/`eslint`，需在交付報告中標示為未配置，而不擅自引入新的工具鏈。

## 系統管理員密碼重設測試

`tests/admin-reset-password.test.mjs` 覆蓋：成功重設、舊／新密碼驗證、非 ADMIN、停用帳號、缺少環境變數、username 參數、弱密碼、audit 敏感資料排除、更新或 audit 失敗 rollback、帳號不存在，以及 `must_change_password=true`。測試使用 transaction fake，不會連線或修改實際資料庫，也不會保存可用的測試密碼。

## 自動補貨與店長核單測試

`tests/replenishment-manager.test.mjs` 覆蓋 33 項純函式案例，包含 AC-01～AC-20 對應的狀態流轉、門市/店長數量保留、調整原因、同門市權限、草稿與退回、四種門市條件、供應商提示、六個完整月份、庫存快照/變動、未完成需求剩餘量、重複轉單防護及 transaction rollback。既有 `tests/domain.test.mjs` 的補貨計算與未完成需求測試仍必須全部通過。

瀏覽器主流程應驗證：自動建議不進總倉、門市查看庫存與六個月銷售後可修改數量並填原因、確認後只建立 AUTO `DRAFT`、送店長後一般 STORE 無核准按鈕、同店店長可直接核准或修改後核准、核准摘要顯示系統/門市/店長/最終數量、總倉只看到 `SUBMITTED` AUTO 需求、條件不符阻擋且供應商 MOQ 僅提示。另有退回流程：`PENDING_MANAGER_APPROVAL → RETURNED → PENDING_MANAGER_APPROVAL → SUBMITTED`。

## 集中採購模組測試

`tests/procurement.test.mjs` 覆蓋 34 項採購工作流純函式案例：

- 只有四種核准後需求狀態進入採購池，並扣除有效採購分配/取消量。
- 依供應商、商品、採購單位、倍數與 MOQ 彙總，保留來源門市/需求明細。
- MOQ、倍數向上取整，以及多採購量歸入總倉備貨。
- 供應商最低金額、整數分金額精度與例外原因必填。
- 不同供應商分單、建議轉草稿、重複轉單阻擋、手動採購單來源。
- DRAFT/PENDING/ORDERED/PARTIAL/RECEIVED/CLOSED/CANCELLED 狀態與編輯限制。
- 來源需求多對多關聯、部分/全部到貨、超額到貨拒絕、總倉庫存增加與 transaction rollback。
- 整張/剩餘取消、需求回補、結案條件及 PURCHASING/WAREHOUSE/ADMIN/STORE 權限邊界。
- 採購明細保留原始需求、門市分配、總倉補充、系統建議、確認量與倍數增加量；管理頁的需求單號/來源門市/日期/狀態/部分到貨/例外下單/排序篩選與採購單複製入口。
- `tests/procurement-merge.test.mjs` 覆蓋建議品項與同供應商人工品項的草稿合併：來源類型、同商品合併、MOQ/倍數重算、需求分配保留、人工數量列總倉備貨、來源/理由/操作者/時間欄位、不同供應商/停用商品/條件衝突/重複品項/空原因/無效數量阻擋，以及草稿異動與 `ORDERED` 鎖定規則。

執行集中採購測試：

```powershell
node --test tests/procurement.test.mjs tests/procurement-merge.test.mjs
```

Playwright 採購主流程為：既有需求進入待採購池 → buyer 彙總 → 檢查供應商條件 → 建立草稿/確認/下單 → warehouse 分段到貨 → buyer 查看來源與結案。若環境沒有 Playwright runner，需回報未執行，不可刪除或跳過測試。

## 集中採購工作台迭代測試

## 供應商營運模組測試

`tests/supplier-operations.test.mjs` 現已覆蓋 47 項案例，包括：

- 付款條件/付款方式分離、`OTHER` 說明必填、統一編號重複與管理員例外；訂貨廠商/收款廠商關係、停用供應商阻擋、採購單快照與採購頻率下一次日期。
- 多銀行帳戶單一主要帳戶、帳號遮罩、audit 遮罩、附件私有 storage key、檔案類型/大小限制及 STORE/WAREHOUSE 不可取得帳戶或附件。
- GTIN-14、EAN-13、UPC-A、JAN、Manufacturer Item Code 格式與唯一性；逐商品未到貨備註歷程及門市公開/內部欄位隔離。
- 部分缺貨、缺貨數量上限、取消後剩餘量、來源門市分攤、完整缺貨重新放回採購池、替代商品/供應商及原採購單保留。
- 退貨草稿不扣庫存、批號/效期要求、待退保留、退貨出庫與 inventory movement、重複出庫阻擋、退款/折讓/廠商拒絕、來源需求回寫、換貨到貨只增加總倉庫存、結案與 unresolved 數量。

```powershell
node --check supplier-operations-workflow.js
node --test tests/supplier-operations.test.mjs
```

正式 PostgreSQL adapter 應再以 integration test 驗證 migration、transaction rollback、私有附件下載授權與來源需求回寫；目前 Phase 1 的 localStorage service 以 clone/commit 方式模擬同一 transaction 邊界。

## 供應商與商品主檔權限測試

tests/master-data.test.mjs 覆蓋主檔服務的角色白名單、建立商品/供應商/商品供應商關係、主要供應商唯一性與切換、商品 PENDING_PURCHASE_SETUP → PURCHASABLE、非可採購商品阻擋採購、before/after audit、價格欄位稽核、optimistic locking、交易 rollback、STORE 唯讀、WAREHOUSE 庫存權限及供應商商務/收貨欄位隔離。

Playwright 主檔流程應驗證：PURCHASING 建立供應商與商品供應商設定、WAREHOUSE 建立無供應商商品並補充物流欄位、PURCHASING 完成採購條件後狀態變成可採購、ADMIN 切換主要供應商、STORE 不可開啟主檔維護頁，以及不同角色的唯讀欄位仍清楚顯示。正式驗證需執行：

node --test tests/master-data.test.mjs

`tests/procurement-merge.test.mjs` 現已覆蓋 38 項案例：同供應商追加、不同供應商排除、停用供應品、手動原因與 OTHER 說明、同商品來源合併、來源數量保存、五店/總倉庫存、2026-07-23 前六個完整月份與缺月補零、總倉 N/A、採購未到/待配貨/已配貨未簽收/未完成需求快照、門市配貨上限與超額原因、無成團/整批無成團/歷史/重新開啟/回滾及已轉單阻擋。

本次驗證指令：

```powershell
node --check app.js
node --check procurement-workflow.js
node --test tests/procurement-merge.test.mjs tests/procurement.test.mjs
```

Playwright 主要流程應依序驗證：採購人員開啟供應商工作台 → 查看五店與總倉庫存/銷售 → 加入同供應商商品 → 填手動數量與原因 → 設定門市預計配貨 → 建立同一張採購單 → 查看來源與總倉留存；另驗證商品/整批無成團、門市查看自己的原因與日期、重新開啟後回到採購池，以及 STORE 不可看到其他門市資料。
