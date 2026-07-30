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
- 供應商營運：訂購／付款供應商分離、付款方式、訂貨週期、銀行帳戶與私有附件 metadata、五種國際商品代碼、採購明細缺貨／未到貨追蹤、重新納池與供應商退貨處理。
- 固定 seed：5 間門市、1 個總倉、20 項商品、3 家供應商、需求/配貨/採購測試資料。

## 技術邊界

目前網站保留既有 ES modules + CSS 畫面與純函式業務模組，並提供兩種執行模式：一般本機啟動仍以 localStorage 驗證單機流程；Cloudflare Workers 部署則透過 `/api`、HttpOnly Session Cookie 與 D1 共用狀態快照，供 Phase 1 多人測試。`schema.sql` 與 `docker-compose.yml` 仍是正式 PostgreSQL 16 的逐表資料契約。

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

## Cloudflare 共用測試環境

Cloudflare 版本由同一個 Worker 提供靜態網站與 `/api`，D1 綁定名稱為 `DB`。測試密碼只設定為 Cloudflare Secret `PHARMAFLOW_TEST_PASSWORD`，至少 12 個字元，不得寫入 Git、指令參數或執行輸出。第一次登入必須使用 `admin`，由管理員把固定 seed 初始化至 D1；之後同仁才會共用相同需求、庫存、配貨與採購測試資料。

本機驗證：

```powershell
Copy-Item .dev.vars.example .dev.vars
# 在 .dev.vars 的 PHARMAFLOW_TEST_PASSWORD 填入只供本機測試的值，檔案已被 Git 忽略
pnpm run build
pnpm run cloudflare:d1:migrate:local
pnpm run dev:cloudflare
```

正式發布前需登入 Wrangler、建立並綁定 D1、套用 `worker/migrations`、設定 Cloudflare Secret，再執行 `pnpm run cloudflare:deploy`。Cloudflare 設定檔為 `wrangler.jsonc`；實際密碼、Token 與 OAuth 憑證不得提交。

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

- localStorage 模式只適合單機流程驗證；Cloudflare 模式雖可多人共用 D1，但 Phase 1 仍以整體狀態快照同步，不是逐個業務實體的正式 transaction API。
- D1 快照使用 revision 做樂觀鎖定；同時修改發生衝突時會重新載入最新資料，使用者需重做未儲存操作。
- Worker 會以 Session 檢查登入角色，並保護使用者、據點與供應商銀行資料；完整 STORE `location_id` 欄位級授權仍應在下一階段拆成 demand、allocation、purchasing、receiving API 後逐筆執行。
- 本版本的瀏覽器密碼設定使用 Web Crypto SHA-256 供本機演示；正式環境必須改成 server-side bcrypt/argon2、Session cookie 與 API RBAC。
- PostgreSQL schema 與 Docker Compose 已提供，但 Cloudflare Phase 1 不會直接連線 PostgreSQL；下一階段需將快照寫入改成逐表 service、transaction、CSV 匯入與完整 Playwright flow。
- 尚未包含 SSO、POS、會計、發票、供應商入口、行動 App、複雜簽核與訊息佇列。

## 供應商退貨、缺貨與未到貨追蹤

「供應商營運」頁面依角色提供不同操作：採購管理供應商付款條件、訂購／付款對象、訂貨週期、銀行帳戶、商品國際代碼、逐採購明細聯繫與缺貨處理；採購單草稿可明確選擇付款供應商，正式下單保存訂購／付款快照；總倉建立退貨草稿、上傳退貨附件、執行退貨出庫及登記替代品到貨；來源門市只在自己的需求進度看到供應商頻率、下次訂貨日、預計到貨、已到／未到／缺貨／重新採購與門市可見備註。

採購明細的缺貨數量永遠不得超過尚未到貨量；部分到貨不會改寫原始採購量，缺貨可標記暫時/長期缺貨、替代來源、重新納入採購池或無成團。原採購單與缺貨來源保留不刪除。供應商退貨依 `DRAFT → PENDING_SUPPLIER_CONFIRMATION → SUPPLIER_CONFIRMED → READY_TO_RETURN → RETURNED_TO_SUPPLIER → RESOLVED` 流轉；草稿不動庫存，準備退貨保留總倉數量，正式退貨出庫才寫入 inventory movement，替代品只增加總倉庫存，不直接增加門市庫存。

付款、銀行帳戶與附件不執行付款或會計傳票。銀行帳號畫面預設遮罩，只有採購／管理員明確操作可暫時查看完整帳號；附件只保存檔名、類型、大小與 private `storage_key`；銀行附件不得提供給 STORE/WAREHOUSE，退貨附件則只提供給 PURCHASING/WAREHOUSE/ADMIN。不可保存明碼密碼或公開永久 URL。正式環境應將 `supplier-operations-workflow.js` 的 metadata adapter 接到需要登入與角色檢查的私有物件儲存下載服務。既有採購數量、配貨、收貨、自動補貨與需求核單核心公式未修改；SQL 增量契約在 `migrations/008_supplier_returns_shortage_tracking.sql`。

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

## 到貨簽收、採購追蹤中文化、商品多條碼與流程阻擋

採購單可在每個商品／門市配置「廠商直送門市」或「總倉配貨」，同一張採購單可以混合兩種方式。直送只在門市簽收時增加門市庫存；總倉配貨依序經過總倉收貨、總倉出貨、門市簽收，避免提前或重複異動。採購追蹤、缺貨、到貨狀態、CSV 與列印使用 `workflow-status-dictionary.js` 的共用中文標籤。

商品識別碼以 `product_identifiers` 支援同一商品／規格最多六個啟用中的國際碼，畫面提供六個固定欄位，不覆寫既有商品條碼；採購、倉管、管理員可維護，門市僅查看。需求送審、店長核准與採購確認／下單前會重新檢核必要資料，失敗時顯示結構化阻擋項目並寫入可去重、可解除的 `workflow_block_events`。

本迭代 migration 為 `migrations/009_receiving_delivery_modes_workflow_blocks.sql`；詳細規則、資料契約、架構與測試請見 `BUSINESS_RULES.md`、`DATABASE.md`、`ARCHITECTURE.md`、`TESTING.md`。本次未改動自動補貨公式、登入／角色、總倉配貨既有需求分配規則或會計傳票。

## 門市橫向調撥、安全庫存與退貨

門市可建立跨店調撥，經來源店長核准後出貨，目的店簽收才增加庫存；安全庫存會在核准時限制可調撥量，ADMIN 可用原因覆核。門市也可依流程退回總倉或直接退廠商，包含拒收退回門市、換貨回店及附件 metadata。採購單缺貨則以單一商品明細追蹤，不會把整張採購單誤標為缺貨。

本迭代新增 `store-operations-workflow.js`、`migrations/010_store_operations.sql` 與 `tests/store-operations.test.mjs`，並將共用商品表格的欄位換行／最小寬度規則整合至 `styles.css`。完整規則與資料契約請見 `BUSINESS_RULES.md`、`DATABASE.md`、`ARCHITECTURE.md`、`TESTING.md`。

本機驗證可直接使用 bundled Node 或已安裝的 npm：

```powershell
node --test tests/store-operations.test.mjs
powershell -ExecutionPolicy Bypass -File .\build-static-site.ps1
```
