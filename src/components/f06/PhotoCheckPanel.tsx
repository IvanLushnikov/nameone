"use client";

/**
 * Панель «Проверка работ по фото» (TZ-11, F-06) + честная неуверенность
 * распознавания (TZ-18, блок В).
 *
 * Контракт props НЕ МЕНЯЛИ — он согласован точкой вызова в конструкторе
 * (`src/app/constructor/page.tsx`): `assignmentId` / `demoTasks` / `onResult`.
 *
 * Пять состояний сценария §3:
 *   idle   — инструкция, согласие, выбор фото (шаги 1-2)
 *   file   — страницы выбраны, эталон подставлен, ждём кнопки «Проверить» (шаг 3)
 *   pending— запрос ушёл, «Распознаём ответы…» (шаг 4)
 *   result — сначала блок «Проверьте сами», потом таблица (шаг 5)
 *   error  — понятная ошибка; вид ошибки решает, что учителю делать дальше
 *
 * ЧТО ЗДЕСЬ РЕШЕНО ПО ТЗ-18 (блок В):
 *  - В1–В3. Задания, прочитанные неуверенно или не прочитанные вовсе,
 *    собираются в блок «Проверьте сами» В НАЧАЛЕ экрана, с пустыми полями
 *    для отметки учителя. В общей таблице их нет: там у них были бы обычные
 *    галочки и баллы, и учитель принимал бы чужую оценку за свою.
 *  - В4. В блоке видно, что именно модель прочитала и с какой уверенностью.
 *  - В5. Отметка при неполном разборе не показывается вообще (см. `viewResult`).
 *    Ошибка сети и ошибка распознавания дают разные тексты и разные кнопки.
 *
 * Чего панель НЕ делает намеренно: не сохраняет ручные отметки. Эндпоинта
 * для них на бэке нет, поэтому отметки живут только на этом экране — и в
 * интерфейсе написано именно так, а не «сохранится в кабинете».
 *
 * ── Досылка страниц (лист 7.1.4) ───────────────────────────────────────────────
 * Ученик отправил первую страницу, вспомнил вторую — и до этого мог только
 * начать проверку заново. Теперь на СТРАНИЦЕ ПРОВЕРКИ (а не в кабинете: досылает
 * он со своего телефона, сразу после работы) есть кнопка, которая зовёт
 * `POST /photo-checks/:id/pages`: страница уходит последней, разбор
 * пересчитывается по всей работе целиком, а ручные отметки учителя сливаются
 * с новым вердиктом машины и остаются на месте.
 *
 * Почему HTTP здесь, а не в `lib/photo-check/api.ts`: этот клиент —
 * `appendPhotoPages` — закрывает дыру в эндпоинте, который писал другой лист, и
 * живёт рядом с кнопкой, которая его зовёт. В `api.ts` его положить нельзя
 * без правки чужого файла, а дублировать весь клиент проверки ради одной
 * функции — значит завести второе место, где BASE и разбор ошибок могут
 * разойтись. Когда владелец `api.ts` откроет файл, функцию стоит перенести
 * туда: контракт ответа у неё такой же, как у `runPhotoCheck`.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PhotoUpload, MAX_PAGES } from "./PhotoUpload";
import { PhotoCheckResultView } from "./PhotoCheckResult";
import { CheckSteps, photoCheckSteps } from "./CheckSteps";
import {
  deletePhotoCheck,
  runPhotoCheck,
  saveManualMarks,
  ERROR_TEXT,
  type PhotoCheckApiError,
  type PhotoCheckApiErrorCode,
} from "@/lib/photo-check/api";
import {
  confidenceHistogram,
  partitionByConfidence,
  partitionByDecision,
  type ConfidencePartition,
} from "@/lib/photo-check/confidence";
import type { PhotoCheckResult, PhotoCheckTask } from "@/lib/photo-check/types";
import { ManualMarksEditor, type ManualMarkDraft } from "./ManualMarksEditor";
import { compressImage, formatBytes } from "@/lib/utils/image";
import { trackEvent } from "@/lib/track";

/** Префикс проверки — тот же, что у клиента в `lib/photo-check/api.ts`. */
const PHOTO_BASE = "/api/assignments/photo-checks";

/** Сколько весит одна страница до сжатия. Ровно тот же потолок, что на бэке. */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

/**
 * Человеческий текст ошибки из тела ответа.
 *
 * Копия `serverText` из `api.ts` (там она приватная). Логика одна и та же
 * специально: машиный код вроде `TOO_MANY_FILES` учителю ничего не говорит,
 * а серверные тексты («в этой работе уже 3 страницы из 10») говорит всё.
 */
function appendServerText(json: unknown): string | undefined {
  const body = (json ?? {}) as { error?: unknown; message?: unknown; detail?: unknown };
  for (const value of [body.error, body.message, body.detail]) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (/^[A-Z][A-Z0-9_]*$/.test(text)) continue;
    return text;
  }
  return undefined;
}

/** Ответ досылки в наш union. Никогда не бросает наружу. */
function appendFailure(res: Response, json: unknown): PhotoCheckApiError {
  const code = ((json as { code?: string } | null)?.code ?? "").toUpperCase();
  const text = appendServerText(json);
  const status = res.status;
  const pick = (error: PhotoCheckApiErrorCode): PhotoCheckApiError => ({
    ok: false,
    error,
    message: text || ERROR_TEXT[error],
    status,
  });
  if (status === 401) return pick("unauthorized");
  if (status === 402) return pick("quota");
  if (status === 413) return pick("too_large");
  if (status === 404) return pick("not_found");
  if (status === 503 || code === "LLM_UNAVAILABLE") return pick("llm_unavailable");
  if (status === 400) return pick("bad_request");
  return pick("http");
}

