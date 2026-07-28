# Phase 1 業務規則

## 需求

- `MANUAL` 與 `AUTO` 來源最後都進入同一個需求池。
- 急件、客訂、活動備貨、新品與其他特殊需求必須留下原因。
- 門市只能讀寫 Session 綁定的 `location_id`；STORE 不能直接指定其他門市。
- STORE 送出後為 `SUBMITTED`；WAREHOUSE 或 ADMIN 可核准為 `APPROVED`。
- 需求狀態：`DRAFT`、`SUBMITTED`、`APPROVED`、`PROCESSING`、`PARTIALLY_ALLOCATED`、`WAITING_PURCHASE`、`COMPLETED`、`CANCELLED`。

## 自動補貨

執行補貨計算時使用門市庫存、保留量、配貨在途、採購入庫在途、未完成需求剩餘量與門市補貨參數：

```text
projected_available_qty
= on_hand_qty
- reserved_qty
+ allocation_in_transit_qty
+ purchase_inbound_allocated_qty
+ open_demand_remaining_qty
```

補貨計算的未完成需求狀態只有 `SUBMITTED`、`APPROVED`、`PROCESSING`、`PARTIALLY_ALLOCATED`、`WAITING_PURCHASE`。`DRAFT`、`COMPLETED`、`CANCELLED` 不列入預估可用量。

```text
open_demand_remaining_qty
= max(0, (approved_qty if approved_qty > 0 else requested_qty)
         - allocated_qty
         - received_qty)
```

其中 `received_qty` 為已完成簽收數量；計算結果不得小於零。

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

系統保留原始缺口、門市需求分配量、總倉補充量、建議採購量、確認採購量、MOQ/倍數調整量（`multiple_overage_qty`）與來源需求明細。一張採購單可對應多張門市需求，靠 `demand_purchase_allocations` 追蹤。

採購人員由建議建立採購單時，採購單先進入 `DRAFT` 編輯器；只能加入同一供應商的啟用商品與有效供應商品號。人工新增必須填寫原因類別與原因文字；選擇「其他」時還必須填寫補充說明。搜尋可使用商品代碼、名稱、條碼、規格或供應商商品代碼。`PURCHASING` 與 `ADMIN` 才能新增，`WAREHOUSE` 與 `STORE` 不得新增或修改採購明細。

採購單的 `source_type` 為只有建議的 `PURCHASE_SUGGESTION`、只有人工備貨的 `MANUAL`，或兩者同單的 `MIXED`。明細 `source_type` 分別為 `PURCHASE_SUGGESTION`、`MANUAL_WAREHOUSE_STOCK`、`MIXED`；至少保存 `suggestion_id`、`raw_demand_qty`、`suggested_purchase_qty`、`manual_added_qty`、`confirmed_purchase_qty`、`demand_allocated_qty`、`warehouse_buffer_qty`、`manual_add_reason`、操作者與時間。

同一採購單、同一商品必須合併為一列。若建議量為 24、人工增加 12，`combined_base_qty = 24 + 12 = 36`，再以 `max(combined_base_qty, MOQ)` 並向上取整至採購倍數，得到最終 `confirmed_purchase_qty`。人工數量不得建立門市需求分配；`demand_allocated_qty` 保留原建議分配，`warehouse_buffer_qty = max(0, confirmed_purchase_qty - demand_allocated_qty)`。同商品的採購單位、單價、MOQ、倍數或其他採購條件不同時，必須提示衝突並由採購人員確認，不得靜默建立重複明細。

草稿可修改人工數量/原因、調整建議數量、加入或移除明細；移除建議明細會解除來源分配並讓建議回到待採購池。`ORDERED` 後不得新增、移除或改變商品、數量、單價。每次草稿異動都要留下前後資料、操作者、時間與原因；正式 API 必須在 transaction 中同時驗證供應商、商品啟用狀態、同供應商限制、重複品項與來源分配。

## 供應商資料、商品設定與權限

