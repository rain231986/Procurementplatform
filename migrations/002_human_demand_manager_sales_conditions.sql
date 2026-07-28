DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'condition_mode') THEN
    CREATE TYPE condition_mode AS ENUM ('QUANTITY_ONLY', 'AMOUNT_ONLY', 'EITHER', 'BOTH');
  END IF;
END $$;

ALTER TYPE demand_status ADD VALUE IF NOT EXISTS 'PENDING_MANAGER_APPROVAL';
ALTER TYPE demand_status ADD VALUE IF NOT EXISTS 'RETURNED';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_store_manager boolean NOT NULL DEFAULT false;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS minimum_order_amount numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE demand_orders
  ADD COLUMN IF NOT EXISTS manager_approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS manager_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason text;

ALTER TABLE demand_order_items
  ADD COLUMN IF NOT EXISTS reference_purchase_price numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_stock_snapshot integer,
  ADD COLUMN IF NOT EXISTS six_month_sales_total_snapshot integer,
  ADD COLUMN IF NOT EXISTS six_month_average_snapshot numeric(12, 2),
  ADD COLUMN IF NOT EXISTS minimum_qty_snapshot integer,
  ADD COLUMN IF NOT EXISTS minimum_amount_snapshot numeric(12, 2),
  ADD COLUMN IF NOT EXISTS condition_mode_snapshot condition_mode,
  ADD COLUMN IF NOT EXISTS supplier_minimum_qty_snapshot integer,
  ADD COLUMN IF NOT EXISTS supplier_minimum_amount_snapshot numeric(12, 2),
  ADD COLUMN IF NOT EXISTS supplier_purchase_multiple_snapshot integer;

CREATE TABLE IF NOT EXISTS monthly_product_sales (
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

CREATE TABLE IF NOT EXISTS store_order_conditions (
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

CREATE INDEX IF NOT EXISTS idx_monthly_product_sales_lookup
  ON monthly_product_sales(location_id, product_id, sales_year, sales_month);

CREATE INDEX IF NOT EXISTS idx_store_order_conditions_lookup
  ON store_order_conditions(location_id, product_id, is_active);
