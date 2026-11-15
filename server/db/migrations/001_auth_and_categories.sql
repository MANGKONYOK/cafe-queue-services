-- 001 auth and categories (F-01): users, PostgreSQL sessions, service counters.

-- Up Migration
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(120) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(120) NOT NULL,
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('CUSTOMER', 'STAFF', 'ADMIN')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Schema expected by connect-pg-simple (express-session store).
CREATE TABLE user_sessions (
  sid    VARCHAR      NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_user_sessions_expire ON user_sessions (expire);

CREATE TABLE service_categories (
  id                  SERIAL PRIMARY KEY,
  code                VARCHAR(30)  NOT NULL UNIQUE,
  name                VARCHAR(120) NOT NULL,
  prefix              VARCHAR(5)   NOT NULL UNIQUE,
  description         TEXT,
  est_mins_per_ticket INTEGER      NOT NULL DEFAULT 10 CHECK (est_mins_per_ticket > 0),
  is_open             BOOLEAN      NOT NULL DEFAULT true,
  next_seq            INTEGER      NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Down Migration
DROP TABLE service_categories;
DROP TABLE user_sessions;
DROP TABLE users;
