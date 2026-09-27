# TZ-00: Integration Manifest (Q1-2027)

> Сделано: 2026-09-26 · Mavis (pre-flight) · к запуску 3 параллельных worker'ов.

## Цель

Расширить РабочиеЛисты AI от «генератор листов» до «полного сервиса для учителя» — добавить 3 новых типа артефактов: **план урока**, **презентацию**, **КТП**. Scope первого захода (см. предыдущий апдейт) = **только моки + UI + preview + docx**, реальный LLM-вызов — фасад готов, fallback на mock.

## Pre-flight (уже сделано родителем)

| # | Файл | Что |
|---|---|---|
| 1 | `src/lib/types.ts` | `TaskType` расширен (`lesson-plan` \| `presentation` \| `ktp`). Добавлены `LessonPlan`, `Presentation`, `Slide`, `Ktp`, `KtpEntry`. `GenerationRequest` имеет опц. `slideCount`, `schoolYear`. |
| 2 | `package.json` | `pptxgenjs` установлен (для экспорта PPTX). |
| 3 | `src/components/constructor/ArtifactTypePicker.tsx` | new — сегментер типа, 7 опций в 2 ряда, реквизит `hasPlus` для блокировки plus-only. |
| 4 | `src/app/constructor/page.tsx` | `ConfigureStep` использует `<ArtifactTypePicker />`, пробрасывает `hasPlus={true}`. |
| 5 | `src/lib/mock/lesson-plan.ts` | new — заглушка с минимальным контрактом (Worker A дополняет). |
| 6 | `src/lib/mock/presentation.ts` | new — заглушка (Worker B дополняет). |
| 7 | `src/lib/mock/ktp.ts` | new — заглушка (Worker C дополняет). |
| 8 | `src/lib/client/llm.ts` | new API: `generateLessonPlanSmart`, `generatePresentationSmart`, `generateKtpSmart`. Универсальный `smartGenerate<T>()` убирает копипасту. |
| 9 | `src/lib/llm/index.ts` | new API: `generateLessonPlan`, `generatePresentationArtifact`, `generateKtpArtifact` — фасады для будущего бэка. |

## Что делает каждый worker (кратко)

### Worker A — Lesson Plans (`docs/tz/01-lesson-plan.md`)

**Владеет файлами**:
- `src/lib/mock/lesson-plan.ts` (заменяет заглушку)
- `src/components/constructor/LessonPlanPreview.tsx` (new)
- `src/lib/utils/lesson-plan-docx.ts` (new — экспорт DOCX через существующий `docx` пакет)
- `tests/lesson-plan.test.ts` (new)

### Worker B — Presentations (`docs/tz/02-presentation.md`)

**Владеет файлами**:
- `src/lib/mock/presentation.ts` (заменяет заглушку)
- `src/components/constructor/PresentationPreview.tsx` (new)
- `src/lib/utils/pptx.ts` (new — экспорт через `pptxgenjs`)
- `tests/presentation.test.ts` (new)

### Worker C — KTP (`docs/tz/03-ktp.md`)

**Владеет файлами**:
- `src/lib/mock/ktp.ts` (заменяет заглушку)
- `src/components/constructor/KtpPreview.tsx` (new)
- `src/lib/utils/ktp-docx.ts` (new — таблица с merged cells)
- `tests/ktp.test.ts` (new)

## Общий контракт

Все 3 worker'а обязаны:

1. **Сохранить сигнатуру** mock-функции (`generateXxx(req: GenerationRequest): Promise<Xxx>`).
2. **Сохранить структуру** выходного объекта (соответствие интерфейсу из `types.ts`).
3. **Не трогать** `constructor/page.tsx`, `ArtifactTypePicker.tsx`, `client/llm.ts`, `llm/index.ts`, `types.ts` — это общие файлы, за ними следит родитель.
4. **Покрыть vitest-тестами** минимум: 1 happy-path + 1 edge-case (например, `topic` не нашёлся в таксономии).

## Acceptance (per worker)

- `npx tsc --noEmit` ✅
- `npx vitest run tests/<X>.test.ts` ✅ (минимум 2 теста)
- 1 ручной скриншот превью через `npm run build` + `cd out && python3 -m http.server 8080` + открыть в браузере
- 1 проверка экспорта: скачать и открыть DOCX/PPTX в Word/LibreOffice/Google Slides

## Что НЕ делает ни один worker (за пределами TZ)

- Лендинг (`Hero.tsx`, `Features.tsx`, `Comparison.tsx`, `PricingTeaser.tsx`) — родитель после интеграции.
- Pricing page — родитель.
- Dashboard / история — родитель.
- SEO-страницы (`/lesson-plan/[subject]/[grade]/[topic]` и т.п.) — родитель.
- Бэкенд (Worker self, PPTX-генерация на сервере) — отдельная TZ после бэка.
- Self-verification для LessonPlan/Presentation/Ktp — отложена, урок за Workshop'ом.

## Запуск

Родитель запускает 3 worker'а параллельно через `task` (Mavis runtime). Каждый получает свой TZ + этот manifest + указание «не трогай общие файлы».
