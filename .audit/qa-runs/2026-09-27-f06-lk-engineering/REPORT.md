# F-06: Личный кабинет учителя — инженерный аудит

**Дата:** 2026-09-27
**Аудитор:** Verifier (роль: branch worker, parent: mvs_2f094dbdc7514d8ea830ca10b947c5da)
**Скоуп:** готовность ЛК учителя к проду **как инженерной интеграции** (auth, dashboard, FR↔BE мост, деплой, ФЗ-152). Продуктовые UX-баги и брендинг — в соседнем `2026-09-27-f06-lk-product/REPORT.md`, здесь их не дублирую.
**Лайв фронт:** https://listai-prototype.pages.dev/ (статический export)
**Лайв бэк (задеплоен 2026-09-27):** https://rabochielisty-api.ivanlusnikov159.workers.dev/

---

## 1. TL;DR

| | |
|---|---|
| **Готовность ЛК к проду** | **~30%** (backend ~85%, frontend integration 0%, мост 0%, тесты 0%) |
| **Главный блокер** | **Magic-link cookie флоу сломан cross-origin**: `routes/auth.ts:63` ставит `SameSite=Lax`, фронт на `listai-prototype.pages.dev`, бэк на `rabochielisty-api.ivanlusnikov159.workers.dev` — браузер **не отдаст cookie** с фронта на бэк. Плюс **нет `/auth/callback` страницы** на фронте — клик по magic-link в письме ведёт на `https://listai-prototype.pages.dev/auth/callback?token=...` → **404** (статический export). |
| **Рекомендация по деплою** | **Вариант A**: оставить отдельный CF Worker, фронт static, переключить cookie на `SameSite=None; Secure` + **выпустить фронт и бэк под одним доменом** (custom `rabochielisty.ru`, фронт apex, бэк — поддомен `api.rabochielisty.ru`). Подробнее в §5. |
| **Критичных проблем** | 4 (cookie cross-origin, нет callback page, нет `/api/usage`, тесты 0) |
| **Объём работ** | ~5–7 рабочих дней (M–L задачи) до readiness 80% |

---

## 2. Integration Map

| # | UI-действие | Бэкенд-роут | Файл-роут (BE) | Файл-фронт | Статус |
|---|---|---|---|---|---|
| 1 | Запрос magic-link | `POST /api/auth/magic-link` | `backend/src/routes/auth.ts:28-43` | `src/app/login/page.tsx:27-42` | 🟡 Mock с `setTimeout(800)` (`login/page.tsx:34`). **Не дёргает бэк.** |
| 2 | Callback по ссылке из письма | `POST /api/auth/callback` | `backend/src/routes/auth.ts:47-82` | ❌ **`/auth/callback` page отсутствует** — `src/app/auth/` нет | 🔴 **Брокен** — клик по magic-link ведёт на `https://listai-prototype.pages.dev/auth/callback?token=…`, страница не зарегистрирована → **404 в проде**. |
| 3 | Получение пользователя | `GET /api/auth/me` или `GET /api/users/me` | `auth.ts:100-114`, `users.ts:45-62` | ❌ Никаких вызовов — `dashboard/page.tsx:51-62` читает localStorage | 🔴 |
| 4 | История генераций | `GET /api/users/history?cursor=&limit=` | `users.ts:64-85` | `storage.ts:5,37-48` — localStorage | 🔴 |
| 5 | Избранное (list) | `GET /api/users/favorites` | `users.ts:87-91` | `dashboard/page.tsx:53` `getFavorites()` | 🔴 localStorage-only |
| 6 | Избранное (add) | `POST /api/users/favorites` | `users.ts:93-105` | `storage.ts:50-55` `toggleFavorite()`, `storage.ts:94-97` `saveFavorite()` | 🔴 |
| 7 | Избранное (remove) | `DELETE /api/users/favorites/:id` | `users.ts:107-113` | `dashboard/page.tsx:81-85` | 🔴 |
| 8 | Шаблоны (list) | `GET /api/users/templates` | `users.ts:115-119` | `storage.ts:59-61` | 🔴 |
| 9 | Шаблоны (create) | `POST /api/users/templates` | `users.ts:130-145` | UI отсутствует на фронте | 🔴 |
| 10 | Шаблоны (delete) | `DELETE /api/users/templates/:id` | `users.ts:147-153` | `dashboard/page.tsx:87-91` | 🔴 |
| 11 | Sign out | `POST /api/auth/logout` | `auth.ts:84-91` | `dashboard/page.tsx:106-110` — только localStorage cleanup; `AdminLayout.tsx:84-94` — реальный fetch | 🟡 Админка дёргает правильно. Юзерский дашборд — нет. |
| 12 | Лимит генераций (usage) | ❌ **Не реализован** | — | `limit.ts:1-66` — localStorage 3/день | 🔴 Эндпоинта нет. Поле `users.generations_today` (`schema.sql:20`) и `incrementUserGenerations()` (`queries.ts:131-143`) уже есть. |
| 13 | Обновить имя | ❌ Не реализован | — | Read-only | 🔴 |
| 14 | Сменить email | ❌ Не реализован | — | — | 🔴 |
| 15 | Удалить аккаунт | ❌ Не реализован | — | — | 🔴 |

