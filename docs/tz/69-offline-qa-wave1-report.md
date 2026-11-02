# Offline QA волна 1 — отчёт разработчика

**Ветка:** `feat/offline-qa-wave1-70-72-71` (от `origin/main` @ `14a1b6b`)  
**Дата:** 2026-11-02  
**ТЗ:** 70 → 72 → 71

---

## 1. Что сделано

| Файл | Суть |
|---|---|
| `src/lib/content/task-types.ts` | У `matching`: `needsLetterLabelsInText`, уточнён `whatTeacherAsks` (левая колонка с а/б/в в text, правая в items). |
| `backend/src/llm/validation/quality-filter.ts` | Проверка `matching-without-right-column`; `looksLikeLetterCountingTask`; в `filterTasks` — language guard на text+options и отсечка «сколько букв» вне allowlist предметов. |
| `backend/src/llm/validation/language-guard.ts` | `hasMixedScriptToken`; `passesLanguageGuard` режет смешанный скрипт даже в коротком тексте. |
| `backend/src/llm/cache.ts` | `FORMAT_VERSION`: **2 → 3** (ТЗ-70, смена блока типов в user-промпте через реестр). |
| `backend/tests/unit/quality-filter-matching.test.ts` | T-2, T-3 (новый файл). |
| `backend/tests/unit/language-guard.test.ts` | T-1 (кейсы ТЗ-72). |
| `src/components/constructor/WorksheetPreview.tsx` | Ключ: блок «Критерии:» из `task.criteria`; без answer и с criteria — не рисуем один «Ответ: —». |
| `tests/preview-criteria-key.test.tsx` | T-4 (новый файл). |

---

## 2. План (до кода)

1. ТЗ-70: тест matching → эвристики в `checkTaskTypeRequirements` + флаг реестра → `FORMAT_VERSION += 1`.  
2. ТЗ-72: тесты language-guard + letter-count → guard + `filterTasks` на worksheet-path.  
3. ТЗ-71: component-тест превью → правка блока ключа в `WorksheetPreview`.

---

## 3. Как проверено

### 3.1. Правило «до — падает»

На снимке `origin/main` (временная подмена файлов + `tsx`):

```
OLD TZ70 null                    # было: matching проходил
OLD TZ72 fn missing              # looksLikeLetterCountingTask не существовал
OLD TZ72 mixed true              # оргanelлу + ribosoma на biology проходило
```

На новом коде (`npx tsx`, backend):

```
TZ70 bad matching-without-right-column
TZ70 good null
TZ70 drop [ 2 ]
TZ72 looks true
TZ72 bio kept 5 drop [ 6 ]
TZ72 rus kept 1
TZ72 mixed bio false
TZ72 mixed eng true
```

ТЗ-71 на `main`: ключ всегда `task.answer ?? "—"`. На новом коде — criteria в списке, строка «Ответ: —» только если нет ни answer, ни criteria (см. тест `preview-criteria-key.test.tsx`).

### 3.2. Vitest

В среде исполнения агента `vitest run` (backend `@cloudflare/vitest-plugin` и корневой набор) **не выдал вывод за 3–5 минут** — процесс висел на старте без stdout. Точечная логика подтверждена `tsx`-прогоном выше; файлы тестов добавлены по черновикам T-1…T-4.

**Ожидаемые команды у судьи (Node 22):**

```bash
cd backend && ./node_modules/.bin/vitest run tests/unit/quality-filter-matching.test.ts tests/unit/language-guard.test.ts
cd .. && npx vitest run tests/preview-criteria-key.test.tsx
cd backend && ./node_modules/.bin/vitest run tests/unit/cache-format-version.test.ts
```

`FORMAT_VERSION` в коде: **3** (было 2). `PROMPT_HASH` system-промпта не менялся — менялся только user-блок типов из реестра.

### 3.3. Typecheck / lint

`npm run typecheck` в backend и корне в той же среде **не завершился за 120 с** (нет вывода). Рекомендуется прогон у владельца перед мержем.

---

## 4. Живая проверка

Не выполнялась: волна офлайн, Polza не вызывалась; ветка не в `main` — боевой воркер показывал бы старое поведение.

---

## 5. Что не удалось доказать

- Полный зелёный vitest/typecheck в среде агента (зависание workerd/CLI без логов).  
- Поведение модели на новом `whatTeacherAsks` для matching — только после выката.  
- `next dev` / скрин превью (как в ТЗ-71 §8).

---

## 6. Что сломалось по ходу

- При доказательстве «старого кода» временно подменялись `quality-filter.ts` / `language-guard.ts`; восстановлены из `/tmp/qf-new.ts`, `/tmp/lg-new.ts`.

---

## 7. Вопросы владельцу

1. **Vitest в CI:** если локально у агента workerd зависает, достаточно ли для приёмки волны `tsx`-smoke + CI на GitHub?  
   - A) Да, CI — истина  
   - B) Нет, нужен локальный полный vitest перед мержем  

---

## 8. `git status --short` (только файлы волны)

```
 M backend/src/llm/cache.ts
 M backend/src/llm/validation/language-guard.ts
 M backend/src/llm/validation/quality-filter.ts
 M backend/tests/unit/language-guard.test.ts
 M src/components/constructor/WorksheetPreview.tsx
 M src/lib/content/task-types.ts
?? backend/tests/unit/quality-filter-matching.test.ts
?? tests/preview-criteria-key.test.tsx
?? docs/tz/69-offline-qa-wave1-report.md
```

Прочие `?? docs/agents/PROMPT-*`, `docs/qa/`, ТЗ markdown — **не входят в коммит волны** (исследование/орchestrator, не код).
