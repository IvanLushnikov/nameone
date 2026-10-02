"use client";

/**
 * Плеер 1: «Викторина-гонка» (TZ-13 §2.2).
 *
 * Правила ровно по ТЗ:
 *   - вопросы по одному, на каждый — таймер (10/20/30 секунд или без таймера);
 *   - правильный ПЕРВЫЙ ответ: `100 + round(50 * remaining / total)`;
 *   - неправильный — 0 очков, можно попробовать второй раз, тогда очки вдвое
 *     меньше («очки режутся вдвое», ТЗ §2.2);
 *   - не успел за время — вопрос закрывается без ответа.
 *
 * Счёт не считается вручную: на финише `useFinish` отдаёт ответы в
 * `scoring.ts`, где формула живёт одна — на клиенте и (зеркально) на сервере.
 * «Живой» счёт на экране тоже считается той же функцией, иначе ученик увидит
 * одно число, а по итогу получит другое.
 *
 * Перемешивание вариантов — детерминированное (`shuffledIndices`), иначе после
 * перезагрузки правильный ответ переедет на другую кнопку.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { normalizeOptions } from "@/lib/interactives/formats";
import { scoreQuizRace } from "@/lib/interactives/scoring";
import type { ClientAttemptAnswer, PlayerProps, QuizRaceOptions } from "@/lib/interactives/types";
import { ItemVisual } from "../ItemVisual";
import { ChoiceList, Progress, shuffledIndices, useFinish } from "./common";

/** Что лежит в снапшоте (localStorage) — форма проверяется гардом. */
interface QuizState {
  index: number;
  /** itemId → выбранный вариант в терминах КОНФИГА (не кнопки). */
  chosen: Record<string, number>;
  /** itemId → номер попытки (1 или 2). */
  attempts: Record<string, number>;
  /** itemId → сколько миллисекунд ученик думал (для бонуса за скорость). */
  spent: Record<string, number>;
  /** Момент показа текущего вопроса — от него идёт таймер. */
  shownAt: number;
}

function isQuizState(raw: unknown, ids: ReadonlySet<string>): raw is QuizState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<QuizState>;
  if (typeof s.index !== "number" || typeof s.shownAt !== "number") return false;
  if (!s.chosen || typeof s.chosen !== "object") return false;
  if (!s.attempts || typeof s.attempts !== "object") return false;
  if (!s.spent || typeof s.spent !== "object") return false;
  // Ключи должны быть наши id заданий: чужой снапшот = другой интерактив.
  for (const key of Object.keys(s.chosen)) if (!ids.has(key)) return false;
  for (const key of Object.keys(s.attempts)) if (!ids.has(key)) return false;
  for (const key of Object.keys(s.spent)) if (!ids.has(key)) return false;
  return true;
}

function emptyState(index: number): QuizState {
  return { index, chosen: {}, attempts: {}, spent: {}, shownAt: Date.now() };
}

/** Ответы в формате скоринга: `chosenIndex` — индекс в КОНФИГЕ, `attempt` — попытка. */
function answersOf(config: PlayerProps["config"], state: QuizState): ClientAttemptAnswer[] {
  const answers: ClientAttemptAnswer[] = [];
  for (const item of config.items) {
    const chosenIndex = state.chosen[item.id];
    if (chosenIndex === undefined) continue;
    answers.push({
      itemId: item.id,
      chosenIndex,
      // Сервер режет очки вдвое только по этому флагу (ТЗ §2.2), поэтому он
      // должен быть честным: вторая попытка = ученик уже ошибся на этом вопросе.
      secondTry: (state.attempts[item.id] ?? 1) >= 2,
      ms: state.spent[item.id] ?? 0,
    });
  }
  return answers;
}

