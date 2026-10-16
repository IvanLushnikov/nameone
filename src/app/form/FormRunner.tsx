"use client";

/**
 * Клиентская часть страницы ученика (TZ-12, этап 3).
 *
 * Раньше оборачивался в `<Suspense>` в `page.tsx` — Next.js 14 при `output: "export"`
 * не даёт пререндерить компонент с `useSearchParams()` без границы. Сейчас обёртки
 * нет: токен читается из `window.location.search` в useEffect, и страница сразу
 * рисует скелетон загрузки, а не fallback на весь экран.
 *
 * ─── ДВА РЕЖИМА, ОДНА СТРАНИЦА (ТЗ-28) ─────────────────────────────────────
 *   ?t=<токен формы>            — общая ссылка (как раньше): имя и код вводит
 *                                  сам ученик, ответ уходит под написанным именем;
 *   ?t=<токен>&c=<код класса>   — вход по коду с доски (страница /k/): личность
 *                                  подтверждена cookie, имя подставляет сервер,
 *                                  доступна съёмка фото и сохраняется черновик.
 *
 * Режим выбирается по наличию `c` в адресе. Никаких новых маршрутов: фронт
 * собирается как статика, страница одна (см. page.tsx).
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
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TaskInput } from "@/components/form/TaskInput";
import { ProgressBar } from "@/components/form/ProgressBar";
import { loadPublicForm, submitPublicForm } from "@/lib/forms/api";
import { loadCodeForm, submitCodeForm, uploadTaskPhoto } from "@/components/student/api";
import { PhotoCapture } from "@/components/student/PhotoCapture";
import { clearDraft, loadDraft, saveDraft } from "@/components/student/draft";
import {
  FORM_ERROR_MESSAGE,
  type FormTask,
  type PublicForm,
  type SubmitFormOk,
} from "@/lib/forms/types";
import { cn } from "@/lib/utils/cn";

type Phase = "loading" | "needCode" | "needName" | "answering" | "submitted" | "error";

export function FormRunner() {
  // undefined = токен ещё не прочитан из URL (эффект не отработал).
  // ВАЖНО: это НЕ `null` — `URLSearchParams.get()` возвращает null для
  // отсутствующего параметра, и такой токен обязан дать ошибку «Ссылка
  // неполная», а не крутить вечную загрузку.
  const [token, setToken] = React.useState<string | undefined>(undefined);
  // Код класса приходит со страницы /k/. Пустой → обычная общая ссылка,
  // всё поведение остаётся ровно прежним.
  const [classCode, setClassCode] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("t") ?? "");
    setClassCode(params.get("c") ?? "");
  }, []);

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [form, setForm] = React.useState<PublicForm | null>(null);
  const [result, setResult] = React.useState<SubmitFormOk | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");

  const [name, setName] = React.useState("");
  /** Имя из черновика — на финальном экране в режиме кода. */
  const [studentName, setStudentName] = React.useState("");
  const [draftRestored, setDraftRestored] = React.useState(false);


  const [code, setCode] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [answers, setAnswers] = React.useState<Record<number, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  /** Номер задания → ключ загруженного фото (только режим кода класса). */
  const [photos, setPhotos] = React.useState<Record<number, string>>({});
  /** Ошибка отправки, не выкидывающая ученика с заполненного листа. */
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (token === undefined) return;
    if (!token) {
      setErrorMessage(
        "Ссылка неполная — не хватает кода формы. Откройте ссылку целиком или попросите учителя прислать её ещё раз",
      );
      setPhase("error");
      return;
    }
    setPhase("loading");
    setErrorMessage("");

    if (classCode) {
      // Режим кода класса: cookie уже сказала серверу, кто этот ученик.
      const res = await loadCodeForm(classCode, token);
      if (!res.ok) {
        setErrorMessage(
          res.error === "network"
            ? "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз"
            : "Задания не открылись. Откройте ссылку заново или попросите учителя",
        );
        setPhase("error");
        return;
      }
      setForm({
        ...res.form,
        tasks: res.form.tasks.map((t) => ({ ...t, type: t.type as FormTask["type"] })),
        expiresAt: 0,
        needsCode: false,
      });
      restoreDraft(res.form.tasks.map((t) => t.number));
      setPhase("answering");
      return;
    }

    const res = await loadPublicForm(token);
    if (!res.ok) {
      setErrorMessage(FORM_ERROR_MESSAGE[res.error]);
      setPhase("error");
      return;
    }
    setForm(res.form);
    setPhase(res.form.needsCode ? "needCode" : "needName");
  }, [token, classCode]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const answeredCount = React.useMemo(() => {
    if (!form) return 0;
    return form.tasks.filter((t) => (answers[t.number] ?? "").trim() !== "").length;
  }, [form, answers]);

  const handleSetAnswer = React.useCallback((number: number, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [number]: value };
      persistDraft(next, photos);
      return next;
    });
  }, [photos, classCode]);

  /**
   * Восстановить черновик после загрузки заданий (ТЗ-28, сценарий 4).
   *
   * Имя для финального экрана берём тоже из черновика: сервер его не отдаёт
   * (по ссылке нельзя узнать своё имя), а ученик его только что ввёл сам.
   */
  const restoreDraft = React.useCallback((taskNumbers: number[]) => {
    if (!classCode) return;
    const draft = loadDraft(classCode);
    if (!draft) return;
    setStudentName(draft.studentName);
    // Ответы, которых больше нет в листе, НЕ восстанавливаем: они относились
    // к другой версии работы и только сбивали бы счётчик прогресса.
    const restored: Record<number, string> = {};
    for (const n of taskNumbers) {
      const value = draft.answers[String(n)];
      if (typeof value === "string" && value.trim() !== "") restored[n] = value;
    }
    if (Object.keys(restored).length > 0) {
      setAnswers(restored);
      setDraftRestored(true);
    }
  }, [classCode]);

  /** Сохранить черновик. Вне режима кода класса черновика нет — это его фича. */
  const persistDraft = React.useCallback(
    (nextAnswers: Record<number, string>, nextPhotos: Record<number, string>) => {
      if (!classCode) return;
      const draft = loadDraft(classCode);
      // Имя для финального экрана: пока ученик его не вводил, берём то, что
      // уже лежит в черновике (значит, он входил по коду раньше).
      const knownName = draft?.studentName ?? "";
      const answers: Record<string, string> = {};
      for (const [n, v] of Object.entries(nextAnswers)) {
        if (v.trim() !== "") answers[n] = v;
      }
      const photoMap: Record<string, string> = {};
      for (const [n, key] of Object.entries(nextPhotos)) photoMap[n] = key;
      saveDraft({
        code: classCode,
        studentName: knownName,
        answers,
        photos: photoMap,
        updatedAt: Date.now(),
      });
    },
    [classCode],
  );

  /**
   * Загрузить фото задания (ТЗ-28).
   *
   * Фото уходит СРАЗУ отдельным запросом, а не внутри отправки работы: так
   * обрыв связи на 4 МБ не приводит к потере уже набранных ответов.
   */
  const handlePhotoUpload = React.useCallback(
    async (taskNumber: number, blob: Blob) => {
      if (!classCode || !token) return { ok: false as const };
      const res = await uploadTaskPhoto(classCode, token, blob);
      if (!res.ok) return { ok: false as const };
      setPhotos((prev) => {
        const next = { ...prev, [taskNumber]: res.photoR2Key };
        persistDraft(answers, next);
        return next;
      });
      return { ok: true as const, photoR2Key: res.photoR2Key };
    },
    // answers нужен, чтобы положить в черновик весь набор, а не одно задание.
    [classCode, token, answers, persistDraft],
  );

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

    if (classCode) {
      // Режим кода класса: имя не отправляем, ответы идут по cookie ученика.
      const payloadCode = form.tasks
        .map((t) => ({
          taskNumber: t.number,
          value: answers[t.number] ?? "",
          ...(photos[t.number] ? { photoR2Key: photos[t.number] } : {}),
        }))
        .filter((a) => a.value.trim() !== "" || Boolean(a.photoR2Key));

      const resCode = await submitCodeForm(classCode, token, { answers: payloadCode });
      if (resCode.ok) {
        clearDraft(classCode);
        setResult({
          ok: true,
          scoreTotal: resCode.scoreTotal,
          scoreMax: resCode.scoreMax,
          perTask: resCode.perTask,
        });
        setPhase("submitted");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setSubmitError(
        resCode.error === "network"
          ? "Нет связи с сервером — ответы сохранены, попробуйте ещё раз"
          : "Отправить не получилось. Ответы сохранены — попробуйте ещё раз",
      );
      return;
    }

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
    // В режиме кода класса имя пришло из черновика, а не из поля ввода.
    return <SubmittedScreen form={form} result={result} name={classCode ? studentName || name : name} />;
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
      {draftRestored && (
        <p
          className="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900"
          data-testid="form-draft-restored"
        >
          Вернули ответы, которые вы не успели отправить в прошлый раз.
        </p>
      )}
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
            {classCode && (
              <PhotoCapture
                taskNumber={task.number}
                uploaded={Boolean(photos[task.number])}
                onUpload={handlePhotoUpload}
                onError={(m) => setSubmitError(m)}
              />
            )}
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
