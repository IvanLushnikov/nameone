# Черновики тестов — offline QA волна 1 (worksheet)

Дата: 2026-11-02
Правило приёмки для Developer: каждый новый тест падает на старом коде и зелёный на новом.

Источник фикстур: `docs/qa/offline-gen/wave1-worksheet/<ID>/response.json`.

## P0

### T-1 ← N1
Файл (предложение): `backend/tests/unit/language-guard.test.ts`
Сейчас на старом коде: должен ПАДАТЬ, потому что `passesLanguageGuard("Выберите оргanelлу… ribosoma", "biology")` возвращает true: доля латиницы по всему тексту ниже 30 %.
На новом: зелёный, потому что смешанный скрипт внутри одного токена (`оргanelлу`, `ribosoma`) на русскоязычном предмете — отказ.
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W2/response.json` задания 2, поля `text` и `options[2]`.

### T-2 ← N2
Файл (предложение): `backend/tests/unit/quality-filter.test.ts` (рядом с `checkTaskTypeRequirements`)
Сейчас на старом коде: должен ПАДАТЬ, потому что `checkTaskTypeRequirements` для `matching` требует только непустой `items` и пропускает ответ «1-в, 2-б, 3-а» без второй колонки.
На новом: зелёный, потому что matching без правой колонки в `items` или в тексте (нет пар «а/б/в» или второго списка) возвращает `matching-without-right-column`.
Фикстура: вырезанный JSON W2 задания 3:

```json
{
  "type": "matching",
  "text": "Установите соответствие между органоидом и функцией.",
  "items": ["1) ядро", "2) митохондрия", "3) клеточная стенка"],
  "answer": "1-в, 2-б, 3-а"
}
```

Второй кейс: W3 задание 5 (`docs/qa/offline-gen/wave1-worksheet/W3/response.json`).

### T-3 ← N3
Файл (предложение): `backend/tests/unit/quality-filter.test.ts`
Сейчас на старом коде: должен ПАДАТЬ, потому что фильтр чужого предмета не ловит «сколько букв» на биологии: правило 9 живёт только в промпте.
На новом: зелёный, потому что текст задания с «сколько букв» при `subject: biology` даёт дефект чужого предмета.
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W2/response.json` задание 11 (`text`: «Сколько букв «о» в слове «хлоропласт»?»).

### T-4 ← N4
Файл (предложение): `tests/tz34-student-export.test.tsx`
Сейчас на старом коде: должен ПАДАТЬ, потому что `WorksheetPreview` с `withAnswers` рендерит `task.answer ?? "—"` и не читает `task.criteria`; страница `evaluation` пустая, если проп не передали.
На новом: зелёный, потому что в ключе виден текст хотя бы одного критерия задания (`getByText` / роль).
Фикстура: минимальный лист с одним `open-ended`:

```json
{
  "id": "qa-criteria",
  "title": "Тест критериев",
  "subject": "math",
  "grade": 5,
  "topic": "Обыкновенные дроби",
  "difficulty": "medium",
  "createdAt": "2026-11-02T00:00:00.000Z",
  "tasks": [{
    "number": 11,
    "text": "Объясните, что показывает знаменатель дроби.",
    "type": "open-ended",
    "answer": null,
    "criteria": [
      "Называет, что знаменатель показывает, на сколько равных частей разделили целое",
      "Приводит пример с дробью из темы"
    ],
    "points": 2
  }]
}
```

Или целиком `docs/qa/offline-gen/wave1-worksheet/W1/response.json` задание 11.

## P1

### T-5 ← N5
Файл (предложение): `backend/tests/unit/quality-filter.test.ts`
Сейчас на старом коде: должен ПАДАТЬ, потому что правило 13 про смешанные числа есть в промпте и не проверяется кодом после генерации.
На новом: зелёный, потому что при `grade < 6` текст/ответ вида `2 1/4` или фраза «смешанного числа» даёт дефект «понятие не по классу».
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W6c/response.json` задание 11 (`text` + `answer`: «2 1/4»).

### T-6 ← N6
Файл (предложение): `backend/tests/unit/quality-filter.test.ts` (расширить `hasDanglingPatternRef` или соседнюю функцию)
Сейчас на старом коде: должен ПАДАТЬ, потому что висячая ссылка ловит «по образцу» без `sample`, а «координатной прямой» / «по рисунку» без `chart_spec` не ловит.
На новом: зелёный, потому что «отметьте на координатной прямой» без `chart_spec` и без таблицы-рисунка — дефект ссылки на отсутствующее.
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W6a/response.json` задание 5.

