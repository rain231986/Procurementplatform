# PharmaFlow 藥局供應協作平台

PharmaFlow 是給 5 家藥局門市、1 個總倉與集中採購部門使用的 Phase 1 流程驗證版。它把「門市提出需求 → 總倉配貨 → 缺口集中採購 → 到貨 → 再配貨 → 門市簽收」串成一條可操作的工作流。

## 已完成模組

- 簡化帳號密碼登入、四種角色與門市資料隔離。
- 需求池：人工需求、特殊需求原因、送出、核准、進度查看。
- 自動補貨：安全庫存、最高庫存、最低補貨量、門市配貨倍數。
- 總倉配貨：可用庫存檢查、部分配貨、揀貨、出貨。
- 集中採購與採購單管理：跨門市核准需求彙總、主要供應商、MOQ/倍數/最低金額檢核、例外下單、草稿/確認/下單/到貨/取消/結案、來源需求與總倉備貨追蹤。
- 到貨與簽收：採購部分到貨、總倉入庫、配貨出貨、門市實收。
- 管理：商品、供應商、補貨參數、庫存人工調整、使用者與操作紀錄。
- 固定 seed：5 間門市、1 個總倉、20 項商品、3 家供應商、需求/配貨/採購測試資料。

## 技術邊界

目前網站保留既有「無建置工具、可直接啟動」的原型結構，以 ES modules + CSS + localStorage 驗證完整流程；`schema.sql` 與 `docker-compose.yml` 已提供 PostgreSQL 16 的資料契約與本機資料庫入口，便於下一階段接上 Next.js/TypeScript/Prisma API。

正式化時應使用 Node.js LTS、Next.js、Prisma、PostgreSQL、Tailwind CSS、Vitest 與 Playwright。這個工作區保留無建置工具的原型結構；驗證版可使用工作區 bundled Node 執行純函式測試與 static build，TypeScript compiler、ESLint、Prisma CLI 與 Playwright runner 仍需由正式專案工具鏈提供。

## 本機使用

直接執行：

```powershell
./start-local-server.ps1
```

開啟 <http://localhost:8787/>。停止服務：

```powershell
./stop-local-server.ps1
```

第一次使用先在登入頁設定一組至少 6 個字元的本機示範密碼，再使用下列帳號登入：

| 帳號 | 角色 | 範圍 |
| --- | --- | --- |
| `admin` | ADMIN | 全部功能 |
| `store01` ~ `store05` | STORE | 綁定各自門市 |
| `warehouse01` | WAREHOUSE | 總倉及全門市需求 |
| `buyer01` | PURCHASING | 集中採購及到貨 |

示範密碼只保存在本機瀏覽器。正式 seed 應改由 `.env` 的 `SEED_DEFAULT_PASSWORD` 取得，再由後端以 bcrypt/argon2 雜湊，不應把密碼寫入程式碼。

## PostgreSQL 契約

```powershell
docker compose up -d postgres
```

`schema.sql` 會建立 locations、users、products、suppliers、補貨、庫存、需求、配貨、採購、需求採購關聯、採購異動/追蹤/到貨紀錄與 audit logs 等資料表。既有 PostgreSQL 環境可套用 `migrations/005_centralized_procurement_management.sql`；正式 Prisma migration/seed 尚未接入此靜態驗證層，詳細邊界見 `ARCHITECTURE.md` 與 `DATABASE.md`。

## 測試

```powershell
npm run test:unit
npm run test:e2e
```

測試案例、手動驗證劇本與環境限制請見 `TESTING.md`。`domain.js` 的補貨計算與 `procurement-workflow.js` 的集中採購/採購單計算為純函式，避免被畫面狀態耦合。

## 供應商與商品主檔管理

「主檔與庫存」現在由採購人員與倉管共同維護：採購負責供應商商務、商品供應商關係與採購條件；倉管負責商品基本/物流設定、庫存調整與供應商收貨備註；ADMIN 擁有全部權限；STORE 不進入主檔維護頁。商品尚未完成有效主要供應商與必要採購條件時會顯示「待完成採購設定」，不會進入集中採購建議或採購單。

每次主檔修改都保存角色、時間與前後差異，並使用版本欄位避免覆蓋他人最新修改。既有補貨公式、需求核單、總倉配貨、到貨簽收與採購數量計算未改動。既有 PostgreSQL 可套用 migrations/007_master_data_roles_and_settings.sql；初始 schema 已同步。

## 已知限制與下一階段

- localStorage 只適合單機流程驗證，不是正式多使用者資料庫，也不提供真正的後端授權邊界。
- 本版本的瀏覽器密碼設定使用 Web Crypto SHA-256 供本機演示；正式環境必須改成 server-side bcrypt/argon2、Session cookie 與 API RBAC。
- PostgreSQL schema 與 Docker Compose 已提供，但尚未由此靜態頁面連線；下一階段接上 Next.js API、Prisma migration/seed、transaction、CSV 匯入與完整 Playwright flow。
- 尚未包含 SSO、POS、會計、發票、供應商入口、行動 App、複雜簽核與訊息佇列。

## 集中採購操作流程

