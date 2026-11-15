-- 003 staff counters (F-03, BR-09): which counters each STAFF account may operate.

-- Up Migration
CREATE TABLE staff_counters (
  staff_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id INTEGER     NOT NULL REFERENCES service_categories (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id, category_id)
);

-- Down Migration
DROP TABLE staff_counters;