export function QuizRace({ config, initial, onChange, onFinish }: PlayerProps) {
  const options: QuizRaceOptions = normalizeOptions("quiz-race", config.options);
  const ids = React.useMemo(() => new Set(config.items.map((i) => i.id)), [config.items]);
  const startedAtRef = React.useRef<number>(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const [state, setState] = React.useState<QuizState>(() => {
    if (!isQuizState(initial, ids)) return emptyState(0);
    // Таймер всегда начинается заново: вернувшийся через час ученик не должен
    // сразу получить «время вышло».
    return { ...initial, shownAt: Date.now() };
  });

  const [left, setLeft] = React.useState(options.secondsPerItem);
  /** Заблокирован вопрос: ждём анимацию правильного/ошибочного ответа. */
  const [locked, setLocked] = React.useState(false);
  /** Флаг «всё, финиш»: по нему эффект отдаёт результат оболочке. */
  const [finishing, setFinishing] = React.useState(false);
  const finish = useFinish(onFinish);

  const total = config.items.length;
  const item = config.items[state.index];

  // Снапшот наружу: оболочка пишет его в localStorage после каждого ответа.
  React.useEffect(() => {
    onChange({ ...state });
  }, [state, onChange]);

  const answers = React.useMemo(() => answersOf(config, state), [config, state]);
  const live = React.useMemo(
    () => scoreQuizRace({ config, answers }),
    [config, answers],
  );

  /** Следующий вопрос или финиш. */
  const goNext = React.useCallback(() => {
    setLocked(false);
    if (state.index + 1 >= config.items.length) {
      setFinishing(true);
      return;
    }
    setState((prev) => ({ ...prev, index: prev.index + 1, shownAt: Date.now() }));
  }, [state.index, config.items.length]);

  /* ─── таймер ─────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    if (options.secondsPerItem <= 0 || locked || finishing) return;
    setLeft(options.secondsPerItem);
    const tick = window.setInterval(() => {
      setLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [state.index, options.secondsPerItem, locked, finishing]);

  // Время вышло — вопрос закрыт, идём дальше без ответа.
  React.useEffect(() => {
    if (options.secondsPerItem > 0 && left === 0 && !locked && !finishing) goNext();
  }, [left, locked, finishing, options.secondsPerItem, goNext]);

  /* ─── финиш ──────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    if (!finishing) return;
    const at = startedAtRef.current;
    finish({ config, answers: answersOf(config, state) }, at);
  }, [finishing, config, state, finish]);

  if (!item || total === 0) {
    return (
      <Card className="text-center" data-interactive-player="" data-interactive-format="quiz-race">
        <p className="text-sm text-warm-600">
          В интерактиве нет вопросов. Попросите учителя пересоздать его.
        </p>
      </Card>
    );
  }

  const attempt = state.attempts[item.id] ?? 0;
  const chosenOriginal = state.chosen[item.id];
  const isCorrect = chosenOriginal !== undefined && chosenOriginal === item.correctIndex;
  const lastTry = attempt >= 2;
  const sourceOptions = item.options ?? [];
  const perm = options.shuffleOptions
    ? shuffledIndices(sourceOptions.length, item.id)
    : sourceOptions.map((_, i) => i);
  /** Кнопка i показывает вариант perm[i]. */
  const displayOptions = perm.map((original) => sourceOptions[original] ?? "");
  const chosenButton = chosenOriginal === undefined ? undefined : perm.indexOf(chosenOriginal);
  const correctButton = item.correctIndex === undefined ? undefined : perm.indexOf(item.correctIndex);

  const handleChoose = (buttonIndex: number) => {
    if (locked) return;
    const original = perm[buttonIndex];
    const nextAttempt = attempt + 1;
    const correct = original === item.correctIndex;
    const spentMs = Math.max(0, Date.now() - state.shownAt);

    setState((prev) => ({
      ...prev,
      chosen: correct ? { ...prev.chosen, [item.id]: original } : prev.chosen,
      attempts: { ...prev.attempts, [item.id]: nextAttempt },
      spent: { ...prev.spent, [item.id]: spentMs },
    }));

    if (correct || lastTry) {
      setLocked(true);
      window.setTimeout(goNext, correct ? 600 : 900);
    }
  };

  const barPercent =
    options.secondsPerItem > 0
      ? Math.round((left / options.secondsPerItem) * 100)
      : 100;

  return (
    <div data-interactive-player="" data-interactive-format="quiz-race" data-interactive-item={item.id}>
      <Progress done={Object.keys(state.chosen).length} total={total} label={`Вопрос ${state.index + 1} из ${total}`} />

      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-sm text-warm-600" data-testid="quiz-score">
          Счёт: {live.score}
        </span>
        {options.secondsPerItem > 0 && (
          <span
            className={cn(
              "text-sm font-semibold tabular-nums px-2 py-0.5 rounded-lg",
              left <= 3 ? "bg-rose-100 text-rose-700" : "bg-warm-100 text-warm-700",
            )}
            data-testid="quiz-timer"
          >
            {left} с
          </span>
        )}
      </div>

      {options.secondsPerItem > 0 && (
        <div className="h-1.5 w-full rounded-full bg-warm-100 overflow-hidden mb-4">
          <div
            className={cn(
              "h-full transition-all duration-1000",
              left <= 3 ? "bg-rose-500" : "bg-brand-500",
            )}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      )}

      <Card>
        <ItemVisual item={item} />
        <div className="mt-4">
          <ChoiceList
            itemId={item.id}
            options={displayOptions}
            chosen={chosenButton}
            onChoose={handleChoose}
            correctIndex={correctButton}
            reveal={locked}
          />
        </div>

        {locked && (
          <p
            className={cn("mt-3 text-sm font-medium", isCorrect ? "text-emerald-700" : "text-rose-600")}
            role="status"
          >
            {isCorrect
              ? "Верно! Очки за скорость"
              : lastTry
                ? "Неверно. Следующий вопрос"
                : "Неверно — попробуй другой вариант"}
          </p>
        )}

        {options.secondsPerItem === 0 && (
          <Button
            variant="secondary"
            className="mt-4 w-full"
            fullWidth
            onClick={goNext}
            data-testid="quiz-skip"
          >
            {state.index + 1 >= total ? "К результатам" : "Следующий вопрос"}
          </Button>
        )}
      </Card>
    </div>
  );
}
