# Gates: видимость функционала — 3 правки навигации

OWNS: src/app/constructor/page.tsx, src/components/constructor/ArtifactTypePicker.tsx,
src/app/dashboard/page.tsx, src/components/lk/*.tsx, GATES-discoverability.md

Scope: решение владельца 15.10.2026 — функционал есть, но о нём нельзя узнать без подсказки.
Три правки: (1) полный выбор типа материала виден на первом шаге генератора, (2) в кабинете
есть вход в интерактивы, (3) пустой кабинет объясняет, что он умеет.

## Правка 1 · Выбор типа материала на первом шаге

- [ ] G1: Тип выбирается до выбора предмета — учитель видит 10 типов, не проходя шаги
  CHECK: npx vitest run tests/integration/step1-type-picker.test.tsx
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

- [ ] G2: Пикер на шаге 1 и на шаге «Параметры» показывают один и тот же выбранный тип
  CHECK: npx vitest run tests/integration/step1-type-picker.test.tsx
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

- [ ] G3: Ручная смена типа на шаге 1 снимает блокировку пресета — иначе тип «не меняется»
  CHECK: npx vitest run tests/integration/step1-type-picker.test.tsx
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

## Правка 2 · Интерактивы в кабинете

- [ ] G4: На главной карточке кабинета есть вход в /dashboard/interactives
  CHECK: npx vitest run tests/dashboard-discoverability.test.tsx
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

- [ ] G5: Карточка показывается и анонимному учителю, и залогиненному
  CHECK: npx vitest run tests/dashboard-discoverability.test.tsx
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

## Правка 3 · Пустой кабинет объясняет себя

- [ ] G6: При нуле листов кабинет показывает карточки возможностей, а не пустые счётчики
  CHECK: npx vitest run tests/dashboard-discoverability.test.tsx
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

- [ ] G7: Каждая карточка ведёт в рабочее место — мёртвых ссылок нет
  CHECK: sh -c 'for p in dashboard/interactives journal constructor; do curl -s -o /dev/null -w "%{http_code} $p\n" http://127.0.0.1:8777/$p/; done'
  EXPECT: 200 на все три
  EVIDENCE: выполнено 15.10.2026

## Общие

- [ ] G8: Типы, линт и тесты проекта не поехали
  CHECK: sh -c 'npx tsc --noEmit >/dev/null 2>&1 && npm run lint >/dev/null 2>&1 && echo TYPES_AND_LINT_OK'
  EXPECT: TYPES_AND_LINT_OK
  EVIDENCE: выполнено 15.10.2026

- [ ] G9: Весь набор тестов зелёный
  CHECK: npm test
  EXPECT: Tests passed
  EVIDENCE: выполнено 15.10.2026

## Найдено по ходу и НЕ в скоупе

- [ ] НАБЛЮДЕНИЕ 1: план урока, презентация и КТП закрыты тарифом «Плюс».
  На первом шаге это теперь видно сразу (значок замка). Это решение владельца
  по тарифам, а не навигации — здесь не трогаем.
- [ ] НАБЛЮДЕНИЕ 2: группы «К уроку» и «На период» свёрнуты по дизайн-решению
  (сделано до 15.10). На первом шаге группа с одной видимой кнопкой выглядит
  недодельтанно. Менять свёрнутость без решения владельца не стали.

## Помехи

- `npm run build` и `tsc --noEmit` падают на чужом незавершённом файле
  `src/lib/content/grade-extensions/fgos-program.ts` (нет `fgos-program/data.json`,
  файл не подключён в index.ts). Не связан с этими правками, не трогали.
  Из-за него же падает один тест: `taxonomy-completeness` — «все файлы
  расширений подключены к GRADE_EXTENSIONS». Остальные 1208 тестов зелёные.

## ТЗ-32 · Видимость и честные тексты (реализовано 16.10.2026)

Источник: docs/tz/31-review-findings-source.md → ТЗ docs/tz/32-discoverability-and-honest-texts.md

- [x] G11: номера заданий ставит сервер, после фильтра — Бэкенд, 15 тестов
- [x] G12: пустой ключ эссе считается и виден учителю до скачивания — Бэкенд + фронт
- [x] G13: тариф написан на кнопке закрытого формата, не в подсказке — Фронт
- [x] G14: группы «К уроку» и «На период» раскрыты, сворачивание сохранено — Фронт
- [x] G15: тексты не обещают закрытые форматы без упоминания «Плюс» — Фронт
- [x] G16: llms-файлы и описание сайта не расходятся с живой квотой — Фронт
- [x] G17: плитка «С нами» убрана, сетка без пустот — Фронт
- [x] G18: гостю в шапке доступен вход в кабинет без регистрации — Фронт
- [x] G19: счётчик форматов показывает, сколько из них закрыто тарифом — Фронт
- [x] G20: кликовый путь на 1440×900 и 1920×1080 — проверено в браузере вручную

Проверки: фронт 1306 тестов из 1306, бэкенд 1070 из 1070, tsc без ошибок, lint без ошибок,
scripts/check-llms-txt.mjs — exit 0.
