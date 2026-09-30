/**
 * TZ-12: визуальные миниатюры форматов для превью результата в wizard.
 *
 * Контекст: юзер писал «справа очень тупое представление как это будет выглядеть».
 * Текстовая строка («Сентябрь · Тема 1 (4 ч) · Тема 2 (3 ч)») не показывает
 * форму вывода. Миниатюра решает это — учитель видит сетку заданий, радио-кружки,
 * слайды или таблицу КТП до генерации.
 *
 * Чистый presentational: никаких данных, только разметка + CSS.
 */

interface TypePreviewThumbProps {
  type: TaskType;
}

const BAR = "h-[3px] rounded-full bg-warm-200";
const BAR_DARK = "h-[3px] rounded-full bg-warm-400";
const DOT = "h-1.5 w-1.5 rounded-full bg-warm-300";

/** Лист: нумерованные задания с местом для ответа. */
function WorksheetThumb() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[9px] font-semibold text-warm-400 w-3 shrink-0">{i + 1}.</span>
          <div className="flex-1 space-y-1.5">
            <div className={BAR} style={{ width: `${88 - i * 12}%` }} />
            <div className="h-2.5 rounded-sm border border-dashed border-warm-300 bg-warm-50/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Тест: задание + варианты-радио. */
function TestThumb() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className={BAR_DARK} style={{ width: "85%" }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full border border-warm-400 shrink-0" />
          <div className={BAR} style={{ width: `${70 - i * 14}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Карточки: сетка 2×2. */
function CardsThumb() {
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-warm-200 bg-warm-50/50 p-2 space-y-1.5">
          <div className={BAR} style={{ width: "60%" }} />
          <div className={BAR} style={{ width: "85%" }} />
        </div>
      ))}
    </div>
  );
}

/** Контрольная: две колонки «Вариант 1 / Вариант 2». */
function ControlThumb() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="grid grid-cols-2 gap-2">
        {["Вариант 1", "Вариант 2"].map((label) => (
          <div key={label} className="rounded-md border border-warm-200 px-2 py-1.5">
            <div className="text-[8px] font-semibold text-warm-500 mb-1.5">{label}</div>
            <div className="space-y-1">
              <div className={BAR} style={{ width: "80%" }} />
              <div className={BAR} style={{ width: "65%" }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className={BAR} style={{ width: "40%" }} />
        <div className="text-[8px] text-warm-400">критерии</div>
      </div>
    </div>
  );
}

/** План урока: тайм-блоки этапов. */
function LessonPlanThumb() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {[
        { w: 30, t: "5 мин" },
        { w: 45, t: "12 мин" },
        { w: 25, t: "8 мин" },
        { w: 38, t: "10 мин" },
      ].map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="text-[8px] text-warm-400 w-9 shrink-0 tabular-nums">{b.t}</div>
          <div
            className="h-3.5 rounded-sm bg-brand-100 border border-brand-200"
            style={{ width: `${b.w + 30}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** Презентация: сетка мини-слайдов. */
function PresentationThumb() {
  return (
    <div className="grid grid-cols-3 gap-1.5" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="aspect-[4/3] rounded-sm border border-warm-200 bg-warm-50/60 p-1.5 space-y-1"
        >
          <div className="h-1 w-1/2 rounded-full bg-brand-200" />
          <div className={BAR} style={{ width: "90%" }} />
          <div className={BAR} style={{ width: "70%" }} />
        </div>
      ))}
    </div>
  );
}

/** КТП: таблица «месяц → темы». */
function KtpThumb() {
  return (
    <div className="space-y-1" aria-hidden>
      <div className="grid grid-cols-[38px_1fr_22px] gap-1.5 pb-1 border-b border-warm-200">
        {['Месяц', 'Темы', 'Часы'].map((h) => (
          <div key={h} className="text-[8px] font-semibold text-warm-500">{h}</div>
        ))}
      </div>
      {[
        ["Сен", "Рациональные числа", "6"],
        ["Окт", "Пропорции · Проценты", "8"],
        ["Ноя", "Квадратный корень", "5"],
      ].map((row) => (
        <div key={row[0]} className="grid grid-cols-[38px_1fr_22px] gap-1.5 items-center">
          <div className="text-[8px] text-warm-500">{row[0]}</div>
          <div className={BAR} style={{ width: "92%" }} />
          <div className="text-[8px] text-warm-400 text-right tabular-nums">{row[2]}</div>
        </div>
      ))}
    </div>
  );
}

/** Экзамен: две части ФИПИ. */
function ExamThumb() {
  return (
    <div className="space-y-2.5" aria-hidden>
      <div className="rounded-md border border-warm-200 p-2">
        <div className="text-[8px] font-semibold text-warm-600 mb-1.5">Часть 1 · краткий ответ</div>
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-3 gap-0.5">
              {Array.from({ length: 3 }).map((_, j) => (
                <span key={j} className={DOT} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-warm-200 p-2">
        <div className="text-[8px] font-semibold text-warm-600 mb-1.5">Часть 2 · развёрнутый</div>
        <div className="space-y-1.5">
          <div className="h-2 rounded-sm border border-dashed border-warm-300 bg-warm-50/60" />
          <div className="h-2 rounded-sm border border-dashed border-warm-300 bg-warm-50/60" />
        </div>
      </div>
    </div>
  );
}

export function TypePreviewThumb({ type }: TypePreviewThumbProps) {
  const body = (() => {
    switch (type) {
      case "test":
      case "control":
        return <TestThumb />;
      case "cards":
        return <CardsThumb />;
      case "lesson-plan":
        return <LessonPlanThumb />;
      case "presentation":
        return <PresentationThumb />;
      case "ktp":
        return <KtpThumb />;
      case "oge":
      case "ege":
        return <ExamThumb />;
      default:
        return <WorksheetThumb />;
    }
  })();

  return <div className="rounded-lg bg-warm-50/40 p-3 border border-warm-100">{body}</div>;
}