### T-7 ← N7
Файл (предложение): `tests/taxonomy-topic-mix.test.ts` (новый, `--environment node`)
Сейчас на старом коде: должен ПАДАТЬ, потому что сверки «задание про медуз / митоз в теме клеточного строения 5 класса» в тестах нет.
На новом: зелёный, потому что нормализованный текст задания 12 W2 совпадает с примером другой темы (`subjects.ts`, медузы) и помечается как чужая тема; митоз/хромосомы при теме `kletochnoe-stroenie` — понятие старше класса темы.
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W2/response.json` задания 5, 6, 12; эталон примеров `src/lib/content/subjects.ts:3559` и `:3624`.

### T-8 ← N8
Файл (предложение): `backend/tests/unit/quality-filter.test.ts` или `backend/tests/unit/language-guard.test.ts`
Сейчас на старом коде: должен ПАДАТЬ, потому что правило 15 не проверяется кодом: explanation «To he adds -s on the verb» проходит.
На новом: зелёный, потому что на `english` пояснение с шаблоном «to he adds -s» / «к he добавляется» — дефект.
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W3/response.json` задание 1, поле `explanation`.

### T-9 ← N9
Файл (предложение): `tests/w4-participle-fixture.test.ts` (новый, `--environment node`)
Сейчас на старом коде: должен ПАДАТЬ, потому что автопроверки «свежий — не причастие» и предлога «о/об» перед «осеннем» нет.
На новом: зелёный, потому что задание с леммой «свежий» в листе темы «Причастие» помечается как чужая орфограмма; «о осеннем» — грамматический дефект.
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W4/response.json` задания 6 и 9.

### T-10 ← N10
Файл (предложение): `tests/w1-fraction-explanation.test.ts` (новый, `--environment node`)
Сейчас на старом коде: должен ПАДАТЬ, потому что пояснение с «7,5/15» не отбраковывается.
На новом: зелёный, потому что в explanation задания 5 класса по обыкновенным дробям запрещён числитель с запятой (`/\d+[.,]\d+\s*\/\s*\d+/`).
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W1/response.json` задание 3, поле `explanation`.

### T-11 ← N11
Файл (предложение): `tests/tz34-criteria-print.test.ts` и/или `tests/tz34-student-export.test.tsx`
Сейчас на старом коде: должен ПАДАТЬ, потому что превью рендерит `{task.points} б.`, DOCX — `task.points` в строке ответа, а `taskMaxPoints` считает вес типа.
На новом: зелёный, потому что на экране и в печати для `type: "computation"` стоит 2, даже если модель прислала `points: 1`.
Фикстура: задание W1 №1 (`type: computation`, `points: 1`) из `docs/qa/offline-gen/wave1-worksheet/W1/response.json`.

### T-12 ← N12
Файл (предложение): `tests/tz34-student-export.test.tsx`
Сейчас на старом коде: должен ПАДАТЬ, потому что маркер варианта всегда `rounded-full`, тип `multi-answer` не отличается от `multiple-choice`.
На новом: зелёный, потому что у `multi-answer` маркер квадратный (или роль checkbox), у `multiple-choice` — круг.
Фикстура: W1 задание 10 (`docs/qa/offline-gen/wave1-worksheet/W1/response.json`).

### T-13 ← N13
Файл (предложение): `backend/tests/unit/template-shape.test.ts` (новый)
Сейчас на старом коде: должен ПАДАТЬ, потому что детектора «error-fixing сложения с общим знаменателем, ошибка в знаменателе» по трём прогонам нет.
На новом: зелёный, потому что нормализованная форма трёх заданий (W1 №8, W6b №9, W6c №9) считается одной серией.
Фикстура: три `response.json` волны, только поля `type` + нормализованный `text` error-fixing.

### T-14 ← N14
Файл (предложение): `backend/tests/unit/quality-filter.test.ts`
Сейчас на старом коде: должен ПАДАТЬ, потому что правило 12 про приборы не проверяется: practical с «микроскоп» и «препарат» проходит.
На новом: зелёный, потому что `type: practical` + маркеры прибора без явной пометки кабинета даёт дефект «нерешаемо без оборудования».
Фикстура: `docs/qa/offline-gen/wave1-worksheet/W2/response.json` задание 10.
