CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('ADMIN', 'STORE', 'WAREHOUSE', 'PURCHASING');
CREATE TYPE location_type AS ENUM ('STORE', 'WAREHOUSE');
CREATE TYPE demand_source AS ENUM ('MANUAL', 'AUTO');
CREATE TYPE demand_status AS ENUM ('DRAFT', 'PENDING_MANAGER_APPROVAL', 'RETURNED', 'SUBMITTED', 'APPROVED', 'PROCESSING', 'PARTIALLY_ALLOCATED', 'WAITING_PURCHASE', 'COMPLETED', 'CANCELLED');
CREATE TYPE allocation_status AS ENUM ('DRAFT', 'PICKING', 'SHIPPED', 'RECEIVED', 'CANCELLED');
CREATE TYPE purchase_status AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');
CREATE TYPE condition_mode AS ENUM ('QUANTITY_ONLY', 'AMOUNT_ONLY', 'EITHER', 'BOTH');

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  type location_type NOT NULL,
  address varchar(240),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(64) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_changed_at timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,
  display_name varchar(120) NOT NULL,
  role user_role NOT NULL,
  location_id uuid REFERENCES locations(id),
  is_store_manager boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code varchar(32) NOT NULL UNIQUE,
  supplier_name varchar(160) NOT NULL,
  tax_id varchar(32),
  contact_name varchar(80),
  phone varchar(40),
  email varchar(160),
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code varchar(64) NOT NULL UNIQUE,
  barcode varchar(64) NOT NULL UNIQUE,
  product_name varchar(180) NOT NULL,
  specification varchar(180),
  category varchar(80),
  base_unit varchar(32) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  default_supplier_id uuid REFERENCES suppliers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  supplier_product_code varchar(80),
  purchase_unit varchar(32) NOT NULL,
  purchase_multiple integer NOT NULL DEFAULT 1 CHECK (purchase_multiple >= 1),
  minimum_order_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_order_quantity >= 0),
  minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
  purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  is_primary boolean NOT NULL DEFAULT false,
  UNIQUE (product_id, supplier_id)
);

CREATE TABLE location_product_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  safety_stock_qty integer NOT NULL DEFAULT 0 CHECK (safety_stock_qty >= 0),
  maximum_stock_qty integer NOT NULL DEFAULT 0 CHECK (maximum_stock_qty >= 0),
  minimum_replenishment_qty integer NOT NULL DEFAULT 1 CHECK (minimum_replenishment_qty >= 0),
  store_distribution_multiple integer NOT NULL DEFAULT 1 CHECK (store_distribution_multiple >= 1),
  automatic_replenishment_enabled boolean NOT NULL DEFAULT false,
  UNIQUE (location_id, product_id)
);

CREATE TABLE inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  on_hand_qty integer NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
  reserved_qty integer NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, product_id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  movement_type varchar(40) NOT NULL,
  quantity integer NOT NULL,
  before_qty integer NOT NULL CHECK (before_qty >= 0),
  after_qty integer NOT NULL CHECK (after_qty >= 0),
  reference_type varchar(40),
  reference_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demand_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_number varchar(40) NOT NULL UNIQUE,
  location_id uuid NOT NULL REFERENCES locations(id),
  source_type demand_source NOT NULL,
  demand_type varchar(32) NOT NULL,
  required_date date NOT NULL,
  status demand_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  manager_approved_by uuid REFERENCES users(id),
  manager_approved_at timestamptz,
  returned_by uuid REFERENCES users(id),
  returned_at timestamptz,
  return_reason text,
  manager_reason text
);

