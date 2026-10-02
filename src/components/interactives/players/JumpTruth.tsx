"use client";

/**
 * Плеер 3: «Прыг по правде» (TZ-13 §2.4) — самый дорогой формат (3 дня по ТЗ §2.4).
 *
 * Правила ровно по ТЗ:
 *   - поле 8×8 (для телефона — 6×6), фишка в старте, финиш — нижний ряд;
 *   - ход: бросок кубика 1–6 (можно задать вручную), анимация прыжка;
 *   - на клетке — утверждение «правда / ложь»;
 *   - угадал → можно бросить снова; ошибся → откат на 2 клетки;
 *   - на 3–5 клетках скрытые мины: наступил → теряешь ход (не ходишь в этот раз);
 *   - дошёл до нижнего ряда → победа.
 *
 * Формула (ТЗ §2.4):
 * ```
 * claims_correct = число верных ответов
 * claims_wrong   = число неверных
 * moves          = число бросков
 * percent        = round(100 * claims_correct / (claims_correct + claims_wrong))
 * finish_time_s  = финиш − старт (nullable, если не дошёл)
 * ```
 *
 * Про мин: ТЗ говорит «на них теряешь ход». Трактуем как «ход, на котором
 * наступил на мину, засчитывается, но ЧИСЛО КЛЕТОК не меняется» — то есть
 * после мины ученик снова бросает с той же клетки. Иначе игра превращается в
 * лотерею, а не в проверку знаний.
 *
 * Позиция считается по индексу: `клетка = колонка * boardSize + ряд`. Индекс
 * растёт ВПРАВО, финиш — последние `boardSize` клеток. Так «прыжок» = простая
 * арифметика, а сетка не перерисовывается целиком на каждом ходу.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { normalizeOptions } from "@/lib/interactives/formats";
import { scoreJumpTruth } from "@/lib/interactives/scoring";
import type { ClientAttemptAnswer, JumpTruthOptions, PlayerProps } from "@/lib/interactives/types";
import { ItemVisual } from "../ItemVisual";
import { Progress, useFinish } from "./common";

interface JumpState {
  /** Индекс клетки, на которой стоит фишка. */
  position: number;
  /** Число бросков. */
  moves: number;
  /** Утверждения, на которые уже ответили: id → выбор ученика. */
  answered: Record<string, boolean>;
  /** Клетки с минами, в которые уже наступили (чтобы не «упасть» дважды). */
  triggered: string[];
  /** Очередь утверждений: id в порядке показа. */
  deck: string[];
  /** Утверждение, которое сейчас на экране (ждёт ответа), null — ждём броска. */
  currentId: string | null;
  /** Показываем результат последнего ответа. */
  verdict: "none" | "correct" | "wrong" | "mine";
  /** Финиш достигнут. */
  finished: boolean;
  /** Момент старта игры (unix ms) — из него длительность попытки. */
  startedAt: number;
}

function isJumpState(raw: unknown, ids: ReadonlySet<string>): raw is JumpState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<JumpState>;
  if (typeof s.position !== "number" || typeof s.moves !== "number") return false;
  if (typeof s.startedAt !== "number" || typeof s.finished !== "boolean") return false;
  if (!Array.isArray(s.deck) || !Array.isArray(s.triggered)) return false;
  if (!s.answered || typeof s.answered !== "object") return false;
  if (s.deck.length !== ids.size) return false;
  if (!s.deck.every((id) => typeof id === "string" && ids.has(id))) return false;
  if (s.currentId != null && !ids.has(s.currentId)) return false;
  for (const key of Object.keys(s.answered)) if (!ids.has(key)) return false;
  return true;
}

/** Детерминированная раскладка мин: одинаковая при каждой попытке. */
function placeMines(boardSize: number, count: number, seed: string): number[] {
  const total = boardSize * boardSize;
  const forbidden = new Set<number>([0, total - 1, total - 2]);
  const out: number[] = [];
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  let guard = 0;
  while (out.length < count && guard < total * 20) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    guard += 1;
    const cell = Math.abs(state) % total;
    if (forbidden.has(cell) || out.includes(cell)) continue;
    out.push(cell);
  }
  return out;
}