`buyer01` 在「集中採購與採購單管理」執行重新彙總後，系統只取 `SUBMITTED`、`PROCESSING`、`PARTIALLY_ALLOCATED`、`WAITING_PURCHASE` 的未滿足需求，按主要供應商與採購條件分組。採購建議會同時顯示原始需求、門市需求分配、總倉補充、MOQ/倍數造成的多買備貨量、參考單價與最低金額提示；管理頁提供需求單號、來源門市、日期、狀態、部分到貨、例外下單與排序篩選。

由建議建立的採購單會先是 `DRAFT`，經正式檢核後進入 `PENDING_CONFIRMATION`，標記已向供應商下單後為 `ORDERED`。在草稿編輯器中，採購人員可按「新增同供應商商品」，搜尋商品代碼、名稱、條碼、規格或供應商貨號，只能選擇該供應商的啟用供應品；人工品項需填原因，與既有建議同商品且採購條件一致時會合併成一列，採購單來源會標為 `MIXED`。人工數量只列總倉備貨，不會被分配給門市需求；不同單位、單價、MOQ 或倍數會被阻擋，避免靜默重複明細。`warehouse01` 可在「到貨與門市簽收」對已下單採購單登記部分或全部到貨；到貨只增加總倉庫存，來源需求仍需經總倉配貨與門市簽收。採購人員可在詳情查看門市/需求分配、人工新增數量/原因/操作者/時間、原始/建議/確認/補充量、未到貨追蹤、複製草稿、取消剩餘數量與結案。

## 人工需求單驗證流程

示範帳號除一般 `store01`～`store05` 外，每個門市另有店長帳號 `store01_manager`～`store05_manager`。人工需求單會先儲存為 `DRAFT`，符合門市條件後送為 `PENDING_MANAGER_APPROVAL`；同店店長或 `admin` 可核准成 `SUBMITTED`，也可填寫原因退回 `RETURNED`。

商品明細會顯示登入門市的目前庫存、前六個完整月份銷售、參考進貨價、明細金額、門市最低條件與供應商提示。ADMIN 在「主檔與庫存」可匯入月銷售 CSV，欄位為 `location_code,product_code,sales_year,sales_month,sales_qty`，相同門市/商品/年月會更新既有資料。

## 系統管理員密碼重設

正式 PostgreSQL 帳號的管理員密碼重設只能在主機端或本機終端機執行：

```powershell
$env:ADMIN_RESET_PASSWORD = "<只存在於目前終端機的密碼>"
npm run admin:reset-password -- --username admin
```

`ADMIN_RESET_PASSWORD` 不可放入命令參數、程式碼、Git 或輸出；`.env.example` 只保留空值範例。CLI 只允許啟用中的 `ADMIN`，會以 bcrypt 寫入新 hash、設定 `must_change_password` 並在同一 transaction 寫入 audit。下次登入成功後，帳號必須先完成符合政策的改密碼流程。此功能不提供公開忘記密碼頁面或電子郵件重設。

## 自動補貨建議與店長核單

自動補貨現在先產生 `GENERATED` 建議，由門市逐筆或批次接受、保存 `ACCEPTED/ADJUSTED` 確認後轉成 AUTO `DRAFT`；門市送審進入 `PENDING_MANAGER_APPROVAL`，同門市店長或 ADMIN 才能直接核准、修改後核准或退回。只有核准後的 `SUBMITTED` 需求會出現在總倉配貨作業，避免自動建議直接流入配貨或採購。

每筆 AUTO 需求保留系統、門市、店長與最終數量，並保存庫存快照、前六個完整月份銷售與補貨異動 log。正式 PostgreSQL 契約及增量 migration 分別在 `schema.sql`、`migrations/004_auto_replenishment_manager_flow.sql`；驗證版以 `replenishment-workflow.js` 的純函式與 localStorage rollback 模擬 transaction 邊界。

## 集中採購工作台迭代

採購工作台依供應商分組，採購人員可在同一供應商下搜尋並手動追加啟用商品；手動追加需填數量與原因，和同商品的系統建議會合併為同一筆採購明細。明細同時保留需求、總倉補充、人工追加、系統建議、確認採購與總倉備貨數量，來源追蹤寫入 `purchase_order_item_sources`。

商品的庫存/銷售展開矩陣顯示五家門市與總倉；門市顯示前六個完整月份（不含當月，缺月補 0），總倉銷售顯示 N/A。採購人員可設定每家門市的預計配貨量，但該規劃不會直接異動庫存；超過需求需填原因，剩餘量列總倉備貨。商品或尚未轉單的同供應商批次若未達條件，可填原因標記 `NO_GROUP`；來源門市可看到結果，採購人員可保留歷史後重新開啟。

本迭代資料庫增量 migration 為 `migrations/006_procurement_grouping_distribution_no_group.sql`，對應 `purchase_order_item_sources`、`purchase_order_item_store_allocations` 與 `procurement_status_logs`。詳細規則、資料契約與測試流程分別見 `BUSINESS_RULES.md`、`DATABASE.md`、`ARCHITECTURE.md`、`TESTING.md`。
