import type { Worksheet, TaskType } from "@/lib/types";
import { formatDate } from "@/lib/utils/cn";
import { SvgChart } from "./SvgChart";
import { VerifiedBadge } from "./VerifiedBadge";
import type { ChartSpec } from "@/lib/llm/svg-renderer";

interface Props {
  worksheet: Worksheet;
  withAnswers: boolean;
  withExplanations: boolean;
  /** F-09: тип артефакта (worksheet | test | cards | control). Меняет вёрстку и заголовок. */
  type?: TaskType;
}

/**
 * `chartSpec` приходит из LLM (см. docs/04-product-features-svg-graphs.md §3).
 * Поле добавляется в `Worksheet` другим воркером; тип-пересечение здесь —
 * чтобы TS компилировался независимо от порядка мёрджа.
 */
type WorksheetWithChart = Worksheet & { chartSpec?: ChartSpec };

/**
 * F-09: лейблы типов для шапки и подвала превью.
 */
const TYPE_LABEL: Record<TaskType, string> = {
  worksheet: "Рабочий лист",
  test: "Тест с автопроверкой",
  cards: "Карточки для запоминания",
  control: "Контрольная работа",
  "lesson-plan": "План урока",
  presentation: "Презентация",
  ktp: "КТП",
  oge: "Вариант ОГЭ",
  ege: "Вариант ЕГЭ",
};

/**
 * A4-preview листа. Использует класс .worksheet-page из globals.css.
 * Скейлится под ширину экрана через CSS transform.
 *
 * F-09: для type=test рендерим как тест (multiple-choice с буквами A–D),
 * для type=cards — как сетку карточек, иначе — обычный нумерованный список.
 */
