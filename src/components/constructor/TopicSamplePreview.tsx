"use client";

/**
 * Шаг 4 конструктора: что выбрано + настоящие примеры по выбранной теме.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ (UL-I01)
 * ─────────────────────────────────────────────────────────────────────────────
 * На шаге «настройка» учитель видел общий рекламный превью: иллюстрацию
 * формата и общие слова. Ничего из этого не говорило о ТОМ, что он выбрал.
 * Теперь на этом шаге — сводка выбранных параметров и до двух НАСТОЯЩИХ
 * примеров из каталога тем (src/lib/content/subjects.ts → Topic.examples).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧЕСТНОСТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 *  * Примеры — из content-каталога, а не выдуманные. Ничего не имитирует
 *    результат LLM и ничего не обещает: это примеры из той же темы, по
 *    которой будет сгенерирован материал.
 *  * Нет примеров в каталоге — честное пустое состояние. Придумывать
 *    «примерный» текайл нельзя: учитель примет его за настоящий.
 *  * Компонент ничего не генерирует: ни запроса, ни списания квоты, ни
 *    сохранения. Только чтение уже загруженного каталога тем.
 */

import * as React from "react";
import type { Difficulty, Subject, TaskType, Topic } from "@/lib/types";
import { Card } from "@/components/ui/Card";

/** Подписи типов материала. Своя копия — как и в соседних компонентах. */
const TYPE_LABEL: Record<TaskType, string> = {
  worksheet: "Рабочий лист",
  test: "Тест с автопроверкой",
  cards: "Карточки для запоминания",
  control: "Контрольная работа",
  "lesson-plan": "План урока",
  presentation: "Презентация",
  ktp: "КТП",
  oge: "Вариант ОГЭ",
  ege: "Вариант ЕГЭ",
  materials: "Комплект материалов",
  "lesson-bundle": "Комплект урока",
  interactive: "Форма для учеников",
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "лёгкий уровень",
  medium: "средний уровень",
  hard: "сложный уровень",
};

export interface TopicSamplePreviewProps {
  /** Выбранный предмет (может быть null — тогда покажем прочерк). */
  subject: Subject | null;
  /** Класс. */
  grade: number | null;
  /** Выбранная тема. */
  topic: Topic | null;
  /** Тип материала. */
  type: TaskType;
  /** Сложность. */
  difficulty: Difficulty;
  /** Сколько заданий. */
  count: number;
  /** Сколько примеров показывать. По умолчанию два. */
  maxExamples?: number;
}

export function TopicSamplePreview({
  subject,
  grade,
  topic,
  type,
  difficulty,
  count,
  maxExamples = 2,
}: TopicSamplePreviewProps) {
  const examples = React.useMemo(
    () => (topic?.examples ?? []).slice(0, Math.max(0, maxExamples)),
    [topic, maxExamples],
  );

  const params: Array<{ label: string; value: string }> = [
    { label: "Предмет", value: subject?.title ?? "—" },
    { label: "Класс", value: grade !== null ? `${grade} класс` : "—" },
    { label: "Тема", value: topic?.title ?? "—" },
    { label: "Формат", value: TYPE_LABEL[type] ?? type },
    { label: "Уровень", value: DIFFICULTY_LABEL[difficulty] ?? difficulty },
    { label: "Заданий", value: String(count) },
  ];

  return (
    <Card className="overflow-hidden" padded={false}>
      <div className="px-4 pt-5 sm:px-6 sm:pt-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-warm-500">
          Ваши настройки
        </p>
        <h2 className="mt-1 text-lg font-semibold text-warm-950 sm:text-xl">
          {topic?.title ?? "Выберите тему"}
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {params.map((p) => (
            <div key={p.label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-warm-500">{p.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-warm-900" title={p.value}>
                {p.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="px-4 pb-5 pt-6 sm:px-6 sm:pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-warm-500">
          Пример по выбранной теме
        </p>

        {examples.length > 0 ? (
          <ol className="mt-3 space-y-3">
            {examples.map((ex, i) => (
              <li
                key={`${topic?.slug ?? "topic"}-${i}`}
                className="rounded-xl border border-warm-100 bg-warm-50/60 p-3 sm:p-4"
              >
                <p className="text-sm leading-relaxed text-warm-950">{ex.text}</p>
                {ex.answer ? (
                  <p className="mt-1.5 text-xs text-warm-600">
                    <span className="font-medium text-warm-700">Ответ:</span> {ex.answer}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-warm-200 p-4">
            <p className="text-sm text-warm-700">
              Для этой темы в каталоге нет примеров. Материал будет собран по программе
              ФГОС — это дольше, но содержание будет по вашей теме.
            </p>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-warm-500">
          Примеры взяты из каталога тем, а не из готового материала: состав и формулировки
          будут другими.
        </p>
      </div>
    </Card>
  );
}