- ADMIN 可管理供應商、商品、商品供應商關係、主要供應商、商務條件、倉儲物流設定與庫存調整；PURCHASING 管理供應商商務、商品供應商關係、主要供應商、供應商商品編號、採購單位、採購價、MOQ、採購倍數、最低採購金額、交期與付款條件；WAREHOUSE 管理商品基本資料與倉儲物流設定、庫存調整及供應商配送/收貨備註；STORE 不進入主檔維護頁，只能在既有業務流程查看被授權的商品/庫存資訊。
- 商品基本欄位為 product_code、barcode、product_name、specification、category、base_unit、is_active。倉管/管理員可維護完整基本資料；採購可修改名稱、規格與分類。倉儲欄位包含箱入數、門市配貨單位/倍數、總倉儲位、批號/效期管理、最低可接受效期天數與儲存備註。
- 供應商商務欄位包含代碼、名稱、統編、聯絡資料、地址、交期、最低採購金額、付款條件與啟用狀態；倉管的供應商可編輯範圍只包含配送備註、送貨時段與收貨注意事項，不得修改價格、MOQ、付款或銀行等商務資料。
- supplier_products 保存商品與供應商的供應商商品編號、採購單位、單價、MOQ、倍數、最低採購金額、交期、主要/啟用狀態。設定主要供應商時，同一交易會清除同商品其他主要標記；停用或取消目前主要供應商時，必須指定替代關係或明確確認商品暫無主要供應商。
- 商品採購狀態只有 DRAFT、PENDING_PURCHASE_SETUP、PURCHASABLE、INACTIVE。倉管可先建立沒有供應商的商品，狀態為 PENDING_PURCHASE_SETUP；採購完成有效主要供應商關係及必要採購條件後才變成 PURCHASABLE。非 PURCHASABLE 商品不得產生集中採購建議或建立/確認採購單。
- 主檔寫入必須使用角色專用 DTO/service，不能把整個表單直接 merge 進資料列。每次修改保存操作者、角色、時間與修改前後內容；使用 version/updated_at 做 optimistic locking，發生衝突顯示「資料已由其他人更新，請重新載入後再修改。」交易失敗時不得留下部分修改。

## 到貨與簽收

- 採購到貨先增加總倉庫存，允許部分到貨。
- 總倉再以可用量建立後續配貨單。
- 門市簽收增加門市庫存、更新配貨單與需求已收數量。
- 需求全部收到才進入 `COMPLETED`；仍有缺口則保留 `PARTIALLY_ALLOCATED` 或 `WAITING_PURCHASE`。
- 不允許負庫存、重複簽收、取消單據繼續操作或無權限跨門市操作。

## 人工需求單與店長核單

- 人工需求單的正式流程為 `DRAFT → PENDING_MANAGER_APPROVAL → SUBMITTED`。店長退回時使用 `PENDING_MANAGER_APPROVAL → RETURNED → PENDING_MANAGER_APPROVAL`，門市可以在 `DRAFT` 與 `RETURNED` 修改；送審、已送出、處理中、部分配貨、待集中採購、已完成及已取消均不可修改。
- `STORE` 使用者只能操作登入 Session 綁定的門市；一般門市人員不能核單。`STORE` 且 `is_store_manager=true` 並綁定門市者，只能核准同一門市的人工需求；`ADMIN` 可跨門市核單。店長核准前必須重新驗證目前的門市最低需求條件。
- 「送店長核單」與店長核准都必須逐筆檢查 `store_order_conditions`。條件模式為 `QUANTITY_ONLY`、`AMOUNT_ONLY`、`EITHER`、`BOTH`；不符合時阻擋送審，且結果不得以負數呈現。供應商 MOQ、採購倍數與最低採購金額只顯示警告，不阻擋送審或核准。
- 人工需求明細顯示商品代碼、名稱、規格、主要供應商、目前門市庫存、前六個完整月份月銷售（不含當月，缺月份補零）、六個月總量與平均、需求數量、參考進貨價、明細金額及門市/供應商條件提示。庫存顯示必須以登入門市為範圍，不能由前端表單指定其他門市。
- 送審時將參考進貨價、明細金額、目前庫存、六個月銷售總量/平均、門市最低數量/金額/模式、供應商最低數量/金額/採購倍數寫入需求明細快照，後續詳情仍可追溯送審當下依據。
- 月銷售資料存於 `monthly_product_sales`，唯一鍵為門市、商品、銷售年、銷售月。ADMIN 可匯入 `location_code, product_code, sales_year, sales_month, sales_qty` CSV；相同鍵採 upsert。

