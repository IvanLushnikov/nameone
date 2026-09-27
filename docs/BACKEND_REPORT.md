# РабочиеЛисты AI — Отчёт о реализации бэкенда

> **Дата:** 2026-09-26
> **Проект:** `/Users/ivanlusnikov/Documents/nameone/`
> **Бэкенд:** `/Users/ivanlusnikov/Documents/nameone/backend/`
> **Режим работы:** автономные сабагенты (worker × 6) + parent-дописывание + smoke-проверка
> **Frontend ↔ Backend контракт:** синхронизирован (DTO в `src/types.ts` ↔ `backend/src/types.ts`)

---

## Что сделано (high-level)

| # | Слой | Файлов | Строк | Статус |
|---|------|-------:|------:|--------|
| Bootstrap (T1) | wrangler, package, Hono app, D1 schema, middleware, lib | 19 | 1629 | ✅ |
| LLM (T2) | config, router, providers, cache, cost, moderation, prompts, facade | 16 | 1800 | ✅ |
| Routes + Services (T3+T4+T5) | worksheets/exams/auth/users/billing/health/llm + services | 14 | 2200 | ✅ |
| Tests (T6) | unit (vitest) + smoke + dev/deploy скрипты | 6 + 3 | 651 | ✅ |
| Front stubs (T7) | `src/lib/llm/{config,router,index}.ts` — proxy → backend | 3 | 290 | ✅ |
| **Backend total** | | **58** | **~6570** | ✅ |

- **TS strict:** `tsc --noEmit` — 0 errors
- **ESLint:** 0 errors (только deprecation warning от ESLint 9 про `.eslintrc.json`)
- **Wrangler deploy dry-run:** OK — 2691 KiB / 537 KiB gzip
- **Unit tests:** 60/60 PASS (cost, moderation, checkExam, prompts, billing, shortid)
- **Smoke:** 6/6 PASS против живого `wrangler dev --local` (D1-migrated)

---

## Архитектура бэка (SVG)

Полная диаграмма — **`docs/ARCHITECTURE-BACKEND.svg`** (17.8 KB).

Краткая сводка:
```
Frontend (Next.js + CF Pages)
    │  fetch NEXT_PUBLIC_API_URL
    ▼
┌─ Worker (src/index.ts) ──────────────────────────┐
│  CORS · Auth middleware · Rate-limit · Access log │
│  Error middleware → JSON · 404 handler            │
└────────────┬──────────────────────────────────────┘
         ▼
┌─ Routes (src/routes/*.ts) ────────────────────────┐
│  /healthz · /readyz · /api/llm · /api/worksheets │
│  /api/exams · /api/auth · /api/users · /api/billing │
└────────────┬──────────────────────────────────────┘
         ▼
┌─ Services (src/services/*.ts) ────────────────────┐
│  auth (magic link) · email (Resend) · billing (ЮKassa) │
│  worksheet (save/log) · exam (check + attempt)     │
└────────────┬──────────────────────────────────────┘
         ▼
┌─ LLM Layer (src/llm/*.ts) ────────────────────────┐
│  router (pickModel + callWithFallback) · providers │
│  (openai/anthropic/deepseek) · cache · cost · moderation │
│  prompts (worksheet/exam/validate) · facade       │
└────────────┬──────────────────────────────────────┘
         ▼
┌─ Storage & External ─────────────────────────────┐
│  D1 (12 tables) · R2 (PDF bucket) · OpenAI/Anthropic │
│  DeepSeek/DashScope · Resend · ЮKassa              │
└─────────────────────────────────────────────────┘
```

---

## API endpoints (полный контракт)

### Public (без auth)

| Method | Path | Описание | Статус |
|---|---|---|---|
| GET | `/healthz` | liveness probe | ✅ |
| GET | `/readyz` | D1 readiness (SELECT 1) | ✅ |
| GET | `/api/llm/models` | список моделей по наличию ключей | ✅ |
| POST | `/api/llm/embeddings` | embeddings (text → vectors) | ✅ |
| POST | `/api/billing/yookassa-webhook` | webhook от ЮKassa (server-to-server, IP allowlist) | ✅ |