**Итого:** 4 готовых бэкенд-роута + 2 подключения (admin me + admin logout), но 10 точек интеграции с юзерской частью полностью на моках, а одна (callback page) **физически отсутствует**.

---

## 3. Разрыв Frontend ↔ Backend

### 3.1 Архитектурная основа

- **Фронт** — `next.config.mjs:3` → `output: "export"`. Это значит:
  - `src/app/api/*` не работают (их нет).
  - Любой `/api/*` дёргается отдельным бэк-доменом через `process.env.NEXT_PUBLIC_API_URL`.
- **Бэк** — `backend/src/index.ts:46-72` регистрирует Hono-роуты, задеплоен как `rabochielisty-api.ivanlusnikov159.workers.dev` (`wrangler.toml:53`).
- **NEXT_PUBLIC_API_URL** уже задан в `.env:30`, но реально используется только в 3 местах: `src/lib/client/llm.ts:32`, `src/lib/admin/api.ts:15`, `src/lib/track.ts:43`. **Юзерские страницы (login, dashboard) его игнорируют.**

### 3.2 Что **уже есть на бэке** и готово к вызову

Подтверждено grep'ом по `backend/src/routes/` и `backend/src/services/`:

- `POST /api/auth/magic-link` (`backend/src/routes/auth.ts:28-43`) — rate-limit 5/hour через `middleware/ratelimit.ts:107-131`
- `POST /api/auth/callback` (`routes/auth.ts:47-82`) — zod-валидация, HttpOnly+Secure+SameSite=Lax cookie, возврат `sessionToken`+`user`
- `POST /api/auth/logout` (`routes/auth.ts:84-91`) — чистит session в БД + cookie
- `GET /api/auth/me` (`routes/auth.ts:100-114`) — light-профиль для boot'а
- `GET /api/users/me` (`routes/users.ts:45-62`) — full с generations_today/generations_limit
- `GET /api/users/history` (`routes/users.ts:64-85`) — cursor-пагинация, `db/userResources.ts:46-115`
- `GET/POST/DELETE /api/users/favorites[/:id]` (`routes/users.ts:87-113`) — cursor JOIN на worksheets для payload (`userResources.ts:132-201`)
- `GET/POST/DELETE /api/users/templates[/:id]` (`routes/users.ts:115-153`) — zod на create
- `GET /api/users/subscription` (`routes/users.ts:155-160`)
- `POST /api/track` (`routes/track.ts`) — публичный

Бэкенд **не мок** — реальные SQL, реальная интеграция с Resend. Это подтверждено `docs/BACKEND_REPORT.md:8-30` и `docs/09-deploy-to-prod.md`.

### 3.3 Что **отсутствует на бэке** (нужно добавить)

