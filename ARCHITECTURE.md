# 系統架構

## Phase 1 驗證版

目前可直接開啟的網站是瀏覽器端的流程驗證層：

- `index.html`：頁面容器與語意化入口。
- `styles.css`：響應式內部作業台介面。
- `app.js`：畫面渲染、角色導覽、表單、流程狀態與本機資料操作。
- `domain.js`：純函式業務計算，可獨立測試。
- `replenishment-workflow.js`：自動補貨確認、店長核單與 localStorage rollback 的純函式邊界。
- `procurement-workflow.js`：集中採購彙總、Decimal-safe 金額、採購單狀態、來源分配、到貨/取消/結案與角色能力的純函式邊界。
- `localStorage`：模擬登入 Session 與交易後的資料持久化，方便在沒有後端環境時驗證流程。

資料仍以同一份 domain model 組織，並對應到 `schema.sql` 的 PostgreSQL 資料表；因此後續可將 `app.js` 的 mutation handlers 換成 API client，而不必重寫畫面與業務公式。

## 正式化路線

目標架構為模組化單體：Next.js + TypeScript + Prisma + PostgreSQL。API 層應以 service boundary 封裝：

1. `auth`：帳號密碼、Session、角色與門市資料隔離。
2. `master-data`：locations、products、suppliers、supplier_products、補貨參數。
3. `inventory`：餘額、異動與 transaction。
4. `demand`：人工需求、自動補貨確認與狀態流轉。
5. `allocation`：總倉配貨、揀貨、出貨、門市簽收。
6. `purchasing`：依核准後缺口集中彙總、MOQ/倍數/最低金額檢核、採購單生命週期、部分到貨、未到貨追蹤、取消/結案與需求來源多對多關聯。
7. `audit`：重要操作的 before/after JSON 與操作者。

正式 API 的所有寫入都必須在 server-side transaction 執行；瀏覽器端的 localStorage 只保留在工具驗證版，不視為安全邊界或多使用者資料庫。

## 集中採購資料流

採購工作流以 `demand_orders` 的核准後狀態為入口，先由 `procurement-workflow.js` 計算每一筆需求明細的剩餘採購缺口，再以主要供應商、商品及採購條件彙總。建議轉成採購單草稿時建立 `demand_purchase_allocations`，因此採購單明細同時保留門市來源需求與未分配的總倉備貨量。採購草稿編輯器再以同供應商啟用供應品為範圍加入人工品項；`mergePurchaseOrderItems` 以商品為 key 合併同品項，將 `suggested_purchase_qty + manual_added_qty` 重新套用 MOQ/倍數，並把人工數量留在 `warehouse_buffer_qty`，不建立需求分配。採購單與明細來源分別標示 `PURCHASE_SUGGESTION`、`MANUAL`/`MANUAL_WAREHOUSE_STOCK` 或 `MIXED`；到貨交易一次更新採購單、來源分配、總倉 `inventory` 與 receipt/audit log，之後仍由既有 allocation/門市 receiving 流程完成門市補貨。

正式化時，localStorage mutation handlers 應替換為 `purchasing` service：以資料庫 row lock 保護採購單號與剩餘量，以 `numeric(12,2)` 保存金額，並在同一 transaction 寫入 `inventory_movements`、`purchase_receipt_logs`、`demand_purchase_allocations` 及 `audit_logs`。前端的角色按鈕只改善操作體驗，不能取代 API 的 RBAC 與 STORE `location_id` 資料範圍檢查。

## 主檔管理服務邊界

主檔頁面共用商品、供應商與商品供應商設定畫面，但寫入會依角色拆成明確服務：商品基本、商品倉儲物流、商品採購設定、供應商商務、供應商收貨備註與商品供應商關係。PURCHASING、WAREHOUSE、ADMIN 的可編輯欄位在 UI 與 service 兩端都檢查，STORE 只保留查詢權限。商品採購狀態由有效主要供應商與必要採購條件推導；採購流程在彙總、人工新增與採購單確認再次拒絕未完成設定的商品。

驗證版 master-data-workflow.js 以 clone state + commit result 模擬 transaction；正式 API 必須把主要供應商切換、商品與採購條件同時更新、狀態轉為 PURCHASABLE 與 audit 寫入放在 PostgreSQL transaction，並以 version/updated_at 處理多人同時編輯。

## 目前刻意未處理

SSO、OAuth、MFA、POS API、供應商入口、會計/發票、複雜簽核、即時通知、檔案上傳與雲端部署資料庫不在 Phase 1 驗證版內。

## 集中採購工作台迭代

集中採購仍以 `procurement-workflow.js` 作為純函式 service boundary：採購建議先按供應商/商品/採購條件分組，工作台可加入同供應商啟用商品；建立草稿時以商品為 key 合併系統建議與人工追加，並同步產生 `purchase_order_item_sources`。來源數量、MOQ/倍數造成的總倉備貨、採購確認量與門市預計配貨量分開保存，避免只留下合計數字。

`buildProcurementProductSnapshot` 將既有 `inventory`、`monthly_product_sales`、需求、實際配貨與採購單資料組合成同一商品的門市/總倉矩陣。六個完整月份由 reference date 計算，總倉銷售為 N/A；`purchase_order_item_store_allocations` 只保存到貨後的規劃，實際庫存仍由既有總倉出貨與門市簽收 service 改變。前端以角色篩選 STORE 的 location scope，正式 API 仍需重新做 RBAC。

無成團與重新開啟沿用不可變 state transaction 邊界：`NO_GROUP` 只更新採購建議、來源需求狀態、status log 與 audit，不建立採購單；重新開啟保留歷史並回到 `REOPENED`/`WAITING_AGGREGATION`。正式化時應將同一邏輯搬入 server-side transaction，鎖定採購建議、採購明細與需求明細，確保狀態回覆和來源資料不會部分成功。
