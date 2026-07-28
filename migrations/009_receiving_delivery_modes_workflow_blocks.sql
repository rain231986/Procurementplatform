-- Receiving routing, per-store delivery plans, inventory movement semantics,
-- extensible product identifiers and structured workflow blocking events.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS delivery_mode varchar(40) NOT NULL DEFAULT 'WAREHOUSE_DISTRIBUTION',
  ADD COLUMN IF NOT EXISTS warehouse_received_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_received_qty >= 0),
  ADD COLUMN IF NOT EXISTS direct_received_qty integer NOT NULL DEFAULT 0 CHECK (direct_received_qty >= 0);
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_delivery_mode_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_delivery_mode_check
  CHECK (delivery_mode IN ('SUPPLIER_DIRECT_TO_STORE', 'WAREHOUSE_DISTRIBUTION'));

ALTER TABLE purchase_order_item_store_allocations
  ADD COLUMN IF NOT EXISTS delivery_mode varchar(40) NOT NULL DEFAULT 'WAREHOUSE_DISTRIBUTION',
  ADD COLUMN IF NOT EXISTS destination_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS warehouse_receipt_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS planned_delivery_qty integer NOT NULL DEFAULT 0 CHECK (planned_delivery_qty >= 0),
  ADD COLUMN IF NOT EXISTS expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS shipped_qty integer NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
  ADD COLUMN IF NOT EXISTS warehouse_received_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_received_qty >= 0),
  ADD COLUMN IF NOT EXISTS signed_qty integer NOT NULL DEFAULT 0 CHECK (signed_qty >= 0),
  ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS short_received_qty integer NOT NULL DEFAULT 0 CHECK (short_received_qty >= 0),
  ADD COLUMN IF NOT EXISTS rejected_qty integer NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  ADD COLUMN IF NOT EXISTS exception_reason text,
  ADD COLUMN IF NOT EXISTS batch_number varchar(80),
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS signed_note text;
UPDATE purchase_order_item_store_allocations
SET destination_location_id = COALESCE(destination_location_id, location_id),
    warehouse_receipt_location_id = COALESCE(warehouse_receipt_location_id, (SELECT id FROM locations WHERE type = 'WAREHOUSE' ORDER BY id LIMIT 1)),
    planned_delivery_qty = CASE WHEN planned_delivery_qty = 0 THEN COALESCE(NULLIF(confirmed_allocation_qty, 0), suggested_allocation_qty) ELSE planned_delivery_qty END;
ALTER TABLE purchase_order_item_store_allocations DROP CONSTRAINT IF EXISTS purchase_order_item_store_allocations_delivery_mode_check;
ALTER TABLE purchase_order_item_store_allocations ADD CONSTRAINT purchase_order_item_store_allocations_delivery_mode_check
  CHECK (delivery_mode IN ('SUPPLIER_DIRECT_TO_STORE', 'WAREHOUSE_DISTRIBUTION'));
