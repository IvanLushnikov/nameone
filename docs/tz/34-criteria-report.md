# ТЗ-34: критерии оценивания в контрольной и тесте — отчёт реализации

**Дата:** 29 октября 2026
**Исполнитель:** Coder (ведущий инженер-продуктовик)
**ТЗ:** `docs/tz/34-evaluation-criteria.md`
**Ветка:** `feat/teacher-gaps-w1-criteria` (worktree `.worktrees/impl-criteria`, база — `feat/teacher-gaps-w1`, коммит `0425e3f`)

---

## 1. Что сделано

_(заполняется по ходу; сначала — план)_

### План (написан до кода)

| # | Файл | Что делаем | Где тест |
|---|------|-------------|-----------|
| 1 | `src/lib/content/grading.ts` (НОВЫЙ) | Пороги отметок 85/70/50/0, `markForPercent`, `marksScale`, стоп-лист общих формулировок, `isConcreteCriterion`, сборка `evaluation` из заданий | `tests/grading-criteria.test.ts` |
| 2 | `src/lib/content/task-types.ts` | Поле `weight` у `TaskTypeSpec` + значения всем 17 типам. Лимиты разнообразия и блок промпта — не трогаем | `tests/grading-criteria.test.ts`, `tests/task-type-registry.test.ts` (не правлю) |
| 3 | `backend/src/llm/prompts/worksheet-gen.ts` | Правило 17 переписано (критерии — в `criteria`, не в `answer`); блок `evaluation` (типичные ошибки + рекомендация) для control/test; требование «хотя бы одно задание с критериями» | `backend/tests/unit/tz34-criteria.test.ts` |
| 4 | `backend/src/llm/validation/quality-filter.ts` | (1) `requireAnswer` не выкидывает задание с `answerKind === "criteria"` и непустыми конкретными критериями; (2) чистка критериев (пустые и общие) с отчётом | `backend/tests/unit/tz34-criteria.test.ts` |
| 5 | `backend/src/llm/validation/type-diversity.ts` (НОВЫЙ) | Гистограмма типов, проверка против `diversityLimits`, выбор задания на замену | `backend/tests/unit/tz34-criteria.test.ts` |
| 6 | `backend/src/llm/index.ts` | Сборка `evaluation` в ответе; проверка разнообразия после генерации с заменой задания (≤2 попытки) и `quality.typeDiversityViolations` | `backend/tests/unit/tz34-criteria.test.ts` |
| 7 | `backend/src/types.ts`, `backend/src/routes/worksheets.ts`, `backend/src/lib/zod.ts` | Тип `EvaluationPart`, поле `evaluation` в ответе, схема контракта | `backend/tests/unit/tz34-criteria.test.ts` |
| 8 | `src/lib/types.ts`, `src/lib/client/llm.ts` | Тип `EvaluationPart` на фронте, приём `evaluation` из ответа | `tests/grading-criteria.test.ts` |
| 9 | `src/lib/utils/docx.ts` | Новая страница «Критерии оценивания» ПОСЛЕ ключа | `tests/tz34-criteria-print.test.ts` |
| 10 | `src/components/constructor/WorksheetPreview.tsx`, `src/app/constructor/page.tsx` | Блок критериев в превью, передача `evaluation` в печать и превью | `tests/tz34-criteria-print.test.ts` |

---

## 2. Как проверено

_(заполняется)_

---

## 3. Живая проверка

_(заполняется)_

---

## 4. Что не удалось доказать

_(заполняется)_

---

## 5. Что сломалось по ходу

_(заполняется)_

---

## 6. Пакет вопросов

_(заполняется)_

---

## 7. `git status --short` и коммиты

_(заполняется)_
