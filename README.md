# УчЛист — фронтенд (MVP)

> Лайв: **https://listai-prototype.pages.dev/** (временный, до регистрации `uchlist.ru` → переключение DNS CNAME)
> Документы по проекту: `docs/`
> Бренд: **УчЛист** · домен `uchlist.ru` (решение 2026-10-02, см. `docs/BRAND.md`)

## Что собрано

**Лендинг + конструктор + SEO + кабинет + ОГЭ/ЕГЭ + тарифы + юр. документы — всё в одном проекте.**

### Стек
- **Next.js 14** App Router + TypeScript + Tailwind 3
- **Статический экспорт** (`output: "export"`) → Cloudflare Pages Direct Upload
- **Бэкенд** — отдельный npm-проект в `backend/`: Hono 4 на Cloudflare Workers + D1.
  Он **не входит** в корневой `package.json`: свои зависимости, свой `node_modules`,
  свои скрипты (`cd backend && npm test`). Фронт при этом ходит в него по HTTP —
  реальная генерация, `src/lib/mock/` это только fallback.
- **Деплой:** деплоит **GitHub Actions** (`.github/workflows/deploy.yml`), вручную запускать не нужно.
  Ключевой момент: `wrangler pages deploy out --branch=main`. **Без `--branch=main` wrangler
  создаёт preview, а не production** — кастомный домен при этом не активируется.
  Локальная отправка: `npm run build && npx wrangler pages deploy out --project-name=listai-prototype --branch=main`.

### Структура
> Актуально на 02.10.2026. Полный реестр маршрутов — `src/app/`, полный перечень
> документов — `docs/`. Расшифровка внутренних кодов (`F-06`, `TZ-11`, `В-2.3`) — `docs/GLOSSARY.md`.

```
src/
├── app/                          # Next.js App Router (24 страницы)
│   ├── page.tsx                  # / — лендинг (Hero, Features, Subjects, Pricing, FAQ, CTA)
│   ├── constructor/              # /constructor — мастер генерации
│   ├── oge/                      # /oge — выбор ОГЭ/ЕГЭ + ExamRunner с таймером
│   ├── exam/[exam]/...           # /exam/oge/<предмет>/<номер> — отдельный вариант
│   ├── pricing/                  # /pricing — freemium / Базовый / Плюс / Школа
│   ├── dashboard/                # /dashboard — ЛК учителя (ЛК на бэке, не в localStorage)
│   ├── login/                    # /login — magic link
│   ├── form/                     # /form?t=<токен> — страница ученика (публичная, без входа)
│   ├── materials/, material/     # Банк материалов
│   ├── subject|lesson-plan|presentation|ktp|theme/  # SEO-страницы предмет→класс→тема
│   ├── preview/                  # /preview?id=... — превью сохранённого листа
│   ├── legal/[slug]/             # /legal/offer, /legal/privacy, /legal/terms, /legal/cookies
│   ├── sitemap.ts, robots.ts
├── components/
│   ├── ui/                       # Button, Card, Badge, Input, Modal, Toast, Tabs, Select
│   ├── layout/, shared/, landing/, math/, seo/
│   ├── constructor/              # Превью артефактов (A4, SVG-графики, шифр ответов)
│   ├── teacher/                  # Формы учителя: список, разбор, выгрузка CSV, QR
│   ├── form/                     # UI страницы ученика
│   └── oge/                      # ExamRunner (таймер + пошаговое решение + разбор)
├── lib/
│   ├── types.ts                  # Доменные типы
│   ├── content/                  # Таксономия: 21 предмет × классы × темы + grade-extensions/
│   ├── forms/, auth/, worksheets/, client/  # HTTP-клиенты к бэкенду
│   ├── llm/                      # Клиентский рендер SVG-графиков + self-verification
│   ├── mock/                     # Fallback-генераторы, если бэк недоступен
│   └── utils/                    # docx/pptx/zip-экспорт, математика, storage, лимиты
backend/                          # Hono + D1 (отдельный npm-проект)
├── src/llm/                      # Роутинг по задаче, кэш, модерация, провайдеры
├── src/routes/                   # HTTP-слой
├── src/services/                 # Бизнес-логика
├── src/db/                       # D1: schema.sql + запросы
└── tests/                        # vitest на @cloudflare/vitest-pool-workers
docs/                             # 22 документа: спеки, ТЗ, юнит-экономика
tests/                            # vitest фронта (RTL, jsdom)
```

