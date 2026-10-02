"use client";

/**
 * Плеер 4: «Колесо фортуны» (TZ-13 §2.5).
 *
 * Правила ровно по ТЗ:
 *   - круг на 4–8 секторов, каждый сектор — категория вопросов;
 *   - «Крутить» → колесо крутится и останавливается на секторе → из этого
 *     сектора выпадает ВОПРОС (не категория, а конкретный вопрос);
 *   - правильный ответ → очко, крутим снова; неправильный → вопрос засчитан
 *     как пройденный, но без очка;
 *   - вопрос из сектора не повторяется.
 *
 * Формула (ТЗ §2.5):
 * ```
 * sector_progress = { "Сложение": 3/5, ... }
 * score           = число правильных ответов
 * percent         = round(100 * score / total_questions)
 * stars           = все секторы пройдены ? 3 : score/total > 0.6 ? 2 : 1
 * ```
 *
 * Колесо — это SVG, который мы САМИ строим здесь, а не `renderChart`: ТЗ §4.8
 * прямо говорит, что рендерер для этого не годится (он отдаёт статичную строку
 * без возможности анимировать). Анимация — CSS-переход на `transform: rotate`,
 * поэтому отдельный CSS-файл и правки `globals.css` не нужны.
 *
 * Секторы считаются ОТ РАЗМЕТКИ SVG, а не «на глаз»: угол сектора = 360 / n,
 * а выпавший сектор = round(угол поворота / (360/n)) % n. Так колесо не может
 * показать одно, а вопрос взять из другого.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { normalizeOptions } from "@/lib/interactives/formats";
import { scoreFortuneWheel } from "@/lib/interactives/scoring";
import type { ClientAttemptAnswer, FortuneWheelOptions, PlayerProps } from "@/lib/interactives/types";
import { ItemVisual } from "../ItemVisual";
import { ChoiceList, Progress, useFinish } from "./common";

interface WheelState {
  /** Накопленный поворот в градусах (монотонно растёт, иначе анимация «откатится»). */
  rotation: number;
  /** id выпавшего вопроса. */
  currentId: string | null;
  /** Уже закрытые вопросы: id → выбранный вариант. */
  answered: Record<string, number>;
  /** Сколько раз крутили (для восстановления угла). */
  spins: number;
}

function isWheelState(raw: unknown, ids: ReadonlySet<string>): raw is WheelState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<WheelState>;
  if (typeof s.rotation !== "number" || typeof s.spins !== "number") return false;
  if (!s.answered || typeof s.answered !== "object") return false;
  if (s.currentId != null && !ids.has(s.currentId)) return false;
  for (const key of Object.keys(s.answered)) if (!ids.has(key)) return false;
  return true;
}

const SECTOR_COLORS = [
  "#3BA776",
  "#F2994A",
  "#4C7DF0",
  "#E86A5E",
  "#9B6BE8",
  "#2AA198",
  "#D9534F",
  "#5B8C5A",
];

