"use client";

/**
 * Загрузчик фото работы (TZ-11 §3, шаги 1-2).
 *
 * Закрывает три вещи, которые требует сценарий:
 *   1. текст согласия на обработку персональных данных ДО загрузки (В-2.2);
 *   2. выбор одной-трёх страниц / drag-n-drop / камера на телефоне;
 *   3. превью каждой страницы по порядку + удаление лишней.
 *
 * ПОЧЕМУ СТРАНИЦ НЕСКОЛЬКО И ПОРЯДОК ВИДЕН: работа ученика часто не влезает
 * на один снимок, а порядок файлов = порядок страниц в тетради. Поэтому список
 * с нумерацией и возможностью убрать лишнее — не украшение, а способ не
 * отправить на проверку не тот ракурс. Четвёртую страницу молча не отбрасываем:
 * учитель должен знать, что она не поедет (сервер тоже её не примет).
 *
 * a11y (ТЗ §11): загрузчик — настоящий `<label>` с `aria-describedby`,
 * прогресс — `role="status"`. Согласие — чекбокс с текстом рядом, а не
 * «галочка без слов».
 */

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { compressImage, formatBytes } from "@/lib/utils/image";
import { CONSENT_VERSION } from "@/lib/photo-check/types";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Больше трёх страниц сервер не разберёт — и молчать об этом нельзя.
 * Экспортируется, потому что лимит показывается учителю словами.
 */
export const MAX_PAGES = 3;

export interface PhotoUploadProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  consentAccepted: boolean;
  onConsentChange: (accepted: boolean) => void;
  disabled?: boolean;
}

