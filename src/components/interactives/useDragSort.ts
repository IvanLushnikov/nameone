"use client";

/**
 * `useDragSort` — общий drag-and-drop движка (TZ-13 §4.3, пункт 4).
 *
 * Один хук на ДВА формата: «Группировка по корзинам» (`sort-baskets`) и
 * «Сортировка» (`sort-sequence`). Это и есть аргумент за «движок + 6 конфигов»:
 * перетаскивание написано один раз, а не дважды.
 *
 * ТРИ способа взять предмет — потому что у 5–6 классов основной девайс телефон
 * (ТЗ §2.3), но у учителя ноутбук, а у части детей включена клавиатурная
 * навигация (ТЗ DoD, фаза 2):
 *   1. **мышь** — pointer events;
 *   2. **палец** — те же pointer events, но перетаскивание включается только
 *      за РУЧКУ (`⠿`), иначе `touch-action: none` съел бы вертикальный скролл
 *      страницы на телефоне. Это осознанное решение: съеденный скролл ломает
 *      страницу сильнее, чем чуть более длинное касание;
 *   3. **клавиатура** — `grab` / `release`: Space или Enter «взять и положить».
 *
 * Никаких библиотек: HTML5 drag-and-drop на тачскринах не работает вообще.
 *
 * ПЕРЕТАСКИВАНИЕ — НЕ ИСТОЧНИК ИСТИНЫ. Хук двигает только пиксели и порядок в
 * локальном состоянии; баллы считает `scoring.ts` по `config_json`.
 */

import * as React from "react";

/** Атрибут, по которому зона приёма сообщает хуку «я тут». */
const TARGET_ATTR = "data-drag-target";

export interface UseDragSortOptions {
  /**
   * Куда сообщать о drop-е. `targetId` — id зоны под курсором: для
   * сортировки это id соседней карточки, для корзин — id корзины.
   */
  onDrop: (itemId: string, targetId: string) => void;
  /** Игра окончена / карточка заблокирована — перетаскивание выключено. */
  disabled?: boolean;
}

export interface UseDragSortApi {
  /** Что сейчас «в руках» — мышью или с клавиатуры. */
  activeId: string | null;
  /** Над чем в данный момент. */
  overId: string | null;
  /** Взято с клавиатуры (для скринридеров и кнопок ↑↓). */
  grabbedId: string | null;
  /** Поведение для РУЧКИ карточки: pointerdown + запрет скролла. */
  handleProps: (itemId: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Поведение для ЗОНЫ ПРИЁМА: карточка в списке или корзина. */
  zoneProps: (targetId: string) => {
    [TARGET_ATTR]: string;
  };
  /** Взять предмет (Space / Enter на карточке). */
  grab: (itemId: string) => void;
  /** Положить предмет (Enter на зоне). */
  release: () => void;
  /** Отменить перетаскивание (Escape). */
  cancel: () => void;
  /** Подсветка: «здесь бросай». */
  isOver: (targetId: string) => boolean;
  /** Подсветка: «это в руках». */
  isActive: (itemId: string) => boolean;
}

export function useDragSort({ onDrop, disabled }: UseDragSortOptions): UseDragSortApi {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [grabbedId, setGrabbedId] = React.useState<string | null>(null);

  // `onDrop` меняется на каждом рендере (замыкание на состояние плеера).
  // Держим его в ref, чтобы не переподписывать слушатели указателей.
  const onDropRef = React.useRef(onDrop);
  React.useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const reset = React.useCallback(() => {
    setActiveId(null);
    setOverId(null);
  }, []);

  React.useEffect(() => {
    if (!activeId) return;
    if (disabled) {
      reset();
      return;
    }

    const move = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const zone = el?.closest(`[${TARGET_ATTR}]`);
      const id = zone?.getAttribute(TARGET_ATTR) ?? null;
      setOverId(id);
    };

    const finish = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const zone = el?.closest(`[${TARGET_ATTR}]`);
      const targetId = zone?.getAttribute(TARGET_ATTR) ?? null;
      if (targetId && targetId !== activeId) onDropRef.current(activeId, targetId);
      reset();
    };

    const cancel = () => reset();

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);

    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [activeId, disabled, reset]);

  // Игра перезапустилась (ученик нажал «Заново») — тащим нечего.
  React.useEffect(() => {
    if (disabled) setGrabbedId(null);
  }, [disabled]);

  const handleProps = React.useCallback(
    (itemId: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (disabled) return;
        // Только основная кнопка: правый клик открывает контекстное меню.
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        setActiveId(itemId);
        setOverId(null);
      },
      // Только на ручке: палец тянет карточку, страница скроллится как обычно.
      style: { touchAction: "none" as const, cursor: disabled ? "default" : "grab" },
    }),
    [disabled],
  );

  const zoneProps = React.useCallback(
    (targetId: string) => ({ [TARGET_ATTR]: targetId }),
    [],
  );

  return {
    activeId,
    overId,
    grabbedId,
    handleProps,
    zoneProps,
    grab: React.useCallback((itemId: string) => {
      if (disabled) return;
      setGrabbedId((prev) => (prev === itemId ? null : itemId));
    }, [disabled]),
    release: React.useCallback(() => setGrabbedId(null), []),
    cancel: React.useCallback(() => {
      setGrabbedId(null);
      reset();
    }, [reset]),
    isOver: React.useCallback((targetId: string) => overId === targetId, [overId]),
    isActive: React.useCallback((itemId: string) => activeId === itemId || grabbedId === itemId, [activeId, grabbedId]),
  };
}
