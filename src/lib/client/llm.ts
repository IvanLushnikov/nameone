/**
 * Клиентский wrapper для бэка УчЛист.
 *
 * Если бэк доступен и ключи у него настроены — идёт реальный LLM-вызов.
 * Если нет — fallback на mock (тот же, что был до LLM-слоя), UX не ломается.
 *
 * URL бэка: NEXT_PUBLIC_API_URL — опциональная переменная.
 * Без неё — сразу mock.
 */

import type {
  Worksheet,
  LessonPlan,
  Presentation,
  Ktp,
  CardSet,
  MaterialBundle,
  LessonBundle,
  GenerationRequest,
} from "@/lib/types";
import { generateWorksheet as mockWorksheet } from "@/lib/mock/generator";
import { generateLessonPlan as mockLessonPlan } from "@/lib/mock/lesson-plan";
import { generatePresentation as mockPresentation } from "@/lib/mock/presentation";
import { generateKtp as mockKtp } from "@/lib/mock/ktp";
import { mockCards } from "@/lib/mock/cards";
import { mockMaterials } from "@/lib/mock/materials";
import { mockLessonBundle } from "@/lib/mock/lesson-bundle";
import { passChallenge } from "@/lib/turnstile";

/**
 * Таймаут одного запроса к бэку.
 *
 * ТЗ-26 Б-1. Было 90 с, и это был блокер: контрольная с двумя вариантами
 * отдаёт за 95,8 с (замер 13.10.2026, `meta.latencyMs = 95755`), вторая
 * попытка — за 101,8 с. Фронт обрывал запрос на 90-й секунде, учитель видел
 * `TimeoutError` и `net::ERR_ABORTED`. Через сайт контрольная не работала
 * НИКОГДА — разница системная, а не случайная.
 *
 * 240 с — не «впритык»: худший замер сегодня 101,8 с, то есть таймаут
 * переживает его с двойным запасом. Обратно 90 с возвращать нельзя.
 *
 * Число вынесено сюда намеренно: иначе следующий человек ищет 90_000 по
 * коду и не понимает, откуда оно взялось.
 */
export const GENERATION_TIMEOUT_MS = 240_000;

/**
 * Таймаут лично нашей — `AbortSignal.timeout` кидает `TimeoutError`.
 * Именно эту ошибку надо отличать от прочих отказов: для контрольной
 * повтор закончится тем же самым, и текст «попробуйте ещё раз» будет
 * ложью. См. ТЗ-26 Б-1 и ветку таймаута в конструкторе.
 */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Почему результат — заготовка, а не материал модели.
 *
 * Аудит 18.10.2026 (BUG-018): интерфейс показывал зелёный тост «Готово!» и
 * баннер «Сервис сейчас недоступен» одновременно, а это РАЗНЫЕ ситуации:
 *
 *   - `no_backend`       — сборка без NEXT_PUBLIC_API_URL (dev/демо-стенд).
 *   - `no_llm_endpoint`  — у этого типа нет серверного эндпоинта вовсе
 *                          («урок целиком»): заготовка здесь и есть реализация.
 *   - `service_failed`   — сервер ответил 5xx: настоящего листа получить
 *                          нечем, и подставлять заготовку вместо него нельзя
 *                          (это выключено в smartGenerate).
 */
export type DemoReason = "no_backend" | "no_llm_endpoint" | "service_failed";

interface ArtifactResult<T, TExtra = never> {
  data: T;
  /** Прочие поля ответа бэка (сейчас — `secondVariant` у контрольной). */
  extra?: TExtra;
  source: "llm" | "mock";
  isDemo: boolean;
  /** Почему это заготовка. null у настоящего результата. */
  demoReason: DemoReason | null;
  costUsd: number;
  latencyMs: number;
}

