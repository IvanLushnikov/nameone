# TZ-08: УМК-фильтр в конструкторе + teacher-intent killer

> **Статус:** 🟡 частично реализовано (фильтрация есть, генератор ещё не пробрасывает контекст в LLM)
> **Дата:** 2026-09-27
> **Приоритет:** P0 (запуск Q4 2026)
> **Связано:** `docs/05-fgos-and-taxonomy-research.md` §A (Uchi.ru как референс), `docs/POSITIONING.md` §3 (столбик e), `src/lib/content/umk.ts`

## Контекст

**Teacher-intent killer:** запрос «Моро 3 класс рабочий лист» — это точный long-tail, который учителя реально гуглят (см. `01-research-naming.md` §2). Прямые конкуренты (Обучай, ПервоКласс, ZAOCHNIK) **не имеют** УМК-фильтра.

**Конкурентный референс:** Uchi.ru поддерживает выбор УМК как обязательный шаг (`/podgotovka-k-uroku` → класс → предмет → программа → урок), но это полноценный LMS, не наш сегмент.

**Наше решение:** inline-чипы УМК в шаге «Выбор темы» (TopicStep), не отдельный шаг wizard. Это UX-выбор: учитель выбирает учебник не «до», а «в момент» подбора темы — потому что список тем зависит от УМК. Если вынести в отдельный шаг, учитель будет кликать лишний раз.

---

## Что уже есть (реализовано в коде)

### `src/lib/content/umk.ts:9` — тип `UMKEntry`

```ts
export interface UMKEntry {
  id: string;        // "moro", "vilenkin", "merzlyak", …
  name: string;      // "Школа России (Моро)"
  short: string;     // "Моро"
  author: string;    // "Моро М.И., Бантова М.А."
  grades?: number[]; // опциональный фильтр по классам
}

export const umk: Record<string, UMKEntry[]> = {
  math: [...],
  algebra: [...],
  geometry: [...],
  russian: [...],
  // … 18 предметов в общей сложности
};

export function getUMK(subjectSlug: string, grade?: number | null): UMKEntry[] {
  const list = umk[subjectSlug] ?? [];
  if (grade == null) return list;
  return list.filter((u) => !u.grades || u.grades.includes(grade));
}
```

**Каталог УМК** покрывает 18 предметов (математика, алгебра, геометрия, русский, литература, английский, немецкий, информатика, физика, химия, биология, география, история, обществознание, ОБЖ, технология, финансы, музыка, ИЗО, физкультура, окружающий мир). Большинство записей — самые частотные запросы (Моро, Виленкин, Мерзляк, Атанасян, Ладыженская и т.п.).

### Inline-чипы в TopicStep (`src/app/constructor/page.tsx:1275-1350`)

```tsx
function TopicStep({ subjectData, gradeData, umk, onSelectUmk, onSelect, onBack }) {
  const umkList = getUMK(subjectData.slug, gradeData.num);
  const showUmkChips = umkList.length > 1;

  // F-09: реальный фильтр по УМК. Тема показывается если:
  //   - у темы НЕТ поля umk (общая для всех УМК), или
  //   - выбранный umk входит в список umk темы.
  const filteredTopics = gradeData.topics.filter((t) => {
    if (!umk) return true;
    if (!t.umk || t.umk.length === 0) return true;
    return t.umk.includes(umk);
  });

  return (
    <Card>
      {/* … */}
      {showUmkChips && (
        <div className="mb-4">
          <div className="text-xs font-medium text-warm-500 mb-1.5">Учебник</div>
          <div className="flex flex-wrap gap-1.5">
            {umkList.map((u) => (
              <button onClick={() => onSelectUmk(u.id)} className={/* чип */}>
                {u.short}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* … список отфильтрованных тем … */}
    </Card>
  );
}
```

### Фильтрация тем по `Topic.umk[]`

В `src/lib/types.ts:46-55` у `Topic` есть поле:
```ts
umk?: string[];  // ["moro", "vilenkin"]
```

Если поле задано — тема только для этих УМК. Если пусто — общая для всех УМК предмета. Это закрывает сегментацию тем по учебникам (например, «обыкновенные дроби» в Школе России и Виленкине проходятся по-разному).

### Auto-pick при единственном варианте

