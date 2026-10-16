"use client";

/**
 * Форма правки рабочего листа (ТЗ-30, работа 2, AD-2/AD-3).
 *
 * ─── ЧТО ДЕЛАЕТ ───────────────────────────────────────────────────────────
 * Показывает задания листа в редактируемых полях и сохраняет правку через
 * `PATCH /api/worksheets/:id/edit`. Сервер пересобирает лист из сохранённой
 * структуры — LLM не вызывается, квота не списывается.
 *
 * ─── ПОЧЕМУ НЕ МОЛЧИМ О ЗАКРЫТОЙ ПРАВКЕ ───────────────────────────────────
 * ТЗ-30, сценарий 2, шаг 4: если правка закрыта, под полем (рядом с кнопкой)
 * должно быть написано ПОЧЕМУ. Молча неактивная кнопка читается как поломка
 * интерфейса, и учитель тратит время на поиск причины, которой нет.
 * Поэтому причина приходит с сервера (`fetchEditCheck`) и показывается словами.
 *
 * ─── ПУСТЫЕ ПОЛЯ ──────────────────────────────────────────────────────────
 * Пустой текст задания блокирует сохранение и подсвечивает само поле:
 * учитель видит, ЧТО не так, ещё до нажатия. Пустой ответ и пустое пояснение
 * сохраняются как «убери» — сервер их удаляет, и в DOCX не остаётся
 * «Ответ: —». Проверку текста делает сервер (единый источник правил), а здесь
 * она только подсказывает, чтобы кнопка не уходила в заведомо отказной запрос.
 */

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { fetchEditCheck, patchWorksheet } from "@/lib/lk/worksheet-edit-api";
import type { Worksheet, WorksheetTask } from "@/lib/types";

interface Props {
  worksheet: Worksheet;
  /** Закрыть форму после успешного сохранения. */
  onClose: () => void;
  /** Сообщить родителю о сохранённом листе, чтобы он перерисовал превью. */
  onSaved: (worksheet: Worksheet) => void;
}

type EditableTask = {
  number: number;
  text: string;
  answer: string;
  explanation: string;
  /** ТЗ-27: метка темы. Пустая строка — «метки нет», и это осознанный выбор. */
  skill: string;
};

/** Ответ сервера → текст учителю. Ни одного «что-то пошло не так». */
function errorText(error: string, message?: string): string {
  switch (error) {
    case "locked":
      // Причину сформулировал бэк: «по этому листу уже проверена работа».
      return message ?? "по этому листу уже проверена работа — правка закрыта";
    case "unauthorized":
      return "Войдите в аккаунт, чтобы править лист";
    case "not_found":
      return "Лист не найден — возможно, это не ваш лист";
    case "validation":
      return "Проверьте задания: текст задания не может быть пустым";
    case "network":
      return "Нет связи с сервером. Правка не сохранена.";
    default:
      return "Не получилось сохранить. Попробуйте ещё раз";
  }
}

