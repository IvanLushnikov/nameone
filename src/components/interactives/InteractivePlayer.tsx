"use client";

/**
 * `InteractivePlayer` — диспетчер по формату (TZ-13 §4.3, пункт 2).
 *
 * Единственное место в репе, где решается «какой компонент показывать».
 * Оболочка (`InteractiveShell`) и страница (`/play/`) о форматах не знают.
 *
 * ⚠️ EXHAUSTIVENESS — обязательное требование: `default` с `_exhaustive: never`
 * заставит TypeScript упасть, когда в `InteractiveFormat` появится седьмой
 * формат. Без этой проверки новый формат молча показывал бы пустой экран
 * ученику (ровно тот баг, от которого страховка Р-3 в ТЗ §8).
 *
 * Каждый плеер принимает ОДИН И ТОТ ЖЕ контракт (`PlayerProps`): конфиг,
 * снапшот для восстановления и два колбэка. Никакой форматной логики здесь.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { QuizRace } from "./players/QuizRace";
import { SortBaskets } from "./players/SortBaskets";
import { JumpTruth } from "./players/JumpTruth";
import { FortuneWheel } from "./players/FortuneWheel";
import { Jeopardy } from "./players/Jeopardy";
import { SortSequence } from "./players/SortSequence";
import type { PlayerProps } from "@/lib/interactives/types";

export function InteractivePlayer({ config, initial, onChange, onFinish }: PlayerProps) {
  switch (config.format) {
    case "quiz-race":
      return (
        <QuizRace
          config={config}
          initial={initial}
          onChange={onChange}
          onFinish={onFinish}
        />
      );
    case "sort-baskets":
      return (
        <SortBaskets
          config={config}
          initial={initial}
          onChange={onChange}
          onFinish={onFinish}
        />
      );
    case "jump-truth":
      return (
        <JumpTruth
          config={config}
          initial={initial}
          onChange={onChange}
          onFinish={onFinish}
        />
      );
    case "fortune-wheel":
      return (
        <FortuneWheel
          config={config}
          initial={initial}
          onChange={onChange}
          onFinish={onFinish}
        />
      );
    case "jeopardy":
      return (
        <Jeopardy
          config={config}
          initial={initial}
          onChange={onChange}
          onFinish={onFinish}
        />
      );
    case "sort-sequence":
      return (
        <SortSequence
          config={config}
          initial={initial}
          onChange={onChange}
          onFinish={onFinish}
        />
      );
    default: {
      // Exhaustiveness: седьмой формат заставит TS показать ошибку ЗДЕСЬ.
      const _exhaustive: never = config.format;
      return (
        <Card data-interactive-player="">
          <p className="text-sm text-warm-600">
            Формат «{String(_exhaustive)}» пока не поддерживается. Попросите учителя
            пересоздать интерактив.
          </p>
        </Card>
      );
    }
  }
}
