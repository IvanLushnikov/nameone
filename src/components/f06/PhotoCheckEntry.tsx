"use client";

/**
 * Вход в «Проверку работ по фото» (F-06, исправление 08.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО НЕ ТАК
 * ─────────────────────────────────────────────────────────────────────────────
 * Карточка «Проверка работ по фото» на главной ведёт в `/constructor?photo=1`.
 * По этому флагу конструктор раскрывал панель `PhotoCheckPanel` — но панель
 * рендерилась только при `kind === "worksheet"`, то есть ТОЛЬКО ПОСЛЕ того, как
 * лист уже сгенерирован. Учительница нажала «Попробовать» и попала в
 * конструктор с открытым генератором: «при нажатии открывается генератор, а не
 * проверка работ».
 *
 * Причина в том, что панель умеет сверять ответы ученика только с эталоном —
 * самим листом (`tasks` в multipart, `MIN_TASKS` на бэке). Без листа сверять
 * не с чем, и молча подставлять выдуманные задания было бы враньём.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО СДЕЛАНО
 * ─────────────────────────────────────────────────────────────────────────────
 * Этот экран — честная середина между двумя обещаниями:
 *   · он открывается по клику «Попробовать» на карточке, то есть ДЕЛАЕТ то,
 *     что обещает карточка, а не открывает генератор;
 *   · он объясняет, что для проверки нужен эталон, и одним действием создаёт
 *     его (обычная генерация листа по выбранной теме), после чего панель
 *     открывается сама.
 *
 * Эталоном может быть и готовый лист из кабинета — на этот случай внизу
 * ссылка в историю, а не пустое место.
 */

import { Camera, FileText, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export interface PhotoCheckEntryProps {
  /** Сгенерировать эталонный лист и открыть проверку. */
  onCreateSource: () => void;
  /** Открыть историю готовых листов (эталон оттуда). */
  onOpenHistory: () => void;
}

export function PhotoCheckEntry({ onCreateSource, onOpenHistory }: PhotoCheckEntryProps) {
  return (
    <Card className="border-dashed border-warm-300 bg-gradient-to-br from-warm-50 to-white">
      <div className="flex flex-col items-center text-center pt-8 pb-6 px-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center text-white shadow-brand mb-5">
          <Camera className="w-8 h-8" />
        </div>

        <h2 className="text-2xl font-display font-bold text-warm-950 mb-2">
          Проверка работ по фото
        </h2>
        <p className="text-warm-600 max-w-md mb-2">
          Сфотографируйте страницу тетради — мы прочитаем ответы и сверим их с
          заданиями, поставим балл и покажем разбор.
        </p>

        {/*
          Честное объяснение ограничения. Раньше его не было: учительница
          нажимала «Попробовать» и проваливалась в генератор без объяснения,
          почему фото-проверки на экране нет.
        */}
        <p className="text-sm text-warm-500 max-w-md mb-6">
          Чтобы сверить ответы, нужен сам лист с заданиями — по нему мы
          проверяем. Сделайте лист, и проверка откроется сразу после него.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={onCreateSource}
            leftIcon={<FileText className="w-4 h-4" />}
            data-testid="photo-check-create-source"
          >
            Сделать лист и проверить фото
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={onOpenHistory}
            rightIcon={<ArrowRight className="w-4 h-4" />}
            data-testid="photo-check-open-history"
          >
            Взять лист из истории
          </Button>
        </div>

        {/*
          Срок — 7 дней (`PHOTO_RETENTION_DAYS` в
          `backend/src/services/photoCheckGrading.ts`). Написать «24 часа»
          было бы дешевле и эффектнее, но неправда: учительница возвращается к
          разбору фото и через пару дней. Правда про срок удаления работает
          лучше обещания, которого продукт не держит.
        */}
        <p className="text-xs text-warm-400 mt-6">
          Фото хранятся 7 дней, потом удаляются. Само изображение не попадает в
          обучение моделей; результаты проверки остаются в кабинете.
        </p>
      </div>
    </Card>
  );
}