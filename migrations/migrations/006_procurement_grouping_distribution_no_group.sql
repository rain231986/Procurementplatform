-- Centralized procurement grouping, source traceability, store allocation planning and no-group workflow.

ALTER TABLE demand_order_items
  ADD COLUMN IF NOT EXISTS procurement_status varchar(32),
  ADD COLUMN IF NOT EXISTS procurement_status_reason varchar(64),
  ADD COLUMN IF NOT EXISTS procurement_status_note text,
  ADD COLUMN IF NOT EXISTS procurement_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_suggestion_id uuid REFERENCES purchase_suggestions(id);

ALTER TABLE purchase_suggestions
  ADD COLUMN IF NOT EXISTS procurement_status varchar(32),
  ADD COLUMN IF NOT EXISTS demand_suggested_qty integer NOT NULL DEFAULT 0 CHECK (demand_suggested_qty >= 0),
  ADD COLUMN IF NOT EXISTS warehouse_replenishment_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_replenishment_qty >= 0),
  ADD COLUMN IF NOT EXISTS system_suggested_purchase_qty integer NOT NULL DEFAULT 0 CHECK (system_suggested_purchase_qty >= 0),
  ADD COLUMN IF NOT EXISTS purchaser_confirmed_qty integer NOT NULL DEFAULT 0 CHECK (purchaser_confirmed_qty >= 0),
  ADD COLUMN IF NOT EXISTS planned_store_allocation_qty integer NOT NULL DEFAULT 0 CHECK (planned_store_allocation_qty >= 0),
  ADD COLUMN IF NOT EXISTS no_group_reason varchar(64),
  ADD COLUMN IF NOT EXISTS no_group_note text,
  ADD COLUMN IF NOT EXISTS no_group_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS no_group_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_group_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

ALTER TABLE purchase_suggestions
  DROP CONSTRAINT IF EXISTS purchase_suggestions_status_check;

ALTER TABLE purchase_suggestions
  ADD CONSTRAINT purchase_suggestions_status_check
  CHECK (status IN ('PENDING', 'GENERATED', 'DRAFT', 'EXPIRED', 'CANCELLED', 'WAITING_AGGREGATION', 'UNDER_REVIEW', 'DRAFT_PURCHASE_ORDER', 'GROUPED', 'ORDER_CREATED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'NO_GROUP', 'REOPENED'));

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS raw_purchase_qty_before_manual integer NOT NULL DEFAULT 0 CHECK (raw_purchase_qty_before_manual >= 0),
  ADD COLUMN IF NOT EXISTS raw_purchase_qty_including_manual integer NOT NULL DEFAULT 0 CHECK (raw_purchase_qty_including_manual >= 0),
  ADD COLUMN IF NOT EXISTS demand_suggested_qty integer NOT NULL DEFAULT 0 CHECK (demand_suggested_qty >= 0),
  ADD COLUMN IF NOT EXISTS warehouse_replenishment_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_replenishment_qty >= 0),
  ADD COLUMN IF NOT EXISTS system_suggested_purchase_qty integer NOT NULL DEFAULT 0 CHECK (system_suggested_purchase_qty >= 0),
  ADD COLUMN IF NOT EXISTS purchaser_confirmed_qty integer NOT NULL DEFAULT 0 CHECK (purchaser_confirmed_qty >= 0),
  ADD COLUMN IF NOT EXISTS planned_store_allocation_qty integer NOT NULL DEFAULT 0 CHECK (planned_store_allocation_qty >= 0),
  ADD COLUMN IF NOT EXISTS warehouse_planned_retention_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_planned_retention_qty >= 0),
  ADD COLUMN IF NOT EXISTS source_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_add_entries jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_source_type_check;

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_source_type_check
  CHECK (source_type IN ('DEMAND_SUGGESTION', 'WAREHOUSE_REPLENISHMENT', 'MANUAL_ADDITION', 'MIXED', 'PURCHASE_SUGGESTION', 'MANUAL_WAREHOUSE_STOCK'));

CREATE TABLE IF NOT EXISTS purchase_order_item_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  source_type varchar(32) NOT NULL CHECK (source_type IN ('DEMAND_SUGGESTION', 'WAREHOUSE_REPLENISHMENT', 'MANUAL_ADDITION', 'MIXED')),
  demand_order_id uuid REFERENCES demand_orders(id) ON DELETE SET NULL,
  demand_order_item_id uuid REFERENCES demand_order_items(id) ON DELETE SET NULL,
  purchase_suggestion_id uuid REFERENCES purchase_suggestions(id) ON DELETE SET NULL,
  source_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  source_qty integer NOT NULL CHECK (source_qty >= 0),
  manual_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_item_store_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  demand_order_id uuid REFERENCES demand_orders(id) ON DELETE SET NULL,
  demand_order_item_id uuid REFERENCES demand_order_items(id) ON DELETE SET NULL,
  suggested_allocation_qty integer NOT NULL DEFAULT 0 CHECK (suggested_allocation_qty >= 0),
  confirmed_allocation_qty integer NOT NULL DEFAULT 0 CHECK (confirmed_allocation_qty >= 0),
  actual_allocated_qty integer NOT NULL DEFAULT 0 CHECK (actual_allocated_qty >= 0),
  actual_received_qty integer NOT NULL DEFAULT 0 CHECK (actual_received_qty >= 0),
  allocation_reason text,
  status varchar(24) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'CANCELLED')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_item_id, location_id)
);

CREATE TABLE IF NOT EXISTS procurement_status_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_order_id uuid REFERENCES demand_orders(id) ON DELETE CASCADE,
  demand_order_item_id uuid REFERENCES demand_order_items(id) ON DELETE CASCADE,
  purchase_suggestion_id uuid REFERENCES purchase_suggestions(id) ON DELETE CASCADE,
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  previous_status varchar(32),
  next_status varchar(32) NOT NULL,
  reason varchar(64),
  note text,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_item_sources_item
  ON purchase_order_item_sources(purchase_order_item_id, source_type);

CREATE INDEX IF NOT EXISTS idx_purchase_item_sources_demand
  ON purchase_order_item_sources(demand_order_id, demand_order_item_id);

CREATE INDEX IF NOT EXISTS idx_purchase_item_store_allocations_location
  ON purchase_order_item_store_allocations(location_id, status);

CREATE INDEX IF NOT EXISTS idx_procurement_status_logs_demand
  ON procurement_status_logs(demand_order_id, demand_order_item_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_procurement_status_logs_suggestion
  ON procurement_status_logs(purchase_suggestion_id, changed_at);
