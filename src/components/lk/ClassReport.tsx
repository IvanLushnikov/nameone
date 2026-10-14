"use client";

/**
 * Ведомость по классу (лист 3.1.3).
 *
 * Вопрос учителя, на который блок и есть ответ: «кого ждать и что выгрузить
 * классному руководителю». Всё, что показывает этот блок, СЧИТАЕТ СЕРВЕР
 * (`GET /api/classes/:id/report`): числа «сколько сдали» и «кто не сдал»
 * собираются в одном месте из одной выгрузки строк, а не складываются в
 * браузере у каждого устройства по-своему.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ЧТО БЛОК НЕ ДЕЛАЕТ — И ЭТО НАПИСАНО, А НЕ СПРЯТАНО
 * ────────────────────────────────────────────────────────────────────────────
 *   * не ставит отметки: ведомость показывает, что уже оценили — учитель или ИИ;
 *   * не отправляет ведомость сама: файл учитель открывает и решает, кому
 *     передать. Куда уходит файл — это кабинет и почта, а не наш сервис;
 *   * не прячет чужой класс: чужую ведомость сервер не отдаёт (403), и здесь
 *     вместо пустого экрана написано почему;
 *   * не показывает блок тому, у кого классов нет вообще. Пустой раздел про
 *     класс, который учитель ещё не завёл, только мешает; где завести класс —
 *     кабинет, и туда ведёт единственная ссылка ниже, когда класс уже есть.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ «НЕ ПОДТВЕРЖДЁН ИИ» — ОТДЕЛЬНЫЙ ЦВЕТ, А НЕ СКРОМНАЯ СНОСКА
 * ────────────────────────────────────────────────────────────────────────────
 * Машина поставила «верно», учитель работу не открывал. Если такое показать
 * просто зелёной ячейкой «верно», через месяц никто — включая учителя — не
 * отличит его собственную проверку от чужой. Поэтому источник отметки виден в
 * каждой ячейке, а работы с неподтверждённым вердиктом вынесены в отдельную
 * строку сводки.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { explainError, loadRoster, type RosterClass } from "@/lib/lk/classes-api";
import {
  fetchClassReportCsv,
  loadClassReport,
  type ClassReport,
  type ClassReportCell,
  type ClassReportEmptyReason,
  type ClassReportSource,
  type ClassReportStudent,
} from "@/lib/journal/types";
import { plural } from "@/lib/utils/cn";

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; report: ClassReport };

/** Слова про источник отметки. Одни и те же в ячейке, в сводке и в легенде. */
const SOURCE_LABEL: Record<ClassReportSource, string> = {
  teacher: "учитель",
  teacher_with_model: "учитель поправил ИИ",
  model: "ИИ, не подтверждён",
  auto: "посчитали сами",
  none: "без отметки",
};

const SOURCE_TONE: Record<
  ClassReportSource,
  "neutral" | "brand" | "accent" | "warm" | "info" | "success" | "danger"
> = {
  teacher: "brand",
  teacher_with_model: "accent",
  model: "warm",
  auto: "neutral",
  none: "neutral",
};

/**
 * Пустое состояние — три разные причины и три разных действия.
 *
 * Один «0» на все случаи был бы бесполезен: учитель не знает, то ли ждать
 * первых ответов, то ли добавить учеников, то ли он вообще смотрит не тот класс.
 */
const EMPTY_TEXT: Record<
  ClassReportEmptyReason,
  { title: string; hint: string; action: string; href: string }
> = {
  // Адреса — реальные страницы этого сайта. Пустые ссылки на «будущие»
  // разделы уводили бы учителя в 404 ровно тогда, когда он ищет, что делать.
  no_students: {
    title: "В этом классе пока нет учеников",
    hint: "Добавьте список учеников и выдайте каждому свой QR — после этого здесь появится сводка по классу.",
    action: "Добавить учеников",
    href: "/dashboard/settings",
  },
  no_works: {
    title: "По классу ещё нет работ",
    hint: "Выдайте работу по персональной ссылке: как только её сдадут, здесь появятся отметки и список тех, кто ещё не сдал.",
    action: "Открыть кабинет",
    href: "/dashboard",
  },
  no_answers: {
    title: "Работы выданы, но ответов пока нет",
    hint: "Покажите QR на уроке или отправьте персональные ссылки в классный чат. Здесь будет видно, кто уже сдал, а кто ещё ждёт.",
    action: "Открыть кабинет",
    href: "/dashboard",
  },
};

/** Ученик без ответов — это строка в ведомости, а не отсутствие строки. */
const NOT_SUBMITTED = "не сдал";

/** Процент по работам ученика. null — сдавать было нечего. */
function studentPercent(student: ClassReportStudent): number | null {
  const scored = student.works.filter((w) => w.max > 0);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((sum, w) => sum + (w.score / w.max) * 100, 0) / scored.length);
}

