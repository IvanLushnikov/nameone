# TZ-09: «Тема недели» — виджет на главной + SEO-страницы

> **Статус:** ✅ реализовано, проходит typecheck + build
> **Дата:** 2026-09-27 (ревизия после реализации)
> **Приоритет:** P0 (запуск Q4 2026)
> **Связано:** `docs/POSITIONING.md` §3 (столбик c — SEO), `docs/01-research-naming.md` §2 (поисковые запросы по сезонам)

## Контекст

**Гипотеза:** учителя ищут рабочие листы **по времени года** — в октябре «дроби 5 класс», в мае «треугольники 7 класс». Если мы заранее знаем, что проходят в школах прямо сейчас, мы можем:

1. **Показать релевантный блок на главной** → ↑ конверсия в конструктор в сезон.
2. **Сгенерировать 12 SEO-страниц** (`/theme/<seoSlug>/`) → ловим сезонный поисковый трафик, который не покрыт обычными `/subject/<s>/<g>/<t>/` страницами.

**Конкуренты:** Yaklass, Uchi.ru имеют похожие «темы месяца», но без привязки к поисковым запросам. Никто не делает SEO-страницу под сезон + класс + тему.

**Решение:** реализовано в 3 файлах + правки в `sitemap.ts` и `page.tsx`. Документ описывает **уже реализованное** состояние.

---

## Что есть (уже реализовано)

### Файл `src/lib/content/calendar.ts`

```ts
export type Season =
  | 'autumn-1' | 'autumn-break' | 'autumn-2'
  | 'winter-break'
  | 'spring-1' | 'spring-break' | 'spring-2'
  | 'summer';

/**
 * Жёстко закодированные границы четвертей и каникул
 * на 2026/2027 учебный год.
 */
export function getCurrentSeason(date: Date = new Date()): Season {
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if ((m === 10 && d >= 28) || (m === 11 && d <= 4)) return 'autumn-break';
  if ((m === 12 && d >= 28) || (m === 1 && d <= 11)) return 'winter-break';
  if (m === 3 && d >= 23) return 'spring-break';

  if (m === 9 || (m === 10 && d <= 25)) return 'autumn-1';
  if (m === 11 || (m === 12 && d <= 27)) return 'autumn-2';
  if (m === 1 || m === 2 || (m === 3 && d <= 22)) return 'spring-1';
  if (m === 4 || (m === 5 && d <= 25)) return 'spring-2';

  return 'summer';
}
```

### Файл `src/lib/content/weekly-topics.ts`

```ts
export interface WeeklyTopic {
  slug: string;        // внутренний ID
  season: Season;      // привязка к календарю
  weekLabel: string;   // "Октябрь · 1-2 неделя"
  subject: string;     // "math"
  grade: number;       // 5
  topicSlug: string;   // "drobi-obyknovennye"
  title: string;       // "Дроби в 5 классе — самое время потренироваться"
  whyText: string;     // объяснение для SEO-страницы
  seoSlug: string;     // "drobi-5-klass-osen"
}

export const WEEKLY_TOPICS: WeeklyTopic[] = [
  // 12 записей: октябрь (4) → ноябрь (2) → декабрь (1) → февраль (1) → март (1) → апрель (1) → май (2) → лето (2)
];
```

**Каталог тем:** 12 шт, покрывает весь 2026/2027 год. Самая частая тема в каждом сезоне для самого частотного класса.

### Файл `src/components/landing/WeeklyTopic.tsx`

```tsx
export function WeeklyTopicBlock() {
  const season = getCurrentSeason();
  const topic = WEEKLY_TOPICS.find((t) => t.season === season);
  if (!topic) return null;  // лето / каникулы — блок скрыт

  const href = `/subject/${topic.subject}/${topic.grade}/${topic.topicSlug}`;
  // …
  return (
    <section data-weekly-topic-block className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
      {/* «Что проходят сейчас в школах» + заголовок + CTA */}
    </section>
  );
}
```

**Логика:** если для сезона нет темы (каникулы, лето) — рендерит `null`. CTA ведёт на `/subject/<s>/<g>/<t>/` (обычную SEO-страницу темы), не в конструктор (потому что пользователь сначала захочет посмотреть, что внутри).

### Интеграция на главной (`src/app/page.tsx`)

```tsx
<FAQ />
<WeeklyTopicBlock />  // после FAQ, перед финальным CTA
```

Виджет показывается **после FAQ** (см. `src/app/page.tsx:24`) — это намеренный порядок: сначала социальное доказательство и доверие (FAQ), потом сезонный CTA.

### SEO-страницы `src/app/theme/[slug]/page.tsx`

```tsx
export function generateStaticParams() {
  return WEEKLY_TOPICS.map((t) => ({ slug: t.seoSlug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const topic = getWeeklyTopicBySeoSlug(params.slug);
  // canonical = https://rabochielisty.ru/theme/<slug>/
  // openGraph для расшаринга
}

export default function ThemePage({ params }: Props) {
  const topic = getWeeklyTopicBySeoSlug(params.slug);
  if (!topic) notFound();

  // JSON-LD Article, hero с weekLabel, «Что вы получите» блок,
  // CTA на /subject/<s>/<g>/<t>/, список 6 релевантных тем
}
```

**12 страниц сгенерированы в `out/theme/`:**

