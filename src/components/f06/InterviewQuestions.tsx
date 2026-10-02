"use client";

/**
 * F-06.1 «Вопросы для беседы» (TZ-17 §4).
 *
 * ЧТО ЭТО. Материал для устной беседы с учеником: 3–5 вопросов к конкретным
 * заданиям его работы, которые он сможет ответить только если действительно
 * сам решал.
 *
 * ЧТО ЭТО НЕ. Не детектор ИИ и не вердикт о списывании. Здесь нет поля
 * «процент похоже на ИИ» и не будет добавлено. Проверка авторства в 2026 году
 * технически не работает — Стэнфорд на текстах носителей неродного языка даёт
 * 61% ложных срабатываний, а для русскоязычных школьников класс ошибок тот же.
 * Решение принимает учитель, после разговора. См. POSITIONING.md §10 (2026-10-02).
 *
 * Поэтому в текстах ниже запрещены слова «списал», «детектор», «похоже на ИИ».
 * И здесь не должно появиться слов процентов рядом с вопросами.
 */

import * as React from "react";
import { Button } from "@/components/ui/Button";
import type { PhotoCheckResult } from "@/lib/photo-check/types";
import type { InterviewQuestion, InterviewState } from "@/lib/photo-check/interview";
import {
  generateInterviewQuestions,
  loadInterviewQuestions,
} from "@/lib/photo-check/api";

export interface InterviewQuestionsProps {
  result: PhotoCheckResult;
  /** Нет checkId → фича неактивна, блок не рисуем вовсе. */
  checkId?: string;
}

/** Пока бэк не ответил, показываем то же, что приедет оттуда. */
const FALLBACK_DISCLAIMER =
  "Это не проверка на списывание. Решение принимаете вы.";

const MAX_QUESTIONS = 5;

/**
 * Экранирование для печатного бланка. Открывается в новом окне через
 * `document.write`, поэтому текст вопроса нельзя вставлять как есть.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Отбор по умолчанию: задания, где модель не разобрала почерк или где ответ
 * неверный. Это ДЕФОЛТ, а не запрет — учитель вправе спросить про любое.
 */
function defaultSelection(result: PhotoCheckResult): number[] {
  return result.items
    .filter((i) => i.verdict !== "correct")
    .slice(0, MAX_QUESTIONS)
    .map((i) => i.number);
}

function asText(questions: InterviewQuestion[]): string {
  return questions
    .map((q) => `Задание ${q.taskNumber}: ${q.question}`)
    .join("\n");
}