В `src/app/constructor/page.tsx:325-326` (handleSelectNext):
```ts
const umkList = getUMK(nextSubject, nextGrade);
if (umkList.length === 1) setUmk(umkList[0].id);
```

Если для предмета в данном классе только один УМК (например, для физики 7 класса — только Перышкин), он автоматически подставляется, и в TopicStep чипы не показываются.

### Deep-link `?umk=`

В `src/app/constructor/page.tsx:222-230` (init из query params): если в URL есть `?subject=&grade=`, и если для этой пары ровно один УМК — он авто-подставляется в state. Параметр `?umk=` пока не пробрасывается (out-of-scope Q4 2026).

---

## Что НЕ сделано (backlog для P1)

| # | Что | Файл | Приоритет |
|---|---|---|---|
| **1** | `src/lib/content/umk-utils.ts` с тонкой обёрткой `getUMKFor(subject, grade)` | new | P0 |
| **2** | Пробрасывание УМК-имени в system-prompt реального LLM-вызова (через `backend/src/llm/`) | `backend/src/routes/worksheet.ts` | P1 (когда будет реальный backend вместо моков) |
| **3** | SEO-страницы `/subject/[subject]/[grade]/[umk]/[topic]/page.tsx` | new | **P2** — требует `generateStaticParams` × 5-10 УМК × 200 тем = ~1 500 страниц. При `output: "export"` это даст ×3 размера `out/`. Отложено до решения проблемы масштаба static export. |
| **4** | `?umk=` в deep-link SEO-страниц | `src/app/constructor/page.tsx:228-229` | P1 |

---

## Скоуп (что входит в TZ-08 — итерация Q4 2026)

| # | Что | Файл | Статус |
|---|---|---|---|
| **1** | Каталог УМК + `getUMK` функция | `src/lib/content/umk.ts:9-138` | ✅ |
| **2** | Inline-чипы УМК в TopicStep | `src/app/constructor/page.tsx:1275-1350` | ✅ |
| **3** | Фильтрация тем по `Topic.umk[]` | `src/app/constructor/page.tsx:1297-1305` | ✅ |
| **4** | Auto-pick UMK при единственном варианте | `src/app/constructor/page.tsx:325-326` | ✅ |
| **5** | Тонкая обёртка `getUMKFor` для будущих расширений | `src/lib/content/umk-utils.ts` | 🟡 (задача этой TZ, см. §10) |
| **6** | УМК в `mock/generator.ts` (проброс в title/метаданные) | `src/lib/mock/generator.ts` | 🟡 (задача этой TZ, см. §10) |
| **7** | SEO-страницы с `[umk]` | new | ❌ P2 (см. §11) |

---

## Live-проверка (как проверять вручную)

### TypeScript + Build

```bash
cd /Users/ivanlusnikov/Documents/nameone
export PATH="/opt/homebrew/opt/node/bin:$PATH"
npm run typecheck    # должно быть пусто
npm run build        # должен пройти без ошибок
```

### Live-проверка в браузере

| Сценарий | URL / действие | Что должно быть |
|---|---|---|
| **3 варианта УМК (математика 5)** | `/constructor?subject=math&grade=5` → TopicStep | Чипы: «Моро», «Виленкин», «Мерзляк», «Никольский», «Петерсон» (5 шт, т.к. Петерсон без `grades` идёт для 1-4, но для math без фильтра grades — показывается). По клику на «Моро» — список тем фильтруется |
| **1 вариант УМК (физика 7)** | `/constructor?subject=physics&grade=7` | Чипы НЕ показываются (auto-pick на Перышкин), в TopicStep сразу список |
| **0 УМК (редкий кейс)** | Любой предмет, где `umk[subject]` пустой | Чипы НЕ показываются, список полный |
| **Темы с `umk[]` фильтром** | Математика 5 → «Виленкин» → список | Только темы, у которых `umk.includes("vilenkin")` или `umk` пусто |
| **Пустой результат** | Математика 5 → «Мерзляк» → если для Мерзляка 5 нет специфичных тем | «Для выбранного учебника нет тем. Попробуйте сбросить выбор УМК — кнопка «Назад»» |

### `getUMK` unit-test (если есть в `tests/`)

