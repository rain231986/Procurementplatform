# 系統架構

## Phase 1 驗證版

目前可直接開啟的網站是瀏覽器端的流程驗證層：

- `index.html`：頁面容器與語意化入口。
- `styles.css`：響應式內部作業台介面。
- `app.js`：畫面渲染、角色導覽、表單、流程狀態與本機資料操作。
- `domain.js`：純函式業務計算，可獨立測試。
- `localStorage`：模擬登入 Session 與交易後的資料持久化，方便在沒有後端環境時驗證流程。

資料仍以同一份 domain model 組織，並對應到 `schema.sql` 的 PostgreSQL 資料表；因此後續可將 `app.js` 的 mutation handlers 換成 API client，而不必重寫畫面與業務公式。

## 正式化路線

目標架構為模組化單體：Next.js + TypeScript + Prisma + PostgreSQL。API 層應以 service boundary 封裝：

1. `auth`：帳號密碼、Session、角色與門市資料隔離。
2. `master-data`：locations、products、suppliers、supplier_products、補貨參數。
3. `inventory`：餘額、異動與 transaction。
4. `demand`：人工需求、自動補貨確認與狀態流轉。
5. `allocation`：總倉配貨、揀貨、出貨、門市簽收。
6. `purchasing`：集中彙總、採購單、部分到貨與需求來源關聯。
7. `audit`：重要操作的 before/after JSON 與操作者。

正式 API 的所有寫入都必須在 server-side transaction 執行；瀏覽器端的 localStorage 只保留在工具驗證版，不視為安全邊界或多使用者資料庫。

## 目前刻意未處理

SSO、OAuth、MFA、POS API、供應商入口、會計/發票、複雜簽核、即時通知、檔案上傳與雲端部署資料庫不在 Phase 1 驗證版內。

