# Tasks — Wave 2: research follow-ups (из конкурентного отчёта)

> **Дата:** 2026-09-26
> **Источник:** `.audit/competitors/2026-09-25-competitive-map.md` §6 (что осталось)
> **Подход:** 3 параллельных worker'а через Brave Search API. Каждый — свой отчёт в `.audit/competitors/`.

---

## Общий контекст для всех

**Что уже есть:**
- `.audit/competitors/2026-09-25-competitive-map.md` — базовый конкурентный анализ (сводный отчёт)
- `.audit/competitors/_search/01..07-*.txt` — сырые результаты первого прохода
- `agent-b9cff47f5aeb/scripts/brave_search.sh` — bash-обёртка над Brave Search API (env `BRAVE_API_KEY` или Keychain `scorix-brave-search`)

**Что НЕ делаем:**
- ❌ Менять код ЛистAI
- ❌ Деплоить
- ❌ Конкурировать с текущим сводным отчётом — дополняем

**Где сохранять:**
- `Worker A` → `.audit/competitors/2026-09-26-vc-ru-top20.md`
- `Worker B` → `.audit/competitors/2026-09-26-jobs-hh.md`
- `Worker C` → `.audit/competitors/2026-09-26-obuchai-deep.md`

---

## Worker A — vc.ru TOP-20 нейросетей для учителей

**Источник:** статья «Лучшие нейросети для создания рабочих листов онлайн в 2026 году: топ-20 AI-сервисов для учителей и преподавателей» на `https://vc.ru/toprate/2681120-luchshie-neuroseti-dlya-sozdaniya-rabochikh-listov-onlajn` (найдена в исходном проходе).

**Scope:**
1. Открыть статью через `curl -L` или `web_fetch`
2. Извлечь все 20 имён/брендов сервисов с кратким описанием
3. Для каждого: URL, описание, цена если есть, killer feature
4. Сравнить с нашим списком конкурентов — найти имена которых мы упустили в первом проходе
5. Ответить на вопрос: **«Какие 3-5 сервисов из TOP-20 наиболее опасны для ЛистAI и почему?»**

**Метод:**
- Brave search: `bash scripts/brave_search.sh 'site:vc.ru luchshie-neuroseti-dlya-sozdaniya-rabochikh-listov 2026' ru 5` (точные совпадения)
- Дополнительно: если статья не парсится, используй Brave поиск с разными формулировками

**Acceptance:**
- `.audit/competitors/2026-09-26-vc-ru-top20.md` создан
- 20 имён сервисов (или сколько удалось извлечь) с URL + описание
- TOP-3 самых опасных для ЛистAI с обоснованием
- Сравнение с текущим списком конкурентов (что упустили)

---

## Worker B — Вакансии Обучай + MagicSchool на hh.ru

**Источник:** `hh.ru` (поиск через Brave, не нужен API-ключ).

**Scope:**
1. **Обучай** — найти все открытые вакансии (`site:hh.ru obuchai` или прямой URL `hh.ru/employer/obuchai`)
2. **MagicSchool** (если есть в РФ) или **AI Суфлер / Jay Agents** (Just AI — конкурент в enterprise EdTech)
3. Для каждой вакансии:
   - Должность
   - Тип (sales/ML/продукт/маркетинг/и т.д.)
   - Что требуется
4. **Интерпретация:** куда они нанимают = куда идут
   - ML-вакансии = новые AI-фичи в разработке
   - Sales-вакансии = выход на новый рынок
   - Контент-вакансии = SEO/маркетинг приоритет
5. Сделать **выводы для ЛистAI** — где у нас есть форы, где они нас обгонят

**Метод:**
- Brave search: `bash scripts/brave_search.sh 'site:hh.ru obuchai 2026' ru 20`
- Brave search: `bash scripts/brave_search.sh 'site:hh.ru magicschool AI' ru 10`
- Brave search: `bash scripts/brave_search.sh 'site:hh.ru "AI суфлер" OR "Jay Agents" 2026' ru 10`

**Acceptance:**
- `.audit/competitors/2026-09-26-jobs-hh.md` создан
- Найдены вакансии Обучай (и других конкурентов если есть)
- Интерпретация «куда идут»
- 3-5 конкретных выводов для ЛистAI

---

## Worker C — Глубокий разбор Обучай через браузер

**Источник:** `https://obuchai.com/` (наш главный прямой конкурент в РФ).

**Scope:**
1. Зайти на главную, найти:
   - Текущие тарифы (если публикуют)
   - Какие типы заданий поддерживаются (70 по их утверждению)
   - Какие предметы и классы покрыты
2. Попробовать зарегистрироваться / войти:
   - Если есть magic link — описать процесс
   - Если paywall — описать что за paywall, что показывается после
3. **Если браузер зависает** (что было в прошлый раз) — fallback на curl + web_fetch
4. Сделать **скриншоты цен/тарифов** если получится (browser tool или curl HTML)
5. **Сравнение с ЛистAI** — где у нас преимущества

**Метод:**
- `curl -L https://obuchai.com/` → HTML
- `curl -L https://obuchai.com/about` → HTML
- `curl -L https://obuchai.com/blog/how-to-create-worksheet-with-ai` → HTML (нашли ранее)
- Дополнительно: Brave search с `bash scripts/brave_search.sh 'site:obuchai.com тарифы цена 2026' ru 10`
- Browser tool — пробовать, если зависает — пропустить с пометкой

**Acceptance:**
- `.audit/competitors/2026-09-26-obuchai-deep.md` создан
- Описание текущего состояния Обучай (функции, тарифы, контент)
- Сравнительная таблица «Обучай vs ЛистAI»
- Что они делают лучше нас, что мы делаем лучше них
- HTML/JSON снимки (если есть)

---

## Что НЕ делаем

- ❌ SimilarWeb — нетривиально, нет прямого доступа. Делаем отдельно если пользователь попросит.
- ❌ Обновление `docs/01-research-naming.md` — parent (Mavis) сделает после ваших отчётов.
- ❌ Правка кода проекта ЛистAI.
- ❌ Деплой.

---

## Формат каждого отчёта

```markdown
# <Тема отчёта>

**Дата:** 2026-09-26
**Источник:** <URL/Search query>
**Метод:** <curl/Brave/web_fetch>

## Что найдено
- <bullet>

## Сравнение с ЛистAI
- <bullet>

## Выводы / рекомендации
- <bullet с действием>

## Что НЕ удалось / ограничения
- <bullet>
```
