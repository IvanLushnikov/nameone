"use client";

/**
 * Экран типа «Интерактив» в конструкторе (лист 4.1.1).
 *
 * Почему отдельный компонент, а не ещё один блок в `page.tsx`: весь путь
 * учителя (выбор формата → сборка → ссылка и QR → возврат в кабинет) держится
 * на двух вещах, которые легко потерять по отдельности — на серверном id листа
 * и на честных словах, когда чего-то не хватает. Здесь они живут вместе.
 *
 * Правила, ради которых файл написан:
 *
 *   1. Кнопка «собрать игру» есть ТОЛЬКО когда сборка реально может удасться.
 *      Нет входа или нет листа — вместо кнопки объяснение и одно действие.
 *      Кнопка, которая после нажатия ничего не делает, хуже отказа.
 *   2. Все шесть форматов показываются списком из реестра движка. Недостроенный
 *      формат нельзя спрятать — его надо либо показать, либо сказать словами.
 *   3. Стоимость видна до кнопки: отдельный вызов модели, лимит 20 игр в час,
 *      и «лист + игра» двумя вызовами, если листа ещё нет.
 *   4. На печать уходит только готовая игра с QR — блок выбора формата и все
 *      кнопки помечены `no-print` (правила печати — в `page.tsx`,
 *      `CONSTRUCTOR_PRINT_CSS`).
 */

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, LayoutDashboard, Lock, Play, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormQrBlock } from "@/components/teacher/FormQrBlock";
import type { CreateInteractiveOk } from "@/lib/interactives/api";
import type { SubjectSlug } from "@/lib/types";
import {
  CONSTRUCTOR_INTERACTIVE_FORMATS,
  INTERACTIVE_DEMO_WARNING,
  constructorFormatCard,
  interactiveBlock,
  interactiveCostNote,
} from "@/lib/construct/interactive";
import type { InteractiveFormat } from "@/lib/interactives/types";

export interface InteractivePreviewProps {
  /** Выбранный формат — состояние живёт в странице, чтобы пережить рендеры. */
  format: InteractiveFormat;
  onFormatChange: (format: InteractiveFormat) => void;
  /** Лист на экране: нужен заголовок для QR и понимание, есть ли задания. */
  worksheetTitle: string | null;
  taskCount: number | null;
  subject: SubjectSlug | null;
  grade: number | null;
  /** Аккаунт учителя: без него сервер не хранит игру и не выдаёт ссылку. */
  loggedIn: boolean;
  /** Id листа В БАЗЕ (`POST /api/worksheets/save`). */
  serverWorksheetId: string | null;
  savingWorksheet: boolean;
  /** Лист — заготовка демо-режима: предупреждаем, но собрать разрешаем. */
  worksheetIsDemo: boolean;
  building: boolean;
  /** Что сейчас происходит, пока идёт сборка («Делаем лист…», «Собираем игру…»). */
  stage: string | null;
  /** Бесплатные генерации кончились: без подписки нельзя сделать лист для игры. */
  outOfQuota: boolean;
  /** Собранная игра. Непустой — показываем ссылку и QR вместо выбора формата. */
  interactive: CreateInteractiveOk | null;
  /** Текст ошибки сборки — уже словами для учителя. */
  error: string | null;
  onBuild: () => void;
  /**
   * Регистрация обработчика сборки в странице. Нужна, чтобы `generate()`
   * страницы по кнопке «Создать» вёл в тот же сборщик, а не в заглушку.
   */
  registerBuild: (fn: (() => void) | null) => void;
}