## 系統管理員密碼重設

- 管理員忘記密碼只能由主機端或本機終端機執行 `npm run admin:reset-password -- --username <帳號>`；不提供公開忘記密碼頁面，也不使用電子郵件重設。
- 新密碼只能從 `ADMIN_RESET_PASSWORD` 環境變數取得，不得出現在命令參數、程式碼、Git、log 或終端輸出。帳號必須存在、角色為 `ADMIN` 且為啟用狀態。
- Phase 1 密碼至少 12 字元，需包含英文字母與數字，不得等於 username，也不得使用 `admin`、`password`、`123456` 等明顯弱密碼。
- CLI 使用正式登入系統的 bcrypt 雜湊（cost 12）；查詢、更新與 `audit_logs` 寫入必須在同一個 PostgreSQL transaction。任一步驟失敗都 rollback，不得破壞原密碼。
- 重設成功更新 `password_changed_at`，並將 `must_change_password` 設為 true；使用者下次登入成功後必須先完成修改密碼，修改成功才清除該旗標。
- `audit_logs.action=ADMIN_PASSWORD_RESET`、`entity_type=USER`，metadata 只能記錄來源、帳號與強制改密碼狀態，不得包含明碼、password hash 或 `ADMIN_RESET_PASSWORD`。

## 自動補貨建議與店長核單

自動補貨只能產生待門市確認的建議，不得直接送總倉或建立採購缺口。狀態流程如下：

`GENERATED → STORE_REVIEWING → ACCEPTED / ADJUSTED → CONVERTED_TO_DEMAND → DRAFT → PENDING_MANAGER_APPROVAL → SUBMITTED`

店長退回流程為 `PENDING_MANAGER_APPROVAL → RETURNED → PENDING_MANAGER_APPROVAL`；門市可在 `DRAFT`、`RETURNED` 修改，`PENDING_MANAGER_APPROVAL`、`SUBMITTED`、`PROCESSING`、`PARTIALLY_ALLOCATED`、`WAITING_PURCHASE`、`COMPLETED`、`CANCELLED` 均不可由門市修改。AUTO 需求只有在店長最終核准後才會進入總倉佇列。

- 門市可逐筆或批次接受待確認建議；確認需保存 `system_suggested_qty` 與 `store_confirmed_qty`；店長核單再保存 `manager_confirmed_qty`；正式送出時保存 `final_requested_qty`。原始系統建議不得被覆寫。
- 門市修改系統建議數量必須填原因；店長修改數量或略過品項也必須填原因。店長可直接核准，也可先修改數量、希望到貨日、原因與備註後維持待核，再由核准摘要完成最終核准。
- 店長核准前以最終數量重新計算明細金額並重新驗證門市最低需求條件。`QUANTITY_ONLY`、`AMOUNT_ONLY`、`EITHER`、`BOTH` 的判斷以最終數量與最終金額為準；條件不符時阻擋核准。儲存草稿或退回內容時可暫不符合條件。
- 供應商最低數量、採購倍數與最低金額只作提示，不阻擋門市送審或店長核准；提示依供應商彙總整張需求計算。
- 補貨建議與 AUTO 需求明細都保存 `on_hand_qty_snapshot`、`reserved_qty_snapshot`、`available_qty_snapshot`、`calculated_at`。目前庫存與快照不同時，畫面必須顯示「庫存已變動」。
- 前六個完整月份不含當月，缺漏月份補零，並保存/顯示各月、總量、平均、最大與最小銷售量。
- 重要寫入（門市確認、轉需求草稿、送店長核單、店長修改/核准/退回）必須在同一個後端 transaction 內完成狀態、數量、快照與 `replenishment_change_logs`；驗證版以 localStorage transaction rollback 模擬此邊界。
- 權限以登入 Session 的角色與 `location_id` 為準：一般 STORE 不可核單；同門市 `STORE + is_store_manager=true` 或 ADMIN 才可核准；ADMIN 可跨門市但必須留下 audit。

## 集中採購與採購單管理

