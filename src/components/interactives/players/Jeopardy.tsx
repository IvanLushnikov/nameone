"use client";

/**
 * Плеер 5: «Своя игра» (TZ-13 §2.6).
 *
 * Правила ровно по ТЗ:
 *   - доска: номинации × категории, в клетке вопрос и очки (100/200/300/400);
 *   - режим «соло» — играет один; режим «очередь» — ходят по очереди, имена
 *     вводит учитель на отдельном простом экране;
 *   - правильный ответ → очки в клетке, клетка гаснет; неправильный → минус
 *     (соло) или очки уходят сопернику (очередь);
 *   - победа — по сумме очков.
 *
 * Формула (ТЗ §2.6):
 * ```
 * player_scores = { "Иван": 700, "Маша": 500 }
 * winner        = argmax(player_scores)
 * percent       = round(100 * правильных / всего клеток)
 * ```
 *
 * РАСКЛАДКА ДОСКИ. `item.bucket` — категория (столбец), `item.points` — очки
 * клетки. Категории идут слева направо по возрастанию минимальной стоимости,
 * очки — сверху вниз (100 → 200 → 300 → 400), как в настоящей «Своей игре».
 * ТЗ формулирует «100/200/300/400 по столбцу» — это можно прочитать и наоборот;
 * выбрана классическая раскладка (столбцы = категории), потому что иначе ученик
 * не может отличить соседние категории, а они становятся градиентом 100/200/300/400
 * в каждой строке. ⚠️ Отметить продакту: если нужна другая раскладка — это одна
 * правка в `buildBoard`, а не в механике.
 *
 * Про ПДн: имена вводит учитель, произвольно, и они уходят только в строку
 * попытки (ТЗ §7). Никаких ФИО, телефонов и почт.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import { normalizeOptions } from "@/lib/interactives/formats";
import { scoreJeopardy, winnerOf } from "@/lib/interactives/scoring";
import type { ClientAttemptAnswer, JeopardyOptions, PlayerProps } from "@/lib/interactives/types";
import { ItemVisual } from "../ItemVisual";
import { ChoiceList, useFinish } from "./common";

interface JeopardyState {
  /** Игроки в порядке ввода. */
  players: string[];
  /** Суммы очков. */
  scores: Record<string, number>;
  /** Индекс ходящего (в очереди). */
  current: number;
  /** id открытой клетки. */
  openId: string | null;
  /** Закрытые клетки: id → выбранный вариант. */
  answered: Record<string, number>;
  /** id клетки → игрок, чей это был ход (для серверного скоринга). */
  playerOf: Record<string, string>;
}

function isJeopardyState(raw: unknown, ids: ReadonlySet<string>): raw is JeopardyState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<JeopardyState>;
  if (!Array.isArray(s.players) || s.players.length === 0) return false;
  if (!s.scores || typeof s.scores !== "object") return false;
  if (typeof s.current !== "number" || !s.answered || typeof s.answered !== "object") return false;
  if (!s.playerOf || typeof s.playerOf !== "object") return false;
  if (s.openId != null && !ids.has(s.openId)) return false;
  for (const key of Object.keys(s.answered)) if (!ids.has(key)) return false;
  return true;
}

interface Board {
  /** Подписи столбцов — номинации. */
  categories: string[];
  /** Сетка [столбец][строка] → id задания или null (клетки может не хватить). */
  cells: (string | null)[][];
  /** Стоимость строки (левая колонка с числами). */
  ladder: number[];
}

function buildBoard(config: PlayerProps["config"], ladder: number[]): Board {
  const byCategory = new Map<string, { id: string; points: number }[]>();
  for (const item of config.items) {
    const category = item.bucket || "Без номинации";
    const list = byCategory.get(category);
    const cell = { id: item.id, points: item.points ?? ladder[0] ?? 100 };
    if (list) list.push(cell);
    else byCategory.set(category, [cell]);
  }

  // Столбцы — по возрастанию минимальной стоимости: 100-евые слева.
  const categories = [...byCategory.entries()]
    .sort((a, b) => (a[1][0]?.points ?? 0) - (b[1][0]?.points ?? 0))
    .map(([name]) => name);

  const cells = categories.map((category) => {
    const column = (byCategory.get(category) ?? []).slice().sort((a, b) => a.points - b.points);
    // Клетка строки = первая ещё не взятая по стоимости; если значений не хватило
    // для всех строк лестницы — добиваем сверху (клеток может быть меньше 4×N).
    const used = new Set<number>();
    return ladder.map((value) => {
      const index = column.findIndex((c, i) => c.points === value && !used.has(i));
      if (index >= 0) {
        used.add(index);
        return column[index].id;
      }
      const next = column.findIndex((_, i) => !used.has(i));
      if (next < 0) return null;
      used.add(next);
      return column[next].id;
    });
  });

  return { categories, cells, ladder };
}

