# РабочиеЛисты AI — фронтенд (MVP)

> Лайв: **https://listai-prototype.pages.dev/** (временный, до регистрации `rabochielisty.ru` → переключение DNS CNAME)
> Документы по проекту: `docs/`
> Бренд: **РабочиеЛисты AI** · домен `rabochielisty.ru` (решение 2026-09-25, см. `docs/BRAND.md`)

## Что собрано

**Лендинг + конструктор + SEO + кабинет + ОГЭ/ЕГЭ + тарифы + юр. документы — всё в одном проекте.**

### Стек
- **Next.js 14** App Router + TypeScript + Tailwind 3
- **Статический экспорт** (`output: "export"`) → Cloudflare Pages Direct Upload
- **API routes убраны** — моковая генерация и rate-limit переехали в `src/lib/mock/generator.ts` и `src/lib/utils/limit.ts`
- **Деплой:** `wrangler pages deploy out --project-name=listai-prototype --commit-dirty=true` (Pages-проект `listai-prototype` — рабочее имя до переезда на прод-домен `rabochielisty.ru`, см. `docs/BRAND.md`)

### Структура
```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # / — лендинг (Hero, Features, Subjects, Testimonials, Pricing, FAQ, CTA)
│   ├── constructor/              # /constructor — 4-шаговый мастер генерации
│   ├── oge/                      # /oge — выбор ОГЭ/ЕГЭ + ExamRunner с таймером
│   ├── pricing/                  # /pricing — freemium / Базовый / Плюс + comparison + B2B
│   ├── dashboard/                # /dashboard — история, избранное, шаблоны, профиль (localStorage)
│   ├── login/                    # /login — email magic link (мок: кнопка "я нажал ссылку")
│   ├── preview/                  # /preview?id=... — превью сохранённого листа
│   ├── subject/[subject]/...     # SEO: предмет → класс → тема (46 страниц)
│   ├── legal/[slug]/             # /legal/offer, /legal/privacy, /legal/terms, /legal/cookies
│   ├── sitemap.ts                # sitemap.xml со всеми темами
│   └── robots.ts
├── components/
│   ├── ui/                       # Button, Card, Badge, Input, Modal, Toast, Tabs, Select
│   ├── layout/                   # Header, Footer
│   ├── shared/                   # Logo, PaywallModal
│   ├── landing/                  # Hero, Features, Subjects, Testimonials, PricingTeaser, FAQ, CTA
│   ├── constructor/              # WorksheetPreview (A4 с шифром ответов)
│   └── oge/                      # ExamRunner (таймер + пошаговое решение + разбор)
├── lib/
│   ├── types.ts                  # Доменные типы (Subject, Grade, Topic, Worksheet, ExamVariant)
│   ├── content/subjects.ts       # Таксономия: 3 предмета × 9 классов × ~40 тем с примерами
│   ├── mock/generator.ts         # Мок-генератор листов и ОГЭ-вариантов
│   ├── utils/
│   │   ├── cn.ts                 # className + tailwind-merge
│   │   ├── limit.ts              # Rate-limit на бесплатные генерации (localStorage, 3/день)
│   │   └── storage.ts            # localStorage: история, избранное, шаблоны, профиль
└── docs/
    ├── BRAND.md                  # Финальное решение по бренду и доменам
    ├── 01-research-naming.md     # Конкуренты + рынок + 5-10 кандидатов имён
    ├── 02-llm-architecture.md    # LLM-слой для бэка (TODO)
    ├── 02-task-spec-for-testing.md
    ├── 03-skill-rules.md
    └── 04-pricing-economics.md
```

### Статические страницы (build output)

```
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
**93 страницы статически.** Все маршруты проверены на лайве — `200 OK`.

---

## Как запустить локально

```sh
# node/npm
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"

# Установить зависимости
npm install

# Dev-сервер (HMR, http://localhost:3000)
npm run dev

# Production build + static export в ./out
npm run build

# Локально посмотреть сборку
cd out && python3 -m http.server 8080
# Открыть http://localhost:8080/
```

---

## Деплой на Cloudflare Pages

```sh
# В твоей shell-сессии (не в моей — env не пробрасывается)
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="9fe2955fcf08aecf91754823a7aae0aa"

cd /Users/ivanlusnikov/Documents/nameone
npx --yes wrangler pages deploy out \
  --project-name=listai-prototype \
  --commit-dirty=true