export function WorksheetEditForm({ worksheet, onClose, onSaved }: Props) {
  const [tasks, setTasks] = React.useState<EditableTask[]>(() =>
    (worksheet.tasks ?? []).map((t: WorksheetTask) => ({
      number: t.number,
      text: t.text ?? "",
      answer: t.answer ?? "",
      explanation: t.explanation ?? "",
      skill: t.skill ?? "",
    })),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lockedReason, setLockedReason] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(true);

  /**
   * ТЗ-27, ПРОБЕЛ 3: варианты метки — из САМОГО листа, а не из справочника тем.
   *
   * Почему так: метки тем в продукте нет как справочника, а список из
   * предыдущих листов учителя потребовал бы отдельного эндпоинта и лишней
   * кнопки. Соблазн «подставить метки из всех листов класса» дал бы учителю
   * чужую формулировку. Поэтому предлагаем ровно то, что уже есть в этом
   * листе: тема листа + метки его заданий. Частый случай — «все задания на одну
   * тему», и он закрывается одним выбором.
   */
  const skillOptions = React.useMemo(() => {
    const set = new Set<string>();
    if (worksheet.topic) set.add(worksheet.topic);
    for (const t of tasks) {
      const value = t.skill.trim();
      if (value) set.add(value);
    }
    return [...set];
  }, [tasks, worksheet.topic]);

  // Причину закрытой правки узнаём ДО правки, а не после отказа по «Сохранить»:
  // иначе учитель набирает текст и только затем видит, что правка невозможна.
  React.useEffect(() => {
    let cancelled = false;
    void fetchEditCheck(worksheet.id).then((res) => {
      if (cancelled) return;
      setChecking(false);
      if (!res.ok) {
        // Сервер недоступен — не блокируем форму молча: правка может быть доступна.
        return;
      }
      if (!res.data.editable) {
        setLockedReason(res.data.reason ?? "по этому листу уже проверена работа — правка закрыта");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [worksheet.id]);

  // Пустой текст задания — самая частая ошибка ввода, и её видно сразу.
  const emptyTasks = tasks.filter((t) => t.text.trim().length === 0);
  const canSave = !saving && !checking && lockedReason === null && emptyTasks.length === 0;

  const update = (index: number, patch: Partial<EditableTask>) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const res = await patchWorksheet(worksheet.id, tasks);
    setSaving(false);
    if (!res.ok) {
      setError(errorText(res.error, res.message));
      return;
    }
    // Сервер вернул пересобранный лист — рисуем именно его, чтобы учитель
    // видел результат, а не то, что он отправил.
    onSaved({ ...worksheet, ...(res.data.worksheet as Partial<Worksheet>) } as Worksheet);
    onClose();
  };

  return (
    <section className="mt-4 rounded-2xl border border-warm-200 bg-white p-4 sm:p-6 no-print">
      <h2 className="text-base font-semibold text-warm-950">Правка заданий</h2>
      <p className="mt-1 text-sm text-warm-600">
        Лист пересобирается из того, что уже сохранено. Повторное сохранение
        не списывает генерацию — за этот лист вы уже заплатили.
      </p>

      {lockedReason && (
        <p className="mt-3 rounded-xl bg-warm-100 px-4 py-3 text-sm text-warm-800">
          {lockedReason}
        </p>
      )}

      {!lockedReason && (
        <div className="mt-4 flex flex-col gap-4">
          {tasks.map((task, index) => {
            const empty = task.text.trim().length === 0;
            return (
              <div key={task.number} className="rounded-xl border border-warm-200 p-3">
                <label
                  className="text-xs font-medium uppercase tracking-wide text-warm-500"
                  htmlFor={`task-text-${index}`}
                >
                  Задание {task.number}
                </label>
                <textarea
                  id={`task-text-${index}`}
                  value={task.text}
                  rows={3}
                  onChange={(e) => update(index, { text: e.target.value })}
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-warm-950 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                    empty ? "border-red-400" : "border-warm-200"
                  }`}
                />
                {empty && (
                  <p className="mt-1 text-xs text-red-600">
                    Пустое задание не сохранится — напишите текст задания.
                  </p>
                )}

                {/* ТЗ-27, ПРОБЕЛ 3: метка темы правится ЗДЕСЬ, а не в отдельном
                    экране. Список тем листа — подсказка, а не ограничение:
                    поле своё значение принимает всегда, иначе учитель не смог бы
                    назвать тему так, как он её называет на уроке.
                    Очистка поля означает «метки нет»: разрез по этому заданию
                    тогда просто не считается, и это честнее, чем молча
                    подставить вместо неё тему листа. */}
                <div className="mt-2">
                  <label
                    className="text-xs font-medium uppercase tracking-wide text-warm-500"
                    htmlFor={`task-skill-${index}`}
                  >
                    Тема
                  </label>
                  <input
                    id={`task-skill-${index}`}
                    list={`skill-options-${index}`}
                    value={task.skill}
                    onChange={(e) => update(index, { skill: e.target.value })}
                    placeholder="например: Давление твёрдых тел"
                    className="mt-1 w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-950 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <datalist id={`skill-options-${index}`}>
                    {skillOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                  <p className="mt-1 text-xs text-warm-500">
                    По этой теме ведомость покажет, где класс просел. Пусто —
                    темы нет.
                  </p>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-warm-500"
                      htmlFor={`task-answer-${index}`}
                    >
                      Ответ
                    </label>
                    <input
                      id={`task-answer-${index}`}
                      value={task.answer}
                      onChange={(e) => update(index, { answer: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-950 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label
                      className="text-xs font-medium uppercase tracking-wide text-warm-500"
                      htmlFor={`task-expl-${index}`}
                    >
                      Пояснение
                    </label>
                    <input
                      id={`task-expl-${index}`}
                      value={task.explanation}
                      onChange={(e) => update(index, { explanation: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-950 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={!canSave}
          loading={saving}
        >
          Сохранить
        </Button>
        <Button variant="secondary" size="md" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </section>
  );
}