export function InterviewQuestions({ result, checkId }: InterviewQuestionsProps) {
  const [state, setState] = React.useState<InterviewState>("idle");
  const [questions, setQuestions] = React.useState<InterviewQuestion[]>([]);
  const [selected, setSelected] = React.useState<number[]>(() =>
    defaultSelection(result),
  );
  const [disclaimer, setDisclaimer] = React.useState(FALLBACK_DISCLAIMER);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Вернулся к старой домашке — показываем тот набор, который уже составляли,
  // не заставляя жать кнопку заново.
  React.useEffect(() => {
    if (!checkId) return;
    let alive = true;
    void (async () => {
      const res = await loadInterviewQuestions(checkId);
      if (!alive || !res.ok || res.questions.length === 0) return;
      setQuestions(res.questions);
      setDisclaimer(res.disclaimer || FALLBACK_DISCLAIMER);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [checkId]);

  if (!checkId) return null;

  const toggle = (n: number) =>
    setSelected((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );

  const allNumbers = result.items.map((i) => i.number);

  const run = async (regenerate: boolean) => {
    setState("pending");
    setError(null);
    setCopied(false);
    const res = await generateInterviewQuestions({
      checkId,
      taskNumbers: selected,
      regenerate,
    });
    if (!res.ok) {
      // Результат проверки уже на экране — он не ломается. Просто панель
      // вопросов уходит в одну строку с предложением повторить.
      setState("error");
      // `res.message` опционален, а состояние ждёт `string | null` — пустая
      // строка вместо undefined, иначе «Сообщения нет» превратится в «.».
      setError(res.message ?? null);
      return;
    }
    setQuestions(res.questions);
    setDisclaimer(res.disclaimer);
    setState("ready");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(questions));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  /**
   * Печать в отдельном окне, а не window.print(): на бланке должны быть ТОЛЬКО
   * вопросы — без таблицы результатов, отметок и правильных ответов. Бланк
   * часто уходит в класс или на стол учителю.
   */
  const print = () => {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const rows = questions
      .map(
        (q) =>
          `<li><b>Задание ${q.taskNumber}.</b> ${escapeHtml(q.question)}</li>`,
      )
      .join("");
    w.document.write(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Вопросы для беседы</title>
<style>
  body { font: 15px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; padding: 32px; color: #1a1a1a; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  p.sub { color: #666; font-size: 13px; margin: 0 0 24px; }
  ol { padding-left: 22px; } li { margin-bottom: 14px; }
  .foot { margin-top: 28px; font-size: 12px; color: #888; border-top: 1px solid #e5e5e5; padding-top: 10px; }
</style></head><body>
<h1>Вопросы для беседы</h1>
<p class="sub">Задайте их вслух — не показывая правильных ответов.</p>
<ol>${rows}</ol>
<p class="foot">${escapeHtml(disclaimer)}</p>
</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <section
      aria-labelledby="interview-heading"
      className="rounded-2xl border border-warm-200 bg-white p-5 no-print"
    >
      <h3
        id="interview-heading"
        className="font-semibold text-warm-950 text-lg"
      >
        Спроси ученика
      </h3>
      <p className="text-sm text-warm-600 mt-1">
        Неочевидно, что работа сделана им самим? Вот вопросы к спорным
        заданиям — задайте их вслух в классе.
      </p>

      {/* ── idle ────────────────────────────────────────────────────────── */}
      {state === "idle" && (
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setState("picking")}
          >
            Составить вопросы
          </Button>
          <p className="text-xs text-warm-500 mt-2">
            {disclaimer}
          </p>
        </div>
      )}

      {/* ── picking: какие задания спрашивать ───────────────────────────── */}
      {state === "picking" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-warm-700">
            Отметьте задания, про которые хотите спросить. По умолчанию — те,
            где модель не разобрала почерк или где ответ неверный.
          </p>
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {result.items.map((item) => (
              <li key={item.number}>
                <label className="flex items-start gap-2.5 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.number)}
                    onChange={() => toggle(item.number)}
                    className="mt-1 accent-brand-500 w-4 h-4"
                  />
                  <span className="text-warm-800">
                    <span className="font-medium">Задание {item.number}</span>
                    {item.taskText ? ` — ${item.taskText}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void run(false)}
              loading={false}
              disabled={selected.length === 0}
            >
              Составить вопросы
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setState("idle")}
            >
              Отмена
            </Button>
            {selected.length !== allNumbers.length && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(allNumbers)}
              >
                Выбрать все
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── pending ─────────────────────────────────────────────────────── */}
      {state === "pending" && (
        <ul className="mt-4 space-y-2" aria-busy="true" aria-live="polite">
          <li className="sr-only">Составляем вопросы…</li>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-5 rounded bg-warm-100 animate-pulse"
              style={{ width: `${90 - i * 18}%` }}
            />
          ))}
        </ul>
      )}

      {/* ── error: одна строка, результат проверки не трогаем ──────────── */}
      {state === "error" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-950">{error}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1.5"
            onClick={() => setState("picking")}
          >
            Попробовать снова
          </Button>
        </div>
      )}

      {/* ── ready ───────────────────────────────────────────────────────── */}
      {state === "ready" && questions.length > 0 && (
        <div className="mt-4">
          <ol className="space-y-3">
            {questions.map((q) => (
              <li
                key={`${q.taskNumber}-${q.createdAt}`}
                className="border-l-2 border-brand-200 pl-3"
              >
                <p className="text-xs font-medium text-warm-500">
                  Задание {q.taskNumber}
                  {q.verdictAtGeneration !== "correct" && (
                    <span title="Модель не разобрала почерк или сочла ответ неверным">
                      {" "}
                      ⚠️
                    </span>
                  )}
                </p>
                <p className="text-sm text-warm-900 mt-0.5">{q.question}</p>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-2 mt-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={print}>
              Печать
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setState("picking");
              }}
            >
              Другие вопросы
            </Button>
          </div>

          <p className="text-xs text-warm-500 mt-3">
            {disclaimer} Не показывайте ученику правильные ответы.
          </p>
        </div>
      )}
    </section>
  );
}