### Статические страницы (build output)

```
> **Это снимок старой сборки (MVP, 3 предмета) — не текущее состояние.**
> Актуальное число страниц смотри в `out/` после `npm run build`
> (`find out -name '*.html' | wc -l`) или в `src/app/sitemap.ts`.
> Таблица оставлена как пример формата вывода `next build`.

Route (app)                                       Size     First Load JS
┌ ○ /                                            2.86 kB    109 kB
├ ○ /constructor                                 11 kB      125 kB
├ ○ /dashboard                                   4.55 kB    119 kB
├ ● /legal/[slug] (4 pages)                       175 B      96.2 kB
├ ○ /login                                       4.03 kB    110 kB
├ ○ /oge                                         7.92 kB    122 kB
├ ○ /preview                                     5.64 kB    112 kB
├ ○ /pricing                                     1.55 kB    97.6 kB
├ ● /subject/[subject] (3 pages)                 1.55 kB    97.6 kB
├ ● /subject/[subject]/[grade] (25 pages)        1.55 kB    97.6 kB
└ ● /subject/[subject]/[grade]/[topic] (46)      1.55 kB    97.6 kB
```

---

## Как запустить локально

```sh
# Node 22 (в Node 23 next dev стабильно зависает — см. .github/workflows/deploy.yml)
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

# Без этого next dev висит молча, не печатая даже баннер Next.js.
export NEXT_TELEMETRY_DISABLED=1

# Установить зависимости
npm install

# Dev-сервер (HMR, http://localhost:3000).
# Первый старт на M2 Air занимает ~4 минуты, компиляция страницы — до 2 минут.
# Это нормально, не перезапускай.
npm run dev

# Production build + static export в ./out
npm run build

# Локально посмотреть сборку
cd out && python3 -m http.server 8080
# Открыть http://localhost:8080/
```

### Вход в личный кабинет без регистрации

На `/login/` есть блок **«Локальная разработка»** с кнопкой **«Войти как Иван Лушников»**
— вход без почты и без бэкенда. Кнопка записывает демо-профиль в `localStorage`
(6 записей истории, 1 избранный лист, 3 шаблона) и открывает `/dashboard`.

Кнопка видна только при `NODE_ENV !== "production"`, то есть на прод-сборке в
Cloudflare Pages её нет. Реализация — `src/lib/dev/demo-login.ts`.

Раньше условие включало `|| NEXT_PUBLIC_DEMO_LOGIN === "1"`. Эта ветка убрана
(аудит ИБ, 2 октября 2026): `NEXT_PUBLIC_*` вшивается в бандл на этапе сборки,
и достаточно было оставить переменную в настройках Cloudflare после
локального эксперимента, чтобы вход без подтверждения по почте стал доступен
всем, кто открыл сайт. Проверить заранее, «забыли» ли её убрать, нельзя.

Прод-вход (magic link, session cookie) требует запущенного бэка
(`cd backend && npm run dev` → `wrangler dev --local`); письмо отправляется
через Resend. Демо-вход кладёт профиль в `localStorage` и открывает `/dashboard`
без бэка — это только для локальной разработки, в прод-сборке кнопки нет.

---

## Деплой на Cloudflare Pages

**Обычно это не нужно — деплоит CI.** При пуше в `main` GitHub Actions собирает
и выкладывает сам (`.github/workflows/deploy.yml`), блокирующих проверок качества
в деплое нет — они живут в `ci.yml` на pull_request.

Если нужно выложить вручную (например, из другой ветки):