interface GenerateOpts {
  /** Имя эндпоинта бэка, например "worksheets" или "lesson-plans". */
  endpoint: string;
  /** Поле-результат в JSON ответа бэка ("worksheet" | "lessonPlan" | ...). */
  dataKey: string;
  /**
   * Не брать результат из кэша бэка.
   *
   * Нужен второму варианту контрольной работы: ключ кэша строится из предмета,
   * класса, темы, сложности, количества и типа, поэтому два прохода с
   * одинаковыми параметрами вернули бы один и тот же лист дважды.
   *
   * И кнопке «Новый вариант» (ТЗ-36): без обхода кэша она отдавала учителю
   * прошлый лист байт в байт — фронт считал запрос новым, а сервер отдавал
   * старый ответ, и обе стороны были по-своему правы.
   */
  bypassCache?: boolean;
  /**
   * Разрешить заготовку вместо ответа сервера.
   *
   * ВКЛЮЧАТЬ ТОЛЬКО ТАМ, ГДЕ ЗАГОТОВКА — ЭТО И ЕСТЬ РЕАЛИЗАЦИЯ. Сейчас такой
   * тип один: «урок целиком» (`/api/bundles/generate` на сервере не существует,
   * проверено: 404). Для остальных типов заготовка вместо ответа сервера —
   * это ложь, которую чиним (аудит 18.10.2026, BUG-013/014/018/025).
   */
  mockOnFailure?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Ошибка, дошедшая от бэка. Нужна, чтобы НЕ путать «квота кончилась» с
 * «бэк лежит»: раньше оба случая давали null, и учитель с исчерпанными
 * бесплатными листами получал мок-генерацию с формулировкой «демо-режим».
 */
export class BackendError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.code = code;
  }
  get isQuotaExceeded(): boolean {
    return this.status === 429 && this.code === "RATE_LIMIT";
  }
  get isChallengeRequired(): boolean {
    return this.status === 409 && this.code === "TURNSTILE_REQUIRED";
  }
  get isUpgradeRequired(): boolean {
    return this.status === 402 && this.code === "UPGRADE_REQUIRED";
  }
  get isGenerationForbidden(): boolean {
    return this.status === 403 && this.code === "GENERATION_FORBIDDEN";
  }
  /**
   * Капчу попросили, а пройти её нечем.
   *
   * Случай «сервер сказал 409, а виджета нет» — это не «капча не нужна»:
   * это ровно то состояние, в котором продукт раньше подставлял заготовку и
   * показывал зелёный тост «Готово!». Отдельный код нужен, чтобы UI сказал
   * правду: «подтвердите, что вы человек», а не «попробуйте ещё раз».
   */
  get isChallengeUnavailable(): boolean {
    return this.status === 409 && this.code === "CHALLENGE_UNAVAILABLE";
  }
}

/**
 * Один запрос к бэку.
 *
 * null = «сервер не ответил или ответил не-2xx 5xx» → можно упасть в мок.
 * 4xx = это ОТВЕТ на наш запрос (квота, капча, тариф), и мок тут неуместен:
 * бросаем BackendError, чтобы вызывающий показал учителю внятное объяснение.
 */
