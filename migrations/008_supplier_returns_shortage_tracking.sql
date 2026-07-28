-- Supplier master extensions, per-item purchase follow-up/shortage tracking,
-- private attachment metadata and supplier return inventory workflow.
-- This migration stores no public attachment URL and does not create payment
-- execution or accounting-voucher tables.

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS payment_method varchar(32) NOT NULL DEFAULT 'BANK_TRANSFER',
  ADD COLUMN IF NOT EXISTS payment_method_note text,
  ADD COLUMN IF NOT EXISTS settlement_days integer NOT NULL DEFAULT 0 CHECK (settlement_days >= 0),
  ADD COLUMN IF NOT EXISTS billing_cycle varchar(32),
  ADD COLUMN IF NOT EXISTS invoice_requirement varchar(32),
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'TWD',
  ADD COLUMN IF NOT EXISTS supplier_public_note text;

ALTER TABLE inventory_balances
  ADD COLUMN IF NOT EXISTS return_reserved_qty integer NOT NULL DEFAULT 0 CHECK (return_reserved_qty >= 0);

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS ordering_supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS payee_supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS ordering_supplier_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS payee_supplier_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS payment_method varchar(32),
  ADD COLUMN IF NOT EXISTS payment_method_note text,
  ADD COLUMN IF NOT EXISTS order_frequency varchar(32),
  ADD COLUMN IF NOT EXISTS supplier_schedule_snapshot jsonb;

UPDATE purchase_orders SET ordering_supplier_id = supplier_id WHERE ordering_supplier_id IS NULL;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS follow_up_status varchar(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS follow_up_note text,
  ADD COLUMN IF NOT EXISTS supplier_response_note text,
  ADD COLUMN IF NOT EXISTS shortage_status varchar(40) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS shortage_qty integer NOT NULL DEFAULT 0 CHECK (shortage_qty >= 0),
  ADD COLUMN IF NOT EXISTS shortage_reason varchar(48),
  ADD COLUMN IF NOT EXISTS shortage_note text,
  ADD COLUMN IF NOT EXISTS shortage_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shortage_confirmed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_followed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_followed_up_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS revised_expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS store_visible_note text,
  ADD COLUMN IF NOT EXISTS store_visible_shortage_note text,
  ADD COLUMN IF NOT EXISTS internal_note text,
  ADD COLUMN IF NOT EXISTS alternative_supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS alternative_product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS shortage_requeue_status varchar(24),
  ADD COLUMN IF NOT EXISTS shortage_resolution_reason text,
  ADD COLUMN IF NOT EXISTS supplier_next_available_date date,
  ADD COLUMN IF NOT EXISTS shortage_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS shortage_resolved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS shortage_requeued_qty integer NOT NULL DEFAULT 0 CHECK (shortage_requeued_qty >= 0);

ALTER TABLE demand_purchase_allocations
  ADD COLUMN IF NOT EXISTS requeued_qty integer NOT NULL DEFAULT 0 CHECK (requeued_qty >= 0);

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_shortage_qty_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_shortage_qty_check
  CHECK (shortage_qty <= GREATEST(0, ordered_qty - received_qty - cancelled_qty));

CREATE TABLE IF NOT EXISTS supplier_business_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordering_supplier_id uuid NOT NULL REFERENCES suppliers(id),
  payee_supplier_id uuid REFERENCES suppliers(id),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_business_default
  ON supplier_business_relations(ordering_supplier_id)
  WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS supplier_order_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  frequency_type varchar(24) NOT NULL CHECK (frequency_type IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'INTERVAL_DAYS', 'ON_DEMAND', 'MANUAL')),
  interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  weekdays integer[] NOT NULL DEFAULT '{}',
  day_of_month integer CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  cutoff_time time,
  expected_delivery_days integer NOT NULL DEFAULT 0 CHECK (expected_delivery_days >= 0),
  next_order_date date,
  next_expected_delivery_date date,
  store_visible_note text,
  internal_note text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_schedule_primary
  ON supplier_order_schedules(supplier_id)
  WHERE is_primary = true AND is_active = true;

CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  payee_supplier_id uuid REFERENCES suppliers(id),
  bank_name varchar(120) NOT NULL,
  bank_code varchar(20),
  branch_name varchar(120),
  branch_code varchar(20),
  account_name varchar(160) NOT NULL,
  account_number varchar(80) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  verified_note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supplier_bank_accounts
  ADD COLUMN IF NOT EXISTS payee_supplier_id uuid REFERENCES suppliers(id);

DROP INDEX IF EXISTS ux_supplier_bank_primary;
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_bank_primary
  ON supplier_bank_accounts((COALESCE(payee_supplier_id, supplier_id)))
  WHERE is_primary = true AND is_active = true;

