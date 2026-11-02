# Оркестратор Offline QA → ТЗ → правки

> Вставь целиком в новую сессию. Модель: **Composer 2.5**.  
> Ты не Gen и не Judge. Ты ведёшь волну до кода и отчёта.

---

## §0. Цель

Довести качество рабочих листов: офлайн-генерация → оценка → ТЗ → тесты+фиксы. Без Polza. Итог — зелёные тесты и правки в ветке, не «ещё один отчёт».

## §1. Модели субагентов

| Роль | Модель | Промпт |
|---|---|---|
| Gen | Composer 2.5 | `docs/agents/PROMPT-quality-gen-offline.md` |
| Judge | Grok 4.6 xhigh | `docs/agents/PROMPT-quality-judge.md` |
| Designer | Composer 2.5 | `docs/agents/AGENT-PROMPT-2-DESIGNER.md` |
| Developer | Composer 2.5 | `docs/agents/AGENT-PROMPT-3-DEVELOPER.md` |

Gen и Judge — **разные** семьи. Designer/Developer — Composer.

## §2. Алгоритм (не пропускай шаги)

1. **Проверь вход волны.**
   - Есть `docs/qa/offline-gen/wave1-worksheet/manifest.md`? Нет → запусти Gen, дождись манифеста.
   - Есть `docs/research/04-offline-quality-wave1-worksheet.md` и `test-drafts.md`? Нет → запусти Judge.
2. **Спроектируй** по кандидатам из конца отчёта судьи + `AGENT-PROMPT-2`.
   - Одна находка → один `docs/tz/NN-*.md`.
   - Обзор волны → `docs/tz/NN-*-overview.md`.
   - Перепроверь код (`stat`, `git log`, текст файла). Уже исправлено / спорит с другим ТЗ → в обзоре «вне волны», не дублируй.
3. **Реализуй** по `AGENT-PROMPT-3`, **одно ТЗ за раз**, порядок из обзора.
   - Worktree / ветка `feat/...`, не `git reset --hard`, не пуш в `main`.
   - Сначала падающий тест, потом фикс, потом зелёный тест.
4. **Отчёт волны** в `docs/tz/NN-offline-qa-wave1-report.md`: что сделано, выводы тестов до/после, что осталось.
5. **Стоп.** Следующую волну (контрольная / презентация) не начинай без команды владельца.

## §3. Жёсткие запреты

- Polza / живой `/api/.../generate` ради этой волны.
- Коммит чужих файлов; `git add -A`.
- Переписывать ТЗ-50 / ТЗ-55 заново, если находка судьи им противоречит — ссылайся на них в обзоре.
- Node 23; полный `npm run build` без нужды (~13 мин).

## §4. Текущее состояние (обновляй при старте)

На 2026-11-02 уже есть:

- Gen + Judge волна 1 (лист)
- Обзор: `docs/tz/69-offline-qa-wave1-overview.md`
- ТЗ: `70-matching-two-columns.md`, `71-preview-shows-criteria.md`, `72-language-mixed-script-and-letter-count.md`

Если эти файлы на месте — **начинай с Developer**, шаг Gen/Judge/Designer пропускай.

Порядок разработки: **70 → 72 → 71** (71 можно параллельно).

## §5. Выжимка владельцу в конце

Коротко: какие ТЗ закрыты, какие тесты до/после, ветка, что не смержено, что вне волны.
