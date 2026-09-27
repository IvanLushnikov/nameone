# Tasks — F-05: Self-verification для математики

> **Дата:** 2026-09-26
> **Зачем:** главная дифференциация от Обучай / STUDY AI / ZAOCHNIK — проверка правильности сгенерированных задач отдельным LLM-проходом.
> **Архитектура:** Cloudflare Worker (отдельный backend) + вызов из frontend через fetch. Static export не поддерживает API routes, поэтому backend — отдельный Worker.
> **Подход:** 3 параллельных сабагента. Каждый пишет в свой файл/проект.

---

## Общий контекст

**Что есть:**
- `docs/02-llm-architecture.md` — LLM-стек и routing-логика
- `docs/04-product-features-q4-2026.md` — общая фича-спека (F-05 раздел)
- `src/lib/content/exam-taxonomy.ts` — 218 номеров ФИПИ
- `src/lib/mock/generator.ts` — текущий генератор (без LLM)
- `src/lib/utils/storage.ts` — аналитика

**Что НЕ трогаем:**
- `src/lib/types.ts` (только если нужно расширить — минимально)
- `src/app/exam/[exam]/[subject]/[number]/page.tsx` (не нужен self-verify на статике)
- `src/app/subject/[subject]/[grade]/[topic]/page.tsx` (то же)

**Что нужно от пользователя:**
- `OPENROUTER_API_KEY` (один ключ для всех моделей: GPT-6 Luna, Claude Opus 5.5, DeepSeek V4 Flash — см. `02-llm-architecture.md`)
- Ключ передаётся в bash-сессию через `export`, не записывать в файлы

---

## Subtask #1 — Cloudflare Worker (backend)

**Owner:** worker
**Новая директория:** `/Users/ivanlusnikov/Documents/nameone/worker-self-verify/`
**Цель:** REST endpoint `POST /verify` который принимает задачу → генерирует ответ через LLM → проверяет вторым проходом → возвращает `{verified, answer, explanation}`

### Scope
1. **Создать Worker проект** в `worker-self-verify/`:
   - `package.json` с зависимостями: `wrangler`, `openai` (или прямой fetch к OpenRouter)
   - `wrangler.toml` с project name = `listai-self-verify`, env vars
   - `tsconfig.json`
2. **Handler `src/index.ts`**:
   - `POST /verify` — принимает `{subject, grade, topic, task}` (JSON)
   - **Шаг 1**: LLM решает задачу → получаем ответ (`model: gpt-6-luna`, см. 02-llm-architecture.md)
   - **Шаг 2**: Тот же LLM проверяет правильность (prompt: «Этот ответ правильный?») → `{verified: true/false}`
   - Если не verified → fallback на `claude-opus-5-5` для второго мнения (опционально)
   - Возвращает `{verified, answer, explanation, latency_ms, model}`
3. **Mock fallback**: если `OPENROUTER_API_KEY` не задан, возвращает `{verified: true, mock: true, answer: "..."}` для разработки
4. **CORS**: разрешить запросы с `listai-prototype.pages.dev` и `localhost:3000`
5. **Error handling**: timeout 30 сек, rate limit (10 req/sec per IP)
6. **Env vars в wrangler.toml** (placeholder, реальные ключи через `wrangler secret put`):
   ```toml
   [env.production.vars]
   WORKER_NAME = "listai-self-verify"
   ALLOWED_ORIGINS = "https://listai-prototype.pages.dev,https://www.listai-prototype.pages.dev"
   ```
   Секреты (через `wrangler secret put OPENROUTER_API_KEY` после деплоя Worker)

### Файлы
- `worker-self-verify/package.json` — wrangler 4.x, openai SDK 4.x
- `worker-self-verify/wrangler.toml` — конфиг
- `worker-self-verify/tsconfig.json`
- `worker-self-verify/src/index.ts` — основной handler (~150 строк)
- `worker-self-verify/src/prompts.ts` — 2 промпта (solve + verify)