| # | Что | Где | Зачем |
|---|---|---|---|
| 1 | `GET /api/users/usage` | новый handler в `users.ts` рядом с `/me` | Возвращает `{ generationsToday, generationsLimit, generationsResetAt, plan }` для замены localStorage-счётчика. Тривиально: `getUserById` уже есть в `queries.ts:54-65`. |
| 2 | `POST /api/worksheets/save` | новый handler | Сохранение сгенерированного листа в `worksheets`. `addFavorite()` (`userResources.ts:211-273`) делает этот INSERT неявно, но **только** при добавлении в избранное. |
| 3 | `PATCH /api/users/me` (name) | `users.ts` | Редактирование имени. **ПДн**: имя в БД — ПДн по 152-ФЗ. |
| 4 | `users.generations_today` инкрементируется при генерации | `services/worksheet.ts` после успешного LLM-call | Без этого поле всегда `0`, `users.ts:46-58` всегда говорит «осталось 3». |
| 5 | Миграция БД | — | **Не требуется** — schema.sql покрывает все 9 готовых роутов. |

### 3.4 Что **отсутствует на фронте** (нужно дописать)

| # | Что | Файл | Зачем |
|---|---|---|---|
| F1 | `/auth/callback` page | новый `src/app/auth/callback/page.tsx` | Принимает `?token=…`, дёргает `POST /api/auth/callback`, редиректит на `/dashboard`. **Самый критичный баг**: без этой страницы magic-link флоу невозможен. |
| F2 | Замена мока в `login/page.tsx:27-42` | `src/app/login/page.tsx` | Сейчас `setTimeout(800)`. Заменить на `fetch(NEXT_PUBLIC_API_URL + '/api/auth/magic-link')`. |
| F3 | `src/lib/auth/api.ts` (новый) | новый | Wrapper: `requestMagicLink`, `verifyMagicLink`, `getCurrentUser`, `signOut`, `getUsage`. По образцу `src/lib/admin/api.ts` — `credentials: 'include'`. |
| F4 | Замена localStorage в `dashboard/page.tsx` на API | рефактор `storage.ts` + `dashboard/page.tsx` | Текущий `getHistory()`/`getFavorites()` — синхронный. Либо async, либо localStorage как offline-cache + revalidate на mount. |
| F5 | `useUsage()` hook | заменяет `limit.ts:1-66` | `GET /api/users/usage` revalidate на mount. |
| F6 | ProfileHeader edit-mode | `dashboard/page.tsx:214-246` | Inline-edit имени → `PATCH /api/users/me`. |

---

## 4. ФЗ-152 чек (учитель — ПДн)

### 4.1 Хранение ПДн

| Аспект | Где | Оценка |
|---|---|---|
| Email учителя | `users.email` в D1 (`schema.sql:16`), уникальный | ✅ OK |
| Email → Resend | `services/email.ts:43-73` через `env.RESEND_API_KEY` | ⚠ Resend — US-based. Под ФЗ-152 «передача ПДн за рубеж» — нужен DPA с Resend либо российский SMTP. Для MVP допустимо с уведомлением в `/legal/privacy`. |
| Имя (fallback) | `services/auth.ts:172-179` `deriveName(email)` — local-part до `@`. Сохраняется только в `users.name`, не пишется в console.* | ✅ OK |
| User-Agent | `middleware/auth.ts:68-69` → `c.var('userAgent')` для логов/rate-limit | ✅ OK |
| IP | `middleware/auth.ts:49-59` → `c.var('ip')` для rate-limit | ✅ OK как «обезличенные технические данные» |

### 4.2 Cookie-сессия (КРИТИЧНО)

**Текущая настройка в `routes/auth.ts:60-66`:**
```ts
setCookie(c, "session", result.sessionToken, {
  httpOnly: true,
  secure: true,
  sameSite: "Lax", // ⚠ НЕПРАВИЛЬНО для cross-origin
  maxAge: 30 * 24 * 60 * 60,
  path: "/",
});
```

**Проблема:** Фронт (`listai-prototype.pages.dev`) и бэк (`rabochielisty-api.ivanlusnikov159.workers.dev`) — разные origin'ы. С `SameSite=Lax` браузер **не отдаст** cookie при fetch из домена фронта.

