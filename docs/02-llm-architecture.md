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

| Этап | Модель | Ср. токенов на лист | Стоимость на 10k |
|---|---|---|---|
| Генерация | GPT-6 Luna | ~3k in + 2k out | **$13** |
| Валидация | DeepSeek V4 Flash | ~3k in + 0.5k out | **$5.50** |
| Embeddings | Qwen3-Emb | 200 tok in | **$0** (open-weight, self-host) |
| **Итого** | | | **~$18.50/мес** |

Если 30% юзеров — Plus (Claude Opus 5.5 с cache):
- Plus-генерация: ~3k in + 2k out × $4/$20 × 3000 = $132
- Cache reads на system prompt (повторяется): $0.20 × 1M = $0.20
- Итого: ~**$150/мес** при 10k генераций.

Сравни с GPT-4.1-mini (из ранней рекомендации): было бы ~$80 — **экономия ×4-7**.

## 4. Кэш и fallback chain

- **System prompt кэш**: Claude Opus 5.5 даёт prompt caching. System prompt с правилами ФГОС (~3-5k токенов) кэшируется, повторные запросы берут из кэша за $0.20/1M вместо $4/1M.
- **Semantic cache** (наш собственный): кэш по `(subject, grade, topic, difficulty, count, type)` — если запрашивается популярная тема (например «Площадь треугольника, 5 класс»), выдаём из кэша. TTL 30 дней.
- **Retry chain**: Luna → Sol → Opus. Если 2 подряд timeout/error — падаем в mock + 200 OK с пометкой `cached: false, generation: 'fallback-mock'`.

## 5. Провайдеры и ключи

| Провайдер | Переменная | Где взять |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | platform.openai.com |
| Anthropic | `ANTHROPIC_API_KEY` | console.anthropic.com |
| DeepSeek | `DEEPSEEK_API_KEY` | platform.deepseek.com |
| Qwen (DashScope) | `DASHSCOPE_API_KEY` | dashscope.console.aliyun.com |

Для РФ: VPN/proxy не нужен если платить через OpenRouter (один ключ = все модели). Позже — можно вынести в `OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL` для прокси.

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
