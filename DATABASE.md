# 資料庫設計

`schema.sql` 是 PostgreSQL 16 的 Phase 1 資料契約，`docker-compose.yml` 會在初次建立 volume 時載入它。金額使用 `numeric(12, 2)`，數量使用非負整數 check constraint；重要單號與商品編號/條碼皆有唯一限制。

主要資料表：

- 組織與權限：`locations`、`users`
- 主檔：`products`、`suppliers`、`supplier_products`
- 補貨與庫存：`location_product_settings`、`inventory_balances`、`inventory_movements`
- 需求與建議：`demand_orders`、`demand_order_items`、`replenishment_runs`、`replenishment_suggestions`、`replenishment_change_logs`
- 配貨：`allocation_orders`、`allocation_order_items`
- 採購：`purchase_suggestions`、`purchase_orders`、`purchase_order_items`、`demand_purchase_allocations`
- 採購追蹤：`purchase_order_change_logs`、`purchase_tracking_notes`、`purchase_receipt_logs`
- 稽核：`audit_logs`

正式 Prisma 專案應將這份 SQL 轉為 migration，並在下列寫入操作中使用 transaction：

1. 建立配貨單與扣減總倉庫存。
2. 採購到貨與增加總倉庫存。
3. 門市簽收與增加門市庫存。
4. 人工庫存調整與異動紀錄。
5. 補貨建議轉正式需求。
6. 採購建議轉採購單、建立需求採購分配、確認/下單、取消、到貨、增加總倉庫存與結案。

本工具驗證版將同樣的欄位與狀態存於 localStorage，讓 UI 流程可先被驗證；localStorage 不具備 PostgreSQL transaction、多人併發或正式密碼安全性。

## 人工需求迭代資料契約

本次人工需求模組新增下列契約，總倉配貨、集中採購、登入與既有角色 enum 保持不變：

- `users.is_store_manager`：`STORE` 使用者的店長旗標；正式服務仍須搭配 `location_id` 與後端 RBAC 驗證。
- `demand_status` 新增 `PENDING_MANAGER_APPROVAL`、`RETURNED`；`demand_orders` 新增店長核准/退回人員、時間與原因欄位。
- `suppliers.minimum_order_amount`、`supplier_products.minimum_order_amount`：供應商最低採購金額提示資料。
- `demand_order_items` 新增送審快照：參考進貨價、明細金額、門市庫存、前六個完整月份銷售總量/平均、門市條件與供應商最低量/金額/採購倍數。
- `monthly_product_sales`：以 `(location_id, product_id, sales_year, sales_month)` 唯一識別門市商品月銷售量。
- `store_order_conditions`：可綁定特定門市或全域商品，保存最低數量、最低金額、`condition_mode`、啟用與有效日期。

SQL 初始契約在 `schema.sql`；既有 PostgreSQL 環境使用 `migrations/002_human_demand_manager_sales_conditions.sql`。目前 Phase 1 瀏覽器工具以 localStorage 模擬同一資料模型，正式 API 需在 transaction 內完成送審/核單、條件重驗與快照寫入。

## 管理員密碼重設資料契約

- `users.password_changed_at`：最近一次密碼變更時間，可為 NULL。
- `users.must_change_password`：重設後為 true；使用者完成登入後的強制改密碼流程才設回 false。
- `audit_logs.metadata`：JSONB，保存不含敏感密碼資料的事件 metadata。
- `migrations/003_admin_password_reset.sql` 為既有 PostgreSQL 的增量 migration；`schema.sql` 已同步更新初始建表契約。
- `scripts/admin-reset-password.mjs` 使用 PostgreSQL client 的 `BEGIN`、`SELECT ... FOR UPDATE`、更新密碼與 audit、`COMMIT`；錯誤時執行 `ROLLBACK`。

## 自動補貨與店長核單資料契約

`migrations/004_auto_replenishment_manager_flow.sql` 新增自動補貨的數量保留、庫存/銷售快照、來源關聯及異動紀錄。`replenishment_suggestions.status` 僅允許 `GENERATED`、`STORE_REVIEWING`、`ACCEPTED`、`ADJUSTED`、`SKIPPED`、`CONVERTED_TO_DEMAND`、`EXPIRED`。

