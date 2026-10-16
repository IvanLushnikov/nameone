"use client";

/**
 * Блок «Темы, где просели» (ТЗ-27 §3, шаг 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ЧТО ЭТОТ БЛОК ОТВЕЧАЕТ
 * ────────────────────────────────────────────────────────────────────────────
 * Учитель провёл проверку, открыл ведомость и видит «12 сдали, средний 71».
 * Дальше по этому экрану делать нечего: непонятно, КАКАЯ тема провалилась и что
 * завтра делать. Этот блок — ответ на второй вопрос, а не украшение первого.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ПОРЯДОК ПРИХОДИТ С СЕРВЕРА, И ЭТО НЕ СЛУЧАЙНОСТЬ
 * ────────────────────────────────────────────────────────────────────────────
 * Строки идут по возрастанию доли верных, худшая сверху — так просит учитель и
 * так считал бы он сам, открывая таблицу результатов. Сортировка выполняется на
 * сервере (AD-3 ТЗ-27), здесь она не повторяется: две сортировки на двух
 * устройствах разошлись бы при первом же различии в округлении.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ЛИСТ БЕЗ МЕТОК — ЭТ НЕ ОШИБКА
 * ────────────────────────────────────────────────────────────────────────────
 * Все листы, созданные до этого блока, меток не имеют. Тогда список пуст, и
 * блок либо не рисуется вовсе, либо говорит одну фразу про то, как включить
 * разбор. Показывать «тем, где просели: 0» значило бы заставить учителя искать
 * несуществующий дефект.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { loadClassSkills } from "@/lib/lk/skills-api";
import { explainError } from "@/lib/lk/classes-api";
import { plural } from "@/lib/utils/cn";
import type { ClassSkillRow } from "@/lib/journal/types";
import { PercentBadge, SkillDetailModal, explainSkillError } from "./SkillDetail";

type State =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: ClassSkillRow[] };

export function SkillBreakdown({
  classId,
  className,
  subject,
  grade,
}: {
  classId: string;
  className: string;
  /** Предмет и класс уходят в конструктор вместе с темой. */
  subject: string;
  grade: number;
}) {
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [openSkill, setOpenSkill] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void (async () => {
      const res = await loadClassSkills(classId);
      if (!alive) return;
      setState(
        res.ok
          ? { kind: "ready", rows: res.value }
          : { kind: "unavailable", message: explainError(res.error) },
      );
    })();
    return () => {
      alive = false;
    };
  }, [classId]);

  // Ни одной темы — блок не занимает место. Пустой заголовок «тем, где просели»
  // без строк выглядел бы как поломка страницы.
  if (state.kind === "ready" && state.rows.length === 0) return null;

  if (state.kind === "loading") {
    return (
      <Card className="mb-8" aria-busy="true" data-testid="skill-breakdown-loading">
        <p className="text-sm text-warm-600">Смотрим, где просели…</p>
      </Card>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Card className="mb-8" data-testid="skill-breakdown-unavailable">
        <h2 className="text-lg font-display font-bold text-warm-950">Темы, где просели</h2>
        <p className="text-sm text-rose-700 mt-1" role="alert">
          Не удалось показать разбор по темам. {state.message}
        </p>
      </Card>
    );
  }

  const totalAttempts = state.rows.reduce((sum, row) => sum + row.attempts, 0);

  return (
    <section className="mb-8" aria-labelledby="skill-breakdown-title" data-testid="skill-breakdown">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="skill-breakdown-title" className="text-lg font-display font-bold text-warm-950">
          Темы, где просели
        </h2>
        <span className="text-sm text-warm-600" data-testid="skill-breakdown-total">
          {totalAttempts}{" "}
          {plural(totalAttempts, "ответ", "ответа", "ответов")} по темам
        </span>
      </div>
      <p className="text-sm text-warm-600 mt-1">
        Сверху — тема, где верных ответов меньше всего. Нажмите, чтобы посмотреть
        последние проверки и задания.
      </p>

      <Card className="mt-3" padded={false}>
        <ul>
          {state.rows.map((row) => {
            const percent = row.percent;
            const wrong = Math.max(0, row.total - row.correct);
            return (
              <li key={row.skill} className="border-b border-warm-50 last:border-0">
                <button
                  type="button"
                  onClick={() => setOpenSkill(row.skill)}
                  className="w-full px-4 py-3 text-left hover:bg-warm-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  data-testid="skill-row"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-warm-950">{row.skill}</span>
                    <span className="flex items-center gap-2 whitespace-nowrap text-sm text-warm-700">
                      {wrong}{" "}
                      {plural(wrong, "ошибка", "ошибки", "ошибок")}
                      <PercentBadge percent={percent} />
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-warm-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
                      role="presentation"
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {openSkill && (
        <SkillDetailModal
          open
          onClose={() => setOpenSkill(null)}
          classId={classId}
          className={className}
          skill={openSkill}
          subject={subject}
          grade={grade}
        />
      )}
    </section>
  );
}

export { explainSkillError };