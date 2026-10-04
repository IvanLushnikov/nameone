"use client";

/**
 * Ручные отметки учителя (ТЗ-19 §3).
 *
 * Один компонент на ДВА места: панель после свежей проверки и страница открытой
 * проверки. Разные места, один сценарий и одни правила — значит, одна вёрстка.
 * Дублировать её в панели и в `/journal/[checkId]` было бы верным способом
 * через месяц получить две расходящиеся формы.
 *
 * ── Три правила, ради которых файл существует ─────────────────────────────
 *
 * 1. ОТПРАВКА ТОЛЬКО ПО КНОПКЕ. Никакого автосохранения на каждый чекбокс.
 *    Автосейв означал бы, что учитель согласился с чужой отметкой просто потому,
 *    что кликнул мимоходом. Его право — решить, а не подтвердить по инерции.
 *
 * 2. ЧЕСТНОСТЬ ПРО СОХРАНЁННОЕ. После успеха — «Сохранено» и кнопка гаснет до
 *    изменения отметок. После ошибки — причина И поля остаются заполненными:
 *    учитель не должен заново расставлять галочки из-за сети.
 *
 * 3. ЧУЖАЯ ОЦЕНКА НЕ ПРЯЧЕТСЯ. Если часть заданий всё ещё ждёт решения, итог
 *    НЕ показывается вовсе, а учителю прямо сказано, сколько осталось. Молча
 *    показать «4» по неполному разбору — это подставить ученику отметку, которой
 *    никто не ставил.
 */

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  confidencePercent,
  confidenceState,
  plural,
  type ReviewPartition,
} from "@/lib/photo-check/confidence";
import type { PhotoCheckItem, PhotoCheckManualMark } from "@/lib/photo-check/types";

export interface ManualMarkDraft {
  taskNumber: number;
  accepted: boolean;
  points: number;
}