export function PhotoUpload({
  files,
  onFilesChange,
  consentAccepted,
  onConsentChange,
  disabled = false,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Object URL'ы — в Map по самому файлу. Именно по файлу, а не «последний
   * показанный»: иначе после удаления первой страницы превью остальных
   * продолжили бы смотреться в ту картинку, которую сняли последней.
   * Удалённый файл освобождается сразу, а не когда дойдёт очередь до сборщика
   * мусора — на телефоне с тремя снимками 12 МБ это заметно.
   */
  const urlsRef = useRef<Map<File, string>>(new Map());
  /** Реф сам перерисовку не вызывает — после правки карты нужен тик. */
  const [, bumpPreviews] = useReducer((n: number) => n + 1, 0);
  /** Отказ по конкретному файлу — то, что учителю надо исправить. */
  const [error, setError] = useState<string | null>(null);
  /** Файл не взяли из-за лимита страниц — предупреждение, а не отказ. */
  const [warning, setWarning] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  useEffect(() => {
    const urls = urlsRef.current;
    let changed = false;

    for (const [file, url] of urls) {
      if (!files.includes(file)) {
        URL.revokeObjectURL(url);
        urls.delete(file);
        changed = true;
      }
    }
    for (const file of files) {
      if (!urls.has(file)) {
        urls.set(file, URL.createObjectURL(file));
        changed = true;
      }
    }
    if (changed) bumpPreviews();
  }, [files, bumpPreviews]);

  // На размонтировании освобождаем всё, что ещё осталось в карте.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /** Нормализация одного файла: тип, вес, сжатие. null — файл не подошёл. */
  async function normalize(candidate: File): Promise<File | null> {
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(candidate.type)) {
      setError(
        `«${candidate.name}» — формат не поддерживается. Загрузите JPEG, PNG или WebP.`,
      );
      return null;
    }
    if (candidate.size > MAX_BYTES) {
      setError(
        `«${candidate.name}» больше 8 МБ (${formatBytes(candidate.size)}). Снимите в меньшем разрешении.`,
      );
      return null;
    }

    // Сжимаем ДО отправки — прямо влияет на стоимость распознавания.
    try {
      const compressed = await compressImage(candidate);
      return new File([compressed], candidate.name, { type: compressed.type });
    } catch {
      setError(`Не удалось прочитать «${candidate.name}». Попробуйте переснять.`);
      return null;
    }
  }

  /**
   * Приём файлов: до трёх страниц всего, порядок выбора = порядок страниц.
   *
   * Каждый файл нормализуется отдельно, поэтому один плохой не сбрасывает
   * остальные — учитель теряет только его.
   */
  async function acceptFiles(candidates: FileList | File[] | null | undefined) {
    if (!candidates) return;
    setError(null);
    setWarning(null);

    const picked = Array.from(candidates as ArrayLike<File>);
    const room = MAX_PAGES - files.length;

    if (picked.length > room) {
      setWarning(
        `Больше ${MAX_PAGES} страниц за одну проверку не разобрать — ${MAX_PAGES + 1}-я и следующие не поедут. Уберите лишнюю страницу и добавьте этот файл.`,
      );
    }

    const normalized: File[] = [];
    for (const candidate of picked.slice(0, room)) {
      const file = await normalize(candidate);
      if (file) normalized.push(file);
    }

    if (normalized.length > 0) onFilesChange([...files, ...normalized]);
    // Сбрасываем значение, иначе повторный выбор того же файла не вызовет
    // change — а учитель именно это и делает, когда переснял страницу.
    if (inputRef.current) inputRef.current.value = "";
  }

  /** Убрать одну страницу — остальные досылаются в прежнем порядке. */
  function removeAt(index: number) {
    setError(null);
    setWarning(null);
    onFilesChange(files.filter((_, i) => i !== index));
  }

  /** URL превью; на первом рендере эффект ещё не отработал — это пустая картинка. */
  function previewFor(file: File): string {
    return urlsRef.current.get(file) ?? "";
  }

  return (
    <div className="space-y-4">
      {/* ── Шаг 1. Предупреждение о персональных данных на фото (В-2.2) ────
          Задача блока — не юридическая защита, а предупреждение учителю:
          на снимке почти всегда видны фамилия и класс ученика, то есть
          персональные данные ребёнка. Формулировки намеренно простые,
          без ссылок на номера статей: учителю 45+ это не читается, и он
          не прочтёт. Право на обработку — зона ответственности учителя,
          мы фиксируем, что он об этом знает. Полный текст согласия
          лежит по /legal/consent и слинкован отсюда. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
        <p className="text-sm font-medium text-amber-950 mb-1.5">
          На фото могут быть личные данные ученика
        </p>
        <p className="text-xs text-amber-900 leading-relaxed">
          На снимке обычно видны фамилия и имя ученика, его класс и почерк —
          это личные данные ребёнка. Загружая фото, вы подтверждаете, что
          имеете право на его обработку и не прислали чужие работы.
        </p>
        <ul className="text-xs text-amber-900 leading-relaxed mt-1.5 space-y-0.5">
          <li>• Если можно, закройте фамилию и имя перед съёмкой.</li>
          <li>• Фото удаляется автоматически через 7 дней.</li>
          <li>• Можно удалить его одной кнопкой сразу после проверки.</li>
          <li>• Мы не публикуем фото и не показываем его другим учителям.</li>
        </ul>

        <label className="flex items-start gap-2.5 mt-3 cursor-pointer text-xs text-amber-950">
          <input
            type="checkbox"
            checked={consentAccepted}
            disabled={disabled}
            onChange={(e) => onConsentChange(e.target.checked)}
            aria-describedby={hintId}
            className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
          />
          <span>
            Понимаю, что загружаю фото с личными данными ученика, и мне есть
            право на его обработку.
          </span>
        </label>
        <p id={hintId} className="text-xs text-amber-900/80 leading-relaxed mt-2">
          Подробности — в{" "}
          <a
            href="/legal/consent"
            className="underline hover:text-amber-950"
            target="_blank"
            rel="noopener noreferrer"
          >
            согласии на обработку персональных данных
          </a>
          . Текст согласия версии {CONSENT_VERSION}. Без согласия загрузка фото
          невозможна.
        </p>
      </div>

      {/* ── Шаг 2. Выбор страниц ─────────────────────────────────────────── */}
      {files.length === 0 ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void acceptFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
            disabled
              ? "border-warm-200 bg-warm-50 opacity-60 cursor-not-allowed"
              : dragging
                ? "border-brand-500 bg-brand-50"
                : "border-warm-200 bg-warm-50/50 hover:border-brand-400 hover:bg-brand-50/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            disabled={disabled}
            onChange={(e) => void acceptFiles(e.target.files)}
            className="sr-only"
            aria-describedby={hintId}
          />
          <span className="text-base font-medium text-warm-900">
            Сфотографируйте страницы тетради с ответами
          </span>
          <span className="text-sm text-warm-600">
            От одной до трёх страниц, по порядку. Одна страница — одно фото.
            JPEG, PNG или WebP, до 8 МБ.
          </span>
          <span className="text-xs text-warm-500">
            Нажмите, чтобы выбрать файлы, или перетащите их сюда
          </span>
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Порядок сверху вниз = порядок страниц работы. Учитель обязан его
              видеть: иначе непонятно, от какой страницы первая отметка. */}
          <p role="status" className="text-xs text-warm-600">
            Страниц выбрано: {files.length} из {MAX_PAGES}. Порядок сверху вниз —
            порядок страниц работы.
          </p>

          <ul className="flex flex-col gap-3">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                data-testid="photo-page"
                className="overflow-hidden rounded-2xl border border-warm-200 bg-warm-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewFor(file)}
                  alt={`Превью страницы ${i + 1}`}
                  className="max-h-72 w-full bg-white object-contain"
                />
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-warm-900">
                      Страница {i + 1}
                    </p>
                    <p className="text-xs text-warm-600 truncate">
                      {file.name} · {formatBytes(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => removeAt(i)}
                    disabled={disabled}
                    aria-label={`Удалить страницу ${i + 1}`}
                  >
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {/* Кнопка добавления остаётся и на пределе. Иначе учитель, который
              выбрал четыре файла разом, не увидел бы объяснения: молча выкинуть
              четвёртый нельзя, а спросить некогда — файлы уже выбраны. */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void acceptFiles(e.dataTransfer.files);
            }}
            className={`flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-4 text-center cursor-pointer transition-colors ${
              disabled
                ? "border-warm-200 bg-warm-50 opacity-60 cursor-not-allowed"
                : dragging
                  ? "border-brand-500 bg-brand-50"
                  : "border-warm-200 bg-warm-50/50 hover:border-brand-400 hover:bg-brand-50/40"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              disabled={disabled}
              onChange={(e) => void acceptFiles(e.target.files)}
              className="sr-only"
              aria-describedby={hintId}
            />
            <span className="text-sm font-medium text-warm-900">
              Добавить страницу
            </span>
            <span className="text-xs text-warm-500">
              {files.length < MAX_PAGES
                ? `ещё можно ${MAX_PAGES - files.length} ${
                    MAX_PAGES - files.length === 1 ? "страницу" : "страницы"
                  }`
                : `${MAX_PAGES} страницы — максимум, уберите одну, чтобы заменить`}
            </span>
          </label>
        </div>
      )}

      {warning && (
        <p
          role="status"
          className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
        >
          {warning}
        </p>
      )}

      {error && (
        <p role="status" className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