- `replenishment_suggestions`：保存 `system_suggested_qty`、`store_confirmed_qty`、`manager_confirmed_qty`、`final_requested_qty`、`demand_order_id`、`on_hand_qty_snapshot`、`reserved_qty_snapshot`、`available_qty_snapshot`、六個月銷售總量/平均/最大/最小及 `calculated_at`。
- `demand_order_items`：保存補貨建議來源 `replenishment_suggestion_id`（唯一）、四段數量、門市/店長調整原因、`manager_skipped`、庫存與銷售快照、門市條件/供應商提示快照。
- `replenishment_change_logs`：保存 `replenishment_suggestion_id`、可選的 demand/item、`changed_by`、`changed_at`、`actor_type`、`change_type`、`field_name`、`before_value`、`after_value` 與 `change_reason`。數量與狀態異動不得只依 audit detail，必須可逐筆追溯。
- `demand_orders.manager_reason` 保存店長核單總原因。正式 API 需以 transaction 同時鎖定待核需求、更新需求明細、補貨建議與異動 log；核准成功後狀態才可變成 `SUBMITTED`。

## 集中採購與採購單資料契約

`migrations/005_centralized_procurement_management.sql` 擴充集中採購資料模型。`purchase_suggestions` 保存 `raw_purchase_qty`、`demand_allocated_qty`、`warehouse_supplement_qty`、`suggested_purchase_qty`、`confirmed_purchase_qty`、`warehouse_buffer_qty`、採購單位、倍數、MOQ、參考單價、最低金額檢核與轉單關聯。

`purchase_orders` 保存 `source_type`、採購/到貨日期、Decimal 金額、供應商最低金額、例外下單欄位、聯絡與付款資料、各狀態操作者與時間。`purchase_order_items` 保存供應商商品編號、`source_type`、`suggestion_id`、人工新增原因/操作者/時間、採購單位、倍數、MOQ、`raw_demand_qty`、原始需求量、門市需求分配量、總倉補充量、系統建議量、`manual_added_qty`、確認量、倍數增加量、訂購/到貨/取消/剩餘數量、單價、稅額、小計、總倉備貨與預計到貨日；`remaining_qty` 由 `GREATEST(0, ordered_qty - received_qty - cancelled_qty)` 產生，並限制已到貨加取消量不得超過訂購量。明細以 `(purchase_order_id, product_id)` 唯一索引阻擋重複商品，`MANUAL_WAREHOUSE_STOCK` 不得有需求分配。`purchase_suggestions.purchase_order_item_id` 反向保留轉單後的明細追蹤。

`demand_purchase_allocations` 同時連結需求單/明細和採購單/明細，並保存 `allocated_qty`、`received_allocated_qty`、`cancelled_allocated_qty`、`requeued_qty`，支援一張採購單對多張門市需求，以及一張需求分散到多張採購單；資料庫限制已到貨分配量加取消分配量不得超過分配量。`purchase_order_change_logs`、`purchase_tracking_notes`、`purchase_receipt_logs` 分別保存採購單異動、未到貨聯繫與到貨紀錄。

正式 API 的採購到貨 transaction 必須鎖定採購單明細與總倉 `inventory_balances`，檢查到貨不超過 `remaining_qty`，再一次寫入 `inventory_movements`、來源分配、採購狀態與 audit；localStorage 版本由 `procurement-workflow.js` 的不可變回滾結果模擬相同邊界。金額計算先轉成整數分，資料庫仍以 `numeric(12, 2)` 儲存，避免 JavaScript 浮點誤差。

## 供應商退貨、缺貨與未到貨資料模型

`migrations/008_supplier_returns_shortage_tracking.sql` 與 `schema.sql` 同步新增以下資料結構：

- `suppliers` 增加 `payment_method`、`payment_method_note`、`settlement_days`、`billing_cycle`、`invoice_requirement`、`currency` 與門市可見公開說明；付款資料只保存設定，不連接付款執行或會計傳票。
- `supplier_business_relations` 保存訂貨廠商、收款廠商、預設/啟用狀態與生效期間；`purchase_orders` 保存 `ordering_supplier_id`、`payee_supplier_id`、兩者快照、付款快照及採購頻率快照，避免主檔日後變更污染歷史採購單。
- `supplier_order_schedules` 保存供應商頻率、星期/日期、截止時間、時區及下一次預計訂貨日；門市 API 只回傳公開投影。
- `supplier_bank_accounts` 與 `supplier_bank_attachments` 支援多帳戶、每個付款供應商單一主要帳戶及私有附件 metadata。附件不保存檔案內容或公開 URL；正式 adapter 應以登入與角色驗證後的私有下載流程取得檔案。
- `product_identifiers` 以 `(identifier_type, identifier_value)` 唯一，支援 GTIN-14、EAN-13、UPC-A、JAN、Manufacturer Item Code 及可擴充的 OTHER。
- `purchase_order_items` 增加單商品追蹤/缺貨欄位、下一可供貨日、解決者與重新採購數量；`purchase_order_item_followups` 保存逐次廠商聯絡歷程與本次備註；`purchase_shortage_requeues` 保存 `REQUEUE`、`NO_GROUP` 或 `ALTERNATIVE` 的來源、數量、替代供應來源與 source changes。`demand_purchase_allocations.requeued_qty` 保存來源需求重新採購數量，`shortage_qty` 受 `shortage_qty <= remaining_qty` check 約束。
- `supplier_return_orders`、`supplier_return_order_items`、`supplier_return_attachments` 保存退貨表頭、退貨/預計處理/實際處理日期、確認/退回/結案操作者與時間、批號/效期、來源採購/收貨、退貨數量、保留/已退數量、退款/折讓/換貨/拒絕結果及附件 metadata。`inventory_balances.return_reserved_qty` 只表示待退保留量；實際退貨與 inventory movement 必須同 transaction。

