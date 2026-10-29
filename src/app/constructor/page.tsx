"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import { LessonPlanPreview } from "@/components/constructor/LessonPlanPreview";
import { PresentationPreview } from "@/components/constructor/PresentationPreview";
import { KtpPreview } from "@/components/constructor/KtpPreview";
import InteractivePreview from "@/components/constructor/InteractivePreview";
import { isInteractiveFormat } from "@/lib/interactives/formats";
import { createInteractive, type CreateInteractiveOk } from "@/lib/interactives/api";
import {
  DEFAULT_CONSTRUCTOR_FORMAT,
  constructorInteractiveOptions,
  interactiveCreateErrorMessage,
  interactivePlayPath,
} from "@/lib/construct/interactive";
import type { InteractiveFormat } from "@/lib/interactives/types";
import { CardsPreview } from "@/components/constructor/CardsPreview";
import { MaterialsPreview } from "@/components/constructor/MaterialsPreview";
import { LessonBundlePreview } from "@/components/constructor/LessonBundlePreview";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { ArtifactTypePicker, ARTIFACT_TYPE_OPTIONS } from "@/components/constructor/ArtifactTypePicker";
import { ArtifactTypePreview } from "@/components/constructor/ArtifactTypePreview";
import {
  PresetGrid,
  PRESETS,
  type Preset,
  type PresetMode,
} from "@/components/constructor/PresetGrid";
import {
  Sparkles,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Heart,
  Lock,
  RotateCcw,
  X,
  Camera,
  Send,
  LayoutTemplate,
} from "lucide-react";
import { subjects, getSubject, getGrade, getTopic } from "@/lib/content/subjects";
// ТЗ-26 Ф-3: ключ предмета (`algebra`) не должен попадать ни в имя файла,
// ни в шапку — там название по-русски из таксономии.
import { subjectDisplayName } from "@/lib/content/subject-display-name";
import { getUMK } from "@/lib/content/umk";
import {
  getExamSubjects,
  getExamNumbers,
  examNumberExists,
  type ExamSlug,
} from "@/lib/content/exam-numbers-stub";
import type {
  Difficulty,
  GenerationRequest,
  SubjectSlug,
  TaskType,
  UserHistoryItem,
  Worksheet,
  EvaluationPart,
  LessonPlan,
  Presentation,
  Ktp,
  CardSet,
  MaterialBundle,
  LessonBundle,
  Subject as SubjectType,
  Grade as GradeType,
} from "@/lib/types";
import { addToHistory, getHistory, saveFavorite, toggleFavorite, trackExamModeSelected } from "@/lib/utils/storage";
import {
  generateWorksheetSmart,
  generateLessonPlanSmart,
  generatePresentationSmart,
  generateKtpSmart,
  generateCardsSmart,
  generateMaterialsSmart,
  generateBundleSmart,
  BackendError,
  isTimeoutError,
  type QualityLoss,
  type VariantStatus,
  type DemoReason,
} from "@/lib/client/llm";
import { generateWorksheetDocx, downloadBlob } from "@/lib/utils/docx";
import { verifyWorksheetTasks, type VerifyProgress } from "@/lib/llm/verify-sheet";
import { trackEvent } from "@/lib/track";
import { saveTemplate } from "@/lib/lk/templates";
import { generateLessonPlanDocx } from "@/lib/utils/lesson-plan-docx";
import { generateCardsDocx } from "@/lib/utils/cards-docx";
import { printCards } from "@/lib/utils/cards-print";
import { generateMaterialsZip, materialsZipFilename } from "@/lib/utils/materials-zip";
import { generateBundleZip, bundleZipFilename, bundleReadyCount } from "@/lib/utils/bundle-zip";
import { generateKtpDocx } from "@/lib/utils/ktp-docx";
import { generatePptx, pptxFilename } from "@/lib/utils/pptx";
import { canGenerate, getRemaining, refund, settleGeneration } from "@/lib/utils/limit";
import { isTouchDevice, subscribeToDeviceChange } from "@/lib/utils/device";
import { FREE_GENERATIONS, PLANS, isPaidPlan, priceLabel } from "@/lib/content/plans";
import { plural, cn } from "@/lib/utils/cn";
import { pluralizeTasks, pluralizeFiles } from "@/lib/utils/cn";
import { saveWorksheet, type SaveWorksheetInput } from "@/lib/worksheets/api";
import { ShareFormDialog } from "@/components/teacher/ShareFormDialog";
import { toFormSourceTask } from "@/lib/forms/types";
import { getProfile } from "@/lib/utils/storage";
import { useUsage } from "@/lib/hooks/useUsage";
import { EditChat } from "@/components/f08/EditChat";
import { PhotoCheckPanel } from "@/components/f06/PhotoCheckPanel";
import { PhotoCheckEntry } from "@/components/f06/PhotoCheckEntry";
import { ControlVariantSwitch } from "@/components/constructor/ControlVariantSwitch";
import { QualityNoticeBanner } from "@/components/constructor/QualityNoticeBanner";
import { buildQualityNotice, type QualityNotice } from "@/lib/constructor/quality-notice";

/** F-04-C: режим wizard. «По теме» — текущий flow. «По номеру» — экзамен → предмет → номера → параметры. */
type Mode = "topic" | "exam";

/**
 * F-08 `EditChat` — заглушка чата AI-правок, реальной логики пока нет.
 * Показываем её (и кнопку «AI-правки») только под флагом: пользователю не
 * нужно видеть «EditChat (stub)» с полем «Stub input» и кнопкой «Send».
 * Включается переменной окружения `NEXT_PUBLIC_ENABLE_EDIT_CHAT=1`.
 */
const EDIT_CHAT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_EDIT_CHAT === "1";

/**
 * З1: окно «свежести» для восстановления листа после перезагрузки.
 * Восстанавливаем только то, что учительница делала в текущей сессии —
 * вчерашний лист из истории показывать не надо.
 */
const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * З8: сколько тем показываем до нажатия «Показать все».
 * Раньше список просто обрезался по высоте, а полосу прокрутки прятал
 * `scrollbar-hide` — учительница не видела, что список не кончился.
 */
const TOPICS_PREVIEW_COUNT = 6;

/**
 * Тарифы одним текстом для карточки лимита.
 * Берём из `plans.ts`, чтобы при смене цен карточка не расходилась
 * с тарифной страницей (план: единый источник цен).
 *
 * Единицу НЕ дописываем руками: `priceLabel()` уже отдаёт цену вместе с
 * единицей — «3 800 ₽ за учебный год (9 мес)» и «500 ₽ в месяц». Раньше шаблон
 * дописывал «за учебный год (9 мес)» вторым разом, и учитель читал
 * «3 800 ₽ за учебный год (9 мес) за учебный год (9 мес)». Слово «год» в
 * значении «годовая подписка» запрещено планом — поэтому только «учебный год»
 * (период обучения) и «в месяц»; слова «помесячно» в русском нет.
 */
const PLANS_TEXT =
  `Подписка ${PLANS.base.name} — ${priceLabel("base", "academicYear")} или ${priceLabel("base", "month")}. ` +
  `${PLANS.plus.name} — ${priceLabel("plus", "academicYear")} или ${priceLabel("plus", "month")}.`;

/**
 * Печатная вёрстка конструктора.
 *
 * Что было: на странице «Ответы и пояснения» учитель в диалоге печати получал
 * пункты меню сайта («Банк материалов», «ОГЭ / ЕГЭ», «Тарифы», «Войти»), а
 * слева строка обрезалась до «анк материалов». Печатные стили в проекте есть
 * только у карточек (`.cards-print-*` в `lib/utils/cards-print.ts`): общего
 * правила, прячущего шапку и подвал сайта, не было ни в одном режиме.
 *
 * Почему здесь, а не в `globals.css`: тот файл вне зоны этой правки. Приём
 * тот же, что у карточек — правила приезжают вместе со страницей.
 *
 * Правила работают во ВСЕХ режимах печати конструктора (рабочий лист с
 * ответами, карточки, план урока, презентация, КТП, материалы, урок целиком):
 * адресуем каркас страницы, а не конкретный тип листа.
 */
const CONSTRUCTOR_PRINT_CSS = `
@media print {
  /* 1. Служебное окружение сайта на печатном листе не нужно. Класс .no-print на
        шапке и подвале уже есть, но адресуем их ещё и структурно — печать
        идёт из разных режимов, и полагаться только на класс нельзя. */
  body > div > header,
  body > div > footer,
  .no-print {
    display: none !important;
  }
  /* 2. Печатаем только лист. Левая колонка мастера скрыта правилом выше,
        двухколоночная сетка схлопывается в одну, горизонтальные отступы
        контейнера снимаются: иначе лист печатался в узкой колонке и по краям
        обрезался. */
  .ctor-print-root {
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  .ctor-grid {
    display: block !important;
    gap: 0 !important;
  }
  .ctor-grid > * {
    width: 100% !important;
    max-width: none !important;
  }
}
`;

/**
 * Имя выгружаемого файла (ТЗ-26, Ф-3, 13.10.2026).
 *
 * БЫЛО: `${subject}-${grade}kl-${topic}.docx`, где `subject` — внутренний ключ.
 * Учитель получал файл `algebra-8kl-сокращение-и-действия.docx` и шапку
 * «algebra · 8 класс» — латиница в раздаточном материале.
 *
 * СТАЛО: название предмета по-русски из таксономии. Ключ остаётся ключом —
 * он нужен роутерам и запросам к бэку, но в имя файла и в шапку не попадает.
 *
 * Порядок важен: название предмета подставляется ДО нормализации, иначе
 * «Русский язык» превратится в «русский-язык» дефисами. Регистр приводится к
 * нижнему — так имена клеятся между собой и не отличаются регистром.
 *
 * `suffix` — необязательный хвост («plan», «ktp», «cards», «variant-2»).
 * Подставляется последним, чтобы не потеряться среди дефисов темы.
 */
function buildFilename(
  subjectSlug: string | null | undefined,
  grade: number,
  topic: string,
  suffix?: string,
): string {
  const parts = [
    subjectDisplayName(subjectSlug),
    `${grade}кл`,
    topic,
    ...(suffix ? [suffix] : []),
  ];
  return `${parts.join(" ")}.docx`.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Шаги визарда. topic-mode: 3 шага («select» = предмет+класс, «topic», «configure»).
 * UMK вынесено inline в шаг «topic» (см. TopicStep) — отдельной ступени больше нет.
 * exam-mode: 4 отдельных шага (выбор экзамена, предмета, номеров, настройки).
 */
type Step =
  | "select"
  | "topic"
  | "configure"
  | "exam-select"
  | "exam-subject"
  | "exam-number";

/**
 * TZ-16 §4.3 (точка 1): whitelist типов для deep-link `?type=`.
 *
 * Раньше это был инлайн-массив из 7 значений — любое новое значение `TaskType`
 * приходилось вспоминать здесь, иначе `?type=materials` молча игнорировался.
 * Теперь это единственный источник правды, и `satisfies` не даёт забыть
 * ни один тип: забытый ключ = ошибка компиляции.
 */
const DEEP_LINK_TYPES = [
  "worksheet",
  "test",
  "cards",
  "control",
  "lesson-plan",
  "presentation",
  "ktp",
  "oge",
  "ege",
  "materials",
  "lesson-bundle",
  "interactive",
  // Типа "image" здесь нет и не будет: генератора картинок у нас нет
  // (ТЗ-30 AD-4). В списке он означал, что учитель доходит до кнопки
  // «Создать» и получает отказ — обещание, которое продукт не держит.
] as const satisfies readonly TaskType[];

/**
 * TZ-16 §4.3 (точка 5): какой «вид» артефакта показывать для выбранного типа.
 *
 * КЛЮЧЕВОЙ РЕФАКТОРИНГ. Раньше `kind` выводился из «первого не-нуль»
 * (`worksheet ? "worksheet" : lessonPlan ? …`). Это работало только потому,
 * что `handleArtifactTypeChange` сбрасывал ВСЕ закэшированные артефакты при
 * смене типа. При 9 типах и параллельной генерации пакета одна забытая
 * ветка = показ чужого артефакта учителю. Теперь `kind` — чистая функция от
 * `type`, состояние на него не влияет.
 *
 * `test` / `control` / `oge` / `ege` — это `worksheet` с перепаковкой
 * заданий (Б-6 в TZ-16), поэтому все они дают вид «worksheet».
 * `cards` и `materials` (TZ-16 §3.1–3.2) — самостоятельные артефакты
 * со своими превью. Типы из Этапов 4–7 отдают `null`: артефакта для них
 * пока нет, и UI показывает placeholder, а не чужой результат.
 */
// Множества «типов без генератора» больше нет: последним в нём был «image»,
// а он снят с продукта (ТЗ-30 AD-4) — провайдера генерации картинок нет,
// а обещание «скоро будет» учителю ничего не объясняет. Все оставшиеся типы
// умеют генерироваться, и пустой список-заглушка был бы мёртвым кодом,
// мёртвым кодом, который в следующий раз притворялся бы проверкой.

function resultKindForType(type: TaskType): ResultKind | null {
  switch (type) {
    case "cards":
      return "cards";
    case "materials":
      return "materials";
    case "lesson-bundle":
      return "lesson-bundle";
    case "worksheet":
    case "test":
    case "control":
    case "oge":
    case "ege":
      return "worksheet";
    case "lesson-plan":
      return "lesson-plan";
    case "presentation":
      return "presentation";
    case "ktp":
      return "ktp";
    // Лист 4.1.1: интерактив стал обычным типом. Отдельный `kind` нужен,
    // чтобы НИЖЕ по общему блоку результата (заголовок + PDF/DOCX + печать)
    // для него ничего не рисовалось: у игры нет файла, который можно
    // скачать, зато есть ссылка и QR. Этими словами занят `InteractivePreview`.
    case "interactive":
      return "interactive";
  }
}

/** Вид артефакта, который умеет отрисовать текущий UI. */
type ResultKind =
  | "worksheet"
  | "lesson-plan"
  | "presentation"
  | "ktp"
  | "cards"
  | "materials"
  | "lesson-bundle"
  | "interactive";

/**
 * F-04-B: success-конфетти после удачной генерации.
 * ~80 частиц сверху страницы, ~1.2с (ticks ~75 × 16мс).
 * Dynamic import — SSR-safe: canvas-confetti трогает window/canvas, не годится для server-render.
 */
async function fireConfetti() {
  if (typeof window === "undefined") return;
  // Конфетти — это сильное движение, причём ровно в момент первого
  // результата, поэтому ради него «меньше движения» и не выключают.
  // Проверка здесь единственная: других мест вызова нет, все проходят
  // через эту функцию. Проверяем до импорта, чтобы не грузить модуль.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    confetti({
      particleCount: 80,
      spread: 70,
      startVelocity: 32,
      gravity: 0.85,
      ticks: 75,
      origin: { x: 0.5, y: 0 },
      // Бренд-палитра из tailwind.config.ts + персиковый акцент.
      colors: ["#22B37C", "#46CB97", "#FF5E2E", "#FFA688", "#FFD8C2"],
      scalar: 0.9,
    });
  } catch (err) {
    // Не критично — просто пропускаем визуал, генерация уже успешна.
    console.warn("[confetti] skipped:", err);
  }
}

type ArtifactKind =
  | "worksheet"
  | "lesson-plan"
  | "presentation"
  | "ktp"
  | "cards"
  | "materials"
  | "lesson-bundle";

/**
 * З1: определяем тип артефакта из его содержимого.
 *
 * Discriminator-поля те же, что и в `utils/storage.ts`:
 *   Worksheet → `tasks`, LessonPlan → `stages`, Presentation → `slides`, Ktp → `weeks`.
 * Нужен, чтобы (а) не восстановить КТП в слот рабочего листа и (б) понять,
 * в какой state класть восстановленное.
 */
function artifactKindOf(artifact: UserHistoryItem["artifact"]): ArtifactKind | null {
  if (!artifact || typeof artifact !== "object") return null;
  const a = artifact as unknown as Record<string, unknown>;
  if (Array.isArray(a.tasks)) return "worksheet";
  if (Array.isArray(a.stages)) return "lesson-plan";
  if (Array.isArray(a.slides)) return "presentation";
  if (Array.isArray(a.weeks)) return "ktp";
  // TZ-16 §3.1: у карточек поле `cards`, у материалов — `files`.
  // Проверка порядка важна: у карточек нет ни tasks/stages/slides/weeks,
  // а у материалов — только `files`, так что коллизий нет.
  if (Array.isArray(a.cards)) return "cards";
  if (Array.isArray(a.files)) return "materials";
  // TZ-16 §3.4: у пакета «урок целиком» обязательное поле `failed`
  // (список неудачных слотов) — оно есть даже при полном успехе, поэтому
  // Array.isArray, а не проверка на непустоту. Проверка идёт последней:
  // LessonBundle не содержит tasks/stages/slides/weeks/cards/files.
  if (Array.isArray(a.failed)) return "lesson-bundle";
  return null;
}

/** `TaskType`/`"exam"` из записи истории → наш внутренний `ArtifactKind`. */
function historyTypeToKind(type: UserHistoryItem["type"]): ArtifactKind | null {
  if (type === "lesson-plan" || type === "presentation" || type === "ktp") return type;
  // TZ-16: cards и materials — самостоятельные артефакты, а не рабочий лист.
  if (type === "cards") return "cards";
  if (type === "materials") return "materials";
  if (type === "lesson-bundle") return "lesson-bundle";
  // worksheet / test / control / oge / ege → это рабочий лист.
  return "worksheet";
}

