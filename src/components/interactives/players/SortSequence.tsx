"use client";

/**
 * Плеер 6: «Сортировка / Классификация» (TZ-13 §2.7) — НАШ формат, не копия.
 *
 * Закрывает ту же педагогическую задачу, что «Группировка», но в другой форме:
 * не принадлежность («свой / чужой»), а ПОРЯДОК. Поэтому механику перетаскивания
 * не пишем заново — берём общий `useDragSort` (ТЗ §4.3, пункт 4: «ещё один
 * аргумент за движок»).
 *
 * Формула (ТЗ §2.7):
 * ```
 * positions_correct = |{i : order[i] == correct_order[i]}|
 * percent           = round(100 * positions_correct / n)
 * ```
 *
 * Важная механика: начальный порядок ПЕРЕМЕШИВАЕТСЯ детерминированно. Иначе
 * предметы сразу стоят правильно, ученик жмёт «Проверить» и получает 100% без
 * единого действия. Перестановка детерминированная (seed = id интерактива),
 * поэтому после закрытия вкладки порядок не «прыгает» под пальцем.
 *
 * Режим `mode: "classify"` из опций НЕ реализован как отдельная игра: ТЗ §2.7
 * описывает его как «группировку с лимитом», то есть ровно «Группировку по
 * корзинам». Показываем честную подсказку и предлагаем переключиться, вместо
 * того чтобы показать игру, которой нет.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { normalizeOptions, SORT_PRINCIPLES } from "@/lib/interactives/formats";
import { scoreSortSequence } from "@/lib/interactives/scoring";
import type { PlayerProps, SortSequenceOptions } from "@/lib/interactives/types";
import { ItemVisual } from "../ItemVisual";
import { useDragSort } from "../useDragSort";
import { Progress, shuffledIndices, useFinish } from "./common";

interface SequenceState {
  /** id предметов в порядке, который выстроил ученик. */
  order: string[];
}

function isSequenceState(raw: unknown, ids: ReadonlySet<string>): raw is SequenceState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<SequenceState>;
  if (!Array.isArray(s.order)) return false;
  if (s.order.length !== ids.size) return false;
  return s.order.every((id) => typeof id === "string" && ids.has(id));
}