集中採購只接受已核准且總倉尚未配足的需求。可進入待採購池的需求狀態為 `SUBMITTED`、`PROCESSING`、`PARTIALLY_ALLOCATED`、`WAITING_PURCHASE`；`DRAFT`、`PENDING_MANAGER_APPROVAL`、`RETURNED`、`COMPLETED` 與 `CANCELLED` 不得進入。需求缺口以最終核准數量為基準，扣除總倉已配貨、已完成簽收、有效採購分配與需求取消數量，結果不得小於零。採購分配的取消量會從有效分配量扣回，因此剩餘取消會重新形成待採購缺口。

採購建議依主要供應商、商品、採購單位、採購倍數、最低採購量與供應商最低採購金額分組。`raw_purchase_qty` 為所有來源需求缺口加總倉安全庫存/授權備貨量；`suggested_purchase_qty` 為將 `max(raw_purchase_qty, minimum_order_quantity)` 向上取整至 `purchase_multiple` 的整數倍，空值、零或小於一的倍數視為 1。`confirmed_purchase_qty`、`demand_allocated_qty` 與 `warehouse_buffer_qty` 分開保存。MOQ/倍數造成的多採購量不得虛構分配給門市需求，而要列入總倉備貨。

供應商最低採購量與最低採購金額在門市需求階段只作提示；建立採購單草稿後，採購人員按「確認採購單」時才正式檢核。未達倍數、MOQ 或最低金額時，可修改數量、合併同供應商需求、暫存草稿，或填寫例外下單原因後確認。例外下單必須保存 `override_reason`、`overridden_by`、`overridden_at`，沒有原因不得確認。

採購單狀態流程為：

`DRAFT → PENDING_CONFIRMATION → ORDERED → PARTIALLY_RECEIVED → RECEIVED → CLOSED`

`DRAFT` 或 `PENDING_CONFIRMATION` 可取消；`ORDERED` 只有在尚無到貨時可整張取消；已有部分到貨時只能取消剩餘未到貨量，並填寫原因。`RECEIVED`、`CLOSED` 為查看狀態；`CANCELLED` 不得重新啟用或新增到貨。採購單的 `remaining_qty = max(0, ordered_qty - received_qty - cancelled_qty)`。草稿可完整修改，待確認的重要欄位修改需記錄原因；已下單後鎖定供應商、商品、訂購量與單價，只能透過異動規則修改預計到貨日、聯絡資訊與備註；部分到貨不可刪除已有到貨的明細。

需求與採購單是多對多關係，透過 `demand_purchase_allocations` 保存需求單/明細、採購單/明細、分配量、已到貨分配量與取消分配量。採購單詳情必須能追溯來源門市、需求單號、需求類型與各門市數量；需求進度也要能查看對應採購單、預計到貨、已到貨與未到貨量。

採購到貨只允許 `WAREHOUSE` 或 `ADMIN` 對 `ORDERED`、`PARTIALLY_RECEIVED` 採購單執行，數量必須大於零且不得超過剩餘量。到貨、增加總倉庫存、採購單狀態、來源需求分配與操作紀錄必須在同一個正式資料庫 transaction 內完成；驗證版以 localStorage rollback 模擬。到貨只增加總倉庫存，不直接增加門市庫存，後續仍須經總倉配貨及門市簽收。

`PURCHASING` 與 `ADMIN` 可管理建議和採購單；`WAREHOUSE` 只能查看已下單採購單與執行採購到貨，不可改價、改量、確認或取消；`STORE` 僅可從自己需求查看採購進度，不可查看其他門市來源或完整採購成本。正式 API 必須再次以 Session 角色與門市範圍驗證，不能只靠隱藏前端按鈕。

## 供應商主檔、退貨、缺貨與未到貨追蹤

