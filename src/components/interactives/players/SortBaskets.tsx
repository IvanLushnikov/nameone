"use client";

/**
 * Плеер 2: «Группировка по корзинам» (TZ-13 §2.3).
 *
 * Правила ровно по ТЗ:
 *   - 2–4 корзины, 8–20 карточек, часть карточек — ловушки (`isTrap`);
 *   - правильно → карточка загорается зелёным и уезжает в счётчик;
 *   - неправильно → карточка НЕ исчезает, можно попробовать ещё раз,
 *     счётчик ошибок +1;
 *   - итог: «сколько из N на своих местах» + звёзды по числу ошибок.
 *
 * ТРИ способа положить карточку, и это не «перестраховка», а требование ТЗ
 * (Р-2, DoD фазы 2): основной девайс 5–6 классов — телефон.
 *   1. перетащить за ручку (pointer events — работает мышью и пальцем);
 *   2. нажать карточку, потом нажать корзину (два касания, самый надёжный
 *      способ на телефоне: промахнуться пальцем невозможно);
 *   3. с клавиатуры: Enter/Space «взять», Enter на корзине «положить».
 *
 * Перетаскивание — общий хук движка `useDragSort`, тот же, что у «Сортировки».
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import { normalizeOptions } from "@/lib/interactives/formats";
import { scoreSortBaskets } from "@/lib/interactives/scoring";
import {
  TRAP_BUCKET_ID,
  TRAP_BUCKET_LABEL,
  type ClientAttemptAnswer,
  type PlayerProps,
  type SortBasketsOptions,
} from "@/lib/interactives/types";
import { ItemVisual } from "../ItemVisual";
import { useDragSort } from "../useDragSort";
import { Progress, useFinish } from "./common";

/** Снапшот: что ученик уже положил и сколько раз промахнулся. */
interface BasketsState {
  /** itemId → id корзины, куда карточка уже легла (только верные). */
  placed: Record<string, string>;
  /** itemId → сколько раз клали не в ту корзину. */
  errors: Record<string, number>;
}

function isBasketsState(raw: unknown, ids: ReadonlySet<string>): raw is BasketsState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<BasketsState>;
  if (!s.placed || typeof s.placed !== "object") return false;
  if (!s.errors || typeof s.errors !== "object") return false;
  for (const key of Object.keys(s.placed)) if (!ids.has(key)) return false;
  for (const key of Object.keys(s.errors)) if (!ids.has(key)) return false;
  return true;
}

