-- 002 queue tickets (F-02): walk-in tickets and their append-only event log.

-- Up Migration
CREATE TABLE queue_tickets (
  id                 SERIAL PRIMARY KEY,
  ticket_code        VARCHAR(20)  NOT NULL UNIQUE,
  category_id        INTEGER      NOT NULL REFERENCES service_categories (id),
  customer_id        INTEGER      NOT NULL REFERENCES users (id),
  assigned_staff_id  INTEGER      REFERENCES users (id),
  seq_no             INTEGER      NOT NULL CHECK (seq_no >= 1),
  party_size         INTEGER      NOT NULL CHECK (party_size BETWEEN 1 AND 8),
  special_requests   VARCHAR(280),
  status             VARCHAR(12)  NOT NULL DEFAULT 'WAITING'
                     CHECK (status IN ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
  counter_name       VARCHAR(50),
  completion_summary VARCHAR(500),
  cancel_reason      VARCHAR(200),
  no_show_note       VARCHAR(200),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at          TIMESTAMPTZ,
  serving_started_at TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  no_show_at         TIMESTAMPTZ,
  UNIQUE (category_id, seq_no)
);

-- BR-01 backstop: at most one active ticket per customer per category, even under concurrency.
CREATE UNIQUE INDEX one_active_ticket ON queue_tickets (customer_id, category_id)
  WHERE status IN ('WAITING', 'CALLED', 'SERVING');
-- FIFO lookups for call-next and aheadCount.
CREATE INDEX idx_queue_tickets_queue ON queue_tickets (category_id, status, seq_no);

CREATE TABLE ticket_events (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER     NOT NULL REFERENCES queue_tickets (id) ON DELETE CASCADE,
  actor_id    INTEGER     NOT NULL REFERENCES users (id),
  from_status VARCHAR(12),
  to_status   VARCHAR(12) NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ticket_events_ticket ON ticket_events (ticket_id, id);

-- Down Migration
DROP TABLE ticket_events;
DROP TABLE queue_tickets;
