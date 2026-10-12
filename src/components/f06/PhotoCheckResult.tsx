"use client";

/**
 * Результат проверки работ по фото (TZ-11 §3, шаг 5).
 *
 * Главное правило отображения: «ИИ не уверен» — это НЕ «неправильно».
 * Поэтому у нас три визуальных состояния, а не два:
 *   ✅ correct   — зелёная отметка
 *   ❌ incorrect — красная отметка, ИИ УВЕРЕН что ответ неверный
 *   ⚠️ unclear   — жёлтая отметка, ИИ НЕ смог разобрать → учитель смотрит сам
 *
 * Строки ⚠️ помечены и цветом, и текстом («Не разобрал») — различать только
 * цветом нельзя (ТЗ §11, a11y).
 *
 * Колонка «Кто поставил» — переработка флоу: метки «ИИ» и «вы» словами, а
 * поправленная строка показывает обе отметки (прежняя зачёркнута, новая рядом)
 * и подпись «было: ИИ». Разметка меток вынесена в `MarkAttribution`, потому
 * что журнал показывает то же самое.
 *
 * МОБИЛЬНАЯ ВЁРСТКА: на телефоне шесть колонок не помещаются, а горизонтальная
 * прокрутка таблицы учителю неудобна — телефон чаще всего в руке. Поэтому ниже
 * sm показывается список карточек с теми же данными, начиная с отметки.
 */

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { InterviewQuestions } from "@/components/f06/InterviewQuestions";
import {
  MarkBadges,
  WhoCell,
  WhoLabel,
  markAttribution,
} from "@/components/f06/MarkAttribution";
import { plural } from "@/lib/utils/cn";
import type { PhotoCheckItem, PhotoCheckResult, PhotoVerdict } from "@/lib/photo-check/types";

export interface PhotoCheckResultViewProps {
  result: PhotoCheckResult;
  onDeletePhoto: () => void;
  onPrint: () => void;
  deleting?: boolean;
  /** ID проверки. Без него панель «Спроси ученика» не рисуется (F-06.1). */
  checkId?: string;
  /** «Проверить ещё одну работу» — сброс панели к загрузке фото. */
  onStartOver?: () => void;
}

