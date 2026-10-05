"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import { PrintWatermark } from "@/components/constructor/PrintWatermark";
import { InteractiveCta } from "@/components/worksheet/InteractiveCta";
import { LessonPlanPreview } from "@/components/constructor/LessonPlanPreview";
import { PresentationPreview } from "@/components/constructor/PresentationPreview";
import { KtpPreview } from "@/components/constructor/KtpPreview";
import {
  saveFavorite,
  removeFavorite,
  isFavorited,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import { saveTemplate } from "@/lib/lk/templates";
import { findArtifact } from "@/lib/lk/artifact";
import { generateWorksheetDocx, downloadBlob } from "@/lib/utils/docx";
import { generateLessonPlanDocx } from "@/lib/utils/lesson-plan-docx";
import { generateKtpDocx } from "@/lib/utils/ktp-docx";
import { generatePptx, pptxFilename } from "@/lib/utils/pptx";
import { trackEvent } from "@/lib/track";
import type { Difficulty, SubjectSlug } from "@/lib/types";
import {
  ArrowLeft,
  Heart,
  History,
  RotateCcw,
  Download,
  Sparkles,
  Plus,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/**
 * Страница превью материала (`/preview?id=<id>`).
 *
 * ТЗ-21, блок 2 — главная кнопка кабинета не работала: карточка истории
 * вела сюда, а артефакт искался ТОЛЬКО в избранном (`getFavorites()`).
 * История и избранное — два разных хранилища, поэтому лист, который учитель
 * не добавил в избранное, не открывался вообще.
 *
 * Теперь поиск идёт по четырём шагам (`findArtifact` в `src/lib/lk/artifact.ts`):
 *   сервер → история устройства → избранное устройства → «Лист не найден».
 * Проверка сессии — ДО запроса, поэтому анонимный учитель не видит ни 401,
 * ни мигания загрузки. Клик по листу старше пятого в истории тоже открывает
 * его: у таких записей в localStorage есть только метаданные, но на сервере
 * лежит полный артефакт.
 *
 * `?id` читается из `window.location.search` в useEffect, а не через
 * `useSearchParams()`: хук при `output: "export"` требовал границы <Suspense>,
 * а её fallback («Загрузка…») закрывал собой страницу до гидратации.
 */
export default function PreviewPage() {
  const { toast } = useToast();
  // null = id ещё не прочитан из URL (эффект не отработал).
  const [id, setId] = React.useState<string | null>(null);
  const [artifact, setArtifact] = React.useState<FavoriteArtifact | null>(null);
  const [isFav, setIsFav] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  /** true = ищем артефакт (сервер/устройство). Скелетон, не «не найден». */
  const [searching, setSearching] = React.useState(false);
  /** Счётчик повторов: кнопка «Попробовать ещё раз» на экране «не найден». */
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id") ?? "");
  }, []);

  React.useEffect(() => {
    // Ещё не прочитали URL — не трактуем это как «лист не найден».
    if (id === null) return;
    if (!id) {
      setNotFound(true);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    void findArtifact(id).then((found) => {
      if (cancelled) return;
      setSearching(false);
      if (found) {
        setArtifact(found.artifact);
        setIsFav(isFavorited(id));
        setNotFound(false);
        // Откуда открыли — нужно, чтобы доказать, что кабинет востребован.
        trackEvent("dashboard_artifact_opened", {
          origin: found.origin,
          from: "preview",
        });
        return;
      }
      setArtifact(null);
      setNotFound(true);
    });

    return () => {
      cancelled = true;
    };
  }, [id, retry]);

  const handleToggleFav = () => {
    if (!artifact) return;
    if (isFav) {
      removeFavorite(artifact.id);
      setIsFav(false);
      toast({ tone: "info", title: "Удалено из избранного" });
    } else {
      saveFavorite(artifact);
      setIsFav(true);
      toast({ tone: "success", title: "Добавлено в избранное" });
    }
  };

  const handleSaveTemplate = async () => {
    if (!artifact) return;
    const res = await saveTemplate(artifact);
    trackEvent("dashboard_template_saved", { from: "preview" });
    if (res.synced) {
      toast({ tone: "success", title: "Сохранено как шаблон", description: "Доступен на всех устройствах" });
      return;
    }
    toast({
      tone: res.serverFailed ? "info" : "success",
      title: "Сохранено как шаблон",
      description: res.serverFailed
        ? "Сохранено на этом устройстве — на сервер не попало"
        : undefined,
    });
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
    trackEvent("dashboard_artifact_downloaded", { from: "preview", format: "pdf" });
  };

  const handleDownload = async () => {
    if (!artifact) return;
    if ("tasks" in artifact) {
      const blob = await generateWorksheetDocx(artifact, {
        withAnswers: true,
        withExplanations: true,
      });
      const filename = `${artifact.subject}-${artifact.grade}kl-${artifact.topic}.docx`
        .toLowerCase()
        .replace(/\s+/g, "-");
      downloadBlob(blob, filename);
      toast({ tone: "success", title: "DOCX скачан" });
      return;
    }
    if ("stages" in artifact) {
      const blob = await generateLessonPlanDocx(artifact);
      downloadBlob(
        blob,
        `plan-${artifact.subject}-${artifact.grade}kl-${artifact.topic}.docx`
          .toLowerCase()
          .replace(/\s+/g, "-")
      );
      toast({ tone: "success", title: "DOCX плана урока скачан" });
      return;
    }
    if ("weeks" in artifact) {
      const blob = await generateKtpDocx(artifact);
      downloadBlob(blob, `ktp-${artifact.subject}-${artifact.grade}kl.docx`);
      toast({ tone: "success", title: "DOCX КТП скачан" });
      return;
    }
    if ("slides" in artifact) {
      const blob = await generatePptx(artifact);
      const filename = pptxFilename(artifact);
      downloadBlob(blob, filename);
      toast({ tone: "success", title: "PPTX скачан" });
      return;
    }
  };

  if (notFound) {
    return (
      <div className="container-tight py-20 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold text-warm-950">Лист не найден</h1>
        <p className="text-warm-600 mt-2">
          Не нашли его ни в истории, ни в избранном — ни на этом устройстве, ни
          в аккаунте. Если вы открываете ссылку с другого устройства, проверьте
          интернет; если лист был удалён из истории, восстановить его уже нельзя.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 justify-center">
          <Button as="link" href="/dashboard" variant="secondary" leftIcon={<ArrowLeft className="w-4 h-4" />}>
            В кабинет
          </Button>
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            Попробовать ещё раз
          </Button>
          <Button as="link" href="/constructor" variant="primary" leftIcon={<Sparkles className="w-4 h-4" />}>
            Создать лист
          </Button>
        </div>
      </div>
    );
  }

  if (!artifact || searching) {
    // Скелетон на время поиска артефакта (сервер или устройство) — тот же
    // текст, что был в Suspense fallback, но он больше не блокирует
    // гидратацию самой страницы.
    return (
      <div className="container-tight py-20 text-center text-warm-500">
        Загрузка…
      </div>
    );
  }

  // Шапка + действия (одинаковые для всех типов, кроме «Как шаблон» — он работает).
  const subtitle = artifactSubtitle(artifact);

  return (
    <>
      <div className="container-tight py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 no-print">
          <div>
            <Badge tone="brand" className="mb-2">
              {isFav ? <Heart className="w-3 h-3" /> : <History className="w-3 h-3" />}
              {isFav ? "Из избранного" : "Из истории"}
            </Badge>
            <h1 className="text-xl font-semibold text-warm-950">{artifact.title}</h1>
            <p className="text-sm text-warm-500 mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={handleSaveTemplate}
            >
              Как шаблон
            </Button>
            <Button
              variant="secondary"
              size="md"
              leftIcon={
                <Heart
                  className={`w-4 h-4 ${
                    isFav ? "fill-accent-500 text-accent-500" : ""
                  }`}
                />
              }
              onClick={handleToggleFav}
            >
              {isFav ? "В избранном" : "В избранное"}
            </Button>
            <Button
              variant="primary"
              size="md"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={handlePrint}
            >
              PDF
            </Button>
            <Button variant="secondary" size="md" onClick={handleDownload}>
              {"slides" in artifact ? "PPTX" : "DOCX"}
            </Button>
          </div>
        </div>

        {/* F-06 B-4: discriminated union по типу артефакта. */}
        <ArtifactBody artifact={artifact} />

        {/* TZ-13 §4.9 / сценарий A: точка входа в интерактивы — с экрана
            готового листа. Учитель уже работает с листом по теме, значит
            интерактив по той же теме нужен ему именно здесь.

            Показываем только для листа с заданиями: ранклер берёт контент из
            `payload_json` листа, а у плана урока/презентации/КТП заданий нет,
            и блок был бы враньём («сделаем из этого интерактив»).

            `no-print` — печатать лист учитель хочет без блока, это не часть
            раздаточного материала. */}
        {"tasks" in artifact && artifact.tasks.length > 0 && (
          <div className="container-tight pb-12 no-print">
            <InteractiveCta
              worksheetId={artifact.id}
              worksheetTitle={artifact.title}
              subject={artifact.subject}
              grade={artifact.grade}
            />
          </div>
        )}

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

/**
 * F-06 B-4: тело превью + водяной знак заготовки.
 */
function ArtifactBody({ artifact }: { artifact: FavoriteArtifact }) {
  // Заготовка помечается водяным знаком на печати и здесь: сюда учитель
  // приходит из «Избранного», где экранной плашки конструктора уже нет,
  // а флаг `isDemo` едет вместе с артефактом (см. `Worksheet.isDemo`).
  return (
    <>
      {artifact.isDemo && <PrintWatermark />}
      <ArtifactBodyInner artifact={artifact} />
    </>
  );
}

/**
 * Рендер тела превью по типу артефакта.
 * Discriminator: уникальное поле каждого типа (`tasks`, `stages`, `slides`, `weeks`).
 */
function ArtifactBodyInner({ artifact }: { artifact: FavoriteArtifact }) {
  if ("tasks" in artifact) {
    if (artifact.tasks.length === 0) {
      return <EmptyWorksheetState title={artifact.title} />;
    }
    return <WorksheetPreview worksheet={artifact} withAnswers withExplanations />;
  }
  if ("stages" in artifact) {
    return <LessonPlanPreview plan={artifact} />;
  }
  if ("slides" in artifact) {
    return <PresentationPreview presentation={artifact} />;
  }
  if ("weeks" in artifact) {
    return <KtpPreview ktp={artifact} />;
  }
  // Exhaustiveness check — TS narrows до never здесь.
  const _exhaustive: never = artifact;
  return _exhaustive;
}

/** Подзаголовок в шапке превью (тип-специфичный). */
function artifactSubtitle(a: FavoriteArtifact): string {
  if ("tasks" in a) {
    return `${a.subject} · ${a.grade} класс · ${a.tasks.length} заданий`;
  }
  if ("stages" in a) {
    const total = a.stages.reduce((s, st) => s + st.durationMin, 0);
    return `${a.subject} · ${a.grade} класс · ${total} мин`;
  }
  if ("slides" in a) {
    return `${a.subject} · ${a.grade} класс · ${a.slides.length} слайдов`;
  }
  if ("weeks" in a) {
    return `${a.subject} · ${a.grade} класс · ${a.weeks.length} недель`;
  }
  return "";
}

/** Empty state для пустого Worksheet (B-2 — кейс «нет заданий»). */
function EmptyWorksheetState({ title }: { title: string }) {
  return (
    <div className="bg-warm-100 rounded-2xl p-6 sm:p-10 text-center">
      <h2 className="text-lg font-semibold text-warm-950">Нет заданий</h2>
      <p className="text-sm text-warm-500 mt-2 max-w-md mx-auto">
        У листа «{title}» пока нет задач. Скорее всего, генерация не
        завершилась корректно. Попробуйте создать новый лист в конструкторе.
      </p>
      <div className="mt-6">
        <Button as="link" href="/constructor" variant="primary" leftIcon={<Sparkles className="w-4 h-4" />}>
          Открыть конструктор
        </Button>
      </div>
    </div>
  );
}
