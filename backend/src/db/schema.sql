-- РабочиеЛисты AI — D1 schema.
-- Запуск: npm run db:migrate:local   или   npm run db:migrate:prod
--
-- Соглашения:
--   * Все ID — TEXT (наши shortId из nanoid с префиксами: ws_, exam_, usr_).
--   * Все временные метки — INTEGER (unix seconds), монотонные для удобства сравнения.
--   * FK c ON DELETE CASCADE/SET NULL — для очистки пользователя и его данных.
--   * Индексы — только там, где они реально нужны (никаких "на всякий случай").

-- ─────────────────────────────────────────────────────────────────────────────
-- Users & auth
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT,
  plan                TEXT NOT NULL DEFAULT 'free',
  generations_total   INTEGER NOT NULL DEFAULT 0,
  generations_today   INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  stripe_customer_id  TEXT,
  yookassa_customer_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_plan  ON users(plan);

CREATE TABLE IF NOT EXISTS magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Worksheets / favorites / templates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worksheets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  grade        INTEGER NOT NULL,
  topic        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,
  type         TEXT NOT NULL,
  count        INTEGER NOT NULL,
  title        TEXT,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worksheets_user_created ON worksheets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worksheets_subject_grade ON worksheets(subject, grade);

CREATE TABLE IF NOT EXISTS favorites (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worksheet_id TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, worksheet_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);

CREATE TABLE IF NOT EXISTS templates (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  grade        INTEGER NOT NULL,
  topic        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,
  count        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Billing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                TEXT NOT NULL,
  status              TEXT NOT NULL,
  period              TEXT NOT NULL,
  yookassa_payment_id TEXT,
  starts_at           INTEGER NOT NULL,
  ends_at             INTEGER NOT NULL,
  auto_renew          INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_yookassa ON subscriptions(yookassa_payment_id);

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan                TEXT NOT NULL,
  amount_rub          INTEGER NOT NULL,
  yookassa_payment_id TEXT UNIQUE,
  status              TEXT NOT NULL,
  confirmation_url    TEXT,
  created_at          INTEGER NOT NULL,
  completed_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- LLM observability & cache
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS llm_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  task        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  plan        TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL,
  tokens_out  INTEGER NOT NULL,
  cost_usd    REAL NOT NULL,
  latency_ms  INTEGER NOT NULL,
  cached      INTEGER NOT NULL DEFAULT 0,
  fallback    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_logs_user_created ON llm_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_logs_task_created ON llm_logs(task, created_at);

CREATE TABLE IF NOT EXISTS semantic_cache (
  id            TEXT PRIMARY KEY,
  cache_key     TEXT NOT NULL UNIQUE,
  subject       TEXT NOT NULL,
  grade         INTEGER NOT NULL,
  topic         TEXT NOT NULL,
  difficulty    TEXT NOT NULL,
  count         INTEGER NOT NULL,
  type          TEXT NOT NULL,
  response_json TEXT NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_lookup ON semantic_cache(subject, grade, topic);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires ON semantic_cache(expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Analytics & rate-limiting
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin: model routing + audit log (для /api/admin/*)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS model_routing (
  task             TEXT NOT NULL,             -- worksheet-gen | exam-gen | validate | embed | image-gen
  plan             TEXT NOT NULL,             -- free | base | plus | '*' (для задач без плана, embed/validate)
  primary_model    TEXT NOT NULL,             -- model id из MODEL_CATALOG (env-side)
  primary_provider TEXT NOT NULL,             -- 'polza' | 'openai' | 'anthropic' | ...
  fallback_json    TEXT NOT NULL DEFAULT '[]',-- JSON-массив {provider, model} для callWithFallback
  enabled          INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT,                      -- user_id админа, кто поменял
  PRIMARY KEY (task, plan)
);

CREATE INDEX IF NOT EXISTS idx_model_routing_enabled ON model_routing(enabled);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,                           -- user_id админа (может быть NULL если не залогинен)
  action      TEXT NOT NULL,                  -- 'routing.update' | 'user.toggle_admin' | ...
  target_type TEXT,                           -- 'model_routing' | 'user' | ...
  target_id   TEXT,                           -- PK или описание
  payload_json TEXT,                          -- детали изменения
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created ON admin_audit_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_created ON admin_audit_log(action, created_at);