export interface ManualMarksEditorProps {
  /** Разбивка заданий: что машина решила, что ждёт учителя, что уже закрыто. */
  partition: ReviewPartition;
  /** Уже сохранённые отметки — поля открываются уже отмеченными. */
  initialMarks: PhotoCheckManualMark[];
  /** Сохранить. Возвращает новое состояние проверки с сервера. */
  onSave: (marks: ManualMarkDraft[]) => Promise<void>;
  /** Что показать учителю, если сервер не принял отметки. */
  errorMessage?: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function ManualMarksEditor({
  partition,
  initialMarks,
  onSave,
  errorMessage,
}: ManualMarksEditorProps) {
  // Черновик в состоянии компонента. Ключевой момент: он НЕ пишется в props и
  // не отправляется наружу, пока учитель не нажал кнопку сам.
  const [draft, setDraft] = React.useState<Record<number, ManualMarkDraft>>(() =>
    indexMarks(initialMarks),
  );
  const [state, setState] = React.useState<SaveState>("idle");

  // Сервер может вернуть обновлённый список (например, после сохранения) —
  // тогда перечитываем черновик, иначе поля остались бы со старыми значениями.
  React.useEffect(() => {
    setDraft(indexMarks(initialMarks));
    setState("idle");
  }, [initialMarks]);

  const changed = React.useMemo(() => marksDiffer(draft, indexMarks(initialMarks)), [draft, initialMarks]);

  function mark(number: number, patch: Partial<Omit<ManualMarkDraft, "taskNumber">>) {
    setDraft((prev) => {
      const current = prev[number] ?? { taskNumber: number, accepted: false, points: 0 };
      return { ...prev, [number]: { ...current, ...patch } };
    });
    // Любое изменение снова делает черновик «несохранённым» — иначе учитель,
    // поправив отметку, увидел бы неактивную кнопку и решил, что она не работает.
    setState("idle");
  }

  async function save() {
    if (state === "saving" || !changed) return;
    setState("saving");
    try {
      // Уходят ТОЛЬКО те задания, которых учитель коснулся. Незатронутые
      // сомнительные отправлять нельзя: сервер закроет их как «решено», и
      // итоговая отметка появится без решения учителя по этим заданиям.
      await onSave(Object.values(draft));
      setState("saved");
    } catch {
      // Причину показывает вызывающий: у него есть код ошибки API, здесь его
      // нет. Здесь только фиксируем факт — не сохранилось, поля остаются.
      setState("error");
    }
  }

  // Показываем ТОЛЬКО то, что ждёт решения, плюс уже сохранённое отдельным
  // списком. Один длинный список всех заданий учителю не нужен: сомнительные
  // видно и без прокрутки.
  const rows: PhotoCheckItem[] = [...partition.needsDecision, ...partition.decided];

  if (rows.length === 0) return null;

  // «Ждут решения» считаем по серверной разбивке, а не по черновику: не
  // сохранённая галочка отметку не закрывает. Поэтому учитель не может увидеть
  // «всё готово», нажав кнопку и не дождавшись ответа.
  const pending = partition.needsDecision.length;

  return (
    <section className="rounded-xl border border-warm-200 bg-warm-50/60 p-4 no-print">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-warm-950">
          Проверьте сами
          {partition.needsDecision.length > 0 && (
            <span className="font-normal text-warm-600">
              {" "}
              — {partition.needsDecision.length}{" "}
              {plural(partition.needsDecision.length, "задание ждёт", "задания ждут", "заданий ждут")} вас
            </span>
          )}
        </h3>
        {partition.decided.length > 0 && (
          <Badge tone="brand">{partition.decided.length} сохранено</Badge>
        )}
      </header>

      <p className="text-xs text-warm-600 mt-1">
        Это не ошибки ученика: модель не смогла прочитать почерк. Отметьте, что
        засчитать, и нажмите «Сохранить отметки» — без этого итоговой отметки не
        будет.
      </p>

      <ul className="mt-3 space-y-2.5">
        {rows.map((item) => {
          const value = draft[item.number];
          const accepted = value?.accepted ?? false;
          const points = value?.points ?? item.maxPoints;
          // Подпись «сохранено вами» ставим по СОХРАНЁННОЙ отметке, а не по
          // серверному decidedBy: строка результата переезжает только после
          // ответа сервера, а черновик — уже сейчас. Иначе учитель увидел бы
          // «ничего не сохранено» сразу после успешного ответа.
          const savedHere = initialMarks.some((m) => m.taskNumber === item.number);
          return (
            <li
              key={item.number}
              className="rounded-lg border border-warm-100 bg-white px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id={`mark-${item.number}`}
                  data-testid={`manual-mark-${item.number}`}
                  checked={accepted}
                  onChange={(e) =>
                    mark(item.number, {
                      accepted: e.target.checked,
                      // Включили «зачтено» — сразу полный балл. Снимая галочку,
                      // сбрасываем в 0: частичный балл учитель выставит сам.
                      points: e.target.checked ? item.maxPoints : 0,
                    })
                  }
                  className="mt-0.5 w-4 h-4 accent-[color:var(--brand-500)]"
                />
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`mark-${item.number}`}
                    className="block text-sm text-warm-900 cursor-pointer"
                  >
                    <span className="text-warm-500 mr-1.5">{item.number}.</span>
                    {item.taskText || "Задание без текста"}
                  </label>
                  {item.studentAnswer ? (
                    <p className="text-xs text-warm-500 mt-0.5">
                      Модель прочитала: {item.studentAnswer}
                    </p>
                  ) : (
                    <p className="text-xs text-warm-500 mt-0.5">Ответ ученика не распознан</p>
                  )}

                  {/* Почему задание здесь и что именно модель нашла. Без этого
                      учитель гадает, откуда взялось «перепроверьте сами», и
                      сверять ему не с чем. Порог уверенности — для показа;
                      то, что задание попало сюда, решил сервер. */}
                  <p className="text-xs text-warm-500 mt-1">
                    {confidenceState(item) === "unrecognized"
                      ? "Модель не нашла здесь ответа — сверьте по тетради."
                      : `Уверенность чтения: ${confidencePercent(item.confidence)}`}
                    {item.expected ? ` · Эталон: ${item.expected}` : ""}
                    {item.maxPoints ? ` · ${item.maxPoints} б.` : ""}
                  </p>

                  <div className="flex items-center gap-2 mt-2">
                    <label
                      htmlFor={`points-${item.number}`}
                      className="text-xs text-warm-600"
                    >
                      Балл
                    </label>
                    <input
                      id={`points-${item.number}`}
                    data-testid={`manual-points-${item.number}`}
                      type="number"
                      min={0}
                      max={item.maxPoints}
                      value={points}
                      disabled={!accepted}
                      onChange={(e) =>
                        mark(item.number, { points: Number(e.target.value) || 0 })
                      }
                      className="w-16 h-8 rounded-md border border-warm-200 px-2 text-sm text-warm-900 disabled:opacity-50"
                    />
                    <span className="text-xs text-warm-500">из {item.maxPoints}</span>
                    {savedHere && (
                      <span className="text-xs text-brand-700 ml-auto" data-testid="manual-mark-saved-flag">
                        Сохранено вами
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!changed || state === "saving" || state === "saved"}
          loading={state === "saving"}
          data-testid="manual-marks-save"
        >
          Сохранить отметки
        </Button>

        {/* Что именно сохранено — учитель должен видеть это без догадок. */}
        {state === "saved" && (
          <span className="text-xs text-brand-700" role="status" data-testid="manual-marks-saved">
            Сохранено. Отметки видны в журнале проверок и после перезагрузки страницы.
          </span>
        )}
        {state === "error" && (
          <span className="text-xs text-rose-700" role="alert" data-testid="manual-marks-error">
            {errorMessage ?? "Не удалось сохранить отметки — отметки остались в полях, попробуйте ещё раз"}
          </span>
        )}
        {/* Подсказка нужна ровно пока отметки НЕ сохранены. Формулировка
            говорит про действие, а не про беспомощность: старая
            «остаются только на этом экране» стояла рядом с кнопкой, которая
            как раз и решает эту проблему, и читалась как «зачем тогда
            кнопка». Здесь прямо назван результат — потеряете при закрытии
            вкладки. */}
        {!changed && state === "idle" && (
          <span className="text-xs text-warm-500">
            Не нажали «Сохранить отметки» — они пропадут, когда закроете вкладку.
          </span>
        )}
      </div>

      {pending > 0 && (
        <p className="text-xs text-amber-800 mt-2.5" data-testid="manual-marks-pending">
          Осталось без вашего решения: {pending}{" "}
          {plural(pending, "задание", "задания", "заданий")}. Итоговая отметка появится, когда вы
          закроете все.
        </p>
      )}
    </section>
  );
}

function indexMarks(marks: PhotoCheckManualMark[]): Record<number, ManualMarkDraft> {
  const out: Record<number, ManualMarkDraft> = {};
  for (const m of marks) {
    out[m.taskNumber] = { taskNumber: m.taskNumber, accepted: m.accepted, points: m.points };
  }
  return out;
}

/** Черновик отличается от сохранённого — значит, есть что отправлять. */
function marksDiffer(
  draft: Record<number, ManualMarkDraft>,
  saved: Record<number, ManualMarkDraft>,
): boolean {
  const keys = new Set<number>([...Object.keys(draft), ...Object.keys(saved)].map(Number));
  for (const key of keys) {
    const a = draft[key];
    const b = saved[key];
    if (!a || !b) return true;
    if (a.accepted !== b.accepted || a.points !== b.points) return true;
  }
  return false;
}