### DoD
- [ ] Worker проект создан
- [ ] Локальный тест: `wrangler dev` + curl POST → 200 с JSON
- [ ] Mock fallback работает без ключа
- [ ] Build: `wrangler deploy` без ошибок
- [ ] После деплоя URL Worker-а известен (сохранить для Subtask #2)

---

## Subtask #2 — Frontend интеграция

**Owner:** worker
**Файлы:**
- Создать `src/lib/llm/self-verify.ts` (клиент)
- Обновить `src/lib/mock/generator.ts` (вызывать self-verify после генерации)
- Обновить `src/components/constructor/WorksheetPreview.tsx` (показать badge)
- Создать `src/components/constructor/VerifiedBadge.tsx`

**Цель:** после генерации листа вызвать Worker, показать badge «✓ AI-проверено» или «⚠️ Требует проверки»

### Scope
1. **`src/lib/llm/self-verify.ts`**:
   ```ts
   export async function selfVerify(task: Task): Promise<{
     verified: boolean;
     answer: string;
     explanation?: string;
     model?: string;
     latency_ms?: number;
   }>
   ```
   - URL Worker из env: `process.env.NEXT_PUBLIC_WORKER_URL` или hardcoded fallback
   - Timeout 35 сек (Worker timeout = 30 + overhead)
   - При недоступности Worker — graceful fallback (verified: null, «не удалось проверить»)
2. **`src/lib/mock/generator.ts`** — после `generateWorksheet` запустить `selfVerify` для каждой задачи. Результат кладём в `worksheet.tasks[i].verified: boolean | null`
3. **`VerifiedBadge.tsx`** — UI:
   - `✓ AI-проверено` зелёный (если verified=true)
   - `⚠️ Требует проверки` жёлтый (если verified=false или null)
   - Tooltip с explanation
4. **`WorksheetPreview.tsx`** — показать badge рядом с каждым заданием

### Env (в `nameone/.env`):
```
NEXT_PUBLIC_WORKER_URL=https://listai-self-verify.<account>.workers.dev
```

### DoD
- [ ] Клиент `self-verify.ts` работает
- [ ] `generator.ts` вызывает verify после генерации
- [ ] Badge отображается в WorksheetPreview
- [ ] При недоступности Worker — не падает, показывает «⚠️»
- [ ] `npm run build` проходит
- [ ] Edge case: пустой ответ Worker — graceful fallback

---

## Subtask #3 — QA + Деплой

**Owner:** worker
**Цель:** задеплоить Worker на Cloudflare + Frontend на Pages + live-проверка

### Scope
1. **Worker deploy**:
   - `wrangler deploy` в `worker-self-verify/`
   - Получить URL Worker-а
   - Сохранить URL в `nameone/.env` как `NEXT_PUBLIC_WORKER_URL`
2. **Frontend rebuild + deploy**:
   - `npm run build` в `nameone/`
   - `wrangler pages deploy out --project-name=listai-prototype --commit-dirty=true`
3. **Live-проверка на проде**:
   - Открыть `https://listai-prototype.pages.dev/constructor/`
   - Сгенерировать лист по математике
   - Проверить что badge «AI-проверено» появился (через 5-30 сек после генерации)
   - Curl на Worker URL — проверить что он отвечает

### DoD
- [ ] Worker задеплоен, URL зафиксирован
- [ ] Frontend перезадеплоен с `NEXT_PUBLIC_WORKER_URL`
- [ ] Live-проверка на проде: badge появляется после генерации
- [ ] Smoke-test: `curl POST /verify` → 200 с `{verified: true}`

---

## Координация

- **Subtask #1** — Worker код, не зависит ни от кого
- **Subtask #2** — Frontend, ждёт URL Worker от #1 (для env)
- **Subtask #3** — Deploy, ждёт Worker URL и Frontend build

**Параллельно** запускаем #1 и #2. После #1 — подставляем URL в #3. После #2 — rebuild и deploy в #3.

---

## Что НЕ делаем

- ❌ Self-verification для не-математики (только математика в этой итерации)
- ❌ Замена мокового генератора на реальный LLM (это F-06, требует LLM для каждой генерации, дороже)
- ❌ Streaming ответов от Worker (синхронный fetch OK для MVP)
- ❌ Кэширование verify-ответов (можно добавить в следующей итерации)

---

## Open questions

- [ ] LLM API ключ — пользователь даст через `export OPENROUTER_API_KEY=...` в bash-сессии
- [ ] Какой именно provider: OpenRouter (1 ключ = все модели) или прямой OpenAI/Anthropic? Рекомендую OpenRouter для простоты.
- [ ] Бюджет на Worker — Cloudflare Free Tier = 100k req/день. На 1000 генераций/день = 1000 verify calls = ок.
