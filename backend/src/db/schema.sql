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

-- Роль — отдельная таблица, а НЕ колонка в users, ровно по той же причине,
-- что и usage_counters ниже: миграция = повторный прогон schema.sql, а
-- ALTER TABLE ADD COLUMN в SQLite не идемпотентен (ТЗ §4.1, решение В-5).
--
-- Зачем роль вводится ДО тарифа «Школа» (запуск Q1 2027): требование
-- «ученикам генерацию не даём» должно быть в схеме и в middleware, а не
-- в голове. Пустая роль = teacher, поэтому пользователи без строки здесь
-- работают ровно как раньше.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',        -- 'teacher' | 'student'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

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
  -- Период оплаты: 'monthly' | 'yearly'. Сохраняется здесь, потому что период —
  -- часть КАНОНИЧЕСКОЙ записи о платеже: подписку активировать можно только по
  -- данным из этой строки, а не по полям из тела вебхука (см. services/billing.ts).
  period              TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly','academicYear')),
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
-- Антифрод: отпечаток посетителя и накопленные по нему сигналы
-- ─────────────────────────────────────────────────────────────────────────────

-- Политика: подозрение НЕ равно блокировке. По отпечатку с признаками мультиаккаунта
-- или прокси показывается невидимый Cloudflare Turnstile — нормальный учитель его
-- не видит, а сценарий «создал 10 аккаунтов в разных браузерах» перестаёт окупаться.
-- Таблица хранит ТОЛЬКО хэш отпечатка: IP, ASN и User-Agent в сыром виде сюда
-- не попадают (это персональные данные, см. также подход из TZ-12 к forms).
CREATE TABLE IF NOT EXISTS fraud_signals (
  fingerprint_hash TEXT PRIMARY KEY,
  first_seen       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL,
  -- JSON-массив id аккаунтов, заходивших с этого отпечатка (2+ = мультиаккаунт).
  user_ids         TEXT NOT NULL DEFAULT '[]',
  -- JSON-массив ASN, замеченных с этого IP (3+ = подозрение на прокси/смену оператора).
  asns             TEXT NOT NULL DEFAULT '[]',
  generations_total INTEGER NOT NULL DEFAULT 0,
  challenges_issued INTEGER NOT NULL DEFAULT 0,
  challenge_passes  INTEGER NOT NULL DEFAULT 0,
  -- Время последнего успешного прохождения капчи. После него same-отпечаток
  -- признаётся доверенным на TRUST_WINDOW_SECONDS.
  last_passed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_fraud_signals_last_seen ON fraud_signals(last_seen);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Online forms (TZ-12): выдача листа ученикам по ссылке/QR + сбор ответов
-- ─────────────────────────────────────────────────────────────────────────────

-- Форма = выданный лист. token — публичная часть ссылки, её можно перевыпустить
-- (rotate), не теряя уже собранные ответы. id остаётся внутренним ключом.
CREATE TABLE IF NOT EXISTS forms (
  id             TEXT PRIMARY KEY,                  -- frm_<12>
  token          TEXT NOT NULL UNIQUE,              -- публичный токен 32 симв. (nanoToken)
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worksheet_id   TEXT,                              -- ws_<12> — исходный лист (может отсутствовать
                                                   -- для артефактов не из конструктора)
  title          TEXT NOT NULL,
  subject        TEXT NOT NULL,
  grade          INTEGER NOT NULL,
  -- Снимок заданий на момент выдачи: [{number, text, type, options, points, answer}]
  -- answer хранится ТОЛЬКО здесь и никогда не уходит в публичный API.
  payload_json   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',      -- open | closed
  -- Необязательный код, который учитель пишет на доске («5А», «Б-2»).
  access_code    TEXT,
  expires_at     INTEGER NOT NULL,                  -- unix seconds
  closed_at      INTEGER,
  -- Показывать ли ученику правильные ответы сразу после отправки.
  -- По умолчанию НЕТ: для контрольной это раскрывает ответы всей параллели.
  show_answers   INTEGER NOT NULL DEFAULT 0,
  -- Кто и как проверяет: auto — детерминированно, llm — с подсказкой ИИ,
  -- manual — только учитель. Определяется по составу заданий при создании.
  check_mode     TEXT NOT NULL DEFAULT 'auto',
  -- TZ-12 §5.4: ответы учеников (ПДн ребёнка) хранятся 90 дней и удаляются
  -- крон-заданием purgeExpiredForms. САМА форма при этом остаётся в кабинете
  -- со статусом «ответы удалены», а не исчезает — учитель не должен терять
  -- список своих выданных листов из-за retention-политики.
  responses_purged INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forms_user_created ON forms(user_id, created_at);
-- token помечен UNIQUE — SQLite строит по нему индекс сам, отдельный idx не нужен.

-- Одна отправка = один ответ одного ученика. Повторная отправка с того же
-- IP в пределах часа блокируется rate-limit'ом (bucket form-submit, ключ form+ip).
CREATE TABLE IF NOT EXISTS form_responses (
  id              TEXT PRIMARY KEY,                 -- rsp_<12>
  form_id         TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  student_name    TEXT NOT NULL,                    -- как представился (до 100 символов)
  student_label   TEXT,                             -- код класса, если учитель его задал
  score_total     INTEGER NOT NULL DEFAULT 0,
  score_max       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'submitted',-- submitted
  duration_sec    INTEGER,                          -- submitted_at - started_at, для античита
  ip_hash         TEXT,                             -- djb2(ip) для rate-limit и антифрода.
                                                   -- НЕ сырой IP: сырой IP = ПДн, см. §5.2
  user_agent      TEXT,
  started_at      INTEGER,                          -- когда ученик открыл форму
  submitted_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_responses_form_submitted ON form_responses(form_id, submitted_at);

-- Ответ на одно задание. is_correct = NULL означает «автосверка не смогла решить,
-- ждёт учителя» — это осознанный выбор, а не баг (см. Решение 1).
CREATE TABLE IF NOT EXISTS form_answers (
  id              TEXT PRIMARY KEY,                 -- ans_<12>
  response_id     TEXT NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
  task_number     INTEGER NOT NULL,
  task_type       TEXT NOT NULL,                    -- computation | multiple-choice | ...
  student_answer  TEXT,                             -- как ввёл ученик (сырой текст / индекс)
  is_correct      INTEGER,                          -- 1 | 0 | NULL (не определено)
  points_awarded  INTEGER NOT NULL DEFAULT 0,
  points_max      INTEGER NOT NULL DEFAULT 0,
  needs_review    INTEGER NOT NULL DEFAULT 0,      -- 1 = учитель должен посмотреть
  check_method    TEXT NOT NULL,                    -- auto | llm | manual
  check_meta_json TEXT,                             -- {"reason": "...", "model": "..."} для LLM
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_answers_response ON form_answers(response_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Photo-check (F-06 / TZ-11): проверка работ по фото
--
-- Сам снимок лежит в R2 (binding PDFS), здесь только ключ `r2_key`.
-- Фото — персональные данные ребёнка: `delete_at` — расчётный срок удаления
-- (создание + 7 дней, см. services/photoCheckGrading.ts photoDeleteAt).
-- Retention чистится скриптом backend/scripts/purgeExpiredPhotos.ts.
--
-- ЮРИДИЧЕСКИЙ СТАТУС: техническая часть ПДн-контура закрыта (срок хранения,
-- ручное удаление, текст согласия в UI). Правовое основание обработки и
-- вопрос уведомления РКН (ТЗ §5.2 В-2.1 / В-2.6) — открытые вопросы
-- к юристу, в коде НЕ считаются закрытыми.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS photo_checks (
  id             TEXT PRIMARY KEY,              -- pc_<12>
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  worksheet_id   TEXT,                          -- ws_*; NULL если лист был локальным
  subject        TEXT,
  grade          INTEGER,
  r2_key         TEXT,                          -- ключ исходника в PDFS; NULL после удаления
  mime_type      TEXT,                          -- что реально загрузили (image/jpeg и т.п.)
  byte_size      INTEGER,                       -- размер исходника в байтах
  source_kind    TEXT NOT NULL DEFAULT 'single',-- 'single' | 'stack' (M2)
  pages          INTEGER NOT NULL DEFAULT 1,
  -- Исходный снимок ПДн. version = 1 у клиента загрузки, 2 у учителя.
  consent_version INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending',-- 'pending' | 'ok' | 'partial' | 'failed'
  total_points   INTEGER NOT NULL DEFAULT 0,
  earned_points  INTEGER NOT NULL DEFAULT 0,
  percentage     INTEGER,                       -- 0..100, NULL если не посчитан
  grade_mark     TEXT,                          -- '5' | '4' | '3' | '2' | NULL
  needs_review   INTEGER NOT NULL DEFAULT 0,    -- 1 = есть задания для перепроверки
  model          TEXT,                          -- vision-модель из MODEL_CATALOG
  provider       TEXT,
  cost_usd       REAL NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  error_code     TEXT,                          -- 'LOW_CONFIDENCE' | 'LLM_UNAVAILABLE' | 'BAD_IMAGE' | NULL
  deleted_at     INTEGER,                       -- soft-delete: фото удалено из R2, метаданные живы
  delete_at      INTEGER,                       -- расчётный срок автоудаления (created_at + 7 дней)
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_photo_checks_user_created ON photo_checks(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_photo_checks_worksheet    ON photo_checks(worksheet_id);
-- Индекс для retention-скрипта: ищем непогашенные фото с истёкшим сроком.
CREATE INDEX IF NOT EXISTS idx_photo_checks_retention    ON photo_checks(delete_at) WHERE delete_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS photo_check_items (
  id             TEXT PRIMARY KEY,              -- pci_<12>
  check_id       TEXT NOT NULL REFERENCES photo_checks(id) ON DELETE CASCADE,
  task_number    INTEGER NOT NULL,
  task_text      TEXT,
  expected       TEXT,                          -- эталон из тела запроса
  student_answer TEXT,                          -- что распознал ИИ
  -- correct | incorrect | unclear. ВАЖНО: unclear — отдельное состояние,
  -- это НЕ «неправильно» (см. services/photoCheckGrading.ts).
  verdict        TEXT NOT NULL DEFAULT 'unclear',
  points_awarded INTEGER NOT NULL DEFAULT 0,
  max_points     INTEGER NOT NULL DEFAULT 1,
  confidence     REAL,                          -- 0..1; < 0.6 → needs_review = 1
  needs_review   INTEGER NOT NULL DEFAULT 0,
  comment        TEXT,                          -- короткое объяснение ИИ, 1 строка
  created_at     INTEGER NOT NULL,
  UNIQUE(check_id, task_number)
);

CREATE INDEX IF NOT EXISTS idx_photo_check_items_check ON photo_check_items(check_id);

-- Счётчик месячной квоты — отдельная таблица, а НЕ колонка в users:
-- миграция у нас = повторный прогон всего schema.sql, а ALTER TABLE ADD COLUMN
-- в SQLite не идемпотентен (ТЗ §4.1, решение В-5).
CREATE TABLE IF NOT EXISTS usage_counters (
  id           TEXT PRIMARY KEY,                -- uc_<12>
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL,                   -- 'photo_check'
  window_start INTEGER NOT NULL,                -- начало окна (unix seconds, начало месяца)
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  UNIQUE(user_id, metric, window_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_lookup ON usage_counters(user_id, metric, window_start);

-- ─────────────────────────────────────────────────────────────────────────────
-- Student interactives (TZ-13)
-- Формат интерактива живёт внутри worksheets.payload_json (блок interactive),
-- здесь — только выдача ученику и сбор попыток.

-- Выданный интерактив: одна строка на «учитель выдал классу»
CREATE TABLE IF NOT EXISTS interactives (
  id            TEXT PRIMARY KEY,          -- int_<12>
  worksheet_id  TEXT REFERENCES worksheets(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  format        TEXT NOT NULL,             -- quiz-race | sort-baskets | jump-truth |
                                            -- fortune-wheel | jeopardy | sort-sequence
  title         TEXT NOT NULL,
  share_token   TEXT NOT NULL UNIQUE,     -- nanoToken() 32 симв., для /play/?t=<token>
  config_json   TEXT NOT NULL,             -- InteractiveConfig целиком (items + options)
  config_schema INTEGER NOT NULL DEFAULT 1,-- версия схемы config_json; движок умеет 1..N
  status        TEXT NOT NULL DEFAULT 'active', -- active | archived
  -- Срок жизни ссылки. NULL = бессрочно. Фронт ждёт `expiresAt` и по нему
  -- отдаёт ученику «ссылка истекла» (410 INTERACTIVE_EXPIRED) — без этой
  -- колонки ветка 410 не срабатывает никогда. Учитель может задать срок при
  -- выдаче; по умолчанию — NULL, то есть пока учитель сам не закроет.
  expires_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactives_user_created ON interactives(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interactives_worksheet    ON interactives(worksheet_id);

-- Попытка ученика: одна строка на ученика на один интерактив
CREATE TABLE IF NOT EXISTS interactive_attempts (
  id            TEXT PRIMARY KEY,          -- att_<12>
  interactive_id TEXT NOT NULL REFERENCES interactives(id) ON DELETE CASCADE,
  attempt_token TEXT NOT NULL UNIQUE,     -- для восстановления сессии по ссылке ученика
  student_name  TEXT,                      -- ввод учеником; НЕ ФИО, НЕ почта
  student_class TEXT,                      -- свободная строка, ввод учителем или учеником
  score         INTEGER NOT NULL DEFAULT 0,
  max_score     INTEGER NOT NULL DEFAULT 0,
  percent       INTEGER NOT NULL DEFAULT 0,
  stars         INTEGER NOT NULL DEFAULT 0,
  duration_s    INTEGER,
  answers_json  TEXT,                      -- [{itemId, chosen, correct, ms}] — для разбора
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_interactive_created ON interactive_attempts(interactive_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_interactive_score    ON interactive_attempts(interactive_id, percent);
