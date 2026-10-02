"use client";

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { addToHistory } from "@/lib/utils/storage";
import {
  ArrowLeft,
  ArrowRight,
  ArrowBigLeft,
  ArrowBigRight,
  CheckCircle2,
  XCircle,
  Timer,
  Sparkles,
  RotateCcw,
  Home,
  Lightbulb,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ExamVariant, ExamProblem } from "@/lib/types";
import { cn, pluralizeMinutes } from "@/lib/utils/cn";

interface Props {
  variant: ExamVariant;
  onExit: () => void;
}

/**
 * Единая обводка фокуса — та же строка, что в ui/Button.tsx. В тренажёре её
 * раньше не было вообще: с клавиатуры по заданию нельзя было пройти, фокус
 * был не виден. Кольцо должно выглядеть одинаково на всех кнопках проекта.
 */
const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500";

type Answer = {
  problemNumber: number;
  value: string;
  correct: boolean;
  time: number;
};

export function ExamRunner({ variant, onExit }: Props) {
  const [step, setStep] = React.useState<"running" | "results">("running");
  const [problemIdx, setProblemIdx] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<number, Answer>>({});
  const [currentAnswer, setCurrentAnswer] = React.useState("");
  const [showHint, setShowHint] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(variant.duration * 60);
  const startRef = React.useRef(Date.now());

  // Swipe gesture tracking
  const touchStartRef = React.useRef<{ x: number; y: number; t: number } | null>(null);

  const { toast } = useToast();

  // Таймер
  React.useEffect(() => {
    if (step !== "running") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          finishExam();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  React.useEffect(() => {
    setCurrentAnswer("");
    setShowHint(false);
    startRef.current = Date.now();
  }, [problemIdx]);

  const problem = variant.problems[problemIdx];
  const totalProblems = variant.problems.length;

  const finishExam = () => {
    setStep("results");
    addToHistory({
      id: variant.id,
      type: "exam",
      title: variant.title,
      subject: variant.subject,
      createdAt: new Date().toISOString(),
      isFavorite: false,
    });
  };

  const goNext = () => {
    if (problemIdx < totalProblems - 1) {
      setProblemIdx(problemIdx + 1);
    } else {
      finishExam();
    }
  };

  const goPrev = () => {
    if (problemIdx > 0) setProblemIdx(problemIdx - 1);
  };

  const handleSubmit = () => {
    if (!currentAnswer.trim()) return;
    const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
    const correct = checkAnswer(currentAnswer, problem);
    setAnswers((prev) => ({
      ...prev,
      [problem.number]: {
        problemNumber: problem.number,
        value: currentAnswer,
        correct,
        time: elapsed,
      },
    }));

    if (correct) {
      toast({ tone: "success", title: "Верно!" });
      setTimeout(goNext, 800);
    } else {
      toast({
        tone: "error",
        title: "Неверно",
        description: "Посмотрите разбор и попробуйте понять, где ошибка.",
      });
    }
  };

  const handleSkip = () => {
    goNext();
  };

  // Свайп на мобиле
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Только горизонтальные свайпы от 60px
    if (Math.abs(dx) > 60 && Math.abs(dy) < 80) {
      if (dx < 0) goNext(); // свайп влево = вперёд
      else goPrev(); // свайп вправо = назад
    }
    touchStartRef.current = null;
  };

  if (step === "results") {
    return <Results variant={variant} answers={answers} onExit={onExit} />;
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="container-tight max-w-3xl py-6 sm:py-10">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div className="min-w-0 flex-1">
          <Badge tone={variant.exam === "oge" ? "brand" : "accent"} className="mb-2">
            {variant.exam === "oge" ? "ОГЭ" : "ЕГЭ"} · вариант {variant.variantNumber}
          </Badge>
          <h1 className="text-lg sm:text-xl font-semibold text-warm-950 truncate">
            {variant.title}
          </h1>
        </div>
        <div
          className={cn(
            "inline-flex items-center gap-2 px-3 h-11 rounded-xl border shrink-0",
            secondsLeft < 300
              ? "bg-rose-50 border-rose-200 text-rose-700"
              : "bg-warm-100 border-warm-200 text-warm-700"
          )}
        >
          <Timer className="w-4 h-4" />
          <span className="font-mono font-semibold tabular-nums">
            {mm}:{ss}
          </span>
        </div>
      </div>

      {/* Progress: swipe-friendly dots */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto scrollbar-hide py-1">
        {variant.problems.map((p, i) => {
          const a = answers[p.number];
          const current = i === problemIdx;
          return (
            <button
              key={p.number}
              type="button"
              onClick={() => setProblemIdx(i)}
              className={cn(
                focusRing,
                "shrink-0 w-9 h-9 rounded-lg grid place-items-center text-xs font-semibold transition-all",
                current
                  ? "bg-brand-500 text-white shadow-brand"
                  : a?.correct
                    ? "bg-emerald-100 text-emerald-700"
                    : a
                      ? "bg-rose-100 text-rose-700"
                      : "bg-warm-100 text-warm-600 hover:bg-warm-200"
              )}
            >
              {p.number}
            </button>
          );
        })}
      </div>

      {/* Кнопки prev/next для десктопа */}
      <div className="hidden sm:flex items-center justify-between mb-3 text-sm">
        <button
          type="button"
          onClick={goPrev}
          disabled={problemIdx === 0}
          className={cn(
            focusRing,
            "inline-flex items-center gap-1.5 text-warm-600 hover:text-warm-950 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          )}
        >
          <ChevronLeft className="w-4 h-4" />
          Предыдущее
        </button>
        {/* aria-live: переход между заданиями должен озвучиваться, а не только
            меняться цифрой. aria-atomic — чтобы «Задание 3 из 10» читалось целиком. */}
        <div className="text-warm-500" aria-live="polite" aria-atomic="true">
          Задание <span className="font-bold text-warm-950">{problemIdx + 1}</span> из {totalProblems}
        </div>
        <button
          type="button"
          onClick={goNext}
          className={cn(
            focusRing,
            "inline-flex items-center gap-1.5 text-warm-600 hover:text-warm-950 transition-colors"
          )}
        >
          Следующее
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Problem card — с поддержкой свайпа на мобиле */}
      <Card
        className="mb-6 touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-start justify-between mb-3">
          <Badge tone={problem.part === 1 ? "brand" : "accent"}>
            Часть {problem.part} · {problem.points}{" "}
            {problem.points === 1 ? "балл" : "балла"}
          </Badge>
          <span className="text-xs text-warm-500 sm:hidden" aria-live="polite" aria-atomic="true">
            {problemIdx + 1} / {totalProblems}
          </span>
        </div>
        <p className="text-lg leading-relaxed text-warm-950 mb-6">{problem.text}</p>

        {problem.options && problem.options.length > 0 && (
          // Семантика радиогруппы: варианты — это выбор ОДНОГО ответа,
          // а не набор независимых кнопок. Скринридер читает «1 из 4, выбрано».
          <div className="space-y-2 mb-6" role="radiogroup" aria-label="Варианты ответа">
            {problem.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={currentAnswer === opt}
                onClick={() => setCurrentAnswer(opt)}
                className={cn(
                  focusRing,
                  "w-full p-3 rounded-xl border text-left transition-colors",
                  currentAnswer === opt
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-warm-200 hover:border-warm-300"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-7 h-7 rounded-full grid place-items-center text-xs font-semibold shrink-0",
                      currentAnswer === opt
                        ? "bg-brand-500 text-white"
                        : "bg-warm-100 text-warm-700"
                    )}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm">{opt}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {(!problem.options || problem.options.length === 0) && (
          <textarea
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            placeholder="Введите ответ…"
            className="w-full p-3 rounded-xl border border-warm-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 outline-none text-sm resize-none min-h-[80px]"
          />
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            aria-expanded={showHint}
            className={cn(
              focusRing,
              "inline-flex items-center gap-1.5 text-sm text-warm-500 hover:text-warm-900"
            )}
          >
            <Lightbulb className="w-4 h-4" />
            {showHint ? "Скрыть подсказку" : "Показать подсказку"}
          </button>
          <span className="text-xs text-[color:var(--text-muted)] hidden sm:inline">
            ⏱ {pluralizeMinutes(Math.max(1, Math.floor((Date.now() - startRef.current) / 60000)))} на задание
          </span>
        </div>
        {showHint && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
            💡 Обратите внимание на условие задачи. Частая ошибка — неправильное прочтение вопроса.
          </div>
        )}
      </Card>

      {/* Мобильные кнопки prev/next */}
      <div className="flex sm:hidden items-center justify-between mb-4 text-sm">
        <button
          type="button"
          onClick={goPrev}
          disabled={problemIdx === 0}
          aria-label="Предыдущее задание"
          className={cn(
            focusRing,
            "inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-warm-100 text-warm-700 disabled:opacity-30"
          )}
        >
          <ArrowBigLeft className="w-4 h-4" />
        </button>
        <span className="text-warm-500 text-xs">свайп ← → или кнопки</span>
        <button
          type="button"
          onClick={goNext}
          aria-label="Следующее задание"
          className={cn(
            focusRing,
            "inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-warm-100 text-warm-700"
          )}
        >
          <ArrowBigRight className="w-4 h-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="md"
          onClick={handleSkip}
          leftIcon={<ArrowLeft className="w-4 h-4" />}
        >
          Пропустить
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={handleSubmit}
          disabled={!currentAnswer.trim()}
          rightIcon={<ArrowRight className="w-4 h-4" />}
        >
          {problemIdx === totalProblems - 1 ? "Завершить" : "Ответить"}
        </Button>
      </div>

      <div className="text-center mt-8">
        <button
          type="button"
          onClick={onExit}
          className={cn(focusRing, "text-sm text-warm-500 hover:text-warm-900")}
        >
          ← Выйти без сохранения
        </button>
      </div>
    </div>
  );
}

function checkAnswer(userAnswer: string, problem: ExamProblem): boolean {
  const a = userAnswer.trim().toLowerCase();
  const c = problem.answer.trim().toLowerCase();
  if (a === c) return true;
  const normalize = (s: string) => s.replace(/\s+/g, "").replace(/[,;]/g, ".");
  return normalize(a) === normalize(c);
}

function Results({
  variant,
  answers,
  onExit,
}: {
  variant: ExamVariant;
  answers: Record<number, Answer>;
  onExit: () => void;
}) {
  const total = variant.problems.length;
  const correct = Object.values(answers).filter((a) => a.correct).length;
  const score = Math.round((correct / total) * variant.problems.reduce((s, p) => s + p.points, 0));

  return (
    <div className="container-tight max-w-3xl py-8 sm:py-12">
      <Card className="text-center py-10 mb-6 bg-gradient-to-br from-brand-50 to-white">
        <Sparkles className="w-12 h-12 text-brand-500 mx-auto mb-3" />
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-warm-950">
          Вариант завершён
        </h2>
        <p className="text-warm-600 mt-2">
          {variant.exam === "oge" ? "ОГЭ" : "ЕГЭ"} · {variant.title}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4 max-w-md mx-auto">
          <div>
            <div className="text-3xl font-bold text-warm-950">
              {correct}/{total}
            </div>
            <div className="text-xs text-warm-500 mt-1">Верных</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-warm-950">{score}</div>
            <div className="text-xs text-warm-500 mt-1">Первичный балл</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-warm-950">
              {Math.round((correct / total) * 100)}%
            </div>
            <div className="text-xs text-warm-500 mt-0.5">Успеваемость</div>
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2">
          <Button
            variant="primary"
            size="md"
            leftIcon={<RotateCcw className="w-4 h-4" />}
            onClick={() => onExit()}
          >
            Новый вариант
          </Button>
          <Button as="link" href="/dashboard" variant="secondary" size="md" leftIcon={<Home className="w-4 h-4" />}>
            В кабинет
          </Button>
        </div>
      </Card>

      <h3 className="text-xl font-semibold text-warm-950 mb-3">Разбор заданий</h3>
      <div className="space-y-3">
        {variant.problems.map((p) => {
          const a = answers[p.number];
          return (
            <Card key={p.number}>
              <div className="flex items-start gap-3 mb-2">
                <span
                  className={cn(
                    "w-8 h-8 rounded-full grid place-items-center font-semibold text-sm shrink-0",
                    !a
                      ? "bg-warm-100 text-warm-500"
                      : a.correct
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                  )}
                >
                  {a?.correct ? <CheckCircle2 className="w-4 h-4" /> : a ? <XCircle className="w-4 h-4" /> : p.number}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-warm-950">{p.text}</p>
                  {a && (
                    <div className="mt-2 text-xs space-y-0.5">
                      <div>
                        <span className="text-warm-500">Ваш ответ:</span>{" "}
                        <span className={a.correct ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
                          {a.value || "—"}
                        </span>
                      </div>
                      {!a.correct && (
                        <div>
                          <span className="text-warm-500">Верный ответ:</span>{" "}
                          <span className="text-warm-950 font-medium">{p.answer}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {p.explanation && (
                    <div className="mt-3 p-3 rounded-xl bg-brand-50 border border-brand-100">
                      <div className="text-xs font-semibold text-brand-800 mb-1">Разбор</div>
                      <p className="text-sm text-warm-700 leading-relaxed">{p.explanation}</p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
