# Phase 1 業務規則

## 需求

- `MANUAL` 與 `AUTO` 來源最後都進入同一個需求池。
- 急件、客訂、活動備貨、新品與其他特殊需求必須留下原因。
- 門市只能讀寫 Session 綁定的 `location_id`；STORE 不能直接指定其他門市。
- STORE 送出後為 `SUBMITTED`；WAREHOUSE 或 ADMIN 可核准為 `APPROVED`。
- 需求狀態：`DRAFT`、`SUBMITTED`、`APPROVED`、`PROCESSING`、`PARTIALLY_ALLOCATED`、`WAITING_PURCHASE`、`COMPLETED`、`CANCELLED`。

## 自動補貨

執行補貨計算時使用門市庫存、保留量、配貨在途、採購入庫在途、未完成需求與門市補貨參數：

```text
projected_available_qty
= on_hand_qty
- reserved_qty
+ allocation_in_transit_qty
+ purchase_inbound_allocated_qty
+ existing_open_demand_qty
```

只有在 `automatic_replenishment_enabled=true`、預估庫存小於或等於安全庫存、且最高庫存大於預估庫存時才建立建議。

```text
raw_required_qty = maximum_stock_qty - projected_available_qty
base_suggested_qty = max(raw_required_qty, minimum_replenishment_qty)
suggested_qty = ceil(base_suggested_qty / store_distribution_multiple)
                 * store_distribution_multiple
```

門市可接受、調整或暫不補貨。調整必須記錄原始建議、確認數量、原因、操作者與時間。確認後才轉成 `source_type=AUTO` 的正式需求，不直接建立採購單。

## 總倉配貨

- 可配數量不得大於 `on_hand_qty - reserved_qty`。
- 建立配貨單時扣減總倉可用量，並記錄庫存異動。
- 能配的數量先建立配貨單；不足數量寫入需求明細的 `purchase_required_qty`。
- 配貨單狀態：`DRAFT`、`PICKING`、`SHIPPED`、`RECEIVED`、`CANCELLED`。
- 出貨後只能由目的門市簽收；簽收資料範圍由 Session 的 `location_id` 決定。

## 集中採購

以商品、主要供應商彙總所有需求的未滿足數量：

```text
purchase_shortage_qty = Σ demand item shortage
purchase_suggested_qty = ceil(max(shortage, minimum_order_quantity)
                               / purchase_multiple)
                         * purchase_multiple
```

系統保留原始缺口、建議採購量、MOQ/倍數調整量與來源需求明細。一張採購單可對應多張門市需求，靠 `demand_purchase_allocations` 追蹤。

## 到貨與簽收

- 採購到貨先增加總倉庫存，允許部分到貨。
- 總倉再以可用量建立後續配貨單。
- 門市簽收增加門市庫存、更新配貨單與需求已收數量。
- 需求全部收到才進入 `COMPLETED`；仍有缺口則保留 `PARTIALLY_ALLOCATED` 或 `WAITING_PURCHASE`。
- 不允許負庫存、重複簽收、取消單據繼續操作或無權限跨門市操作。

