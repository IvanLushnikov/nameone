"use client";

/**
 * Клиентская часть страницы ученика (TZ-12, этап 3).
 *
 * Оборачивается в `<Suspense>` в `page.tsx` — Next.js 14 при `output: "export"`
 * не даёт пререндерить компонент с `useSearchParams()` без границы. Ровно тот же
 * приём, что в `src/app/auth/callback/`.
 *
 * Состояния (ТЗ §4.4, таблица файлов):
 *   loading    — скелетон «Загружаем задания…» (статика + клиентский фетч).
 *   needCode   — учитель задал код класса: сначала код, потом имя.
 *   needName   — одно поле «Как тебя зовут?». Пустое имя блокирует отправку
 *                (DoD фронта) — поэтому валидируем здесь, а не на сабмите.
 *   answering  — задания + прогресс-бар.
 *   submitted  — «Готово! 7 из 10 заданий · 18 баллов из 25».
 *   error      — все непонятные ситуации (битый токен, закрытая форма, сеть).
 *
 * Правила, которые нельзя нарушать:
 *   - эталонных ответов на клиенте нет и не появляется (ТЗ §4.3);
 *   - повторная отправка блокируется на время запроса: одна отправка = одна попытка;
 *   - любой экран ошибки показывает текст, а не белый экран.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TaskInput } from "@/components/form/TaskInput";
import { ProgressBar } from "@/components/form/ProgressBar";
import { loadPublicForm, submitPublicForm } from "@/lib/forms/api";
import {
  FORM_ERROR_MESSAGE,
  type PublicForm,
  type SubmitFormOk,
} from "@/lib/forms/types";
import { cn } from "@/lib/utils/cn";

type Phase = "loading" | "needCode" | "needName" | "answering" | "submitted" | "error";

export function FormRunner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("t");

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [form, setForm] = React.useState<PublicForm | null>(null);
  const [result, setResult] = React.useState<SubmitFormOk | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [answers, setAnswers] = React.useState<Record<number, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  /** Ошибка отправки, не выкидывающая ученика с заполненного листа. */
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!token) {
      setErrorMessage(
        "Ссылка неполная — не хватает кода формы. Откройте ссылку целиком или попросите учителя прислать её ещё раз",
      );
      setPhase("error");
      return;
    }
    setPhase("loading");
    setErrorMessage("");
    const res = await loadPublicForm(token);
    if (!res.ok) {
      setErrorMessage(FORM_ERROR_MESSAGE[res.error]);
      setPhase("error");
      return;
    }
    setForm(res.form);
    setPhase(res.form.needsCode ? "needCode" : "needName");
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const answeredCount = React.useMemo(() => {
    if (!form) return 0;
    return form.tasks.filter((t) => (answers[t.number] ?? "").trim() !== "").length;
  }, [form, answers]);

  const handleSetAnswer = React.useCallback((number: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [number]: value }));
  }, []);

  const handleStart = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Напишите, как вас зовут — так учитель поймёт, чей это ответ");
      return;
    }
    if (trimmed.length > 100) {
      setNameError("Слишком длинное имя, достаточно 100 символов");
      return;
    }
    setNameError(null);
    setPhase("answering");
  };

  const handleCodeOk = () => {
    if (!code.trim()) {
      setCodeError("Введите код, который написал учитель на доске");
      return;
    }
    setCodeError(null);
    setPhase("needName");
  };

  const handleSubmit = async () => {
    if (!token || !form || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const payload = form.tasks
      .map((t) => ({ taskNumber: t.number, value: answers[t.number] ?? "" }))
      .filter((a) => a.value.trim() !== "");

    const res = await submitPublicForm(token, {
      studentName: name.trim(),
      studentCode: code.trim() || undefined,
      answers: payload,
    });

    if (res.ok) {
      setResult(res);
      setPhase("submitted");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    // Неверный код класса — возвращаем на экран кода, а не в общую ошибку.
    if (res.error === "code_required") {
      setCodeError(FORM_ERROR_MESSAGE.code_required);
      setPhase("needCode");
      return;
    }
    // Форму закрыли / срок вышел / битый токен — продолжать заполнять бессмысленно.
    if (res.error === "closed" || res.error === "expired" || res.error === "not_found") {
      setErrorMessage(FORM_ERROR_MESSAGE[res.error]);
      setPhase("error");
      return;
    }
    // Сеть и 5xx — оставляем ученика на заполненном листе, он нажмёт ещё раз.
    setSubmitError(FORM_ERROR_MESSAGE[res.error]);
  };

  /* ─── экраны ─────────────────────────────────────────────────────────── */

  if (phase === "loading") return <LoadingScreen />;

  if (phase === "error") {
    return (
      <Shell>
        <Card className="text-center" data-testid="form-error">
          <h1 className="text-xl font-semibold text-warm-950">Не получилось открыть</h1>
          <p className="mt-2 text-sm text-warm-600">{errorMessage}</p>
          <div className="mt-5">
            <Button variant="secondary" onClick={() => void load()}>
              Попробовать ещё раз
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  if (phase === "submitted" && form && result) {
    return <SubmittedScreen form={form} result={result} name={name} />;
  }

  if (!form) return <LoadingScreen />;

  const header = (
    <div className="mb-4">
      <h1 className="text-xl font-semibold text-warm-950 break-words">{form.title}</h1>
      <p className="text-sm text-warm-500 mt-1 break-words">
        {form.subject}
        {form.grade ? ` · ${form.grade} класс` : ""}
        {form.teacherLabel ? ` · ${form.teacherLabel}` : ""}
      </p>
    </div>
  );

  if (phase === "needCode") {
    return (
      <Shell>
        <Card>
          {header}
          <p className="text-sm text-warm-600 mb-4">
            Учитель задал код для этого класса. Он написан на доске.
          </p>
          <Input
            label="Код урока"
            // text-base (16px), а не унаследованные 14px из Input: на iOS Safari
            // фокус на поле меньше 16px зумит страницу, и после закрытия клавиатуры
            // остаётся увеличенный масштаб. Ровно та же причина, по которой
            // TaskInput.tsx не использует text-sm на полях заданий — согласованно
            // с теми полями, чтобы ученик не ловил зум то на имени, то на ответе.
            className="text-base"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (codeError) setCodeError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCodeOk();
            }}
            error={codeError ?? undefined}
            placeholder="Например, 5А"
            autoComplete="off"
            data-testid="form-code"
          />
          <Button className="mt-4 w-full" size="lg" fullWidth onClick={handleCodeOk}>
            Дальше
          </Button>
        </Card>
      </Shell>
    );
  }

  if (phase === "needName") {
    return (
      <Shell>
        <Card>
          {header}
          <p className="text-sm text-warm-600 mb-4">
            Ответьте на задания с телефона. Регистрация не нужна — достаточно имени.
          </p>
          <Input
            label="Как тебя зовут?"
            className="text-base"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleStart();
            }}
            error={nameError ?? undefined}
            placeholder="Например, Аня"
            autoComplete="off"
            data-testid="form-name"
          />
          <Button className="mt-4 w-full" size="lg" fullWidth onClick={handleStart}>
            Начать
          </Button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {header}
      <div className="space-y-3" data-form-tasks="" data-testid="form-tasks">
        {form.tasks.map((task) => (
          <Card key={task.number} padded>
            <div className="flex items-start gap-2 mb-3">
              <span className="shrink-0 w-7 h-7 rounded-lg bg-brand-100 text-brand-800 grid place-items-center text-sm font-semibold">
                {task.number}
              </span>
              <p className="text-base text-warm-950 break-words min-w-0">{task.text}</p>
            </div>
            <TaskInput
              task={task}
              value={answers[task.number] ?? ""}
              onChange={(v) => handleSetAnswer(task.number, v)}
            />
            {task.points > 0 && (
              <p className="mt-2 text-xs text-[color:var(--text-muted)]">{task.points} балл.</p>
            )}
          </Card>
        ))}
      </div>

      <ProgressBar
        answered={answeredCount}
        total={form.tasks.length}
        onSubmit={() => void handleSubmit()}
        submitting={submitting}
        message={submitError}      />
    </Shell>
  );
}