```sh
# В твоей shell-сессии (не в моей — env не пробрасывается)
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="9fe2955fcf08aecf91754823a7aae0aa"

cd /Users/ivanlusnikov/Documents/nameone
npm run build
npx --yes wrangler pages deploy out \
  --project-name=listai-prototype \
  --commit-dirty=true \
  --branch=main
# ВАЖНО: --branch=main обязателен. Без него wrangler создаёт Preview, а не
# production, и кастомный домен не активируется. НЕ добавляй --branch=production.
```

**Не перезаписывает `ilushnikov-portfolio`** (там твой личный сайт). Создан новый проект `listai-prototype` — рабочее имя Pages-проекта до переезда на прод-домен `uchlist.ru`. После регистрации домена переименуй Pages-проект (см. «Как переключить с listai-prototype на uchlist.ru» ниже).

---

## Что работает

> Сверь с этим списком перед тем, как доверять цифрам ниже: часть относится к
> раннему MVP и уже не описывает продукт.

- ✅ Лендинг, конструктор, paywall, pricing, ЛК, login, preview, ОГЭ/ЕГЭ, формы, банк материалов, legal
- ✅ Таксономия: **21 предмет** × классы × темы (расширяется через `src/lib/content/grade-extensions/`)
- ✅ SEO-страницы: предмет, класс, тема — × 3 типа артефакта (тема доступна как
  рабочий лист, план урока, презентация, КТП), плюс банк материалов
- ✅ Конструктор: мастер генерации + live preview + экспорт в DOCX/PPTX/PDF/печать
- ✅ Поддержка deep-link из SEO-страниц: `/constructor?subject=math&grade=5&topic=drobi-obyknovennye`
- ✅ Генерация через LLM (бэк `backend/`), `src/lib/mock/` — только fallback при недоступности бэка
- ✅ ЛК учителя на бэкенде: история, избранное, шаблоны, профиль (не localStorage)
- ✅ Онлайн-формы: учитель создаёт и выдаёт ссылку/QR, ученик решает без входа, учитель разбирает ответы и выгружает CSV
- ✅ ОГЭ/ЕГЭ: таймер как на экзамене, пошаговое решение, автопроверка, разбор каждого задания
- ✅ Адаптив: mobile-first, breakpoints 320/640/1024/1440 (всё на flex/grid)
- ✅ Печать листа в PDF: использует `window.print()` с CSS @page A4 — реальный текст, не картинка
- ✅ robots.txt + sitemap.xml (все темы включены)
- ✅ Метатеги: OG, Twitter, lang="ru", Inter с кириллицей
- ✅ Hero CTA, Footer, навигация, мобильное меню

---

## Что мок (нужно для бэка)

**Внимание: этот раздел устарел.** Он написан для раннего MVP, когда бэкенда
не существовало. Сейчас он реализован: генерация идёт через LLM, лимиты и
история — на бэкенде, вход — через настоящий magic link, оплата — через ЮKassa.

| Мок (остался как fallback) | Прод-реализация (уже работает) |
|---|---|
| `src/lib/mock/generator.ts` — шаблоны заданий | `backend/src/llm/` — LLM через polza.ai, роутинг по типу задачи |
| `src/lib/utils/limit.ts` — localStorage rate-limit | серверный rate-limit в БД (`middleware/ratelimit.ts`, `llm/ratelimit.ts`) |
| `src/lib/utils/storage.ts` — localStorage история/избранное | API + D1, синхронизация между устройствами |
| Демо-кнопка "Войти как Иван Лушников" | magic link + session cookie (`routes/auth.ts`) |
| "Оформить подписку" | ЮKassa webhook → сервер создаёт подписку (`services/billing.ts`) |
| ОГЭ/ЕГЭ — локальная генерация | `POST /api/exams/generate` (Sonnet 5.5, тариф «Плюс») |

Мок — это **страховка** при недоступности бэкенда, а не основной путь.
Он статически импортируется в бандл, поэтому новые страницы тянут его за собой;
при желании его можно грузить только в dev-режиме.

