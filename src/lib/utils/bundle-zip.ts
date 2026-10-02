/**
 * TZ-16 §3.4: экспорт «Урока целиком» одним ZIP-архивом.
 *
 * В архив кладутся 4 файла: plan.docx + presentation.pptx + worksheet.docx +
 * test.docx. Все три формата уже есть в проекте — здесь мы их переиспользуем
 * (`lesson-plan-docx.ts`, `pptx.ts`, `docx.ts`), своего OOXML-писателя здесь
 * принципиально нет. JSZip — та же зависимость, что в `pptx.ts` и
 * `materials-zip.ts` (pptxgenjs в проект не тянем — он ломает статический экспорт).
 *
 * Ключевое отличие от `materials-zip.ts`: архив собирается ИЗ ЧАСТИЧНОГО
 * результата. Слоты, попавшие в `bundle.failed`, просто не кладутся в архив —
 * учитель получает то, что реально удалось, без заглушек вместо файлов.
 *
 * Имена файлов — ASCII + порядковый номер (`01-plan.docx`), по той же причине,
 * что и в материалах: русские имена внутри ZIP технически возможны, но
 * Windows-архиватор с ними капризничает.
 */
import JSZip from "jszip";
import type { LessonBundle } from "@/lib/types";
import { generateLessonPlanDocx } from "@/lib/utils/lesson-plan-docx";
import { generatePptx } from "@/lib/utils/pptx";
import { generateWorksheetDocx } from "@/lib/utils/docx";
import { slugify } from "@/lib/utils/cn";

/** Сколько файлов реально попадёт в архив (без учёта failed-слотов). */
export function bundleReadyCount(bundle: LessonBundle): number {
  return [bundle.lessonPlan, bundle.presentation, bundle.worksheet, bundle.test].filter(Boolean).length;
}

/**
 * Имя самого архива для скачивания: `lesson-math-5kl-drobi.zip`.
 */
export function bundleZipFilename(bundle: LessonBundle): string {
  const base = `lesson-${bundle.subject}-${bundle.grade}kl-${slugify(bundle.topic) || "topic"}`;
  return `${base}.zip`;
}

/**
 * Собирает ZIP из готовых слотов. Пропущенные слоты (null) просто не попадают
 * в архив; если не готов ни один — возвращается валидный ПУСТОЙ архив, без
 * исключения (кнопка скачивания в UI при этом disabled).
 */
export async function generateBundleZip(bundle: LessonBundle): Promise<Blob> {
  const zip = new JSZip();

  if (bundle.lessonPlan) {
    const blob = await generateLessonPlanDocx(bundle.lessonPlan);
    zip.file("01-plan.docx", await blob.arrayBuffer(), { binary: true });
  }

  if (bundle.presentation) {
    const blob = await generatePptx(bundle.presentation);
    zip.file("02-presentation.pptx", await blob.arrayBuffer(), { binary: true });
  }

  if (bundle.worksheet) {
    // У рабочего листа ответы НЕ печатаем: его раздают ученикам.
    const blob = await generateWorksheetDocx(bundle.worksheet, {
      withAnswers: false,
      withExplanations: false,
    });
    zip.file("03-worksheet.docx", await blob.arrayBuffer(), { binary: true });
  }

  if (bundle.test) {
    // Тест — для учителя, поэтому с ответами и пояснениями.
    const blob = await generateWorksheetDocx(bundle.test, {
      withAnswers: true,
      withExplanations: true,
    });
    zip.file("04-test.docx", await blob.arrayBuffer(), { binary: true });
  }

  return await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

// re-export для удобства UI (как в utils/pptx.ts и utils/materials-zip.ts)
export { downloadBlob } from "@/lib/utils/docx";