async function callBackendOnce<T, TExtra = never>(
  path: string,
  body: unknown,
  dataKey: string,
  turnstileToken?: string,
): Promise<{ data: T; extra?: TExtra } | null> {
  if (!API_URL) return null;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
    },
    body: JSON.stringify(body),
    // Без cookie бэк не видит пользователя и считает его анонимом: платящий
    // учитель упирается в анонимный лимит, а вся школа за одним IP делит
    // одну квоту. Раньше здесь credentials не было — тариф на сервере не работал.
    credentials: "include",
    // Без таймаута зависшая сеть держит учителя на спиннере бесконечно.
    // 240 с, а не 90: контрольная не укладывалась в 90 с ни разу (ТЗ-26 Б-1).
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const value = data?.[dataKey] as T | undefined;
    if (value == null) return null;
    // Всё, кроме самого артефакта, отдаём как extra: сейчас это
    // `secondVariant` у контрольной работы, но схема не привязана к нему.
    return { data: value, extra: data as TExtra };
  }
  if (res.status >= 400 && res.status < 500) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: string; code?: string; details?: { code?: string } }
      | null;
    // Код ошибки может лежать в двух местах, и это не украшение: сервер кладёт
    // общий код в корне (`PAYMENT_REQUIRED` из ApiError), а предметный — в
    // `details.code` (`UPGRADE_REQUIRED`). Раньше читался только корень, и
    // `isUpgradeRequired` не срабатывал НИКОГДА: то есть окно оплаты не
    // показывалось ни для вариантов ОГЭ/ЕГЭ, ни для премиум-листов и КТП —
    // учитель вместо экрана оплаты видел сырой текст ошибки.
    // Берём оба: предметный код точнее, корневой — запасной вариант.
    const code = payload?.details?.code ?? payload?.code ?? null;
    throw new BackendError(res.status, code, payload?.error ?? `HTTP ${res.status}`);
  }
  // 501 — сервер ответил «этот тип не реализован». Это НЕ сбой сервиса и не
  // повод молча подставить заготовку: у заготовки типовые задания, учитель
  // получает не то, что просил, и теряет попытку. Раньше 501 попадал в
  // общий «5xx → null → мок», из-за чего 6 типов из 7 молча показывали
  // шаблон как будто это сгенерированный материал (BL-05).
  if (res.status === 501) {
    throw new BackendError(
      501,
      "NOT_IMPLEMENTED",
      "Этот тип материала сервер пока не умеет собирать",
    );
  }
  // Остальные 5xx — это уже сбой, и для сбоя заготовка как «запасной путь»
  // осмысленна: учитель хоть что-то получит, а плашка честно скажет, что это
  // демонстрационный шаблон.
  return null;
}

/**
 * Запрос с автоматическим прохождением капчи.
 *
 * При 409 TURNSTILE_REQUIRED один раз показываем невидимый Turnstile и
 * повторяем тот же запрос с токеном. Не более одного повтора: если капча не
 * помогла, второй круг только замкнёт нагрузку на Cloudflare.
 *
 * ВАЖНО (аудит 18.10.2026, BUG-013/018): если капчу пройти НЕЧЕМ (sitekey не
 * задан в сборке или скрипт не загрузился), раньше здесь возвращался `null`, а
 * `null` означал «упади в мок-генератор». То есть учитель получал типовую
 * заготовку под видом готового листа и зелёный тост «Готово!». Теперь это
 * явная ошибка с отдельным кодом: UI скажет правду.
 */
async function callBackend<T, TExtra = never>(
  path: string,
  body: unknown,
  dataKey: string,
): Promise<{ data: T; extra?: TExtra } | null> {
  try {
    return await callBackendOnce<T, TExtra>(path, body, dataKey);
  } catch (e) {
    if (e instanceof BackendError && e.isChallengeRequired) {
      const token = await passChallenge();
      if (token) {
        return await callBackendOnce<T, TExtra>(path, body, dataKey, token);
      }
      // Капчу взять нечем: sitekey не задан или скрипт Cloudflare не пришёл.
      // Fail-open здесь означал бы «подставь заготовку вместо листа» — то
      // самое враньё, которое чиним. Поэтому честная ошибка.
      throw new BackendError(
        409,
        "CHALLENGE_UNAVAILABLE",
        "Сервер попросил подтвердить, что запрос отправил человек, а подтвердить нечем",
      );
    }
    throw e;
  }
}

async function wrapMock<T>(
  reason: string,
  fn: () => Promise<T>,
  startMs: number,
  demoReason: DemoReason,
): Promise<ArtifactResult<T>> {
  console.info(`[client-llm] demo-режим (${reason})`);
  const data = await fn();
  return {
    data,
    source: "mock",
    isDemo: true,
    demoReason,
    costUsd: 0,
    latencyMs: Date.now() - startMs,
  };
}

