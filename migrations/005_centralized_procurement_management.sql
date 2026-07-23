-- 集中採購建議、採購單生命週期、來源需求追蹤與總倉到貨。

ALTER TYPE purchase_status ADD VALUE IF NOT EXISTS 'PENDING_CONFIRMATION';
ALTER TYPE purchase_status ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TABLE purchase_suggestions
  ADD COLUMN IF NOT EXISTS raw_purchase_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demand_allocated_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_supplement_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suggested_purchase_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_purchase_qty integer,
  ADD COLUMN IF NOT EXISTS warehouse_buffer_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_unit varchar(32),
  ADD COLUMN IF NOT EXISTS purchase_multiple integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS minimum_order_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_amount_met boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE purchase_suggestions
SET raw_purchase_qty = COALESCE(NULLIF(raw_purchase_qty, 0), shortage_qty),
    demand_allocated_qty = COALESCE(NULLIF(demand_allocated_qty, 0), shortage_qty),
    suggested_purchase_qty = COALESCE(NULLIF(suggested_purchase_qty, 0), suggested_qty),
    confirmed_purchase_qty = COALESCE(confirmed_purchase_qty, confirmed_qty),
    warehouse_buffer_qty = COALESCE(NULLIF(warehouse_buffer_qty, 0), overage_qty);

ALTER TABLE purchase_suggestions
  DROP CONSTRAINT IF EXISTS purchase_suggestions_status_check;

ALTER TABLE purchase_suggestions
  ADD CONSTRAINT purchase_suggestions_status_check
  CHECK (status IN ('PENDING', 'DRAFT', 'ORDERED', 'EXPIRED', 'CANCELLED'));

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS source_type varchar(32) NOT NULL DEFAULT 'PURCHASE_SUGGESTION',
  ADD COLUMN IF NOT EXISTS actual_first_received_date date,
  ADD COLUMN IF NOT EXISTS actual_completed_date date,
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'TWD',
  ADD COLUMN IF NOT EXISTS tax_type varchar(24) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_amount_met boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS overridden_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_contact_name varchar(80),
  ADD COLUMN IF NOT EXISTS supplier_contact_phone varchar(40),
  ADD COLUMN IF NOT EXISTS supplier_contact_email varchar(160),
  ADD COLUMN IF NOT EXISTS payment_terms varchar(120),
  ADD COLUMN IF NOT EXISTS delivery_location_id uuid REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS ordered_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_source_type_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_source_type_check
  CHECK (source_type IN ('PURCHASE_SUGGESTION', 'MANUAL', 'MIXED'));

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS source_type varchar(32) NOT NULL DEFAULT 'PURCHASE_SUGGESTION',
  ADD COLUMN IF NOT EXISTS suggestion_id uuid REFERENCES purchase_suggestions(id),
  ADD COLUMN IF NOT EXISTS manual_add_reason text,
  ADD COLUMN IF NOT EXISTS manual_reason_code varchar(40),
  ADD COLUMN IF NOT EXISTS manual_reason_detail text,
  ADD COLUMN IF NOT EXISTS manual_added_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_added_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS manual_added_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_product_code varchar(80),
  ADD COLUMN IF NOT EXISTS purchase_unit varchar(32) NOT NULL DEFAULT '件',
  ADD COLUMN IF NOT EXISTS purchase_multiple integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS minimum_order_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gift_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_buffer_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS raw_purchase_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_demand_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demand_allocated_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_supplement_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suggested_purchase_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_purchase_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multiple_overage_qty integer NOT NULL DEFAULT 0;

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_source_type_check;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_source_type_check
  CHECK (source_type IN ('PURCHASE_SUGGESTION', 'MANUAL_WAREHOUSE_STOCK', 'MIXED'));

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_manual_demand_check;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_manual_demand_check
  CHECK (source_type <> 'MANUAL_WAREHOUSE_STOCK' OR demand_allocated_qty = 0);

ALTER TABLE purchase_suggestions
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES purchase_order_items(id);

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_manual_added_qty_check;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_manual_added_qty_check
  CHECK (manual_added_qty >= 0);

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_raw_demand_qty_check;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_raw_demand_qty_check
  CHECK (raw_demand_qty >= 0);

ALTER TABLE purchase_order_items
  DROP COLUMN IF EXISTS remaining_qty;

ALTER TABLE purchase_order_items
  ADD COLUMN remaining_qty integer GENERATED ALWAYS AS (GREATEST(0, ordered_qty - received_qty - cancelled_qty)) STORED;

CREATE TABLE IF NOT EXISTS demand_purchase_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_order_id uuid NOT NULL REFERENCES demand_orders(id) ON DELETE CASCADE,
  demand_order_item_id uuid NOT NULL REFERENCES demand_order_items(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  allocated_qty integer NOT NULL CHECK (allocated_qty > 0),
  received_allocated_qty integer NOT NULL DEFAULT 0 CHECK (received_allocated_qty >= 0),
  cancelled_allocated_qty integer NOT NULL DEFAULT 0 CHECK (cancelled_allocated_qty >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE demand_purchase_allocations
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS received_allocated_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_allocated_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_received_cancelled_check;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_received_cancelled_check
  CHECK (received_qty + cancelled_qty <= ordered_qty);

ALTER TABLE demand_purchase_allocations
  DROP CONSTRAINT IF EXISTS demand_purchase_allocations_received_cancelled_check;

ALTER TABLE demand_purchase_allocations
  ADD CONSTRAINT demand_purchase_allocations_received_cancelled_check
  CHECK (received_allocated_qty + cancelled_allocated_qty <= allocated_qty);

CREATE INDEX IF NOT EXISTS idx_purchase_suggestions_supplier_status
  ON purchase_suggestions(supplier_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product
  ON purchase_order_items(product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_items_product
  ON purchase_order_items(purchase_order_id, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_items_suggestion
  ON purchase_order_items(purchase_order_id, suggestion_id)
  WHERE suggestion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_demand_purchase_allocations_demand
  ON demand_purchase_allocations(demand_order_id, demand_order_item_id);

CREATE INDEX IF NOT EXISTS idx_demand_purchase_allocations_order
  ON demand_purchase_allocations(purchase_order_id, purchase_order_item_id);

CREATE TABLE IF NOT EXISTS purchase_order_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  action varchar(64) NOT NULL,
  before_data jsonb,
  after_data jsonb,
  reason text
);

CREATE TABLE IF NOT EXISTS purchase_tracking_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  contact_date date,
  expected_delivery_date date,
  vendor_status varchar(32) NOT NULL DEFAULT 'PENDING',
  note text,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_receipt_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  received_by uuid NOT NULL REFERENCES users(id),
  received_at date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_tracking_order
  ON purchase_tracking_notes(purchase_order_id, updated_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_purchase_suggestion_order'
  ) THEN
    ALTER TABLE purchase_suggestions
      ADD CONSTRAINT fk_purchase_suggestion_order
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);
  END IF;
END $$;
