CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('ADMIN', 'STORE', 'WAREHOUSE', 'PURCHASING');
CREATE TYPE location_type AS ENUM ('STORE', 'WAREHOUSE');
CREATE TYPE demand_source AS ENUM ('MANUAL', 'AUTO');
CREATE TYPE demand_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSING', 'PARTIALLY_ALLOCATED', 'WAITING_PURCHASE', 'COMPLETED', 'CANCELLED');
CREATE TYPE allocation_status AS ENUM ('DRAFT', 'PICKING', 'SHIPPED', 'RECEIVED', 'CANCELLED');
CREATE TYPE purchase_status AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

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
  display_name varchar(120) NOT NULL,
  role user_role NOT NULL,
  location_id uuid REFERENCES locations(id),
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
  submitted_at timestamptz
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
  notes text
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
  confirmed_qty integer,
  adjustment_reason text,
  adjusted_by uuid REFERENCES users(id),
  adjusted_at timestamptz,
  status varchar(24) NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  status varchar(24) NOT NULL DEFAULT 'PENDING',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_number varchar(40) NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  order_date date NOT NULL,
  expected_delivery_date date,
  status purchase_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  ordered_qty integer NOT NULL CHECK (ordered_qty > 0),
  purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  remaining_qty integer GENERATED ALWAYS AS (ordered_qty - received_qty) STORED
);

CREATE TABLE demand_purchase_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_order_id uuid NOT NULL REFERENCES demand_orders(id) ON DELETE CASCADE,
  demand_order_item_id uuid NOT NULL REFERENCES demand_order_items(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  allocated_qty integer NOT NULL CHECK (allocated_qty > 0),
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
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_location ON users(location_id);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_inventory_location_product ON inventory_balances(location_id, product_id);
CREATE INDEX idx_demands_location_status ON demand_orders(location_id, status);
CREATE INDEX idx_demands_created_at ON demand_orders(created_at);
CREATE INDEX idx_demand_items_product ON demand_order_items(product_id);
CREATE INDEX idx_allocations_status ON allocation_orders(status);
CREATE INDEX idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at);