export function JumpTruth({ config, initial, onChange, onFinish }: PlayerProps) {
  const options: JumpTruthOptions = normalizeOptions("jump-truth", config.options);
  const ids = React.useMemo(() => new Set(config.items.map((i) => i.id)), [config.items]);
  const startedAtRef = React.useRef<number>(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const boardSize = options.boardSize;
  const finishRow = boardSize * boardSize - boardSize;
  const mines = React.useMemo(
    () => placeMines(options.mines, options.mines, `jump:${config.title}`),
    [options.mines, config.title],
  );

  const [state, setState] = React.useState<JumpState>(() => {
    if (isJumpState(initial, ids)) {
      return { ...initial, verdict: "none" };
    }
    return {
      position: 0,
      moves: 0,
      answered: {},
      triggered: [],
      // Утверждения идут в порядке конфига: привязка к теме важнее случайности.
      deck: config.items.map((i) => i.id),
      // Утверждение появляется только ПОСЛЕ приземления на клетку (ТЗ §2.4):
      // в начале игры ученик ещё не бросал кубик.
      currentId: null,
      verdict: "none",
      finished: false,
      startedAt: Date.now(),
    };
  });
  const [dice, setDice] = React.useState<number | null>(null);
  const [manual, setManual] = React.useState("");
  const finish = useFinish(onFinish);

  React.useEffect(() => {
    onChange({ ...state });
  }, [state, onChange]);

  const answers: ClientAttemptAnswer[] = React.useMemo(
    () =>
      Object.entries(state.answered).map(([itemId, chosenTrue]) => ({
        itemId,
        chosenTrue,
        ms: 0,
      })),
    [state.answered],
  );
  const live = React.useMemo(
    () => scoreJumpTruth({ config, answers, moves: state.moves }),
    [config, answers, state.moves],
  );

  /* ─── ход ────────────────────────────────────────────────────────────── */

  /**
   * Бросок кубика: считаем клетку, проверяем мину и выдаём утверждение.
   *
   * ТЗ §2.4: «на мине теряешь ход» → позиция остаётся на мине, следующий бросок
   * идёт оттуда же. Финиш — нижний ряд: попали → победа, утверждение не нужно.
   */
  const throwDice = React.useCallback(
    (value: number) => {
      setDice(value);
      setState((prev) => {
        if (prev.finished || prev.currentId) return prev;
        const target = Math.min(boardSize * boardSize - 1, prev.position + value);
        const next: JumpState = { ...prev, position: target, moves: prev.moves + 1 };

        if (target >= finishRow) {
          next.finished = true;
          next.currentId = null;
          next.verdict = "none";
          return next;
        }
        if (mines.includes(target) && !prev.triggered.includes(String(target))) {
          next.triggered = [...prev.triggered, String(target)];
          next.verdict = "mine";
          next.currentId = null;
          return next;
        }
        // Обычная клетка — даём следующее неразобранное утверждение.
        const used = Object.keys(prev.answered);
        next.currentId = prev.deck.find((id) => !used.includes(id)) ?? null;
        next.verdict = "none";
        return next;
      });
    },
    [boardSize, finishRow, mines],
  );

  const roll = () => throwDice(1 + Math.floor(Math.random() * 6));

  const handleManual = () => {
    const value = Math.min(6, Math.max(1, Math.round(Number(manual))));
    if (!Number.isFinite(value)) return;
    throwDice(value);
    setManual("");
  };

  /**
   * Ответ на утверждение: верно → бросай снова, неверно → откат на 2 клетки.
   * Утверждение закрывается в обоих случаях (ТЗ §2.4).
   */
  const answer = React.useCallback(
    (chosenTrue: boolean) => {
      setState((prev) => {
        if (!prev.currentId) return prev;
        const item = config.items.find((i) => i.id === prev.currentId);
        if (!item) return prev;
        const correct = item.isTrue === chosenTrue;
        return {
          ...prev,
          answered: { ...prev.answered, [item.id]: chosenTrue },
          verdict: correct ? "correct" : "wrong",
          position: correct ? prev.position : Math.max(0, prev.position - 2),
          currentId: null,
        };
      });
    },
    [config.items],
  );

  /* ─── финиш ──────────────────────────────────────────────────────────── */

  const finishNow = React.useCallback(() => {
    setState((prev) => ({ ...prev, finished: true, currentId: null }));
  }, []);

  React.useEffect(() => {
    if (!state.finished) return;
    finish(
      { config, answers, moves: state.moves },
      state.startedAt || startedAtRef.current,
    );
  }, [state.finished, config, answers, state.moves, state.startedAt, finish]);

  const currentItem = state.currentId
    ? config.items.find((i) => i.id === state.currentId)
    : undefined;
  const onMine = mines.includes(state.position) && state.triggered.includes(String(state.position));
  const progressDone = Object.keys(state.answered).length;

  return (
    <div data-interactive-player="" data-interactive-format="jump-truth">
      <Progress
        done={progressDone}
        total={config.items.length}
        label={`Утверждений разобрано: ${progressDone} из ${config.items.length}`}
      />

      <Card className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-warm-600">Позиция</p>
          <p className="text-lg font-semibold text-warm-950" data-testid="jump-position">
            {state.position + 1} / {boardSize * boardSize}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-warm-600">Ходов: {state.moves}</p>
          <p className="text-sm text-warm-600">
            Верных: <span className="font-semibold text-warm-950">{live.detail.correct}</span>
          </p>
        </div>
      </Card>

      {/* Поле. Абсолютное позиционирование + CSS-переход = плавный прыжок. */}
      <div
        className="relative w-full aspect-square mb-4 rounded-2xl bg-warm-50 border border-warm-200 overflow-hidden"
        data-interactive-board=""
        style={{ maxWidth: 420, margin: "0 auto" }}
      >
        <div
          className="absolute rounded-lg bg-brand-500 shadow-brand transition-all duration-500 ease-out grid place-items-center text-white text-xs font-bold"
          style={{
            left: `${(state.position % boardSize) * (100 / boardSize)}%`,
            top: `${Math.floor(state.position / boardSize) * (100 / boardSize)}%`,
            width: `${100 / boardSize}%`,
            height: `${100 / boardSize}%`,
            // Фишка рисуется ПЕРВОЙ в разметке, но должна быть поверх клеток.
            zIndex: 10,
          }}
          data-interactive-token={String(state.position)}
          aria-hidden
        >
          {onMine ? "💣" : ""}
        </div>
        {Array.from({ length: boardSize * boardSize }, (_, cell) => {
          const col = cell % boardSize;
          const row = Math.floor(cell / boardSize);
          const isFinish = row * boardSize >= finishRow;
          const isStart = cell === 0;
          return (
            <div
              key={cell}
              className={cn(
                "absolute rounded-lg border border-warm-200/70",
                isFinish ? "bg-emerald-50" : "bg-white",
                isStart && "bg-brand-50",
              )}
              style={{
                left: `${col * (100 / boardSize)}%`,
                top: `${row * (100 / boardSize)}%`,
                width: `${100 / boardSize}%`,
                height: `${100 / boardSize}%`,
              }}
              data-interactive-cell={cell}
              aria-hidden
            />
          );
        })}
      </div>

      {currentItem ? (
        <Card>
          <ItemVisual item={currentItem} />
          <p className="mt-3 text-sm text-warm-600">Правда или ложь?</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              onClick={() => answer(true)}
              data-testid="jump-true"
            >
              Правда
            </Button>
            <Button
              variant="secondary"
              onClick={() => answer(false)}
              data-testid="jump-false"
            >
              Ложь
            </Button>
          </div>
        </Card>
      ) : state.finished ? (
        <Card className="text-center">
          <p className="text-2xl" aria-hidden>
            🏁
          </p>
          <p className="mt-2 text-warm-700">Финиш! Ты дошёл до последнего ряда.</p>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-warm-600">Кубик</p>
              <p className="text-3xl" aria-hidden>
                {dice === null ? "🎲" : ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][dice - 1]}
              </p>
            </div>
            <Button onClick={roll} data-testid="jump-roll">
              Бросить кубик
            </Button>
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={6}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManual();
              }}
              placeholder="1–6"
              aria-label="Задать число хода вручную"
              className="w-20 h-11 px-3 text-sm bg-white border border-warm-200 rounded-xl text-warm-950 focus:outline-none focus:border-brand-500"
              data-testid="jump-manual"
            />
            <Button variant="secondary" onClick={handleManual} data-testid="jump-manual-go">
              Пойти на столько
            </Button>
          </div>
        </Card>
      )}

      {state.verdict !== "none" && (
        <p
          className={cn(
            "mt-3 text-sm font-medium",
            state.verdict === "correct"
              ? "text-emerald-700"
              : state.verdict === "mine"
                ? "text-amber-700"
                : "text-rose-600",
          )}
          role="status"
          data-testid="jump-verdict"
        >
          {state.verdict === "correct" && "Верно! Бросай ещё раз."}
          {state.verdict === "wrong" && "Неверно — откатываем на 2 клетки назад."}
          {state.verdict === "mine" && "Мина! Ход потерян, бросай снова."}
        </p>
      )}

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={finishNow}
          className="text-xs text-warm-500 underline hover:text-warm-700"
          data-testid="jump-finish"
        >
          Закончить игру и посмотреть результат
        </button>
      </div>
    </div>
  );
}