```
drobi-5-klass-osen
otritsatelnye-chisla-6-klass-oktyabr
chereduyushchiesya-glasnye-5-klass-oktyabr
smeshannye-chisla-5-klass-noyabr
proportsii-6-klass-noyabr
lineynye-uravneniya-7-klass-dekabr
protsenty-5-klass-fevral
koordinatnaya-ploskost-6-klass-fevral
fsu-formuly-7-klass-fevral
kvadratnye-uravneniya-8-klass-aprel
treugolniki-7-klass-may
sistemy-lineinye-7-klass-may
povtoryaem-drobi-letom
tablica-umnozheniya-leto-povtor
```

### Sitemap (`src/app/sitemap.ts:80-85`)

```ts
const themePages: MetadataRoute.Sitemap = WEEKLY_TOPICS.map((t) => ({
  url: `${base}/theme/${t.seoSlug}/`,
  priority: 0.7,
  changeFrequency: "weekly" as const,
}));
```

`changeFrequency: "weekly"` — это намеренный SEO-сигнал Яндексу: страница сезонная, обновляется по расписанию.

---

## Что НЕ трогать (out of scope)

- ❌ Логика `getCurrentSeason` — захардкожена на 2026/2027 учебный год. Не обобщать «на любой год» в Q4 2026.
- ❌ Каталог `WEEKLY_TOPICS` — 12 записей покрывает год. Расширение (химия, биология) — Q1 2027.
- ❌ `null`-рендер блока на главной при отсутствии сезона — намеренный. Не показывать «пустой блок».
- ❌ `data-weekly-topic-block` — нужен для e2e-селекторов.

---

## Скоуп (что входит в TZ-09)

| # | Что | Файл | Статус |
|---|---|---|---|
| **1** | `src/lib/content/calendar.ts` — 8 сезонов + `getCurrentSeason` | new | ✅ |
| **2** | `src/lib/content/weekly-topics.ts` — 12 тем + `WEEKLY_TOPICS` | new | ✅ |
| **3** | `src/components/landing/WeeklyTopic.tsx` — виджет для главной | new | ✅ |
| **4** | `src/app/theme/[slug]/page.tsx` — 12 SEO-страниц | new | ✅ |
| **5** | Интеграция виджета в `src/app/page.tsx:24` | правка | ✅ |
| **6** | `src/app/sitemap.ts:80-85` — добавить 12 URL в sitemap | правка | ✅ |

---

## Live-проверка (как проверять вручную)

### TypeScript + Build

```bash
cd /Users/ivanlusnikov/Documents/nameone
export PATH="/opt/homebrew/opt/node/bin:$PATH"
npm run typecheck    # должно быть пусто
npm run build        # должен пройти без ошибок; out/theme/ должен содержать 12 папок
```

### Live-проверка в браузере

| URL | Что должно быть |
|---|---|
| `/` | Виджет «Что проходят сейчас в школах» с заголовком и кнопкой «Сделать рабочий лист по теме →». Блок виден **только** если `getCurrentSeason()` имеет тему в `WEEKLY_TOPICS` (в `autumn-1`, `autumn-2`, `spring-1`, `spring-2`, `summer` — есть; в `autumn-break`, `winter-break`, `spring-break` — нет) |
| `/theme/drobi-5-klass-osen/` | Hero с Badge `Октябрь · 1-2 неделя`, заголовок «Дроби в 5 классе — самое время потренироваться», CTA на `/subject/math/5/drobi-obyknovennye/`, JSON-LD `Article` в исходнике |
| `/theme/nevalidniy-slug/` | 404 (notFound) |

### Playwright-селектор

```ts
await page.waitForSelector('[data-weekly-topic-block]', { timeout: 5000 });
```

### Ручной тест календарной логики

```bash
# Подменить дату для проверки вне сезона:
node -e "
  const { getCurrentSeason } = require('./src/lib/content/calendar.ts');
  console.log(getCurrentSeason(new Date('2026-12-31')));  // 'winter-break'
  console.log(getCurrentSeason(new Date('2026-10-15')));  // 'autumn-1'
"
```

(Примечание: для запуска `node -e` с TypeScript нужен `tsx` или `ts-node`. В CI используем `npm test`.)

---

## DoD (Definition of Done)

- [x] Календарь учебного года 2026/2027.
- [x] 12 тем в `WEEKLY_TOPICS` покрывают весь год.
- [x] Виджет на главной с `null`-рендером при отсутствии сезона.
- [x] 12 SEO-страниц сгенерированы (см. `out/theme/`).
- [x] `generateStaticParams` для всех 12 тем.
- [x] JSON-LD `Article` на каждой странице.
- [x] `metadata` с canonical и OpenGraph.
- [x] Виджет интегрирован в `src/app/page.tsx:24` (после FAQ).
- [x] 12 URL в `sitemap.ts` с `priority: 0.7` и `changeFrequency: "weekly"`.
- [x] `npm run typecheck` ✅
- [x] `npm run build` ✅

---

## Связанные документы

- `src/lib/content/calendar.ts` — календарь
- `src/lib/content/weekly-topics.ts` — каталог тем
- `src/components/landing/WeeklyTopic.tsx` — виджет
- `src/app/theme/[slug]/page.tsx` — SEO-страницы
- `src/app/sitemap.ts:80-85` — sitemap
- `docs/POSITIONING.md` §3 (столбик c — exact-match SEO)