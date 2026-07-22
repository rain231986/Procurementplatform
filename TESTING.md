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

`tests/e2e.spec.ts` 提供登入頁與主要工作台入口的 smoke test。完整 e2e 執行前需安裝 Playwright、先啟動 `start-local-server.ps1`，再執行：

```bash
npm run test:e2e
```

## 手動驗證劇本

1. 首次開啟先設定本機示範密碼，再使用 `store01` 登入。
2. 在「自動補貨建議」執行本門市計算，確認建議量符合安全庫存、最低量與門市倍數。
3. 在「門市需求池」建立並送出一筆需求。
4. 登出改用 `warehouse01`，核准需求、建立配貨單並標記出貨。
5. 登出改用 `store01`，在「到貨與簽收」輸入實收數量完成簽收。
6. 使用 `buyer01` 產生集中採購建議、建立採購單、登記部分或全部到貨。
7. 用 `admin` 查看主檔、使用者與操作紀錄；用「重設示範資料」恢復固定 seed。

目前工作區沒有 Node.js/npm，因此本次可執行驗證以靜態檔案檢查與既有 PowerShell 本機伺服器為主；測試檔已準備好，待 Node LTS/Playwright 環境可直接執行。

