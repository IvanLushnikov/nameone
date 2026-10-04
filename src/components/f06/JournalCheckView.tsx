"use client";

/**
 * Открытая проверка из журнала (ТЗ-19).
 *
 * Закрывает второй открытый вопрос ТЗ: «при повторном открытии ручные отметки
 * теряются». Здесь учитель возвращается к работе позже — исправить своё
 * решение, уведеть, что предлагала машина, и распечатать разбор.
 *
 * ФИЧА НЕ КОПИЯ `PhotoCheckResultView`, а отдельный рендер с явным разделением
 * «Решение модели» / «Решение учителя». Копия была бы дешевле, но через месяц
 * именно она разъехалась бы с панелью: правка в одном месте тихо оставила бы
 * второе место с чужим текстом.
 *
 * ПОЧЕМУ ЭТО КОМПОНЕНТ, А НЕ СТРАНИЦА `/journal/[checkId]`:
 * сайт собирается статически (`output: "export"`), а такая страница требует
 * `generateStaticParams`, иначе в выгрузку она просто не попадает и учитель
 * получает 404 по ссылке «Открыть». Все остальные динамические маршруты
 * проекта умеют статически перечислить свои адреса заранее, а адреса проверок
 * заранее не перечислить можно только у пользователя. Поэтому проверка
 * открывается как `?check=<id>` на статической странице журнала — ровно так
 * же, как конструктор уже открывается по `?photo=1`.
 *
 * Про печать: `window.print()` печатает страницу целиком, а кнопки печати
 * помечены `no-print`. Подписи «ИИ» / «вы» остаются на бумаге — по распечатке
 * через месяц видно, чья это была отметка.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ManualMarksEditor, type ManualMarkDraft } from "@/components/f06/ManualMarksEditor";
import { loadPhotoCheck, saveManualMarks, ERROR_TEXT } from "@/lib/photo-check/api";
import { partitionByDecision } from "@/lib/photo-check/confidence";
import type { PhotoCheckItem, PhotoCheckResult, PhotoVerdict } from "@/lib/photo-check/types";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; result: PhotoCheckResult; marksError: string | null };

const VERDICT_LABEL: Record<PhotoVerdict, string> = {
  correct: "зачтено",
  incorrect: "не зачтено",
  unclear: "модель не разобрала",
};

export function JournalCheckView({ checkId }: { checkId: string }) {
  const [state, setState] = React.useState<State>({ kind: "loading" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const res = await loadPhotoCheck(checkId);
    if (res.ok) {
      setState({ kind: "ready", result: res, marksError: null });
      return;
    }
    setState({ kind: "error", message: res.message ?? ERROR_TEXT[res.error] });
  }, [checkId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save(marks: ManualMarkDraft[]) {
    const res = await saveManualMarks(checkId, marks);
    if (res.ok) {
      setState({ kind: "ready", result: res, marksError: null });
      return;
    }
    setState((prev) =>
      prev.kind === "ready" ? { ...prev, marksError: res.message ?? ERROR_TEXT[res.error] } : prev,
    );
    throw new Error(res.message ?? "Не удалось сохранить отметки");
  }

  if (state.kind === "loading") {
    return (
      <Frame>
        <p className="text-sm text-warm-600" role="status">
          Открываем проверку…
        </p>
      </Frame>
    );
  }

  if (state.kind === "error") {
    return (
      <Frame>
        <Card>
          <p className="text-sm text-rose-700" role="alert">
            {state.message}
          </p>
          <div className="flex gap-2 mt-3">
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              Попробовать ещё раз
            </Button>
            <Button as="link" href="/journal" variant="ghost" size="sm">
              В журнал
            </Button>
          </div>
        </Card>
      </Frame>
    );
  }

  const { result, marksError } = state;
  const marks = result.manualMarks ?? [];
  const partition = partitionByDecision(result.items, marks);
  const teacherRows = result.items.filter((i) => i.decidedBy === "teacher");
  const teacherCount = teacherRows.length;
  // Модельный снимок сервер присылает всегда; дефолт нужен только ради типов
  // и на случай старого ответа без этого поля.
  const modelResult = result.modelResult ?? {
    totalPoints: result.totalPoints,
    earnedPoints: result.earnedPoints,
    percentage: result.percentage,
    gradeMark: result.gradeMark,
  };

  return (
    <Frame>
      <header className="mb-5">
        <Button as="link" href="/journal" variant="ghost" size="sm">
          ← В журнал
        </Button>
        <h1 className="text-2xl font-display font-bold text-warm-950 mt-2">Проверка работы</h1>
      </header>

      {/* ── Итог ─────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold text-warm-950">
            {result.earnedPoints} из {result.totalPoints}
          </span>
          {result.percentage !== null && (
            <span className="text-lg text-warm-700">{result.percentage}%</span>
          )}
          {result.gradeMark && <Badge tone="brand">оценка {result.gradeMark}</Badge>}
        </div>

        {/* Отдельная строка про машину — ровно то требование «в выгрузке видно,
            что предложила машина». Она есть ВСЕГДА, даже когда учитель со всем
            согласился: иначе через месяц не отличить «ИИ ошибся» от «учитель
            не смотрел». */}
        <p className="text-xs text-warm-600 mt-2">
          Что предложила модель:{" "}
          <span className="text-warm-800">
            {modelResult.earnedPoints} из {modelResult.totalPoints}
            {modelResult.percentage !== null && ` · ${modelResult.percentage}%`}
            {modelResult.gradeMark ? ` · оценка ${modelResult.gradeMark}` : ""}
          </span>
        </p>
        <p className="text-xs text-warm-600 mt-1">
          {teacherCount > 0
            ? `Ваше решение заменило модельное по ${result.items.filter((i) => i.decidedBy === "teacher").length} ${result.items.filter((i) => i.decidedBy === "teacher").length === 1 ? "заданию" : "заданиям"}.`
            : "Вы не меняли машинный разбор."}
        </p>

        {result.gradeMark === null && (
          <p className="text-xs text-amber-800 mt-2" data-testid="check-page-pending">
            Итоговой отметки пока нет: не разобрано{" "}
            {result.pendingReview}{" "}
            {result.pendingReview === 1 ? "задание" : "заданий"}. Отметка появится, когда вы
            закроете все — молчаливый ноль здесь хуже, чем лишняя перепроверка.
          </p>
        )}

        <div className="flex gap-2 mt-4 no-print">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") window.print();
            }}
          >
            Печать / PDF
          </Button>
        </div>
      </Card>

      {/* ── Таблица с разделением ────────────────────────────────────────── */}
      <Card className="mb-4">
        <h2 className="text-sm font-semibold text-warm-950 mb-3">По заданиям</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-warm-500 border-b border-warm-200">
                <th scope="col" className="py-2 pr-2 font-medium w-8">№</th>
                <th scope="col" className="py-2 pr-3 font-medium">Задание</th>
                <th scope="col" className="py-2 pr-3 font-medium w-28">Решил</th>
                <th scope="col" className="py-2 pr-2 font-medium w-14 text-right">Балл</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <Row key={item.number} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ManualMarksEditor
        partition={partition}
        initialMarks={marks}
        onSave={save}
        errorMessage={marksError}
      />
    </Frame>
  );
}