- 供應商商務資料由 `PURCHASING` 與 `ADMIN` 維護；統一編號有基本格式與重複檢查，只有 `ADMIN` 填寫例外原因後才能保留重複資料。`payment_terms` 與 `payment_method` 是兩個獨立欄位；付款方式為 `OTHER` 時必須填寫說明。本階段只保存付款條件，不執行付款或會計傳票。
- `supplier_business_relations` 將訂貨廠商與收款廠商分開保存，每個訂貨廠商只能有一個啟用中的預設收款廠商。正式採購單保存兩者的 id 與快照；收款廠商必須啟用，`ORDERED` 後更換收款廠商必須填寫原因並保留 audit。門市不得查看付款關係、付款條件、付款方式或採購成本。
- 供應商採購頻率保存頻率類型、星期/日期、截止時間、時區及下一次預計訂貨日。門市只能在自己需求進度查看頻率、截止時間、下一次訂貨日與供應商公開說明，不能查看商務敏感資料。
- `supplier_bank_accounts` 允許多個帳戶，但每個付款供應商只能有一個啟用中的主要帳戶；新增或切換主要帳戶會在同一 transaction 取消同一付款供應商其他主要標記。帳號預設遮罩，只有 `PURCHASING` 與 `ADMIN` 執行明確授權操作時可暫時查看完整帳號，audit 僅保存遮罩值；附件只保存私有 storage key、用途、檔名、大小、上傳人與時間，不使用公開永久 URL。`WAREHOUSE` 與 `STORE` 不得取得銀行帳戶或附件。
- 商品國際代碼以獨立 `product_identifiers` 保存，至少支援 `GTIN14`（14 位數字）、`EAN13`（13 位數字）、`UPCA`（12 位數字）、`JAN`（8 或 13 位數字）及 `MANUFACTURER_ITEM_CODE`。同一類型與值不得綁定不同商品；`PURCHASING`、`WAREHOUSE`、`ADMIN` 可維護，`STORE` 只能取得作業所需的公開投影。
- 採購單追蹤以採購單商品為單位，不以採購單表頭共用備註代替。`purchase_order_items` 保存目前追蹤狀態、逐品項備註、廠商回覆、下一可供貨日、新預計到貨日、下次追蹤日、缺貨狀態/數量/原因、門市可見說明與內部備註；每次更新另寫入 `purchase_order_item_followups`，不得覆蓋歷程。門市只能看到公開說明與來源需求相關資料。
- 未到貨是尚未完成到貨的數量；缺貨是供應商已確認無法全部或按期供貨。`shortage_qty <= remaining_qty`，已到貨數量不得被算入缺貨。部分到貨例：訂購 24、已到貨 10、缺貨 8，仍待到貨為 6。缺貨可取消、重新放回集中採購、標記無成團或設定替代商品/供應商；原採購單與缺貨紀錄必須保留，`REQUEUE`、`NO_GROUP`、`ALTERNATIVE` 都新增來源關聯與來源變更歷程，不得覆蓋原商品或原供應商。
- 門市需求進度只顯示自己的採購/到貨/缺貨狀態、數量、最新日期、採購頻率、下一次訂貨日及公開說明；不得顯示內部備註、其他門市、銀行帳戶或付款資料。缺貨取消、重新採購、替代品與退貨處理結果都必須回寫來源需求的公開狀態。
- 退貨來源支援 `PURCHASE_RECEIPT`、`WAREHOUSE_STOCK`、品質/效期/送錯/超交/破損/召回及其他；退貨狀態為 `DRAFT → PENDING_SUPPLIER_CONFIRMATION → SUPPLIER_CONFIRMED → READY_TO_RETURN → RETURNED_TO_SUPPLIER → WAITING_RESOLUTION → PARTIALLY_RESOLVED/RESOLVED`，廠商可在等待確認時轉 `REJECTED_BY_SUPPLIER`，也可取消。建立草稿不扣庫存；`READY_TO_RETURN` 只增加 `return_reserved_qty`；只有 `RETURNED_TO_SUPPLIER` 在同一 transaction 扣總倉庫存並寫入 inventory movement。批號/效期受控商品必須填對應資料，退貨量不得超過可退庫存，同一退貨不得重複出庫。
- 退款、換貨、折讓、換其他商品、廠商拒絕及其他結果以退貨明細保存數量與回覆；`REJECTED` 也會保存拒絕數量，避免重複處理。換貨到貨只增加總倉庫存，不直接增加門市庫存；案件所有明細完成處理後才可結案。本階段保存金額與處理紀錄，不產生正式會計折讓傳票。
- 退貨附件可保存破損/效期照片、廠商同意書、託運單、簽收及退款證明等 metadata。`PURCHASING`、`WAREHOUSE`、`ADMIN` 可依權限查看；`STORE` 不得查看退貨附件。附件檔案限制 PDF/JPG/JPEG/PNG、10 MB 以下，實際檔案應由私有儲存 adapter 管理。
- 訂貨/收款關係、主要銀行帳戶切換、缺貨更新/取消/重新採購、退貨保留/出庫/換貨收貨/結案及門市狀態回覆都必須使用 transaction；任何一步失敗不得留下半套狀態、庫存或歷程。以上規則不修改集中採購數量核心公式、既有總倉配貨/門市簽收核心流程、登入角色列舉或會計付款執行。

