"use client";

/**
 * Модалка «Выдать классу» (TZ-12, этап 4, сценарий А, шаги 2–4).
 *
 * Два состояния внутри одной модалки:
 *   1. настройки — срок жизни, код класса, показ ответов;
 *   2. готово    — QR + ссылка (`FormQrBlock`).
 *
 * Три продуктовых решения, которые здесь зашиты (ТЗ Решения 3/5, §5.1):
 *   - **код класса по умолчанию пустой** — не заставляем учителя заводить код
 *     ради простого случая (ТЗ Решение 3, вариант Б: код опционален);
 *   - **«показывать правильные ответы» по умолчанию ВЫКЛЮЧЕНО** — для
 *     контрольной работы этот переключатель раскрывает ответы всей параллели
 *     сразу после первой отправки. Включать должен учитель осознанно;
 *   - **срок 14 дней** — сценарий А, шаг 3. Лист живёт дольше одного урока, но
 *     не навсегда: бессрочная ссылка в классном чате — это вечный доступ.
 *
 * Войти обязательно (ТЗ Решение 5): ответы надо привязать к учителю в D1.
 * Если куки нет, `createForm` вернёт 401 — ловим его и объясняем, а не
 * показываем «что-то сломалось».
 */

import * as React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormQrBlock } from "./FormQrBlock";
import { createForm } from "@/lib/forms/api";
import { FORM_ERROR_MESSAGE, type FormSourceTask } from "@/lib/forms/types";
import { trackEvent } from "@/lib/track";

const EXPIRY_OPTIONS = [
  { value: "1", label: "1 день" },
  { value: "7", label: "7 дней" },
  { value: "14", label: "14 дней", description: "Обычно хватает на два урока" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней", description: "Для ВПР и четвертных" },
];

export interface ShareFormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subject: string;
  grade: number;
  /** ID сохранённого на сервере листа — если есть, бэк снимет задания сам. */
  worksheetId?: string;
  /** Снимок заданий для анонимного пути (лист ещё не сохранён на сервере). */
  tasks: FormSourceTask[];
  /** Код класса учитель уже вводил раньше — подставляем, чтобы не вводить заново. */
  initialClassCode?: string;
}

type Created = { url: string; token: string; formId: string };

export function ShareFormDialog({
  open,
  onClose,
  title,
  subject,
  grade,
  worksheetId,
  tasks,
  initialClassCode = "",
}: ShareFormDialogProps) {
  const [days, setDays] = React.useState("14");
  const [classCode, setClassCode] = React.useState(initialClassCode);
  const [showAnswers, setShowAnswers] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<Created | null>(null);

  // Модалка переоткрывают для другого листа — сбрасываем всё, что накопилось.
  React.useEffect(() => {
    if (open) {
      setDays("14");
      setClassCode(initialClassCode);
      setShowAnswers(false);
      setError(null);
      setCreated(null);
      setLoading(false);
    }
  }, [open, initialClassCode]);

  const handleCreate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    const res = await createForm({
      worksheetId,
      title,
      subject,
      grade,
      expiresInDays: Number(days),
      accessCode: classCode.trim() || undefined,
      showAnswers,
      // Если лист лежит только в браузере, отдаём задания напрямую: эталон
      // нужен серверу для сверки, но в публичный API он не попадёт.
      payload: worksheetId ? undefined : { tasks },
    });

    setLoading(false);

    if (!res.ok) {
      setError(FORM_ERROR_MESSAGE[res.error]);
      trackEvent("share_form_error", { reason: res.error });
      return;
    }

    setCreated({ url: res.url, token: res.token, formId: res.formId });
    trackEvent("share_form_created", { hasCode: Boolean(classCode.trim()), showAnswers });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={created ? "Ссылка готова" : "Выдать классу"}
      description={
        created
          ? "Покажите код на доске или отправьте ссылку в классный чат"
          : "Кому выдаём этот лист и как долго будет жить ссылка"
      }
      footer={
        created ? (
          <Button variant="secondary" size="md" fullWidth onClick={onClose}>
            Готово
          </Button>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={loading}
              onClick={() => void handleCreate()}
              data-testid="share-form-create"
            >
              Создать ссылку
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <FormQrBlock
          url={created.url}
          title={title}
          subject={subject}
          grade={grade}
          classCode={classCode.trim() || null}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="block mb-1.5 text-sm font-medium text-warm-700">Срок жизни ссылки</p>
            <Select
              options={EXPIRY_OPTIONS}
              value={days}
              onChange={setDays}
              data-testid="share-form-days"
            />
            <p className="mt-1.5 text-xs text-warm-500">
              После срока ссылка перестаёт работать, собранные ответы останутся у вас.
            </p>
          </div>

          <Input
            label="Код класса (необязательно)"
            hint="Например, 5А. Напишите его на доске — ученики вводят при входе."
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
            placeholder="5А"
            maxLength={16}
            autoComplete="off"
            data-testid="share-form-code"
          />

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showAnswers}
              onChange={(e) => setShowAnswers(e.target.checked)}
              className="w-5 h-5 mt-0.5 accent-brand-500 shrink-0"
              data-testid="share-form-show-answers"
            />
            <span className="text-sm text-warm-700">
              Показывать правильные ответы после отправки
              <span className="block text-xs text-warm-500 mt-0.5">
                По умолчанию выключено. Если это контрольная — не включайте: все
                увидят ответы сразу после первой сдачи.
              </span>
            </span>
          </label>

          {error && (
            <p className="text-sm text-rose-600" data-testid="share-form-error">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