async function smartGenerate<T, TExtra = never>(
  req: GenerationRequest,
  opts: GenerateOpts,
  mockFn: () => Promise<T>,
): Promise<ArtifactResult<T, TExtra>> {
  const start = Date.now();
  // Здесь BackendError НЕ глотается. «Квота кончилась» и «этот тип не входит
  // в тариф» — это ответы пользователю (PaywallModal / предложение Плюс),
  // а не повод подсунуть мок. Мок — только когда бэка нет вовсе (сборка без
  // NEXT_PUBLIC_API_URL, то есть dev/демо-стенд) или когда для этого типа
  // заготовка и есть реализация.
  // Тип без серверного эндпоинта (сейчас — «урок целиком»): заготовка здесь и
  // есть реализация, и 404/501 на таком эндпоинте — не авария.
  if (opts.mockOnFailure) {
    try {
      const remote = await callBackend<T, TExtra>(
        `/api/${opts.endpoint}/generate`,
        opts.bypassCache ? { request: req, bypassCache: true } : { request: req },
        opts.dataKey,
      );
      if (remote) {
        return {
          data: remote.data,
          extra: remote.extra,
          source: "llm",
          isDemo: false,
          demoReason: null,
          costUsd: 0,
          latencyMs: Date.now() - start,
        };
      }
      return wrapMock(
        `${opts.endpoint}/generate не ответил — для этого типа заготовка и есть реализация`,
        mockFn,
        start,
        "no_llm_endpoint",
      );
    } catch (e) {
      if (!(e instanceof BackendError && (e.status === 404 || e.status === 501))) throw e;
      return wrapMock(
        `${opts.endpoint}/generate не реализован на сервере — для этого типа заготовка и есть реализация`,
        mockFn,
        start,
        "no_llm_endpoint",
      );
    }
  }

  const remote = await callBackend<T, TExtra>(
    `/api/${opts.endpoint}/generate`,
    opts.bypassCache ? { request: req, bypassCache: true } : { request: req },
    opts.dataKey,
  );
  if (remote) {
    return {
      data: remote.data,
      extra: remote.extra,
      source: "llm",
      isDemo: false,
      demoReason: null,
      costUsd: 0,
      latencyMs: Date.now() - start,
    };
  }
  // Сервер ответил, но материала не прислал (5xx) — либо бэка нет в этой
  // сборке. Дальше развилка: подставлять заготовку можно только там, где это
  // разрешено явно. Иначе — честная ошибка (аудит 18.10.2026, BUG-018):
  // раньше учитель в этом месте получал типовой лист с зелёным тостом
  // «Готово!» и уходил отдавать его классу.
  if (!API_URL) {
    return wrapMock("NEXT_PUBLIC_API_URL не задан", mockFn, start, "no_backend");
  }
  throw new BackendError(
    503,
    "BACKEND_UNAVAILABLE",
    "Сервер не ответил — показать заготовку вместо листа мы не будем",
  );
}

/**
 * Признаки потерь материала (ТЗ-25).
 *
 * Зеркало `QualityLossInfo` с бэкенда. Клиент НИЧЕГО не досчитывает сам:
 * единственный честный источник — то, что вернул сервер, потому что фильтр и
 * дозапрос живут там.
 */
export interface QualityLoss {
  /** Сколько заданий просил учитель (с учётом числа вариантов). */
  requested: number;
  /** Сколько заданий в выданном материале. */
  delivered: number;
  /** Сколько выкинул фильтр качества. */
  dropped: number;
  /** Чем именно выкинул — номера заданий. */
  droppedPatternRef: number[];
  droppedForeignMath: number[];
  cleanedAnswer: number[];
  /** Сколько добрал дозапросом. */
  topUpAdded: number;
  /** Сколько не удалось добрать даже после дозапроса. */
  stillMissing: number;
  /** Фильтр сработал агрессивнее трети и был откачен целиком. */
  filterBackedOff: boolean;
  /**
   * Сколько пар повторяющихся заданий осталось в выдаче ПОСЛЕ чистки.
   * Ноль — повторов нет. Больше нуля — конвейер не смог убрать повтор и
   * говорит об этом прямо, вместо того чтобы отдать учителю лист, который
   * выглядит целым.
   */
  repeatedSkills: number;
  /**
   * Сколько заданий в выданном материале осталось БЕЗ ключа (ТЗ-32, AD-4).
   * Приходит с бэкенда, который считает это по финальному списку заданий.
   *
   * Необязательное поле: у ответа сервера, сохранённого в кэше до этой правки,
   * его просто нет, и это НЕ значит «учитель не увидит счётчика» — значит,
   * дописать счётчик для этого ответа нечем, и молчание тут уместно.
   */
  tasksWithoutAnswer?: number;
}