## 集中採購工作台迭代：同供應商追加、配貨規劃與無成團

- 採購工作台以供應商分組；採購人員可在同一供應商範圍搜尋商品編號、名稱、規格、條碼或供應商商品編號，只有啟用中的 `supplier_products` 可被手動追加。手動追加必須填數量與原因；原因至少包含總倉安全庫存補充、預期活動備貨、季節性備貨、即將調價、補足最低採購金額、補足採購倍數、廠商促銷及其他，選擇 `OTHER` 必須填文字說明。
- 採購來源分為 `DEMAND_SUGGESTION`、`WAREHOUSE_REPLENISHMENT`、`MANUAL_ADDITION`、`MIXED`。同一供應商、同一商品及同一採購單位在同一張採購單只保留一筆明細；系統建議與手動追加會合併，並重新套用 MOQ 與採購倍數。`raw_purchase_qty = demand_suggested_qty + warehouse_replenishment_qty + manual_added_qty`，`warehouse_buffer_qty = max(0, purchaser_confirmed_qty - planned_store_allocation_qty)`，預計配貨合計不得超過確認採購量。所有來源明細寫入 `purchase_order_item_sources`，來源數量合計必須可回溯到採購明細。
- `PURCHASING` 與 `ADMIN` 可查看五家門市及總倉的現有、保留、可用庫存；總倉另顯示已採購未到貨與待配貨，門市另顯示已配貨未簽收與尚未完成需求。`available_qty = max(0, on_hand_qty - reserved_qty)`。`STORE` 只能查看自己的門市，不得查看其他門市、完整採購成本或採購內部備註。
- 商品明細以矩陣顯示各門市前六個完整月份銷售，不含當月；以 2026-07-23 為例為 2026-01 至 2026-06，缺少月份補 0，顯示每月、六個月合計、月平均、最高與最低。總倉沒有銷售資料時顯示 `N/A`，不得混入門市銷售合計。
- 採購人員可設定 `purchase_order_item_store_allocations` 的預計配貨量。這只是採購到貨後的規劃，不會直接增加門市庫存、扣減總倉庫存或取代既有總倉出貨/門市簽收；超出門市尚未完成需求時必須填原因，未分配數量列為總倉備貨。店長與門市只能在自己需求進度查看預計配貨，不能修改。
- 採購狀態包含 `WAITING_AGGREGATION`、`UNDER_REVIEW`、`DRAFT_PURCHASE_ORDER`、`GROUPED`、`ORDER_CREATED`、`ORDERED`、`PARTIALLY_RECEIVED`、`RECEIVED`、`NO_GROUP`、`CANCELLED`、`REOPENED`；狀態異動需記錄操作者、時間、原因與歷程，來源需求明細同步保存採購狀態。
- 商品或尚未轉單的供應商批次可標記 `NO_GROUP`。原因包含 `MINIMUM_QUANTITY_NOT_MET`、`PURCHASE_MULTIPLE_NOT_MET`、`SUPPLIER_MINIMUM_AMOUNT_NOT_MET`、`SUPPLIER_OUT_OF_STOCK`、`SUPPLIER_DISCONTINUED`、`PRICE_NOT_ACCEPTED`、`PRODUCT_DISCONTINUED`、`OTHER`；`OTHER` 必須有說明。無成團不得建立採購單、占用採購單號或虛構採購/配貨數量，但須保存受影響需求、原因、說明、處理人與時間並回覆來源門市。已建立採購單的建議不可再標記無成團；同供應商其他商品不受單一商品無成團影響。
- `PURCHASING` 或 `ADMIN` 可重新開啟無成團建議，狀態改為 `REOPENED` 或 `WAITING_AGGREGATION`，保留原無成團歷史，不刪除原因；交易失敗時所有建議、需求狀態、歷程與 audit 必須 rollback。上述新增商品、合併、來源關聯、預計配貨、無成團、需求回覆及重新開啟在正式 API 必須各自以 transaction 完成。