export function FortuneWheel({ config, initial, onChange, onFinish }: PlayerProps) {
  const options: FortuneWheelOptions = normalizeOptions("fortune-wheel", config.options);
  const ids = React.useMemo(() => new Set(config.items.map((i) => i.id)), [config.items]);
  const startedAtRef = React.useRef<number>(0);
  if (startedAtRef.current === 0) startedAtRef.current = Date.now();

  const [state, setState] = React.useState<WheelState>(() =>
    isWheelState(initial, ids) ? initial : { rotation: 0, currentId: null, answered: {}, spins: 0 },
  );
  const [spinning, setSpinning] = React.useState(false);
  /** Верно/неверно по ПРЕДЫДУЩЕМУ ответу — короткая обратная связь. */
  const [lastVerdict, setLastVerdict] = React.useState<"correct" | "wrong" | null>(null);
  /** Сколько градусов ещё крутить (для «доводки» до середины сектора). */
  const [target, setTarget] = React.useState(0);
  const finish = useFinish(onFinish);

  // Секторы берём из конфига, а не из опций: реальные подписи живут в item.bucket.
  const sectors = React.useMemo(() => {
    const names = new Set<string>();
    for (const item of config.items) if (item.bucket) names.add(item.bucket);
    const fromItems = [...names];
    return fromItems.length >= 2 ? fromItems : options.sectors;
  }, [config.items, options.sectors]);

  React.useEffect(() => {
    onChange({ ...state });
  }, [state, onChange]);

  const answers: ClientAttemptAnswer[] = React.useMemo(
    () =>
      Object.entries(state.answered).map(([itemId, chosenIndex]) => ({
        itemId,
        chosenIndex,
        ms: 0,
      })),
    [state.answered],
  );
  const live = React.useMemo(() => scoreFortuneWheel({ config, answers }), [config, answers]);

  const remaining = React.useMemo(
    () => config.items.filter((i) => state.answered[i.id] === undefined),
    [config.items, state.answered],
  );
  const currentItem = state.currentId
    ? config.items.find((i) => i.id === state.currentId)
    : undefined;

  /* ─── вращение ───────────────────────────────────────────────────────── */

  const spin = () => {
    if (spinning || state.currentId) return;
    const n = sectors.length;
    if (n === 0) return;

    // Сектор определяем ДО анимации: показываем то, что реально выпадет.
    const pool = remaining.length > 0 ? remaining : config.items;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const sectorIndex = Math.max(0, sectors.indexOf(picked.bucket ?? sectors[0]));

    const step = 360 / n;
    // Доводим до середины нужного сектора + полный оборот, чтобы колесо
    // заметно крутилось, а не прыгало на 3°.
    const desired = 360 - (sectorIndex * step + step / 2);
    const normalized = ((state.rotation % 360) + 360) % 360;
    const delta = ((desired - normalized) % 360) + 360 * (2 + (state.spins % 3));
    const nextRotation = state.rotation + delta;

    setTarget(nextRotation);
    setSpinning(true);
    window.setTimeout(() => {
      setState((prev) => ({
        ...prev,
        rotation: nextRotation,
        spins: prev.spins + 1,
        currentId: picked.id,
      }));
      setSpinning(false);
    }, 2600);
  };

  /* ─── ответ ──────────────────────────────────────────────────────────── */

  const answer = (index: number) => {
    if (!state.currentId) return;
    const itemId = state.currentId;
    const correct = config.items.find((i) => i.id === itemId)?.correctIndex === index;
    setLastVerdict(correct ? "correct" : "wrong");
    setState((prev) => ({
      ...prev,
      answered: { ...prev.answered, [itemId]: index },
      currentId: null,
    }));
  };

  React.useEffect(() => {
    if (remaining.length > 0) return;
    if (state.currentId) return;
    finish({ config, answers }, startedAtRef.current);
  }, [remaining.length, state.currentId, config, answers, finish]);

  if (sectors.length === 0 || config.items.length === 0) {
    return (
      <Card className="text-center" data-interactive-player="" data-interactive-format="fortune-wheel">
        <p className="text-sm text-warm-600">
          В интерактиве нет секторов. Попросите учителя пересоздать его.
        </p>
      </Card>
    );
  }

  const step = 360 / sectors.length;

  return (
    <div data-interactive-player="" data-interactive-format="fortune-wheel">
      <Progress
        done={Object.keys(state.answered).length}
        total={config.items.length}
        label={`Вопросов закрыто: ${Object.keys(state.answered).length} из ${config.items.length}`}
      />

      <div className="grid sm:grid-cols-2 gap-4 items-center">
        <div className="relative mx-auto" style={{ width: "100%", maxWidth: 280 }}>
          <svg
            viewBox="0 0 200 200"
            className="w-full"
            role="img"
            aria-label={`Колесо с секторами: ${sectors.join(", ")}`}
            data-interactive-wheel=""
          >
            {sectors.map((sector, index) => {
              const start = index * step - 90;
              const end = start + step;
              return (
                <path
                  key={sector}
                  d={describeSector(start, end)}
                  fill={SECTOR_COLORS[index % SECTOR_COLORS.length]}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
              );
            })}
            {/* Указатель сверху: на него смотрит ученик. */}
            <polygon points="100,4 94,18 106,18" fill="#2D2A26" />
            <circle cx="100" cy="100" r="18" fill="#ffffff" stroke="#2D2A26" strokeWidth="2" />
          </svg>
          <div
            className="absolute inset-0 grid place-items-center pointer-events-none"
            style={{
              transform: `rotate(${target || state.rotation}deg)`,
              transition: spinning ? "transform 2.6s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
            }}
            data-interactive-wheel-disc=""
          >
            <WheelLabels sectors={sectors} />
          </div>
        </div>

        <div>
          {currentItem ? (
            <Card>
              <BadgeLike sector={currentItem.bucket ?? ""} />
              <div className="mt-2">
                <ItemVisual item={currentItem} />
              </div>
              <div className="mt-3">
                <ChoiceList
                  itemId={currentItem.id}
                  options={currentItem.options ?? []}
                  onChoose={answer}
                  correctIndex={currentItem.correctIndex}
                />
              </div>
            </Card>
          ) : (
            <Card className="text-center">
              <p className="text-4xl" aria-hidden>
                🎡
              </p>
              <p className="mt-2 text-sm text-warm-600">
                {remaining.length > 0
                  ? `Осталось вопросов: ${remaining.length}`
                  : "Все вопросы закрыты"}
              </p>
              {lastVerdict && (
                <p
                  className={cn(
                    "mt-2 text-sm font-medium",
                    lastVerdict === "correct" ? "text-emerald-700" : "text-rose-600",
                  )}
                  role="status"
                  data-testid="wheel-verdict"
                >
                  {lastVerdict === "correct" ? "Верно! +1 очко. Крутим снова." : "Неверно, вопрос закрыт. Крутим дальше."}
                </p>
              )}
              <Button
                className="mt-4"
                size="lg"
                fullWidth
                loading={spinning}
                onClick={spin}
                data-testid="wheel-spin"
              >
                {spinning ? "Крутим…" : "Крутить"}
              </Button>
            </Card>
          )}

          <ul className="mt-3 space-y-1">
            {Object.entries(live.detail.sectorProgress ?? {}).map(([name, p]) => (
              <li key={name} className="flex items-center justify-between text-sm">
                <span className="text-warm-600 truncate">{name}</span>
                <span
                  className={cn(
                    "font-medium",
                    p.done >= p.total && p.total > 0 ? "text-emerald-700" : "text-warm-950",
                  )}
                >
                  {p.done}/{p.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Подписи секторов — SVG-текст по кругу, поворачивается вместе с колесом. */
function WheelLabels({ sectors }: { sectors: string[] }) {
  const step = 360 / sectors.length;
  return (
    <svg viewBox="0 0 200 200" className="w-full" aria-hidden>
      {sectors.map((sector, index) => {
        const angle = index * step + step / 2;
        return (
          <text
            key={sector}
            x="100"
            y="62"
            fill="#ffffff"
            fontSize="9"
            fontWeight="600"
            textAnchor="middle"
            transform={`rotate(${angle} 100 100)`}
          >
            {truncate(sector, 12)}
          </text>
        );
      })}
    </svg>
  );
}

/** Сектор колеса как SVG-путь. Углы в градусах, начало — сверху. */
function describeSector(start: number, end: number): string {
  const r = 98;
  const x1 = 100 + r * Math.cos((start * Math.PI) / 180);
  const y1 = 100 + r * Math.sin((start * Math.PI) / 180);
  const x2 = 100 + r * Math.cos((end * Math.PI) / 180);
  const y2 = 100 + r * Math.sin((end * Math.PI) / 180);
  const largeArc = Math.abs(end - start) > 180 ? 1 : 0;
  return `M 100 100 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(
    2,
  )} ${y2.toFixed(2)} Z`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function BadgeLike({ sector }: { sector: string }) {
  if (!sector) return null;
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-brand-100 text-brand-800">
      {sector}
    </span>
  );
}