export function Frame({ children }: { children: React.ReactNode }) {
  return <div className="container-tight py-8 sm:py-12">{children}</div>;
}

/**
 * Строка таблицы. Ключевое здесь — колонка «Решил»: слово, а не цвет.
 * Распечатка это первое, что попадёт учителю через месяц, и по ней должно быть
 * видно, чья это была отметка, даже если цвет не печатался.
 */
function Row({ item }: { item: PhotoCheckItem }) {
  const byTeacher = item.decidedBy === "teacher";
  const modelVerdict: PhotoVerdict = item.modelVerdict ?? item.verdict;
  const changed = byTeacher && modelVerdict !== item.verdict;

  return (
    <tr className={item.needsReview ? "bg-amber-50/60" : "border-b border-warm-100"}>
      <td className="py-2.5 pr-2 text-warm-500 align-top">{item.number}</td>
      <td className="py-2.5 pr-3 align-top text-warm-900">
        <span className="line-clamp-2">{item.taskText}</span>
        {item.studentAnswer && (
          <span className="block text-xs text-warm-600 mt-0.5">ответ: {item.studentAnswer}</span>
        )}
      </td>
      <td className="py-2.5 pr-3 align-top">
        <Badge tone={byTeacher ? "brand" : item.needsReview ? "warm" : "neutral"}>
          {byTeacher ? "вы" : "ИИ"}
        </Badge>
        <span className="block text-xs text-warm-600 mt-1">
          {VERDICT_LABEL[item.verdict]}
        </span>
        {/* Если учитель поправил машину — показываем, что именно было. */}
        {changed && (
          <span className="block text-xs text-warm-500 mt-0.5">
            ИИ считал: {VERDICT_LABEL[modelVerdict]}
          </span>
        )}
        {item.needsReview && !byTeacher && (
          <span className="block text-xs text-amber-800 mt-0.5">ждёт вашего решения</span>
        )}
      </td>
      <td className="py-2.5 pr-2 align-top text-right text-warm-900 tabular-nums">
        {item.pointsAwarded}/{item.maxPoints}
      </td>
    </tr>
  );
}