/**
 * Состояние вариантов контрольной (ТЗ-25).
 *
 * У обычного листа `expected = 1` и `degraded = false` — учитель листа не
 * должен видеть разговор про два варианта.
 */
export interface VariantStatus {
  expected: number;
  delivered: number;
  degraded: boolean;
  degradedReason?: string;
  retried: boolean;
}

export interface WorksheetClientResult {
  worksheet: Worksheet;
  /** Второй вариант КОНТРОЛЬНОЙ. `null` у остальных типов и для control, */
  /** если бэк вернул один вариант вместо двух. */
  secondVariant: Worksheet | null;
  /**
   * Признаки потерь. Приходят из кэша вместе с материалом, поэтому повторное
   * открытие показывает то же предупреждение и не тратит деньги (ТЗ-25, AD-4).
   */
  quality: QualityLoss;
  /** Сколько вариантов обещали, сколько пришло, деградировали ли. */
  variants: VariantStatus;
  source: "llm" | "mock";
  isDemo: boolean;
  /** Почему это заготовка (null у настоящего результата). */
  demoReason: DemoReason | null;
  costUsd: number;
  latencyMs: number;
}

export type LessonPlanClientResult = ArtifactResult<LessonPlan>;
export type PresentationClientResult = ArtifactResult<Presentation>;
export type KtpClientResult = ArtifactResult<Ktp>;
export type CardsClientResult = ArtifactResult<CardSet>;
export type MaterialsClientResult = ArtifactResult<MaterialBundle>;
export type BundleClientResult = ArtifactResult<LessonBundle>;

/**
 * Рабочий лист / тест / контрольная.
 *
 * Для КОНТРОЛЬНОЙ работы бэкенд отдаёт сразу два варианта одним вызовом
 * (09.10.2026) — второй лежит в `secondVariant`. Клиенту делать второй запрос
 * не нужно: это стоило бы второй попытки из трёх бесплатных.
 *
 * `opts.bypassCache` оставлен для ручной перегенерации с обходом кэша — сам
 * второй вариант через него больше не ходит.
 *
 * ТЗ-36: этим флагом пользуется кнопка «Новый вариант» — она обязана дать
 * НОВЫЙ материал, а не тот же, что лежит в кэше.
 */
