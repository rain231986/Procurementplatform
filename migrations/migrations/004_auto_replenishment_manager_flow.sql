-- 自動補貨建議必須經門市確認與店長核單後，才可進入總倉流程。
ALTER TABLE demand_orders
  ADD COLUMN IF NOT EXISTS manager_reason text;

ALTER TABLE demand_order_items
  ADD COLUMN IF NOT EXISTS replenishment_suggestion_id uuid,
  ADD COLUMN IF NOT EXISTS system_suggested_qty integer,
  ADD COLUMN IF NOT EXISTS store_confirmed_qty integer,
  ADD COLUMN IF NOT EXISTS manager_confirmed_qty integer,
  ADD COLUMN IF NOT EXISTS final_requested_qty integer,
  ADD COLUMN IF NOT EXISTS store_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS manager_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS manager_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_hand_qty_snapshot integer,
  ADD COLUMN IF NOT EXISTS reserved_qty_snapshot integer,
  ADD COLUMN IF NOT EXISTS available_qty_snapshot integer,
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS six_month_sales_max_snapshot integer,
  ADD COLUMN IF NOT EXISTS six_month_sales_min_snapshot integer;

ALTER TABLE replenishment_suggestions
  ADD COLUMN IF NOT EXISTS system_suggested_qty integer,
  ADD COLUMN IF NOT EXISTS store_confirmed_qty integer,
  ADD COLUMN IF NOT EXISTS manager_confirmed_qty integer,
  ADD COLUMN IF NOT EXISTS final_requested_qty integer,
  ADD COLUMN IF NOT EXISTS store_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS manager_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS demand_order_id uuid,
  ADD COLUMN IF NOT EXISTS on_hand_qty_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_qty_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_qty_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS six_month_sales_total_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS six_month_sales_average_snapshot numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS six_month_sales_max_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS six_month_sales_min_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz NOT NULL DEFAULT now();

UPDATE replenishment_suggestions
SET status = 'GENERATED'
WHERE status = 'PENDING';

UPDATE replenishment_suggestions
SET system_suggested_qty = COALESCE(system_suggested_qty, original_suggested_qty, suggested_qty, 0),
    store_confirmed_qty = COALESCE(store_confirmed_qty, confirmed_qty),
    calculated_at = COALESCE(calculated_at, created_at);

UPDATE demand_order_items
SET manager_skipped = false
WHERE manager_skipped IS NULL;

ALTER TABLE demand_order_items
  ALTER COLUMN manager_skipped SET DEFAULT false,
  ALTER COLUMN manager_skipped SET NOT NULL;

ALTER TABLE replenishment_suggestions
  ALTER COLUMN system_suggested_qty SET DEFAULT 0,
  ALTER COLUMN system_suggested_qty SET NOT NULL;

ALTER TABLE replenishment_suggestions
  DROP CONSTRAINT IF EXISTS replenishment_suggestions_status_check;

ALTER TABLE replenishment_suggestions
  ADD CONSTRAINT replenishment_suggestions_status_check
  CHECK (status IN ('GENERATED', 'STORE_REVIEWING', 'ACCEPTED', 'ADJUSTED', 'SKIPPED', 'CONVERTED_TO_DEMAND', 'EXPIRED'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_demand_item_replenishment_suggestion'
  ) THEN
    ALTER TABLE demand_order_items
      ADD CONSTRAINT fk_demand_item_replenishment_suggestion
      FOREIGN KEY (replenishment_suggestion_id) REFERENCES replenishment_suggestions(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_replenishment_suggestion_demand'
  ) THEN
    ALTER TABLE replenishment_suggestions
      ADD CONSTRAINT fk_replenishment_suggestion_demand
      FOREIGN KEY (demand_order_id) REFERENCES demand_orders(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_demand_items_replenishment_suggestion
  ON demand_order_items(replenishment_suggestion_id)
  WHERE replenishment_suggestion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_replenishment_suggestions_location_status
  ON replenishment_suggestions(location_id, status);

CREATE INDEX IF NOT EXISTS idx_replenishment_suggestions_demand
  ON replenishment_suggestions(demand_order_id);

CREATE TABLE IF NOT EXISTS replenishment_change_logs (
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

CREATE INDEX IF NOT EXISTS idx_replenishment_change_logs_suggestion
  ON replenishment_change_logs(replenishment_suggestion_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_replenishment_change_logs_demand
  ON replenishment_change_logs(demand_order_id, changed_at);