/**
 * POST /photo-checks/:id/pages — дослать страницы к готовой работе.
 *
 * Файлы кладутся в FormData под именем `image` по очереди, и порядок этот —
 * порядок страниц: сервер кладет их следующими номерами и перепроверяет работу
 * целиком строго 1, 2, 3… Поэтому файл, выбранный первым, станет страницей N+1,
 * а не «первой страницей заново».
 *
 * Согласие на обработку персональных данных НЕ отправляется: оно уже было
 * дано при первой загрузке этой работы, а сервер это прямо оговаривает
 * (`readPhotoPagesForm`). Спрашивать учителя второй раз про то же самое —
 * нечестно.
 *
 * Эталоны тоже не отправляются: сервер возьмёт их из уже сохранённых заданий
 * проверки, иначе пришлось бы диктовать учителю то, что он уже отдавал.
 */
export async function appendPhotoPages(args: {
  checkId: string;
  blobs: Blob[];
  subject?: string | null;
  grade?: number | null;
  detail?: "low" | "high";
}): Promise<PhotoCheckResult | PhotoCheckApiError> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (!apiUrl) return { ok: false, error: "no_api_url", message: ERROR_TEXT.no_api_url };
  if (args.blobs.length === 0) {
    return { ok: false, error: "bad_request", message: "Не выбрано ни одной страницы." };
  }

  const fd = new FormData();
  args.blobs.forEach((blob, i) => fd.append("image", blob, `page-append-${i + 1}.jpg`));
  fd.append("detail", args.detail ?? "low");
  // `worksheetId` здесь НЕ отправляется: досылка работает с уже сохранённой
  // проверкой, и `readPhotoPagesForm` его всё равно не читает.
  if (args.subject) fd.append("subject", args.subject);
  if (args.grade != null) fd.append("grade", String(args.grade));

  let res: Response;
  try {
    res = await fetch(`${apiUrl}${PHOTO_BASE}/${encodeURIComponent(args.checkId)}/pages`, {
      method: "POST",
      body: fd,
      credentials: "include",
      cache: "no-store",
      // Content-Type намеренно НЕ задаём — браузер проставит boundary.
    });
  } catch {
    return { ok: false, error: "network", message: ERROR_TEXT.network };
  }

  const json = (await res.json().catch(() => null)) as PhotoCheckResult | null;
  if (!res.ok) return appendFailure(res, json);
  if (!json || json.ok !== true) {
    return { ok: false, error: "http", message: ERROR_TEXT.http };
  }
  return json;
}

/**
 * Сколько страниц в работе — из ответа сервера.
 *
 * Поле `pages` сервер отдаёт всегда (`buildCheckDto`), но в типе
 * `PhotoCheckResult` его нет: `lib/photo-check/types.ts` принадлежит другому
 * листу, поэтому здесь узкое приведение вместо правки чужого контракта.
 *
 * `fallback` — то, что мы знаем наверняка: сколько файлов ушло с проверкой или
 * с досылкой. Лучше известное число, чем пустое место.
 */
function pagesFromDto(dto: PhotoCheckResult, fallback: number | null): number | null {
  const raw = (dto as { pages?: unknown }).pages;
  return typeof raw === "number" && raw > 0 ? raw : fallback;
}

/** Эталонное задание в том виде, в каком его прокидывает конструктор. */
export interface PhotoCheckTaskInput {
  number: number;
  taskText: string;
  correctAnswer: string;
  maxPoints: number;
}

export interface PhotoCheckPanelProps {
  assignmentId: string;
  demoTasks: PhotoCheckTaskInput[];
  onResult?: (r: { source?: string; percentage?: number }) => void;
  /**
   * Остаток бесплатных генераций — тихой строкой под экраном.
   *
   * Показывается числом и ссылкой на тарифы, БЕЗ цен и БЕЗ карточки: на
   * экране ошибки тарифы с ценами спорят с текстом ошибки и уводят внимание от
   * того, что делать. `limit: null` — безлимит на платном тарифе.
   *
   * Необязателен: панель рисует фото-проверку и без счётчика, в тестах его нет.
   */
  quota?: { left: number; limit: number | null } | null;
}

type ViewState = "idle" | "pending" | "result" | "error";

/**
 * Что именно сломалось — учителю нужны РАЗНЫЕ подсказки.
 *  service — сервис недоступен: фото цело, его не надо переснимать, поможет повтор;
 *  reshoot — снимок не читается: повтор того же файла бесполезен, нужна новая
 *           фотография (ближе, свет, без бликов);
 *  access  — доступа/лимита: ни сеть, ни фото тут ни при чём.
 */
export type FailureKind = "service" | "reshoot" | "access";

/**
 * Разложить код ошибки API на вид сбоя.
 *
 * ОГРАНИЧЕНИЕ, КОТОРОЕ ВИДНО СРАЗУ: бэк отдаёт `503 LLM_UNAVAILABLE` и когда
 * провайдер модели лежит, и когда модель ответила мусором (один catch на весь
 * `checkPhoto`, `backend/src/routes/f06.ts:271-277`). Различить эти два случая
 * по ответу нельзя — данных в типах нет. Поэтому `llm_unavailable` отнесён к
 * `service`: повтор действительно может помочь, когда дело в провайдере, и
 * учителю мы честно говорим «попробуйте ещё раз». Разделение «сервис упал» и
 * «фото не распозналось» требует отдельного кода ответа на бэке.
 */
export function failureKind(code: PhotoCheckApiErrorCode): FailureKind {
  switch (code) {
    case "network":
    case "no_api_url":
    case "llm_unavailable":
    case "http":
      return "service";
    case "bad_request":
    case "too_large":
      return "reshoot";
    default:
      // unauthorized / quota / not_found — к фотографии отношения не имеют.
      return "access";
  }
}