export async function generateWorksheetSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<WorksheetClientResult> {
  const r = await smartGenerate<
    Worksheet,
    { secondVariant?: Worksheet | null; quality?: QualityLoss; variants?: VariantStatus }
  >(
    request,
    { endpoint: "worksheets", dataKey: "worksheet", bypassCache: opts?.bypassCache === true },
    () => mockWorksheet(request),
  );
  const isControl = request.type === "control";
  const secondVariant = r.extra?.secondVariant ?? null;

  // Признаки потерь приходят из ответа БЭКА. Значения по умолчанию — «ничего не
  // потеряно», и они НЕ выдумывают проблему: если сервер не прислал признаков,
  // мы показываем материал как есть.
  //
  // Для МОКА (бэк недоступен) потерь не было by construction — заготовка
  // ровно того размера, о котором попросили, — и `isDemo` у неё уже стоит.
  const quality: QualityLoss = r.extra?.quality ?? {
    requested: request.count * (isControl && secondVariant ? 2 : 1),
    delivered: r.data.tasks?.length ?? 0,
    dropped: 0,
    droppedPatternRef: [],
    droppedForeignMath: [],
    cleanedAnswer: [],
    topUpAdded: 0,
    stillMissing: 0,
    filterBackedOff: false,
    // Мок: повторов в нём быть не может by construction.
    repeatedSkills: 0,
    // Мок: ответы в заготовке есть (или учитель их не просил), без ключа лист
    // из мока не уезжает — иначе мы бы предупреждали о дефекте заготовки.
    tasksWithoutAnswer: 0,
  };
  const variants: VariantStatus = r.extra?.variants ?? {
    expected: isControl ? 2 : 1,
    delivered: secondVariant ? 2 : 1,
    // Деградацию заявляем ТОЛЬКО для контрольной: у листа вариантов нет, и
    // предупреждение «второй вариант не получился» было бы неверным.
    degraded: isControl && !secondVariant,
    degradedReason:
      isControl && !secondVariant ? "второй вариант не был получен" : undefined,
    retried: false,
  };

  return {
    worksheet: r.data,
    secondVariant,
    quality,
    variants,
    source: r.source,
    isDemo: r.isDemo,
    demoReason: r.demoReason,
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
  };
}

export async function generateLessonPlanSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<LessonPlanClientResult> {
  return smartGenerate<LessonPlan>(
    request,
    { endpoint: "lesson-plans", dataKey: "lessonPlan", bypassCache: opts?.bypassCache === true },
    () => mockLessonPlan(request),
  );
}

export async function generatePresentationSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<PresentationClientResult> {
  return smartGenerate<Presentation>(
    request,
    {
      endpoint: "presentations",
      dataKey: "presentation",
      bypassCache: opts?.bypassCache === true,
    },
    () => mockPresentation(request),
  );
}

export async function generateKtpSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<KtpClientResult> {
  return smartGenerate<Ktp>(
    request,
    { endpoint: "ktp", dataKey: "ktp", bypassCache: opts?.bypassCache === true },
    () => mockKtp(request),
  );
}

/**
 * TZ-16 §3.1: карточки. Эндпоинт бэка появится вместе с LLM-ранклером;
 * пока бэк его не отдаёт — `callBackend` вернёт null и сработает мок.
 */
export async function generateCardsSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<CardsClientResult> {
  return smartGenerate<CardSet>(
    request,
    { endpoint: "cards", dataKey: "cardSet", bypassCache: opts?.bypassCache === true },
    () => mockCards(request),
  );
}

/** TZ-16 §3.2: комплект материалов (словарь / справочник / раздатка). */
export async function generateMaterialsSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<MaterialsClientResult> {
  return smartGenerate<MaterialBundle>(
    request,
    {
      endpoint: "materials",
      dataKey: "materialBundle",
      bypassCache: opts?.bypassCache === true,
    },
    () => mockMaterials(request),
  );
}

/**
 * TZ-16 §3.4: «Урок целиком» — 4 артефакта одной темы.
 *
 * Эндпоинт `/api/bundles/generate` в этом ТЗ не создаётся (§11) — проверено на
 * боевом воркере: 404. Для этого типа заготовка и ЕСТЬ реализация, поэтому
 * `mockOnFailure` включён явно. Для всех остальных типов заготовка вместо
 * ответа сервера — враньё, и она запрещена (аудит 18.10.2026, BUG-018).
 *
 * Сама оркестрация 4 слотов лежит в моке (`buildLessonBundle`) и уже
 * параллельна — здесь мы её не дублируем.
 */
export async function generateBundleSmart(
  request: GenerationRequest,
  opts?: { bypassCache?: boolean },
): Promise<BundleClientResult> {
  return smartGenerate<LessonBundle>(
    request,
    {
      endpoint: "bundles",
      dataKey: "lessonBundle",
      mockOnFailure: true,
      bypassCache: opts?.bypassCache === true,
    },
    () => mockLessonBundle(request),
  );
}
