# Offline QA — генерация без Polza

Конвейер: **Gen → Judge → ТЗ → тесты+правки**. Живой Polza не нужен.

| Шаг | Промпт | Модель |
|---|---|---|
| 0. Оркестратор | [`docs/agents/PROMPT-quality-orchestrator.md`](../../agents/PROMPT-quality-orchestrator.md) | **Composer 2.5** |
| 1. Gen | [`docs/agents/PROMPT-quality-gen-offline.md`](../../agents/PROMPT-quality-gen-offline.md) | **Composer 2.5** (запасной: Fast) |
| 2. Judge | [`docs/agents/PROMPT-quality-judge.md`](../../agents/PROMPT-quality-judge.md) | **Grok 4.6 xhigh** (запасной: Grok 4.7 High Fast) |
| 3. ТЗ | `AGENT-PROMPT-2-DESIGNER.md` | Composer 2.5 |
| 4. Код | `AGENT-PROMPT-3-DEVELOPER.md` | Composer 2.5 |

Почему так: Gen и Judge — разные семьи. Один движок на оба шага склеивает слепые зоны.

Волна 1 (лист): артефакты в `wave1-worksheet/`, ТЗ `docs/tz/69-…overview` + `70`/`71`/`72`.
