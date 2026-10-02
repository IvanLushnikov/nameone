"use client";

/**
 * Загрузчик фото работы (TZ-11 §3, шаги 1-2).
 *
 * Закрывает три вещи, которые требует сценарий:
 *   1. текст согласия на обработку персональных данных ДО загрузки (В-2.2);
 *   2. выбор файла / drag-n-drop / камера на телефоне;
 *   3. превью + «Удалить».
 *
 * a11y (ТЗ §11): загрузчик — настоящий `<label>` с `aria-describedby`,
 * прогресс — `role="status"`. Согласие — чекбокс с текстом рядом, а не
 * «галочка без слов».
 */

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { compressImage, formatBytes } from "@/lib/utils/image";
import { CONSENT_VERSION } from "@/lib/photo-check/types";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;

export interface PhotoUploadProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  consentAccepted: boolean;
  onConsentChange: (accepted: boolean) => void;
  disabled?: boolean;
}

export function PhotoUpload({
  file,
  onFileChange,
  consentAccepted,
  onConsentChange,
  disabled = false,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  async function acceptFile(candidate: File | null | undefined) {
    if (!candidate) return;
    setError(null);

    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(candidate.type)) {
      setError("Формат не поддерживается. Загрузите JPEG, PNG или WebP.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError(
        `Фото больше 8 МБ (${formatBytes(candidate.size)}). Снимите в меньшем разрешении.`,
      );
      return;
    }

    // Сжимаем ДО отправки — прямо влияет на стоимость распознавания.
    try {
      const compressed = await compressImage(candidate);
      const normalized = new File([compressed], candidate.name, { type: compressed.type });
      setPreviewUrl(URL.createObjectURL(normalized));
      onFileChange(normalized);
    } catch {
      setError("Не удалось прочитать фото. Попробуйте переснять.");
    }
  }

  function clear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onFileChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {/* ── Шаг 1. Согласие на обработку ПДн (В-2.2) ───────────────────────
          Формулировка — техническая: что именно мы делаем с фото. Юридическую
          сторону (основание обработки, В-2.1) закрывает юрист, не текст здесь. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
        <p className="text-sm font-medium text-amber-950 mb-1.5">
          Что происходит с фото тетради
        </p>
        <p className="text-xs text-amber-900 leading-relaxed">
          На фотографии может быть видно фамилию и имя ученика и его рукописный
          текст — это персональные данные ребёнка. Отправляя фото, вы
          подтверждаете, что имеете право на его обработку.
        </p>
        <ul className="text-xs text-amber-900 leading-relaxed mt-1.5 space-y-0.5">
          <li>• Фото удаляется автоматически через 7 дней.</li>
          <li>• Вы можете удалить его одной кнопкой сразу после проверки.</li>
          <li>• Результаты проверки (баллы и отметка) остаются в вашем аккаунте.</li>
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
            Понимаю, что загружаю фото с персональными данными ученика, и
            подтверждаю согласие на их обработку для распознавания ответов.
          </span>
        </label>
        <p id={hintId} className="sr-only">
          Текст согласия версии {CONSENT_VERSION}. Без согласия загрузка фото
          невозможна.
        </p>
      </div>

      {/* ── Шаг 2. Выбор файла ──────────────────────────────────────────── */}
      {!file ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void acceptFile(e.dataTransfer.files?.[0]);
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
            accept={ACCEPT}
            disabled={disabled}
            onChange={(e) => void acceptFile(e.target.files?.[0])}
            className="sr-only"
            aria-describedby={hintId}
          />
          <span className="text-base font-medium text-warm-900">
            Сфотографируйте страницу тетради с ответами
          </span>
          <span className="text-sm text-warm-600">
            Одна страница — одно фото. JPEG, PNG или WebP, до 8 МБ.
          </span>
          <span className="text-xs text-warm-500">
            Нажмите, чтобы выбрать файл, или перетащите его сюда
          </span>
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-2xl border border-warm-200 bg-warm-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl ?? ""}
              alt="Загруженное фото работы"
              className="max-h-72 w-full bg-white object-contain"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-warm-600 truncate" role="status">
              {file.name} · {formatBytes(file.size)}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={clear}
              disabled={disabled}
            >
              Удалить фото
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="status" className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