CREATE TABLE demand_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_order_id uuid NOT NULL REFERENCES demand_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  requested_qty integer NOT NULL CHECK (requested_qty > 0),
  approved_qty integer NOT NULL DEFAULT 0 CHECK (approved_qty >= 0),
  allocated_qty integer NOT NULL DEFAULT 0 CHECK (allocated_qty >= 0),
  purchase_required_qty integer NOT NULL DEFAULT 0 CHECK (purchase_required_qty >= 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  reason text,
  notes text,
  reference_purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (reference_purchase_price >= 0),
  line_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (line_amount >= 0),
  replenishment_suggestion_id uuid UNIQUE,
  system_suggested_qty integer CHECK (system_suggested_qty IS NULL OR system_suggested_qty >= 0),
  store_confirmed_qty integer CHECK (store_confirmed_qty IS NULL OR store_confirmed_qty >= 0),
  manager_confirmed_qty integer CHECK (manager_confirmed_qty IS NULL OR manager_confirmed_qty >= 0),
  final_requested_qty integer CHECK (final_requested_qty IS NULL OR final_requested_qty >= 0),
  store_adjustment_reason text,
  manager_adjustment_reason text,
  manager_skipped boolean NOT NULL DEFAULT false,
  current_stock_snapshot integer CHECK (current_stock_snapshot IS NULL OR current_stock_snapshot >= 0),
  on_hand_qty_snapshot integer CHECK (on_hand_qty_snapshot IS NULL OR on_hand_qty_snapshot >= 0),
  reserved_qty_snapshot integer CHECK (reserved_qty_snapshot IS NULL OR reserved_qty_snapshot >= 0),
  available_qty_snapshot integer CHECK (available_qty_snapshot IS NULL OR available_qty_snapshot >= 0),
  calculated_at timestamptz,
  six_month_sales_total_snapshot integer CHECK (six_month_sales_total_snapshot IS NULL OR six_month_sales_total_snapshot >= 0),
  six_month_average_snapshot numeric(12, 2) CHECK (six_month_average_snapshot IS NULL OR six_month_average_snapshot >= 0),
  six_month_sales_max_snapshot integer CHECK (six_month_sales_max_snapshot IS NULL OR six_month_sales_max_snapshot >= 0),
  six_month_sales_min_snapshot integer CHECK (six_month_sales_min_snapshot IS NULL OR six_month_sales_min_snapshot >= 0),
  minimum_qty_snapshot integer CHECK (minimum_qty_snapshot IS NULL OR minimum_qty_snapshot >= 0),
  minimum_amount_snapshot numeric(12, 2) CHECK (minimum_amount_snapshot IS NULL OR minimum_amount_snapshot >= 0),
  condition_mode_snapshot condition_mode,
  supplier_minimum_qty_snapshot integer CHECK (supplier_minimum_qty_snapshot IS NULL OR supplier_minimum_qty_snapshot >= 0),
  supplier_minimum_amount_snapshot numeric(12, 2) CHECK (supplier_minimum_amount_snapshot IS NULL OR supplier_minimum_amount_snapshot >= 0),
  supplier_purchase_multiple_snapshot integer CHECK (supplier_purchase_multiple_snapshot IS NULL OR supplier_purchase_multiple_snapshot >= 1)
);

CREATE TABLE monthly_product_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  sales_year integer NOT NULL CHECK (sales_year >= 2000),
  sales_month integer NOT NULL CHECK (sales_month BETWEEN 1 AND 12),
  sales_qty numeric(14, 2) NOT NULL DEFAULT 0 CHECK (sales_qty >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, product_id, sales_year, sales_month)
);

