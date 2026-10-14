"use client";

/**
 * Журнал проверок (ТЗ-19 §5.1).
 *
 * Закрывает вопрос из ТЗ: «отметка из фото-проверки никуда не пишется, даже
 * автоматическая». До этой страницы результат жил только в открытой вкладке —
 * закрыл браузер, и работы больше нет нигде.
 *
 * ОДНА страница, два состояния, а не список и отдельная страница проверки:
 * сайт собирается статически (`output: "export"`), и маршрут
 * `/journal/[checkId]` без `generateStaticParams` в выгрузку не попадает —
 * учитель получил бы 404 по ссылке «Открыть». Открытая проверка приходит
 * параметром `?check=<id>`, так же как конструктор открывается по `?photo=1`.
 *
 * Честно обрабатываем ровно четыре состояния списка, ни одного «пустого экрана»:
 *   1. грузимся      → «Загружаем…»;
 *   2. не залогинен  → предложение войти;
 *   3. API упал      → причина + кнопка «Попробовать ещё раз»;
 *   4. пусто         → объяснение, когда журнал появится.
 *
 * Вторая половина экрана (лист 3.1.6) — работы, сданные учениками по ссылке.
 * Здесь же галочка «сверять короткие ответы ИИ»: по умолчанию она снята,
 * потому что каждый вызов модели стоит денег, и решение об этом принимает
 * учитель, а не код.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CheckJournal } from "@/components/f06/CheckJournal";
import { JournalCheckView } from "@/components/f06/JournalCheckView";
import { loadJournal, type JournalEntry } from "@/lib/photo-check/journal";
import { ERROR_TEXT } from "@/lib/photo-check/api";
import {
  ANSWER_STATE_LABEL,
  ANSWER_STATE_TONE,
  SHORT_ANSWER_LLM_COST_HINT,
  answerStateHint,
  loadFormJournal,
  loadFormResponses,
  overrideAnswer,
  setShortAnswerLlm,
  type FormJournalForm,
  type FormJournalResponse,
} from "@/lib/journal/types";

type State =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "unavailable"; message: string }
  | { kind: "list"; entries: JournalEntry[] };

type FormsState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; forms: FormJournalForm[] };

/** Ответ, который учитель уже поправил, — из ответа API обновляем на месте. */
function replaceAnswer(
  responses: FormJournalResponse[],
  answerId: string,
  next: FormJournalResponse["answers"][number],
): FormJournalResponse[] {
  return responses.map((r) => ({
    ...r,
    scoreTotal: r.answers.some((a) => a.id === answerId)
      ? r.answers.reduce((sum, a) => sum + (a.id === answerId ? next.pointsAwarded : a.pointsAwarded), 0)
      : r.scoreTotal,
    answers: r.answers.map((a) => (a.id === answerId ? next : a)),
  }));
}

/**
 * Работы по формам: галочка сверки + последние работы с их вердиктами.
 *
 * Вердикт машины и вердикт учителя в интерфейсе НЕ выглядят одинаково: у
 * ответов разные бейджи («верно — проверил ИИ» и «верно — поставил учитель»),
 * и учитель может одним нажатием исправить машину.
 */
