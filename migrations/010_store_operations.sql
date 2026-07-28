-- Store-to-store transfers, store safety stock, store returns and item-level
-- purchase shortage gates. All inventory-affecting mutations must run in one
-- database transaction with the matching inventory_movement and audit_log.

ALTER TABLE location_product_settings
  ADD COLUMN IF NOT EXISTS replenishment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_modified_reason text;
ALTER TABLE location_product_settings DROP CONSTRAINT IF EXISTS location_product_settings_stock_range_check;
ALTER TABLE location_product_settings ADD CONSTRAINT location_product_settings_stock_range_check
  CHECK (maximum_stock_qty = 0 OR maximum_stock_qty >= safety_stock_qty);

ALTER TABLE inventory_balances
  ADD COLUMN IF NOT EXISTS return_in_transit_qty integer NOT NULL DEFAULT 0 CHECK (return_in_transit_qty >= 0),
  ADD COLUMN IF NOT EXISTS transfer_in_transit_qty integer NOT NULL DEFAULT 0 CHECK (transfer_in_transit_qty >= 0);

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS operation_id varchar(160),
  ADD COLUMN IF NOT EXISTS source_type varchar(40),
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_item_id uuid,
  ADD COLUMN IF NOT EXISTS from_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS to_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS batch_number varchar(80),
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_operation ON inventory_movements(operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_source ON inventory_movements(source_type, source_id, source_item_id);

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS internal_shortage_note text;

CREATE TABLE IF NOT EXISTS store_transfer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number varchar(40) NOT NULL UNIQUE,
  source_location_id uuid NOT NULL REFERENCES locations(id),
  destination_location_id uuid NOT NULL REFERENCES locations(id),
  status varchar(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_SOURCE_APPROVAL','RETURNED','APPROVED','PARTIALLY_SHIPPED','SHIPPED','PARTIALLY_RECEIVED','RECEIVED','REJECTED','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  shipped_by uuid REFERENCES users(id),
  shipped_at timestamptz,
  received_by uuid REFERENCES users(id),
  received_at timestamptz,
  rejected_by uuid REFERENCES users(id),
  rejected_at timestamptz,
  reject_reason text,
  return_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_location_id <> destination_location_id)
);