上述新表與既有採購、庫存、需求資料以 id/來源欄位關聯，不改寫集中採購數量公式或既有總倉配貨/門市簽收核心資料流程。

## 集中採購工作台迭代資料契約

## 供應商、商品與管理權限資料契約

007_master_data_roles_and_settings.sql 擴充主檔資料與權限邊界：

- suppliers 增加 address、payment_terms、delivery_note、delivery_time_note、receiving_note。
- products 增加 case_pack_qty、store_distribution_unit、store_distribution_multiple、warehouse_location_code、批號/效期旗標、minimum_shelf_life_days、storage_note、procurement_status 與 version。
- supplier_products 增加 lead_time_days、is_active、version、created_at、updated_at；同一商品最多一筆啟用中的主要供應商。
- procurement_status 為 DRAFT、PENDING_PURCHASE_SETUP、PURCHASABLE、INACTIVE。商品未完成啟用的主要供應商、供應商商品編號、採購單位、MOQ、倍數與單價條件前，不得進入採購建議或採購單。

正式 API 需依角色使用明確 DTO/service：updateProductBasicData、updateProductWarehouseSettings、updateProductPurchasingSettings、updateSupplierCommercialData、updateSupplierReceivingNotes，不能使用任意欄位 mass update。PURCHASING 只能修改供應商商務與商品供應商採購條件；WAREHOUSE 只能修改商品基本/物流與供應商收貨備註；ADMIN 可全部操作；STORE 僅查詢流程可見資料。所有異動 audit 必須保存操作者角色、時間與 before/after；寫入需帶 version/updated_at，衝突時回傳重新載入訊息。

`migrations/006_procurement_grouping_distribution_no_group.sql` 與 `schema.sql` 同步擴充集中採購，不另建重複的銷售資料表：

- `purchase_suggestions` 增加 `procurement_status`、`demand_suggested_qty`、`warehouse_replenishment_qty`、`system_suggested_purchase_qty`、`purchaser_confirmed_qty`、`planned_store_allocation_qty`、`no_group_reason`、`no_group_note`、`no_group_by`、`no_group_at`、`no_group_history`、`reopened_by`、`reopened_at`；狀態 check 包含集中採購工作台狀態。
- `purchase_order_items` 增加原始/人工合併量、系統建議量、確認量、門市預計配貨量、總倉預計留存量、來源類型集合與人工追加紀錄。數量欄位以非負整數 check 約束。
- `purchase_order_item_sources` 保存每筆採購明細的 `DEMAND_SUGGESTION`、`WAREHOUSE_REPLENISHMENT`、`MANUAL_ADDITION` 或 `MIXED` 來源、需求單/明細、採購建議、來源門市、來源數量、人工原因、操作者與時間。
- `purchase_order_item_store_allocations` 以 `(purchase_order_item_id, location_id)` 唯一，保存每家門市的建議/確認/實際配貨/簽收數量、需求關聯、配貨原因、`PLANNED`、`PARTIALLY_ALLOCATED`、`ALLOCATED`、`CANCELLED` 狀態及異動者。
- `demand_order_items` 增加 `procurement_status`、`procurement_status_reason`、`procurement_status_note`、`procurement_status_updated_at` 與 `purchase_suggestion_id`，讓來源門市可查看自己的採購進度；`procurement_status_logs` 保存前後狀態、原因、說明、操作者及時間。

正式服務建立採購單、來源追蹤、配貨規劃、無成團與重新開啟時，需在同一 transaction 鎖定相關採購建議/明細、寫入來源與狀態歷程；任一步驟失敗不得留下半套資料。月銷售仍使用既有 `monthly_product_sales`，以門市/商品/年月唯一鍵查詢前六個完整月份。

