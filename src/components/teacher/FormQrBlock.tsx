"use client";

/**
 * Блок с QR-кодом и публичной ссылкой (TZ-12, этап 4).
 *
 * Задача учителя после нажатия «Создать ссылку»: получить то, что он реально
 * унесёт в класс. Отсюда три действия:
 *   - «Скопировать ссылку» — вставить в классный чат (сценарий А, вариант Б);
 *   - «Скачать PDF с QR» — `window.print()` + уже существующий `@media print` в
 *     `src/app/globals.css:140-171` (A4, поля 12 мм, `.no-print`). Отдельный
 *     серверный рендер PDF не нужен и стоил бы денег;
 *   - «Показать на весь экран» — повесить QR на доску / показать с телефона
 *     (сценарий А, вариант А).
 *
 * QR генерируется на клиенте библиотекой `qrcode.react@4.2.0`, которая уже стоит
 * в `package.json` и до этого момента не использовалась. Новых зависимостей не
 * добавляем. `level="M"` — 15% восстановления, хватает для печати на листе и
 * для проектора; `H` нужен только поверх фотографии.
 *
 * Печатный кусок НЕ помечен `no-print` — наоборот, `.no-print` стоит на всех
 * управляющих кнопках, чтобы в PDF попал только QR с шапкой.
 */

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/Button";
import { Copy, Printer, Maximize2, X, Check } from "lucide-react";

export interface FormQrBlockProps {
  url: string;
  title: string;
  subject: string;
  grade: number;
  /** Код класса, если учитель его задал — печатаем крупно, ученик вводит его же. */
  classCode?: string | null;
}

export function FormQrBlock(props: FormQrBlockProps) {
  const [fullscreen, setFullscreen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(props.url);
      } else {
        // Фолбэк для http и старых мобильных браузеров.
        const ta = document.createElement("textarea");
        ta.value = props.url;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер обмена недоступен — ссылка видна текстом рядом, её можно выделить руками */
    }
  };

  // В полноэкранном режиме инлайновый блок не рендерим: иначе в печать уедут
  // две копии QR. Печатаем из оверлея — он содержит тот же самый блок.
  if (fullscreen) {
    return <FullscreenQr {...props} onClose={() => setFullscreen(false)} />;
  }

  return (
    <div className="space-y-4" data-testid="form-qr-block">
      <PrintableSheet {...props} size={240} />

      <div className="no-print flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void copyLink()}
          leftIcon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          data-testid="form-copy-link"
        >
          {copied ? "Скопировано" : "Скопировать ссылку"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.print()}
          leftIcon={<Printer className="w-4 h-4" />}
          data-testid="form-print"
        >
          Скачать PDF с QR
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFullscreen(true)}
          leftIcon={<Maximize2 className="w-4 h-4" />}
          data-testid="form-fullscreen"
        >
          Показать на весь экран
        </Button>
      </div>
    </div>
  );
}

/**
 * То, что уходит на печать: шапка листа, код класса крупно, сам QR и одна
 * инструкция. Без кнопок — `.no-print` на обёртке управления.
 */
function PrintableSheet({
  url,
  title,
  subject,
  grade,
  classCode,
  size,
}: FormQrBlockProps & { size: number }) {
  return (
    <div
      className="bg-white border border-warm-100 rounded-2xl p-5 sm:p-6 text-center"
      data-form-qr=""
      data-testid="form-qr"
    >
      <h3 className="font-display font-semibold text-warm-950 break-words">
        {title}
      </h3>
      <p className="text-sm text-warm-600 mt-1">
        {subject}
        {grade ? ` · ${grade} класс` : ""}
      </p>

      <div className="mt-4 flex justify-center">
        <QRCodeSVG value={url} size={size} level="M" includeMargin />
      </div>

      <p className="mt-3 text-sm text-warm-700">
        Откройте камеру телефона и наведите на код
      </p>

      {classCode ? (
        <p className="mt-2 text-warm-950">
          <span className="text-sm text-warm-600">Код урока: </span>
          <span className="text-3xl font-bold tracking-wider">{classCode}</span>
        </p>
      ) : null}

      <p className="mt-3 text-xs text-warm-400 break-all">{url}</p>
    </div>
  );
}

function FullscreenQr({ onClose, ...props }: FormQrBlockProps & { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-auto">
      <div className="min-h-full flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <PrintableSheet {...props} size={320} />
        </div>
        <div className="no-print mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()} leftIcon={<Printer className="w-4 h-4" />}>
            Скачать PDF с QR
          </Button>
          <Button variant="primary" size="sm" onClick={onClose} leftIcon={<X className="w-4 h-4" />}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  );
}