CREATE TABLE IF NOT EXISTS store_transfer_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_order_id uuid NOT NULL REFERENCES store_transfer_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  requested_qty integer NOT NULL CHECK (requested_qty >= 0),
  approved_qty integer NOT NULL DEFAULT 0 CHECK (approved_qty >= 0),
  shipped_qty integer NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  rejected_qty integer NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  source_available_qty_snapshot integer CHECK (source_available_qty_snapshot IS NULL OR source_available_qty_snapshot >= 0),
  source_safety_stock_snapshot integer CHECK (source_safety_stock_snapshot IS NULL OR source_safety_stock_snapshot >= 0),
  destination_on_hand_qty_snapshot integer CHECK (destination_on_hand_qty_snapshot IS NULL OR destination_on_hand_qty_snapshot >= 0),
  destination_safety_stock_snapshot integer CHECK (destination_safety_stock_snapshot IS NULL OR destination_safety_stock_snapshot >= 0),
  batch_number varchar(80),
  expiry_date date,
  item_note text,
  safety_stock_override boolean NOT NULL DEFAULT false,
  override_reason text,
  overridden_by uuid REFERENCES users(id),
  overridden_at timestamptz,
  quantity_adjustment_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  remaining_ship_qty integer GENERATED ALWAYS AS (GREATEST(0, approved_qty - shipped_qty - rejected_qty)) STORED,
  remaining_receive_qty integer GENERATED ALWAYS AS (GREATEST(0, shipped_qty - received_qty)) STORED,
  CHECK (approved_qty <= requested_qty),
  CHECK (shipped_qty <= approved_qty),
  CHECK (received_qty + rejected_qty <= shipped_qty)
);
CREATE INDEX IF NOT EXISTS idx_store_transfer_orders_route ON store_transfer_orders(source_location_id, destination_location_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_transfer_items_product ON store_transfer_order_items(product_id, transfer_order_id);

CREATE TABLE IF NOT EXISTS store_return_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number varchar(40) NOT NULL UNIQUE,
  source_location_id uuid NOT NULL REFERENCES locations(id),
  warehouse_location_id uuid NOT NULL REFERENCES locations(id),
  source_type varchar(32) NOT NULL DEFAULT 'STORE_TO_WAREHOUSE',
  status varchar(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_STORE_MANAGER_APPROVAL','PENDING_WAREHOUSE_APPROVAL','APPROVED','SHIPPED_TO_WAREHOUSE','PARTIALLY_RECEIVED','RECEIVED_BY_WAREHOUSE','REJECTED','RETURNED_TO_STORE','CANCELLED')),
  return_reason text,
  requested_by uuid NOT NULL REFERENCES users(id),
  approved_by_store_manager uuid REFERENCES users(id),
  approved_by_warehouse uuid REFERENCES users(id),
  shipped_by uuid REFERENCES users(id),
  shipped_at timestamptz,
  received_by uuid REFERENCES users(id),
  received_at timestamptz,
  rejected_by uuid REFERENCES users(id),
  rejected_at timestamptz,
  reject_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_return_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id uuid NOT NULL REFERENCES store_return_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  return_qty integer NOT NULL CHECK (return_qty > 0),
  shipped_qty integer NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  rejected_qty integer NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  rejected_returned_qty integer NOT NULL DEFAULT 0 CHECK (rejected_returned_qty >= 0),
  available_qty_snapshot integer NOT NULL DEFAULT 0 CHECK (available_qty_snapshot >= 0),
  batch_number varchar(80),
  expiry_date date,
  reason_code varchar(40) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  in_transit_qty integer GENERATED ALWAYS AS (GREATEST(0, shipped_qty - received_qty - rejected_qty)) STORED,
  CHECK (shipped_qty <= return_qty),
  CHECK (received_qty + rejected_qty <= shipped_qty),
  CHECK (rejected_returned_qty <= rejected_qty)
);
CREATE INDEX IF NOT EXISTS idx_store_return_orders_status ON store_return_orders(source_location_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_return_items_product ON store_return_order_items(product_id, return_order_id);

ALTER TABLE supplier_return_orders
  ADD COLUMN IF NOT EXISTS source_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS source_demand_order_id uuid REFERENCES demand_orders(id),
  ADD COLUMN IF NOT EXISTS store_note text,
  ADD COLUMN IF NOT EXISTS return_address text,
  ADD COLUMN IF NOT EXISTS return_method varchar(80),
  ADD COLUMN IF NOT EXISTS approved_by_store_manager uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by_purchasing uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by_store_manager_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_purchasing_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text;
CREATE INDEX IF NOT EXISTS idx_supplier_returns_store_source ON supplier_return_orders(source_location_id, source_type, status, created_at DESC);

ALTER TABLE supplier_return_order_items
  ADD COLUMN IF NOT EXISTS source_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS available_qty_snapshot integer CHECK (available_qty_snapshot IS NULL OR available_qty_snapshot >= 0),
  ADD COLUMN IF NOT EXISTS accepted_return_qty integer NOT NULL DEFAULT 0 CHECK (accepted_return_qty >= 0),
  ADD COLUMN IF NOT EXISTS rejected_returned_qty integer NOT NULL DEFAULT 0 CHECK (rejected_returned_qty >= 0),
  ADD COLUMN IF NOT EXISTS replacement_product_id uuid REFERENCES products(id);

CREATE TABLE IF NOT EXISTS store_return_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id uuid NOT NULL REFERENCES store_return_orders(id) ON DELETE CASCADE,
  return_order_item_id uuid REFERENCES store_return_order_items(id) ON DELETE CASCADE,
  attachment_type varchar(40) NOT NULL,
  file_name varchar(240) NOT NULL,
  file_type varchar(120) NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  storage_key varchar(500) NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_store_return_attachments_order ON store_return_attachments(return_order_id, uploaded_at DESC);

ALTER TABLE workflow_block_events DROP CONSTRAINT IF EXISTS workflow_block_events_workflow_type_check;
ALTER TABLE workflow_block_events ADD CONSTRAINT workflow_block_events_workflow_type_check
  CHECK (workflow_type IN ('DEMAND_ORDER','PURCHASE_ORDER','PURCHASE_ITEM_SHORTAGE','SUPPLIER_DIRECT_RECEIPT','WAREHOUSE_RECEIPT','STORE_RECEIPT','STORE_TRANSFER','STORE_RETURN_WAREHOUSE','STORE_RETURN_SUPPLIER'));
