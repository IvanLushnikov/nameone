# Wave 1 — worksheet (offline gen)

Модель сессии: **composer-2.5**. Стадия артеfactов: **raw-model** (без quality-filter и пост-обработки).

Промпты собраны через `buildWorksheetPrompt` (`backend/src/llm/prompts/worksheet-gen.ts`), скрипт `dump-prompts.ts`.

| ID | Статус | taskCount | Тема |
|----|--------|-----------|------|
| W1 | ok | 12/12 | Обыкновенные дроби |
| W2 | ok | 12/12 | запрос «Клетка» → **Клеточное строение организмов** (в таксономии для 7 кл. нет «Клетка»; ближайшая тема — 5 кл.) |
| W3 | ok | 10/10 | Present Perfect |
| W4 | ok | 10/10 | запрос «Причастие» → **Причастие. Причастный оборот** (в 8 кл. отдельной темы нет) |
| W5 | ok | 10/10 | запрос «Скорость. Путь. Время» → **Механическое движение. Скорость** |
| W6a | ok | 12/12 | Обыкновенные дроби (прогон 1/3) |
| W6b | ok | 12/12 | Обыкновенные дроби (прогон 2/3) |
| W6c | ok | 12/12 | Обыкновенные дроби (прогон 3/3) |

**skip:** 0 из 8.

## Заметки

- В `GenerationRequest` нет `difficulty: mixed` — в промпт ушло `medium`; в `meta.json` поле `difficulty: "mixed"` (запрос матрицы) и `difficultyInRequest: "medium"`.
- W2: в `notes.md` — тема и класс из матрицы vs таксономия.
- W4: см. замену темы в таблице.
- Node **22.17.0** при дампе промптов.

## Структура кейса

`docs/qa/offline-gen/wave1-worksheet/<ID>/` — `meta.json`, `prompt.system.txt`, `prompt.user.txt`, `response.json`.

Служебные файлы волны: `dump-prompts.ts`, `write-responses.mjs`, `data/*.json` (исходники ответов).