export function SortBaskets({ config, initial, onChange, onFinish }: PlayerProps) {
  const options: SortBasketsOptions = normalizeOptions("sort-baskets", config.options);
  const ids = React.useMemo(() => new Set(config.items.map((i) => i.id)), [config.items]);
  const startedAtRef = React.useRef<number>(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const [state, setState] = React.useState<BasketsState>(() =>
    isBasketsState(initial, ids) ? initial : { placed: {}, errors: {} },
  );
  /** Карточка, выбранная тапом или с клавиатуры (кандидат на бросок). */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [finishing, setFinishing] = React.useState(false);
  const finish = useFinish(onFinish);

  const total = config.items.length;
  const pending = config.items.filter((i) => !state.placed[i.id]);

  const answers: ClientAttemptAnswer[] = React.useMemo(
    () =>
      config.items
        .filter((item) => state.placed[item.id] !== undefined)
        .map((item) => ({
          itemId: item.id,
          chosenBucket: state.placed[item.id],
          errors: state.errors[item.id] ?? 0,
          ms: 0,
        })),
    [config.items, state.placed, state.errors],
  );
  const live = React.useMemo(() => scoreSortBaskets({ config, answers }), [config, answers]);

  React.useEffect(() => {
    onChange({ ...state });
  }, [state, onChange]);

  /**
   * Кладём карточку в корзину.
   *
   * Правильно → карточка загорается зелёным и уезжает из списка (ТЗ §2.3).
   * Неправильно → остаётся на месте, растёт счётчик ошибок.
   * Ловушка (`isTrap`, без `correctBucket`) правильно уходит в зону «мимо».
   */
  const drop = React.useCallback(
    (itemId: string, bucket: string) => {
      const item = config.items.find((i) => i.id === itemId);
      if (!item) return;
      if (state.placed[itemId]) return;

      const accepted = (item.correctBucket ?? "")
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);
      const isCorrect = item.isTrap ? bucket === TRAP_BUCKET_ID : accepted.includes(bucket);

      if (isCorrect) {
        setState((prev) =>
          prev.placed[itemId]
            ? prev
            : { ...prev, placed: { ...prev.placed, [itemId]: bucket } },
        );
      } else {
        setState((prev) => ({
          ...prev,
          errors: { ...prev.errors, [itemId]: (prev.errors[itemId] ?? 0) + 1 },
        }));
      }
      setSelectedId(null);
    },
    [config.items, state.placed],
  );

  const drag = useDragSort({ onDrop: (itemId, bucket) => drop(itemId, bucket) });

  // Бросок выбранной карточки в корзину тапом или с клавиатуры.
  const dropSelected = React.useCallback(
    (bucket: string) => {
      if (!selectedId) return;
      drop(selectedId, bucket);
    },
    [selectedId, drop],
  );

  React.useEffect(() => {
    if (!finishing) return;
    finish({ config, answers }, startedAtRef.current);
  }, [finishing, config, answers, finish]);

  const allPlaced = pending.length === 0;
  const hasTraps = config.items.some((i) => i.isTrap);
  /** Зоны приёма: корзины учителя + служебная корзина для ловушек. */
  const zones = hasTraps
    ? [...options.baskets, TRAP_BUCKET_ID]
    : [...options.baskets];

  return (
    <div data-interactive-player="" data-interactive-format="sort-baskets">
      <Progress
        done={Object.keys(state.placed).length}
        total={total}
        label={`На своих местах: ${Object.keys(state.placed).length} из ${total}`}
      />

      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-warm-600">
            Ошибок: <span className="font-semibold text-warm-950">{live.detail.errors ?? 0}</span>
          </p>
          <p className="text-sm text-warm-600">
            На своих местах:{" "}
            <span className="font-semibold text-warm-950" data-testid="baskets-score">
              {live.detail.correct}
            </span>
          </p>
        </div>
        {selectedId && (
          <p className="mt-2 text-sm text-brand-700" role="status" data-testid="baskets-hint">
            Выбрана карточка «{config.items.find((i) => i.id === selectedId)?.prompt ?? ""}» —
            нажми на корзину. Нажми ещё раз на карточку, чтобы отменить.
          </p>
        )}
      </Card>

      {/* Корзины — зоны приёма для перетаскивания и цели для тапа. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {zones.map((basket) => {
          const count = Object.values(state.placed).filter((b) => b === basket).length;
          const isDropTarget = drag.isOver(basket);
          return (
            <button
              key={basket}
              type="button"
              onClick={() => dropSelected(basket)}
              onKeyDown={(e) => {
                // Захватываем значение ДО проверки: внутри колбэка TypeScript
                // не сужает `drag.grabbedId` из `string | null` до `string`.
                const grabbed = drag.grabbedId;
                if (e.key === "Enter" && grabbed) drop(grabbed, basket);
                if (e.key === "Escape") drag.cancel();
              }}
              className={cn(
                "rounded-2xl border-2 border-dashed p-3 text-left transition-all min-h-20",
                isDropTarget
                  ? "border-brand-500 bg-brand-50 scale-105"
                  : "border-warm-200 bg-white hover:border-brand-300",
              )}
              data-interactive-basket={basket}
              {...drag.zoneProps(basket)}
            >
              <span className="text-sm font-medium text-warm-950 break-words">
                {basket === TRAP_BUCKET_ID ? TRAP_BUCKET_LABEL : basket}
              </span>
              <span className="block text-xs text-warm-500 mt-1">{count} карточек</span>
            </button>
          );
        })}
      </div>

      {/* Карточки. Правильные уезжают вниз списка «сделано», неправильные остаются. */}
      <ul className="space-y-2" data-interactive-cards="">
        {config.items.map((item) => {
          const placed = state.placed[item.id];
          const wrongTimes = state.errors[item.id] ?? 0;
          const isSelected = selectedId === item.id || drag.isActive(item.id);
          if (placed) return null;

          return (
            <li key={item.id}>
              <Card
                padded={false}
                className={cn(
                  "transition-all",
                  isSelected && "ring-2 ring-brand-400",
                  drag.isOver(item.id) && "ring-2 ring-accent-400",
                )}
                data-interactive-card={item.id}
              >
                <div className="flex items-stretch gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId((prev) => (prev === item.id ? null : item.id))}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        drag.grab(item.id);
                      }
                    }}
                    aria-pressed={isSelected}
                    className="flex-1 text-left min-w-0"
                    data-interactive-card-button={item.id}
                  >
                    <ItemVisual item={item} />
                    {item.isTrap && (
                      <Badge tone="warm" className="mt-2">
                        Не относится ни к одной корзине
                      </Badge>
                    )}
                    {wrongTimes > 0 && (
                      <span className="block mt-1 text-xs text-rose-600">
                        Ошибок: {wrongTimes}
                      </span>
                    )}
                  </button>
                  <span
                    className="shrink-0 px-2 grid place-items-center text-warm-500 select-none"
                    aria-hidden
                    data-interactive-handle={item.id}
                    {...drag.handleProps(item.id)}
                  >
                    ⠿
                  </span>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {allPlaced && pending.length === 0 && total > 0 ? (
        <Card className="mt-4 text-center">
          <p className="text-warm-700">Все карточки разложены.</p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-brand-700 underline"
            onClick={() => setFinishing(true)}
            data-testid="baskets-finish"
          >
            Показать результат
          </button>
        </Card>
      ) : (
        <p className="mt-4 text-xs text-warm-500 text-center">
          Карточки можно перетаскивать за ручку или нажимать: сначала карточка,
          потом корзина. Карточки с галочкой уже на своих местах.
        </p>
      )}
    </div>
  );
}