export function ClassReportSection() {
  const [classes, setClasses] = React.useState<RosterClass[]>([]);
  const [classId, setClassId] = React.useState<string | null>(null);
  const [state, setState] = React.useState<State>({ kind: "loading" });
  /**
   * Список классов уже известен. До этого «загрузка» — это ещё «может, блока и
   * не будет»: показывать «Загружаем ведомость» тому, у кого классов нет,
   * значило бы мигать пустым экраном на каждом открытии журнала.
   */
  const [booted, setBooted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  // Список классов — один раз: он же источник переключателя.
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await loadRoster();
      if (!alive) return;
      setBooted(true);
      if (!res.ok) {
        // Без входа и без классов блок просто не занимает место: объяснять
        // дважды «войдите в аккаунт» на одной странице незачем.
        setState({ kind: "hidden" });
        return;
      }
      const own = res.value.classes;
      setClasses(own);
      if (own.length === 0) {
        setState({ kind: "hidden" });
        return;
      }
      setClassId((prev) => prev ?? own[0]!.id);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = React.useCallback(async (id: string) => {
    setState({ kind: "loading" });
    const res = await loadClassReport(id);
    if (!res.ok) {
      setState({ kind: "unavailable", message: explainError(res.error) });
      return;
    }
    setState({ kind: "ready", report: res.report });
  }, []);

  React.useEffect(() => {
    if (!classId) return;
    void load(classId);
  }, [classId, load]);

  const exportCsv = async () => {
    if (!classId || busy) return;
    setBusy(true);
    setNote(null);
    const res = await fetchClassReportCsv(classId);
    setBusy(false);
    if (!res.ok) {
      setNote(explainError(res.error));
      return;
    }
    // Текст отдаём как есть: BOM и разделитель `;` положил сервер — именно
    // из-за них русский Excel открывает файл таблицей.
    const blob = new Blob([res.text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (state.kind === "hidden") return null;

  // Переключение класса не должно моргать всей секцией: старая ведомость уходит,
  // а вместо неё — короткая строка «загружаем», а не пустое место.
  if (state.kind === "loading") {
    return booted ? (
      <Card className="mb-8" aria-busy="true">
        <p className="text-sm text-warm-600">Загружаем ведомость по классу…</p>
      </Card>
    ) : null;
  }

  if (state.kind === "unavailable") {
    return (
      <Card className="mb-8">
        <p className="text-sm text-rose-700" role="alert">
          Не удалось загрузить ведомость по классу. {state.message}
        </p>
        {classId && (
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void load(classId)}>
            Попробовать ещё раз
          </Button>
        )}
      </Card>
    );
  }

  const { report } = state;
  const empty = report.emptyReason ? EMPTY_TEXT[report.emptyReason] : null;

  return (
    <section className="mb-8" aria-labelledby="class-report-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="class-report-title" className="text-lg font-display font-bold text-warm-950">
            Ведомость по классу
          </h2>
          <p className="text-sm text-warm-600 mt-1">
            Кто сдал, кто ждёт и чья это отметка — учителя или ИИ.
          </p>
        </div>

        {classes.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-warm-600">
            <span>Класс</span>
            <select
              value={classId ?? ""}
              onChange={(e) => setClassId(e.target.value)}
              className="rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm text-warm-900"
              data-testid="class-report-class-picker"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {empty ? (
        <Card className="mt-3" data-testid="class-report-empty">
          <p className="text-sm font-medium text-warm-950">{empty.title}</p>
          <p className="text-sm text-warm-600 mt-1">{empty.hint}</p>
          <Button as="link" href={empty.href} variant="secondary" size="sm" className="mt-3">
            {empty.action}
          </Button>
        </Card>
      ) : (
        <ReportBody report={report} busy={busy} note={note} onExport={() => void exportCsv()} />
      )}
    </section>
  );
}

/** Таблица и кнопка выгрузки — то, что видит учитель, когда ведомость не пустая. */
function ReportBody({
  report,
  busy,
  note,
  onExport,
}: {
  report: ClassReport;
  busy: boolean;
  note: string | null;
  onExport: () => void;
}) {
  const { summary, works, students } = report;

  return (
    <div className="mt-3 space-y-3">
      <Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Учеников" value={String(summary.studentsTotal)} />
          <Stat
            label="Сдали"
            value={String(summary.studentsSubmitted)}
            hint={`${summary.submittedWorks} ${plural(summary.submittedWorks, "работа", "работы", "работ")}`}
          />
          <Stat
            label="Не сдали"
            value={String(summary.studentsNotSubmitted)}
            tone={summary.studentsNotSubmitted > 0 ? "warm" : "neutral"}
          />
          <Stat
            label="Ждут вас"
            value={String(summary.pendingWorks)}
            hint={summary.pendingWorks > 0 ? "работ с неразобранными ответами" : undefined}
            tone={summary.pendingWorks > 0 ? "warm" : "neutral"}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Средний процент"
            value={summary.averagePercent === null ? "—" : `${summary.averagePercent}%`}
            hint={summary.averagePercent === null ? "сдавать было нечего" : undefined}
          />
          <Stat
            label="Отметки ИИ"
            value={String(summary.unconfirmedWorks)}
            hint="работ, где учитель не подтвердил машину"
            tone={summary.unconfirmedWorks > 0 ? "warm" : "neutral"}
          />
          <Stat label="Отметки учителя" value={String(summary.bySource.teacher + summary.bySource.teacher_with_model)} hint="работ проверел человек" />
          <Stat label="Посчитали сами" value={String(summary.bySource.auto)} hint="работ без модели" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={onExport}
            data-testid="class-report-export"
          >
            Скачать ведомость в Excel
          </Button>
          <Button as="link" href="/dashboard/settings" variant="ghost" size="sm">
            Ученики и QR
          </Button>
        </div>
        <p className="mt-2 text-xs text-warm-500">
          Файл открывается в Excel таблицей: разделитель «точка с запятой», русские имена не ломаются.
        </p>

        {note && (
          <p className="mt-2 text-sm text-rose-700" role="alert">
            {note}
          </p>
        )}

        {/* Слова, а не числа: учитель должен понимать, что означает колонка. */}
        {summary.unlinkedAnswers > 0 && (
          <p className="mt-3 text-sm text-warm-700">
            {summary.unlinkedAnswers}{" "}
            {plural(summary.unlinkedAnswers, "работа сдана", "работы сданы", "работ сдано")} по общей ссылке
            без персонального QR{report.worksTruncated ? " (по показанным работам)" : ""} — отнести их к ученику
            нельзя, поэтому в ведомости их нет.
          </p>
        )}
        {report.worksTruncated && (
          <p className="mt-2 text-sm text-warm-700">
            Показаны последние {works.length} из {report.worksTotal} работ — счётчики выше относятся только к ним.
            Более старые работы в ведомость не попали.
          </p>
        )}
      </Card>

      {/* Таблица шириной во весь класс: на телефоне она прокручивается по
          горизонтали, а не сжимает колонки до нечитаемых. */}
      <Card padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" data-testid="class-report-table">
            <thead>
              <tr className="border-b border-warm-100 text-left">
                <th scope="col" className="px-3 py-2 font-medium text-warm-600">№</th>
                <th scope="col" className="px-3 py-2 font-medium text-warm-600">ФИО</th>
                {works.map((w) => (
                  <th key={w.id} scope="col" className="px-3 py-2 font-medium text-warm-600 whitespace-nowrap">
                    {w.title}
                    {/* Открытая работа помечена: «не сдал» по ней ещё не приговор. */}
                    {w.isOpen && (
                      <span className="block text-xs font-normal text-warm-500">ещё открыта</span>
                    )}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium text-warm-600 whitespace-nowrap">Средний %</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student, index) => {
                const percent = studentPercent(student);
                return (
                  <tr key={student.id} className="border-b border-warm-50 last:border-0 align-top">
                    <td className="px-3 py-2 text-warm-500">{index + 1}</td>
                    <td className="px-3 py-2 font-medium text-warm-950">{student.name}</td>
                    {works.map((work) => {
                      const cell = student.works.find((w) => w.formId === work.id);
                      return (
                        <td key={work.id} className="px-3 py-2">
                          {cell ? <WorkCell cell={cell} /> : <span className="text-warm-500">{NOT_SUBMITTED}</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-warm-700 whitespace-nowrap">
                      {percent === null ? "—" : `${percent}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-warm-500">
        «{SOURCE_LABEL.model}» — машина оценила, а вы работу ещё не открывали: это не ваша отметка. «
        {SOURCE_LABEL.teacher}» — поставили вы. «{SOURCE_LABEL.teacher_with_model}» — посмотрели и поправили часть ответов.
        «{SOURCE_LABEL.auto}» — ответы проверены без модели.
      </p>
    </div>
  );
}

/** Ячейка: балл + чья это отметка + сколько заданий ждёт учителя. */
function WorkCell({ cell }: { cell: ClassReportCell }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="whitespace-nowrap text-warm-900">
        {cell.max > 0 ? `${cell.score} из ${cell.max}` : String(cell.score)}
      </span>
      <Badge tone={SOURCE_TONE[cell.source]}>{SOURCE_LABEL[cell.source]}</Badge>
      {cell.pendingTasks > 0 && (
        <span className="text-xs text-warm-600">
          ждёт вас: {cell.pendingTasks}
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "warm";
}) {
  return (
    <div className={"rounded-xl px-3 py-2 " + (tone === "warm" ? "bg-warm-100" : "bg-warm-50/60")}>
      <div className="text-xs text-warm-500">{label}</div>
      <div className="text-lg font-semibold text-warm-950">{value}</div>
      {hint && <div className="text-xs text-warm-500">{hint}</div>}
    </div>
  );
}