export default function ConstructorPage() {
  const [step, setStep] = React.useState<Step>("select");
  const [subject, setSubject] = React.useState<SubjectSlug | null>(null);
  const [grade, setGrade] = React.useState<number | null>(null);
  const [umk, setUmk] = React.useState<string | null>(null);
  const [topic, setTopic] = React.useState<string | null>(null);
  const [type, setType] = React.useState<TaskType>("worksheet");
  const [difficulty, setDifficulty] = React.useState<Difficulty>("medium");
  const [count, setCount] = React.useState<number>(10);
  const [withAnswers, setWithAnswers] = React.useState(true);
  const [withExplanations, setWithExplanations] = React.useState(true);

  // Номер варианта для подписи результата УДАЛЁН (08.10.2026).
  //
  // Здесь стоял `Math.random()`: для обычного листа это давало «Вариант 7» в
  // подписи к одному-единственному листу, а для контрольной — ровно то, на
  // что пожаловалась учительница: один сгенерированный вариант с подписью
  // «вариант 4». Случайное число не является ничем, кроме шума.
  //
  // Теперь номер варианта настоящий: у контрольной генерируются два листа
  // (`controlVariant2`), а подпись показывает выбранный (`controlVariant`).
  // У остальных типов варианта нет — и подписи тоже нет.

  // F-02 (Q4 2026): режим выбора параметров на шаге 1.
  // template = сетка из 5 preset-карточек, custom = пойти к теме и настроить параметры вручную.
  const [presetMode, setPresetMode] = React.useState<PresetMode>("template");
  // Запоминаем выбранный preset — чтобы при возврате с шага «Тема» подсветить карточку.
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(null);
  // Тип работы в режиме «Свой вариант» — по умолчанию worksheet.
  const [customType, setCustomType] = React.useState<TaskType>("worksheet");

  /** F-04-C: режим wizard. «По теме» — старый flow, «По номеру» — экзамен-флоу. */
  const [mode, setMode] = React.useState<Mode>("topic");
  /** F-04-C: какой экзамен выбран (только если mode === "exam"). */
  const [exam, setExam] = React.useState<ExamSlug | null>(null);
  /** F-04-C: предмет экзамена (только если mode === "exam"). */
  const [examSubject, setExamSubject] = React.useState<SubjectSlug | null>(null);
  /** F-04-C: выбранные номера (multi-select). */
  const [examNumbers, setExamNumbers] = React.useState<number[]>([]);

  const [generating, setGenerating] = React.useState(false);
  const [worksheet, setWorksheet] = React.useState<Worksheet | null>(null);
  /**
   * Второй вариант КОНТРОЛЬНОЙ работы (08.10.2026).
   *
   * Раньше контрольная делалась в один лист, а подпись «вариант N» бралась из
   * `Math.random()` — учительница получила один вариант с надписью «вариант 4».
   * Теперь это два настоящих листа, и `controlVariant` выбирает, какой показан.
   *
   * ВАЖНО: `worksheet` — это ЛИСТ, КОТОРЫЙ СЕЙЧАС НА ЭКРАНЕ, а не «вариант 1».
   * Первый вариант лежит отдельно в `controlVariant1`. Если бы переключатель
   * брал вариант 1 из `worksheet`, то клик «Вариант 2» записал бы второй лист
   * в `worksheet`, и возврат к первому стал бы невозможен: `worksheet` уже
   * перезаписан. Учитель видел бы подпись «Вариант 1» с содержимым варианта 2 —
   * то есть ровно тот дефект, который мы чиним.
   */
  const [controlVariant1, setControlVariant1] = React.useState<Worksheet | null>(null);
  const [controlVariant2, setControlVariant2] = React.useState<Worksheet | null>(null);
  const [controlVariant, setControlVariant] = React.useState<1 | 2>(1);
  /** TZ-12: название выбранного шаблонного пресета — для подписи в ConfigureStep. */
  const selectedPresetTitle = React.useMemo(
    () => (selectedPresetId ? PRESETS.find((p) => p.id === selectedPresetId)?.title ?? null : null),
    [selectedPresetId],
  );
  /** Q1-2027: state для новых типов артефактов. */
  const [lessonPlan, setLessonPlan] = React.useState<LessonPlan | null>(null);
  const [presentation, setPresentation] = React.useState<Presentation | null>(null);
  const [ktp, setKtp] = React.useState<Ktp | null>(null);
  // TZ-16 §3.1–3.2: карточки и комплект материалов — отдельные артефакты.
  const [cardSet, setCardSet] = React.useState<CardSet | null>(null);
  const [materialBundle, setMaterialBundle] = React.useState<MaterialBundle | null>(null);
  // TZ-16 §3.4: «Урок целиком» — комплект из 4 артефактов, заполняется частично.
  const [lessonBundle, setLessonBundle] = React.useState<LessonBundle | null>(null);
  /**
   * Правда о последнем материале: он пришёл из LLM или это типовая заготовка.
   *
   * Раньше флаг `isDemo` возвращался из `client/llm.ts`, но в интерфейс не
   * попадал вообще: при сбое бэка учитель получал шаблон с конфетти и тостом
   * «Готово примерно за минуту» и не знал, что AI не отвечал. Для сервиса, который живёт
   * на доверии, молчаливая подмена — самая дорогая ошибка: такой лист учитель
   * отдаёт ученикам.
   *
   * Теперь заготовка всегда помечена, а рядом стоит кнопка «Повторить».
   */
  const [isDemoResult, setIsDemoResult] = React.useState(false);
  /**
   * Почему последний результат — заготовка (аудит 18.10.2026, BUG-018).
   *
   * Раньше интерфейс говорил «Сервис сейчас недоступен» даже когда сервис был
   * на месте, а тип материала просто не имеет серверного эндпоинта. Причина
   * нужна, чтобы банн��р и тост не врали по-разному.
   */
  const [demoReason, setDemoReason] = React.useState<DemoReason | null>(null);
  const [remaining, setRemaining] = React.useState<number>(3);
  const [showPaywall, setShowPaywall] = React.useState(false);
  /**
   * ТЗ-25 (AD-7): что потерялось при генерации — учитель видит это НА ЭКРАНЕ.
   *
   * Раньше укороченный материал и деградировавший второй вариант были молчаливы:
   * учитель просил 15 заданий, получал 11 и узнавал об этом, только пересчитав
   * дома. Здесь держим честные признаки ответа API и рисуем предупреждение.
   *
   * `null` = потерь не было, блок не рисуется. Важно: отсутствие признака НЕ
   * значит «всё хорошо» в том смысле, что сервер их не прислал бы при старом
   * коде; теперь он присылает их всегда (см. routes/worksheets.ts).
   */
  const [qualityNotice, setQualityNotice] = React.useState<QualityNotice | null>(null);
  /**
   * ТЗ-34: критерии оценивания и шкала отметок.
   *
   * Приходят из ответа API отдельным ключом `evaluation`: один блок для листа
   * и теста, два для контрольной (по вариантам). Едут в печать и в превью.
   *
   * Для обычного рабочего листа массив пустой — лист учитель раздаёт, а не
   * оценивает, и страницы критериев у него нет.
   */
  const [evaluation, setEvaluation] = React.useState<EvaluationPart[]>([]);
  /**
   * F-05: прогресс проверки ответов по кнопке.
   *
   * Проверка идёт последовательно, по одному заданию (5–20 с на задание), и
   * учитель запускает её сам — автоматически она не запускалась НИКОГДА
   * (см. docs/25-audit-llm-verification-2026-10-06.md, BL-01). Состояние
   * живёт здесь, а не в модалке, чтобы прогресс был виден рядом с листом.
   */
  const [verifyProgress, setVerifyProgress] = React.useState<VerifyProgress | null>(null);
  /** Отмена текущего прогона проверки (кнопка «Остановить»). */
  const verifyAbortRef = React.useRef<AbortController | null>(null);

  /**
   * BL-05: клик по типу, который сервер ещё не умеет собирать.
   *
   * Тип помечен в выборе, но нажать его можно — раньше это приводило к тому,
   * что учитель получал типовую заготовку и терял попытку. Теперь вместо
   * молчаливой подмены показываем объяснение: тип готовим, можно выбрать
   * «Лист» или «Тест».
   */
  React.useEffect(() => {
    const onNotReady = (e: Event) => {
      const typeId = (e as CustomEvent<{ type: string }>).detail?.type ?? "";
      const label = ARTIFACT_TYPE_OPTIONS.find((o) => o.id === typeId)?.label ?? "Этот тип";
      toast({
        tone: "error",
        title: `${label} пока не готовится на сервере`,
        description:
          "Мы ещё делаем этот тип материала. Пока доступны «Лист», «Тест» и «Контрольная» — они собираются полностью.",
      });
    };
    window.addEventListener("uc:artifact-type-not-ready", onNotReady);
    return () => window.removeEventListener("uc:artifact-type-not-ready", onNotReady);
  }, []);
  /** F-06: видна ли inline-панель проверки фото тетради (только worksheet). */
  const [photoCheckOpen, setPhotoCheckOpen] = React.useState(false);
  /**
   * Жалоба 1 (12.10.2026): учитель нажимает «Попробовать» на карточке
   * «Проверка работ по фото» и попадает в генератор.
   *
   * Причина была не в ссылке: правая колонка с экраном входа скрыта
   * условием `step === "select"`, а первый экран генератора — это как раз
   * шаг «select». Экран входа физически не мог появиться раньше, чем
   * учитель сам выберет предмет, класс и сценарий.
   *
   * Теперь на первом экране колонка с формой убирается, а вход занимает
   * всю ширину — учитель сразу видит то, куда пришёл. Этот флаг отличает
   * «только что пришёл с карточки» от «уже нажал Сделать лист»: во втором
   * случае генератор должен вернуться на первый экран.
   */
  const [photoCheckLanded, setPhotoCheckLanded] = React.useState(false);
  /** TZ-12: открыта ли модалка «Выдать классу». */
  const [shareFormOpen, setShareFormOpen] = React.useState(false);
  /**
   * TZ-12: `worksheetId`, под которым лист сохранился на сервере.
   * Нужен, чтобы `POST /api/assignments/forms` снял снимок заданий сам.
   * Пока `saveWorksheet` не ответил — `null`, тогда в модалку уходит снимок
   * `tasks[]` напрямую (этот же путь работает для листов до логина).
   */
  const [savedWorksheetId, setSavedWorksheetId] = React.useState<string | null>(null);
  // TZ-13: формат игры, выбранный в блоке «Оживить урок» (?interactiveFormat=).
  // null = учитель в конструкторе не про интерактив, обычный флоу листа.
  const [interactiveFormat, setInteractiveFormat] = React.useState<InteractiveFormat | null>(null);

  /**
   * Лист 4.1.1: собранная игра и текст последней ошибки сборки.
   *
   * Ошибка живёт именно текстом, а не кодом: учителю показываем слова, в
   * которых сказано, что делать (войти / подождать / попробовать позже), а не
   * «что-то сломалось». Сборка идёт на бэке отдельным запросом, поэтому здесь
   * не нужен ни `generating`, ни общий progress-UI — у панели своя надпись
   * «Собираем… 20–40 секунд».
   */
  const [interactive, setInteractive] = React.useState<CreateInteractiveOk | null>(null);
  const [interactiveError, setInteractiveError] = React.useState<string | null>(null);
  const [buildingInteractive, setBuildingInteractive] = React.useState(false);
  /**
   * Что именно происходит во время сборки: «Делаем лист…», «Сохраняем лист…»,
   * «Собираем игру…». Без этого панель минуту показывает одно «Собираем…», а
   * без листа это ДВА вызова модели — учитель должен видеть, что процесс идёт,
   * а не что кнопка зависла.
   */
  const [interactiveStage, setInteractiveStage] = React.useState<string | null>(null);
  /** Лист сохраняется на сервере прямо сейчас (обычно пара секунд). */
  const [savingWorksheet, setSavingWorksheet] = React.useState(false);
  /**
   * Обработчик сборки, который регистрирует `InteractivePreview`.
   *
   * Нужен для одной ситуации: кнопка «Создать» в параметрах на этом типе не
   * рисуется (её место — в панели игры), но `generate()` может быть вызван из
   * других мест. Чтобы такой вызов не кончался заглушкой, он уходит в тот же
   * сборщик. `null` = панель не смонтирована, тогда показываем честный тост.
   */
  const interactiveBuildRef = React.useRef<(() => void) | null>(null);
  /**
   * Сохранение листа, которое уже идёт.
   *
   * Нужно, чтобы «Собрать игру» во время фонового сохранения не слал второе
   * сохранение: учитель переключился на интерактив через секунду после листа и
   * нажал кнопку — без этого в базе появилось бы два одинаковых листа, а
   * второй считался бы мусором в кабинете. Сборщик дожидается этого промиса и
   * берёт его id.
   */
  const pendingSaveRef = React.useRef<
    Promise<{ ok: boolean; worksheetId?: string; error?: string }> | null
  >(null);
  /**
   * Формат игры по умолчанию. `interactiveFormat` приходит из deep-link
   * (`?interactiveFormat=`), поэтому в конструкторе без ссылки берём первый
   * формат реестра — тот же, что советует сервер для первого показа.
   */
  const activeInteractiveFormat: InteractiveFormat = interactiveFormat ?? DEFAULT_CONSTRUCTOR_FORMAT;
  /**
   * Стабильный обработчик регистрации сборщика для панели игры.
   *
   * Без `useCallback` стрелка менялась бы на каждом рендере, и эффект
   * регистрации в панели перезапускался бы на каждом рендере — работать
   * корректно, но дёргаться лишний раз при каждом вводе.
   */
  const registerInteractiveBuild = React.useCallback((fn: (() => void) | null) => {
    interactiveBuildRef.current = fn;
  }, []);
  /**
   * TZ-12: залогинен ли учитель — для кнопки «Выдать классу».
   * Сначала `false`, потом синхронизируем в effect: `getProfile()` читает
   * localStorage, а на пререндере (output: "export" собирает клиентские
   * компоненты на сервере) профиля ещё нет. Пока `profileChecked === false`,
   * кнопку не рисуем вовсе — иначе на гидрации «Войдите» мигнёт поверх
   * настоящего состояния.
   */
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const [profileChecked, setProfileChecked] = React.useState(false);

  React.useEffect(() => {
    setIsLoggedIn(Boolean(getProfile()));
    setProfileChecked(true);
  }, []);
  /**
   * W1+п.2: useUsage — серверный счётчик генераций на сегодня для залогиненных.
   * Для анонимных юзеров usage = null; UI fallback'ится на localStorage (`limit.ts`).
   * После успешного `saveWorksheet({ok:true})` дёргаем `refreshUsage()` чтобы
   * виджет обновился без перезагрузки.
   *
   * Виджет лимита ниже использует `serverUsage` если он есть, иначе `remaining`
   * из localStorage. Один источник правды для UI без дублирования логики.
   */
  const { usage: serverUsage, refresh: refreshUsage } = useUsage();
  /** F-04-B: стадии progress-UI при генерации. null = не показываем прогресс. */
  const [progressStage, setProgressStage] = React.useState<
    "selecting" | "verifying" | "formatting" | "done" | null
  >(null);

  const { toast } = useToast();

  /**
   * З3/З4: тач-устройство или десктоп. На таче главная кнопка экспорта —
   * «Сохранить в PDF», а DOCX не предлагается вообще.
   *
   * Начальное значение `false` (десктоп) нужно для SSR: проект собирается как
   * static export, и на сервере `window` нет. На клиенте эффект ниже
   * пересчитывает значение сразу после монтирования.
   */
  const [isTouch, setIsTouch] = React.useState(false);
  React.useEffect(() => {
    setIsTouch(isTouchDevice());
    // Подписка нужна на случай смены типа устройства (iPad подключили к
    // монитору, окно перетащили на узкий экран).
    return subscribeToDeviceChange(setIsTouch);
  }, []);

  /**
   * З1: восстановление последнего артефакта после перезагрузки.
   *
   * Самая дорогая жалоба: учительница обновила страницу (на iPad это ещё и
   * pull-to-refresh) и потеряла и сам лист, и потраченную попытку. Лист жил
   * только в React-стейте, а в историю попадали метаданные.
   *
   * Теперь в 5 последних записях истории лежит сам артефакт
   * (`UserHistoryItem.artifact`), поэтому после перезагрузки мы достаём
   * самый свежий (окно 2 часа) и кладём обратно в state.
   */
  const restoredRef = React.useRef(false);
  React.useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === "undefined") return;

    // Deep-link (?subject=/?topic=/?exam=) — пользователь САМ пришёл собирать
    // новый лист, восстановление старого только сбило бы его с толку.
    // Query читаем из window.location, а не через useSearchParams: хук требует
    // границы <Suspense> при `output: "export"`, а она прятала бы за fallback
    // весь контент страницы на время гидратации (3–4 секунды «Загрузка…»).
    const params = new URLSearchParams(window.location.search);
    const hasDeepLink =
      !!params.get("exam") ||
      !!params.get("topic") ||
      !!params.get("subject");
    if (hasDeepLink) return;

    const now = Date.now();
    // История отсортирована новыми сверху, поэтому берём первую подходящую.
    const candidate = getHistory().find((item) => {
      if (!item.artifact) return false;
      // ЗАГОТОВКУ НЕ ВОССТАНАВЛИВАЕМ (аудит 18.10.2026, BUG-019).
      //
      // Раньше любую запись истории можно было восстановить, и учитель после
      // неудачной генерации видел тост «Лист восстановлен — генерация не
      // потерялась» и типовой лист на экране. Генерация-то как раз ПОТЕРЯЛАСЬ:
      // её не было, был 409 и подставленная заготовка.
      //
      // Новые заготовки в историю уже не попадают (см. addToHistory выше), но
      // старые могут лежать в localStorage — их тоже пропускаем.
      if ((item.artifact as { isDemo?: boolean }).isDemo === true) return false;
      const age = now - new Date(item.createdAt).getTime();
      if (!Number.isFinite(age) || age > RESTORE_WINDOW_MS || age < 0) return false;
      // Тип в истории должен совпадать с типом самого артефакта — иначе это
      // битая запись, и класть её в state опасно.
      return historyTypeToKind(item.type) === artifactKindOf(item.artifact);
    });

    const kind = candidate ? artifactKindOf(candidate.artifact) : null;
    if (!candidate || !kind) return;

    switch (kind) {
      case "worksheet":
        setWorksheet(candidate.artifact as Worksheet);
        break;
      case "lesson-plan":
        setLessonPlan(candidate.artifact as LessonPlan);
        break;
      case "presentation":
        setPresentation(candidate.artifact as Presentation);
        break;
      case "ktp":
        setKtp(candidate.artifact as Ktp);
        break;
      case "cards":
        setCardSet(candidate.artifact as CardSet);
        break;
      case "materials":
        setMaterialBundle(candidate.artifact as MaterialBundle);
        break;
      case "lesson-bundle":
        setLessonBundle(candidate.artifact as LessonBundle);
        break;
    }

    // Восстанавливаем и контекст подбора, чтобы «Новый вариант» и правки
    // работали сразу, без повторного выбора предмета/класса/темы.
    setSubject(candidate.subject);
    if (typeof candidate.grade === "number") setGrade(candidate.grade);
    const restoredTopic = (candidate.artifact as { topic?: string }).topic;
    if (restoredTopic) setTopic(restoredTopic);
    // Ставим исходный TaskType (например «test» или «control»), а не только
    // «worksheet» — иначе подпись в превью была бы неверной.
    setType(candidate.type as TaskType);
    // Шаг «Параметры» — единственный, где preview с артефактом виден
    // справа (на шаге «Что» правая колонка скрыта).
    setStep("configure");

    toast({
      tone: "info",
      title: "Лист восстановлен",
      description: "Вот ваши PDF и DOCX — генерация не потерялась",
    });
    // (Заготовки сюда не попадают: см. фильтр выше — иначе тост врал бы.)
    trackEvent("constructor_artifact_restored", { kind, id: candidate.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init: подтянуть query params из SEO-страниц тем + лимит
  React.useEffect(() => {
    setRemaining(getRemaining());

    // F-06.1: deep-link `?photo=1` — точка входа из ЛК и с лендинга.
    // Раскрывает секцию проверки сразу, как только появится лист. Сама панель
    // рендерится только для `kind === "worksheet"`, поэтому флаг безопасен и
    // до генерации: лишнего ничего не будет на экране.
    // Читаем query один раз на маунте. Раньше здесь был `useSearchParams()`, но
    // он требовал <Suspense> при статическом экспорте, и fallback закрывал
    // собой всю страницу, пока грузится JS. `window.location.search` читается
    // уже после гидратации, поэтому эффект срабатывает ровно один раз.
    const params = new URLSearchParams(window.location.search);

    if (params.get("photo") === "1") setPhotoCheckOpen(true);

    // TZ-13 §4.9: приход из блока «Оживить урок» на экране листа.
    // Раньше параметр отправлялся, но здесь не читался — учитель выбирал
    // формат и попадал в обычную форму листа, то есть выбор молча терялся.
    // Лист 4.1.1: формат доезжает до панели игры в правой колонке, там же
    // выбор преселектом. Шаг НЕ переключаем здесь: ниже тот же эффект разбирает
    // `?subject=&grade=&topic=` и сам решает, куда идти — с готовой темой сразу
    // в «Параметры», без темы на экран выбора темы. Раньше здесь стоял безусловный
    // `setStep("configure")`, и ссылка без предмета приводила на пустую форму,
    // где сборка упиралась в «нет предмета».
    const formatParam = params.get("interactiveFormat");
    if (formatParam && isInteractiveFormat(formatParam)) {
      setInteractiveFormat(formatParam);
      setType("interactive");
    }

    // F-04-C: deep-link для режима «По номеру ОГЭ/ЕГЭ».
    // Имеет приоритет над topic-флоу, т.к. `?exam=` — это маркер экзамен-режима.
    const examParam = params.get("exam");
    if (examParam === "oge" || examParam === "ege") {
      const subjParam = params.get("subject") as SubjectSlug | null;
      const numParam = Number(params.get("number"));
      const subjValid = !!(subjParam && getSubject(subjParam));
      const numValid = !Number.isNaN(numParam) && numParam > 0;

      // Edge case: если subject/number невалидны — сбрасываем на шаг 1 экзамен-флоу.
      if (subjValid && numValid && examNumberExists(examParam, subjParam!, numParam)) {
        setMode("exam");
        trackExamModeSelected("exam");
        setExam(examParam);
        setExamSubject(subjParam);
        setExamNumbers([numParam]);
        setStep("exam-number");
      } else {
        setMode("exam");
        trackExamModeSelected("exam");
        setExam(null);
        setExamSubject(null);
        setExamNumbers([]);
        setStep("exam-select");
      }
      return;
    }

    // Старый topic-флоу: ?subject=&grade=&topic=&difficulty=&count=&type=
    const s = params.get("subject") as SubjectSlug | null;
    const g = Number(params.get("grade"));
    const t = params.get("topic");
    const d = params.get("difficulty") as Difficulty | null;
    const c = Number(params.get("count"));
    const ty = params.get("type") as TaskType | null;
    if (s && getSubject(s)) {
      setSubject(s);
      // КЛАСС ПРОВЕРЯЕМ ПО КАТАЛОГУ (аудит 18.10.2026, BUG-030).
      //
      // Раньше проверялось только «число больше нуля», поэтому ссылка
      // `?subject=math&grade=99` приводила в тупик: на экране было
      // «Готовы сгенерировать математику 99 класса» и «Завершите выбор темы»,
      // а списка тем и кнопки перехода не было. Выйти можно было только
      // через «Сначала».
      const gradeExists = !Number.isNaN(g) && g > 0 ? Boolean(getGrade(s, g)) : false;
      const validGrade = gradeExists ? g : null;
      if (validGrade) setGrade(validGrade);
      // ТЕМУ ИЗ ССЫЛКИ ТОЖЕ ПРОВЕРЯЕМ (аудит 18.10.2026, BUG-029).
      //
      // Раньше стояло `if (t) setTopic(t)` — без сверки с каталогом. Карточка
      // с главной «Неравенства и системы» присылала `topic=neravenstva`, а
      // валидный идентификатор — `m-neravenstva-9`; выдуманная тема
      // `nesushchestvuyushchaya-tema` тоже уходила в запрос как есть. Учитель
      // при этом видел только плашку «Алгебра · 9 кл» и не понимал, что
      // ему собирают.
      const topicExists = Boolean(t && validGrade && getTopic(s, validGrade, t));
      if (topicExists) setTopic(t);
      if (d && ["easy", "medium", "hard"].includes(d)) setDifficulty(d);
      if (!Number.isNaN(c) && c >= 5 && c <= 30) setCount(c);
      // TZ-16: whitelist расширен на 4 новых типа из TaskType. Deep-link
      // `?type=materials` (и lesson-bundle / interactive) больше не
      // игнорируется молча. Тип `image` из whitelist убран (ТЗ-30 AD-4):
      // ссылка с таким `type=` молча уводила учителя на тип по умолчанию,
      // то есть обещала картинку, а рисовала рабочий лист.
      if (ty && DEEP_LINK_TYPES.includes(ty)) setType(ty);
      // Deep-link → перескакиваем максимально далеко.
      // UMK больше не отдельный шаг — оно inline в TopicStep (если опций > 1) или auto-pick (если 1).
      if (topicExists) {
        setStep("configure");
      } else if (t && validGrade) {
        // Тема в ссылке есть, но её нет в каталоге. Молча уводить в «параметры»
        // нельзя — учитель думал бы, что ему собирают именно её. Ведём на
        // выбор темы и говорим, что такой темы нет.
        toast({
          tone: "info",
          title: "Такой темы нет",
          description: "Выберите тему из списка — по ссылке мы её не нашли",
        });
        const subj = getSubject(s);
        const umkList = subj ? getUMK(s, validGrade) : [];
        if (umkList.length === 1) setUmk(umkList[0].id);
        setStep("topic");
      } else if (validGrade) {
        // Auto-pick UMK, если только один вариант — UI в TopicStep всё равно подсветит выбор.
        const subj = getSubject(s);
        const umkList = subj ? getUMK(s, validGrade) : [];
        if (umkList.length === 1) setUmk(umkList[0].id);
        setStep("topic");
      } else {
        // Класса из ссылки не существует (или он не выбран) — отправляем
        // учителя на первый шаг, где можно выбрать и класс, и предмет.
        if (!Number.isNaN(g) && g > 0) {
          toast({
            tone: "info",
            title: "Такого класса нет",
            description: "Выберите предмет и класс — по ссылке мы их не нашли",
          });
        }
        setStep("select");
      }
    }
  }, []);

  const subjectData = subject ? getSubject(subject) : null;
  const gradeData = subject && grade ? getGrade(subject, grade) : null;

  const reset = () => {
    setStep("select");
    setSubject(null);
    setGrade(null);
    setUmk(null);
    setTopic(null);
    setType("worksheet");
    setDifficulty("medium");
    setCount(10);
    setWorksheet(null);
    setLessonPlan(null);
    setPresentation(null);
    setKtp(null);
    setCardSet(null);
    setMaterialBundle(null);
    setLessonBundle(null);
    setPhotoCheckOpen(false);
    // Лист 4.1.1: игра и её серверный id — часть работы, «Сначала» обнуляет
    // её вместе с листом.
    setInteractive(null);
    setInteractiveError(null);
    setSavedWorksheetId(null);
    // F-04-C: сброс экзамен-флоу.
    setExam(null);
    setExamSubject(null);
    setExamNumbers([]);
    // F-02: сброс выбора preset'а.
    setSelectedPresetId(null);
    setPresetMode("template");
    setCustomType("worksheet");
  };

  // F-02: выбор шаблонного preset'а. Заполняем параметры и переходим на шаг «Тема».
  // Событие `trackPresetSelected` уже пишется внутри PresetGrid.handleSelect.
  const handleSelectPreset = (preset: Preset) => {
    setSelectedPresetId(preset.id);
    setPresetMode("template");
    setCount(preset.count);
    setDifficulty(preset.difficulty);
    setType(preset.type);
    if (preset.withAnswers !== undefined) setWithAnswers(preset.withAnswers);
    if (preset.withExplanations !== undefined) setWithExplanations(preset.withExplanations);
    // Синхронизируем customType — если юзер переключится на «Свой», тип подхватится.
    setCustomType(preset.type);
    // Параметры выставлены — переходим к выбору темы.
    setStep("topic");
  };

  // F-02: режим «Свой вариант» → пропускаем заполнение параметров, тема и настройка дальше.
  const handleSkipPresetToTopic = () => {
    setSelectedPresetId(null);
    setStep("topic");
  };

  // F-02: смена типа в режиме «Свой вариант» — лимит мы не держим тут, тип применится на configure.
  const handleCustomTypeChange = (t: TaskType) => {
    setCustomType(t);
    setType(t);
  };

  // F-02: возврат с шага «Сценарий» к выбору предмета/класса (сбрасывает только выбор preset'а,
  // subject/grade остаются — пользователь может поменять их через SelectStep-кнопки).
  const handleBackFromPresets = () => {
    setSelectedPresetId(null);
    setPresetMode("template");
  };

  /**
   * TZ-4 (QA-аудит 2026-09-30): смена таба типа артефакта в ConfigureStep.
   *
   * Раньше тернарник на стр. 866-867 выбирал `kind` по принципу «первый не-нуль», поэтому
   * сгенерированный worksheet висел в preview даже после клика на «Презентация» /
   * «План урока» / «КТП» — таб переключался, а превью не реагировало.
   *
   * Решение — при user-initiated смене типа сбрасывать закэшированные артефакты,
   * чтобы `kind`-логика ниже нашла нужный preview, а пользователь увидел placeholder
   * с `TYPE_PREVIEW[type]`. Сброс через явный callback (а не useEffect на [type]) —
   * чтобы не триггериться при initial mount / preset / reset, где preview и так null.
   */
  const handleArtifactTypeChange = React.useCallback((next: TaskType) => {
    setType(next);
    setWorksheet(null);
    setLessonPlan(null);
    setPresentation(null);
    setKtp(null);
    setCardSet(null);
    setMaterialBundle(null);
    setLessonBundle(null);
    setPhotoCheckOpen(false);
    // Лист 4.1.1: собранная игра привязана к листу И формату, поэтому при
    // смене типа она не должна оставаться на экране — учитель поменял тип и
    // увидел бы чужую ссылку с QR. Ошибку тоже сбрасываем: её текст был
    // прошлую попытку, а не текущий экран.
    if (next !== "interactive") {
      setInteractive(null);
      setInteractiveError(null);
    }
    // Лист убран → серверный id от другого листа больше не годится: ранклер
    // прочитал бы из базы чужие задания.
    setSavedWorksheetId(null);
  }, []);

  /**
   * Смена типа материала на шаге 1 (блок «Что делаем»).
   *
   * Отличие от `handleArtifactTypeChange`: снимает выбранный сценарий.
   * Сценарий фиксирует тип (`typeFixedByPreset = Boolean(selectedPresetId)`),
   * и учитель, выбравший сценарий и потом ткнувший другой тип на первом шаге,
   * увидел бы, что тип не меняется, — без единого объяснения. Здесь явный
   * выбор типа и означает «сценарий больше не задан», поэтому возвращаем
   * параметры к значениям по умолчанию и снимаем блокировку.
   */
  const handleStep1TypeChange = React.useCallback(
    (next: TaskType) => {
      handleArtifactTypeChange(next);
      setCustomType(next);
      if (selectedPresetId) {
        setSelectedPresetId(null);
        setPresetMode("template");
        setDifficulty("medium");
        setCount(10);
        setWithAnswers(true);
        setWithExplanations(true);
      }
    },
    [handleArtifactTypeChange, selectedPresetId]
  );

  /** F-04-C: переключение режима wizard. Доступно на любом шаге. */
  const handleModeChange = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    trackExamModeSelected(next);
    // При переключении режима — ресетим зависимое состояние и шаг.
    setExam(null);
    setExamSubject(null);
    setExamNumbers([]);
    setWorksheet(null);
    setLessonPlan(null);
    setPresentation(null);
    setKtp(null);
    setCardSet(null);
    setMaterialBundle(null);
    setLessonBundle(null);
    if (next === "exam") {
      setStep("exam-select");
    } else {
      // Возвращаемся на ближайший достигнутый шаг topic-флоу.
      setStep(subject ? (grade ? (topic ? "configure" : "topic") : "select") : "select");
    }
  };

  // Шаг 1 → Шаг 2: «Далее» из SelectStep. UMK inline (auto-pick если 1, иначе чипы в TopicStep).
  const handleSelectNext = (nextSubject: SubjectSlug, nextGrade: number) => {
    setSubject(nextSubject);
    setGrade(nextGrade);
    const umkList = getUMK(nextSubject, nextGrade);
    if (umkList.length === 1) setUmk(umkList[0].id);
    setStep("topic");
  };

  // Смена grade внутри шага 1 — UMK и topic сбрасываются (они зависели от старого grade).
  const handleGradeChangeInline = (g: number) => {
    setGrade(g);
    setUmk(null);
    setTopic(null);
  };

  // Возврат с topic-шага в «select» (для UMK и смены предмета/класса).
  const handleBackToSelect = () => {
    setStep("select");
  };

  // view-событие: трекаем один раз на mount
  React.useEffect(() => {
    trackEvent("constructor_view", { mode });
    // mode может меняться, но view считаем за visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // step-события: трекаем каждое изменение шага
  const prevStep = React.useRef<Step>(step);
  React.useEffect(() => {
    if (prevStep.current === step) return;
    trackEvent("constructor_step", { from: prevStep.current, to: step, mode });
    prevStep.current = step;
  }, [step, mode]);

  /**
   * Лист 4.1.1: собрать игру из листа.
   *
   * Путь в три шага, и каждый шаг может честно остановиться словами:
   *   1. ЛИСТ. Если листа на экране нет — делаем его тут же, тем же запросом,
   *      что и обычная генерация (`generateWorksheetSmart`), и кладём в историю
   *      так же. Отдельная просьба «сначала сделайте лист» отправляла бы
   *      учителя делать то, что конструктор умеет сделать сам.
   *   2. СЕРВЕР. Ранклер читает `payload_json` листа из базы, поэтому нужен id
   *      из `POST /api/worksheets/save`. Если сохранение уже идёт — дожидаемся
   *      его, а не шлём второе (иначе в базе появляется дубль листа).
   *   3. ИГРА. `POST /api/interactives` с форматом и дефолтными настройками.
   *
   * Квота: без листа это ДВА вызова модели, и списывается ровно одна
   * бесплатная генерация — за лист, потому что счётчик один на оба. Сама
   * игра счётчик не трогает (у неё свой лимит на сервере, 20 в час), и врать
   * учителю про это нельзя, поэтому счётчик тут не трогаем.
   */
  const buildInteractive = React.useCallback(async () => {
    if (buildingInteractive) return;
    setInteractiveError(null);

    // Вход. Без него сервер не хранит игру и не выдаёт ссылку — раньше кнопка
    // ждала этого на бэке и возвращала 401, теперь говорим сразу и здесь.
    if (!isLoggedIn) {
      setInteractiveError(
        "Войдите, чтобы выдать игру классу: ссылка и результаты хранятся на сервере под вашим аккаунтом",
      );
      return;
    }
    if (mode !== "topic" || !subject || !grade || !topic) {
      setInteractiveError(
        "Игра собирается по теме урока. Сначала выберите предмет, класс и тему",
      );
      return;
    }

    setBuildingInteractive(true);
    setInteractiveStage(null);
    try {
      // ── Шаг 1: лист ──────────────────────────────────────────────────────
      let ws = worksheet;
      if (!ws) {
        const isPaid = isPaidPlan(serverUsage?.plan);
        if (!isPaid && !canGenerate()) {
          setShowPaywall(true);
          return;
        }
        setInteractiveStage("Делаем лист по этой теме — это первый вызов модели…");
        const r = await generateWorksheetSmart({
          subject,
          grade,
          topic,
          type: "worksheet",
          difficulty,
          count,
          withAnswers,
          withExplanations,
          ...(umk ? { meta: { umk } } : {}),
        });
        const made = r.worksheet;
        setIsDemoResult(r.isDemo);
        // Квота списывается за реальный вызов. Заготовка демо-режима тоже
        // стоит попытки — так же, как в обычном generate().
        const counter = settleGeneration({ isDemo: r.isDemo });
        setRemaining(Math.max(0, FREE_GENERATIONS - counter.count));
        setWorksheet(made);
        addToHistory({
          id: made.id,
          type: "worksheet",
          title: made.title,
          // `Worksheet.subject` приходит со бэка строкой, в истории ждёт слаг.
          // Тот же каст, что и в обычном generate().
          subject: made.subject as SubjectSlug,
          grade: made.grade,
          createdAt: new Date().toISOString(),
          isFavorite: false,
          artifact: { ...made, isDemo: r.isDemo } as UserHistoryItem["artifact"],
        });
        // Заготовку в игру не ведём: из неё получилась бы такая же заготовка,
        // и учитель отдал бы её классу. Словами — прямо в панели.
        if (r.isDemo) {
          setInteractiveError(
            "Сервис сейчас недоступен: лист получился заготовкой из шаблона. Игра из неё была бы такой же заготовкой — соберите её, когда сервис вернётся",
          );
          return;
        }
        ws = made;
      }

      // ── Шаг 2: лист в базе ────────────────────────────────────────────────
      let worksheetId = savedWorksheetId;
      if (!worksheetId) {
        setInteractiveStage("Сохраняем лист на сервере…");
        const pending = pendingSaveRef.current;
        const awaited = pending ? await pending : null;
        if (awaited?.ok && awaited.worksheetId) {
          worksheetId = awaited.worksheetId;
        } else {
          const saved = await saveWorksheet({
            type: "worksheet",
            subject: ws.subject as SubjectSlug,
            grade: ws.grade,
            topic: ws.topic,
            title: ws.title,
            difficulty: ws.difficulty,
            tasks: ws.tasks,
            source: "llm",
          });
          if (!saved.ok) {
            setInteractiveError(
              saved.error === "unauthorized"
                ? "Войдите, чтобы выдать игру классу: без сохранённого листа ссылку выдать нельзя"
                : saved.error === "network"
                  ? "Сервер недоступен, лист не сохранился. Игра собирается из сохранённого листа — попробуйте, когда связь вернётся"
                  : "Лист не сохранился на сервере, а игра собирается именно с него. Попробуйте ещё раз",
            );
            return;
          }
          worksheetId = saved.worksheetId;
          void refreshUsage();
        }
        setSavedWorksheetId(worksheetId);
      }

      // ── Шаг 3: игра ───────────────────────────────────────────────────────
      setInteractiveStage("Собираем игру из заданий листа…");
      const res = await createInteractive({
        worksheetId,
        format: activeInteractiveFormat,
        options: constructorInteractiveOptions(activeInteractiveFormat),
      });
      if (!res.ok) {
        setInteractiveError(interactiveCreateErrorMessage(res.error));
        return;
      }
      // Пустой `url` в ответе — не повод оставить учителя без ссылки:
      // адрес фронта клиенту известен, а бэк про него не знает.
      setInteractive(
        res.interactive.url
          ? res.interactive
          : { ...res.interactive, url: interactivePlayPath(res.interactive.shareToken) },
      );
      trackEvent("constructor_interactive_built", { format: activeInteractiveFormat });
    } catch (err) {
      // Сеть/исключение — тоже словами. Молчаливый `catch` выглядел бы как
      // «собралось», а игры на экране нет.
      setInteractiveError(
        err instanceof Error
          ? `Не удалось собрать игру: ${err.message}`
          : "Не удалось собрать игру. Попробуйте ещё раз",
      );
    } finally {
      setBuildingInteractive(false);
      setInteractiveStage(null);
    }
  }, [
    activeInteractiveFormat,
    buildingInteractive,
    count,
    difficulty,
    grade,
    isLoggedIn,
    mode,
    savedWorksheetId,
    subject,
    topic,
    umk,
    withAnswers,
    withExplanations,
    worksheet,
  ]);

  /**
   * Собрать материал.
   *
   * `opts.bypassCache` — обойти семантический кэш бэка (ТЗ-36). Ставит его
   * только кнопка «Новый вариант»: без обхода кэша она отдавала учителю ТОТ ЖЕ
   * лист байт в байт (тот же id, та же дата, `meta.model = "semantic-cache"`),
   * потому что фронт считал запрос новым, а сервер отдавал прошлый ответ.
   * Первая генерация по теме идёт через кэш как и раньше — кэш это ускоритель,
   * и он должен работать.
   */
  const generate = async (opts?: { bypassCache?: boolean }) => {
    // Лист 4.1.1: интерактив — отдельный путь. Он не «генерируется» тем же
    // запросом, что лист: сначала нужен лист, сохранённый на сервере, потом
    // отдельный вызов ранклера. Поэтому вся сборка живёт в buildInteractive(),
    // а кнопка «Создать» на этом типе ведёт туда же. Повторная сборка учителя
    // (например, из шапки) приводит в тот же обработчик, а не в ошибку.
    if (type === "interactive") {
      const build = interactiveBuildRef.current;
      if (build) {
        build();
        return;
      }
      // Панель ещё не смонтирована (первый рендер шага). Не выдумываем
      // результат — говорим, где действие.
      toast({
        tone: "info",
        title: "Интерактив собирается в блоке «Игра для класса»",
        description: "Выберите формат и нажмите «Собрать игру»",
      });
      return;
    }

    trackEvent("constructor_generate_click", {
      mode,
      subject,
      grade,
      topic,
      type,
      difficulty,
      count,
    });
    // F-04-C: экзамен-режим — синтезируем параметры для мок-генератора.
    // Реальная генерация по номерам ОГЭ/ЕГЭ в бэкенде — будущее, не в скоупе F-04-C.
    let body: GenerationRequest;
    if (mode === "exam") {
      if (!exam || !examSubject || examNumbers.length === 0) return;
      const gradeForExam = exam === "oge" ? 9 : 11;
      // ВСЕ выбранные номера, а не только первый (аудит 18.10.2026, BUG-034).
      //
      // Раньше здесь стояло `const firstNum = examNumbers[0]` и тема уезжала как
      // `exam-oge-1`. Учитель отмечал № 1 и № 4, а в подтверждении на экране
      // стояло «ОГЭ · Математика · № 1, 4» — и уходил только № 1. Про обратное
      // в интерфейсе не было сказано нигде.
      //
      // Теперь в тему уходят все номера. Это важно ещё и для кэша: ключ кэша
      // строится из темы, а значит набор {1} и набор {1, 4} — разные ключи, и
      // лист по «1 и 4» больше не может прийти из кэша от листа по «1».
      const nums = [...examNumbers].sort((a, b) => a - b);
      const examTitle = exam === "oge" ? "ОГЭ" : "ЕГЭ";
      const subjectTitle = getSubject(examSubject)?.shortTitle ?? examSubject;
      body = {
        subject: examSubject,
        grade: gradeForExam,
        // Тема читаемая: её видно и в подтверждении, и в истории, и в промпте
        // модели. Раньше в запрос уходило машинное `exam-oge-1`, из-за чего в
        // режиме экзамена тема не подставлялась вовсе (BUG-035).
        topic: `${examTitle} · ${subjectTitle} · № ${nums.join(", ")}`,
        type,
        difficulty,
        count,
        withAnswers,
        withExplanations,
      };
    } else {
      if (!subject || !grade || !topic) return;
      body = {
        subject,
        grade,
        topic,
        type,
        difficulty,
        count,
        withAnswers,
        withExplanations,
        // TZ-08: пробрасываем УМК в метаданные для мок-генератора
        // (будущая передача в LLM-prompt в backend). Используем существующее
        // поле `meta` чтобы не расширять контракт GenerationRequest.
        ...(umk ? { meta: { umk } } : {}),
      };
    }

    /**
     * Бесплатный лимит проверяем только у бесплатного тарифа.
     *
     * Раньше здесь стояло голое `canGenerate()` — то есть локальный счётчик из
     * localStorage ограничивал ВСЕХ, включая платящих. Учитель на «Базовом»
     * или «Плюсе» упирался в «Лимит бесплатных генераций» на четвёртом листе
     * в тот же день и на другой вкладке, хотя его тариф к localStorage отношения
     * не имеет: лимиты платных считает бэк.
     *
     * Для анонимов (serverUsage === null) поведение прежнее — бесплатные
     * генерации. Решение об оплате принимает бэк (402 → paywall), поэтому
     * клиентский чек — только против недопустимой генерации у бесплатного.
     */
    // Платный тариф = любой не «free». Список тарифов здесь намеренно не пишется:
    // 12.10.2026 стояло `base || plus`, и подписчик «Оптимального» упирался в
    // бесплатную квоту, хотя бэк его принимал.
    const isPaid = isPaidPlan(serverUsage?.plan);
    if (!isPaid && !canGenerate()) {
      setShowPaywall(true);
      return;
    }

    setGenerating(true);
    setIsDemoResult(false);
    setDemoReason(null);
    setWorksheet(null);
    // Второй вариант контрольной тоже сбрасываем ЗДЕСЬ, а не только после
    // успешной генерации: если генерация упадёт, в состоянии остался бы
    // второй вариант от ПРЕДЫДУЩЕЙ работы, а переключатель появился бы у
    // нового листа (у которого второго варианта нет).
    setControlVariant1(null);
    setControlVariant2(null);
    setControlVariant(1);
    setLessonPlan(null);
    setPresentation(null);
    setKtp(null);
    setCardSet(null);
    setMaterialBundle(null);
    setLessonBundle(null);
    setPhotoCheckOpen(false);
    setProgressStage("selecting");

    // F-04-B: анимированный progress-UI идёт параллельно реальной генерации.
    // Длительности — best-effort: если реальный запрос дольше, прогресс дождётся его.
    // Если быстрее — UI всё равно доиграет до "done" перед показом артефакта.
    const stageTimers: number[] = [];
    const scheduleStage = (next: typeof progressStage, ms: number) => {
      const id = window.setTimeout(() => setProgressStage(next), ms);
      stageTimers.push(id);
    };
    scheduleStage("verifying", 1000);
    scheduleStage("formatting", 2500);

    // З2: квота списывается ПОСЛЕ успешной генерации (строка `consume()` ниже,
    // уже после `await`). Флаг защищает от двойного возврата: если после
    // списания упало что-то ещё (сборка payload, сохранение), `catch` вернёт
    // ровно одну попытку. Если упала сама генерация — списания ещё не было,
    // и refund не вызывается вовсе.
    let quotaConsumed = false;

    try {
      // Q1-2027: switch по типу артефакта — разные smart-функции и разный result-handling.
      //
      // TZ-16 §4.3 (точка 2), КРИТИЧНО: `default` больше НЕ отдаёт worksheet молча.
      // Именно из-за этого `cards` сегодня генерировал обычный рабочий лист —
      // учитель выбирал «Карточки» и получал лист с уплотнёнными заданиями.
      // Теперь каждый тип обязан иметь явный `case`; exhaustiveness-проверка
      // внизу не даст забыть новый тип из TaskType (забытый case = ошибка компиляции).
      const result = await (async () => {
        switch (type) {
          case "lesson-plan": {
            const r = await generateLessonPlanSmart(body, opts);
            return { kind: "lesson-plan" as const, payload: r.data, isDemo: r.isDemo, demoReason: r.demoReason };
          }
          case "presentation": {
            const r = await generatePresentationSmart(body, opts);
            return { kind: "presentation" as const, payload: r.data, isDemo: r.isDemo, demoReason: r.demoReason };
          }
          case "ktp": {
            const r = await generateKtpSmart(body, opts);
            return { kind: "ktp" as const, payload: r.data, isDemo: r.isDemo, demoReason: r.demoReason };
          }
          // TZ-16 §3.1: карточки — самостоятельный артефакт со своим моком.
          // Раньше `cards` был в списке ниже и молча отдавал обычный лист.
          case "cards": {
            const r = await generateCardsSmart(body, opts);
            return { kind: "cards" as const, payload: r.data, isDemo: r.isDemo, demoReason: r.demoReason };
          }
          // TZ-16 §3.2: комплект материалов (словарь / справочник / раздатка).
          case "materials": {
            const r = await generateMaterialsSmart(body, opts);
            return { kind: "materials" as const, payload: r.data, isDemo: r.isDemo, demoReason: r.demoReason };
          }
          // TZ-16 §3.4: «урок целиком» — 4 слота. Оркестрация ПАРАЛЛЕЛЬНА
          // (Promise.allSettled внутри generateBundleSmart → мок): при отказе
          // одного слота остальные три не теряются, отказ уходит в `failed`.
          case "lesson-bundle": {
            const r = await generateBundleSmart(body, opts);
            return { kind: "lesson-bundle" as const, payload: r.data, isDemo: r.isDemo, demoReason: r.demoReason };
          }
          // Лист с разной перепаковкой заданий.
          case "worksheet":
          case "test":
          case "oge":
          case "ege": {
            const r = await generateWorksheetSmart(body, opts);
            return {
              kind: "worksheet" as const,
              payload: r.worksheet,
              isDemo: r.isDemo,
              demoReason: r.demoReason,
              // ТЗ-25: потери заданий бывают у ЛИСТА и ТЕСТА тоже — разрыв 5
              // бьёт по всем типам работ, а не только по контрольной.
              quality: r.quality,
              variants: r.variants,
              // ТЗ-34: критерии оценивания едут вместе с материалом.
              evaluation: r.evaluation,
            };
          }
          // Контрольная работа — единственный тип, который по определению
          // делается в ДВУХ вариантах (иначе это тест, а «Контрольная на 2
          // варианта» — обещание в тарифах, которое продукт не выполнял).
          //
          // Что было не так: вариант генерировался ОДИН, а подпись
          // «вариант N» бралась из `Math.random()` — то есть номер был
          // случайным, а не вторым настоящим вариантом. Учительница получила
          // один вариант с надписью «вариант 4».
          //
          // Теперь генерируются два независимых листа: одинаковые параметры,
          // разные задания (кэш персональный, поэтому второй вариант не
          // совпадёт с первым — у ключа нет поля «вариант», а `bypassCache`
          // для второго прохода выставлен явно).
          case "control": {
            // ОДИН вызов, а не два (09.10.2026).
            //
            // Раньше здесь было два запроса по одному на вариант: `r` и `r2` с
            // `bypassCache`. Это стоило вдвое дороже, занимало вдвое больше
            // времени и, главное, съедало ДВЕ попытки из трёх бесплатных —
            // учитель нажимал «сделать» один раз.
            //
            // Теперь модель отдаёт оба варианта в одном ответе (промпт
            // `worksheet-gen.ts`, разбор в `backend/src/llm/index.ts`), а
            // `bypassCache` больше не нужен: кэш персональный, и второй
            // вариант приходит вместе с первым, а не отдельным запросом.
            const r = await generateWorksheetSmart(body, opts);
            return {
              kind: "worksheet" as const,
              payload: r.worksheet,
              isDemo: r.isDemo,
              demoReason: r.demoReason,
              secondVariant: r.secondVariant ?? null,
              // ТЗ-25: признаки потерь едут вместе с результатом. Без них
              // учитель не узнает, что заданий меньше, чем просил.
              quality: r.quality,
              variants: r.variants,
              // ТЗ-34: у контрольной — два блока критериев, по вариантам.
              evaluation: r.evaluation,
            };
          }
          default: {
            // Exhaustiveness: если в TaskType добавят новый тип и забудут case
            // выше, `type` здесь перестанет быть `never` и сборка упадёт.
            const unhandled: never = type;
            throw new Error(`[generate] необработанный тип: ${String(unhandled)}`);
          }
        }
      })();

      // З2: списание квоты — только здесь, уже после успешного `await`.
      // Правило «демо-заготовка тоже стоит попытки» живёт в settleGeneration(),
      // а не здесь: раньше каждый экран решал это по-своему и /oge не списывал.
      const counter = settleGeneration({ isDemo: result.isDemo });
      quotaConsumed = true;
      const left = Math.max(0, FREE_GENERATIONS - counter.count);

      // Снэпим к "done" и сбрасываем pending-переходы.
      stageTimers.forEach((id) => window.clearTimeout(id));
      setProgressStage("done");

      // Честность результата: заготовка всегда помечается в интерфейсе.
      setIsDemoResult(result.isDemo);
      setDemoReason(result.demoReason);

      // Сохраняем в правильный state.
      // TZ-16 §4.3 (точка 3): цепочка if/else заменена на switch — на 7 типах
      // она была источником багов, а с 9 их стало 13.
      let artifactTitle = "";
      let historyType: TaskType = "worksheet";
      let histSubject: SubjectSlug | null = null;
      let histGrade: number | undefined = undefined;
      let artifactId = "";

      switch (result.kind) {
        case "lesson-plan": {
          const lp = { ...(result.payload as LessonPlan), isDemo: result.isDemo };
          setLessonPlan(lp);
          artifactTitle = lp.title;
          artifactId = lp.id;
          historyType = "lesson-plan";
          histSubject = lp.subject;
          histGrade = lp.grade;
          break;
        }
        case "presentation": {
          const p = { ...(result.payload as Presentation), isDemo: result.isDemo };
          setPresentation(p);
          artifactTitle = p.title;
          artifactId = p.id;
          historyType = "presentation";
          histSubject = p.subject;
          histGrade = p.grade;
          break;
        }
        case "ktp": {
          const k = { ...(result.payload as Ktp), isDemo: result.isDemo };
          setKtp(k);
          artifactTitle = k.title;
          artifactId = k.id;
          historyType = "ktp";
          histSubject = k.subject;
          histGrade = k.grade;
          break;
        }
        case "worksheet": {
          const ws = { ...(result.payload as Worksheet), isDemo: result.isDemo };
          setWorksheet(ws);
          // Второй вариант контрольной приходит в этом же result. Если его нет
          // (сбой второго прохода) — показываем первый и не врём про два.
          const second = result.secondVariant
            ? { ...(result.secondVariant as Worksheet), isDemo: result.isDemo }
            : null;
          // Вариант 1 кладём в ОТДЕЛЬНЫЙ слот: `worksheet` уезжает в
          // переключатель как «что сейчас на экране», и читать из него
          // вариант 1 уже нельзя.
          setControlVariant1(type === "control" ? ws : null);
          setControlVariant2(type === "control" ? second : null);
          setControlVariant(1);
          // ТЗ-25: честное сообщение вместо молчаливых потерь. Ставится ЗДЕСЬ,
          // рядом с раскладкой вариантов, потому что именно здесь известно и
          // что показано, и что пришло от сервера. `variants` для не-контрольной
          // работы не деградирует, и блок не появляется.
          setQualityNotice(buildQualityNotice(result.quality, result.variants));
          // ТЗ-34: критерии оценивания — в превью и в печать. У листа их нет
          // (массив пустой), у контрольной — два блока, по вариантам.
          setEvaluation(result.evaluation ?? []);
          artifactTitle = ws.title;
          artifactId = ws.id;
          histSubject = ws.subject as SubjectSlug;
          histGrade = ws.grade;
          break;
        }
        // TZ-16 §3.1: у CardSet есть свои subject/grade — берём из артефакта.
        case "cards": {
          const cs = { ...(result.payload as CardSet), isDemo: result.isDemo };
          setCardSet(cs);
          artifactTitle = cs.title;
          artifactId = cs.id;
          historyType = "cards";
          histSubject = cs.subject;
          histGrade = cs.grade;
          break;
        }
        // TZ-16 §3.2: у MaterialBundle — тоже свои subject/grade.
        case "materials": {
          const mb = { ...(result.payload as MaterialBundle), isDemo: result.isDemo };
          setMaterialBundle(mb);
          artifactTitle = mb.title;
          artifactId = mb.id;
          historyType = "materials";
          histSubject = mb.subject;
          histGrade = mb.grade;
          break;
        }
        // TZ-16 §3.4: у LessonBundle — свои subject/grade. Комплект может быть
        // неполным (часть слотов в `failed`) — это не ошибка генерации,
        // поэтому провала тут не делаем: превью само покажет статусы слотов.
        case "lesson-bundle": {
          const lb = { ...(result.payload as LessonBundle), isDemo: result.isDemo };
          setLessonBundle(lb);
          artifactTitle = lb.title;
          artifactId = lb.id;
          historyType = "lesson-bundle";
          histSubject = lb.subject;
          histGrade = lb.grade;
          break;
        }
        default: {
          // Exhaustiveness: новый `kind` без ветки = ошибка компиляции.
          // После исчерпывающего switch сам `result` сужается до `never`,
          // поэтому проверяем весь объект, а не `result.kind`.
          const unhandled: never = result;
          throw new Error(`[generate] необработанный результат: ${JSON.stringify(unhandled)}`);
        }
      }

      setRemaining(left);

      // ЗАГОТОВКА В ИСТОРИЮ НЕ ПОПАДАЕТ (аудит 18.10.2026, BUG-025).
      //
      // Раньше каждая неудачная попытка добавляла в историю ещё один фальшивый
      // лист: у тестового аккаунта их было 20, все одинаковые, и у каждого
      // кнопка «Выдать классу». Учитель видел в кабинете девять «своих»
      // листов, которых не делал, и мог отдать один классу.
      //
      // Заготовка — не результат, значит и в истории ей не место. Настоящий
      // материал (isDemo === false) попадает в историю, как раньше.
      if (!result.isDemo) {
        addToHistory({
          // TZ-16: id берём из switch выше, а не из тернарника по result.kind —
          // на 13 типах такой тернарник гарантированно что-то забывает.
          id: artifactId,
          type: historyType,
          title: artifactTitle,
          subject: (histSubject ?? subject) as SubjectSlug,
          grade: histGrade,
          createdAt: new Date().toISOString(),
          isFavorite: false,
          // З1: кладём в историю сам артефакт, а не только метаданные —
          // иначе перезагрузка страницы стирает результат генерации.
          // `addToHistory` сам обрезает это поле у всех, кроме 5 последних,
          // чтобы localStorage не раздувался.
          // Флаг заготовки едет вместе с артефактом. Раньше в историю уходил
          // «сырой» `result.payload` без `isDemo`, поэтому заготовка, открытая
          // заново из «Истории», печаталась как обычный материал: ни плашки, ни
          // водяного знака. В state артефакт с флагом (см. switch выше), а в
          // историю — нет, и именно оттуда учитель его и переоткрывает.
          artifact: {
            ...(result.payload as UserHistoryItem["artifact"]),
            isDemo: result.isDemo,
          } as UserHistoryItem["artifact"],
        });
      }

      // W1+п.2+п.3: синхронно с localStorage addToHistory — сохраняем артефакт
      // на бэк (для залогиненных юзеров). Идёт в фоне, не блокирует UI:
      //   - 401 (unauthorized) — анонимный flow, silent skip;
      //   - 400 (validation)   — не должно случаться, но если бэк
      //                          отвергнет payload, тост предупредит;
      //   - 500/network        — тост предупредит, юзер потеряет только
      //                          серверную копию (в localStorage лист уже есть).
      // Покрывает все 4 типа артефактов через discriminated union SaveWorksheetInput.
      // На бэке zod-схема SaveBody матчит `type` и валидирует специфичные поля
      // (tasks/stages/slides/weeks). payload_json хранит весь data, чтобы при
      // GET /api/worksheets/:id данные совпадали с тем, что прислал фронт.
      const saveInput: SaveWorksheetInput | null = (() => {
        // TZ-16 §4.3 (точка 4): цепочка if/else → switch. Раньше последняя
        // ветка была безусловным «ktp» без проверки, то есть любой будущий
        // тип молча сохранялся бы как КТП. Новые типы (materials и др.) сюда
        // не доходят: generate() для них бросает явную ошибку на Этапе 1.
        switch (result.kind) {
          case "worksheet": {
            const ws = result.payload as Worksheet;
            return {
              type: "worksheet" as const,
              subject: ws.subject as SubjectSlug,
              grade: ws.grade,
              topic: ws.topic,
              title: ws.title,
              difficulty: ws.difficulty,
              tasks: ws.tasks,
              source: result.isDemo ? ("mock" as const) : ("llm" as const),
            };
          }
          case "lesson-plan": {
            const lp = result.payload as LessonPlan;
            return {
              type: "lesson-plan" as const,
              subject: lp.subject,
              grade: lp.grade,
              topic: lp.topic,
              title: lp.title,
              difficulty, // lesson-plan: optional на бэке, передаём из стейта как есть.
              goals: lp.goals,
              equipment: lp.equipment,
              stages: lp.stages,
              homework: lp.homework,
              fgosRef: lp.fgosRef,
              source: result.isDemo ? ("mock" as const) : ("llm" as const),
            };
          }
          case "presentation": {
            const p = result.payload as Presentation;
            return {
              type: "presentation" as const,
              subject: p.subject,
              grade: p.grade,
              topic: p.topic,
              title: p.title,
              slideCount: p.slideCount,
              slides: p.slides,
              theme: p.theme,
              source: result.isDemo ? ("mock" as const) : ("llm" as const),
            };
          }
          case "ktp": {
            const k = result.payload as Ktp;
            return {
              type: "ktp" as const,
              subject: k.subject,
              grade: k.grade,
              // topic у КТП опционален (на бэке optional); берём из req, если есть.
              topic: (k as { topic?: string }).topic,
              title: k.title,
              schoolYear: k.schoolYear,
              totalHours: k.totalHours,
              weeks: k.weeks,
              source: result.isDemo ? ("mock" as const) : ("llm" as const),
            };
          }
          default: {
            // TZ-16 §3.1–3.2: карточки и материалы пока не сохраняются в БД.
            // Причина не в лени, а в контракте: `SaveWorksheetInput` и zod-схема
            // `SaveBody` на бэке знают только 4 типа (worksheet / lesson-plan /
            // presentation / ktp). Отправлять им payload карточек означает
            // гарантированный 400 validation на каждой генерации. Артефакт при
            // этом не теряется — он лежит в истории (localStorage) и
            // восстанавливается после перезагрузки.
            // Серверное сохранение для этих типов придёт вместе с их
            // LLM-эндпоинтами (`/api/cards`, `/api/materials`).
            if (result.kind === "cards" || result.kind === "materials" || result.kind === "lesson-bundle") {
              return null;
            }
            // Exhaustiveness: новый `kind` без ветки сохранения = ошибка компиляции.
            // После исчерпывающего switch сам `result` сужается до `never`.
            const unhandled: never = result;
            throw new Error(`[generate] нет ветки сохранения для: ${JSON.stringify(unhandled)}`);
          }
        }
      })();

      // Карточки и материалы пока не умеют сохраняться на бэк (см. ветку
      // `return null` выше) — не шлём запрос, который гарантированно отбросят.
      //
      // И заготовку на сервер не кладём: иначе она всплывает в истории
      // кабинета («История · 9» из девяти одинаковых листов, которых учитель
      // не делал) — то есть ровно тот дефект, который мы чиним (BUG-025).
      if (saveInput && !result.isDemo) {
        // Лист 4.1.1: сохраняем его в ref, чтобы «Собрать игру» могла
        // дождаться этого же сохранения вместо второго запроса (иначе в базе
        // появилось бы два одинаковых листа). Плюс флаг для панели игры:
        // «сохраняем лист» — это подсказка, а не заблокированная кнопка.
        const isWorksheetSave = saveInput.type === "worksheet";
        if (isWorksheetSave) setSavingWorksheet(true);
        const pending = saveWorksheet(saveInput);
        pendingSaveRef.current = pending;
        void pending.then((r) => {
          if (isWorksheetSave) setSavingWorksheet(false);
          if (r.ok) {
            // TZ-12: сохранили id листа — «Выдать классу» сможет ссылаться на него
            // серверным ID вместо клиентского снимка заданий.
            setSavedWorksheetId(r.worksheetId);
            // Обновить виджет лимита: для залогиненного — счётчик с сервера,
            // для анонимного — noop (хук сам себя не вызывает при 401).
            void refreshUsage();
          } else if (r.error === "validation" || r.error === "internal") {
            // "network" → тост НЕ показываем (типичная ситуация: оффлайн / API
            // URL не задан в dev — без паники, юзер видит лист локально).
            toast({
              tone: "info",
              title: "Не удалось сохранить на сервере",
              description: "Лист сохранён локально, на сервере появится после восстановления соединения",
            });
          }
          // "unauthorized" — silent skip, юзер просто не залогинен.
        }).finally(() => {
          // Ссылка устарела: следующая сборка должна ждать СВОЕ сохранение.
          if (pendingSaveRef.current === pending) pendingSaveRef.current = null;
        });
      }

      // F-04-B: success-burst сверху страницы (~80 частиц, ~1.2с).
      //
      // Конфетти — только за настоящий материал. Раньше они сыпались и за
      // заготовку: учитель видел праздник, тост «Готово!» и уходил отдавать
      // классу типовой лист (аудит 18.10.2026, BUG-018).
      if (!result.isDemo) void fireConfetti();

      if (result.isDemo) {
        // ЗАГОТОВКА — НЕ РЕЗУЛЬТАТ (аудит 18.10.2026, BUG-018).
        //
        // Раньше в этом месте стоял зелёный тост «Готово! Готово примерно за
        // минуту» — и он показывался даже когда на экране была заготовка с
        // баннером «Это демонстрационная заготовка». Два сообщения, одно
        // из которых врёт, и учитель читает то, что приятнее.
        //
        // Теперь тост соответствует тому, что на экране:
        //   - `service_failed`    — сервер не ответил, это не готовый лист;
        //   - `no_llm_endpoint`   — у типа нет серверного эндпоинта, материал
        //                           собран из шаблона (это не авария);
        //   - `no_backend`        — сборка без адреса сервера (dev/стенд).
        const demoTone = result.demoReason === "service_failed" ? "error" : "info";
        const demoTitle =
          result.demoReason === "no_llm_endpoint"
            ? "Собрано из шаблона"
            : "Это заготовка, а не готовый лист";
        const demoDescription =
          result.demoReason === "no_llm_endpoint"
            ? "Этот тип собирается из шаблона — серверной генерации для него пока нет"
            : "Сервис не ответил, поэтому показан типовой пример. Попробуйте ещё раз";
        toast({ tone: demoTone, title: demoTitle, description: demoDescription });
      } else {
        toast({
          tone: "success",
          title: "Готово!",
          // З6/З7: единое время «30 сек» — столько же стоит в заголовке и в
          // подписи под кнопкой. Слово «demo-режим» в пользовательский текст
          // не выносим: учителю оно ничего не объясняет.
          // Для разработчика: это заявленное время из UI, а не замер. Когда
          // подключим реальный LLM — считаем `performance.now()` и подставляем
          // фактическое, тогда здесь же уйдёт и «· demo-режим».
          description: "Готово примерно за минуту · сохраните в PDF",
        });
      }
    } catch (err) {
      stageTimers.forEach((id) => window.clearTimeout(id));
      setProgressStage(null);
      // З2: неудачная генерация не должна стоить попытки. Возвращаем квоту
      // только если она уже была списана (иначе refund() ушёл бы в минус).
      if (quotaConsumed) {
        refund();
        setRemaining(getRemaining());
        quotaConsumed = false;
      }

      // 402 = «этот тип входит в Плюс». Раньше он попадал в общий тост
      // «Попытка не потрачена — попробуйте ещё раз», а для учителя это ложь:
      // сколько он ни повторяй, без подписки тот же тип не соберётся.
      // С 07.10.2026 это стало реальной ошибкой: презентация, КТП и варианты
      // ОГЭ/ЕГЭ на тарифе «База» отдают 402, и показывать надо окно оплаты.
      if (err instanceof BackendError && err.isUpgradeRequired) {
        setShowPaywall(true);
        return;
      }

      // ТЗ-26 Б-1. Таймаут — отдельный случай, и он НЕ «попробуйте ещё
      // раз»: контрольная с двумя вариантами стабильно уходит за любой
      // разумный срок (замеры 13.10 — 95,8 с и 101,8 с), поэтому повтор
      // закончится ровно тем же отказом. Обещать учителю «попробуйте ещё
      // раз» здесь значит врать. Вместо этого говорим, что делать: уменьшить
      // лист или снять то, что делает генерацию длиннее всего.
      // Капча попросилась, а взять её нечем (аудит 18.10.2026, BUG-013).
      //
      // Раньше этот случай доходил до общей ветки «Не получилось — попытка не
      // потрачена», а фронт подставлял заготовку и показывал «Готово!». Теперь
      // заготовки тут нет, и учитель должен понять, что именно произошло.
      if (err instanceof BackendError && err.isChallengeUnavailable) {
        toast({
          tone: "error",
          title: "Не удалось подтвердить, что запрос отправил человек",
          description: "Капча сейчас недоступна. Попробуйте ещё раз чуть позже",
        });
        console.error("[generate] failed: challenge unavailable", err);
        return;
      }

      if (isTimeoutError(err)) {
        toast({
          tone: "error",
          title: "Генерация не успела закончиться",
          description:
            "Попробуйте лист поменьше или снять ответы и пояснения",
        });
        console.error("[generate] failed: timeout", err);
        return;
      }

      toast({
        tone: "error",
        title: "Не получилось",
        description: "Попытка не потрачена — попробуйте ещё раз",
      });
      console.error("[generate] failed:", err);
    } finally {
      setGenerating(false);
      // Скроем progress через микротаск после рендера, чтобы "done" мелькнул.
      window.setTimeout(() => setProgressStage(null), 200);
    }
  };

  /**
   * «Новый вариант» = НОВЫЙ материал (ТЗ-36).
   *
   * Раньше здесь стояло `generate()` — то есть запрос БЕЗ обхода кэша. Сервер
   * отдавал прошлый ответ целиком: тот же `id`, та же дата создания,
   * `meta.model = "semantic-cache"`, `costUsd = 0`. Учитель получал тот же
   * лист байт в байт и при этом терял одну из пяти бесплатных попыток.
   *
   * Теперь запрос уходит с `bypassCache: true` — это единственный честный
   * способ получить другой материал по той же теме (AD-1: ключ кэша не трогаем,
   * вариантность решается на стороне кнопки).
   */
  const handleNewVariant = () => {
    if (subject && grade && topic) generate({ bypassCache: true });
  };

  const handlePrint = () => {
    // TZ-16 §3.1: у карточек своя печатная сетка (2×5 на A4 с линией сгиба),
    // обычный window.print() её не применит — стили живут в CARDS_PRINT_CSS,
    // который инжектит printCards().
    if (type === "cards") {
      printCards();
      return;
    }
    if (typeof window !== "undefined") window.print();
  };

  const handleDocx = async () => {
    // Q1-2027: switch по типу — lesson-plan и ktp дают DOCX, presentation даёт PPTX.
    if (type === "lesson-plan" && lessonPlan) {
      const blob = await generateLessonPlanDocx(lessonPlan);
      const filename = buildFilename(lessonPlan.subject, lessonPlan.grade, lessonPlan.topic, "plan");
      downloadBlob(blob, filename);
      toast({ tone: "success", title: "DOCX скачан", description: "Откройте в Word или LibreOffice" });
      return;
    }
    if (type === "ktp" && ktp) {
      const blob = await generateKtpDocx(ktp);
      const filename = buildFilename(ktp.subject, ktp.grade, ktp.schoolYear, "ktp");
      downloadBlob(blob, filename);
      toast({ tone: "success", title: "DOCX скачан", description: "Откройте в Word или LibreOffice" });
      return;
    }
    if (type === "presentation" && presentation) {
      const blob = await generatePptx(presentation);
      downloadBlob(blob, pptxFilename(presentation));
      toast({ tone: "success", title: "PPTX скачан", description: "Откройте в PowerPoint или Google Slides" });
      return;
    }
    // TZ-16 §3.1: карточки — DOCX с таблицей для разрезания.
    if (type === "cards" && cardSet) {
      const blob = await generateCardsDocx(cardSet);
      const filename = buildFilename(cardSet.subject, cardSet.grade, cardSet.topic, "cards");
      downloadBlob(blob, filename);
      toast({ tone: "success", title: "DOCX скачан", description: "Карточки с рамками — режьте и раздавайте" });
      return;
    }
    // TZ-16 §3.2: материалы — ZIP-архив со всеми файлами комплекта.
    if (type === "materials" && materialBundle) {
      const blob = await generateMaterialsZip(materialBundle);
      const filename = materialsZipFilename(materialBundle);
      downloadBlob(blob, filename);
      toast({
        tone: "success",
        title: "ZIP скачан",
        description: `${materialBundle.files.length} ${pluralizeFiles(materialBundle.files.length)} в архиве`,
      });
      return;
    }
    // TZ-16 §3.4: «урок целиком» — один ZIP со всеми готовыми слотами.
    // Частичный комплект скачивается как есть: сколько собралось, столько
    // файлов в архиве, без заглушек на месте отказавших слотов.
    if (type === "lesson-bundle" && lessonBundle) {
      const ready = bundleReadyCount(lessonBundle);
      if (ready === 0) {
        toast({
          tone: "error",
          title: "Скачивать нечего",
          description: "Ни один файл не собрался — попробуйте ещё раз",
        });
        return;
      }
      const blob = await generateBundleZip(lessonBundle);
      const filename = bundleZipFilename(lessonBundle);
      downloadBlob(blob, filename);
      toast({
        tone: "success",
        title: "ZIP скачан",
        description:
          lessonBundle.failed.length === 0
            ? `${ready} ${pluralizeFiles(ready)} в архиве`
            : `${ready} из 4 ${pluralizeFiles(ready)} · остальные не собрались`,
      });
      return;
    }
    if (!worksheet) return;
    const blob = await generateWorksheetDocx(worksheet, {
      withAnswers,
      withExplanations,
      // ТЗ-34: страница «Критерии оценивания» — ПОСЛЕ ключа. Для рабочего
      // листа блок пустой, и страницы в файле не будет: лист учитель раздаёт,
      // а не оценивает.
      evaluation,
      // Пометка «демонстрационная заготовка» должна попасть В ФАЙЛ: на экране
      // её видно плашкой, а выгрузка уходит из приложения — и без неё учитель
      // раздаёт заготовку, не зная об этом (NEW-EXPORT-1).
      isDemo: isDemoResult,
    });
    // Номер варианта в имени файла — ТОЛЬКО для контрольной со вторым вариантом
    // (08.10.2026). Без этого суффикса оба варианта сохранялись под одним
    // именем `drobi-5kl-drobi.docx`, и второй вариант ПЕРЕЗАПИСЫВАЛ первый:
    // учитель скачивал вариант 1, переключался на вариант 2, скачивал снова —
    // и на диске оставался один файл. Ровно тот случай, когда «два варианта»
    // снова оказываются одним.
    const hasSecondVariant = type === "control" && Boolean(controlVariant2);
    const filename = buildFilename(
      worksheet.subject,
      worksheet.grade,
      worksheet.topic,
      hasSecondVariant ? `variant-${controlVariant}` : undefined,
    );
    downloadBlob(blob, filename);
    toast({ tone: "success", title: "DOCX скачан", description: "Откройте в Word или LibreOffice" });
  };

  /**
   * F-05: проверить ответы листа по нажатию.
   *
   * Раньше проверка была привязана к генератору-заглушке, то есть бейдж
   * «проверено» получала заготовка, а настоящий лист с сервера — никогда
   * (BL-01 из docs/25-audit-llm-verification-2026-10-06.md). Теперь проверку
   * запускает учитель, она идёт по одному заданию за раз, а результат
   * расставляется по заданиям на месте — без перегенерации листа.
   */
  const handleVerifyAnswers = async () => {
    // `kind` в разметке — локальная переменная блока превью, в хендлере её
    // нет. Здесь судим по `worksheet`: проверять имеет смысл только рабочий
    // лист, а у остальных типов заданий другой смысл и другой бейдж.
    if (!worksheet) return;

    // Заготовку не проверяем: её ответы заведомо верны, проверка осмысленного
    // результата не даёт и стоит платных вызовов.
    if (isDemoResult) {
      toast({
        tone: "error",
        title: "Это заготовка",
        description: "Проверять можно только настоящий лист, собранный под вашу тему",
      });
      return;
    }

    verifyAbortRef.current?.abort();
    const controller = new AbortController();
    verifyAbortRef.current = controller;

    try {
      const tasks = await verifyWorksheetTasks(
        worksheet,
        (p) => setVerifyProgress(p),
        { signal: controller.signal }
      );
      // Сохраняем ТОЛЬКО проверенные задания: если прогон прервали, у
      // непроверенных счётчик нулевой, а не «проверено и неверно».
      setWorksheet({ ...worksheet, tasks });
      trackEvent("worksheet_verify_answers", {
        total: tasks.length,
        matched: tasks.filter((t) => t.verified === true).length,
        checked: tasks.filter((t) => t.verified !== undefined).length,
      });
    } finally {
      verifyAbortRef.current = null;
    }
  };

  const handleSaveFavorite = () => {
    // Q1-2027: избранное работает для всех типов артефактов.
    const target = worksheet ?? lessonPlan ?? presentation ?? ktp;
    if (!target) return;
    saveFavorite(target);
    toggleFavorite(target.id);
    toast({ tone: "success", title: "Добавлено в избранное" });
  };

  /**
   * ТЗ-21, блок 2: сохранить текущий артефакт как шаблон прямо в конструкторе.
   *
   * Пишет на устройство всегда, на сервер — когда есть сессия, поэтому
   * анонимный учитель получает рабочий шаблон без всяких условий, а
   * залогиненный — ещё и переезд на другое устройство.
   */
  const handleSaveTemplate = async () => {
    const target = worksheet ?? lessonPlan ?? presentation ?? ktp;
    if (!target) return;
    const res = await saveTemplate(target);
    trackEvent("dashboard_template_saved", { from: "constructor" });
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

  /**
   * F-08: открыть floating-панель AI-правок из тулбара.
   * EditChat — uncontrolled-компонент со своим fixed-кнопкой в правом нижнем углу.
   * Чтобы тулбар-кнопка могла открывать ту же панель — программно кликаем по
   * aria-labeled кнопке EditChat. Это костыль, но без модификации компонента
   * F-08 — единственный путь. См. задачу TZ-09.
   */
  const handleOpenEditChat = React.useCallback(() => {
    if (typeof document === "undefined") return;
    const btn = document.querySelector<HTMLButtonElement>(
      '[aria-label="Открыть чат с ИИ для правок"]',
    );
    btn?.click();
  }, []);

  /**
   * F-06: переключить inline-панель проверки фото тетради.
   * При показе — закрываем чат AI-правок, чтобы не было двух fixed-панелей.
   */
  const handleTogglePhotoCheck = React.useCallback(() => {
    setPhotoCheckOpen((v) => !v);
  }, []);

  /**
   * Жалоба 1 (12.10.2026): приход с карточки «Проверка работ по фото».
   *
   * Пока учитель ничего не выбрал и ещё не нажал «Сделать лист», показываем
   * ТОЛЬКО экран входа — на всю ширину. Так карточка «Попробовать» наконец
   * приводит в проверку, а не в генератор (жалоба «клик открывает генератор,
   * а не проверку»).
   */
  const photoLandingFullScreen =
    photoCheckOpen && !photoCheckLanded && !worksheet && !generating && (!subject || grade === null);
  /** Правую колонку прячем только на первом экране И когда вход не показан. */
  const showSidePanel = photoLandingFullScreen || !(step === "select" && mode === "topic");

  return (
    <>
      {/* Печатная вёрстка конструктора — см. CONSTRUCTOR_PRINT_CSS выше. */}
      <style dangerouslySetInnerHTML={{ __html: CONSTRUCTOR_PRINT_CSS }} />
      <div className="container-tight py-8 sm:py-12 ctor-print-root">
        <div className={`ctor-grid grid gap-6 lg:gap-8 items-start ${photoLandingFullScreen || (step === "select" && mode === "topic") ? "grid-cols-1" : "lg:grid-cols-[420px_1fr]"}`}>
          {/* Left: form / steps. На экране входа по фото форма не рендерится вовсе:
              учитель пришёл проверять тетрадь, а не выбирать предмет.
              no-print: на печати нужен лист, а не мастер — без этого вся левая
              колонка уезжала на бумагу вместе с листом. */}
          {!photoLandingFullScreen && (
          // min-w-0 — обязателен, а не косметика (ТЗ-26 Б-2). Без него grid-item
          // получает `min-width: auto`, то есть свою min-content-ширину. В панели
          // параметров есть строка-однострочник с длинной темой («🧮 Алгебра · 8 кл
          // · Рациональные дроби…») — её min-content равен полной ширине текста.
          // Итог был такой: колонка `.ctor-grid` шириной 358 px при треке 753 px,
          // переполнение 379 px на экране 390 px, и за экраном оставались шаги,
          // два варианта сложности из трёх и вторая кнопка. `min-w-0` снимает
          // автоматический минимум, и колонка живёт по ширине контейнера.
          <div className="no-print min-w-0 lg:sticky lg:top-20 space-y-5">
            {/* F-04-C: переключатель режима. Доступен на любом шаге. */}
            <ModeToggle mode={mode} onChange={handleModeChange} />

            <StepHeader
              step={step}
              mode={mode}
              onStep={(s) => setStep(s)}
              subject={mode === "topic" ? subject : examSubject}
              grade={mode === "topic" ? grade : (exam === "oge" ? 9 : 11)}
              examLabel={mode === "exam" && exam ? (exam === "oge" ? "ОГЭ" : "ЕГЭ") : null}
            />

            {/* ====== Topic-mode шаги (компактный 3-шаговый flow) ====== */}

            {/* Шаг 1, блок «Что делаем». 15.10.2026.

                ЗАЧЕМ. Тип материала был виден только на шаге 3 («Параметры»),
                а на первом шаге — три значения (Лист/Тест/Карточки) и то за
                переключателем «Свой вариант». Учитель, которому нужен план
                урока или КТП, не мог узнать, что они есть: он обязан был
                пройти путь рабочего листа до последнего шага.

                ПОЧЕМУ ЗДЕМ, А НЕ В САМОМ SelectStep. SelectStep исчезает, как
                только выбраны предмет и класс, а блок ниже (сценарий) —
                появляется. Тип должен быть виден и до, и после этого выбора,
                иначе он снова спрячется. Отдельная карточка над обоими
                блоками — единственное место, которое живёт весь шаг 1.

                Повтор на шаге «Параметры» НЕ убран: там тип меняют вплотную к
                настройкам, и это привычный ход. Два входа в одну настройку
                лучше одного невидимого. */}
            {mode === "topic" && step === "select" && (
              <Card className="mb-4">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h1 className="text-lg font-semibold text-warm-950">Что делаем</h1>
                  <span className="text-xs text-warm-500 shrink-0">
                    {/* ТЗ-32 B7. Раньше здесь стояло голое «8 форматов», и оно
                        вводило в заблуждение: план урока, презентация и КТП
                        доступны только в тарифе «Плюс», то есть из восьми на
                        бесплатном тарифе доступно пять. Число оставляем —
                        оно правдивое, — но добавляем вторую часть, чтобы
                        учитель не обежал покупать подписку ради рабочего листа
                        и не потерял три формата в конце списка. */}
                    {ARTIFACT_TYPE_OPTIONS.length + 1} форматов, три — в тарифе «Плюс»
                  </span>
                </div>
                <ArtifactTypePicker
                  value={type}
                  onChange={handleStep1TypeChange}
                  hasPlus={serverUsage?.plan === "plus"}
                />
                {/* Интерактив — рабочий тип, но живёт вне ARTIFACT_TYPE_OPTIONS
                    (см. комментарий в ConfigureStep): на шаге 1 он тоже должен
                    быть виден, иначе игра снова останется секретом. */}
                <button
                  type="button"
                  onClick={() => handleStep1TypeChange("interactive")}
                  aria-pressed={type === "interactive"}
                  data-testid="pick-type-interactive-step1"
                  className={`mt-1.5 w-full h-10 px-3 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 flex items-center gap-2 ${
                    type === "interactive"
                      ? "bg-brand-700 text-white"
                      : "border border-warm-200 bg-white text-warm-900 hover:border-warm-300 hover:bg-warm-50"
                  }`}
                >
                  <span aria-hidden>🎮</span>
                  <span>Интерактив</span>
                </button>
              </Card>
            )}

            {mode === "topic" && step === "select" && (!subject || grade === null) && (
              <SelectStep
                subject={subject}
                grade={grade}
                onSubject={(s) => {
                  setSubject(s);
                  setGrade(null);
                  setUmk(null);
                  setTopic(null);
                  // F-02: смена предмета сбрасывает выбор preset'а (мог быть для другого предмета).
                  setSelectedPresetId(null);
                  setPresetMode("template");
                }}
                onGrade={handleGradeChangeInline}
                onNext={handleSelectNext}
              />
            )}

            {/* F-02: шаг выбора preset'а появляется на шаге 1 после того, как юзер выбрал и предмет, и класс.
                Заменяет кнопку «Далее» — теперь выбор шаблона = переход на «Тема». */}
            {mode === "topic" && step === "select" && subject && grade !== null && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h1 className="text-lg font-semibold text-warm-950">Сценарий</h1>
                    <p className="text-xs text-warm-500 mt-0.5">
                      Выбраны: {getSubject(subject)?.title} · {grade} кл. Можно поменять в шаге «Что».
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Возврат к выбору предмета/класса.
                      setGrade(null);
                      setUmk(null);
                      setTopic(null);
                      handleBackFromPresets();
                    }}
                    leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
                  >
                    Назад
                  </Button>
                </div>
                <PresetGrid
                  grade={grade}
                  mode={presetMode}
                  onModeChange={setPresetMode}
                  onSelectPreset={handleSelectPreset}
                  onSkipToTopic={handleSkipPresetToTopic}
                  selectedPresetId={selectedPresetId}
                  customType={customType}
                  onCustomTypeChange={handleCustomTypeChange}
                />
              </Card>
            )}

            {mode === "topic" && step === "topic" && subjectData && gradeData && (
              <TopicStep
                subjectData={subjectData}
                gradeData={gradeData}
                umk={umk}
                onSelectUmk={setUmk}
                onSelect={(t) => { setTopic(t); setStep("configure"); }}
                onBack={handleBackToSelect}
              />
            )}

            {/* ====== Exam-mode шаги (F-04-C) ====== */}
            {mode === "exam" && step === "exam-select" && (
              <ExamSelectStep
                selected={exam}
                onSelect={(e) => { setExam(e); setExamSubject(null); setExamNumbers([]); setStep("exam-subject"); }}
              />
            )}

            {mode === "exam" && step === "exam-subject" && exam && (
              <ExamSubjectStep
                exam={exam}
                selected={examSubject}
                onSelect={(s) => { setExamSubject(s); setExamNumbers([]); setStep("exam-number"); }}
                onBack={() => setStep("exam-select")}
              />
            )}

            {mode === "exam" && step === "exam-number" && exam && examSubject && (
              <ExamNumberStep
                exam={exam}
                subject={examSubject}
                numbers={examNumbers}
                onNumbersChange={setExamNumbers}
                onBack={() => setStep("exam-subject")}
                onNext={() => setStep("configure")}
              />
            )}

            {/* ====== Параметры (общий шаг для обоих режимов) ====== */}
            {step === "configure" && (
              <ConfigureStep
                type={type}
                onArtifactTypeChange={handleArtifactTypeChange}
                difficulty={difficulty}
                setDifficulty={setDifficulty}
                count={count}
                setCount={setCount}
                withAnswers={withAnswers}
                setWithAnswers={setWithAnswers}
                withExplanations={withExplanations}
                setWithExplanations={setWithExplanations}
                remaining={remaining}
                generating={generating}
                /** Плюс-фичи закрыты для всех, у кого нет тарифа plus.
                 *  Раньше здесь стояло `hasPlus={true}` с комментарием
                 *  «Q1-2027: привяжем позже» — то есть платный порог не работал
                 *  вообще: КТП, презентации и план урока были доступны каждому,
                 *  и на тариф Плюс не было даже намёка на ограничение.
                 *  Источник — серверный usage.plan, он уже приходит из useUsage. */
                hasPlus={serverUsage?.plan === "plus"}
                /** TZ-12: если юзер пришёл через preset и его тип совпадает с current `type`,
                 * скрываем сегментер (показываем компактный chip с «Изменить»). */
                presetLocked={
                  selectedPresetId
                    ? PRESETS.find((p) => p.id === selectedPresetId) ?? null
                    : null
                }
                onClearPresetLock={() => {
                  setSelectedPresetId(null);
                  setPresetMode("custom");
                }}
                summary={mode === "topic"
                  ? subjectData && grade
                    ? `${subjectData.emoji} ${subjectData.title} · ${grade} кл${topic && gradeData?.topics.find((tt) => tt.slug === topic) ? ` · ${gradeData.topics.find((tt) => tt.slug === topic)!.title}` : ""}`
                    : null
                  : exam && examSubject
                    ? `${exam === "oge" ? "ОГЭ" : "ЕГЭ"} · ${getSubject(examSubject)?.shortTitle ?? examSubject}${examNumbers.length ? ` · № ${examNumbers.join(", ")}` : ""}`
                    : null}
                onEditSummary={() => {
                  if (mode === "exam") setStep("exam-number");
                  else setStep("select");
                }}
                onGenerate={generate}
                onReset={reset}
                selectedPresetId={selectedPresetId}
                selectedPresetTitle={selectedPresetTitle}
              />
            )}
          </div>
          )}

          {/* Right: preview / empty state (hidden on Шаг 1, full width for subject picker).
              Исключение — вход по фото: он и есть то, куда пришёл учитель,
              поэтому на первом экране он занимает всю ширину (жалоба 1). */}
          {showSidePanel && (
          // min-w-0 — по той же причине, что и у левой колонки (ТЗ-26 Б-2):
          // колонка с листом содержит таблицы и формулы, у которых min-content
          // шире экрана телефона.
          <div className="min-w-0">
            {/* Приход по `?photo=1` с карточки «Проверка работ по фото» — показываем
                ВХОД в проверку, а не генератор (08.10.2026). Раньше флаг
                раскрывал `PhotoCheckPanel`, который рендерится только после
                генерации листа, поэтому учительница после «Попробовать»
                видела генератор. Подробности — в PhotoCheckEntry.

                С 18.10.2026 вход виден и когда лист УЖЕ есть (BUG-040): раньше
                условие `!worksheet` его прятало, и учитель с любым готовым
                листом попадал в генератор вместо проверки. */}
            {!generating && photoCheckOpen && (
              <PhotoCheckEntry
                /* Аудит 18.10.2026 (BUG-040): экран входа прятался условием
                   `!worksheet`, поэтому учитель с готовым листом нажимал
                   «Проверить фото» и проваливался в генератор — проверки на
                   экране не было вовсе. Теперь вход виден всегда, а текст и
                   кнопка зависят от того, есть ли уже эталон. */
                hasSource={Boolean(worksheet)}
                onUseSource={() => {
                  const panel = document.getElementById("photo-check-panel");
                  panel?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                onCreateSource={() => {
                  // Флаг НЕ сбрасываем: он означает «учитель пришёл за проверкой
                  // по фото». Если его закрыть здесь, то после генерации листа
                  // панель не откроется сама — учителю пришлось бы ещё раз
                  // нажимать «Проверить фото». Именно это и обещает текст на
                  // экране входа, обещание без кода было бы враньём.
                  //
                  // Экран входа при этом исчезает сам: он рендерится только
                  // пока нет листа (`!worksheet`).
                  setMode("topic");
                  setStep("select");
                  // Снятие флага «только что пришёл с карточки»: дальше
                  // учитель выбирает предмет и класс — возвращаем генератор.
                  setPhotoCheckLanded(true);
                }}
                onOpenHistory={() => {
                  setPhotoCheckOpen(false);
                  window.location.assign("/dashboard");
                }}
              />
            )}

            {/* Лист 4.1.1: панель интерактива — на месте пустого состояния. Этот тип
                не показывает «Как будет выглядеть результат» с миниатюрой
                (FormatChooser в панели и есть выбор формата), поэтому два
                блока выбора на экране были бы шумом. */}
            {type === "interactive" &&
              !generating &&
              !photoCheckOpen && (
              <InteractivePreview
                format={activeInteractiveFormat}
                onFormatChange={setInteractiveFormat}
                worksheetTitle={worksheet?.title ?? null}
                taskCount={worksheet?.tasks.length ?? null}
                subject={subject}
                grade={grade}
                loggedIn={isLoggedIn}
                serverWorksheetId={savedWorksheetId}
                savingWorksheet={savingWorksheet}
                worksheetIsDemo={isDemoResult}
                building={buildingInteractive}
                stage={interactiveStage}
                outOfQuota={remaining === 0 && !isPaidPlan(serverUsage?.plan)}
                interactive={interactive}
                error={interactiveError}
                onBuild={buildInteractive}
                registerBuild={registerInteractiveBuild}
              />
            )}

            {/* Пустое состояние — только когда материала нет ЛЮБОГО типа.
                Проверка была только на `worksheet`, поэтому у остальных шести
                типов (карточки, КТП, презентация, план урока, материалы, урок
                целиком) панель «Как будет выглядеть результат» оставалась на
                экране поверх готового материала — и уходила на печать вместе
                с ним: на листе оказывался блок с кнопкой «Попробовать» и
                миниатюрой чужого формата. Для интерактива (лист 4.1.1) его
                место занимает панель игры выше. */}
            {type !== "interactive" &&
              !worksheet &&
              !lessonPlan &&
              !presentation &&
              !ktp &&
              !cardSet &&
              !materialBundle &&
              !lessonBundle &&
              !generating &&
              !photoCheckOpen && (
              <EmptyPreview
                mode={mode}
                subject={mode === "topic" ? subjectData : (examSubject ? getSubject(examSubject) : null)}
                grade={mode === "topic" ? grade : (exam === "oge" ? 9 : exam === "ege" ? 11 : null)}
                exam={mode === "exam" ? exam : null}
                examNumbers={mode === "exam" ? examNumbers : []}
                /** F-09: показываем превью выбранного типа, чтобы пользователь понимал,
                    что получит после генерации. */
                type={type}
                onPickPopular={() => {
                  /**
                   * «Попробовать» ведёт в ВЫБРАННЫЙ предмет (08.10.2026).
                   *
                   * Раньше здесь стояло `setSubject("math"); setGrade(5)`, а
                   * подпись кнопки была зашита как «Попробовать: дроби, 5
                   * класс». Учительница выбирала «Окружающий мир, 4 класс» —
                   * и кнопка уводила в математику. Подпись и действие
                   * совпадали только потому, что совпадали оба с математикой.
                   *
                   * Теперь берём то, что учитель уже выбрал. Если предмета нет,
                   * показываем список предметов, а не подставляем чужую
                   * дисциплину молча.
                   */
                  if (!subject || !grade) {
                    setMode("topic");
                    setStep("select");
                    return;
                  }
                  const g = getGrade(subject, grade);
                  if (g && g.topics[0]) {
                    setTopic(g.topics[0].slug);
                    setStep("configure");
                  }
                }}
              />
            )}

            {generating && <GeneratingState stage={progressStage} />}

            {/* Q1-2027: switch по типу — рендерим правильный preview + кнопки.
             * TZ-16 §4.3 (точка 5): `kind` выводится ИЗ `type` (resultKindForType),
             * а не из «первого не-нуль». Старый код полагался на то, что
             * handleArtifactTypeChange сбрасывает все артефакты; при 9 типах
             * и параллельной генерации пакета одна забытая ветка = показ
             * чужого артефакта. Плюс добавлена проверка, что артефакт
             * соответствующего вида реально есть — иначе placeholder. */}
            {!generating && (() => {
              const kind = resultKindForType(type);
              // Лист 4.1.1: у интерактива своя панель выше, а не этот блок.
              // Здесь живут заголовок, кнопки PDF/DOCX и печать — для игры они
              // неверны (скачать нечего, печатать нечего: у игры ссылка и QR).
              if (kind === "interactive") return null;
              const hasArtifact = Boolean(
                kind === "worksheet" ? worksheet
                : kind === "lesson-plan" ? lessonPlan
                : kind === "presentation" ? presentation
                : kind === "cards" ? cardSet
                : kind === "materials" ? materialBundle
                : kind === "lesson-bundle" ? lessonBundle
                : ktp,
              );
              if (!kind || !hasArtifact) return null;

              const title =
                kind === "worksheet" ? worksheet!.title :
                kind === "lesson-plan" ? lessonPlan!.title :
                kind === "presentation" ? presentation!.title :
                kind === "cards" ? cardSet!.title :
                kind === "materials" ? materialBundle!.title :
                kind === "lesson-bundle" ? lessonBundle!.title :
                ktp!.title;

              const subtitle =
                kind === "worksheet"
                  ? // Вариант контрольной — теперь настоящий, из двух листов,
                    // поэтому в подписи именно он. Раньше здесь стоял
                    // `variantNoRef.current` из `Math.random()`: учительница
                    // получила один лист с надписью «вариант 4».
                    `${worksheet!.tasks.length} ${pluralizeTasks(worksheet!.tasks.length)} · ${type === "control" ? "Контрольная" : "Рабочий лист"}${
                      type === "control" && controlVariant2
                        ? ` · вариант ${controlVariant}`
                        : ""
                    }`
                  : kind === "lesson-plan"
                    ? `План урока · ${lessonPlan!.stages.length} этапов · ~${lessonPlan!.stages.reduce((s, x) => s + x.durationMin, 0)} мин`
                    : kind === "presentation"
                      ? `Презентация · ${presentation!.slideCount} слайдов · тема ${presentation!.theme}`
                      : kind === "cards"
                        ? `Карточки · ${cardSet!.cards.length} шт. · для повторения`
                        : kind === "materials"
                          ? `Материалы · ${materialBundle!.files.length} ${pluralizeFiles(materialBundle!.files.length)} · комплект`
                          : kind === "lesson-bundle"
                            ? `Урок целиком · ${bundleReadyCount(lessonBundle!)} из 4 · ${lessonBundle!.failed.length === 0 ? "всё готово" : "частично"}`
                            : `КТП · ${ktp!.schoolYear} · ${ktp!.totalHours} ч`;

              // TZ-16 §3.2/§3.4: материалы и «урок целиком» отдаются архивом,
              // а не одним документом — подпись кнопки должна соответствовать
              // формату файла.
              const downloadLabel =
                kind === "presentation" ? "PPTX"
                : kind === "materials" || kind === "lesson-bundle" ? "ZIP"
                : "DOCX";

              // З4: экспорт по типу устройства.
              //   - Тач (iPad/планшет/телефон): главная кнопка «Сохранить в PDF»,
              //     DOCX не предлагаем вообще — на iPad скачивание файла неудобно,
              //     печать работает через системный диалог «Сохранить в PDF».
              //   - Десктоп: PDF первой кнопкой + «Скачать DOCX» для редактирования.
              // Для презентации печать бессмысленна (слайды), поэтому там, как и
              // раньше, остаётся только скачивание PPTX — на любом устройстве.
              // TZ-16 §3.4: пакет из 4 артефактов в PDF не превращается —
              // печатать нечего, полезен только ZIP. Поэтому «урок целиком»
              // ведёт себя как презентация: одна кнопка скачивания, без PDF.
              const isDocxArtifact = kind !== "presentation" && kind !== "lesson-bundle";
              const showPdfButton = isDocxArtifact;
              const showDownloadButton = isDocxArtifact ? !isTouch : true;

              return (
                <div className="space-y-4">
                  {/* F-09: перестроили toolbar — заголовок на всю ширину,
                      кнопки действий под ним отдельной строкой с flex-wrap,
                      чтобы не уезжали за экран и не давили заголовок. */}
                  <div className="no-print">
                    <h2 className="text-xl font-semibold text-warm-950 break-words">{title}</h2>
                    <p className="text-sm text-warm-500 mt-0.5 break-words">{subtitle}</p>
                  </div>
                  <div className="no-print flex flex-wrap items-center gap-2">
                    {/* З4: PDF — первая кнопка в ряду и главное действие на таче.
                        Жалоба «не поняла где жмакать» = нужна не аббревиатура,
                        а понятная подпись. */}
                    {showPdfButton && (
                      <Button variant="primary" size="sm" leftIcon={<Download className="w-4 h-4" />} onClick={handlePrint}>
                        Сохранить в PDF
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" leftIcon={<Heart className="w-4 h-4" />} onClick={handleSaveFavorite}>
                      <span className="hidden sm:inline">В избранное</span>
                      <span className="sm:hidden">Избранное</span>
                    </Button>
                    {/* ТЗ-21, блок 2: кнопка «Как шаблон» сразу после генерации.
                        Раньше `addTemplate` вызывался только со страницы превью,
                        а попасть в превью можно было лишь из избранного — то
                        есть входной точки у функции не было вообще. Теперь
                        учитель сохраняет настройки одним кликом, не выходя из
                        конструктора. */}
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<LayoutTemplate className="w-4 h-4" />}
                      onClick={handleSaveTemplate}
                      data-testid="save-as-template"
                    >
                      <span className="hidden sm:inline">Как шаблон</span>
                      <span className="sm:hidden">Шаблон</span>
                    </Button>
                    {/* ТЗ-36: «Новый вариант» делает НАСТОЯЩУЮ генерацию — то
                        есть тратит квоту (у платного тарифа — деньги, у
                        бесплатного — одну из пяти попыток). Без подписи
                        учитель видит, что попытка исчезла, и не понимает
                        куда: раньше это выглядело как «нажал и ничего не
                        изменилось». Формулировка — за владельцем (см.
                        docs/backlog.md, «Требует решения владельца»); по
                        умолчанию подпись есть, потому что молчание тут
                        дороже. */}
                    <div className="flex flex-col items-start gap-1">
                      <Button variant="secondary" size="sm" leftIcon={<RotateCcw className="w-4 h-4" />} onClick={handleNewVariant} loading={generating}>
                        <span className="hidden sm:inline">Новый вариант</span>
                        <span className="sm:hidden">Заново</span>
                      </Button>
                      <span className="text-xs text-warm-500 max-w-[15rem] leading-snug">
                        Новый вариант — это новая генерация, она расходует квоту
                      </span>
                    </div>
                    {/* Переключатель двух вариантов КОНТРОЛЬНОЙ (08.10.2026).
                        Логика вынесена в ControlVariantSwitch, потому что её
                        ломало: чтение «варианта 1» из `worksheet` (того, что
                        сейчас на экране) делало возврат к первому варианту
                        невозможным. Компонент принимает оба варианта и ничего
                        не знает про `worksheet`. */}
                    {/* ТЗ-25 (AD-7): предупреждение о потерях материала.
                        Показывается ВСЕМ типам работ, а не только контрольной:
                        разрыв 5 бьёт по листу, тесту и ОГЭ одинаково. Блок
                        появляется только когда есть что сказать — пустой
                        «всё в порядке» был бы тем же молчанием. */}
                    {qualityNotice && (
                      <div className="w-full">
                        <QualityNoticeBanner notice={qualityNotice} />
                      </div>
                    )}
                    {kind === "worksheet" && type === "control" && controlVariant1 && (
                      <ControlVariantSwitch
                        variant1={controlVariant1}
                        variant2={controlVariant2}
                        active={controlVariant}
                        onVariantChange={(n) => {
                          setControlVariant(n);
                          // Берём вариант ИЗ СПЕЦИАЛЬНОГО СЛОТА, а не из
                          // `worksheet`: `worksheet` — это то, что сейчас
                          // показано, и оно перезаписывается каждым кликом.
                          const next = n === 1 ? controlVariant1 : controlVariant2;
                          if (next) setWorksheet(next);
                        }}
                      />
                    )}
                    {kind === "worksheet" && (
                      <>
                        {/* З5: кнопка AI-правок — только под флагом, иначе она
                            ведёт в заглушку EditChat (stub). */}
                        {EDIT_CHAT_ENABLED && (
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={<Sparkles className="w-4 h-4" />}
                            onClick={handleOpenEditChat}
                            aria-label="Открыть правки через ИИ"
                            data-testid="open-edit-chat"
                          >
                            <span className="hidden sm:inline">Правки через ИИ</span>
                            <span className="sm:hidden">ИИ</span>
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Camera className="w-4 h-4" />}
                          onClick={handleTogglePhotoCheck}
                          aria-expanded={photoCheckOpen}
                          aria-controls="photo-check-panel"
                          data-testid="toggle-photo-check"
                        >
                          <span className="hidden sm:inline">
                            {photoCheckOpen ? "Скрыть проверку" : "Проверить фото"}
                          </span>
                          <span className="sm:hidden">Фото</span>
                        </Button>
                        {/* TZ-12, этап 4: выдача листа по ссылке/QR. Отдельная
                            кнопка, а не «ещё один пункт меню»: это второй по
                            ценности шаг после «сделать лист» — экономия бумаги
                            и времени на раздачу. Неавторизованному — вход. */}
                        {profileChecked &&
                          (isLoggedIn ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<Send className="w-4 h-4" />}
                              onClick={() => setShareFormOpen(true)}
                              data-testid="open-share-form"
                            >
                              <span className="hidden sm:inline">Выдать классу</span>
                              <span className="sm:hidden">Выдать</span>
                            </Button>
                          ) : (
                            <Button
                              as="link"
                              href="/login"
                              variant="secondary"
                              size="sm"
                              leftIcon={<Lock className="w-4 h-4" />}
                              data-testid="share-form-login"
                            >
                              <span className="hidden sm:inline">
                                Войдите, чтобы выдать лист классу
                              </span>
                              <span className="sm:hidden">Войти</span>
                            </Button>
                          ))}
                      </>
                    )}
                    {/* З4: на тач-устройствах эта кнопка не рендерится вообще,
                        поэтому `downloadBlob` для docx там недостижим. */}
                    {showDownloadButton && (
                      <Button variant="secondary" size="sm" onClick={handleDocx}>
                        {`Скачать ${downloadLabel}`}
                      </Button>
                    )}
                  </div>

                  {/* З4: на таче объясняем одной строкой, куда нажимать и почему
                      нет DOCX — иначе учительница ищет кнопку, которой нет. */}
                  {isTouch && isDocxArtifact && (
                    <p className="no-print text-xs text-warm-500">
                      На планшете файл сохраняется как PDF. На компьютере можно скачать DOCX для редактирования
                    </p>
                  )}

                  {/* Честность результата. Заготовку нельзя выдавать за AI-материал:
                      на бэке есть только /api/worksheets/generate и /api/exams/generate,
                      поэтому конспекты, презентации, КТП, карточки и комплекты
                      сейчас собираются из шаблона. Учитель должен видеть это прямо
                      на материале, а не после того, как отдаст лист классу. */}
                  {isDemoResult && (
                    <div
                      role="status"
                      className="no-print mb-4 rounded-xl border border-accent-300 bg-accent-50 p-4 text-sm text-warm-900"
                    >
                      <p className="font-semibold">
                        {demoReason === "no_llm_endpoint"
                          ? "Этот материал собран из шаблона"
                          : "Это демонстрационная заготовка"}
                      </p>
                      <p className="mt-1 text-warm-700">
                        {demoReason === "no_llm_endpoint"
                          ? "У этого типа материала пока нет серверной генерации, поэтому задания взяты из шаблона, а не собраны под вашу тему. Формат и разметку посмотреть можно."
                          : "Сервис сейчас недоступен, поэтому задания типовые: они взяты из заготовки, а не собраны под вашу тему. Формат и разметку посмотреть можно, но отдавать такой лист ученикам как проверенный материал не стоит. Попробуйте ещё раз — обычно помогает."}
                      </p>
                      {demoReason !== "no_llm_endpoint" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3"
                          onClick={() => generate()}
                          disabled={generating}
                        >
                          Повторить
                        </Button>
                      )}
                    </div>
                  )}

                  {/* F-05: проверка ответов по кнопке (BL-01).
                      Показывается только для настоящего листа: у заготовки
                      ответы заведомо верны, и проверка была бы тратой денег
                      впустую. */}
                  {kind === "worksheet" && worksheet && !isDemoResult && (
                    <div className="no-print mb-4 rounded-xl border border-warm-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-warm-900">
                            Проверить ответы
                          </p>
                          <p className="mt-1 text-xs text-warm-600">
                            Нейросеть заново решит каждое задание и сверит с вашим ответом.
                            По одному заданию — это 5–20 секунд, весь лист 1–3 минуты.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {verifyProgress?.running ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => verifyAbortRef.current?.abort()}
                            >
                              Остановить
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={handleVerifyAnswers}
                              disabled={generating}
                            >
                              {verifyProgress?.finished ? "Проверить заново" : "Проверить ответы"}
                            </Button>
                          )}
                        </div>
                      </div>

                      {verifyProgress && verifyProgress.done > 0 && (
                        <p className="mt-3 text-xs text-warm-700" role="status">
                          Проверено {verifyProgress.done} из {verifyProgress.total}
                          {verifyProgress.matched !== null &&
                            ` · сошлось ${verifyProgress.matched}`}
                          {verifyProgress.finished && " · готово"}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Водяной знак «ДЕМО» на печать ставит сам превью материала
                      (`<XPreview`, флаг на артефакте): один источник правды на все
                      девять типов. Важная поправка к истории этого места: знак стоял
                      здесь и раньше, и печатался он для ВСЕХ типов, а не только для
                      рабочего листа — блок превью лежит рядом, это сестринские
                      условия, а не вложенный в «worksheet». Поэтому перенос знака
                      внутрь превью меняет не покрытие, а единственность источника:
                      раньше одна страница решала за все типы сразу. */}

                  {kind === "worksheet" && (
                    <WorksheetPreview
                      worksheet={worksheet!}
                      withAnswers={withAnswers}
                      withExplanations={withExplanations}
                      type={type}
                      evaluation={evaluation}
                    />
                  )}
                  {kind === "worksheet" && photoCheckOpen && (
                    <div id="photo-check-panel" className="no-print animate-fade-in">
                      <PhotoCheckPanel
                        assignmentId={`local-${worksheet!.id}`}
                        demoTasks={worksheet!.tasks.map((t) => ({
                          number: t.number,
                          taskText: t.text,
                          correctAnswer: t.answer ?? "—",
                          maxPoints: t.points || 1,
                        }))}
                        onResult={(r: { source?: string; percentage?: number }) =>
                          trackEvent("photo_check_done", {
                            source: r.source,
                            percentage: r.percentage,
                          })
                        }
                        /* Лимит генераций — тихой строкой под фото-проверкой.
                           Тот же источник, что у карточки выше: серверный
                           `useUsage` для залогиненных, localStorage — для
                           анонимов. `limit: null` = безлимит на платном.

                           Аудит 18.10.2026 (BUG-031/037): остаток раньше
                           считался как `generationsLimit - generationsToday` —
                           то есть из СТАРОГО дневного счётчика, который не
                           сбрасывался. Сервер отдаёт `freeRemaining: 5`, а
                           интерфейс показывал 0. Теперь остаток — это
                           `freeRemaining` с сервера, как есть. */
                        quota={{
                          left: serverUsage
                            ? serverUsage.generationsLimit === -1
                              ? 0
                              : Math.max(
                                  0,
                                  serverUsage.freeRemaining ??
                                    serverUsage.generationsLimit -
                                      serverUsage.generationsToday,
                                )
                            : Math.max(0, remaining),
                          limit: serverUsage
                            ? serverUsage.generationsLimit === -1
                              ? null
                              : FREE_GENERATIONS
                            : FREE_GENERATIONS,
                        }}
                      />
                    </div>
                  )}
                  {/* З5: заглушка EditChat (stub) показывается только под флагом
                      `NEXT_PUBLIC_ENABLE_EDIT_CHAT=1`. По умолчанию учитель её
                      не видит — раньше «EditChat (stub)» с полем «Stub input»
                      висел на странице безусловно. Сам компонент не трогаем. */}
                  {EDIT_CHAT_ENABLED && kind === "worksheet" && worksheet && (
                    <EditChat
                      worksheet={worksheet}
                      onApply={(next: import("@/lib/types").Worksheet) => {
                        setWorksheet(next);
                        trackEvent("worksheet_edit_apply", { id: next.id });
                      }}
                    />
                  )}
                  {kind === "lesson-plan" && <LessonPlanPreview plan={lessonPlan!} />}
                  {kind === "presentation" && <PresentationPreview presentation={presentation!} />}
                  {kind === "ktp" && <KtpPreview ktp={ktp!} />}
                  {kind === "cards" && <CardsPreview set={cardSet!} />}
                  {kind === "materials" && <MaterialsPreview bundle={materialBundle!} />}
                  {/* TZ-16 §3.4: 4 слота со статусом. Комплект может быть неполным — */}
                  {/* превью показывает, что именно не собралось и почему.          */}
                  {kind === "lesson-bundle" && <LessonBundlePreview bundle={lessonBundle!} />}

                  <Card className="no-print bg-gradient-to-br from-brand-50 to-white border-brand-200">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-500 grid place-items-center text-white shrink-0">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-warm-950">Лимит бесплатных генераций</h3>
                        {/* W1+п.2: для залогиненного юзера — серверный счётчик (useUsage),
                            для анонимного — localStorage (`limit.ts`). Один источник UI.

                            З11: тарифы без слова «год» в смысле подписки — только «учебный
                            год» (это период обучения, не годовая оплата) и помесячная
                            цена. Старые «375 ₽/мес при оплате за год» убраны. */}
                        <p className="text-sm text-warm-600 mt-1">
                          {(() => {
                            if (serverUsage) {
                              const isUnlimited = serverUsage.generationsLimit === -1;
                              if (isUnlimited) {
                                // `generationsToday` теперь честный дневной счётчик
                                // (ленивый сброс в incrementUserGenerations), поэтому
                                // и подпись говорит «сегодня», а не «всего».
                                return `Безлимит на тарифе «${PLANS[serverUsage.plan].name}». Сегодня сгенерировано: ${serverUsage.generationsToday}.`;
                              }
                              // Остаток — с сервера (freeRemaining), а не вычисленный
                              // из старого счётчика. Раньше здесь было
                              // `generationsLimit - generationsToday`, и при
                              // `generationsToday: 32` учитель с пятью
                              // бесплатными листами видел «Осталось 0 из 5» и
                              // ценник (аудит 18.10.2026, BUG-031/037).
                              const left = Math.max(
                                0,
                                serverUsage.freeRemaining ??
                                  serverUsage.generationsLimit -
                                    serverUsage.generationsToday,
                              );
                              return `Осталось ${left} из ${FREE_GENERATIONS} листов в месяц, обновятся 1-го числа. ${PLANS_TEXT}`;
                            }
                            return `Осталось ${remaining} из ${FREE_GENERATIONS} — счёт общий, обновится 1-го числа. ${PLANS_TEXT}`;
                          })()}
                        </p>
                        <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 transition-all"
                            style={{
                              width: `${(() => {
                                if (serverUsage) {
                                  if (serverUsage.generationsLimit === -1) return 100;
                                  // Та же формула, что и в тексте выше: остаток
                                  // берём с сервера, иначе полоса показывала бы
                                  // «пусто» при полной квоте.
                                  const left = Math.max(
                                    0,
                                    serverUsage.freeRemaining ??
                                      serverUsage.generationsLimit -
                                        serverUsage.generationsToday,
                                  );
                                  return Math.max(
                                    0,
                                    Math.min(100, (left / FREE_GENERATIONS) * 100),
                                  );
                                }
                                return Math.max(0, Math.min(100, (remaining / FREE_GENERATIONS) * 100));
                              })()}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              );
            })()}
          </div>
          )}
        </div>
      </div>

      <PaywallModal open={showPaywall} onClose={() => setShowPaywall(false)} remaining={remaining} />

      {/* TZ-13 §4.9, шаги 3–8: панель создания игры переехала в правую
          колонку конструктора и стала `InteractivePreview` (лист 4.1.1).

          Почему именно туда: старая панель жила отдельным блоком ПОД всей
          страницей и появлялась только при `?interactiveFormat=`, то есть кроме
          ссылки с листа («Оживить урок» до неё доходил) обычный учитель выбрать
          интерактив не мог вовсе. Теперь это обычный тип в шаге «Параметры»,
          а панель игры стоит там же, где результат у остальных типов: рядом с
          параметрами, а не под ними.

          Серверный id листа (`savedWorksheetId`) по-прежнему обязателен:
          ранклер берёт задания из `payload_json` в базе. */}

      {/* TZ-12: «Выдать классу» доступна только для рабочего листа — у плана
          урока, презентации и КТП нет заданий, которые ученик решал бы в браузере.
          `resultKindForType` — тот же маппинг, что и в блоке результата: у типа
          «test» / «control» / «cards» артефакт тоже рабочий лист. */}
      {resultKindForType(type) === "worksheet" && worksheet && (
        <ShareFormDialog
          open={shareFormOpen}
          onClose={() => setShareFormOpen(false)}
          title={worksheet.title}
          subject={String(worksheet.subject)}
          grade={worksheet.grade}
          worksheetId={savedWorksheetId ?? undefined}
          tasks={worksheet.tasks.map(toFormSourceTask)}
        />
      )}
    </>
  );
}

// =============== Step header ===============

function StepHeader({
  step,
  mode,
  onStep,
  subject,
  grade,
  examLabel,
}: {
  step: Step;
  mode: Mode;
  onStep: (s: Step) => void;
  subject: SubjectSlug | null;
  grade: number | null;
  /** Для exam-режима: подпись «ОГЭ» / «ЕГЭ» в badge. */
  examLabel?: string | null;
}) {
  const subjectData = subject ? getSubject(subject) : null;
  /**
   * Счётчик не прыгает: в каждом режиме массив шагов ОДИН И ТОТ ЖЕ от начала
   * до конца, а позиция считается из реального состояния.
   *
   * Раньше было наоборот: пункт «Сценарий» добавлялся в массив только после
   * выбора предмета (3 → 4 пункта), а у «Что» и «Сценарий» был один и тот же
   * внутренний id `select`, из-за чего `findIndex` всегда находил первый.
   * Учитель видел «Шаг 1 из 3» → «Шаг 2 из 4» → «Шаг 2 из 3» и не понимал,
   * сколько осталось.
   *
   * `key` отделён от `step`: два пункта ведут в один `step`, но это разные
   * экраны, и React не должен получать одинаковые ключи.
   */
  const items: Array<{ key: string; step: Step; label: string }> = mode === "exam"
    ? [
        { key: "exam", step: "exam-select", label: "Экзамен" },
        { key: "exam-subject", step: "exam-subject", label: "Предмет" },
        { key: "exam-number", step: "exam-number", label: "Номера" },
        { key: "configure", step: "configure", label: "Параметры" },
      ]
    : [
        { key: "what", step: "select", label: "Что" },
        { key: "scenario", step: "select", label: "Сценарий" },
        { key: "topic", step: "topic", label: "Тема" },
        { key: "configure", step: "configure", label: "Параметры" },
      ];
  const currentIdx =
    mode === "exam"
      ? Math.max(0, items.findIndex((i) => i.step === step))
      : // «Что» и «Сценарий» — два экрана одного `step`: показываем тот,
        // на котором учитель реально стоит.
        step === "select"
        ? subject && grade !== null
          ? 1
          : 0
        : step === "topic"
          ? 2
          : 3;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/" className="text-sm text-warm-500 hover:text-warm-900">
          ← На главную
        </Link>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Badge tone="brand">
          <Sparkles className="w-3 h-3" />
          Шаг {currentIdx + 1} из {items.length}
        </Badge>
        {examLabel && (
          <Badge tone="accent">{examLabel}</Badge>
        )}
        {subjectData && (
          <Badge tone="neutral">{subjectData.emoji} {subjectData.shortTitle}{grade ? ` · ${grade} кл.` : ""}</Badge>
        )}
      </div>
      {/* 4 точки с подписями (в exam-режиме те же 4). Клик на предыдущую точку = вернуться к шагу. */}
      <div className="grid gap-1.5 mb-5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            onClick={() => i < currentIdx && onStep(it.step)}
            disabled={i >= currentIdx}
            className="group flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            aria-label={`Шаг ${i + 1}: ${it.label}`}
          >
            <span
              className={`block w-full h-1.5 rounded-full transition-colors ${
                i <= currentIdx ? "bg-brand-500" : "bg-warm-200"
              }`}
            />
            <span
              className={`text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                i <= currentIdx ? "text-warm-700" : "text-[color:var(--text-muted)]"
              }`}
            >
              {it.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// =============== Select step (предмет + класс на одном экране) ===============

/**
 * Группировка предметов по категориям для шага «Что и для кого».
 * Каждая категория рендерится отдельной секцией с заголовком + 3-6 кол. сеткой.
 */
const SUBJECT_CATEGORIES: { title: string; slugs: SubjectSlug[] }[] = [
  {
    title: "Точные науки",
    slugs: ["math", "algebra", "geometry", "physics", "chemistry", "informatics"],
  },
  {
    title: "Гуманитарные",
    slugs: ["russian", "literature", "history", "social", "okruzhaet"],
  },
  {
    title: "Естественные",
    slugs: ["biology", "geography"],
  },
  {
    title: "Языки",
    slugs: ["english", "german"],
  },
  {
    title: "Остальное",
    slugs: ["obzh", "technology", "finance", "music", "art", "pe"],
  },
];

/**
 * Шаг 1: выбор предмета + класса на одной карточке.
 * Сетка предметов — 3 кол. на мобиле, 4 на планшете, 6 на десктопе (компактнее, чем было).
 * Карточка показывает только emoji + shortTitle + диапазон классов (без длинного описания).
 * Класс — горизонтальный ряд круглых чипов 1-11 (по `subjectData.grades`).
 */
function SelectStep({
  subject,
  grade,
  onSubject,
  onGrade,
  onNext,
}: {
  subject: SubjectSlug | null;
  grade: number | null;
  onSubject: (s: SubjectSlug) => void;
  onGrade: (g: number) => void;
  onNext: (s: SubjectSlug, g: number) => void;
}) {
  // Индекс по slug для O(1) поиска вместо .find внутри map.
  const bySlug = React.useMemo(
    () => new Map(subjects.map((s) => [s.slug, s] as const)),
    []
  );
  const subjectData = subject ? bySlug.get(subject) ?? null : null;

  // Чипы классов: только те, что реально есть у выбранного предмета.
  // Если предмет не выбран — классов не показываем (бессмысленно).
  const gradeNums = subjectData ? subjectData.grades.map((g) => g.num) : [];
  const canGoNext = subject !== null && grade !== null;

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="text-lg font-semibold text-warm-950">Что и для кого</h1>
        <span className="text-xs text-warm-500">Темы по ФГОС, 1–11 классов</span>
      </div>

      {/* Секция 1: КЛАСС — поднял наверх для видимости без скролла. */}
      <div className="mb-2 pb-2 border-b border-warm-100 flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-warm-500 shrink-0">
          Класс
          {subjectData && (
            <span className="ml-1 normal-case font-medium text-warm-700">· {subjectData.shortTitle}</span>
          )}
        </span>
        <div className="flex flex-wrap gap-1">
          {(subjectData ? gradeNums : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).map((g) => {
            const isSelected = grade === g;
            const disabled = !subjectData;
            return (
              <button
                key={g}
                type="button"
                onClick={() => onGrade(g)}
                aria-pressed={isSelected}
                disabled={disabled}
                title={subjectData ? `${g} класс` : "Сначала выберите предмет"}
                className={`h-6 w-6 rounded-full grid place-items-center text-[10px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
                  disabled
                    ? "bg-warm-50 text-warm-500 border border-warm-100 cursor-not-allowed"
                    : isSelected
                      ? "bg-brand-500 text-white border border-brand-500"
                      : "bg-white text-warm-950 border border-warm-200 hover:border-brand-400 hover:bg-brand-50"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* Секция 2: предмет — все категории в одном dense-grid (7 колонок на десктопе). */}
      <div className="space-y-1">
        {SUBJECT_CATEGORIES.map((cat) => (
          <section key={cat.title}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)] mb-0.5">
              {cat.title}
            </h3>
            <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-7 gap-1">
              {cat.slugs.map((slug) => {
                const s = bySlug.get(slug);
                if (!s) return null;
                const isSelected = subject === s.slug;
                return (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => onSubject(s.slug)}
                    aria-pressed={isSelected}
                    title={s.title}
                    className={`group min-h-[40px] px-1.5 py-0.5 rounded-lg border transition-all text-left min-w-0 flex flex-col items-center justify-center ${
                      isSelected
                        ? "border-brand-500 bg-brand-50"
                        : "border-warm-200 hover:border-brand-400 hover:bg-brand-50"
                    }`}
                  >
                    <span className="text-sm leading-none mb-0.5" aria-hidden>{s.emoji}</span>
                    <span className={`font-medium text-[10px] sm:text-[11px] leading-tight truncate w-full text-center ${isSelected ? "text-brand-700" : "text-warm-950 group-hover:text-brand-700"}`}>
                      {s.shortTitle}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Сокращения предметов в школе и в каталоге — разные. Без этой строки
          учитель, который ищет «ОБЗР» или «Окр. мир», не находит свой предмет. */}
      <p className="text-[11px] leading-snug text-warm-500">
        Сокращения: ОБЖ — основы безопасности жизнедеятельности (в документах —
        ОБЗР), Окр. мир — окружающий мир, Фин. грамотность — финансовая
        грамотность, Физ-ра — физическая культура, ИЗО — изобразительное
        искусство.
      </p>

      {/* CTA: «Далее» доступен только когда оба выбраны. Sticky снизу. */}
      <div className="mt-1.5 pt-1.5 border-t border-warm-100 flex items-center justify-end gap-3 sticky bottom-0 bg-white/85 backdrop-blur -mx-5 px-5 -mb-5 pb-3 rounded-b-2xl">
        {!(subject && grade !== null) && (
          <span className="mr-auto text-xs text-warm-500">Выберите предмет и класс</span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={() => subject && grade !== null && onNext(subject, grade)}
          disabled={!canGoNext}
          rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
        >
          Далее
        </Button>
      </div>
    </Card>
  );
}

// =============== Topic step ===============

/**
 * Шаг 2: выбор темы.
 * Если у предмета для выбранного класса есть ≥2 вариантов УМК — сверху показываем
 * inline-чипы. Если 1 вариант — auto-pick сделан в SelectStep.onNext, ничего не показываем.
 * Если УМК нет — секция не рендерится вовсе.
 */
function TopicStep({
  subjectData,
  gradeData,
  umk,
  onSelectUmk,
  onSelect,
  onBack,
}: {
  subjectData: SubjectType;
  gradeData: GradeType;
  umk: string | null;
  onSelectUmk: (id: string) => void;
  onSelect: (t: string) => void;
  onBack: () => void;
}) {
  const umkList = getUMK(subjectData.slug, gradeData.num);

  // З9: выбор учебника влияет только на темы, у которых проставлены метки
  // `Topic.umk`. Сейчас метки есть ТОЛЬКО у алгебры (7-9 кл), у остальных 20
  // предметов их нет — значит переключатель автора ничего не меняет, а
  // учительница всё равно его видит («нет смысла выбирать автора»).
  // Поэтому показываем чипы только когда в выбранном классе есть размеченные
  // темы: тогда выбор действительно на что-то влияет.
  const hasMarkedTopics = gradeData.topics.some((t) => !!t.umk && t.umk.length > 0);
  const showUmkChips = umkList.length > 1 && hasMarkedTopics;

  // F-09: реальный фильтр по УМК. Тема показывается если:
  //   - у темы НЕТ поля umk (общая для всех УМК), или
  //   - выбранный umk входит в список umk темы.
  // Без активного фильтра показываем всё (на случай если UMK не выбран).
  const filteredTopics = gradeData.topics.filter((t) => {
    if (!umk) return true;
    if (!t.umk || t.umk.length === 0) return true;
    return t.umk.includes(umk);
  });

  /**
   * З8: список тем больше не прячет полосу прокрутки и прямо говорит,
   * сколько тем показано из скольких, плюс кнопка «Показать все».
   * Жалоба была «там всего 4 темы… пролистала — а там всего 8»: список
   * обрезался по `max-h`, а класс `scrollbar-hide` прятал полосу прокрутки.
   */
  const [showAllTopics, setShowAllTopics] = React.useState(false);
  // Смена предмета/класса/учебника = новый список → снова сворачиваем.
  React.useEffect(() => {
    setShowAllTopics(false);
  }, [subjectData.slug, gradeData.num, umk]);

  const topicsTotal = filteredTopics.length;
  const visibleTopics = showAllTopics
    ? filteredTopics
    : filteredTopics.slice(0, TOPICS_PREVIEW_COUNT);
  const canShowMore = !showAllTopics && topicsTotal > TOPICS_PREVIEW_COUNT;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold text-warm-950">Выберите тему</h1>
        <Button variant="ghost" size="sm" onClick={onBack} leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
          Назад
        </Button>
      </div>
      <p className="text-sm text-warm-500 mb-4">
        {subjectData.emoji} {subjectData.title} · {gradeData.num} класс
      </p>

      {/* Inline УМК-чипы — компактная полоска в одну строку. */}
      {showUmkChips && (
        <div className="mb-4">
          <div className="text-xs font-medium text-warm-500 mb-1.5">Учебник</div>
          <div className="flex flex-wrap gap-1.5">
            {umkList.map((u) => {
              const isSelected = umk === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSelectUmk(u.id)}
                  className={`h-7 px-3 rounded-full text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
                    isSelected
                      ? "bg-brand-500 text-white border border-brand-500"
                      : "bg-white text-warm-700 border border-warm-200 hover:border-brand-400 hover:bg-brand-50"
                  }`}
                  title={u.author}
                >
                  {u.short}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* З8: счётчик «Показано N из M» — пользователь сразу видит, что список
          обрезан. Полосу прокрутки убрали (`scrollbar-hide` её прятал). */}
      {topicsTotal > 0 && (
        <p className="text-xs text-warm-500 mb-2">
          Показано {visibleTopics.length} из {topicsTotal}
        </p>
      )}

      {/* max-h остаётся как ограничение раскрытого списка, но полоса прокрутки
          теперь видимая — сигнал «список продолжается». */}
      <div
        className={`space-y-2 -mx-2 px-2 ${showAllTopics ? "" : "max-h-[420px] overflow-y-auto"}`}
        data-testid="topics-list"
      >
        {topicsTotal === 0 ? (
          <div className="text-sm text-warm-500 py-6 text-center">
            Для выбранного учебника нет тем. Попробуйте сбросить выбор учебника — кнопка «Назад».
          </div>
        ) : visibleTopics.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => onSelect(t.slug)}
            className="group w-full p-3.5 rounded-xl border border-warm-200 hover:border-brand-400 hover:bg-brand-50 transition-all text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-warm-950 group-hover:text-brand-700">
                  {t.title}
                </div>
                {t.fgosRef && (
                  <div className="text-xs text-warm-500 mt-0.5">ФГОС {t.fgosRef}</div>
                )}
              </div>
              <ArrowRight className="w-4 h-4 text-warm-600 group-hover:text-brand-500 transition-colors shrink-0 mt-0.5" />
            </div>
            {t.examples[0] && (
              <div className="mt-1.5 text-xs text-warm-500 line-clamp-1 font-mono">
                {t.examples[0].text}
              </div>
            )}
          </button>
        ))}
      </div>

      {canShowMore && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => setShowAllTopics(true)}
          data-testid="show-all-topics"
        >
          {`Показать все (${topicsTotal})`}
        </Button>
      )}
    </Card>
  );
}

// =============== Configure step (компактный) ===============

/**
 * Шаг 3: параметры.
 * Заголовок свёрнут в инлайн-summary «[Предмет · Класс · Тема] · Изменить».
 * Тип — компактный 3-кнопочный сегментер «Лист | Тест | Карточки» (контрольная и пр. — через расширенные пресеты).
 * Сложность — 3 пилюли без описаний (экономия ~80px).
 * Чекбоксы «С ответами»/«С пояснениями» — компактные chip-toggle.
 * CTA sticky-bottom на мобиле.
 */
function ConfigureStep({
  type,
  onArtifactTypeChange,
  difficulty,
  setDifficulty,
  count,
  setCount,
  withAnswers,
  setWithAnswers,
  withExplanations,
  setWithExplanations,
  remaining,
  generating,
  hasPlus,
  summary,
  onEditSummary,
  onGenerate,
  onReset,
  /** TZ-12 (QA-аудит 2026-09-30, шаг 2): если юзер выбрал preset — сегментер
   * типа скрывается (показывается chip «задано шаблоном» + «Изменить»). */
  presetLocked,
  onClearPresetLock,
  /** Название выбранного пресета — для подписи в ConfigureStep. */
  selectedPresetId,
  selectedPresetTitle,
}: {
  type: TaskType;
  /** TZ-4: колбэк, который одновременно меняет тип И сбрасывает закэшированные артефакты. */
  onArtifactTypeChange: (t: TaskType) => void;
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  count: number;
  setCount: (n: number) => void;
  withAnswers: boolean;
  setWithAnswers: (b: boolean) => void;
  withExplanations: boolean;
  setWithExplanations: (b: boolean) => void;
  remaining: number;
  generating: boolean;
  /** Q1-2027: флаг подписки Плюс — влияет на доступность новых типов артефактов. */
  hasPlus: boolean;
  /** Текстовый summary контекста (тема · класс · экзамен). null = нечего показать. */
  summary: string | null;
  /** Клик по «Изменить» в summary — возврат к первому шагу соответствующего флоу. */
  onEditSummary: () => void;
  onGenerate: () => void;
  onReset: () => void;
  /** TZ-12: выбранный preset (если есть). Если его тип совпадает с текущим —
   * сегментер не показываем, чтобы юзер не выбирал «то же самое» заново. */
  presetLocked: Preset | null;
  /** TZ-12: «Изменить» в chip-блоке presetLocked — сбрасывает preset-блокировку,
   * юзер возвращается к свободному выбору типа. */
  onClearPresetLock: () => void;
  /**
   * TZ-12: id выбранного шаблонного пресета (Шаг 1 «Сценарий»).
   * Если пресет выбран — тип артефакта уже задан им, и повторно спрашивать
   * «Лист / Тест / Карточки» на Шаге 3 не нужно (юзер: «вроде же ранее выбирали?»).
   */
  selectedPresetId: string | null;
  /** Название выбранного пресета — для подписи «Тип выбран шаблоном: …». */
  selectedPresetTitle: string | null;
}) {
  // TZ-12: блокировка активна, когда preset выбран И его тип совпадает с current.
  const isPresetLocked = presetLocked !== null && presetLocked.type === type;
  // Локализованная подпись выбранного типа (как в ArtifactTypePicker / ARTIFACT_TYPE_OPTIONS).
  const lockedLabel = (() => {
    if (!presetLocked) return "";
    switch (presetLocked.type) {
      case "worksheet": return "Лист";
      case "test": return "Тест";
      case "cards": return "Карточки";
      case "control": return "Контрольная";
      case "lesson-plan": return "План урока";
      case "presentation": return "Презентация";
      case "ktp": return "КТП";
      case "oge": return "Вариант ОГЭ";
      case "ege": return "Вариант ЕГЭ";
      // TZ-16: новые типы. Preset'ов с такими типами пока нет (PresetGrid —
      // out of scope TZ-16 §11), но switch исчерпывающий по TaskType, и без
      // этих веток подпись была бы пустой строкой.
      case "materials": return "Материалы";
      case "lesson-bundle": return "Урок целиком";
      case "interactive": return "Интерактив";
    }
  })();

  const typeFixedByPreset = Boolean(selectedPresetId);

  return (
    <Card>
      {/* Заголовок: инлайн-summary + Изменить + Сначала.
          F-09: на узких экранах «Сначала» уезжает под summary, поэтому:
          — контейнер сделан flex-col на <sm, flex-row на ≥sm
          — summary-строка получает min-w-0 + truncate, чтобы не разъезжать вправо
          — «Сначала» прижат к правому краю и не перекрывает «Изменить». */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase tracking-wider text-warm-500 font-semibold shrink-0">Параметры</div>
          <Button variant="ghost" size="sm" onClick={onReset} className="shrink-0 -mr-2">
            Сначала
          </Button>
        </div>
        {summary ? (
          <button
            type="button"
            onClick={onEditSummary}
            className="group mt-1 flex items-center gap-1.5 text-sm font-medium text-warm-950 hover:text-brand-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded max-w-full"
          >
            <span className="truncate min-w-0 flex-1">{summary}</span>
            <span className="text-xs font-normal text-brand-600 group-hover:underline shrink-0 whitespace-nowrap">
              Изменить
            </span>
          </button>
        ) : (
          <h1 className="mt-1 text-lg font-semibold text-warm-950">Параметры</h1>
        )}
      </div>

      <div className="space-y-4">
        {/* Q1-2027: сегментер типа артефакта — 7 опций в 2 ряда (3 быстрых + 4 тяжёлых).
         * TZ-12: если тип пришёл из preset — сегментер скрыт, показываем компактный
         * chip с «Изменить» (юзер может вернуться к свободному выбору). */}
        <div>
          <label className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-1.5 block">Тип</label>
          {isPresetLocked && presetLocked ? (
            <div
              className="flex items-center justify-between gap-2 p-3 rounded-xl border border-warm-200 bg-warm-50"
              data-testid="artifact-type-preset-locked"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2 h-7 rounded-lg bg-white text-warm-950 text-sm font-medium border border-warm-200 shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-brand-500" aria-hidden />
                  <span className="truncate">{lockedLabel}</span>
                </span>
                <span className="text-xs text-warm-500 truncate">
                  задан шаблоном «{presetLocked.title}»
                </span>
              </div>
              <button
                type="button"
                onClick={onClearPresetLock}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1"
                aria-label="Изменить тип артефакта"
              >
                Изменить
              </button>
            </div>
          ) : (
            <>
              <ArtifactTypePicker value={type} onChange={onArtifactTypeChange} hasPlus={hasPlus} />
              {/* Лист 4.1.1: «Интерактив» живёт не в `ArtifactTypePicker`, а
                  здесь. Пикер лежит в другом файле (его правка — не эта
                  работа), но прятать из него рабочий тип было бы ровно тем же,
                  что делал прежний `NOT_YET_IMPLEMENTED_TYPES`: учитель видел бы
                  «Лист, Тест, Карточки…» и не знал, что игру можно сделать
                  наравне с ними. Кнопка нарисована теми же классами, что и
                  остальные типы, и жмёт тот же `onArtifactTypeChange`. */}
              <button
                type="button"
                onClick={() => onArtifactTypeChange("interactive")}
                aria-pressed={type === "interactive"}
                data-testid="pick-type-interactive"
                className={`mt-1.5 w-full h-10 px-3 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 flex items-center gap-2 ${
                  type === "interactive"
                    ? "bg-brand-700 text-white"
                    : "border border-warm-200 bg-white text-warm-900 hover:border-warm-300 hover:bg-warm-50"
                }`}
              >
                <span aria-hidden>🎮</span>
                <span>Интерактив</span>
              </button>
            </>
          )}
        </div>

        {/* Лист 4.1.1. Для интерактива блок параметров листа не показываем:
            сложность и «с ответами» на игру не влияют, а количество заданий
            задаёт ранклер по листу. Оставлять их было бы двумя ручками, которые
            ничего не меняют, — худший вид молчания. Всё, что у интерактива
            спрашивают (формат, стоимость, кнопка сборки), живёт в панели
            «Игра для класса» справа. */}
        {type === "interactive" ? (
          <div
            className="rounded-xl border border-warm-200 bg-warm-50 p-4 text-sm text-warm-700"
            data-testid="interactive-params-note"
          >
            <p className="font-medium text-warm-900">Игра собирается из заданий листа</p>
            <p className="mt-1">
              Тема и класс — те же, что и у листа. Формат игры, её стоимость и
              кнопка сборки — в блоке «Игра для класса».
            </p>
          </div>
        ) : (
          <>
        {/* Сложность: 3 пилюли без описаний. */}
        <div>
          <label className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-1.5 block">Сложность</label>
          <div className="flex gap-1 p-1 bg-warm-100 rounded-xl">
            {([
              { id: "easy" as Difficulty, label: "Лёгкая" },
              { id: "medium" as Difficulty, label: "Средняя" },
              { id: "hard" as Difficulty, label: "Сложная" },
            ]).map((d) => {
              const isSelected = difficulty === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDifficulty(d.id)}
                  aria-pressed={isSelected}
                  className={`flex-1 h-9 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    isSelected
                      ? "bg-white text-warm-950 shadow-soft"
                      : "text-warm-600 hover:text-warm-900"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Количество: слайдер с инлайн-меткой на одной строке. */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-xs font-medium text-warm-500 uppercase tracking-wider">Количество</label>
            <span className="text-sm font-semibold text-brand-600">{count}</span>
          </div>
          <input
            type="range"
            min={5}
            max={30}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full accent-brand-500"
            aria-label="Количество заданий"
          />
          <div className="flex justify-between text-[10px] text-[color:var(--text-muted)] mt-0.5">
            <span>5</span>
            <span>15</span>
            <span>30</span>
          </div>
        </div>

        {/* Опции: 2 chip-toggle кнопки в ряд. */}
        <div className="flex gap-1.5">
          <ChipToggle
            label="С ответами"
            checked={withAnswers}
            onChange={setWithAnswers}
          />
          <ChipToggle
            label="С пояснениями"
            checked={withExplanations}
            onChange={setWithExplanations}
          />
        </div>

        {/* CTA + копи. Sticky-bottom на мобиле. */}
        <div className="pt-3 border-t border-warm-100 sticky bottom-0 bg-white -mx-5 -mb-5 px-5 pb-5">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className="h-12"
            onClick={onGenerate}
            loading={generating}
            leftIcon={!generating ? <Sparkles className="w-4 h-4" /> : undefined}
            rightIcon={remaining === 0 ? <Lock className="w-4 h-4" /> : undefined}
          >
            {remaining === 0
              ? "Листы на этот месяц закончились — оформить подписку"
              : generating
                ? "Генерируем…"
                : "Создать рабочий лист"}
          </Button>
          <p className="text-xs text-warm-500 text-center mt-2">
            Готовый PDF примерно за минуту. Без регистрации.
          </p>
        </div>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Inline chip-toggle: маленькая пилюля с галочкой. Используется для «С ответами»/«С пояснениями».
 * Заменяет громоздкий checkbox+label (экономия ~60px по вертикали).
 */
function ChipToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`flex-1 h-9 px-3 rounded-full text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
        checked
          ? "bg-brand-500 text-white border border-brand-500"
          : "bg-white text-warm-700 border border-warm-200 hover:border-brand-400 hover:bg-brand-50"
      }`}
    >
      {checked && <Check className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </button>
  );
}

// =============== Empty / generating states ===============

/**
 * Именительный падеж названия предмета → винительный.
 *
 * Заголовок «Готовы сгенерировать …» требует винительного: математику, физику,
 * историю. Раньше здесь стоял `shortTitle.toLowerCase()` — именительный, и
 * учитель читал «Готовы сгенерировать математика 5 класса».
 *
 * Считаем падеж, а не держим список: новый предмет в таксономии не должен
 * требовать правки этого файла (таксономия — `src/lib/content`, отсюда её не
 * трогаем). Проверено на всех 21 предмете таксономии:
 *   • мужской и средний род не меняются — «Русский», «Общество»;
 *   • сокращения и многословные названия не склоняются — «ОБЖ», «ИЗО»,
 *     «Физ-ра», «Окр. мир», «Фин. грамотность»;
 *   • женский род с нулевым окончанием не склоняется — «новость» → «новость»
 *     (отсюда «Фин. грамотность», если сокращение уберут);
 *   • остальное женского рода: -а → -у, -я → -ю («математика» → «математику»,
 *     «алгебра» → «алгебру», «история» → «историю»).
 */
function subjectAccusative(shortTitle: string): string {
  const word = shortTitle.trim();
  const lower = word.toLowerCase();
  // Пробел, точка, дефис или слэш — это «Окр. мир» / «Фин. грамотность» /
  // «Физ-ра»: сокращение склонению не поддаёт.
  if (/[\s.\-/]/.test(word)) return lower;
  // «ОБЖ», «ИЗО» — прописными без пробела.
  if (word.length <= 4 && word === word.toUpperCase()) return lower;
  if (/(ость|есть)$/i.test(word)) return lower;
  if (/а$/i.test(word)) return `${lower.slice(0, -1)}у`;
  if (/я$/i.test(word)) return `${lower.slice(0, -1)}ю`;
  return lower;
}

function EmptyPreview({
  mode,
  subject,
  grade,
  exam,
  examNumbers,
  type,
  onPickPopular,
}: {
  mode: Mode;
  subject: SubjectType | null | undefined;
  grade: number | null;
  exam: ExamSlug | null;
  examNumbers: number[];
  /** F-09: тип артефакта — используем для превью. */
  type: TaskType;
  onPickPopular: () => void;
}) {
  const isExam = mode === "exam";
  const headline = isExam
    ? exam && subject
      ? `${exam === "oge" ? "ОГЭ" : "ЕГЭ"} · ${subject.shortTitle}${examNumbers.length ? ` · № ${examNumbers.join(", ")}` : ""}`
      : exam
        ? `${exam === "oge" ? "ОГЭ" : "ЕГЭ"} — выберите предмет слева`
        : "Выберите экзамен слева"
    : subject
      ? `Готовы сгенерировать ${subjectAccusative(subject.shortTitle)} ${grade ?? ""} класса`
      : "Выберите предмет слева";

  // F-09: превью выбранного типа — образец, чтобы пользователь понимал, что получит.
  // TZ-12: текстовый sample заменён на миниатюрное SVG-превью формата в <ArtifactTypePreview/>.
  const TYPE_PREVIEW: Record<TaskType, { label: string; desc: string }> = {
    worksheet: {
      label: "Рабочий лист",
      desc: "Классический список заданий с местом для ответов. PDF или DOCX.",
    },
    test: {
      label: "Тест",
      desc: "Все задания с выбором ответа из нескольких вариантов — легко проверить по шифру ответов.",
    },
    cards: {
      label: "Карточки",
      desc: "Компактная сетка карточек для повторения и запоминания.",
    },
    control: {
      label: "Контрольная",
      desc: "Два варианта одной работы, чтобы сравнить результат класса.",
    },
    "lesson-plan": {
      label: "План урока",
      desc: "ФГОС-конспект на 45 минут, готовый к проведению.",
    },
    presentation: {
      label: "Презентация",
      desc: "5–20 слайдов в PPTX. Иллюстрации и тезисы подбираются автоматически.",
    },
    ktp: {
      label: "КТП",
      desc: "Календарно-тематическое планирование на учебный год.",
    },
    oge: {
      label: "Вариант ОГЭ",
      desc: "Полный вариант ОГЭ по номерам заданий ФИПИ.",
    },
    ege: {
      label: "Вариант ЕГЭ",
      desc: "Полный вариант ЕГЭ по номерам заданий ФИПИ.",
    },
    // TZ-16: 4 новых типа. Типизация Record<TaskType, …> требует ВСЕХ ключей —
    // забытый ключ = ошибка компиляции (нам это и нужно, ключи не обходим).
    materials: {
      label: "Материалы",
      desc: "Комплект доп. файлов к теме: словарь, справочные данные, раздатка. ZIP.",
    },
    "lesson-bundle": {
      label: "Урок целиком",
      desc: "Лист, презентация, план урока и тест из одной темы одним нажатием. ZIP.",
    },
    interactive: {
      label: "Интерактив",
      desc: "Форма с вопросами по теме, которую ученики заполняют сами.",
    },
  };
  const preview = TYPE_PREVIEW[type] ?? TYPE_PREVIEW.worksheet;

  return (
    <Card className="border-dashed border-warm-300 bg-gradient-to-br from-warm-50 to-white min-h-[480px]">
      <div className="flex flex-col items-center text-center pt-8 pb-4 px-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center text-white shadow-brand mb-5">
          <Sparkles className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-display font-bold text-warm-950 mb-2">
          {headline}
        </h2>
        <p className="text-warm-600 max-w-md mb-6">
          {isExam
            ? "Завершите выбор номеров и параметров. Сгенерируем рабочий лист по выбранным заданиям ФИПИ."
            : subject
              ? "Завершите выбор темы и параметров, и через минуту у вас будет готовый PDF."
              : "ИИ создаст рабочий лист, проверит ответы сам и пришлёт готовый файл."}
        </p>
        {!isExam && (
          <Button variant="primary" size="lg" onClick={onPickPopular} leftIcon={<Sparkles className="w-4 h-4" />}>
            {/*
              Подпись кнопки больше не зашитая «дроби, 5 класс» (08.10.2026).
              Учительница выбирала «Окружающий мир, 4 класс» — а кнопка обещала
              дроби и уводила в математику: `onPickPopular` жёстко ставил
              `subject="math"`, `grade=5`. Теперь кнопка ведёт в ВЫБРАННЫЙ
              предмет и класс, а если предмет ещё не выбран — предлагает
              начать с выбора, а не молча подставляет математику.
            */}
            {subject ? `Попробовать: ${subject.shortTitle.toLowerCase()}, ${grade ?? "—"} класс` : "Выбрать предмет и класс"}
          </Button>
        )}
      </div>

      {/* F-09: превью выбранного типа — образец результата.
         * TZ-12: вместо строки текста — визуальная миниатюра формата (квадратики,
         * радио-кружки, сетка слайдов и т.п.), чтобы юзер сразу видел результат.
         * Компонент покрыт tests/regression/artifact-type-preview.test.tsx. */}
      <div className="px-4 sm:px-6 pb-4">
        <div className="text-[10px] uppercase tracking-wider text-warm-500 font-semibold mb-2">
          Как будет выглядеть результат
        </div>
        <div className="rounded-xl border border-warm-200 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-warm-950">{preview.label}</div>
            <div className="text-[10px] text-warm-500 uppercase tracking-wider">пример</div>
          </div>
          <ArtifactTypePreview type={type} className="mb-3" title={`Миниатюра формата «${preview.label}»`} />
          <div className="text-[11px] text-warm-500">{preview.desc}</div>
        </div>
      </div>

      {/*
        Три плитки стояли здесь с придуманными числами: «~30 сек» (замера
        длительности генерации в коде нет) и «100% / Проверено ИИ» (проверка
        запускается по кнопке и по умолчанию не выполняется, а 100% —
        обещание, которое не может выполнить ни одна проверка). Осталась
        правда: PDF A4 и то, что проверку запускает учитель.
      */}
      <div className="px-4 sm:px-6 pb-8 grid grid-cols-2 gap-6 text-center w-full">
        <div>
          <div className="text-2xl font-bold text-brand-600">PDF A4</div>
          <div className="text-xs text-warm-500 mt-0.5">Готов к печати</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-brand-600">По кнопке</div>
          <div className="text-xs text-warm-500 mt-0.5">Проверка ответов</div>
        </div>
      </div>
    </Card>
  );
}

/** F-04-B: этапы анимированного progress-UI. Метки, бейджи статуса и % для прогресс-бара. */
const PROGRESS_STEPS: Array<{
  id: "selecting" | "verifying" | "formatting";
  label: string;
  hint: string;
}> = [
  { id: "selecting", label: "Подбираю задания по программе", hint: "Читаем ФГОС и подбираем задания по уровню ученика" },
  { id: "verifying", label: "Решаю и проверяю каждое задание", hint: "ИИ прогоняет каждый ответ, чтобы не было мусора" },
  { id: "formatting", label: "Оформляю в PDF с ответами", hint: "Собираем аккуратный A4 с местом для решений" },
];

function GeneratingState({
  stage,
}: {
  stage: "selecting" | "verifying" | "formatting" | "done" | null;
}) {
  // Текущий шаг — это либо stage, либо первый этап (стартовая задержка перед первым setState).
  const activeIdx = Math.max(
    0,
    PROGRESS_STEPS.findIndex((s) => s.id === stage)
  );
  const active = PROGRESS_STEPS[activeIdx] ?? PROGRESS_STEPS[0];
  // Прогресс: 0 → selecting, 1 → verifying, 2 → formatting, 3 → done.
  const progress = stage === "done" ? 100 : ((activeIdx + 1) / PROGRESS_STEPS.length) * 100;
  const isDone = stage === "done";

  return (
    <Card className="min-h-[480px] flex flex-col items-center justify-center text-center bg-gradient-to-br from-brand-50 to-white">
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-brand-500 grid place-items-center text-white shadow-brand">
          {isDone ? (
            <Check className="w-10 h-10 animate-scale-in" />
          ) : (
            <Loader2 className="w-10 h-10 animate-spin" />
          )}
        </div>
        {!isDone && (
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-accent-500 animate-bounce-subtle" />
        )}
      </div>
      <h2 className="mt-6 text-xl font-semibold text-warm-950">
        {isDone ? "Готово!" : "Генерируем рабочий лист"}
        {!isDone && <span className="inline-block w-6 text-left animate-pulse">…</span>}
      </h2>
      <p className="mt-2 text-sm text-warm-600 max-w-md" aria-live="polite">
        {isDone ? "Лист собран и проверен — можно скачивать" : active.hint}
      </p>

      {/* Прогресс-бар (brand-500) */}
      <div
        className="mt-6 w-full max-w-xs h-1.5 bg-white rounded-full overflow-hidden ring-1 ring-warm-100"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс генерации"
      >
        <div
          className="h-full bg-brand-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Список стадий — текущая подсвечена, прошлые зачёркнуты, будущие серые. */}
      <div className="mt-6 space-y-2 w-full max-w-xs text-left">
        {PROGRESS_STEPS.map((step, i) => {
          const isActive = i === activeIdx && !isDone;
          const isPast = i < activeIdx || isDone;
          return (
            <div
              key={step.id}
              className={`flex items-center gap-2 text-sm transition-colors ${
                isActive
                  ? "text-warm-950 font-medium"
                  : isPast
                    ? "text-warm-500 line-through"
                    : "text-[color:var(--text-muted)]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  isActive
                    ? "bg-brand-500 animate-pulse"
                    : isPast
                      ? "bg-warm-300"
                      : "bg-warm-200"
                }`}
              />
              {step.label}
              {isActive && (
                <span className="inline-block w-4 text-left text-warm-600 animate-pulse">…</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
// Раньше страница была обёрнута в <Suspense fallback="Загрузка…"> — только
// ради useSearchParams(), который при `output: "export"` требует границы.
// Fallback закрывал собой весь контент на 3–4 секунды, пока грузится JS.
// Теперь query читается из window.location внутри useEffect, поэтому
// статический HTML содержит сразу шапку и первый шаг визарда.

// =============== Mode toggle (F-04-C) ===============

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      className="flex gap-1 p-1 bg-warm-100 rounded-xl"
      role="tablist"
      aria-label="Режим конструктора"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "topic"}
        onClick={() => onChange("topic")}
        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          mode === "topic"
            ? "bg-white text-warm-950 shadow-soft"
            : "text-warm-600 hover:text-warm-900"
        }`}
      >
        По теме
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "exam"}
        onClick={() => onChange("exam")}
        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          mode === "exam"
            ? "bg-white text-warm-950 shadow-soft"
            : "text-warm-600 hover:text-warm-900"
        }`}
      >
        По номеру ОГЭ/ЕГЭ
      </button>
    </div>
  );
}

// =============== Exam: select ОГЭ/ЕГЭ (F-04-C) ===============

function ExamSelectStep({
  selected,
  onSelect,
}: {
  selected: ExamSlug | null;
  onSelect: (e: ExamSlug) => void;
}) {
  return (
    <Card>
      <h1 className="text-xl font-semibold text-warm-950 mb-1">Выберите экзамен</h1>
      <p className="text-sm text-warm-500 mb-5">Формат и нумерация заданий по ФИПИ</p>
      <div className="grid grid-cols-2 gap-3">
        {([
          { id: "oge" as const, label: "ОГЭ", sub: "9 класс" },
          { id: "ege" as const, label: "ЕГЭ", sub: "11 класс" },
        ]).map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            aria-pressed={selected === e.id}
            className={`group p-5 rounded-xl border-2 transition-all text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
              selected === e.id
                ? "border-brand-500 bg-brand-50"
                : "border-warm-200 hover:border-brand-400 hover:bg-brand-50"
            }`}
          >
            <div className="text-2xl font-bold text-warm-950 group-hover:text-brand-700">
              {e.label}
            </div>
            <div className="text-xs text-warm-500 mt-1">{e.sub}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// =============== Exam: subject grid (F-04-C) ===============

function ExamSubjectStep({
  exam,
  selected,
  onSelect,
  onBack,
}: {
  exam: ExamSlug;
  selected: SubjectSlug | null;
  onSelect: (s: SubjectSlug) => void;
  onBack: () => void;
}) {
  const list = getExamSubjects(exam);
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold text-warm-950">Выберите предмет</h1>
        <Button variant="ghost" size="sm" onClick={onBack} leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
          Назад
        </Button>
      </div>
      <p className="text-sm text-warm-500 mb-5">
        {exam === "oge" ? "ОГЭ · 9 класс" : "ЕГЭ · 11 класс"} — доступно {list.length} {plural(list.length, "предмет", "предмета", "предметов")}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {list.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => onSelect(s.slug as SubjectSlug)}
            aria-pressed={selected === s.slug}
            className={`group p-4 rounded-xl border transition-all text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
              selected === s.slug
                ? "border-brand-500 bg-brand-50"
                : "border-warm-200 hover:border-brand-400 hover:bg-brand-50"
            }`}
          >
            <div className="text-2xl mb-2">{s.emoji}</div>
            <div className="font-medium text-sm text-warm-950 group-hover:text-brand-700">
              {s.title}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// =============== Exam: number chips multi-select (F-04-C) ===============

function ExamNumberStep({
  exam,
  subject,
  numbers,
  onNumbersChange,
  onBack,
  onNext,
}: {
  exam: ExamSlug;
  subject: SubjectSlug;
  numbers: number[];
  onNumbersChange: (n: number[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const list = getExamNumbers(exam, subject);
  const subjectTitle = getExamSubjects(exam).find((s) => s.slug === subject)?.title ?? subject;

  // З8: та же болезнь, что со списком тем — сетка номеров обрезалась по
  // `max-h-[280px]`, а `scrollbar-hide` прятал полосу прокрутки. Показываем
  // «Показано N из M» и кнопку «Показать все», полосу прокрутки не прячем.
  const [showAllNumbers, setShowAllNumbers] = React.useState(false);
  React.useEffect(() => {
    setShowAllNumbers(false);
  }, [exam, subject]);

  const numbersTotal = list.length;
  const visibleNumbers = showAllNumbers
    ? list
    : list.slice(0, TOPICS_PREVIEW_COUNT);
  const canShowMoreNumbers = !showAllNumbers && numbersTotal > TOPICS_PREVIEW_COUNT;

  const toggle = (n: number) => {
    if (numbers.includes(n)) {
      onNumbersChange(numbers.filter((x) => x !== n));
    } else {
      onNumbersChange([...numbers, n].sort((a, b) => a - b));
    }
  };

  const removeChip = (n: number) => {
    onNumbersChange(numbers.filter((x) => x !== n));
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold text-warm-950">Выберите номера</h1>
        <Button variant="ghost" size="sm" onClick={onBack} leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
          Назад
        </Button>
      </div>
      <p className="text-sm text-warm-500 mb-4">
        {exam === "oge" ? "ОГЭ" : "ЕГЭ"} · {subjectTitle}
        {numbers.length > 0 && ` · выбрано: ${numbers.length}`}
      </p>

      {/* Чипы выбранных номеров (компактно, на мобиле не уезжают) */}
      {numbers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4 p-3 rounded-xl bg-brand-50 border border-brand-200">
          {numbers.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => removeChip(n)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
              aria-label={`Убрать номер ${n}`}
            >
              № {n}
              <X className="w-3 h-3" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {/* Сетка доступных номеров — с видимой полосой прокрутки (З8). */}
      {numbersTotal > 0 && (
        <p className="text-xs text-warm-500 mb-2">
          Показано {visibleNumbers.length} из {numbersTotal}
        </p>
      )}
      <div
        className={`grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5 -mx-2 px-2 ${showAllNumbers ? "" : "max-h-[280px] overflow-y-auto"}`}
        data-testid="exam-numbers-list"
      >
        {visibleNumbers.map((it) => {
          const isSelected = numbers.includes(it.number);
          return (
            <button
              key={it.number}
              type="button"
              onClick={() => toggle(it.number)}
              aria-pressed={isSelected}
              aria-label={`Номер ${it.number}: ${it.title}`}
              className={`group p-3 rounded-xl transition-all text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
                isSelected
                  ? "bg-brand-500 text-white border-2 border-brand-500"
                  : "bg-white border border-warm-200 hover:border-brand-400 hover:bg-brand-50"
              }`}
            >
              <div className={`text-xs font-medium ${isSelected ? "text-white/80" : "text-warm-500"}`}>
                № {it.number}
              </div>
              <div className={`text-sm font-medium mt-0.5 leading-tight line-clamp-2 ${isSelected ? "text-white" : "text-warm-950 group-hover:text-brand-700"}`}>
                {it.title}
              </div>
            </button>
          );
        })}
      </div>

      {canShowMoreNumbers && (
        <Button
          variant="secondary"
          size="sm"
          className="mb-5 w-full"
          onClick={() => setShowAllNumbers(true)}
          data-testid="show-all-exam-numbers"
        >
          {`Показать все (${numbersTotal})`}
        </Button>
      )}

      <div className="pt-3 border-t border-warm-100 flex items-center justify-between gap-3">
        <p className="text-xs text-warm-500">
          {numbers.length === 0
            ? "Выберите хотя бы один номер"
            : `Готово: ${numbers.length} ${pluralizeTasks(numbers.length)}`}
        </p>
        <Button
          variant="primary"
          size="md"
          onClick={onNext}
          disabled={numbers.length === 0}
          rightIcon={<ArrowRight className="w-4 h-4" />}
        >
          Дальше
        </Button>
      </div>
    </Card>
  );
}
