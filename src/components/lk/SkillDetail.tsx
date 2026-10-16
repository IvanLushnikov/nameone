"use client";

/**
 * Карточка темы: что делать дальше (ТЗ-27 §3, шаг 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ЧЕТЫРЕ БЛОКА, СВЕРХУ ВНИЗ, В ТОМ ЖЕ ПОРЯДКЕ, ЧТО В ТЗ
 * ────────────────────────────────────────────────────────────────────────────
 *   1. Три последние проверки по теме — со стрелкой «выросло / упало».
 *   2. Кто ошибается два раза подряд.
 *   3. Разбор по заданиям.
 *   4. Кнопки: «Сделать проверочную по теме» и «Вернуться к ведомости».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ СПИСОК УЧЕНИКОВ НЕ ОЦЕНКА, А ПРИГЛАШЕНИЕ
 * ────────────────────────────────────────────────────────────────────────────
 * Две ошибки подряд по одной теме — это не вывод об ученике, это причина
 * подойти и посмотреть вместе. Поэтому под заголовком стоит прямая подпись, а
 * в списке нет ни процентов, ни баллов: любое число здесь превратило бы
 * приглашение в приговор, которого продукт вынести не может. Формулировка —
 * из ТЗ-27 §3, дословно: «это не вывод об ученике, это приглашение посмотреть
 * вместе».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ПУСТЫЕ СОСТОЯНИЯ РАЗНЫЕ И НАЗВАННЫЕ
 * ────────────────────────────────────────────────────────────────────────────
 * Нет проверок, нет учеников в списке, нет заданий — три разные причины, три
 * разных слова. Один «ничего не нашлось» на все случаи означал бы, что блок
 * сломался, и учитель перестал бы в него заглядывать.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { buildTopicPracticeLink, loadSkillDetail, trendWord } from "@/lib/lk/skills-api";
import type { SkillDetailData } from "@/lib/journal/types";

type State =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; detail: SkillDetailData };

/** «15 октября» — учителю год не нужен, дата проверки без года читается. */
function checkedOn(checkedAt: number): string {
  return new Date(checkedAt * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

/**
 * «2026-10-08» → «8 окт.».
 *
 * Сокращённый месяц и год молчащий — не потому что жалко места, а потому что
 * год в списке учеников учителю ничего не говорит, а «октябрь» и «ноябрь» рядом
 * легко перепутать. Даты годатся «14 окт. и 15 окт.» — вслух это читается как
 * «поговорим в эти дни», а полные «14 октября» читаются как простыня.
 */
function isoToRussianDay(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function SkillDetailModal({
  open,
  onClose,
  classId,
  className,
  skill,
  subject,
  grade,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  className: string;
  skill: string;
  /** Предмет и класс — чтобы конструктор открылся сразу с ними. */
  subject: string;
  grade: number;
}) {
  const [state, setState] = React.useState<State>({ kind: "loading" });

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ kind: "loading" });
    void (async () => {
      const res = await loadSkillDetail(classId, skill);
      if (!alive) return;
      setState(
        res.ok
          ? { kind: "ready", detail: res.value }
          : { kind: "unavailable", message: explainSkillError(res.error) },
      );
    })();
    return () => {
      alive = false;
    };
  }, [open, classId, skill]);

  const practiceHref = buildTopicPracticeLink({ skill, subject, grade });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={<span data-testid="skill-detail-title">{skill}</span>}
      description={`${className}${subject ? ` · ${subject}` : ""}`}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button as="link" href={practiceHref} variant="primary" size="sm">
            Сделать проверочную по теме
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Вернуться к ведомости
          </Button>
        </div>
      }
    >
      {state.kind === "loading" && (
        <p className="text-sm text-warm-600" aria-busy="true">
          Собираем разбор по теме…
        </p>
      )}

      {state.kind === "unavailable" && (
        <p className="text-sm text-rose-700" role="alert">
          Не удалось открыть тему. {state.message}
        </p>
      )}

      {state.kind === "ready" && (
        <div className="space-y-4">
          <RecentChecks detail={state.detail} />
          <StrugglingList detail={state.detail} />
          <TaskBreakdown detail={state.detail} />
          <p className="text-xs text-warm-500">
            Тема и класс уже подставлены — допишите только название работы.
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Блок 1: эта тема в трёх последних проверках. */
function RecentChecks({ detail }: { detail: SkillDetailData }) {
  // Проверок меньше трёх — строк столько же. Пустые заглушки «проверка 2 из 3»
  // выглядели бы как недостающее действие, которого учитель не совершал.
  if (detail.recent.length === 0) {
    return (
      <Card data-testid="skill-recent-empty">
        <p className="text-sm font-medium text-warm-950">По этой теме ещё нет проверок</p>
        <p className="text-sm text-warm-600 mt-1">
          Проверьте тему один раз — и здесь появится динамика: вырос процент или упал.
        </p>
      </Card>
    );
  }

  const trend = detail.trend;
  return (
    <Card data-testid="skill-recent">
      <h3 className="text-sm font-semibold text-warm-950">Эта тема в трёх последних проверках</h3>
      {trend && (
        <p className="text-sm text-warm-700 mt-1" data-testid="skill-trend">
          Процент {trendWord(trend.percent)}: {trend.previous}% → {trend.latest}%.
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {detail.recent.map((check) => (
          <li key={check.formId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-warm-900">
              {checkedOn(check.checkedAt)} · {check.title}
            </span>
            <span className="font-medium text-warm-950">
              {check.percent === null ? "—" : `${check.percent}%`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Блок 2: кто ошибается два раза подряд. */
function StrugglingList({ detail }: { detail: SkillDetailData }) {
  return (
    <Card data-testid="skill-struggling">
      <h3 className="text-sm font-semibold text-warm-950">Кто ошибается два раза подряд</h3>
      <p className="text-sm text-warm-600 mt-1">
        Это не вывод об ученике, это приглашение посмотреть вместе.
      </p>

      {detail.struggling.length === 0 ? (
        <p className="text-sm text-warm-700 mt-3">
          Никого: в этой теме нет ученика с двумя неудачными проверками подряд.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {detail.struggling.map((student) => (
            <li key={student.studentId} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-warm-950">{student.studentName}</span>
              <span className="text-warm-600">
                {student.dates.map(isoToRussianDay).join(" и ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Блок 3: какие задания этой темы провалились. */
function TaskBreakdown({ detail }: { detail: SkillDetailData }) {
  return (
    <Card data-testid="skill-tasks">
      <h3 className="text-sm font-semibold text-warm-950">Разбор по заданиям</h3>

      {detail.tasks.length === 0 ? (
        <p className="text-sm text-warm-700 mt-3">
          Заданий с этой темой в последних работах нет — их могло не быть в листе.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {detail.tasks.map((task) => {
            const percent = task.total > 0 ? Math.round((task.correct / task.total) * 100) : null;
            return (
              <li key={`${task.formId}#${task.taskNumber}`}>
                <p className="text-sm text-warm-900">
                  {task.prompt || `Задание ${task.taskNumber}`}
                </p>
                <p className="text-xs text-warm-600 mt-0.5">
                  {task.total === 0
                    ? "ответов ещё не было"
                    : `верно ${task.correct} из ${task.total}${percent === null ? "" : ` (${percent}%)`}, ошиблись ${task.total - task.correct}`}
                </p>
                <Bar percent={percent ?? 0} />
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-warm-500">
        Метку темы учитель правит в листе — она одна на все работы, и правка не пропадает.
      </p>
    </Card>
  );
}

/**
 * Полоса доли верных. Ноль процентов — полоса пустая, а не красная: «никто не
 * ответил» и «все ошиблись» — разные вещи, и красить их одинаково значило бы
 * врать об одном из них.
 */
function Bar({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="mt-1 h-2 w-full rounded-full bg-warm-100 overflow-hidden">
      <div
        className="h-full rounded-full bg-brand-500"
        style={{ width: `${width}%` }}
        role="presentation"
      />
    </div>
  );
}

/** Своими словами, а не через общий словарь классов: здесь другой вопрос. */
export function explainSkillError(error: string): string {
  switch (error) {
    case "unauthorized":
      return "Нужен вход в аккаунт: разбор по темам хранится на сервере, а не в браузере.";
    case "forbidden":
      return "Это класс другого учителя.";
    case "not_found":
      return "Класс не найден — возможно, его удалили.";
    case "validation":
      return "Тема не указана: пришлите на неё ссылку ещё раз.";
    default:
      return "Сервер не ответил как надо. Попробуйте ещё раз.";
  }
}

/** Бейдж процента для строки разреза — общий вид, чтобы числа читались одинаково. */
export function PercentBadge({ percent }: { percent: number | null }) {
  if (percent === null) return <Badge tone="neutral">не считали</Badge>;
  return <Badge tone={percent < 50 ? "danger" : percent < 75 ? "warm" : "success"}>{percent}%</Badge>;
}