**Чинить:**
- Вариант 1 (минимум): `sameSite: "None"` (secure уже true). Браузер требует Secure для SameSite=None — у нас есть.
- Вариант 2 (правильно): один eTLD+1 для обоих (например `rabochielisty.ru` apex → статика, `api.rabochielisty.ru` → бэк). Тогда дефолтный `SameSite=Lax` достаточно.
- **Префикс `__Host-`:** не используется. Можно переключить — требует Secure + Path=/ + без Domain. У нас нет Domain, значит совместимо.

### 4.3 D1 и ФЗ-152

- **Encryption-at-rest** ✅ — D1 шифрует на диске по умолчанию.
- **Гео-локация данных** ⚠ — D1 в ближайшем к клиенту регионе (EEUR/US). **Нет RU-региона**. По ФЗ-152 ч.5 ст.18 хранение ПДн граждан РФ — на серверах в РФ.
- Варианты: (1) ждать CF D1 RU, (2) перейти на Yandex Managed PG / Selectel, (3) принять риск и зафиксировать в privacy policy.
- **Для MVP** (10 учителей): вариант 3 допустим. **Перед коммерческим масштабированием** — вариант 2.

### 4.4 Resend и ПДн

- ФИО учителя в email **не передаётся** — только email + URL.
- URL содержит magic-link токен (32-char NanoID — не ПДн сам по себе, но сопоставим с email через timing). Risk-low.
- Для продa: + unsubscribe-header + почтовый адрес для жалоб в `legal/`. Не критично.

---

## 5. Деплой-стратегия: сравнение вариантов

| | **A: Static FE + Worker (текущее)** | B: SSR (Vercel / CF Pages Functions) | C: Cloudflare Access |
|---|---|---|---|
| **Стоимость** | CF Pages Free + Workers Free = **$0/мес** до 1k MAU | Vercel Hobby free, CF Pages Functions $5/мес Pro | **$3/user/month**, минимум 50 seats |
| **Сложность деплоя** | 1 build FE + 1 deploy BE. Уже настроено. | Переписать storage.ts на API routes; переписать все fetch'и | Просто: wrap Access policy вокруг фронта |
| **Cookie cross-origin** | ❌ Сломано сейчас (SameSite=Lax). Фиксится либо None, либо общий домен | Решено естественно — same-origin | Решено естественно — CF-domain |
| **ФЗ-152 (гео)** | D1 вне РФ (см. §4.3) | Зависит от хостинга (тоже вне РФ) | Так же вне РФ |
| **Bundle size / latency** | Smallest (static HTML + JSON) | Больше JS (SSR hydration) | Smallest |
| **Lock-in** | Cloudflare | Vercel/Next.js | Cloudflare Access |
| **Score** | **8/10** (потеря 2 за cookie-баг) | 6/10 | 4/10 (стоимость) |

### 🟢 Рекомендация — Вариант A с двумя доработками

1. **Backend CORS + cookie флоу** (`routes/auth.ts:60-66` + `middleware/cors.ts:17-30`):
   - `sameSite: "None"` (secure уже true).
   - В `cors.ts` расширить `FRONTEND_URL` через запятую: `rabochielisty.ru,listai-prototype.pages.dev`.
   - На проде: один домен (`rabochielisty.ru`) → cookie same-site без `None`.
2. **Фронт:** дописать `/auth/callback` страницу + заменить mock'и в `login/page.tsx` / `dashboard/page.tsx` / `limit.ts` на реальные fetch'и.

**Объём:** ~3–4 дня фронт + 0.5 дня бэк.

**Почему не B:** рефакторинг ~25 страниц с static-export на SSR — переписать все оптимизации (уже под static), рост bundle, хуже SEO для тем-площадок. Цель (ЛК учителя) — узкая, не требует SSR.

**Почему не C:** overkill для onelogin-magic-link. $3/seat экономически невыгодно учителю-фримиуму.

---

## 6. Тестовое покрытие

### 6.1 Что есть

| Файл / Директория | Тестов | Покрытие |
|---|---|---|
| `/tests/*.test.ts` (root) | 4 | `ktp/ktp-docx/lesson-plan/presentation.test.ts` — НИ ОДНОГО про auth/dashboard/login |
| `/backend/tests/unit/*.test.ts` | 7 | `billing/checkExam/cost/moderation/polza-config/prompts/shortid`. **Нет `auth.test.ts`.** |
| `/backend/tests/smoke.ts` | 1 файл | 6 проверок, только `/api/auth/me` (anonymous case). **Нет теста на magic-link flow.** |
| e2e (Playwright / Cypress) | 0 | отсутствует полностью |

