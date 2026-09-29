# LLM Architecture — РабочиеЛисты AI

> Сделано: 2026-09-25. Актуальный стек моделей на конец сентября 2026 (см. web-поиск по cutting-edge).

## 1. Роли моделей

| # | Роль | Модель | Цена in/out ($/1M) | Когда зовём | Fallback |
|---|---|---|---|---|---|
| 1 | **Generator** (primary) | `gpt-6-luna` | $0.10 / $0.50 | 95% генераций листов | `gpt-6-sol` |
| 2 | **Generator-Boost** | `gpt-6-sol` | $2 / $10 | Если Luna вернула `confidence < 0.7` или есть JSON-ошибка | `claude-opus-5-5` |
| 3 | **Premium** | `claude-opus-5-5` | $4 / $20 + cache $0.20 | Подписка Pro, 10-11 класс, ЕГЭ/ОГЭ-варианты. System prompt кэшируется | — |
| 4 | **Validator** | `deepseek-v4-flash` | $0.14 / $0.28 | После генерации: дубли, корректность ответов, ФГОС-соответствие | — |
| 5 | **Embeddings** | `qwen3-embedding-8b` или `text-embedding-3-large` | дёшево | Поиск похожих листов, дедупликация, рекомендации | — |

**Будущее (не подключаем на старте):**
- Vision для распознавания рукописных работ (`gemini-3.6-flash`)
- Локализация на СНГ-языки
- Мультимодальный preview

## 2. Routing-логика

```
request → router.pick(task, plan)
  ├── task = "worksheet-gen" + plan in [free, base]
  │     → GPT-6 Luna (1 попытка)
  │     → если parse-fail или low-confidence → GPT-6 Sol
  │
  ├── task = "worksheet-gen" + plan = "plus"
  │     → Claude Opus 5.5 с cache (system prompt ФГОС кэшируется)
  │
  ├── task = "validate" (всегда)
  │     → DeepSeek V4 Flash
  │
  ├── task = "embed"
  │     → Qwen3 / OpenAI embeddings
  │
  └── task = "preview-fast"
        → Mercury 2.5 (опционально, если нужна live-печать)
```

## 3. Стоимость (10 000 листов/мес)

Тарифы polza.ai (актуально 2026-09-27, https://polza.ai/models). Конвертация ~85 ₽/$.

| Этап | Модель | Тариф ($/1M in/out) | Ср. токенов на лист | Стоимость на 10k |
|---|---|---|---|---|
| Генерация | GPT-6 Luna (`openai/gpt-6-luna`) | 0.07 / 0.35 | ~3k in + 2k out | **$9.10** |
| Boost (5% случаев) | GPT-6 Sol (`openai/gpt-6-sol`) | 1.39 / 6.95 | ~3k in + 2k out | $1.74 |
| Валидация | DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) | 0.065 / 0.13 | ~3k in + 0.5k out | **$2.60** |
| Embeddings | Qwen3-Emb 8B (`qwen/qwen3-embedding-8b`) | $0 (open-weight) | 200 tok in | **$0** |
| **Итого** (free/base) | | | | **~$13.50/мес** |

Если 30% юзеров — Plus (Claude Opus 5.5 с cache):
- Plus-генерация: ~3k in + 2k out × $5.56 / $27.80 × 3000 = $217
- Cache reads на system prompt (повторяется): $0.28 × 1M = $0.28
- Итого: ~**$220/мес** при 10k генераций (30% на Plus).

Сравнение с предыдущей версией (прямые ключи):
- Было: ~$18.50/мес на free/base
- Стало: ~$13.50/мес на free/base
- **Экономия ×1.4 на free/base**. По Plus чуть дороже (Opus на polza +39%), но это маржа ресейлера, которую окупает единый счёт в ₽ и ФЗ-152.

## 4. Кэш и fallback chain

- **System prompt кэш**: Claude Opus 5.5 даёт prompt caching. System prompt с правилами ФГОС (~3-5k токенов) кэшируется, повторные запросы берут из кэша за $0.20/1M вместо $4/1M.
- **Semantic cache** (наш собственный): кэш по `(subject, grade, topic, difficulty, count, type)` — если запрашивается популярная тема (например «Площадь треугольника, 5 класс»), выдаём из кэша. TTL 30 дней.
- **Retry chain**: Luna → Sol → Opus. Если 2 подряд timeout/error — падаем в mock + 200 OK с пометкой `cached: false, generation: 'fallback-mock'`.

## 5. Провайдеры и ключи

> Обновлено 2026-09-27 — **polza.ai единственный провайдер** для РабочиеЛисты AI. Прямые ключи OpenAI/Anthropic/DeepSeek/DashScope/OpenRouter больше не используются.

| Провайдер | Переменная | Где взять | Статус |
|---|---|---|---|
| **Polza.ai** | `POLZA_API_KEY` | app.polza.ai → API | **Единственный** |

### Зачем polza

- Один ключ `POLZA_API_KEY` покрывает все нужные модели — `openai/gpt-6-luna`, `openai/gpt-6-sol`, `anthropic/claude-opus-5.5`, `deepseek/deepseek-v4-flash`, `qwen/qwen3-embedding-8b`, `openai/text-embedding-3-large` и др. (см. https://polza.ai/models).
- OpenAI-совместимый API (база `https://polza.ai/api/v1`), коннектор через `openai` SDK — `backend/src/llm/providers/polza.ts`.
- Оплата в ₽: счёт/безнал для юрлиц, ФЗ-152-совместимые провайдеры помечены `is_fz152_compliant: true` в каталоге polza.
- Без VPN из РФ.

### Роутинг

См. `backend/src/llm/router.ts` → `pickModel`. Polza = единственный путь, без fallback chain:

- Чат-генерация (worksheet-gen / exam-gen, free/base): **gpt-6-luna → gpt-6-sol**
- Чат-генерация (worksheet-gen / exam-gen, plus): **claude-opus-5.5** (с prompt cache)
- Валидация: **deepseek-v4-flash** (5.54 ₽/11.08 ₽ за 1M — самый дешёвый валидатор)
- Эмбеддинги: **qwen3-embedding-8b → text-embedding-3-large** (fallback внутри polza, если qwen3-embedding-8b не доступен на аккаунте)

Без `POLZA_API_KEY` → primary = null → routes должен fallback на локальный mock или вернуть 503.

### Прямые ключи больше не нужны

`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` оставлены в типе `Env` как опциональные поля для совместимости с существующим кодом, но **в роутинге не используются**. Их можно удалить из `wrangler secret list` если они там остались.

## 6. Защита

- API-ключи только в `.env.local`, никогда в коде.
- Лимиты на юзера в `src/lib/utils/limit.ts` (уже есть).
- Логирование: prompt + response + cost в таблицу `llm_logs` для аналитики.
- Модерация входящего промпта (простая regex + GPT-6 Luna mini-pass) — защита от мусора и prompt injection.

## 7. Метрики качества (что смотрим в проде)

- **JSON validity rate**: % генераций, прошедших schema-validation. Target: >99%.
- **Duplicate-task rate**: % листов, где validator нашёл дубли. Target: <1%.
- **Answer correctness** (на выборке): глазами учителя. Target: >95%.
- **Latency p95**: <8 секунд на лист (Luna) / <15 секунд (Opus).
- **Cost per generation**: <$0.005 средний.