CREATE TABLE store_order_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  minimum_qty integer CHECK (minimum_qty IS NULL OR minimum_qty >= 0),
  minimum_amount numeric(12, 2) CHECK (minimum_amount IS NULL OR minimum_amount >= 0),
  condition_mode condition_mode NOT NULL DEFAULT 'QUANTITY_ONLY',
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_qty IS NOT NULL OR minimum_amount IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE TABLE replenishment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id),
  calculated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replenishment_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replenishment_run_id uuid NOT NULL REFERENCES replenishment_runs(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  projected_available_qty integer NOT NULL,
  raw_required_qty integer NOT NULL,
  base_suggested_qty integer NOT NULL,
  suggested_qty integer NOT NULL,
  original_suggested_qty integer,
  system_suggested_qty integer NOT NULL DEFAULT 0 CHECK (system_suggested_qty >= 0),
  store_confirmed_qty integer CHECK (store_confirmed_qty IS NULL OR store_confirmed_qty >= 0),
  manager_confirmed_qty integer CHECK (manager_confirmed_qty IS NULL OR manager_confirmed_qty >= 0),
  final_requested_qty integer CHECK (final_requested_qty IS NULL OR final_requested_qty >= 0),
  confirmed_qty integer,
  adjustment_reason text,
  store_adjustment_reason text,
  manager_adjustment_reason text,
  adjusted_by uuid REFERENCES users(id),
  adjusted_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'STORE_REVIEWING', 'ACCEPTED', 'ADJUSTED', 'SKIPPED', 'CONVERTED_TO_DEMAND', 'EXPIRED')),
  demand_order_id uuid REFERENCES demand_orders(id),
  on_hand_qty_snapshot integer NOT NULL DEFAULT 0 CHECK (on_hand_qty_snapshot >= 0),
  reserved_qty_snapshot integer NOT NULL DEFAULT 0 CHECK (reserved_qty_snapshot >= 0),
  available_qty_snapshot integer NOT NULL DEFAULT 0 CHECK (available_qty_snapshot >= 0),
  six_month_sales_total_snapshot integer NOT NULL DEFAULT 0 CHECK (six_month_sales_total_snapshot >= 0),
  six_month_sales_average_snapshot numeric(12, 2) NOT NULL DEFAULT 0 CHECK (six_month_sales_average_snapshot >= 0),
  six_month_sales_max_snapshot integer NOT NULL DEFAULT 0 CHECK (six_month_sales_max_snapshot >= 0),
  six_month_sales_min_snapshot integer NOT NULL DEFAULT 0 CHECK (six_month_sales_min_snapshot >= 0),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replenishment_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replenishment_suggestion_id uuid REFERENCES replenishment_suggestions(id),
  demand_order_id uuid REFERENCES demand_orders(id),
  demand_order_item_id uuid REFERENCES demand_order_items(id),
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  actor_type varchar(24) NOT NULL CHECK (actor_type IN ('STORE_USER', 'STORE_MANAGER', 'ADMIN')),
  change_type varchar(48) NOT NULL CHECK (change_type IN ('STORE_QTY_CHANGED', 'STORE_SKIPPED', 'MANAGER_QTY_CHANGED', 'MANAGER_ITEM_SKIPPED', 'MANAGER_REQUIRED_DATE_CHANGED', 'MANAGER_REASON_CHANGED', 'MANAGER_NOTE_CHANGED', 'MANAGER_RETURNED', 'MANAGER_APPROVED')),
  field_name varchar(80),
  before_value jsonb,
  after_value jsonb,
  change_reason text
);

ALTER TABLE demand_order_items
  ADD CONSTRAINT fk_demand_item_replenishment_suggestion
  FOREIGN KEY (replenishment_suggestion_id) REFERENCES replenishment_suggestions(id);

CREATE TABLE allocation_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_number varchar(40) NOT NULL UNIQUE,
  source_location_id uuid NOT NULL REFERENCES locations(id),
  destination_location_id uuid NOT NULL REFERENCES locations(id),
  demand_order_id uuid NOT NULL REFERENCES demand_orders(id),
  status allocation_status NOT NULL DEFAULT 'DRAFT',
  shipped_at timestamptz,
  received_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE allocation_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_order_id uuid NOT NULL REFERENCES allocation_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  requested_qty integer NOT NULL CHECK (requested_qty >= 0),
  allocated_qty integer NOT NULL CHECK (allocated_qty >= 0),
  shipped_qty integer NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0)
);

CREATE TABLE purchase_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  shortage_qty integer NOT NULL CHECK (shortage_qty >= 0),
  suggested_qty integer NOT NULL CHECK (suggested_qty >= 0),
  confirmed_qty integer,
  overage_qty integer NOT NULL DEFAULT 0 CHECK (overage_qty >= 0),
  raw_purchase_qty integer NOT NULL DEFAULT 0 CHECK (raw_purchase_qty >= 0),
  demand_allocated_qty integer NOT NULL DEFAULT 0 CHECK (demand_allocated_qty >= 0),
  warehouse_supplement_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_supplement_qty >= 0),
  suggested_purchase_qty integer NOT NULL DEFAULT 0 CHECK (suggested_purchase_qty >= 0),
  confirmed_purchase_qty integer,
  warehouse_buffer_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_buffer_qty >= 0),
  purchase_unit varchar(32),
  purchase_multiple integer NOT NULL DEFAULT 1 CHECK (purchase_multiple >= 1),
  minimum_order_quantity integer NOT NULL DEFAULT 0 CHECK (minimum_order_quantity >= 0),
  supplier_minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (supplier_minimum_order_amount >= 0),
  purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  estimated_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
  minimum_amount_met boolean NOT NULL DEFAULT false,
  expected_delivery_date date,
  status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DRAFT', 'ORDERED', 'EXPIRED', 'CANCELLED')),
  purchase_order_id uuid,
  created_by uuid REFERENCES users(id),
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_number varchar(40) NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  source_type varchar(32) NOT NULL DEFAULT 'PURCHASE_SUGGESTION' CHECK (source_type IN ('PURCHASE_SUGGESTION', 'MANUAL', 'MIXED')),
  order_date date NOT NULL,
  expected_delivery_date date,
  actual_first_received_date date,
  actual_completed_date date,
  status purchase_status NOT NULL DEFAULT 'DRAFT',
  currency varchar(8) NOT NULL DEFAULT 'TWD',
  tax_type varchar(24) NOT NULL DEFAULT 'NONE',
  subtotal_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  supplier_minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (supplier_minimum_order_amount >= 0),
  minimum_amount_met boolean NOT NULL DEFAULT false,
  override_reason text,
  overridden_by uuid REFERENCES users(id),
  overridden_at timestamptz,
  notes text,
  supplier_contact_name varchar(80),
  supplier_contact_phone varchar(40),
  supplier_contact_email varchar(160),
  payment_terms varchar(120),
  delivery_location_id uuid REFERENCES locations(id),
  created_by uuid NOT NULL REFERENCES users(id),
  confirmed_by uuid REFERENCES users(id),
  ordered_by uuid REFERENCES users(id),
  cancelled_by uuid REFERENCES users(id),
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  ordered_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_suggestions
  ADD CONSTRAINT fk_purchase_suggestion_order
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);

CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  source_type varchar(32) NOT NULL DEFAULT 'PURCHASE_SUGGESTION' CHECK (source_type IN ('PURCHASE_SUGGESTION', 'MANUAL_WAREHOUSE_STOCK', 'MIXED')),
  suggestion_id uuid REFERENCES purchase_suggestions(id),
  manual_add_reason text,
  manual_reason_code varchar(40),
  manual_reason_detail text,
  manual_added_qty integer NOT NULL DEFAULT 0 CHECK (manual_added_qty >= 0),
  manual_added_by uuid REFERENCES users(id),
  manual_added_at timestamptz,
  supplier_product_code varchar(80),
  purchase_unit varchar(32) NOT NULL DEFAULT '件',
  purchase_multiple integer NOT NULL DEFAULT 1 CHECK (purchase_multiple >= 1),
  minimum_order_quantity integer NOT NULL DEFAULT 0 CHECK (minimum_order_quantity >= 0),
  ordered_qty integer NOT NULL CHECK (ordered_qty > 0),
  purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  cancelled_qty integer NOT NULL DEFAULT 0 CHECK (cancelled_qty >= 0),
  CHECK (received_qty + cancelled_qty <= ordered_qty),
  remaining_qty integer GENERATED ALWAYS AS (GREATEST(0, ordered_qty - received_qty - cancelled_qty)) STORED,
  line_subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (line_subtotal >= 0),
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  gift_qty integer NOT NULL DEFAULT 0 CHECK (gift_qty >= 0),
  raw_demand_qty integer NOT NULL DEFAULT 0 CHECK (raw_demand_qty >= 0),
  raw_purchase_qty integer NOT NULL DEFAULT 0 CHECK (raw_purchase_qty >= 0),
  demand_allocated_qty integer NOT NULL DEFAULT 0 CHECK (demand_allocated_qty >= 0),
  warehouse_supplement_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_supplement_qty >= 0),
  suggested_purchase_qty integer NOT NULL DEFAULT 0 CHECK (suggested_purchase_qty >= 0),
  confirmed_purchase_qty integer NOT NULL DEFAULT 0 CHECK (confirmed_purchase_qty >= 0),
  multiple_overage_qty integer NOT NULL DEFAULT 0 CHECK (multiple_overage_qty >= 0),
  warehouse_buffer_qty integer NOT NULL DEFAULT 0 CHECK (warehouse_buffer_qty >= 0),
  expected_delivery_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type <> 'MANUAL_WAREHOUSE_STOCK' OR demand_allocated_qty = 0)
);

ALTER TABLE purchase_suggestions
  ADD COLUMN purchase_order_item_id uuid REFERENCES purchase_order_items(id);

CREATE UNIQUE INDEX uq_purchase_order_items_product
  ON purchase_order_items(purchase_order_id, product_id);

CREATE UNIQUE INDEX uq_purchase_order_items_suggestion
  ON purchase_order_items(purchase_order_id, suggestion_id)
  WHERE suggestion_id IS NOT NULL;