CREATE TABLE IF NOT EXISTS supplier_bank_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_bank_account_id uuid NOT NULL REFERENCES supplier_bank_accounts(id) ON DELETE CASCADE,
  attachment_type varchar(40) NOT NULL CHECK (attachment_type IN ('BANKBOOK_COVER', 'BANK_ACCOUNT_PROOF', 'SUPPLIER_NOTICE', 'OTHER')),
  file_name varchar(240) NOT NULL,
  file_type varchar(120) NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  storage_key varchar(500) NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS product_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  identifier_type varchar(40) NOT NULL CHECK (identifier_type IN ('GTIN14', 'EAN13', 'UPCA', 'JAN', 'MANUFACTURER_ITEM_CODE', 'OTHER')),
  value varchar(120) NOT NULL,
  country varchar(8),
  issuer varchar(80),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identifier_type, value)
);

CREATE TABLE IF NOT EXISTS purchase_order_item_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  follow_up_status varchar(32) NOT NULL,
  contact_date date,
  supplier_response text,
  shortage_reason varchar(48),
  revised_expected_delivery_date date,
  next_follow_up_at timestamptz,
  store_visible_note text,
  follow_up_note text,
  supplier_next_available_date date,
  internal_note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_order_item_followups
  ADD COLUMN IF NOT EXISTS follow_up_note text,
  ADD COLUMN IF NOT EXISTS supplier_next_available_date date;

CREATE TABLE IF NOT EXISTS purchase_shortage_requeues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  source_purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id),
  product_id uuid NOT NULL REFERENCES products(id),
  supplier_id uuid REFERENCES suppliers(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  alternative_supplier_id uuid REFERENCES suppliers(id),
  alternative_product_id uuid REFERENCES products(id),
  action varchar(24) NOT NULL CHECK (action IN ('REQUEUE', 'NO_GROUP', 'ALTERNATIVE')),
  status varchar(32) NOT NULL DEFAULT 'WAITING_AGGREGATION',
  source_location_ids uuid[] NOT NULL DEFAULT '{}',
  source_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_shortage_requeues
  ADD COLUMN IF NOT EXISTS alternative_supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS alternative_product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS source_changes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE purchase_shortage_requeues
  DROP CONSTRAINT IF EXISTS purchase_shortage_requeues_action_check;
ALTER TABLE purchase_shortage_requeues
  ADD CONSTRAINT purchase_shortage_requeues_action_check CHECK (action IN ('REQUEUE', 'NO_GROUP', 'ALTERNATIVE'));

CREATE TABLE IF NOT EXISTS supplier_return_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number varchar(40) NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  ordering_supplier_id uuid NOT NULL REFERENCES suppliers(id),
  payee_supplier_id uuid REFERENCES suppliers(id),
  source_type varchar(32) NOT NULL,
  source_purchase_order_id uuid REFERENCES purchase_orders(id),
  source_receipt_id uuid,
  status varchar(40) NOT NULL DEFAULT 'DRAFT',
  return_reason text,
  supplier_response text,
  warehouse_note text,
  purchasing_note text,
  resolution_type varchar(32),
  total_qty integer NOT NULL DEFAULT 0 CHECK (total_qty >= 0),
  estimated_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
  confirmed_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (confirmed_amount >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE supplier_return_orders
  ADD COLUMN IF NOT EXISTS return_date date,
  ADD COLUMN IF NOT EXISTS expected_resolution_date date,
  ADD COLUMN IF NOT EXISTS actual_resolution_date date,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

CREATE TABLE IF NOT EXISTS supplier_return_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id uuid NOT NULL REFERENCES supplier_return_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  purchase_order_item_id uuid REFERENCES purchase_order_items(id),
  receipt_item_id uuid,
  warehouse_location_id uuid NOT NULL REFERENCES locations(id),
  available_qty_at_creation integer NOT NULL CHECK (available_qty_at_creation >= 0),
  return_qty integer NOT NULL CHECK (return_qty > 0),
  batch_number varchar(80),
  expiry_date date,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  estimated_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
  confirmed_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (confirmed_amount >= 0),
  reason_code varchar(40) NOT NULL,
  item_condition varchar(80),
  supplier_response text,
  replacement_qty integer NOT NULL DEFAULT 0 CHECK (replacement_qty >= 0),
  replacement_received_qty integer NOT NULL DEFAULT 0 CHECK (replacement_received_qty >= 0),
  refunded_qty integer NOT NULL DEFAULT 0 CHECK (refunded_qty >= 0),
  credited_qty integer NOT NULL DEFAULT 0 CHECK (credited_qty >= 0),
  rejected_qty integer NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  unresolved_qty integer NOT NULL DEFAULT 0 CHECK (unresolved_qty >= 0),
  reserved_qty integer NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  returned_qty integer NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_return_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id uuid NOT NULL REFERENCES supplier_return_orders(id) ON DELETE CASCADE,
  return_order_item_id uuid REFERENCES supplier_return_order_items(id) ON DELETE CASCADE,
  attachment_type varchar(40) NOT NULL,
  file_name varchar(240) NOT NULL,
  file_type varchar(120) NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  storage_key varchar(500) NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_purchase_item_followups_item ON purchase_order_item_followups(purchase_order_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_item_shortage_status ON purchase_order_items(shortage_status, revised_expected_delivery_date);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_status ON supplier_return_orders(supplier_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_return_items_product ON supplier_return_order_items(product_id, warehouse_location_id);
CREATE INDEX IF NOT EXISTS idx_product_identifiers_product ON product_identifiers(product_id, identifier_type);