export function PhotoCheckPanel({
  assignmentId,
  demoTasks,
  onResult,
  quota = null,
}: PhotoCheckPanelProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<ViewState>("idle");
  const [result, setResult] = useState<PhotoCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<PhotoCheckApiErrorCode | null>(null);
  /**
   * Причина неудачного сохранения ручных отметок. null — попытки ещё не было.
   *
   * Раньше отметки жили в локальном `manual` и умирали вместе со вкладкой.
   * Теперь черновик живёт внутри `ManualMarksEditor`, а сохраняется он
   * только по явной кнопке — и ошибка сохранения обязана быть видна, иначе
   * учитель решит, что отметки записались.
   */
  const [marksError, setMarksError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  /**
   * Сколько страниц в ЭТОЙ работе сейчас. null = фото удалены и число
   * восстановить нельзя; тогда досылки не будет (кнопки без работающего
   * запроса — это враньё, а «дослать к удалённым фото» всё равно отказ).
   */
  const [pages, setPages] = useState<number | null>(null);
  /** Открыт ли блок выбора страницы для досылки. */
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendFiles, setAppendFiles] = useState<File[]>([]);
  const [appending, setAppending] = useState(false);
  /** Отказ СЕРВЕРА при досылке. Показан словами, разбор при этом не трогаем. */
  const [appendError, setAppendError] = useState<string | null>(null);
  /** Отказ на этапе выбора файла — подсказка про конкретный файл. */
  const [appendPickError, setAppendPickError] = useState<string | null>(null);
  /** Что изменилось после успешной досылки — одним предложением. */
  const [appendDone, setAppendDone] = useState<string | null>(null);

  /** Сколько страниц сервер ещё примет в эту работу. */
  const pagesRoom = pages === null ? 0 : Math.max(0, MAX_PAGES - pages);

  // `local-ws_xxx` — лист не в D1, эталон уходит телом запроса.
  const worksheetId = useMemo(
    () => (assignmentId.startsWith("ws_") ? assignmentId : null),
    [assignmentId],
  );

  const tasks: PhotoCheckTask[] = useMemo(
    () =>
      demoTasks.map((t) => ({
        number: t.number,
        taskText: t.taskText,
        correctAnswer: t.correctAnswer,
        maxPoints: t.maxPoints,
      })),
    [demoTasks],
  );

  const canSubmit = files.length > 0 && consent && state !== "pending" && tasks.length > 0;

  /**
   * Разбор результата по уверенности — для ПОКАЗА: гистограмма, бейджи,
   * «Доверяем чтению от 85%».
   *
   * Про то, что попадёт в перепроверку, этот разбор НЕ решает: за это отвечает
   * `decisionPartition` ниже, где список приходит с сервера.
   */
  const partition: ConfidencePartition | null = useMemo(
    () => (result && result.status !== "failed" ? partitionByConfidence(result.items) : null),
    [result],
  );

  /**
   * КАКИЕ задания учитель должен разобрать сам.
   *
   * Взят с сервера, а не посчитан на клиенте: после сохранения ручных отметок
   * `needsReview` уже `false` у закрытых заданий, и клиентский пересчёт по
   * порогу вёл бы себя иначе — показал бы учителю задание, которое сервер
   * разбирать не просит, и отметка по нему улетела бы в никуда.
   */
  const decisionPartition = useMemo(
    () => (result ? partitionByDecision(result.items, result.manualMarks ?? []) : null),
    [result],
  );

  /**
   * Что уходит в общий результат (таблица + «Спроси ученика»).
   *
   * Если хоть одно задание требует проверки учителем:
   *  - `items` — только уверенные: сомнительные уже показаны отдельным блоком
   *    выше, в таблице им не место;
   *  - `allItems` — полный список для панели вопросов, иначе неразобранные
   *    задания выпали бы из «Спроси ученика», а это её основной сценарий;
   *  - `gradeMark` и `percentage` — НЕ показываем вообще. Работа разобрана не
   *    до конца, любая итоговая цифра была бы выдумкой (ТЗ-18 В5);
   *  - `earnedPoints` — только по уверенно прочитанным заданиям, а
   *    `totalPoints` оставляем полный: разрыв в баллах и есть видимая цена
   *    неразобранной части работы.
   */
  const viewResult: PhotoCheckResult | null = useMemo(() => {
    if (!result || !partition || !decisionPartition) return null;
    // «Разбор закончен» — это ответ СЕРВЕРА (`needsDecision` пуст), а не
    // клиентский подсчёт неуверенных. Иначе задание, которому сервер уже не
    // мешает (например, без распознанного ответа, но с сохранённой ручной
    // отметкой), навсегда держал бы панель в состоянии «не завершено» — и
    // учитель, закрыв все отметки, так и не увидел бы итоговую оценку.
    if (decisionPartition.needsDecision.length === 0) return result;
    return {
      ...result,
      items: partition.confident,
      allItems: result.items,
      earnedPoints: partition.confident.reduce((sum, i) => sum + i.pointsAwarded, 0),
      percentage: null,
      gradeMark: null,
      status: "partial",
      needsReview: true,
    };
  }, [result, partition, decisionPartition]);

  async function submit() {
    if (files.length === 0) return;
    setState("pending");
    setError(null);
    setErrorCode(null);

    const res = await runPhotoCheck({
      // Порядок массива = порядок страниц в тетради; бэк читает `image`
      // именно в этом порядке, и переупорядочивать их здесь нельзя.
      blobs: files,
      tasks,
      worksheetId,
      detail: "low", // черновик/массовая проверка — экономит токены картинки
    });

    if (res.ok) {
      // Проверка могла завершиться ничем: бэк отдаёт `status: "failed"` для
      // записи, по которой распознавание не состоялось. Отметки и баллов
      // в ней нет, и выдумывать их нельзя — отдельный экран ниже.
      if (res.status === "failed") {
        setResult(res);
        setMarksError(null);
        // Страницы в работе есть даже у неуспешной проверки — их прислали и
        // они лежат, просто разобрать не вышло. Число нужно, чтобы блок
        // досылки не врал «страниц нет».
        setPages(pagesFromDto(res, files.length));
        setState("result");
        trackEvent("photo_check_failed", { error: "recognition_failed" });
        return;
      }

      const part = partitionByConfidence(res.items);
      const allConfident = part.review.length === 0;

      setResult(res);
      setMarksError(null);
      setPages(pagesFromDto(res, files.length));
      setState("result");

      // Процент наружу уходит только когда ВСЕ задания прочитаны уверенно.
      // Иначе он посчитан по неполным данным и в аналитике выглядел бы как
      // честная оценка работы, которой мы не давали.
      onResult?.({
        source: "photo",
        percentage: allConfident ? (res.percentage ?? undefined) : undefined,
      });
      trackEvent("photo_check_done", {
        source: "photo",
        percentage: allConfident ? (res.percentage ?? undefined) : undefined,
        needs_review: res.needsReview || !allConfident,
        // Распределение уверенности — то, ради чего порог вынесен в настройку
        // (ТЗ-18 §7, п.5): через месяц видно, правильно ли выбраны 85%.
        confidence_threshold: part.threshold,
        items_total: part.total,
        items_confident: part.confident.length,
        items_unsure: part.unsure.length,
        items_unrecognized: part.unrecognized.length,
        confidence_histogram: confidenceHistogram(res.items),
      });
      return;
    }

    const err = res as PhotoCheckApiError;
    setError(err.message ?? "Не удалось проверить фото");
    setErrorCode(err.error);
    setState("error");
    trackEvent("photo_check_failed", { error: err.error });
  }

  /** В-2.3: удалить фото одной кнопкой, оставив результаты. */
  async function removePhoto() {
    if (!result) return;
    setDeleting(true);
    const res = await deletePhotoCheck(result.checkId);
    setDeleting(false);
    if (res.ok) {
      setResult({ ...result, photoDeleteAt: 0 });
      trackEvent("photo_check_photo_deleted", { check_id: result.checkId });
    } else {
      setError(res.message ?? "Не удалось удалить фото");
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setErrorCode(null);
    setMarksError(null);
    setPages(null);
    setAppendOpen(false);
    setAppendFiles([]);
    setAppendError(null);
    setAppendPickError(null);
    setAppendDone(null);
    setState("idle");
  }

  /**
   * «Проверить ещё одну работа»: та же работа учителя начинается с нуля, поэтому
   * гасим ещё и выбранные фото и согласие — иначе следующая проверка молча
   * ушла бы в работу со снимком предыдущей.
   */
  function startOver() {
    setFiles([]);
    setConsent(false);
    reset();
    trackEvent("photo_check_start_over", {});
  }

  /**
   * Выйти без входа с экрана отказа.
   *
   * Фото и согласие ОСТАЮТСЯ: снимок учителю не придётся переснимать заново,
   * и вернуться к проверке можно в любой момент.
   */
  function skipLogin() {
    setError(null);
    setErrorCode(null);
    setState("idle");
    trackEvent("photo_check_login_skipped", {});
  }

  /** Сбросить фото: после «не прочиталось» повторять тот же снимок смысла нет. */
  function reshoot() {
    setFiles([]);
    setError(null);
    setErrorCode(null);
    setState("idle");
  }

  /**
   * Взять страницы для досылки: тот же отбор, что при первой загрузке —
   * тип, 8 МБ и сжатие (сжатое фото и дешевле для распознавания, и меньше по
   * весу на мобильном интернете).
   *
   * Ошибка здесь — про конкретный файл, поэтому она своя и не смешивается с
   * отказом сервера: «ваш снимок 9 МБ» и «сервис недоступен» — разные советы.
   */
  async function pickAppendPages(candidates: FileList | null) {
    if (!candidates) return;
    setAppendPickError(null);

    const picked = Array.from(candidates);
    // Лишние страницы не выкидываем МОЛЧА: ученик отправил бы в работу работу,
    // которой там нет, и потом удивлялся бы оценке. Сказано словами — сколько
    // ещё помещается в эту работу.
    if (picked.length > pagesRoom) {
      setAppendPickError(
        `В эту работу помещается ещё ${pagesRoom} ${plural(pagesRoom, "страница", "страницы", "страниц")}. ` +
          `Лишние не поедут — выберите их по одной.`,
      );
      return;
    }

    const normalized: File[] = [];
    for (const file of picked) {
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
        setAppendPickError(`«${file.name}» — нужен JPEG, PNG или WebP.`);
        return;
      }
      if (file.size > MAX_PAGE_BYTES) {
        setAppendPickError(
          `«${file.name}» больше 8 МБ (${formatBytes(file.size)}). Снимите в меньшем разрешении.`,
        );
        return;
      }
      try {
        const compressed = await compressImage(file);
        normalized.push(new File([compressed], file.name, { type: compressed.type }));
      } catch {
        setAppendPickError(`Не удалось прочитать «${file.name}». Попробуйте переснять.`);
        return;
      }
    }
    if (normalized.length > 0) setAppendFiles(normalized);
  }

  /**
   * Дослать страницу к готовой работе (лист 7.1.4).
   *
   * ЧТО ПРОИСХОДИТ НА СЕРВЕРЕ: новая страница ложится следующим номером, вся
   * работа перепроверяется целиком строго 1…N, а ручные отметки учителя
   * сливаются с новым вердиктом машины. Поэтому «разбор потерялся» здесь
   * невозможно, а «отметки исчезли» — тем более.
   *
   * ПОЧЕМУ ПРИ ОТКАЗЕ НЕ ТРОГАЕМ `result`: сервер мог не успеть ничего сделать,
   * и показать учителю новый разбор после отказа — значит показать ему то,
   * чего не случилось. Прежний разбор остаётся на экране, под ним — текст
   * ошибки, а выбранный файл остаётся в поле, чтобы повтор был в одно касание.
   */
  async function appendPages() {
    if (!result || appending) return; // `appending` — защита от двойного нажатия

    if (pages === null || result.photoDeleted) {
      setAppendError("Фото этой работы удалены — дослать к ним страницы уже не к чему.");
      return;
    }
    if (pagesRoom <= 0) {
      setAppendError(
        `В работе уже ${MAX_PAGES} страниц — это потолок, дослать больше нельзя.`,
      );
      return;
    }
    if (appendFiles.length === 0) {
      setAppendError("Выберите страницу — без снимка досылать нечего.");
      return;
    }
    if (appendFiles.length > pagesRoom) {
      setAppendError(
        `В этой работе уже ${pages} ${plural(pages, "страница", "страницы", "страниц")} ` +
          `из ${MAX_PAGES}, дослать можно ${pagesRoom}. Уберите лишние.`,
      );
      return;
    }

    const added = appendFiles.length;
    setAppending(true);
    setAppendError(null);
    setAppendDone(null);

    const res = await appendPhotoPages({
      checkId: result.checkId,
      blobs: appendFiles,
      detail: "low",
    });

    setAppending(false);

    if (!res.ok) {
      setAppendError(res.message ?? "Не удалось дослать страницу — попробуйте ещё раз.");
      trackEvent("photo_check_append_failed", { check_id: result.checkId, error: res.error });
      return;
    }

    // Ответ сервера подставляем ЦЕЛИКОМ: в нём уже слитые ручные отметки и
    // пересчитанный по всем страницам итог. Считать что-то на клиенте
    // значит держать вторую версию арифметики того же ответа.
    const totalPages = pagesFromDto(res, pages + added);
    const part = partitionByConfidence(res.items);
    setResult(res);
    setPages(totalPages);
    setAppendFiles([]);
    setAppendDone(
      `Страница ${pages + 1} добавлена — теперь в работе ${totalPages} ` +
        `${plural(totalPages ?? added, "страница", "страницы", "страниц")}. ` +
        `Разбор пересчитан по всем страницам, ваши отметки на месте.`,
    );
    trackEvent("photo_check_pages_appended", {
      check_id: res.checkId,
      added,
      pages_total: totalPages,
      pending_review: res.pendingReview ?? 0,
    });
    onResult?.({
      source: "photo",
      percentage: part.review.length === 0 ? (res.percentage ?? undefined) : undefined,
    });
  }

  /**
   * Сохранить ручные отметки учителя (ТЗ-19).
   *
   * После успеха подставляем ответ сервера ЦЕЛИКОМ, а не «доклеиваем» баллы на
   * клиенте: пересчитывать итог в двух местах — значит через месяц получить
   * два разных ответа на один и тот же вопрос «какая отметка».
   */
  async function saveMarks(marks: ManualMarkDraft[]) {
    if (!result) return;
    setMarksError(null);
    const res = await saveManualMarks(result.checkId, marks);
    if (res.ok) {
      setResult(res);
      trackEvent("photo_check_manual_marks_saved", {
        check_id: res.checkId,
        count: marks.length,
        pending_review: res.pendingReview,
      });
      return;
    }
    setMarksError(res.message ?? "Не удалось сохранить отметки — попробуйте ещё раз");
    // Бросаем наружу, чтобы ManualMarksEditor не сообщил «Сохранено».
    throw new Error(res.message ?? "Не удалось сохранить отметки");
  }

  /**
   * Отказ по доступу: нужен вход. Отдельным флагом, потому что отказ меняет
   * весь экран — заголовок, шаги, состав блоков и кнопки, — а не одну плашку.
   */
  const needLogin = state === "error" && errorCode !== null && failureKind(errorCode) === "access";

  return (
    <Card className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-warm-950">
          {state === "result" && result && result.status !== "failed"
            ? "Работа проверена"
            : needLogin
              ? "Проверка не запустилась: нужен вход"
              : state === "pending"
                ? "Проверяем работу"
                : "Проверка работ по фото"}
        </h2>
        <p className="text-sm text-warm-600 mt-1">
          {needLogin
            ? "Фото в порядке — оно осталось выбранным."
            : state === "result" && result && result.status !== "failed"
              ? "Модель не разобрала часть заданий — отметки по ним ставите вы."
              : state === "pending"
                ? "Фото отправлено, идёт разбор."
                : "Сфотографируйте страницы тетради с ответами — по порядку, одна страница на фото. Запомнили страницу на фото лишним? Её можно будет дослать, не начиная проверку заново. Будем сверять с эталоном по " +
                  tasks.length +
                  " " +
                  plural(tasks.length, "заданию", "заданиям", "заданиям") +
                  "."}
        </p>
      </header>

      {/* Полоса шагов: где учитель находится и сколько шагов осталось.
          Раньше загрузка, согласие, задания, кнопка и лимит были в одном
          полотне, и этапы не читались. */}
      <CheckSteps
        steps={photoCheckSteps(
          needLogin
            ? "access"
            : state === "result" && result && result.status !== "failed"
              ? "result"
              : state === "pending"
                ? "running"
                : "upload",
        )}
      />

      {state === "result" && result ? (
        <div className="space-y-4">
          {result.status === "failed" ? (
            <RecognitionFailed onReshoot={reshoot} onRetry={submit} canRetry={files.length > 0} />
          ) : (
            <>
              {/* Блок «Проверьте сами» — ПЕРВЫМ на экране (ТЗ-18 В2).
                  Список заданий — из СЕРВЕРНОЙ разбивки `partitionByDecision`:
                  в неё попадает ровно то, что сервер ждёт от учителя, поэтому
                  отметка не улетит в никуда. `partition` остаётся для показа
                  уверенности и для состава таблицы результата. */}
              <ManualMarksEditor
                partition={decisionPartition ?? { settled: [], needsDecision: [], decided: [] }}
                initialMarks={result.manualMarks ?? []}
                onSave={saveMarks}
                errorMessage={marksError}
              />
              {viewResult && (
                <PhotoCheckResultView
                  result={viewResult}
                  pages={pages}
                  onDeletePhoto={removePhoto}
                  checkId={viewResult.checkId}
                  onPrint={() => {
                    if (typeof window !== "undefined") window.print();
                  }}
                  deleting={deleting}
                  onStartOver={startOver}
                />
              )}

              {/* Досылка — ПОСЛЕ разбора и под ним, а не вместо него. Это
                  дополнение к готовой работе, а не другой способ её начать, и
                  ученик с телефона видит её сразу после «Работа проверена». */}
              <AppendPages
                pages={pages}
                room={pagesRoom}
                photoDeleted={result.photoDeleted === true}
                open={appendOpen}
                files={appendFiles}
                sending={appending}
                error={appendError}
                pickError={appendPickError}
                done={appendDone}
                onToggle={(next) => {
                  setAppendOpen(next);
                  if (!next) {
                    setAppendFiles([]);
                    setAppendPickError(null);
                    setAppendError(null);
                  }
                }}
                onPick={pickAppendPages}
                onRemove={() => setAppendFiles([])}
                onSend={appendPages}
              />
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── Шаги 1-2: согласие и фото ─────────────────────────────── */}
          {/* На экране отказа по доступу загрузка НЕ рисуется: там решается
              вопрос «войти, посмотреть тарифы или уйти», и полотно с фото,
              согласием и заданиями отодвигало решение за пределы экрана.
              Сами снимки при этом не теряются — они в состоянии, и «Выйти без
              входа» возвращает к загрузке с фото на месте. */}
          {!needLogin && (
            <PhotoUpload
              files={files}
              onFilesChange={setFiles}
              consentAccepted={consent}
              onConsentChange={setConsent}
              disabled={state === "pending"}
            />
          )}

          {/* ── Шаг 3: эталон подставляется автоматически ─────────────── */}
          {!needLogin && tasks.length > 0 && (
            <details
              open={tasksOpen}
              onToggle={(e) => setTasksOpen(e.currentTarget.open)}
              className="rounded-xl border border-warm-100 bg-warm-50/60 px-3.5 py-2.5"
            >
              <summary className="text-sm text-warm-700 cursor-pointer select-none">
                Посмотреть задания и эталоны ({tasks.length})
              </summary>
              <ul className="mt-2.5 space-y-1.5 text-xs text-warm-700">
                {tasks.map((t) => (
                  <li key={t.number} className="flex gap-2">
                    <span className="text-[color:var(--text-muted)] shrink-0 w-5">{t.number}.</span>
                    <span>
                      <span className="text-warm-900">{t.taskText}</span>
                      <span className="block text-warm-500">
                        эталон: {t.correctAnswer} · {t.maxPoints} б.
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Отказ по доступу — это не «ещё раз», а выход: вход, тарифы или
              уход без входа. Учитель не должен упираться в кнопку, которая
              даёт тот же отказ. */}
          {needLogin ? (
            <LoginRequired
              message={error}
              code={errorCode}
              pageCount={files.length}
              onSkip={skipLogin}
            />
          ) : (
            state === "error" && errorCode && (
              <FailureNotice
                kind={failureKind(errorCode)}
                message={error}
                onRetry={submit}
                onReshoot={reshoot}
                canRetry={files.length > 0}
              />
            )
          )}

          {/* ── Шаг 4: отправка ──────────────────────────────────────── */}
          {needLogin ? null : state === "pending" ? (
            <div role="status" className="space-y-2">
              <p className="text-sm text-warm-700 text-center py-2">
                <span className="inline-block w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin align-middle mr-2" />
                Проверяем работу
              </p>
              <p className="text-xs text-warm-500 text-center m-0">
                Страниц: {files.length} · заданий: {tasks.length}. Обычно около минуты.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                // `loading` здесь не нужен: эта ветка рендерится только когда
                // `state !== "pending"` (ветка выше), так что условие
                // `state === "pending"` здесь всегда false. Спиннер показывает
                // та же ветка отдельным блоком с текстом «Проверяем работу».
              >
                {state === "error" ? "Проверить ещё раз" : "Проверить"}
              </Button>
              {!consent && (
                <span className="text-xs text-warm-500">
                  Отметьте согласие на обработку персональных данных, чтобы
                  загрузить фото
                </span>
              )}
            </div>
          )}

          {/* Лимит — тихой строкой внизу. Карточка с ценами здесь спорила бы с
              текстом ошибки и уводила от того, что делать. */}
          <QuotaLine quota={quota} />
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Блок «Проверьте сами» (ТЗ-18 В2–В4)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Ошибки: сеть ≠ распознавание (ТЗ-18 В5)
// ─────────────────────────────────────────────────────────────────────────────

function FailureNotice({
  kind,
  message,
  onRetry,
  onReshoot,
  canRetry,
}: {
  kind: FailureKind;
  message: string | null;
  onRetry: () => void;
  onReshoot: () => void;
  canRetry: boolean;
}) {
  if (kind === "reshoot") {
    return (
      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 space-y-2">
        <p className="text-sm font-medium text-amber-950">
          Не получилось прочитать фото
        </p>
        <p className="text-sm text-amber-900">
          {message ?? "Не удалось прочитать фото."} Это снимок, а не сеть: повторять
          с тем же файлом смысла нет. Сфотографируйте работу ещё раз — ближе, при
          ровном свете, без тени от руки и бликов.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onReshoot}>
            Сфотографировать заново
          </Button>
          {canRetry && (
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              Всё равно повторить
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (kind === "access") {
    // Сюда панель больше не доходит: отказ по доступу разбирает `LoginRequired` —
    // с кнопкой входа, тарифами и списком «что будет после входа».
    return null;
  }

  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 space-y-2">
      <p className="text-sm font-medium text-amber-950">
        Сервис проверки сейчас недоступен
      </p>
      <p className="text-sm text-amber-900">
        {message ?? "Проверка временно недоступна."} Фото цело — его не нужно
        переснимать. Повторите проверку через минуту; если так и не выйдет,
        вернитесь к этому фото позже.
      </p>
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Повторить
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onReshoot}>
          Сфотографировать заново
        </Button>
      </div>
    </div>
  );
}

/**
 * Отказ по доступу = нужен вход. Не «ещё раз», а ВЫХОД (переработанный флоу).
 *
 * Раньше здесь была жёлтая плашка и кнопка «Проверить ещё раз», которая даёт
 * тот же отказ: учитель оказывался в тупике и не понимал, что делать с уже
 * снятым фото. Теперь у него три выхода — войти, посмотреть тарифы или уйти
 * без входа, — и видно, что фото при этом не теряется.
 *
 * Числа страниц и заданий подставляются из данных, а не из макета.
 */
function LoginRequired({
  message,
  code,
  pageCount,
  onSkip,
}: {
  message: string | null;
  code: PhotoCheckApiErrorCode;
  pageCount: number;
  onSkip: () => void;
}) {
  // Сервер иногда присылает вместо текста машинный код («unauthorized»). На
  // экране он читается хуже внятной фразы, поэтому код текстом не считаем и
  // берём русский текст по типу ошибки.
  const reason = message && message !== code ? message : ERROR_TEXT[code];

  return (
    <div className="space-y-3" data-testid="photo-check-login-required">
      <div
        role="status"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4"
      >
        <p className="text-sm font-semibold text-amber-950 m-0">
          Вход нужен, чтобы результат сохранился
        </p>
        <p className="text-sm text-amber-900 mt-1 mb-0">
          Без аккаунта некуда записать отметки: в журнале проверок хранится, кто и
          как их поставил. Войдите — и проверка запустится с тем же фото, заново
          ничего фотографировать не придётся.
        </p>
        {reason && (
          <p className="text-xs text-amber-800 mt-1.5 mb-0">{reason}</p>
        )}
      </div>

      <dl className="rounded-xl border border-warm-100 bg-warm-50 px-4 py-1">
        {(
          [
            ["Страниц снято", `${pageCount} — остались на месте`],
            ["Что потеряно", "ничего"],
            ["Что будет после входа", "вы вернётесь сюда и нажмёте «Проверить»"],
          ] as const
        ).map(([label, value], i, arr) => (
          <div
            key={label}
            className={`flex flex-wrap gap-x-3 gap-y-0.5 py-2.5 ${
              i < arr.length - 1 ? "border-b border-warm-100" : ""
            }`}
          >
            <dt className="text-sm text-warm-600 w-full sm:w-48 shrink-0">{label}</dt>
            <dd className="text-sm text-warm-900 m-0">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-warm-500 m-0">
        Не хотите входить прямо сейчас? Вернитесь к проверке позже, но
        в этом же окне браузера: если страницу перезагрузить, снимки пропадут
        и сфотографировать придётся заново.
      </p>

      <div className="rounded-xl border border-warm-100 bg-white px-4 py-3">
        <p className="text-sm font-medium text-warm-950 m-0">Что произойдёт после входа</p>
        <dl className="mt-1">
          {(
            [
              ["Фото", "останутся выбранными — снимать заново не нужно"],
              [
                "Проверка",
                // Число страниц уже названо строкой выше («Страниц снято») —
                // здесь оно было бы вторым разом и ломало согласование
                // («на тех же 1 странице»).
                "запустится, когда вы нажмёте «Проверить»",
              ],
              ["Журнал", "результат появится там же, где и у прошлых работ"],
            ] as const
          ).map(([label, value], i, arr) => (
            <div
              key={label}
              className={`flex flex-wrap gap-x-3 gap-y-0.5 py-2 ${
                i < arr.length - 1 ? "border-b border-warm-100" : ""
              }`}
            >
              <dt className="text-sm text-warm-600 w-24 shrink-0">{label}</dt>
              <dd className="text-sm text-warm-700 m-0 flex-1 min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
          Выйти без входа
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button as="link" href="/pricing" variant="secondary" size="sm">
            Посмотреть тарифы
          </Button>
          <Button as="link" href="/login" size="md">
            Войти
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Остаток бесплатных генераций — одной строкой, без цен и без карточки.
 *
 * Раньше лимит висел отдельной карточкой с тарифами и на экране ошибки спорил
 * с текстом ошибки: учитель читал про деньги вместо того, чтобы понять, что
 * делать с работой. Здесь остаётся число и ссылка.
 */
function QuotaLine({ quota }: { quota: { left: number; limit: number | null } | null }) {
  if (!quota) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-warm-100 pt-3">
      <p className="text-xs text-warm-500 m-0">
        {quota.limit === null
          ? "Безлимит на вашем тарифе."
          : `Осталось ${quota.left} из ${quota.limit} бесплатных генераций.`}
      </p>
      <Button as="link" href="/pricing" variant="ghost" size="sm" className="h-auto px-0 py-0">
        Посмотреть тарифы
      </Button>
    </div>
  );
}

/**
 * Досылка страницы к готовой работе (лист 7.1.4).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ БЛОКОМ, А НЕ ЕЩЕ ОДНОЙ КНОПКОЙ В РЯДОК: здесь ученик
 * выбирает снимок на телефоне, и кнопка должна быть рядом с ним — иначе
 * «дослать» означало бы «открыть, выбрать файл, вернуться, нажать».
 *
 * ЧТО БЛОК ОБЯЗАН СКАЗАТЬ СРАЗУ (и не больше):
 *   - сколько страниц в работе сейчас — иначе «дослать» не значит ничего;
 *   - что разбор пересчитается по ВСЕЙ работе, а не по новой странице: иначе
 *     кажется, что досланное прошло отдельной проверкой;
 *   - что ручные отметки останутся (учитель уже мог половину поправить);
 *   - когда потолок исчерпан — тогда кнопки нет, и это сказано словами.
 *
 * Чего блок НЕ делает: не спрашивает согласие на обработку фото второй раз.
 * Оно дано при первой загрузке этой же работы, и сервер это оговаривает.
 */
function AppendPages({
  pages,
  room,
  photoDeleted,
  open,
  files,
  sending,
  error,
  pickError,
  done,
  onToggle,
  onPick,
  onRemove,
  onSend,
}: {
  pages: number | null;
  room: number;
  photoDeleted: boolean;
  open: boolean;
  files: File[];
  sending: boolean;
  error: string | null;
  pickError: string | null;
  done: string | null;
  onToggle: (next: boolean) => void;
  onPick: (files: FileList | null) => void;
  onRemove: () => void;
  onSend: () => void;
}) {
  // Фото удалены: досылать не к чему, и показывать кнопку было бы враньём —
  // сервер откажет на любой снимок.
  if (pages === null || photoDeleted) {
    return (
      <div className="rounded-2xl border border-warm-100 bg-warm-50 px-4 py-3">
        <p className="text-sm text-warm-700 m-0">
          Дослать страницу уже нельзя: фото этой работы удалены. Разбор на месте.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-warm-100 bg-warm-50 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-warm-950 m-0">Забыли страницу?</p>
          <p className="text-xs text-warm-600 mt-1 mb-0 max-w-2xl">
            {room > 0 ? (
              <>
                В работе {pages} {plural(pages, "страница", "страницы", "страниц")},{" "}
                дослать можно ещё {room}. Новая страница станет последней, а разбор
                пересчитается по всей работе целиком — те отметки, что вы уже
                поставили, останутся на месте.
              </>
            ) : (
              <>
                В работе уже {MAX_PAGES} страниц — это потолок, дослать больше нельзя.
              </>
            )}
          </p>
        </div>

        {room > 0 && !open && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onToggle(true)}
            className="no-print"
          >
            Дослать страницу
          </Button>
        )}
      </div>

      {open && room > 0 && (
        <div className="mt-3 space-y-3">
          <label
            className={`flex items-center justify-center rounded-xl border-2 border-dashed border-warm-200 bg-white px-4 py-3 text-center text-sm font-medium text-warm-900 ${
              sending ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-brand-400"
            }`}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={sending}
              onChange={(e) => {
                void onPick(e.target.files);
                // Сбрасываем значение: повторный выбор того же файла иначе не
                // вызовет change — а ученик именно это и делает, когда
                // переснял страницу.
                e.target.value = "";
              }}
              className="sr-only"
            />
            {files.length > 0 ? "Заменить страницу" : "Сфотографировать страницу"}
          </label>

          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-warm-700"
                >
                  <span>
                    <span className="font-medium text-warm-900">Страница {(pages ?? 0) + i + 1}</span>
                    {" · "}
                    {f.name} · {formatBytes(f.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRemove}
                    disabled={sending}
                    className="no-print"
                  >
                    Убрать
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 no-print">
            <Button type="button" onClick={onSend} loading={sending}>
              {sending ? "Перепроверяем работу" : "Дослать выбранные страницы"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onToggle(false)}
              disabled={sending}
            >
              Отмена
            </Button>
            <span className="text-xs text-warm-500">
              Обычно около минуты — заново читаем всю работу.
            </span>
          </div>
        </div>
      )}

      {(pickError || error) && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
        >
          {pickError ?? error}
        </p>
      )}

      {done && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900"
        >
          {done}
        </p>
      )}
    </div>
  );
}

/** Проверка не состоялась: данных нет, поэтому нет и отметки. */
function RecognitionFailed({
  onReshoot,
  onRetry,
  canRetry,
}: {
  onReshoot: () => void;
  onRetry: () => void;
  canRetry: boolean;
}) {
  return (
    <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 space-y-2">
      <p className="text-sm font-semibold text-amber-950">Не удалось распознать работу</p>
      <p className="text-sm text-amber-900">
        Страницу мы не разобрали, поэтому баллов и отметки нет. Мы их не ставим
        вместо вас: пустые цифры учитель принял бы за оценку работы ученика.
      </p>
      <p className="text-sm text-amber-900">
        Сфотографируйте ещё раз: ближе, при ровном свете, без тени от руки и
        бликов, чтобы в кадр попала вся страница.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onReshoot}>
          Сфотографировать заново
        </Button>
        {canRetry && (
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            Попробовать тот же снимок
          </Button>
        )}
      </div>
    </div>
  );
}

/** Русская плюрализация: 1 задание / 2 задания / 5 заданий. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