export function SortSequence({ config, initial, onChange, onFinish }: PlayerProps) {
  const options: SortSequenceOptions = normalizeOptions("sort-sequence", config.options);
  const ids = React.useMemo(() => new Set(config.items.map((i) => i.id)), [config.items]);
  const startedAtRef = React.useRef<number>(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const [state, setState] = React.useState<SequenceState>(() => {
    if (isSequenceState(initial, ids)) return { order: [...initial.order] };
    const perm = shuffledIndices(config.items.length, `sort:${config.title}`);
    return { order: perm.map((i) => config.items[i]?.id).filter((id): id is string => Boolean(id)) };
  });
  const [finishing, setFinishing] = React.useState(false);
  /** Подсветка «на своём месте» — по кнопке, см. комментарий в разметке. */
  const [showHint, setShowHint] = React.useState(false);
  const finish = useFinish(onFinish);

  const total = config.items.length;
  const itemsById = React.useMemo(() => {
    const map = new Map(config.items.map((i) => [i.id, i]));
    return map;
  }, [config.items]);

  React.useEffect(() => {
    onChange({ ...state });
  }, [state, onChange]);

  /** Перенос `fromId` на место `toId` (порядок вверх/вниз — тот же код). */
  const moveTo = React.useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setState((prev) => {
      const from = prev.order.indexOf(fromId);
      const to = prev.order.indexOf(toId);
      if (from < 0 || to < 0) return prev;
      const order = [...prev.order];
      order.splice(to, 0, ...order.splice(from, 1));
      return { ...prev, order };
    });
  }, []);

  /** Сдвиг на ±1 — для кнопок на телефоне и стрелок с клавиатуры. */
  const shift = React.useCallback((id: string, delta: number) => {
    setState((prev) => {
      const from = prev.order.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.order.length) return prev;
      const order = [...prev.order];
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return { ...prev, order };
    });
  }, []);

  const drag = useDragSort({ onDrop: (fromId, toId) => moveTo(fromId, toId) });

  const answers = React.useMemo(
    () => [
      {
        itemId: config.items[0]?.id ?? "order",
        chosenOrder: [...state.order],
        ms: 0,
      },
    ],
    [config.items, state.order],
  );
  const live = React.useMemo(() => scoreSortSequence({ config, answers }), [config, answers]);

  React.useEffect(() => {
    if (!finishing) return;
    finish({ config, answers }, startedAtRef.current);
  }, [finishing, config, answers, finish]);

  if (options.mode === "classify") {
    return (
      <Card data-interactive-player="" data-interactive-format="sort-sequence" className="text-center">
        <p className="text-sm text-warm-600">
          Этот интерактив настроен на разбивку по двум корзинам. Такой формат
          называется «Группировка по корзинам» — попросите учителя пересоздать
          интерактив в нужном формате.
        </p>
      </Card>
    );
  }

  const principleLabel = SORT_PRINCIPLES[options.principle] ?? options.principle;

  return (
    <div data-interactive-player="" data-interactive-format="sort-sequence">
      <Progress done={0} total={total} label={`Расставьте ${total} предметов`} />

      <Card className="mb-4">
        <p className="text-sm text-warm-700">
          Расставьте по порядку: <span className="font-semibold">{principleLabel}</span>.
        </p>
        <p className="text-xs text-warm-500 mt-1">
          Тяните за ручку или жмите стрелки. Правильность покажем после проверки.
        </p>
      </Card>

      <ol className="space-y-2" data-interactive-sequence="">
        {state.order.map((id, index) => {
          const item = itemsById.get(id);
          if (!item) return null;
          const isActive = drag.isActive(id);
          return (
            <li key={id}>
              <Card
                padded={false}
                className={cn(
                  "transition-all",
                  isActive && "ring-2 ring-brand-400",
                  drag.isOver(id) && "ring-2 ring-accent-400",
                )}
                data-interactive-row={id}
              >
                <div className="flex items-stretch gap-2 p-3">
                  <span
                    className="shrink-0 w-7 h-7 rounded-lg bg-brand-100 text-brand-800 grid place-items-center text-sm font-semibold"
                    aria-hidden
                  >
                    {index + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => drag.grab(id)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          drag.grab(id);
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          shift(id, -1);
                        }
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          shift(id, 1);
                        }
                        if (e.key === "Escape") drag.cancel();
                      }}
                      aria-pressed={isActive}
                      className="w-full text-left"
                      data-interactive-row-button={id}
                      {...drag.zoneProps(id)}
                    >
                      <ItemVisual item={item} showPrompt />
                    </button>
                  </div>

                  <div className="shrink-0 flex flex-col items-center justify-center gap-1">
                    <span
                      className="px-1.5 py-1 text-warm-300 select-none"
                      aria-hidden
                      data-interactive-handle={id}
                      {...drag.handleProps(id)}
                    >
                      ⠿
                    </span>
                    <button
                      type="button"
                      onClick={() => shift(id, -1)}
                      disabled={index === 0}
                      className="w-7 h-7 rounded-lg text-warm-400 hover:text-warm-800 hover:bg-warm-100 disabled:opacity-30"
                      aria-label={`Поднять «${item.prompt}»`}
                      data-interactive-up={id}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => shift(id, 1)}
                      disabled={index === state.order.length - 1}
                      className="w-7 h-7 rounded-lg text-warm-400 hover:text-warm-800 hover:bg-warm-100 disabled:opacity-30"
                      aria-label={`Опустить «${item.prompt}»`}
                      data-interactive-down={id}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="mt-4">
        <Button
          size="lg"
          fullWidth
          onClick={() => setFinishing(true)}
          data-testid="sequence-check"
        >
          Проверить порядок
        </Button>
        {/*
          ТЗ §2.7 просит подсветку «на своём месте», но показывать её с самого
          начала нельзя: предметы сортируются по принципу, который ученик ещё не
          применял, и счёт сразу скажет ответ. Поэтому подсветка включается
          кнопкой и по умолчанию выключена.
        */}
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            className="text-xs text-warm-500 underline hover:text-warm-700"
            data-testid="sequence-hint-toggle"
          >
            {showHint ? "Скрыть подсказку" : "Включить подсказку"}
          </button>
          {showHint && (
            <p className="mt-1 text-xs text-warm-600">
              Сейчас верных мест: {live.detail.positionsCorrect ?? 0} из {total}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
