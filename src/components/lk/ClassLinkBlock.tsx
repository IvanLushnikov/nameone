"use client";

/**
 * Ссылка на класс целиком (ТЗ-28, сценарий 1).
 *
 * ── ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ БЛОК, А НЕ ПЕРСОНАЛЬНЫЙ QR У КАЖДОГО УЧЕНИКА ──────
 * Персональных ссылок на класс 30, и в мессенджере они ломаются на три строки.
 * Учитель не рассылает их вручную — он копирует одну ссылку и кидает в чат, а
 * ученик приходит в класс, и сервер один раз спрашивает фамилию.
 *
 * ── ЧТО ЭТОТ БЛОК НЕ ДЕЛАЕТ ────────────────────────────────────────────────
 *   * не выдаёт код задним числом: у классов, созданных до миграции, кода нет,
 *     и кнопки не видно — выдать код на старом классе значит рискнуть занять
 *     чужой;
 *   * не требует, чтобы работа была создана: ссылка ведёт в класс, а не в
 *     конкретную работу, поэтому учитель может разослать её до задания;
 *   * не отправляет ученикам ничего сам: это ссылка и QR, дальше учитель сам.
 */

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

export function ClassLinkBlock({
  code,
  className,
}: {
  /** null — у класса кода ещё нет, блок не рисуется совсем. */
  code: string | null;
  className: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();

  if (!code) return null;

  const url = `${window.location.origin}/k?c=${code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ tone: "info", title: "Скопировать не вышло", description: "Ссылка показана текстом рядом" });
    }
  };

  return (
    <Card data-testid="class-link-block" className="print:hidden">
      <CardHeader>
        <CardTitle>Ссылка на класс {className}</CardTitle>
        <CardDescription>
          Одна ссылка на весь класс — киньте её в чат один раз. Ученик откроет с
          телефона, один раз напишет фамилию, дальше попадёт в свои задания сам.
          Персональный QR ниже нужен, когда важно, кто именно сдал.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl border border-warm-200 bg-white p-2">
          <QRCodeSVG value={url} size={96} marginSize={0} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm text-warm-800 break-all" data-testid="class-link-url">
            {url}
          </p>
          <p className="mt-1 text-xs text-warm-500">
            Код <span className="font-mono font-semibold">{code}</span>. В нём нет 0 и O, 1 и I —
            продиктовать с доски не перепутаете.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void copy()}
            data-testid="class-link-copy"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Скопировано" : "Скопировать ссылку"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default ClassLinkBlock;