export function Jeopardy({ config, initial, onChange, onFinish }: PlayerProps) {
  const options: JeopardyOptions = normalizeOptions("jeopardy", config.options);
  const ids = React.useMemo(() => new Set(config.items.map((i) => i.id)), [config.items]);
  const startedAtRef = React.useRef<number>(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const [state, setState] = React.useState<JeopardyState | null>(() =>
    isJeopardyState(initial, ids) ? initial : null,
  );
  /** Черновик имён на экране ввода (в очереди их несколько). */
  const [draft, setDraft] = React.useState<string[]>([]);
  const [nameDraft, setNameDraft] = React.useState("");
  const finish = useFinish(onFinish);

  const board = React.useMemo(
    () => buildBoard(config, options.pointLadder),
    [config, options.pointLadder],
  );

  React.useEffect(() => {
    if (state) onChange({ ...state });
  }, [state, onChange]);

  // Имя ходящего едет вместе с ответом: сервер сам раздаёт очки клетки
  // нужному игроку (ТЗ §2.6, режим «очередь»), клиент их только показывает.
  const answeredBy = state?.playerOf ?? {};
  const answers: ClientAttemptAnswer[] = React.useMemo(
    () =>
      Object.entries(state?.answered ?? {}).map(([itemId, chosenIndex]) => ({
        itemId,
        chosenIndex,
        player: answeredBy[itemId],
        ms: 0,
      })),
    [state?.answered, answeredBy],
  );
  const live = React.useMemo(
    () => scoreJeopardy({ config, answers, playerScores: state?.scores ?? {} }),
    [config, answers, state?.scores],
  );

  const solo = options.mode === "solo";

  // Считаем ДО раннего return: хук нельзя объявлять после `if (!state) return`,
  // иначе React получит разное число хуков в разных рендерах.
  const answeredCount = state ? Object.keys(state.answered).length : 0;
  const allAnswered = state !== null && answeredCount >= config.items.length;

  React.useEffect(() => {
    if (!state || !allAnswered) return;
    finish({ config, answers, playerScores: state.scores }, startedAtRef.current);
  }, [state, allAnswered, config, answers, finish]);

  /* ─── экран ввода имён (ТЗ §2.6: «учитель вводит имена в начале») ────── */

  if (!state) {
    const addToDraft = () => {
      const name = nameDraft.trim();
      if (!name || draft.includes(name)) return;
      setDraft([...draft, name]);
      setNameDraft("");
    };

    const start = () => {
      const players = draft.length > 0 ? draft : [nameDraft.trim()].filter(Boolean);
      if (players.length === 0) return;
      const scores: Record<string, number> = {};
      for (const name of players) scores[name] = 0;
      setState({ players, scores, current: 0, openId: null, answered: {}, playerOf: {} });
    };

    const canStart = solo ? nameDraft.trim().length > 0 : draft.length >= 2;

    return (
      <div data-interactive-player="" data-interactive-format="jeopardy">
        <Card>
          <h2 className="text-lg font-semibold text-warm-950">
            {solo ? "Сыграем соло" : "Кто играет?"}
          </h2>
          <p className="text-sm text-warm-600 mt-1 mb-4">
            {solo
              ? "Один игрок на всю доску. Имя нужно только для таблицы результатов."
              : "Введите имена по очереди — их вводит учитель, никаких фамилий и почт."}
          </p>

          <Input
            label={solo ? "Имя игрока" : `Игрок ${draft.length + 1}`}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (solo) start();
              else addToDraft();
            }}
            placeholder="Например, Иван"
            maxLength={30}
            autoComplete="off"
            data-testid="jeopardy-name"
          />

          {!solo && (
            <Button
              className="mt-3"
              variant="secondary"
              fullWidth
              onClick={addToDraft}
              disabled={nameDraft.trim().length === 0}
              data-testid="jeopardy-add"
            >
              Добавить игрока
            </Button>
          )}

          {!solo && draft.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {draft.map((name) => (
                <li
                  key={name}
                  className="px-3 py-1 rounded-xl bg-warm-100 text-sm text-warm-700 flex items-center gap-2"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => setDraft(draft.filter((n) => n !== name))}
                    className="text-warm-400 hover:text-rose-500"
                    aria-label={`Убрать ${name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Button
            className="mt-4"
            fullWidth
            onClick={start}
            disabled={!canStart}
            data-testid="jeopardy-start"
          >
            Начать игру
          </Button>
          {!solo && draft.length < 2 && (
            <p className="mt-1.5 text-xs text-warm-500 text-center">
              Нужно минимум два игрока — иначе это режим «соло».
            </p>
          )}
        </Card>
      </div>
    );
  }

  /* ─── игра ───────────────────────────────────────────────────────────── */

  const openItem = state.openId ? config.items.find((i) => i.id === state.openId) : undefined;
  const player = solo
    ? state.players[0]
    : state.players[state.current % state.players.length];
  const winner = winnerOf(state.scores);

  const openCell = (id: string) => {
    if (state.openId || state.answered[id] !== undefined) return;
    setState((prev) => (prev ? { ...prev, openId: id } : prev));
  };

  const answer = (index: number) => {
    const itemId = state.openId;
    if (!itemId) return;
    const item = config.items.find((i) => i.id === itemId);
    if (!item) return;
    const points = item.points ?? 100;
    const correct = item.correctIndex === index;

    setState((prev) => {
      if (!prev) return prev;
      const name = solo ? prev.players[0] : prev.players[prev.current % prev.players.length];
      const nextRival = prev.players[(prev.current + 1) % prev.players.length];
      const scores = { ...prev.scores };
      if (solo) {
        // Соло: неверный ответ — минус стоимость клетки (ТЗ §2.6).
        scores[name] = (scores[name] ?? 0) + (correct ? points : -points);
      } else if (correct) {
        scores[name] = (scores[name] ?? 0) + points;
      } else {
        // Очередь: очки уходят сопернику (ТЗ §2.6).
        scores[nextRival] = (scores[nextRival] ?? 0) + points;
      }
      return {
        ...prev,
        scores,
        answered: { ...prev.answered, [itemId]: index },
        playerOf: { ...prev.playerOf, [itemId]: name },
        openId: null,
        current: solo ? prev.current : prev.current + 1,
      };
    });
  };

  return (
    <div data-interactive-player="" data-interactive-format="jeopardy">
      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          {state.players.map((name) => (
            <span
              key={name}
              className={cn(
                "px-3 py-1.5 rounded-xl text-sm font-medium",
                name === player ? "bg-brand-500 text-white" : "bg-warm-100 text-warm-700",
              )}
              data-testid={`jeopardy-score-${name}`}
            >
              {name}: {state.scores[name] ?? 0}
            </span>
          ))}
          {winner && <span className="px-3 py-1.5 text-sm text-warm-500">Лидер: {winner}</span>}
        </div>
        {!solo && <p className="mt-2 text-xs text-warm-500">Ходит: {player}</p>}
      </Card>

      {openItem ? (
        <Card className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-warm-500">{openItem.bucket}</span>
            <span className="text-sm font-semibold text-brand-700">{openItem.points} очк.</span>
          </div>
          <ItemVisual item={openItem} />
          <div className="mt-3">
            <ChoiceList
              itemId={openItem.id}
              options={openItem.options ?? []}
              onChoose={answer}
              correctIndex={openItem.correctIndex}
            />
          </div>
        </Card>
      ) : (
        <p className="text-sm text-warm-500 text-center mb-3">
          Выбери клетку{!solo ? ` — ходит ${player}` : ""}
        </p>
      )}

      {/* Доска: слева стоимость строки, сверху — номинации. */}
      <div className="grid gap-1.5 mb-1.5" style={{ gridTemplateColumns: `64px repeat(${Math.max(1, board.categories.length)}, minmax(0, 1fr))` }}>
        <div aria-hidden />
        {board.categories.map((category) => (
          <div
            key={category}
            className="text-center text-xs font-medium text-warm-600 truncate px-1"
            title={category}
          >
            {category}
          </div>
        ))}
      </div>

      <div className="space-y-1.5" data-interactive-board="">
        {board.ladder.map((value, rowIndex) => (
          <div
            key={value}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `64px repeat(${Math.max(1, board.categories.length)}, minmax(0, 1fr))` }}
          >
            <div className="grid place-items-center text-sm font-bold text-[color:var(--text-muted)]">{value}</div>
            {board.categories.map((category, colIndex) => {
              const id = board.cells[colIndex]?.[rowIndex] ?? null;
              if (!id) {
                return <div key={`${category}-${value}`} className="rounded-xl bg-warm-50 min-h-12" aria-hidden />;
              }
              const chosenIndex = state.answered[id];
              const isOpen = state.openId === id;
              const item = config.items.find((i) => i.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openCell(id)}
                  disabled={chosenIndex !== undefined || Boolean(state.openId)}
                  className={cn(
                    "rounded-xl py-3 px-1 text-sm font-semibold transition-all min-h-12",
                    chosenIndex !== undefined
                      ? "bg-warm-100 text-[color:var(--text-muted)]"
                      : isOpen
                        ? "bg-brand-100 text-brand-800"
                        : "bg-warm-900 text-white hover:bg-warm-950",
                  )}
                  data-interactive-cell={id}
                >
                  {value}
                  {chosenIndex !== undefined && (
                    <span className="block text-xs font-normal mt-0.5">
                      {item && item.correctIndex === chosenIndex ? "✓" : "✗"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-warm-500 text-center">
        Отвечено клеток: {answeredCount} из {config.items.length} · верных: {live.detail.correct}
      </p>
    </div>
  );
}