/* ─── подкомпоненты ─────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-tight py-6 sm:py-10 max-w-2xl mx-auto">
      {children}
      <noscript>
        <p className="mt-6 text-sm text-warm-600">
          Для прохождения заданий нужен браузер с включённым JavaScript.
        </p>
      </noscript>
    </div>
  );
}

/** Скелетон первой секунды: ученик с мобильного интернета видит не пустоту. */
function LoadingScreen() {
  return (
    <Shell>
      <div className="space-y-3" data-testid="form-loading" aria-busy="true">
        <p className="text-center text-sm text-warm-500 mb-2">Загружаем задания…</p>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="animate-pulse">
            <div className="h-4 w-2/3 rounded bg-warm-100 mb-3" />
            <div className="h-12 w-full rounded-xl bg-warm-100" />
          </Card>
        ))}
      </div>
    </Shell>
  );
}

function SubmittedScreen({
  form,
  result,
  name,
}: {
  form: PublicForm;
  result: SubmitFormOk;
  name: string;
}) {
  const statusByTask = new Map(result.perTask.map((p) => [p.taskNumber, p.status]));
  const solved = result.perTask.filter((p) => p.status === "correct").length;

  return (
    <Shell>
      <Card className="text-center" data-testid="form-submitted">
        <div className="w-14 h-14 rounded-2xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand">
          <span className="text-2xl font-bold" aria-hidden>
            ✓
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-warm-950">Готово!</h1>
        <p className="mt-2 text-warm-700" data-testid="form-result-summary">
          {name}: {solved} из {form.tasks.length}{" "}
          {form.tasks.length === 1 ? "задания" : "заданий"} · {result.scoreTotal} баллов из{" "}
          {result.scoreMax}
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {form.tasks.map((t) => {
            const status = statusByTask.get(t.number);
            return (
              <span
                key={t.number}
                className={cn(
                  "w-9 h-9 rounded-xl grid place-items-center text-sm font-semibold",
                  status === "correct" && "bg-emerald-100 text-emerald-800",
                  status === "wrong" && "bg-rose-100 text-rose-800",
                  (!status || status === "unreviewed") && "bg-warm-100 text-warm-600",
                )}
                title={`Задание ${t.number}`}
              >
                {status === "correct" ? "✓" : status === "wrong" ? "✗" : "?"}
              </span>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-warm-500">
          «?» — задание учитель проверит сам. Можно закрыть браузер.
        </p>
      </Card>

      {(result.answers ?? []).length > 0 && (
        <div className="mt-4 space-y-3">
          {(result.answers ?? []).map((a) => (
            <Card key={a.taskNumber}>
              <p className="font-medium text-warm-950">Задание {a.taskNumber}</p>
              {a.answer && (
                <p className="mt-1 text-sm text-warm-700">
                  Правильный ответ: <span className="font-medium">{a.answer}</span>
                </p>
              )}
              {a.explanation && (
                <p className="mt-1 text-sm text-warm-600">{a.explanation}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