# НЕ добавляй --branch=production — это создаст Preview и НЕ обновит custom domain
```

**Не перезаписывает `ilushnikov-portfolio`** (там твой личный сайт). Создан новый проект `listai-prototype` — рабочее имя Pages-проекта до переезда на прод-домен `rabochielisty.ru`. После регистрации домена переименуй Pages-проект (см. «Как переключить с listai-prototype на rabochielisty.ru» ниже).

---

## Что работает

- ✅ Все 11 экранов UI: лендинг, конструктор, paywall, pricing, dashboard, login, preview, ОГЭ/ЕГЭ (3 страницы), legal (4 страницы), 404
- ✅ Таксономия: 3 предмета × 9 классов × ~40 тем = **~70 тем с примерами заданий**
- ✅ 46 SEO-страниц тем (генерируются статически с правильными meta-title/description/keywords)
- ✅ 25 SEO-страниц классов
- ✅ 3 SEO-страницы предметов
- ✅ Конструктор: 4 шага (предмет → класс → тема → параметры) + live preview + Print/PDF
- ✅ Поддержка deep-link из SEO-страниц: `/constructor?subject=math&grade=5&topic=drobi-obyknovennye` прыгает сразу к настройке
- ✅ Моковая генерация: 5-30 заданий с ответами и пояснениями (через шаблоны + taxonomy examples)
- ✅ Rate-limit: 3 бесплатных генерации в сутки через `localStorage` (после — модалка paywall)
- ✅ История, избранное, шаблоны — всё в localStorage, переживает перезагрузки
- ✅ ОГЭ/ЕГЭ: таймер как на экзамене, пошаговое решение, автопроверка, разбор каждого задания
- ✅ Адаптив: mobile-first, breakpoints 320/640/1024/1440 (всё на flex/grid)
- ✅ Печать листа в PDF: использует `window.print()` с CSS @page A4 — реальный текст, не картинка
- ✅ robots.txt + sitemap.xml (все темы включены)
- ✅ Метатеги: OG, Twitter, lang="ru", Inter с кириллицей
- ✅ Hero CTA, Footer, навигация, мобильное меню

---

## Что мок (нужно для бэка)

| Сейчас (мок) | Как будет в проде |
|---|---|
| `src/lib/mock/generator.ts` — шаблоны заданий | OpenAI/Anthropic API + self-verification |
| `src/lib/utils/limit.ts` — localStorage rate-limit | Server-side cookies + БД |
| `src/lib/utils/storage.ts` — localStorage история/избранное | API + БД + sync между устройствами |
| Кнопка "Оформить подписку" в paywall | ЮKassa webhook → сервер создаёт подписку |
| Кнопка "Я нажал ссылку" в login | Email magic link через Resend / SMTP |
| ОГЭ/ЕГЭ варианты — захардкоженные 6 заданий | Банк задач ФИПИ + адаптивная выдача |

**Бэк-план в `docs/02-llm-architecture.md`** — там уже прописано: gpt-6-luna / gpt-6-sol / claude-opus-5-5 / deepseek-v4-flash / qwen3-embedding-8b. Routing по тарифу, fallback-цепочки, прайс.

---

## Как переключить с listai-prototype на rabochielisty.ru

> **Предусловие:** бренд уже зафиксирован в `docs/BRAND.md` (**РабочиеЛисты / rabochielisty.ru**). Домен `rabochielisty.ru` нужно купить и привязать к Pages-проекту.

Пошаговый план переключения с временного Pages-домена `listai-prototype.pages.dev` на прод-домен `rabochielisty.ru`:

```sh
# 1. Купить домен rabochielisty.ru (~600 ₽/год на reg.ru / regery).
#    Проверить занятость перед покупкой: https://www.reg.ru/whois/

# 2. DNS: CNAME rabochielisty.ru → listai-prototype.pages.dev
#    (Pages auto-certificate выпустит SSL через несколько минут.)
#    Альтернатива — переименовать Pages-проект на "rabochielisty" и указать
#    CNAME на rabochielisty.pages.dev. Старый домен listai-prototype.pages.dev
#    продолжит работать.

# 3. В backend/wrangler.toml [env.production.vars].FRONTEND_URL убрать listai-prototype
#    и оставить только https://rabochielisty.ru,https://www.rabochielisty.ru.
#    Задеплоить воркер: cd backend && npm run deploy

# 4. Массовая замена по коду и докам:
grep -rl "listai\|listai-prototype\|listai\.ru" src/ docs/ README.md

# 5. Cookies / storage ключи (опционально, чтобы старые счётчики обнулились):
#    src/lib/utils/limit.ts → KEY = "rabochielisty_gens_v1"
#    src/lib/utils/storage.ts → KEY_HISTORY = "rabochielisty.history" и т.д.

# 6. Перебилдить и передеплоить:
npm run build
npx --yes wrangler pages deploy out --project-name=listai-prototype --commit-dirty=true

# 7. Проверить sitemap.xml + robots.txt на новом домене.
# 8. Добавить домен в Яндекс.Вебмастер + Google Search Console.
```

После переключения `listai-prototype.pages.dev` можно держать как fallback 30-60 дней (для обратной совместимости старых закладок), потом отключить в Pages Dashboard.

---

## Сколько стоит хост сейчас

**Cloudflare Pages** — бесплатно до неограниченного количества запросов на Direct Upload. Текущий Pages-проект `listai-prototype` (рабочее имя до переезда на `rabochielisty.ru`) будет стоить **$0/мес** пока трафик в пределах Free Tier (Unlimited bandwidth, 500 builds/мес, 100 custom domains).

LLM-API на проде — отдельная статья расходов, см. `docs/02-llm-architecture.md`.

---

## Что осталось сделать до продакшена

1. **Домен и бренд** — купить `rabochielisty.ru` (~600 ₽/год на reg.ru), прописать DNS CNAME, переключить Pages-проект `listai-prototype` на прод-домен `rabochielisty.ru` (пошаговый план в разделе «Как переключить с listai-prototype на rabochielisty.ru» выше)
2. **Бэк** (см. `docs/02-llm-architecture.md`):
   - LLM-роутинг с fallback
   - Self-verification для математики (LLM решает свою задачу)
   - Банк задач ФИПИ для ОГЭ/ЕГЭ
   - ЮKassa webhook
   - Email magic link через Resend
   - PostgreSQL для истории/избранного/шаблонов
3. **Модерация AI-контента** — human-in-the-loop на первых 1000 задач
4. **A/B-тест copy** на лендинге (CTR в hero)
5. **SEO-карта сайта в Яндекс.Вебмастере** — после деплоя на нормальный домен
6. **Юридическая чистка** — оферта, политика, пользовательское соглашение (сейчас — заглушки, нужен юрист)
7. **Метрики** — Яндекс.Метрика + PostHog (после бэка)