CREATE TABLE demand_purchase_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_order_id uuid NOT NULL REFERENCES demand_orders(id) ON DELETE CASCADE,
  demand_order_item_id uuid NOT NULL REFERENCES demand_order_items(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  allocated_qty integer NOT NULL CHECK (allocated_qty > 0),
  received_allocated_qty integer NOT NULL DEFAULT 0 CHECK (received_allocated_qty >= 0),
  cancelled_allocated_qty integer NOT NULL DEFAULT 0 CHECK (cancelled_allocated_qty >= 0),
  CHECK (received_allocated_qty + cancelled_allocated_qty <= allocated_qty),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  action varchar(64) NOT NULL,
  before_data jsonb,
  after_data jsonb,
  reason text
);

CREATE TABLE purchase_tracking_notes (
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

CREATE TABLE purchase_receipt_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  received_by uuid NOT NULL REFERENCES users(id),
  received_at date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action varchar(80) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_location ON users(location_id);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_inventory_location_product ON inventory_balances(location_id, product_id);
CREATE INDEX idx_demands_location_status ON demand_orders(location_id, status);
CREATE INDEX idx_demands_created_at ON demand_orders(created_at);
CREATE INDEX idx_demand_items_product ON demand_order_items(product_id);
CREATE INDEX idx_demand_items_replenishment_suggestion ON demand_order_items(replenishment_suggestion_id);
CREATE INDEX idx_monthly_product_sales_lookup ON monthly_product_sales(location_id, product_id, sales_year, sales_month);
CREATE INDEX idx_store_order_conditions_lookup ON store_order_conditions(location_id, product_id, is_active);
CREATE INDEX idx_allocations_status ON allocation_orders(status);
CREATE INDEX idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);
CREATE INDEX idx_purchase_suggestions_supplier_status ON purchase_suggestions(supplier_id, status);
CREATE INDEX idx_purchase_order_items_product ON purchase_order_items(product_id);
CREATE INDEX idx_demand_purchase_allocations_demand ON demand_purchase_allocations(demand_order_id, demand_order_item_id);
CREATE INDEX idx_demand_purchase_allocations_order ON demand_purchase_allocations(purchase_order_id, purchase_order_item_id);
CREATE INDEX idx_purchase_tracking_order ON purchase_tracking_notes(purchase_order_id, updated_at);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at);
CREATE INDEX idx_replenishment_suggestions_location_status ON replenishment_suggestions(location_id, status);
CREATE INDEX idx_replenishment_suggestions_demand ON replenishment_suggestions(demand_order_id);
CREATE INDEX idx_replenishment_change_logs_suggestion ON replenishment_change_logs(replenishment_suggestion_id, changed_at);
CREATE INDEX idx_replenishment_change_logs_demand ON replenishment_change_logs(demand_order_id, changed_at);

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

ALTER TABLE purchase_suggestions DROP CONSTRAINT IF EXISTS purchase_suggestions_status_check;
ALTER TABLE purchase_suggestions ADD CONSTRAINT purchase_suggestions_status_check CHECK (status IN ('PENDING', 'GENERATED', 'DRAFT', 'EXPIRED', 'CANCELLED', 'WAITING_AGGREGATION', 'UNDER_REVIEW', 'DRAFT_PURCHASE_ORDER', 'GROUPED', 'ORDER_CREATED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'NO_GROUP', 'REOPENED'));

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

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_source_type_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_source_type_check CHECK (source_type IN ('DEMAND_SUGGESTION', 'WAREHOUSE_REPLENISHMENT', 'MANUAL_ADDITION', 'MIXED', 'PURCHASE_SUGGESTION', 'MANUAL_WAREHOUSE_STOCK'));

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

CREATE INDEX IF NOT EXISTS idx_purchase_item_sources_item ON purchase_order_item_sources(purchase_order_item_id, source_type);
CREATE INDEX IF NOT EXISTS idx_purchase_item_sources_demand ON purchase_order_item_sources(demand_order_id, demand_order_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_item_store_allocations_location ON purchase_order_item_store_allocations(location_id, status);
CREATE INDEX IF NOT EXISTS idx_procurement_status_logs_demand ON procurement_status_logs(demand_order_id, demand_order_item_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_procurement_status_logs_suggestion ON procurement_status_logs(purchase_suggestion_id, changed_at);
