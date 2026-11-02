# Offline QA волна 1 — отчёт разработчика

**Ветка:** `feat/offline-qa-wave1-70-72-71`  
**Дата:** 2026-11-02  
**ТЗ:** 70 → 72 → 71 (обзор `69-offline-qa-wave1-overview.md`)

---

## 1. Что сделано

| Файл | Суть |
|---|---|
| `src/lib/content/task-types.ts` | У `matching`: `needsLetterLabelsInText`, уточнён `whatTeacherAsks` (левая колонка с а/б/в в text, правая в items). |
| `backend/src/llm/validation/quality-filter.ts` | Проверка `matching-without-right-column` по флагу реестра; ТЗ-72: `looksLikeLetterCountingTask`, вызов `passesLanguageGuard` в `filterTasks`, дроп «сколько букв» вне языковых предметов. |
| `backend/src/llm/cache.ts` | `FORMAT_VERSION`: 2 → **3** (ТЗ-70). |
| `backend/src/llm/validation/language-guard.ts` | `hasMixedScriptToken`, отказ в `passesLanguageGuard` для смешанного скрипта в токене (не foreign subjects). |
| `backend/tests/unit/quality-filter-matching.test.ts` | T-2, T-3, промпт-блок matching (новый файл). |
| `backend/tests/unit/language-guard.test.ts` | T-1 (biology / english). |
| `src/components/constructor/WorksheetPreview.tsx` | Ключ: «Критерии:» + список; при `answer: null` и непустых `criteria` нет одинокого «Ответ: —». |
| `tests/preview-criteria-key.test.tsx` | T-4 (новый файл). |

---

## 2. План (выполнен)

1. Ветка от `origin/main`, порядок 70 → 72 → 71.  
2. На каждое ТЗ: assert до фикса → правка → assert после.  
3. Vitest бэка с `@cloudflare/vitest-plugin` **зависал без вывода** (>90 с); доказательства — **tsx-harness** (см. ниже).  
4. Тесты в репозитории добавлены для CI/локального прогона, когда workerd стартует.

---

## 3. Как проверено

### 3.1. До фикса (tsx, старый код — только harness TZ-70)

```text
$ cd backend && npx tsx -e "… checkTaskTypeRequirements(bad) …"
TZ70 bad check: null
TZ70 good check: null
TZ70 filter kept: 2 droppedTypeMismatch: []
```

### 3.2. После фикса (tsx, `/tmp/wave1-harness.mts`)

```text
=== AFTER FIX ===
FORMAT_VERSION 3
TZ70 bad matching-without-right-column
TZ70 good null
TZ70 filter kept 1 dropped [ 2 ]
TZ70 prompt metki true
TZ72 lang biology false
TZ72 lang english true
TZ72 letter true
TZ72 bio kept 1
TZ72 rus kept 1
```

**Уточнение TZ-72 «сколько букв»:** при одном задании в массиве срабатывает **откат** фильтра (`kept.length === 0` → rollback). На листе из 6 заданий (5 норм + letter-count) — корректный дроп:

```text
kept 5 droppedForeignMath [ 6 ] rolledBack false
```

### 3.3. Vitest

| Команда | Результат |
|---|---|
| `backend`: `vitest run tests/unit/quality-filter-matching.test.ts` | Зависание без stdout (>90 с), процессы убиты (`pkill vitest/workerd`). |
| корень: `vitest run tests/preview-criteria-key.test.tsx` | Зависание / exit 137, без вывода. |

**Не гоняли:** полный `npm run build`, полный фронтовый набор, Polza (по ТЗ).

### 3.4. Живая проверка

Не выполнялась: ветка не в `main`, воркер на бою — старая версия. ТЗ-70/72 меняют пост-валидацию и user-блок типов (кэш v3); ТЗ-71 — только превью.

---

## 4. Критерии приёмки (сверка)

| ТЗ | Критерий | Статус |
|---|---|---|
| 70 | W2 matching → `matching-without-right-column`, `droppedTypeMismatch` | harness + тест |
| 70 | Good matching → `null` | harness |
| 70 | `FORMAT_VERSION` поднят | 3 |
| 70 | Промпт-блок matching про метки | harness `metki true` |
| 72 | `passesLanguageGuard` biology + оргanelлу → false | harness |
| 72 | english + mixed token → true | harness |
| 72 | «Сколько букв» biology не в kept (лист ≥4 заданий) | harness 5+1 |
| 72 | То же на `russian` — не режем | harness |
| 72 | Worksheet path вызывает guard | `filterTasks` |
| 71 | Превью показывает criteria, не один «—» | код + `preview-criteria-key.test.tsx` (vitest не прогнан) |
| 71 | Обычный answer без criteria — как раньше | тест в файле |

---

## 5. Что не удалось доказать

- Прогон **vitest** (бэк и фронт) в этой среде — зависание workerd/oxc без логов.  
- **Живой** generate после выката.  
- **next dev** / скрин превью (как в ТЗ-71 §8).

---

## 6. Что сломалось по ходу

- Regex `MATCHING_LABEL_MARKER`: в JS `\:` в классе символов → `SyntaxError: Invalid escape`. Исправлено на `[)\].:—–-]`.  
- Vitest/workerd — повторные зависания; обход через tsx.

---

## 7. Вопросы владельцу

1. **Откат фильтра** при единственном «сколько букв» в листе из 1–2 заданий возвращает задание обратно — осознанное поведение или сужать rollback для `droppedForeignMath`?  
   - A) Оставить как есть  
   - B) Не откатывать при language/letter-count дропах  

---

## 8. Git

См. коммиты на ветке после `git log --oneline feat/offline-qa-wave1-70-72-71`.

```bash
git status --short
```

(только файлы волны должны быть в коммите; `docs/qa/` и прочие untracked — не включать.)