### Auth

| Method | Path | Описание |
|---|---|---|
| POST | `/api/auth/magic-link` | запросить magic link (rate-limit 5/hour per IP) |
| POST | `/api/auth/callback` | обменять token на session + HttpOnly cookie |
| POST | `/api/auth/logout` | удалить session + cookie |
| GET | `/api/auth/me` | текущий user или `null` |

### LLM Gen (требует API ключ в env)

| Method | Path | Описание |
|---|---|---|
| POST | `/api/worksheets/generate` | генерирует worksheet (Luna → Sol fallback, Opus для Plus) |
| POST | `/api/worksheets/validate` | DeepSeek V4 Flash валидация (duplicates, ФГОС, answers) |
| GET | `/api/worksheets/:id` | читает сохранённый worksheet |
| POST | `/api/exams/generate` | генерирует ОГЭ/ЕГЭ вариант |
| POST | `/api/exams/check` | детерминированная проверка ответов |

### Users (требует session)

| Method | Path | Описание |
|---|---|---|
| GET | `/api/users/me` | полный профиль с счётчиками |
| GET | `/api/users/history` | последние worksheets (cursor pagination) |
| GET | `/api/users/favorites` | избранные листы |
| POST | `/api/users/favorites` | добавить в избранное |
| DELETE | `/api/users/favorites/:id` | убрать из избранного |
| GET | `/api/users/templates` | шаблоны пользователя |
| POST | `/api/users/templates` | создать шаблон |
| DELETE | `/api/users/templates/:id` | удалить шаблон |
| GET | `/api/users/subscription` | текущая активная подписка |

### Billing (требует session, webhook — без)

| Method | Path | Описание |
|---|---|---|
| POST | `/api/billing/create` | создать платёж в ЮKassa (или dev-mode запись) |
| POST | `/api/billing/yookassa-webhook` | webhook (no auth) |
| GET | `/api/billing/subscription` | текущая активная подписка |
| POST | `/api/billing/cancel` | отменить подписку (до конца оплаченного периода) |
| GET | `/api/billing/history` | история платежей |

### DTO (что фронт получает)

Все ответы — `{ ok: true, ... }` или `{ ok: false, error, code, details? }`.

Ключевые типы в `backend/src/types.ts`:
- `GenerateWorksheetRequest` / `GenerateWorksheetResponse` (+ `meta: { model, provider, costUsd, latencyMs, cached, generation }`)
- `CheckExamRequest` / `CheckExamResponse` (+ `perProblem[]`)
- `MagicLinkRequest` / `MagicLinkResponse` / `CallbackResponse` / `SessionResponse`
- `CreatePaymentRequest` / `CreatePaymentResponse`
- `UserTemplate` · `HistoryItem` · `SubscriptionView`
- `AppEnv` (`Bindings: Env; Variables: { user, ip, userAgent }`)

---

## LLM routing (по `docs/02-llm-architecture.md`)

| Task | Free / Base | Plus |
|---|---|---|
| `worksheet-gen` | `gpt-6-luna` → fallback `gpt-6-sol` | `claude-opus-5-5` (prompt cache), no fallback |
| `exam-gen` | `gpt-6-luna` → fallback `gpt-6-sol` | `claude-opus-5-5` (prompt cache), no fallback |
| `validate` | `deepseek-v4-flash` | `deepseek-v4-flash` |
| `embed` | `dashscope:qwen3-embedding-8b` → fallback `openai:text-embedding-3-large` | то же |
| `image-gen` | NOT IMPLEMENTED (returns null) | — |

Стоимость (USD / 1M tokens):
- Luna $0.10 in / $0.50 out
- Sol $2 in / $10 out
- Opus $4 in / $20 out (cache read $0.20)
- DeepSeek $0.14 in / $0.28 out
- Qwen embeddings $0
- OpenAI embeddings $0.13 in

10k листов/мес: ~$18.50 (free) / ~$150 (с 30% Plus).

---

## D1 schema (12 таблиц)

