-- Supplier/product master data ownership, procurement readiness and optimistic locking.
-- PURCHASING owns commercial terms; WAREHOUSE owns logistics and receiving settings.

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS address varchar(240),
  ADD COLUMN IF NOT EXISTS payment_terms varchar(160),
  ADD COLUMN IF NOT EXISTS delivery_note text,
  ADD COLUMN IF NOT EXISTS delivery_time_note varchar(160),
  ADD COLUMN IF NOT EXISTS receiving_note text;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS case_pack_qty integer NOT NULL DEFAULT 0 CHECK (case_pack_qty >= 0),
  ADD COLUMN IF NOT EXISTS store_distribution_unit varchar(32),
  ADD COLUMN IF NOT EXISTS store_distribution_multiple integer NOT NULL DEFAULT 1 CHECK (store_distribution_multiple >= 1),
  ADD COLUMN IF NOT EXISTS warehouse_location_code varchar(64),
  ADD COLUMN IF NOT EXISTS batch_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expiry_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimum_shelf_life_days integer NOT NULL DEFAULT 0 CHECK (minimum_shelf_life_days >= 0),
  ADD COLUMN IF NOT EXISTS storage_note text,
  ADD COLUMN IF NOT EXISTS procurement_status varchar(32) NOT NULL DEFAULT 'PENDING_PURCHASE_SETUP',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1);

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE products
SET store_distribution_unit = COALESCE(NULLIF(store_distribution_unit, ''), base_unit);

-- Keep legacy data valid before adding the one-primary-per-product index.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY product_id ORDER BY is_primary DESC, created_at ASC NULLS LAST, id) AS row_no
  FROM supplier_products
  WHERE is_primary = true AND is_active = true
)
UPDATE supplier_products relation
SET is_primary = false
FROM ranked
WHERE relation.id = ranked.id AND ranked.row_no > 1;

UPDATE products product
SET procurement_status = CASE
  WHEN product.is_active = false THEN 'INACTIVE'
  WHEN EXISTS (
    SELECT 1
    FROM supplier_products relation
    WHERE relation.product_id = product.id
      AND relation.is_primary = true
      AND relation.is_active = true
      AND NULLIF(trim(relation.supplier_product_code), '') IS NOT NULL
      AND NULLIF(trim(relation.purchase_unit), '') IS NOT NULL
      AND relation.purchase_multiple >= 1
      AND relation.minimum_order_quantity >= 1
      AND relation.purchase_price >= 0
  ) THEN 'PURCHASABLE'
  ELSE 'PENDING_PURCHASE_SETUP'
END;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_procurement_status_check;
ALTER TABLE products ADD CONSTRAINT products_procurement_status_check
  CHECK (procurement_status IN ('DRAFT', 'PENDING_PURCHASE_SETUP', 'PURCHASABLE', 'INACTIVE'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_products_one_active_primary
  ON supplier_products (product_id)
  WHERE is_primary = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_products_procurement_status
  ON products (procurement_status, is_active);
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier_active
  ON supplier_products (supplier_id, is_active);
