"use client";

/**
 * Результат проверки работ по фото (TZ-11 §3, шаг 5).
 *
 * Главное правило отображения: «ИИ не уверен» — это НЕ «неправильно».
 * Поэтому у нас три визуальных состояния, а не два:
 *   ✅ correct   — зелёная строка
 *   ❌ incorrect — красная строка, ИИ УВЕРЕН что ответ неверный
 *   ⚠️ unclear   — жёлтая строка, ИИ НЕ смог разобрать → учитель смотрит сам
 *
 * Строки ⚠️ помечены и цветом, и текстом («Не разобрал») — различать только
 * цветом нельзя (ТЗ §11, a11y).
 */

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { InterviewQuestions } from "@/components/f06/InterviewQuestions";
import type { PhotoCheckItem, PhotoCheckResult, PhotoVerdict } from "@/lib/photo-check/types";

export interface PhotoCheckResultViewProps {
  result: PhotoCheckResult;
  onDeletePhoto: () => void;
  onPrint: () => void;
  deleting?: boolean;
  /** ID проверки. Без него панель «Спроси ученика» не рисуется (F-06.1). */
  checkId?: string;
}

const VERDICT_LABEL = {
  correct: "Верно",
  incorrect: "Неверно",
  unclear: "Не разобрал",
} as const satisfies Record<PhotoVerdict, string>;

export function PhotoCheckResultView({
  result,
  onDeletePhoto,
  onPrint,
  deleting = false,
  checkId,
}: PhotoCheckResultViewProps) {
  const { items, earnedPoints, totalPoints, percentage, gradeMark, needsReview } = result;
  const reviewItems = items.filter((i) => i.verdict === "unclear");

  return (
    <div className="space-y-5">
      {/* ── Итог ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-warm-100 bg-warm-50 p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold text-warm-950">
            {earnedPoints} из {totalPoints}
          </span>
          {percentage !== null && (
            <span className="text-lg text-warm-700">{percentage}%</span>
          )}
          {gradeMark && (
            <Badge tone="brand" className="text-sm">
              оценка {gradeMark}
            </Badge>
          )}
        </div>
        <p className="text-xs text-warm-600 mt-1.5">
          {needsReview
            ? "Часть заданий модель не смогла разобрать — отмечены ⚠️, посмотрите их сами."
            : "Все задания распознаны и сверены с эталоном."}
        </p>
      </div>

      {/* ── Что перепроверить ────────────────────────────────────────────── */}
      {reviewItems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <p className="text-sm font-medium text-amber-950">
            Нужно перепроверить: {reviewItems.length}
          </p>
          <p className="text-xs text-amber-900 mt-1">
            Это НЕ ошибки ученика. Модель не смогла прочитать почерк — балл за эти
            задания не начислен, оценку по ним ставите вы.
          </p>
        </div>
      )}

      {/* ── Таблица по заданиям ──────────────────────────────────────────── */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-warm-500 border-b border-warm-200">
              <th scope="col" className="py-2 pr-2 font-medium w-8">№</th>
              <th scope="col" className="py-2 pr-3 font-medium">Задание</th>
              <th scope="col" className="py-2 pr-3 font-medium">Ответ ученика</th>
              <th scope="col" className="py-2 pr-3 font-medium w-24">Вердикт</th>
              <th scope="col" className="py-2 pr-2 font-medium w-16">Решил</th>
              <th scope="col" className="py-2 pr-2 font-medium w-14 text-right">Балл</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Row key={item.number} item={item} />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Спроси ученика (F-06.1) ───────────────────────────────────── */}
      {/* Между таблицей и кнопками печати: учитель дочитал задания, увидел
          спорные строки — и сразу получил вопросы к ним. */}
      <InterviewQuestions result={result} checkId={checkId} />

      {/* ── Действия ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 no-print">
        <Button type="button" variant="secondary" size="sm" onClick={onPrint}>
          Печать / PDF
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDeletePhoto}
          loading={deleting}
        >
          Удалить фото
        </Button>
      </div>

      <p className="text-xs text-warm-500">
        Фото хранится 7 дней, затем удаляется автоматически. Результаты проверки
        остаются в аккаунте.
      </p>
    </div>
  );
}

function Row({ item }: { item: PhotoCheckItem }) {
  const tone =
    item.verdict === "correct" ? "success" : item.verdict === "incorrect" ? "danger" : "warm";
  const icon = item.verdict === "correct" ? "✅" : item.verdict === "incorrect" ? "❌" : "⚠️";
  // `decidedBy`/`modelVerdict` необязательны в типе: ответ старого бека или
  // тестовая фикстура без них не должны ломать таблицу. Отсутствие поля
  // читается как «решила машина» — это и было поведением до ТЗ-19.
  const byTeacher = item.decidedBy === "teacher";
  const modelVerdict: PhotoVerdict = item.modelVerdict ?? item.verdict;
  const changed = byTeacher && modelVerdict !== item.verdict;

  return (
    <tr
      className={
        item.verdict === "unclear"
          ? "bg-amber-50/60"
          : "border-b border-warm-100"
      }
    >
      <td className="py-2.5 pr-2 text-warm-500 align-top">{item.number}</td>
      <td className="py-2.5 pr-3 align-top text-warm-900">
        <span className="line-clamp-2">{item.taskText}</span>
        {item.comment && (
          <span className="block text-xs text-warm-600 mt-0.5">{item.comment}</span>
        )}
      </td>
      <td className="py-2.5 pr-3 align-top text-warm-800">
        {item.studentAnswer ?? <span className="text-[color:var(--text-muted)]">не распознано</span>}
      </td>
      <td className="py-2.5 pr-3 align-top">
        {/* Текст рядом с иконкой — состояние не различается только цветом. */}
        <Badge tone={tone}>
          <span aria-hidden>{icon}</span>
          {VERDICT_LABEL[item.verdict]}
        </Badge>
      </td>
      <td className="py-2.5 pr-2 align-top">
        {/* ЧЬЁ это решение (ТЗ-19). На распечатке остаётся слово, а не только
            цвет: по бумаге через месяц видно, что поставил учитель, а что
            предложила машина. Без этой колонки «выгрузка» обманывала бы —
            все отметки выглядели бы одинаково. */}
        <span className={byTeacher ? "font-medium text-warm-950" : "text-warm-600"}>
          {byTeacher ? "вы" : "ИИ"}
        </span>
        {changed && (
          <span className="block text-xs text-warm-500 mt-0.5">
            ИИ считал: {VERDICT_LABEL[modelVerdict]}
          </span>
        )}
      </td>
      <td className="py-2.5 pr-2 align-top text-right text-warm-900 tabular-nums">
        {item.pointsAwarded}/{item.maxPoints}
      </td>
    </tr>
  );
}
