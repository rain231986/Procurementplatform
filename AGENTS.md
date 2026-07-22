# Agent 工作規範

本專案是 PharmaFlow 藥局門市需求、總倉配貨與集中採購的 Phase 1 驗證版。

後續修改程式碼前，必須先閱讀：

1. `BUSINESS_RULES.md`：補貨、配貨、採購、到貨與簽收的業務規則。
2. `ARCHITECTURE.md`：目前靜態流程驗證層與 PostgreSQL 資料契約的邊界。

開發原則：

- 所有畫面與提示使用繁體中文，日期以 `Asia/Taipei` 的 `YYYY-MM-DD` 顯示。
- 不要把角色權限只做在 UI；正式後端必須以 Session 的角色與 `location_id` 再檢查一次。
- 不得使用浮點數保存金額；資料庫使用 `numeric(12, 2)`。
- 庫存出貨、到貨、簽收與人工調整必須在正式後端 transaction 中完成，並建立 `inventory_movements` 與 `audit_logs`。
- 不加入 SSO、POS 即時串接、複雜簽核、微服務或 Phase 1 以外的功能。
- 修改資料模型時同步更新 `schema.sql`、`DATABASE.md` 與測試。