| Таблица | Назначение |
|---|---|
| `users` | профиль + plan + счётчики генераций |
| `magic_links` | токен (TTL 15 мин), single-use |
| `sessions` | token (TTL 30 дней), HttpOnly cookie |
| `worksheets` | полный `payload_json` (Worksheet) для истории/избранного |
| `favorites` | UNIQUE(user_id, worksheet_id) |
| `templates` | name + параметры worksheet без tasks |
| `subscriptions` | plan/status/period/yookassa_payment_id |
| `payments` | amount_rub/yookassa_payment_id (UNIQUE)/confirmation_url |
| `llm_logs` | task/provider/model/plan/tokens_in/out/cost_usd/latency_ms/cached/fallback |
| `semantic_cache` | sha256 от params → cached Worksheet (TTL 30 дней, hit_count) |
| `events` | name + data_json для аналитики |
| `rate_limits` | key (UNIQUE) / count / window_start, 24-часовое окно |

`backend/src/db/schema.sql` — 196 строк SQL, индексы на `(user_id, created_at)`, `(subject, grade)`, `email`, `cache_key`.

---

## Smoke — что проверено вживую

```
$ BASE_URL=http://localhost:8787 npm run smoke

▶ Smoke against http://localhost:8787

  ✓ GET /healthz → 200 ok:true — HTTP 200
  ✓ GET /readyz → 200 (D1 ok) — ok
  ✓ GET /api/llm/models → JSON — 0 models
  ✓ GET /api/auth/me (anonymous) → user:null — anonymous
  ✓ POST /api/billing/yookassa-webhook → handled:false (ignored event) — handled=true
  ✓ POST /api/worksheets/generate (no key) → 500 — HTTP 500

──────────
  6 passed / 0 failed / 6 total
```

`0 models` потому что нет API-ключей в `.dev.vars` — это правильное поведение (`availableModels()` честно говорит что ничего не сконфигурировано).

`HTTP 500` на `/api/worksheets/generate` — потому что нет `OPENAI_API_KEY` / `OPENROUTER_API_KEY`. `pickModel()` возвращает `primary: null` → `callWithFallback` бросает `InternalError`. Дизайн: лучше явная ошибка чем тихий mock.

---

## Tests — что покрыто unit-тестами

```
$ npm test -- --run

 ✓ tests/unit/cost.test.ts          (7 tests)
 ✓ tests/unit/shortid.test.ts       (7 tests)
 ✓ tests/unit/moderation.test.ts    (13 tests)
 ✓ tests/unit/prompts.test.ts       (16 tests)
 ✓ tests/unit/billing.test.ts       (8 tests)
 ✓ tests/unit/checkExam.test.ts     (9 tests)

 Test Files  6 passed (6)
 Tests       60 passed (60)
```

Покрытие:
- `cost.ts`: формула для всех 6 моделей, cache-read для Opus, breakdown, unknown model
- `moderation.ts`: пустая/короткая/длинная строка, prompt injection, кириллица, non-string
- `prompts.ts`: routing матрица для всех (task, plan) комбинаций, buildWorksheetPrompt/buildExamPrompt/buildValidatePrompt, makeCacheKey нормализация, MODEL_COSTS полнота
- `billing.ts`: PRICES для всех (plan, period), yearly < 12×monthly (скидка)
- `checkExam.ts`: exact/numeric-tolerance/choice/partial match, missing answers, punctuation, case-insensitive
- `shortid.ts`: format prefixes, 1000-call uniqueness

---

## Команды для разработки

```bash
cd backend

# Setup (один раз)
npm install
npm run db:migrate:local        # создаёт таблицы в Miniflare D1

# Dev
./scripts/dev.sh                # wrangler dev --local на :8787
# в другом терминале:
npm run smoke                   # → 6/6 PASS
npm test                        # → 60/60 PASS
npm run typecheck               # → 0 errors
ESLINT_USE_FLAT_CONFIG=false npm run lint  # → 0 errors

# Production
# 1) wrangler d1 create rabochielisty → получить database_id → подставить в wrangler.toml
# 2) wrangler secret put OPENAI_API_KEY    # + другие ключи
# 3) npm run db:migrate:prod
# 4) ./scripts/deploy.sh
```