## 到貨簽收與流程阻擋資料契約

`migrations/009_receiving_delivery_modes_workflow_blocks.sql` 與 `schema.sql` 新增本迭代資料契約：

- `purchase_order_items` 增加 `delivery_mode`、`warehouse_received_qty`、`direct_received_qty`；`purchase_order_item_store_allocations` 增加 `delivery_mode`、`destination_location_id`、`planned_delivery_qty`、`expected_delivery_date`、`actual_allocated_qty`、`shipped_qty`、`warehouse_received_qty`、`actual_received_qty`、`signed_qty`、`signed_by`、`signed_at`、`short_received_qty`、`rejected_qty`、`exception_reason`、`batch_number`、`expiry_date`、`signed_note`、`warehouse_receipt_location_id`。
- 收貨紀錄分為 `purchase_receipt_logs`、`warehouse_shipment_logs`、`store_receipt_logs`、`supplier_direct_receipt_logs`，均保存實際數量、地點、操作者、批號／效期、原因與 `operation_id`；operation id unique 用於避免重送造成重複庫存異動。
- `inventory_movements.movement_type` 固定保留四種到貨／出貨類型：`PURCHASE_RECEIPT_WAREHOUSE`、`SUPPLIER_DIRECT_RECEIPT_STORE`、`WAREHOUSE_SHIPMENT_TO_STORE`、`STORE_RECEIPT_FROM_WAREHOUSE`。總倉收貨只寫總倉，總倉出貨才扣總倉，門市簽收才寫門市。
- `product_identifiers` 以 `product_id`、`product_variant_id`、`specification_key`、`slot_number`、`identifier_type`、`identifier_value`、`is_primary`、`is_active`、`note`、建立／更新欄位保存最多六個識別碼；active slot、active value 與同商品／規格 primary 均有唯一索引。
- `workflow_block_events` 保存 `workflow_type`、`entity_type`、`entity_id`、`entity_location_id`、`attempted_action`、`current_status`、`blocking_code`、`blocking_summary`、`blocking_details`、`responsible_role`、解除者／時間與建立者／時間；`workflow_notifications` 保存相關角色的系統內通知。未解除事件依 entity、action、blocking code、product 去重，解除不刪歷史。
- 正式 API 必須以 transaction 寫入收貨／庫存／需求／採購進度與阻擋事件；localStorage 驗證版由 `receiving-workflow.js` 與 `workflow-validation.js` 以 clone/commit/rollback 模擬相同邊界。

## 門市作業增量 migration 010

`migrations/010_store_operations.sql` 對應 `schema.sql` 的門市作業資料契約：

- `store_transfer_orders`、`store_transfer_order_items` 保存來源／目的門市、店長核准、調撥數量、出貨／收貨數量、批號、效期、拒絕／退回原因與 operation id。明細以 generated remaining 欄位及 check constraint 限制核准、出貨、收貨與拒收數量，並以 operation id unique 防止重複庫存異動。
- `store_return_orders`、`store_return_order_items` 同時支援 `TO_WAREHOUSE` 與 `TO_SUPPLIER`，保存門市、總倉、供應商、店長／總倉／採購／廠商關卡、處理結果、替代商品、預計處理日、批號／效期與歷程。`store_return_attachments` 只保存檔案 metadata 與私有 storage key。
- `location_product_settings` 增加 `safety_stock_qty`、`maximum_safety_stock_qty`、`safety_stock_effective_from`、`safety_stock_effective_to`、`safety_stock_updated_by`、`safety_stock_updated_at` 與 `safety_stock_reason`；`inventory_balances` 增加退貨／調撥在途數量；`inventory_movements` 增加 operation、來源／目的、批號／效期欄位。
- `purchase_order_items.internal_shortage_note` 保存採購內部缺貨備註；正式 schema 應另建立 `purchase_order_item_followups` 保存逐明細缺貨追蹤歷程。`workflow_block_events.workflow_type` 增加 `PURCHASE_ITEM_SHORTAGE`、`STORE_TRANSFER`、`STORE_RETURN_WAREHOUSE`、`STORE_RETURN_SUPPLIER`。

所有調撥出貨、調撥簽收、門市退回總倉出貨／收貨、退廠商出貨／拒退回店／換貨收貨，以及採購明細缺貨更新，都必須以資料庫 transaction 鎖定相關明細與庫存列；失敗時不得只留下狀態或 movement 的半套資料。STORE 查詢以 session `location_id` 強制套用來源／目的／退貨門市範圍，不能由前端傳入另一家門市繞過隔離。