ALTER TABLE purchase_order_item_store_allocations DROP CONSTRAINT IF EXISTS purchase_order_item_store_allocations_status_check;
ALTER TABLE purchase_order_item_store_allocations ADD CONSTRAINT purchase_order_item_store_allocations_status_check
  CHECK (status IN ('PLANNED', 'WAITING_SUPPLIER_SHIPMENT', 'WAITING_WAREHOUSE_RECEIPT', 'WAITING_STORE_DIRECT_RECEIPT', 'WAREHOUSE_RECEIVED', 'WAITING_WAREHOUSE_ALLOCATION', 'WAREHOUSE_SHIPPED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'SHORT_RECEIVED', 'REJECTED', 'CANCELLED'));
CREATE INDEX IF NOT EXISTS idx_purchase_item_store_allocations_delivery ON purchase_order_item_store_allocations(delivery_mode, destination_location_id, status);

ALTER TABLE purchase_receipt_logs
  ADD COLUMN IF NOT EXISTS receipt_type varchar(48) NOT NULL DEFAULT 'PURCHASE_RECEIPT_WAREHOUSE',
  ADD COLUMN IF NOT EXISTS movement_type varchar(64) NOT NULL DEFAULT 'PURCHASE_RECEIPT_WAREHOUSE',
  ADD COLUMN IF NOT EXISTS operation_id varchar(160),
  ADD COLUMN IF NOT EXISTS destination_location_id uuid REFERENCES locations(id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_receipt_operation ON purchase_receipt_logs(operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse_shipment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allocation_id uuid NOT NULL, operation_id varchar(160),
  shipped_by uuid REFERENCES users(id), shipped_at timestamptz NOT NULL DEFAULT now(), note text,
  lines jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_warehouse_shipment_operation ON warehouse_shipment_logs(operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS store_receipt_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allocation_id uuid NOT NULL, location_id uuid REFERENCES locations(id),
  operation_id varchar(160), signed_by uuid REFERENCES users(id), signed_at timestamptz NOT NULL DEFAULT now(), note text,
  movement_type varchar(64) NOT NULL DEFAULT 'STORE_RECEIPT_FROM_WAREHOUSE', lines jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_receipt_operation ON store_receipt_logs(operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_direct_receipt_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id uuid REFERENCES purchase_orders(id),
  purchase_order_item_id uuid REFERENCES purchase_order_items(id), store_allocation_id uuid REFERENCES purchase_order_item_store_allocations(id),
  destination_location_id uuid REFERENCES locations(id), operation_id varchar(160), signed_qty integer NOT NULL DEFAULT 0 CHECK (signed_qty >= 0),
  rejected_qty integer NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0), signed_by uuid REFERENCES users(id), signed_at timestamptz NOT NULL DEFAULT now(), note text
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_direct_receipt_operation ON supplier_direct_receipt_logs(operation_id) WHERE operation_id IS NOT NULL;

ALTER TABLE product_identifiers
  ADD COLUMN IF NOT EXISTS product_variant_id uuid,
  ADD COLUMN IF NOT EXISTS specification_key varchar(120) NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS slot_number integer NOT NULL DEFAULT 1 CHECK (slot_number BETWEEN 1 AND 6),
  ADD COLUMN IF NOT EXISTS identifier_value varchar(120);
UPDATE product_identifiers SET identifier_value = COALESCE(identifier_value, value);
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY product_id, COALESCE(specification_key, 'DEFAULT') ORDER BY is_primary DESC, created_at ASC NULLS LAST, id) AS slot
  FROM product_identifiers
  WHERE is_active = true
)
UPDATE product_identifiers identifier
SET slot_number = LEAST(6, ranked.slot),
    is_active = ranked.slot <= 6,
    is_primary = ranked.slot = 1
FROM ranked
WHERE identifier.id = ranked.id;
ALTER TABLE product_identifiers DROP CONSTRAINT IF EXISTS product_identifiers_identifier_type_value_key;
DROP INDEX IF EXISTS product_identifiers_identifier_type_value_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_identifier_active_value ON product_identifiers(value) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_identifier_active_slot ON product_identifiers(product_id, specification_key, slot_number) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_identifier_primary_spec ON product_identifiers(product_id, specification_key) WHERE is_active = true AND is_primary = true;
CREATE INDEX IF NOT EXISTS idx_product_identifiers_product_spec ON product_identifiers(product_id, specification_key, slot_number);

CREATE TABLE IF NOT EXISTS workflow_block_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_type varchar(40) NOT NULL CHECK (workflow_type IN ('DEMAND_ORDER', 'PURCHASE_ORDER', 'SUPPLIER_DIRECT_RECEIPT', 'WAREHOUSE_RECEIPT', 'STORE_RECEIPT')),
  entity_type varchar(40) NOT NULL, entity_id uuid NOT NULL, entity_location_id uuid REFERENCES locations(id), attempted_action varchar(80) NOT NULL, current_status varchar(48),
  blocking_code varchar(80) NOT NULL, blocking_summary text NOT NULL, blocking_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  responsible_role varchar(32), product_id uuid REFERENCES products(id), is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz, resolved_by uuid REFERENCES users(id), created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workflow_block_events ADD COLUMN IF NOT EXISTS entity_location_id uuid REFERENCES locations(id);
CREATE INDEX IF NOT EXISTS idx_workflow_block_events_entity ON workflow_block_events(entity_id, attempted_action, is_resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_block_events_location ON workflow_block_events(entity_location_id, is_resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_block_events_role ON workflow_block_events(responsible_role, is_resolved, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_block_event_id uuid NOT NULL REFERENCES workflow_block_events(id) ON DELETE CASCADE,
  recipient_role varchar(32) NOT NULL, recipient_user_id uuid REFERENCES users(id), entity_id uuid NOT NULL,
  message text NOT NULL, is_read boolean NOT NULL DEFAULT false, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_notifications_recipient ON workflow_notifications(recipient_role, is_read, created_at DESC);
