"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import {
  getFavorites,
  saveFavorite,
  removeFavorite,
  addTemplate,
  isFavorited,
} from "@/lib/utils/storage";
import { generateWorksheetDocx, downloadBlob } from "@/lib/utils/docx";
import type { Worksheet, SubjectSlug } from "@/lib/types";
import { ArrowLeft, Heart, RotateCcw, Download, Sparkles, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

function PreviewPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { toast } = useToast();
  const [worksheet, setWorksheet] = React.useState<Worksheet | null>(null);
  const [isFav, setIsFav] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);

  React.useEffect(() => {
    if (!id) {
      setNotFound(true);
      return;
    }
    const all = getFavorites();
    const found = all.find((w) => w.id === id);
    if (found) {
      setWorksheet(found);
      setIsFav(isFavorited(id));
      return;
    }
    setNotFound(true);
  }, [id]);

  const handleToggleFav = () => {
    if (!worksheet) return;
    if (isFav) {
      removeFavorite(worksheet.id);
      setIsFav(false);
      toast({ tone: "info", title: "Удалено из избранного" });
    } else {
      saveFavorite(worksheet);
      setIsFav(true);
      toast({ tone: "success", title: "Добавлено в избранное" });
    }
  };

  const handleSaveTemplate = () => {
    if (!worksheet) return;
    addTemplate({
      id: Math.random().toString(36).slice(2),
      name: worksheet.title,
      subject: worksheet.subject as SubjectSlug,
      grade: worksheet.grade,
      topic: worksheet.topic,
      difficulty: worksheet.difficulty,
      count: worksheet.tasks.length,
    });
    toast({ tone: "success", title: "Сохранено как шаблон" });
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  const handleDocx = async () => {
    if (!worksheet) return;
    const blob = await generateWorksheetDocx(worksheet, { withAnswers: true, withExplanations: true });
    const filename = `${worksheet.subject}-${worksheet.grade}kl-${worksheet.topic}.docx`
      .toLowerCase()
      .replace(/\s+/g, "-");
    downloadBlob(blob, filename);
    toast({ tone: "success", title: "DOCX скачан" });
  };

  if (notFound) {
    return (
      <div className="container-tight py-20 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold text-warm-950">Лист не найден</h1>
        <p className="text-warm-600 mt-2">
          Сохранённые листы доступны в личном кабинете. Откройте генератор, чтобы создать новый.
        </p>
        <div className="mt-6 flex gap-2 justify-center">
          <Button as="link" href="/dashboard" variant="secondary" leftIcon={<ArrowLeft className="w-4 h-4" />}>
            В кабинет
          </Button>
          <Button as="link" href="/constructor" variant="primary" leftIcon={<Sparkles className="w-4 h-4" />}>
            Создать лист
          </Button>
        </div>
      </div>
    );
  }

  if (!worksheet) {
    return (
      <div className="container-tight py-20 text-center text-warm-500">
        Загрузка…
      </div>
    );
  }

  return (
    <>
      <div className="container-tight py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 no-print">
          <div>
            <Badge tone="brand" className="mb-2">
              <Heart className="w-3 h-3" />
              Из избранного
            </Badge>
            <h1 className="text-xl font-semibold text-warm-950">{worksheet.title}</h1>
            <p className="text-sm text-warm-500 mt-0.5">
              {worksheet.subject} · {worksheet.grade} класс · {worksheet.tasks.length} заданий
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="md" leftIcon={<Plus className="w-4 h-4" />} onClick={handleSaveTemplate}>
              Как шаблон
            </Button>
            <Button variant="secondary" size="md" leftIcon={<Heart className={`w-4 h-4 ${isFav ? "fill-accent-500 text-accent-500" : ""}`} />} onClick={handleToggleFav}>
              {isFav ? "В избранном" : "В избранное"}
            </Button>
            <Button variant="primary" size="md" leftIcon={<Download className="w-4 h-4" />} onClick={handlePrint}>
              PDF
            </Button>
            <Button variant="secondary" size="md" onClick={handleDocx}>
              DOCX
            </Button>
          </div>
        </div>

        <WorksheetPreview worksheet={worksheet} withAnswers withExplanations />

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 no-print">
          <Button as="link" href="/constructor" variant="secondary" leftIcon={<RotateCcw className="w-4 h-4" />}>
            Создать новый
          </Button>
          <Button as="link" href="/dashboard" variant="ghost">
            В кабинет
          </Button>
        </div>
      </div>
    </>
  );
}
export default function PreviewPageWrapper() {
  return (
    <Suspense fallback={<div className="container-tight py-20 text-center text-warm-500">Загрузка…</div>}>
      <PreviewPage />
    </Suspense>
  );
}