export function PhotoCheckResultView({
  result,
  onDeletePhoto,
  onPrint,
  deleting = false,
  checkId,
  onStartOver,
}: PhotoCheckResultViewProps) {
  const { items, earnedPoints, totalPoints, percentage, gradeMark, needsReview } = result;
  const reviewItems = items.filter((i) => i.verdict === "unclear");

  // Модельный снимок сервер присылает всегда; дефолт нужен только ради типов
  // и на случай старого ответа без этого поля.
  const modelResult = result.modelResult ?? {
    totalPoints: result.totalPoints,
    earnedPoints: result.earnedPoints,
    percentage: result.percentage,
    gradeMark: result.gradeMark,
  };

  const teacherCount = items.filter((i) => i.decidedBy === "teacher").length;
  const changedCount = items.filter((i) => markAttribution(i).changed).length;

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
          {teacherCount > 0 && (
            <Badge tone="brand" className="text-sm">
              вы правили вручную
            </Badge>
          )}
        </div>

        {/* Строка «что предложила модель» — из серверного снимка: через месяц
            по ней видно, что предлагала машина, даже когда учитель со всем
            согласился. */}
        <p className="text-xs text-warm-600 mt-1.5">
          {needsReview
            ? "Часть заданий модель не смогла разобрать — посмотрите их сами."
            : "Что предложила модель:"}{" "}
          <span className="text-warm-800">
            {modelResult.earnedPoints} из {modelResult.totalPoints}
            {modelResult.gradeMark ? ` · оценка ${modelResult.gradeMark}` : ""}
          </span>
          .{" "}
          {teacherCount > 0
            ? `ставили сами: ${teacherCount} ${plural(teacherCount, "задание", "задания", "заданий")}${
                changedCount > 0 ? ", итог пересчитан" : ""
              }.`
            : "проверяли её отметки: ИИ."}
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

      {/* ── Таблица по заданиям: широкий экран ───────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-warm-500 border-b border-warm-200">
              <th scope="col" className="py-2 pr-2 font-medium w-8">№</th>
              <th scope="col" className="py-2 pr-3 font-medium">Задание</th>
              <th scope="col" className="py-2 pr-3 font-medium">Ответ ученика</th>
              <th scope="col" className="py-2 pr-3 font-medium w-56">Отметка</th>
              <th scope="col" className="py-2 pr-2 font-medium w-32">Кто поставил</th>
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

      {/* ── Телефон: те же строки карточками, начиная с отметки ──────────── */}
      <ul className="sm:hidden space-y-2.5">
        {items.map((item) => (
          <li key={item.number}>
            <MobileRow item={item} />
          </li>
        ))}
      </ul>

      {/* ── Спроси ученика (F-06.1) ───────────────────────────────────── */}
      {/* Между таблицей и кнопками печати: учитель дочитал задания, увидел
          спорные строки — и сразу получил вопросы к ним. */}
      <InterviewQuestions result={result} checkId={checkId} />

      {/* ── Что делать дальше ────────────────────────────────────────────── */}
      {/* Следующий шаг назван словами, а не оставлен на догадки. */}
      <div className="rounded-2xl border border-warm-100 bg-warm-50 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-warm-700 m-0 max-w-2xl">
          {changedCount > 0
            ? "Поправленная отметка остаётся в работе: рядом видно, что предложила модель и что поставили вы."
            : "Нажмите на отметку, если хотите решить по-своему: старая останется на месте, рядом появится ваша."}
        </p>
        <div className="flex flex-wrap gap-2 no-print">
          <Button type="button" variant="secondary" size="sm" onClick={onPrint}>
            Печать / PDF
          </Button>
          {onStartOver && (
            <Button type="button" size="sm" onClick={onStartOver}>
              Проверить ещё одну работу
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 no-print">
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

      {/* Журнал — тихой строкой, а не ещё одной кнопкой: это факт, а не
          следующий шаг. */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <p className="text-xs text-warm-500 m-0 flex items-center gap-2">
          <span aria-hidden className="w-[7px] h-[7px] rounded-full bg-warm-400 shrink-0" />
          Сохранено в журнал проверок.
        </p>
        <Button as="link" href="/journal" variant="ghost" size="sm">
          Открыть журнал
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
  const { byTeacher, modelVerdict, changed } = markAttribution(item);

  return (
    <tr
      className={
        changed
          ? "bg-brand-50"
          : item.verdict === "unclear"
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
        {/* Обе отметки при правке: прежняя зачёркнута, новая рядом. */}
        <MarkBadges
          verdict={item.verdict}
          modelVerdict={modelVerdict}
          changed={changed}
          withIcons
        />
      </td>
      <td className="py-2.5 pr-2 align-top">
        {/* ЧЬЁ это решение (ТЗ-19). На распечатке остаётся слово, а не только
            цвет: по бумаге через месяц видно, что поставил учитель, а что
            предложила машина. */}
        <WhoCell byTeacher={byTeacher} changed={changed} />
      </td>
      <td className="py-2.5 pr-2 align-top text-right text-warm-900 tabular-nums">
        {item.pointsAwarded}/{item.maxPoints}
      </td>
    </tr>
  );
}

/**
 * Строка на телефоне. Отметка идёт первой — это то, ради чего строку открывают.
 * Колонки не «сжимаются», а перечисляются словами, поэтому карточка не
 * разъезжается ни на каком экране.
 */
function MobileRow({ item }: { item: PhotoCheckItem }) {
  const { byTeacher, modelVerdict, changed } = markAttribution(item);

  return (
    <div
      className={
        changed
          ? "rounded-xl border border-brand-200 bg-brand-50 p-3.5"
          : item.verdict === "unclear"
            ? "rounded-xl border border-amber-200 bg-amber-50/60 p-3.5"
            : "rounded-xl border border-warm-200 bg-white p-3.5"
      }
    >
      <p className="text-sm text-warm-500 m-0">
        Задание {item.number}
        {item.studentAnswer ? ` · ответ: ${item.studentAnswer}` : " · ответ не распознано"}
      </p>
      <p className="text-sm text-warm-900 mt-0.5 mb-2">{item.taskText}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <MarkBadges
          verdict={item.verdict}
          modelVerdict={modelVerdict}
          changed={changed}
        />
        <span className="text-sm text-warm-900 tabular-nums">
          {item.pointsAwarded}/{item.maxPoints}
        </span>
      </div>

      <p className="text-xs text-warm-600 mt-2 mb-0 flex items-center gap-1.5">
        <span className="whitespace-nowrap">Кто поставил:</span>
        <WhoLabel byTeacher={byTeacher} />
      </p>
      {changed && (
        <p className="text-xs text-warm-600 mt-0.5 mb-0 flex items-center gap-1.5">
          <span className="whitespace-nowrap">было:</span>
          <WhoLabel byTeacher={false} className="font-normal" />
        </p>
      )}
    </div>
  );
}