**Grep:**
```
$ grep -l 'auth\|magic\|/api/auth' tests/ backend/tests/
backend/tests/smoke.ts   # только /api/auth/me anonymous
```

`services/auth.ts:requestMagicLink` — **0 unit-тестов**. `middleware/auth.ts:65` — **0 тестов**. `routes/auth.ts:28-91` — **0 интеграционных тестов**.

### 6.2 Что нужно покрыть до прода

| # | Что | Файл | Тип |
|---|---|---|---|
| T1 | `requestMagicLink` — успешно создаёт user + magic_link + email | новый `backend/tests/unit/auth.test.ts` | unit (mock D1 + Resend) |
| T2 | `requestMagicLink` — никогда не раскрывает «email существует» | то же | unit |
| T3 | `consumeMagicLinkAndCreateSession` — атомарный swap; повторное использование → null | то же | unit |
| T4 | `parseAdminEmails` env parsing | то же | unit |
| T5 | `middleware/auth.ts` — bearer token, cookie, x-session-token, expired session → null | новый `backend/tests/unit/auth-middleware.test.ts` | unit |
| T6 | `requireAuth` throws UnauthorizedError при null | то же | unit |
| T7 | E2E Playwright: `magic-link → callback → dashboard loads with profile` | новый `tests/e2e/lk-flow.spec.ts` | e2e |
| T8 | E2E: history/favorites/templates рендерятся после seed-данных через API | то же | e2e |
| T9 | Smoke: `POST /api/auth/magic-link` → `POST /api/auth/callback` → `GET /api/auth/me` returns user | дополнить `backend/tests/smoke.ts` | integration |

**Минимум на прод:** T1–T6 + T9.

---

## 7. Бэклог реализации (приоритезированный)

Размеры: **S** = до 4ч, **M** = 4–12ч, **L** = 1–3 дня.

### 🔴 BLOCKER (без этого ЛК в прод не выкатить)

| # | Задача | Файл:line | Размер | Зачем |
|---|---|---|---|---|
| **B1** | `SameSite=Lax` → `SameSite=None` (или переключиться на один домен) | `backend/src/routes/auth.ts:63` | **S** | Cookie cross-origin сломан. |
| **B2** | Создать `/auth/callback` страницу: парсит `?token=`, дёргает `POST /api/auth/callback`, редиректит на `/dashboard` (PRG) | новый `src/app/auth/callback/page.tsx` | **M** | Путь не зарегистрирован → 404. |
| **B3** | Заменить mock в `login/page.tsx` на реальный fetch | `src/app/login/page.tsx:27-42` + новый `src/lib/auth/api.ts` | **M** | Кнопка «Получить ссылку» ничего не делает. |
| **B4** | Реализовать `GET /api/users/usage` + `useUsage()` hook | новый handler + `src/lib/utils/limit.ts:1-66` | **S** | Бэкенд хранит `generations_today`, просто endpoint не выставлен. |

### 🟡 ТАК НАДО (нужно для функционала ЛК)

| # | Задача | Файл:line | Размер | Зачем |
|---|---|---|---|---|
| **M1** | Дёргать `/api/users/{me,history,favorites,templates}` на mount `/dashboard`, с fallback на localStorage | `src/app/dashboard/page.tsx:51-68` → новый `src/lib/auth/api.ts` + рефактор `src/lib/utils/storage.ts` | **L** | История/избранное/шаблоны не переживают смену устройства. |
| **M2** | Конструктор после генерации → `POST /api/worksheets/save` | `src/app/constructor/page.tsx:462-473` | **M** | Лист не попадает в историю на сервере. |
| **M3** | SignOut → `POST /api/auth/logout` + очистить localStorage | `src/app/dashboard/page.tsx:106-110` + `src/lib/auth/api.ts:signOut()` | **S** | **Утечка:** после нажатия «Выйти» сессия на бэке живёт. |
| **M4** | `users.generations_today` инкрементируется при генерации | `services/worksheet.ts` после успешного LLM-call | **M** | UI limit сейчас показывает 3/3 всегда. |
| **M5** | `PATCH /api/users/me` (name) + UI inline-edit | новый handler + `src/app/dashboard/page.tsx:214-246` | **M** | ФЗ-152: учитель должен иметь возможность поправить `deriveName(email)`. |
| **M6** | Auth-юнит-тесты: T1–T6 | `backend/tests/unit/auth.test.ts`, новый | **M** | 0 покрытия критичного модуля. |