Проверить, что для `math / 5`:
- `getUMK("math", 5).length === 5` (Моро без grades + 4 с grades=[5,6])
- `getUMK("math", 3).length === 2` (Моро + Петерсон, grades=[1-4])
- `getUMK("physics", 7).length === 1` (только Перышкин, grades=[7-9])

---

## §10. Что добавляется в этой итерации

> Этот раздел — операционный. После реализации этих двух минимальных изменений, TZ-08 считается завершённой для Q4 2026.

### Файл `src/lib/content/umk-utils.ts` (new)

```ts
import { umk, getUMK, type UMKEntry } from "./umk";

/**
 * Алиас для getUMK с фиксированной семантикой: вернуть УМК,
 * доступные для данного предмета И класса.
 *
 * Использовать в коде, где явно нужно «УМК для предмета+класса»
 * (например, в SEO-карте или в LLM-prompt). В UI продолжаем
 * вызывать getUMK() — она та же, но короче.
 */
export function getUMKFor(subjectId: string, gradeNum: number): UMKEntry[] {
  return getUMK(subjectId, gradeNum);
}

/** Полный список УМК по предмету (без фильтра по классу). */
export function getAllUMKFor(subjectId: string): UMKEntry[] {
  return umk[subjectId] ?? [];
}
```

### Правка `src/lib/mock/generator.ts`

Добавить в выходной `Worksheet` (или в его `topic`-контекст) имя УМК, чтобы mock-генерация отражала выбор пользователя. **Без реального LLM-prompt** (он в backend) — только метаданные.

Псевдо-локация (после `req.topic` lookup):
```ts
// TZ-08: контекст УМК в метаданных листа (для будущей передачи в LLM)
const umk = req.umk ? getUMKById(req.subject, req.umk) : null;
const umkNote = umk ? ` Учебник: ${umk.name} (${umk.author}).` : "";
// затем — пробрасывать umkNote в title или в explanation задачи
```

---

## §11. SEO-страницы с [umk] — P2 (out of scope Q4 2026)

**Проблема:** при `output: "export"` (см. `next.config.mjs`) Next.js генерирует HTML для каждого `generateStaticParams`. Если добавить `[umk]`:

- 18 предметов × 11 классов × 5-10 УМК × ~20 тем = **~20 000 страниц**.
- Текущий `out/` занимает ~80 MB. ×3 = ~240 MB. Cloudflare Pages лимит = 25 000 файлов / 25 MB на один деплой (платные планы больше).
- `npm run build` время вырастет с ~2 мин до ~10-15 мин.

**Решение P2 (когда будет):**
- Переход с `output: "export"` на SSR (Cloudflare Workers + Next.js runtime).
- ИЛИ incremental static regeneration (ISR) с кэшем на стороне Cloudflare.
- ИЛИ мапинг только на самые частотные УМК (Моро × все классы = ~80 страниц).

**До этого** SEO-страницы без `[umk]` уже дают сильный сигнал:
- `/subject/math/5/drobi-obyknovennye/` — топ-1 по запросу «рабочий лист дроби 5 класс».
- УМК упоминается в `meta.description` и в листинге темы.

---

## DoD (Definition of Done для TZ-08 в этой итерации)

- [x] Каталог УМК покрывает ≥ 15 предметов (сейчас 18).
- [x] `getUMK(subject, grade)` фильтрует по `grades` (если задано).
- [x] Inline-чипы УМК в TopicStep.
- [x] Auto-pick при единственном варианте.
- [x] Фильтрация тем по `Topic.umk[]`.
- [x] `null`-рендер при пустом списке тем для выбранного УМК.
- [x] `npm run typecheck` ✅
- [x] `npm run build` ✅
- [ ] **`umk-utils.ts` создан** (задача этой TZ).
- [ ] **`mock/generator.ts` пробрасывает УМК в метаданные** (задача этой TZ).
- [ ] SEO-страницы `[umk]` — отложено в P2 (см. §11).

---

## Связанные документы

- `src/lib/content/umk.ts` — каталог УМК
- `docs/05-fgos-and-taxonomy-research.md` §A — паттерны УМК у конкурентов
- `docs/POSITIONING.md` §3 (столбик e) — УМК как столбик отстройки
- `docs/01-research-naming.md` §2 — «Моро 3 класс рабочий лист» как точный long-tail