# 資料庫設計

`schema.sql` 是 PostgreSQL 16 的 Phase 1 資料契約，`docker-compose.yml` 會在初次建立 volume 時載入它。金額使用 `numeric(12, 2)`，數量使用非負整數 check constraint；重要單號與商品編號/條碼皆有唯一限制。

主要資料表：

- 組織與權限：`locations`、`users`
- 主檔：`products`、`suppliers`、`supplier_products`
- 補貨與庫存：`location_product_settings`、`inventory_balances`、`inventory_movements`
- 需求與建議：`demand_orders`、`demand_order_items`、`replenishment_runs`、`replenishment_suggestions`
- 配貨：`allocation_orders`、`allocation_order_items`
- 採購：`purchase_suggestions`、`purchase_orders`、`purchase_order_items`、`demand_purchase_allocations`
- 稽核：`audit_logs`

正式 Prisma 專案應將這份 SQL 轉為 migration，並在下列寫入操作中使用 transaction：

1. 建立配貨單與扣減總倉庫存。
2. 採購到貨與增加總倉庫存。
3. 門市簽收與增加門市庫存。
4. 人工庫存調整與異動紀錄。
5. 補貨建議轉正式需求。

本工具驗證版將同樣的欄位與狀態存於 localStorage，讓 UI 流程可先被驗證；localStorage 不具備 PostgreSQL transaction、多人併發或正式密碼安全性。