### 🟢 ХОРОШО БЫ (не блок)

| # | Задача | Размер |
|---|---|---|
| **S1** | E2E Playwright (T7–T8) | **L** |
| **S2** | UI: создание шаблонов в конструкторе | **M** |
| **S3** | Account deletion (`DELETE /api/users/me`) + UI | **M** |
| **S4** | Поле `last_login_at` + audit для админки | **S** |
| **S5** | Удалить dead `JWT_SECRET` из `backend/src/env.ts:37` (нигде не используется, кроме двух unit-тестов) | **S** |
| **S6** | `__Host-session` cookie prefix для hardening | **S** |
| **S7** | Перевезти фронт на `rabochielisty.ru` (бренд переехал 25.09; перемешаны `listai`/`rabochielisty`/`listai-prototype`) | **L** |

---

## 8. Блокеры для прода

| # | Блокер | Severity |
|---|---|---|
| **BK-1** | Cookie `SameSite=Lax` на cross-origin — браузер не сохранит сессию, любое обращение к `/api/users/*` вернёт 401 после попытки входа | **P0** |
| **BK-2** | Нет `/auth/callback` page — magic-link ведёт на 404 | **P0** |
| **BK-3** | Frontend всё ещё на localStorage, не вызывает бэк — ЛК-функционал очищается при incognito/новом устройстве | **P0** для server-side persistence, **P1** для MVP |
| **BK-4** | Нет `/api/users/usage` — server-side rate-limit невозможен | **P1** |
| **BK-5** | `name` редактируется только пересозданием аккаунта — ФЗ-152 (поправить авто-выведенное имя) | **P1** |
| **BK-6** | 0 тестов на auth-флоу — невозможно безопасно рефакторить | **P1** |
| **BK-7** | ФЗ-152: данные в D1 вне РФ — формально не соответствует ч.5 ст.18 | **P2** (MVP-допустимо с privacy policy) |

---

## 9. Acceptance criteria для ревью

Закрытие готовности ≥80%:
- [ ] BK-1..BK-3 закрыты (cookie + callback page + реальные вызовы бэка).
- [ ] M1, M2, M3, M5 выполнены.
- [ ] Smoke против прод-URL даёт 9+ passed включая magic-link happy-path.
- [ ] e2e Playwright (один сценарий): `/login` → письмо → клик → `/dashboard` отображает профиль из БД.
- [ ] Cookie имеет `SameSite=None; Secure` ИЛИ фронт/бэк на одном домене.

---

## 10. Что НЕ в скоупе (но всплыло)

- **ЮKassa HMAC signature** для webhook — `backend/src/services/billing.ts:232`, TODO(security). Вне ЛК-скоупа, блокер для billing.
- **Админка** (модельроутинг, статы) — есть, в скоупе `f06-lk` не затрагивается.
- **`firstUserId` race в auth.ts:80-95**: `getUserByEmail → if not → createUser → getUserByEmail` — три раундтрипа, может race'нуть при двух одновременных регистрациях. Реальная вероятность низкая. Фикс — `INSERT OR IGNORE` + перечитка. **Не блокер.**
- **`deriveName(email)` использует local-part до `@`** (`services/auth.ts:172-179`). Для учителя это может быть «ivan.ivanovich» или «teacher123». Лучше: оставлять `null`, при первом входе показывать inline-prompt «Как вас зовут?».

---

**Готово.** Отчёт сохранён. 30 строк TL;DR сверху достаточно для первого прохода; основные работы — B1–B4 (S/M) + M1–M2 (L) + M6 (M) + S5 (S). Оценочно **5–7 рабочих дней** до готовности 80%.
