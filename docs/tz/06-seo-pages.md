# TZ-06: SEO-страницы (Q1-2027, Worker F)

**Что.** Создать 3 новых SEO-маршрута + обновить sitemap. Каждая страница — landing под тип артефакта для конкретной темы/класса/предмета. Главная цель — захватить поисковый трафик по запросам типа «план урока 5 класс математика», «презентация дроби 5 класс», «КТП 5 класс русский язык».

## Файлы — строго свои

1. `src/app/lesson-plan/[subject]/[grade]/[topic]/page.tsx` — new, шаблон по образцу `src/app/subject/[subject]/[grade]/[topic]/page.tsx`.
2. `src/app/presentation/[subject]/[grade]/[topic]/page.tsx` — new, аналогично.
3. `src/app/ktp/[subject]/[grade]/page.tsx` — new, без `[topic]` (КТП покрывает весь год).
4. `src/app/sitemap.ts` — добавить новые URL в `topicPages` (или отдельный массив).

## Шаблон страницы темы (для lesson-plan и presentation)

Структура как у `src/app/subject/[subject]/[grade]/[topic]/page.tsx:1-...`, но:

1. **`generateMetadata`** — заголовок/description содержат тип артефакта:
   - lesson-plan: «План урока по теме «{topic.title}» · {grade} класс · РабочиеЛисты AI»
   - presentation: «Презентация по теме «{topic.title}» · {grade} класс · РабочиеЛисты AI»

2. **`generateStaticParams`** — для каждого subject × grade × topic из `subjects.ts` генерим URL.

3. **Основной контент страницы:**
   - Заголовок h1 с темой.
   - Подзаголовок: «Готовый план урока по ФГОС для {grade} класса по предмету {subject.title}» (или «Готовая презентация…»).
   - 2-3 карточки-преимущества: «Конспект на 45 минут», «Шаги по ФГОС», «Готовый DOCX».
   - **Главная CTA-кнопка**: `<Link href="/constructor?subject=…&grade=…&topic=…&type=lesson-plan">Сгенерировать план урока →</Link>` (или `&type=presentation`).
   - Блок «Что получите» — список 5-7 конкретных пунктов (для плана: этапы, цели, оборудование, ДЗ; для презентации: слайды, темы, заметки).
   - Краткий FAQ под темой (3-4 вопроса) — вынеси в общий компонент `src/components/landing/FaqTopic.tsx` ИЛИ оставь inline.

4. **Стиль** — используй существующие `<Card>`, `<Button>`, `<Badge>`, иконки из `lucide-react`.

## Шаблон страницы КТП (без [topic])

1. **`generateMetadata`**: «КТП по {subject.title} · {grade} класс · {schoolYear} · РабочиеЛисты AI»
2. **`generateStaticParams`** — для каждого subject × grade из `subjects.ts`.
3. **Контент:**
   - h1: «Календарно-тематическое планирование по {subject.title} · {grade} класс»
   - Описание: «Готовое КТП на {totalHours} ч ({weeks} недель) по ФГОС. Скачивайте в DOCX с merged cells.»
   - CTA: `/constructor?subject=…&grade=…&type=ktp`
   - Блок «Что включает КТП»: «Все темы курса · Поле ФГОС · Тип урока · Контрольные и тесты · Готовый DOCX»
   - 4-5 карточек с описанием структуры.

## Обновление sitemap

В `src/app/sitemap.ts`:
1. В массив `topicPages` (или новый массив `artifactTopicPages`) добавь URL для каждого subject × grade × topic:
   ```
   { url: `${base}/lesson-plan/${s.slug}/${g.num}/${t.slug}`, priority: 0.6, changeFrequency: "monthly" },
   { url: `${base}/presentation/${s.slug}/${g.num}/${t.slug}`, priority: 0.6, changeFrequency: "monthly" },
   ```
2. В новый массив `ktpPages`:
   ```
   { url: `${base}/ktp/${s.slug}/${g.num}`, priority: 0.7, changeFrequency: "monthly" },
   ```

## Acceptance

1. `npx tsc --noEmit` ✅
2. `npm run build` ✅ (должно показать ~93 существующих + ~270 lesson-plan + ~270 presentation + ~25 ktp = ~660 страниц)
3. Ручная проверка:
   - `cd out && python3 -m http.server 8080`
   - открыть `/lesson-plan/math/5/drobi-obyknovennye` → есть CTA, редиректит на `/constructor?...&type=lesson-plan`
   - открыть `/presentation/math/5/drobi-obyknovennye` → есть CTA на `&type=presentation`
   - открыть `/ktp/russian/5` → есть CTA на `&type=ktp`

## Out-of-scope

- Аналитика / счётчики на страницах — отложено.
- Реальные примеры планов/презентаций/КТП на страницах — только description, без embed.
- Поддомены типа `plan.rabochielisty.ru` — отложено.