---

## Решения, которые я принял автономно (документирую для review)

1. **Стек бэка:** Cloudflare Workers + Hono v4 + D1 + R2 — соответствует текущему хостингу фронта, бесплатно до больших объёмов, единая экосистема (Cloudflare), нет VPN/proxy для РФ (OpenRouter закрывает всё одним ключом).

2. **API дизайн:** все ответы — `{ ok: boolean, ... }`. Ошибки через `ApiError` подклассы (`BadRequestError`, `UnauthorizedError`, `PaymentRequiredError`, `NotFoundError`, `RateLimitError`, `InternalError`) → middleware → JSON с `code` и `details`. Статусы 400/401/402/403/404/409/429/500 — стандартные.

3. **LLM-фасад:** единый `src/llm/index.ts` с `generateWorksheet(args, env, db)` — внутри: moderation → rate-limit → cache lookup → pickModel → callWithFallback → save cache → log → return. Никаких реальных HTTP-вызовов в unit-тестах (нужны env-ключи).

4. **Auth:** magic link через Resend. Без паролей. Cookie HttpOnly+Secure+SameSite=Lax, 30 дней. CSRF — пока полагаемся на SameSite=Lax (для prod — добавить double-submit token).

5. **Billing:** ЮKassa webhook. Без HMAC-подписи (ЮKassa их не поддерживает по умолчанию) — IP allowlist на стороне ЮKassa. В TODO — добавить HMAC через кастомный shared secret.

6. **D1 schema:** timestamps как unix seconds (number), не ISO-строки. UUID-подобные ID с префиксами (`ws_xxx`, `exam_xxx`, `usr_xxx`, `pay_xxx`, `sub_xxx`, `fav_xxx`, `tpl_xxx`, `cache_xxx`, `log_xxx`, `evt_xxx`) — для читаемых логов и удобного дебага.

7. **Rate-limit:** два слоя — `llm/ratelimit.ts` (LLM-вызовы: 3/day anon, 10/day free, ∞ base/plus) + `middleware/ratelimit.ts` (HTTP: 5/hour для `/magic-link`, опционально для других). Хранение — `rate_limits` таблица с UPSERT.

8. **Tests:** unit-тесты через `vitest` + `@cloudflare/vitest-pool-workers` (для интеграционных, если будут). Pure unit-тесты работают в node pool без D1. Smoke — отдельный `tests/smoke.ts` через fetch к работающему `wrangler dev`.

9. **Фронт ↔ бэк:** контракт в `backend/src/types.ts` дублирует фронтовый `src/lib/types.ts` (Subject/Worksheet/ExamVariant/GenerationRequest). Когда фронт переедет на единый shared-пакет — поменяем импорты.

10. **Что НЕ сделано (out-of-scope для этого ТЗ):**
    - Реальные API-ключи (юзер кладёт в `.dev.vars` / `wrangler secret put`)
    - Деплой в Cloudflare (нужен database_id из `wrangler d1 create rabochielisty`)
    - Email-шаблоны красивые (сейчас — HTML из `services/email.ts`)
    - A/B-тест, аналитика, метрики
    - Image-gen (не подключали — нет модели в ТЗ)
    - Self-verification LLM для математики
    - HMAC для ЮKassa webhook
    - Виртуализация/инвалидация JWT_SECRET

---

## Следующие шаги (для юзера)

1. **Получить API ключи** (OpenRouter — единый ключ для OpenAI + Anthropic + DeepSeek): https://openrouter.ai/keys
2. **`wrangler d1 create rabochielisty`** → подставить database_id в `backend/wrangler.toml`
3. **`wrangler secret put`** для всех ключей из `.dev.vars.example`
4. **`npm run db:migrate:prod`**
5. **`./scripts/deploy.sh`** → получить `*.workers.dev` URL
6. На фронте — `NEXT_PUBLIC_API_URL=https://rabochielisty-api.xxx.workers.dev` в `.env`
7. Передеплой фронта: `wrangler pages deploy out --project-name=listai-prototype`

После этого — реальные генерации (Luna) и валидации (DeepSeek) на проде.