function FormWorksSection() {
  const [state, setState] = React.useState<FormsState>({ kind: "loading" });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [works, setWorks] = React.useState<Record<string, FormJournalResponse[]>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const res = await loadFormJournal();
    if (res.ok) {
      // Нет форм — блок просто не занимает место, пустого экрана не делаем.
      setState(res.forms.length > 0 ? { kind: "ready", forms: res.forms } : { kind: "hidden" });
      return;
    }
    if (res.error === "unauthorized") {
      setState({ kind: "hidden" });
      return;
    }
    setState({ kind: "unavailable", message: res.message ?? ERROR_TEXT[res.error] });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (form: FormJournalForm, enabled: boolean) => {
    setBusy(form.id);
    setNote(null);
    const res = await setShortAnswerLlm(form.id, enabled);
    setBusy(null);
    if (!res.ok) {
      setNote(res.message ?? ERROR_TEXT[res.error]);
      return;
    }
    setState((prev) =>
      prev.kind === "ready"
        ? {
            kind: "ready",
            forms: prev.forms.map((f) =>
              f.id === form.id
                ? { ...f, shortAnswerLlmEnabled: res.enabled, shortAnswerLlmEnabledAt: null }
                : f,
            ),
          }
        : prev,
    );
  };

  const open = async (form: FormJournalForm) => {
    if (openId === form.id) {
      setOpenId(null);
      return;
    }
    setOpenId(form.id);
    setWorks((prev) => ({ ...prev, [form.id]: prev[form.id] ?? [] }));
    const res = await loadFormResponses(form.id);
    if (!res.ok) {
      setNote(res.message ?? ERROR_TEXT[res.error]);
      return;
    }
    setWorks((prev) => ({ ...prev, [form.id]: res.detail.responses }));
  };

  const mark = async (formId: string, answerId: string, accepted: boolean, pointsMax: number) => {
    setBusy(answerId);
    setNote(null);
    const res = await overrideAnswer(answerId, { accepted, points: accepted ? pointsMax : 0 });
    setBusy(null);
    if (!res.ok) {
      setNote(res.message ?? ERROR_TEXT[res.error]);
      return;
    }
    setWorks((prev) => ({ ...prev, [formId]: replaceAnswer(prev[formId] ?? [], answerId, res.answer) }));
  };

  if (state.kind === "hidden" || state.kind === "loading") return null;

  if (state.kind === "unavailable") {
    return (
      <Card className="mb-6">
        <p className="text-sm text-rose-700" role="alert">
          Не удалось загрузить работы по формам. {state.message}
        </p>
      </Card>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-display font-bold text-warm-950">Работы по формам</h2>
      <p className="text-sm text-warm-600 mt-1 mb-3">
        Кто поставил отметку — ИИ или вы — видно по каждому ответу.
      </p>

      {note && (
        <p className="text-sm text-rose-700 mb-3" role="alert">
          {note}
        </p>
      )}

      <div className="space-y-3">
        {state.forms.map((form) => (
          <Card key={form.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-warm-950">{form.title}</p>
                <p className="text-sm text-warm-600">
                  {form.subject} · {form.grade} класс · работ: {form.responsesCount}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void open(form)}
              >
                {openId === form.id ? "Скрыть работы" : "Показать работы"}
              </Button>
            </div>

            {form.hasShortAnswers && (
              <div className="mt-3 rounded-lg border border-warm-100 bg-warm-50 px-3 py-2.5">
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.shortAnswerLlmEnabled}
                    disabled={busy === form.id}
                    onChange={(e) => void toggle(form, e.target.checked)}
                  />
                  <span className="text-sm text-warm-900">
                    Сверять короткие ответы ИИ
                    <span className="block text-xs text-warm-600 mt-0.5">
                      {SHORT_ANSWER_LLM_COST_HINT} Работы, которые уже сдали, останутся
                      как есть — сверка пойдёт только по новым.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {openId === form.id && (
              <div className="mt-3 space-y-4">
                {(works[form.id] ?? []).length === 0 ? (
                  <p className="text-sm text-warm-600">
                    {busy === form.id ? "Загружаем работы…" : "По этой форме пока нет работ."}
                  </p>
                ) : (
                  (works[form.id] ?? []).map((response) => (
                    <div key={response.id} className="rounded-lg border border-warm-100 p-3">
                      <p className="text-sm font-medium text-warm-950">
                        {response.studentName}
                        {response.studentLabel ? ` · ${response.studentLabel}` : ""}
                        <span className="ml-2 font-normal text-warm-600">
                          {response.scoreTotal} из {response.scoreMax}
                        </span>
                      </p>
                      <ul className="mt-2 space-y-2">
                        {response.answers.map((answer) => (
                          <li key={answer.id} className="rounded-lg bg-warm-50 px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm text-warm-900">
                                №{answer.taskNumber}: {answer.studentAnswer ?? "—"}
                              </span>
                              <Badge tone={ANSWER_STATE_TONE[answer.state]}>
                                {ANSWER_STATE_LABEL[answer.state]}
                              </Badge>
                            </div>

                            {answerStateHint(answer) && (
                              <p className="mt-1 text-xs text-warm-600">{answerStateHint(answer)}</p>
                            )}

                            {/* Кнопки правки — только там, где ждут решения машина или
                                «неуверенность». Задания, посчитанные без модели (число,
                                вариант), правки не требуют и не должны шуметь в списке. */}
                            {answer.checkMethod !== "auto" &&
                              answer.state !== "teacher_correct" &&
                              answer.state !== "teacher_incorrect" && (
                                <div className="mt-2 flex gap-2">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy === answer.id}
                                    onClick={() => void mark(form.id, answer.id, true, answer.pointsMax)}
                                  >
                                    Засчитать
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy === answer.id}
                                    onClick={() => void mark(form.id, answer.id, false, answer.pointsMax)}
                                  >
                                    Не засчитать
                                  </Button>
                                </div>
                              )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * `useSearchParams()` при `output: "export"` требует границы <Suspense> выше
 * себя, иначе Next не может пререндерить страницу. Обёртка вынесена в
 * отдельную функцию именно поэтому — так же сделано в `app/form` и
 * `app/oge`.
 */
function JournalView() {
  const searchParams = useSearchParams();
  const checkId = searchParams.get("check");
  const [state, setState] = React.useState<State>({ kind: "loading" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const res = await loadJournal(20);
    if (res.ok) {
      setState({ kind: "list", entries: res.entries });
      return;
    }
    if (res.error === "unauthorized") {
      setState({ kind: "unauthorized" });
      return;
    }
    setState({ kind: "unavailable", message: res.message ?? ERROR_TEXT[res.error] });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Открытая проверка — это другая задача экрана, поэтому список под ней не
  // грузим: лишний запрос, который учителю ничего не покажет.
  if (checkId) {
    return <JournalCheckView checkId={checkId} />;
  }

  return (
    <div className="container-tight py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-display font-bold text-warm-950">Журнал проверок</h1>
        <p className="text-sm text-warm-600 mt-1">
          Все работы, проверенные по фото, с отметкой и пометкой, кто её поставил.
        </p>
      </header>

      {/* Работы по формам — вторая половина журнала (лист 3.1.6). Сама себя
          прячет, если форм нет или учитель не входил: пустого экрана не делаем. */}
      <FormWorksSection />

      {state.kind === "loading" && (
        <p className="text-sm text-warm-600" role="status">
          Загружаем журнал…
        </p>
      )}

      {state.kind === "unauthorized" && (
        <Card>
          <p className="text-sm text-warm-900">Журнал доступен после входа в аккаунт.</p>
          <Button as="link" href="/login" variant="primary" size="md" className="mt-3">
            Войти
          </Button>
        </Card>
      )}

      {state.kind === "unavailable" && (
        <Card>
          <p className="text-sm text-rose-700" role="alert">
            Не удалось загрузить журнал. {state.message}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            className="mt-3"
          >
            Попробовать ещё раз
          </Button>
        </Card>
      )}

      {state.kind === "list" && state.entries.length === 0 && (
        <Card>
          <p className="text-sm text-warm-900">Журнал пока пуст.</p>
          <p className="text-sm text-warm-600 mt-1">
            Здесь появятся работы, которые вы проверили по фото, — с отметкой и
            пометкой, поставил её ИИ или вы сами.
          </p>
          <Button as="link" href="/constructor?photo=1" variant="primary" size="md" className="mt-4">
            Проверить первую работу
          </Button>
        </Card>
      )}

      {state.kind === "list" && state.entries.length > 0 && (
        <CheckJournal entries={state.entries} />
      )}
    </div>
  );
}

export default function JournalPage() {
  return (
    <React.Suspense
      fallback={
        <div className="container-tight py-8 sm:py-12">
          <p className="text-sm text-warm-600" role="status">
            Открываем журнал…
          </p>
        </div>
      }
    >
      <JournalView />
    </React.Suspense>
  );
}
