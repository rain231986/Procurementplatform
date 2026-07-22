# PharmaFlow 藥局供應協作平台

PharmaFlow 是給 5 家藥局門市、1 個總倉與集中採購部門使用的 Phase 1 流程驗證版。它把「門市提出需求 → 總倉配貨 → 缺口集中採購 → 到貨 → 再配貨 → 門市簽收」串成一條可操作的工作流。

## 已完成模組

- 簡化帳號密碼登入、四種角色與門市資料隔離。
- 需求池：人工需求、特殊需求原因、送出、核准、進度查看。
- 自動補貨：安全庫存、最高庫存、最低補貨量、門市配貨倍數。
- 總倉配貨：可用庫存檢查、部分配貨、揀貨、出貨。
- 集中採購：跨門市缺口彙總、主要供應商、MOQ、採購倍數、採購單。
- 到貨與簽收：採購部分到貨、總倉入庫、配貨出貨、門市實收。
- 管理：商品、供應商、補貨參數、庫存人工調整、使用者與操作紀錄。
- 固定 seed：5 間門市、1 個總倉、20 項商品、3 家供應商、需求/配貨/採購測試資料。

## 技術邊界

目前網站保留既有「無建置工具、可直接啟動」的原型結構，以 ES modules + CSS + localStorage 驗證完整流程；`schema.sql` 與 `docker-compose.yml` 已提供 PostgreSQL 16 的資料契約與本機資料庫入口，便於下一階段接上 Next.js/TypeScript/Prisma API。

正式化時應使用 Node.js LTS、Next.js、Prisma、PostgreSQL、Tailwind CSS、Vitest 與 Playwright。這個工作區目前未提供 Node.js/npm，因此沒有在此環境執行 npm install 或 production build；可執行測試指令與測試檔已準備在 `package.json`、`tests/`。

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

`schema.sql` 會建立 locations、users、products、suppliers、補貨、庫存、需求、配貨、採購、需求採購關聯與 audit logs 等資料表。正式 Prisma migration/seed 尚未接入此靜態驗證層，詳細邊界見 `ARCHITECTURE.md` 與 `DATABASE.md`。

## 測試

```powershell
npm run test:unit
npm run test:e2e
```

測試案例、手動驗證劇本與環境限制請見 `TESTING.md`。`domain.js` 的補貨與採購計算為純函式，避免被畫面狀態耦合。

## 已知限制與下一階段

- localStorage 只適合單機流程驗證，不是正式多使用者資料庫，也不提供真正的後端授權邊界。
- 本版本的瀏覽器密碼設定使用 Web Crypto SHA-256 供本機演示；正式環境必須改成 server-side bcrypt/argon2、Session cookie 與 API RBAC。
- PostgreSQL schema 與 Docker Compose 已提供，但尚未由此靜態頁面連線；下一階段接上 Next.js API、Prisma migration/seed、transaction、CSV 匯入與完整 Playwright flow。
- 尚未包含 SSO、POS、會計、發票、供應商入口、行動 App、複雜簽核與訊息佇列。