export function WorksheetPreview({ worksheet, withAnswers, withExplanations, type }: Props) {
  return (
    <div className="bg-warm-100 rounded-2xl p-3 sm:p-6 print:p-0 print:bg-white">
      <div className="mx-auto max-w-[800px]">
        {/* Лист с заданиями */}
        <article className="worksheet-page animate-fade-in print:shadow-none">
          {/* Шапка листа */}
          <header className="flex items-start justify-between pb-4 mb-5 border-b-2 border-warm-950">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-warm-500">
                {TYPE_LABEL[type ?? "worksheet"]}
              </div>
              <h1 className="text-xl font-bold text-warm-950 mt-1">{worksheet.title}</h1>
              <div className="text-xs text-warm-600 mt-1">
                {worksheet.subject} · {worksheet.grade} класс ·{" "}
                <span className="capitalize">
                  {worksheet.difficulty === "easy" ? "лёгкий уровень" : worksheet.difficulty === "medium" ? "средний уровень" : "сложный уровень"}
                </span>
                {type === "test" && (
                  <>
                    {" · "}
                    <span className="font-semibold text-brand-700">с автопроверкой</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right text-xs text-warm-500 shrink-0">
              <div>РабочиеЛисты AI</div>
              <div className="mt-0.5">{formatDate(worksheet.createdAt)}</div>
              <div className="mt-2 inline-block px-2 py-0.5 rounded border border-brand-300 text-brand-700 text-[10px] font-semibold">
                Проверено AI
              </div>
            </div>
          </header>

          {/* Имя и дата — для распечатки */}
          <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-warm-500 mb-1">Имя</div>
              <div className="border-b border-warm-300 h-7" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-warm-500 mb-1">Класс</div>
              <div className="border-b border-warm-300 h-7" />
            </div>
          </div>

          {/* SVG-график (опционально, если LLM вернул chart_spec) */}
          {(worksheet as WorksheetWithChart).chartSpec && (
            <SvgChart
              spec={(worksheet as WorksheetWithChart).chartSpec as ChartSpec}
              className="worksheet-chart"
            />
          )}

          {/* Задания — F-09: разный рендер в зависимости от типа артефакта.
              - test   → строго multiple-choice с буквами A–D и без поля для ответа
              - cards  → сетка карточек 2×N, без нумерации, без поля для ответа
              - остальное (worksheet, control) → нумерованный список с полями под ответ */}
          {type === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {worksheet.tasks.map((task) => (
                <div
                  key={task.number}
                  className="rounded-xl border border-warm-200 bg-white p-3 print:break-inside-avoid"
                >
                  <div className="text-[10px] uppercase tracking-wider text-warm-500 mb-1.5">Карточка {task.number}</div>
                  <div className="text-sm font-medium text-warm-950 leading-snug">
                    {task.text}
                  </div>
                  {withAnswers && (
                    <div className="mt-2 pt-2 border-t border-dashed border-warm-200 text-xs text-warm-700">
                      <span className="text-warm-500">Ответ: </span>
                      <span className="font-mono">{task.answer ?? "—"}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <ol className="space-y-4">
              {worksheet.tasks.map((task) => (
                <li key={task.number} className="flex items-start gap-2 worksheet-task">
                  <span className="worksheet-task-num">{task.number}</span>
                  <div className="flex-1">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="flex-1 min-w-0">{task.text}</span>
                      {/* F-05-B: badge статуса AI-проверки. */}
                      <VerifiedBadge
                        verified={task.verified}
                        explanation={task.verifiedExplanation}
                      />
                    </div>
                    {task.options && task.options.length > 0 && (
                      <div className={`mt-2 grid gap-2 ${type === "test" ? "grid-cols-1" : "grid-cols-2"}`}>
                        {task.options.map((o, idx) => (
                          <div key={idx} className={`flex items-center gap-2 ${type === "test" ? "text-sm" : "text-sm"}`}>
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border-2 border-warm-400 text-[11px] text-warm-700 font-semibold shrink-0">
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span>{o}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Поле для ответа скрываем в тесте — там выбор из 4-х. */}
                    {type !== "test" && (
                      <div className="mt-3 border-b border-dashed border-warm-300 h-7" />
                    )}
                  </div>
                  <div className="text-[10px] text-warm-400 mt-1 shrink-0">
                    {task.points} б.
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* Подвал */}
          <footer className="mt-10 pt-4 border-t border-warm-200 flex items-center justify-between text-[10px] text-warm-400">
            <span>РабочиеЛисты AI · rabochielisty.ru · проверено AI</span>
            <span>Стр. 1 из {withAnswers ? 2 : 1}</span>
          </footer>
        </article>

        {/* Страница ответов */}
        {withAnswers && (
          <article className="worksheet-page mt-8 animate-fade-in print:shadow-none print:mt-0 print:break-before-page">
            <header className="flex items-start justify-between pb-4 mb-5 border-b-2 border-warm-950">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-warm-500">
                  Ответы и пояснения
                </div>
                <h1 className="text-xl font-bold text-warm-950 mt-1">{worksheet.title}</h1>
                <div className="text-xs text-warm-600 mt-1">Только для учителя · не раздавать ученикам</div>
              </div>
              <div className="text-right text-xs text-warm-500 shrink-0">
                <div>РабочиеЛисты AI</div>
                <div className="mt-2 inline-block px-2 py-0.5 rounded border border-accent-300 text-accent-700 text-[10px] font-semibold">
                  Шифр ответов
                </div>
              </div>
            </header>

            <ol className="space-y-4">
              {worksheet.tasks.map((task) => (
                <li key={task.number} className="flex items-start gap-2 worksheet-task">
                  <span className="worksheet-task-num">{task.number}</span>
                  <div className="flex-1">
                    <div className="font-medium text-warm-950">
                      Ответ: <span className="font-mono">{task.answer ?? "—"}</span>
                    </div>
                    {withExplanations && task.explanation && (
                      <div className="mt-1 text-warm-600 text-[13px]">
                        <span className="font-medium text-warm-700">Пояснение: </span>
                        {task.explanation}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-warm-400 mt-1 shrink-0">
                    {task.points} б.
                  </div>
                </li>
              ))}
            </ol>

            <footer className="mt-10 pt-4 border-t border-warm-200 flex items-center justify-between text-[10px] text-warm-400">
              <span>РабочиеЛисты AI · rabochielisty.ru</span>
              <span>Стр. 2 из 2 · только для учителя</span>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}