export default function InteractivePreview(props: InteractivePreviewProps) {
  const {
    format,
    onFormatChange,
    worksheetTitle,
    taskCount,
    subject,
    grade,
    loggedIn,
    serverWorksheetId,
    savingWorksheet,
    worksheetIsDemo,
    building,
    stage,
    outOfQuota,
    interactive,
    error,
    onBuild,
    registerBuild,
  } = props;

  // Страница зовёт сборку сама (например, по общей кнопке «Создать»). Отдаём
  // ей тот же обработчик, что и у кнопки, чтобы две точки входа делали одно.
  React.useEffect(() => {
    registerBuild(building ? null : onBuild);
    return () => registerBuild(null);
  }, [registerBuild, onBuild, building]);

  const card = constructorFormatCard(format);
  const block = interactiveBlock({
    loggedIn,
    hasWorksheet: Boolean(worksheetTitle),
    serverWorksheetId,
    outOfQuota,
  });
  const cost = interactiveCostNote(Boolean(worksheetTitle));

  if (interactive) {
    return (
      <section className="space-y-4" data-testid="interactive-preview" id="interactive-panel">
        <div className="no-print">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-brand-700 shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-warm-950 break-words">Игра готова</h2>
              <p className="text-sm text-warm-600 mt-0.5 break-words">
                {card.emoji} {card.title}
                {worksheetTitle ? ` · из заданий листа «${worksheetTitle}»` : ""}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* `Button as="link"` рендерит `<Link href>` и НЕ пробрасывает
                `target`/`rel` (см. Button.tsx) — ссылка откроется в этой же
                вкладке. Это осознанно: «Показать на весь экран» и «Скачать PDF»
                ниже уже есть, а учителю важнее вернуться назад к игре, чем
                держать вторую вкладку. */}
            <Button
              as="link"
              href={interactive.url}
              variant="primary"
              size="sm"
              leftIcon={<Play className="w-4 h-4" />}
            >
              Открыть игру
            </Button>
            <Button
              as="link"
              href="/dashboard/interactives"
              variant="secondary"
              size="sm"
              leftIcon={<LayoutDashboard className="w-4 h-4" />}
            >
              В личный кабинет
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onBuild}
              loading={building}
              leftIcon={<RefreshCw className="w-4 h-4" />}
              data-testid="interactive-rebuild"
            >
              Собрать заново
            </Button>
          </div>
          <p className="text-xs text-warm-500 mt-2">
            {building && stage
              ? stage
              : "«Собрать заново» берёт тот формат, который выбран ниже. Прежняя ссылка продолжает работать: закрыть её можно в кабинете."}
          </p>
        </div>

        {/* Игра собрана из заготовки — предупреждение остаётся на экране и
            ПОСЛЕ сборки. Раньше оно было только в состоянии «ещё не собрано»,
            и учитель уходил с QR, не прочитав, что отдаёт классу шаблон. */}
        {worksheetIsDemo && (
          <p
            role="status"
            className="no-print flex items-start gap-2 rounded-xl border border-accent-300 bg-accent-50 p-4 text-sm text-warm-900"
            data-testid="interactive-demo-warning"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-accent-700" aria-hidden />
            <span>{INTERACTIVE_DEMO_WARNING}</span>
          </p>
        )}

        {/* Печатаемый кусок: QR с шапкой, как на форме. Формат печати — тот же
            `@media print` в globals.css, `.no-print` на кнопках прячет управление. */}
        <FormQrBlock
          url={interactive.url}
          title={`${worksheetTitle ?? card.title} — ${card.title}`}
          subject={subject ?? "Математика"}
          grade={grade ?? 0}
        />

        {/* Выбор формата на печать не идёт: учитель вешает на доску QR, а не
            анкету с шестью радиокнопками. Без `no-print` список форматов
            уезжал на тот же лист (`08-1440-print-media`). */}
        <div className="no-print">
          <FormatChooser
            format={format}
            onFormatChange={onFormatChange}
            note="Другой формат — та же тема и класс, задания те же. После выбора нажмите «Собрать заново»."
            disabled={building}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 no-print" data-testid="interactive-preview" id="interactive-panel">
      <Card>
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5" aria-hidden>
            {card.emoji}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-warm-950">Игра для класса</h2>
            <p className="text-sm text-warm-600 mt-0.5">
              {worksheetTitle
                ? `Задания взяты из листа «${worksheetTitle}»${taskCount ? ` · ${taskCount} шт.` : ""}`
                : "Собирается из заданий рабочего листа по этой теме"}
            </p>
          </div>
        </div>

        {/* Причина, по которой кнопки нет. Словами, а не серой кнопкой. */}
        {block.kind !== "ready" && block.kind !== "need-worksheet" && (
          <div
            role="status"
            className="mt-4 rounded-xl border border-accent-300 bg-accent-50 p-4 text-sm text-warm-900"
            data-testid="interactive-block"
          >
            <p className="font-semibold">{block.title}</p>
            <p className="mt-1 text-warm-700">{block.text}</p>
            {block.kind === "need-login" && (
              <Button
                as="link"
                href="/login"
                variant="secondary"
                size="sm"
                className="mt-3"
                leftIcon={<Lock className="w-4 h-4" />}
                data-testid="interactive-login"
              >
                Войти
              </Button>
            )}
          </div>
        )}

        {/* Сохранение листа ещё идёт. Это подсказка, а не блокировка: кнопка
            ниже рабочая, повторное нажатие дождётся того же сохранения. */}
        {savingWorksheet && (
          <p className="text-xs text-warm-500 mt-3" data-testid="interactive-saving">
            Сохраняем лист на сервере — обычно пара секунд
          </p>
        )}

        {/* Заготовка демо-режима: предупреждаем, но не блокируем.
            Показываем ТОЛЬКО когда нет свежей ошибки: ошибка сборки про
            заготовку говорит то же самое своими словами, и два одинаковых
            оранжевых блока подряд — это шум, а не честность. */}
        {worksheetIsDemo && !error && (
          <div
            role="status"
            className="mt-4 rounded-xl border border-accent-300 bg-accent-50 p-4 text-sm text-warm-900"
            data-testid="interactive-demo-warning"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-accent-700" aria-hidden />
              <span>{INTERACTIVE_DEMO_WARNING}</span>
            </p>
          </div>
        )}

        {/* Ошибка сборки — словами учителю, а не «попробуйте ещё раз». */}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-accent-300 bg-accent-50 p-4 text-sm text-warm-900"
            data-testid="interactive-error"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-accent-700" aria-hidden />
              <span>{error}</span>
            </p>
          </div>
        )}

        <div className="mt-5">
          <FormatChooser
            format={format}
            onFormatChange={onFormatChange}
            disabled={building}
          />
        </div>

        {/* Стоимость — до кнопки. */}
        <div className="mt-4 rounded-xl border border-warm-200 bg-warm-50 p-4">
          <p className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-1.5">
            Сколько это стоит
          </p>
          <ul className="space-y-1 text-sm text-warm-700">
            {cost.lines.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-1 shrink-0 text-warm-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Действие. Есть ровно одно и оно всегда что-то делает. Обёртку с
            разделителем рисуем только когда кнопка есть: без кнопки оставался
            бы одинокий отрезок линии внизу карточки — то самое «зачем нам так
            много информации». */}
        {block.kind === "need-login" ? null : (
          <div className="mt-5 pt-4 border-t border-warm-100">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="h-12"
              onClick={onBuild}
              loading={building}
              leftIcon={!building ? <Sparkles className="w-4 h-4" /> : undefined}
              data-testid="interactive-build"
            >
              {building ? "Собираем…" : block.cta}
            </Button>
            {/* Пока идёт сборка, видно ИМЕННО ЧТО происходит: без листа это два
                шага (лист, потом игра), и молчаливое «Собираем…» минуту подряд
                выглядит как зависшая кнопка. Про подписку подсказка молчит —
                обещать QR, пока кнопка ведёт в оплату, нечестно. */}
            <p className="text-xs text-warm-500 text-center mt-2" data-testid="interactive-build-note">
              {building && stage
                ? stage
                : block.kind === "need-quota"
                  ? "Игра собирается из готового листа — сам лист сначала нужно сделать"
                  : "Ученики откроют игру по QR-коду с телефона"}
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}

/**
 * Выбор формата — все, что есть в реестре движка, без исключений.
 *
 * Радиокнопки, а не кнопки-переключатели: выбрать надо ОДИН формат, и на
 * телефоне список должен читаться одним взглядом. Каждая карточка говорит, что
 * делает ученик (`mechanic`) — учитель выбирает не по названию, а по уроку.
 */
function FormatChooser({
  format,
  onFormatChange,
  disabled,
  note,
}: {
  format: InteractiveFormat;
  onFormatChange: (format: InteractiveFormat) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className={disabled ? "opacity-60 pointer-events-none" : undefined}>
      <div className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-2">
        Формат игры · {CONSTRUCTOR_INTERACTIVE_FORMATS.length}
      </div>
      <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Формат игры">
        {CONSTRUCTOR_INTERACTIVE_FORMATS.map((f) => {
          const meta = constructorFormatCard(f);
          const selected = f === format;
          return (
            <label
              key={f}
              className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-brand-500 ${
                selected
                  ? "border-brand-500 bg-brand-50"
                  : "border-warm-200 bg-white hover:border-warm-300"
              }`}
              data-testid={`interactive-format-${f}`}
            >
              <input
                type="radio"
                name="interactive-format"
                value={f}
                checked={selected}
                onChange={() => onFormatChange(f)}
                className="mt-1 accent-brand-600"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-warm-950">
                  <span aria-hidden>{meta.emoji}</span>
                  <span className="break-words">{meta.title}</span>
                </span>
                <span className="block text-xs text-warm-600 mt-0.5">{meta.mechanic}</span>
              </span>
            </label>
          );
        })}
      </div>
      {note ? <p className="text-xs text-warm-500 mt-2">{note}</p> : null}
    </div>
  );
}