**Бэк-план в `docs/02-llm-architecture.md`** — там уже прописано: gpt-6-luna / gpt-6-sol / claude-opus-5-5 / deepseek-v4-flash / qwen3-embedding-8b. Routing по тарифу, fallback-цепочки, прайс.

---

## Как переключить с listai-prototype на uchlist.ru

> **Предусловие:** бренд уже зафиксирован в `docs/BRAND.md` (**УчЛист / uchlist.ru**). Домен `uchlist.ru` нужно купить и привязать к Pages-проекту.

Пошаговый план переключения с временного Pages-домена `listai-prototype.pages.dev` на прод-домен `uchlist.ru`:

```sh
# 1. Купить домен uchlist.ru (~600 ₽/год на reg.ru / regery).
#    Проверить занятость перед покупкой: https://www.reg.ru/whois/

# 2. DNS: CNAME uchlist.ru → listai-prototype.pages.dev
#    (Pages auto-certificate выпустит SSL через несколько минут.)
#    Альтернатива — переименовать Pages-проект на "uchlist" и указать
#    CNAME на uchlist.pages.dev. Старый домен listai-prototype.pages.dev
#    продолжит работать.

# 3. В backend/wrangler.toml [env.production.vars].FRONTEND_URL убрать listai-prototype
#    и оставить только https://uchlist.ru,https://www.uchlist.ru.
#    Задеплоить воркер: cd backend && npm run deploy

# 4. Массовая замена по коду и докам:
grep -rl "listai\|listai-prototype\|listai\.ru" src/ docs/ README.md

# 5. Cookies / storage ключи (опционально, чтобы старые счётчики обнулились):
#    src/lib/utils/limit.ts → KEY = "uchlist_gens_v1"
#    src/lib/utils/storage.ts → KEY_HISTORY = "uchlist.history" и т.д.

# 6. Перебилдить и передеплоить:
npm run build
npx --yes wrangler pages deploy out --project-name=listai-prototype --commit-dirty=true

# 7. Проверить sitemap.xml + robots.txt на новом домене.
# 8. Добавить домен в Яндекс.Вебмастер + Google Search Console.
```

После переключения `listai-prototype.pages.dev` можно держать как fallback 30-60 дней (для обратной совместимости старых закладок), потом отключить в Pages Dashboard.

---

## Сколько стоит хост сейчас

**Cloudflare Pages** — бесплатно до неограниченного количества запросов на Direct Upload. Текущий Pages-проект `listai-prototype` (рабочее имя до переезда на `uchlist.ru`) будет стоить **$0/мес** пока трафик в пределах Free Tier (Unlimited bandwidth, 500 builds/мес, 100 custom domains).

LLM-API на проде — отдельная статья расходов, см. `docs/02-llm-architecture.md`.

---

## Что осталось сделать до продакшена

1. **Домен и бренд** — купить `uchlist.ru` (~600 ₽/год на reg.ru), прописать DNS CNAME, переключить Pages-проект `listai-prototype` на прод-домен `uchlist.ru` (пошаговый план в разделе «Как переключить с listai-prototype на uchlist.ru» выше)
2. **Бэк** — сделан, см. `backend/`. Осталось:
   - **Вебхуки ЮKassa не проверяют подлинность.** Сейчас доверяем payload'у.
     Нужен IP-allowlist в ЛК ЮKassa (или HMAC). Отмечено TODO в
     `backend/src/services/billing.ts`.
   - **Правовые вопросы по фото работ учеников** (ПДн): основание обработки,
     согласие, срок хранения. Перечень открытых вопросов — `docs/tz/11-photo-check.md`,
     код нигде не утверждает, что обработка ПДн законна.
3. **Модерация AI-контента** — human-in-the-loop на первых 1000 задач
4. **A/B-тест copy** на лендинге (CTR в hero)
5. **SEO-карта сайта в Яндекс.Вебмастере** — после деплоя на нормальный домен
6. **Юридическая чистка** — оферта, политика, пользовательское соглашение (сейчас — заглушки, нужен юрист)
7. **Метрики** — Яндекс.Метрика + PostHog (после бэка)
