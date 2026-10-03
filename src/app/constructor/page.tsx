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
import { InteractiveCreatePanel } from "@/components/interactives/InteractiveCreatePanel";
import { isInteractiveFormat } from "@/lib/interactives/formats";
import type { InteractiveFormat } from "@/lib/interactives/types";
import { CardsPreview } from "@/components/constructor/CardsPreview";
import { MaterialsPreview } from "@/components/constructor/MaterialsPreview";
import { LessonBundlePreview } from "@/components/constructor/LessonBundlePreview";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { ArtifactTypePicker } from "@/components/constructor/ArtifactTypePicker";
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
} from "lucide-react";
import { subjects, getSubject, getGrade } from "@/lib/content/subjects";
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
} from "@/lib/client/llm";
import { generateWorksheetDocx, downloadBlob } from "@/lib/utils/docx";
import { trackEvent } from "@/lib/track";
import { generateLessonPlanDocx } from "@/lib/utils/lesson-plan-docx";
import { generateCardsDocx } from "@/lib/utils/cards-docx";
import { printCards } from "@/lib/utils/cards-print";
import { generateMaterialsZip, materialsZipFilename } from "@/lib/utils/materials-zip";
import { generateBundleZip, bundleZipFilename, bundleReadyCount } from "@/lib/utils/bundle-zip";
import { generateKtpDocx } from "@/lib/utils/ktp-docx";
import { generatePptx, pptxFilename } from "@/lib/utils/pptx";
import { canGenerate, consume, getRemaining, refund } from "@/lib/utils/limit";
import { isTouchDevice, subscribeToDeviceChange } from "@/lib/utils/device";
import { ACADEMIC_YEAR_MONTHS, FREE_GENERATIONS, PLANS, priceLabel, priceShort } from "@/lib/content/plans";
import { plural } from "@/lib/utils/cn";
import { pluralizeTasks, pluralizeFiles } from "@/lib/utils/cn";
import { saveWorksheet, type SaveWorksheetInput } from "@/lib/worksheets/api";
import { ShareFormDialog } from "@/components/teacher/ShareFormDialog";
import { toFormSourceTask } from "@/lib/forms/types";
import { getProfile } from "@/lib/utils/storage";
import { useUsage } from "@/lib/hooks/useUsage";
import { EditChat } from "@/components/f08/EditChat";
import { PhotoCheckPanel } from "@/components/f06/PhotoCheckPanel";

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
 * Слово «год» в значении «годовая подписка» / «/год» запрещено планом —
 * поэтому только «учебный год» (период обучения) и помесячная цена.
 */
const PLANS_TEXT = `Подписка ${PLANS.base.name} — ${priceLabel(
  "base",
  "academicYear",
)} за учебный год (${ACADEMIC_YEAR_MONTHS} мес) или ${priceShort("base", "month")} помесячно. ${
  PLANS.plus.name
} — ${priceLabel("plus", "academicYear")} за учебный год или ${priceShort(
  "plus",
  "month",
)} помесячно.`;

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
  "image",
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
/**
 * Типы без генератора (TZ-16 Этапы 6–7). Попасть в них можно только по
 * deep-link вида `?type=interactive`: в пикере их пока нет.
 * Нужен, чтобы `generate()` отвечал честным «скоро будет», а не сообщением
 * «не получилось, попробуйте ещё раз», в котором повтор бессмысленен.
 */
const NOT_YET_IMPLEMENTED_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
  "interactive",
  "image",
]);

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
    // TZ-16 Этапы 6–7: мок/превью/экспорт появятся позже.
    case "interactive":
    case "image":
      return null;
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
  | "lesson-bundle";

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
   * «Готово за 30 сек» и не знал, что AI не отвечал. Для сервиса, который живёт
   * на доверии, молчаливая подмена — самая дорогая ошибка: такой лист учитель
   * отдаёт ученикам.
   *
   * Теперь заготовка всегда помечена, а рядом стоит кнопка «Повторить».
   */
  const [isDemoResult, setIsDemoResult] = React.useState(false);
  const [remaining, setRemaining] = React.useState<number>(3);
  const [showPaywall, setShowPaywall] = React.useState(false);
  /** F-06: видна ли inline-панель проверки фото тетради (только worksheet). */
  const [photoCheckOpen, setPhotoCheckOpen] = React.useState(false);
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
    // Панель создания игры рендерится в блоке ниже и использует серверный
    // `savedWorksheetId`: ранклеру нужен id листа В БАЗЕ, а не клиентский.
    const formatParam = params.get("interactiveFormat");
    if (formatParam && isInteractiveFormat(formatParam)) {
      setInteractiveFormat(formatParam);
      setType("interactive");
      setStep("configure");
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
      const validGrade = !Number.isNaN(g) && g > 0 ? g : null;
      if (validGrade) setGrade(validGrade);
      if (t) setTopic(t);
      if (d && ["easy", "medium", "hard"].includes(d)) setDifficulty(d);
      if (!Number.isNaN(c) && c >= 5 && c <= 30) setCount(c);
      // TZ-16: whitelist расширен на 4 новых типа из TaskType. Deep-link
      // `?type=materials` (и lesson-bundle / interactive / image) больше не
      // игнорируется молча. Сами артефакты придут в Этапах 2–7.
      if (ty && DEEP_LINK_TYPES.includes(ty)) setType(ty);
      // Deep-link → перескакиваем максимально далеко.
      // UMK больше не отдельный шаг — оно inline в TopicStep (если опций > 1) или auto-pick (если 1).
      if (t) {
        setStep("configure");
      } else if (validGrade) {
        // Auto-pick UMK, если только один вариант — UI в TopicStep всё равно подсветит выбор.
        const subj = getSubject(s);
        const umkList = subj ? getUMK(s, validGrade) : [];
        if (umkList.length === 1) setUmk(umkList[0].id);
        setStep("topic");
      } else {
        // Есть только subject → класс ещё не выбран, остаёмся на шаге 1.
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
  }, []);

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

  const generate = async () => {
    // TZ-16 Этапы 6–7: типы объявлены в TaskType и входят в DEEP_LINK_TYPES,
    // но генераторов для них ещё нет. Без этой проверки учитель, пришедший по
    // ссылке `?type=interactive`, доходил до кнопки «Создать» и получал
    // «Не получилось, попробуйте ещё раз» — а повтор не помог бы никогда.
    // Показываем честное «скоро», ничего не списав с квоты.
    if (NOT_YET_IMPLEMENTED_TYPES.has(type)) {
      toast({
        tone: "info",
        title: "Этот формат ещё в работе",
        description: "Пока доступны рабочий лист, тест, контрольная, карточки, план урока, презентация, КТП, материалы и урок целиком",
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
      const firstNum = examNumbers[0];
      body = {
        subject: examSubject,
        grade: gradeForExam,
        topic: `exam-${exam}-${firstNum}`,
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
     * Для анонимов (serverUsage === null) поведение прежнее — 3 бесплатные
     * генерации. Решение об оплате принимает бэк (402 → paywall), поэтому
     * клиентский чек — только против недопустимой генерации у бесплатного.
     */
    const isPaid = serverUsage?.plan === "base" || serverUsage?.plan === "plus";
    if (!isPaid && !canGenerate()) {
      setShowPaywall(true);
      return;
    }

    setGenerating(true);
    setIsDemoResult(false);
    setWorksheet(null);
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
            const r = await generateLessonPlanSmart(body);
            return { kind: "lesson-plan" as const, payload: r.data, isDemo: r.isDemo };
          }
          case "presentation": {
            const r = await generatePresentationSmart(body);
            return { kind: "presentation" as const, payload: r.data, isDemo: r.isDemo };
          }
          case "ktp": {
            const r = await generateKtpSmart(body);
            return { kind: "ktp" as const, payload: r.data, isDemo: r.isDemo };
          }
          // TZ-16 §3.1: карточки — самостоятельный артефакт со своим моком.
          // Раньше `cards` был в списке ниже и молча отдавал обычный лист.
          case "cards": {
            const r = await generateCardsSmart(body);
            return { kind: "cards" as const, payload: r.data, isDemo: r.isDemo };
          }
          // TZ-16 §3.2: комплект материалов (словарь / справочник / раздатка).
          case "materials": {
            const r = await generateMaterialsSmart(body);
            return { kind: "materials" as const, payload: r.data, isDemo: r.isDemo };
          }
          // TZ-16 §3.4: «урок целиком» — 4 слота. Оркестрация ПАРАЛЛЕЛЬНА
          // (Promise.allSettled внутри generateBundleSmart → мок): при отказе
          // одного слота остальные три не теряются, отказ уходит в `failed`.
          case "lesson-bundle": {
            const r = await generateBundleSmart(body);
            return { kind: "lesson-bundle" as const, payload: r.data, isDemo: r.isDemo };
          }
          // Лист с разной перепаковкой заданий.
          case "worksheet":
          case "test":
          case "control":
          case "oge":
          case "ege": {
            const r = await generateWorksheetSmart(body);
            return { kind: "worksheet" as const, payload: r.worksheet, isDemo: r.isDemo };
          }
          // TZ-16 Этапы 6–7: типы объявлены в TaskType и видны в пикере,
          // но генераторов для них ещё нет. Явная ошибка вместо тихой подмены.
          case "interactive":
          case "image":
            throw new Error(`[generate] тип "${type}" ещё не реализован (TZ-16, Этапы 6–7)`);
          default: {
            // Exhaustiveness: если в TaskType добавят новый тип и забудут case
            // выше, `type` здесь перестанет быть `never` и сборка упадёт.
            const unhandled: never = type;
            throw new Error(`[generate] необработанный тип: ${String(unhandled)}`);
          }
        }
      })();

      // З2: списание квоты — только здесь, уже после успешного `await`.
      const counter = consume();
      quotaConsumed = true;
      const left = Math.max(0, FREE_GENERATIONS - counter.count);

      // Снэпим к "done" и сбрасываем pending-переходы.
      stageTimers.forEach((id) => window.clearTimeout(id));
      setProgressStage("done");

      // Честность результата: заготовка всегда помечается в интерфейсе.
      setIsDemoResult(result.isDemo);

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
          const lp = result.payload as LessonPlan;
          setLessonPlan(lp);
          artifactTitle = lp.title;
          artifactId = lp.id;
          historyType = "lesson-plan";
          histSubject = lp.subject;
          histGrade = lp.grade;
          break;
        }
        case "presentation": {
          const p = result.payload as Presentation;
          setPresentation(p);
          artifactTitle = p.title;
          artifactId = p.id;
          historyType = "presentation";
          histSubject = p.subject;
          histGrade = p.grade;
          break;
        }
        case "ktp": {
          const k = result.payload as Ktp;
          setKtp(k);
          artifactTitle = k.title;
          artifactId = k.id;
          historyType = "ktp";
          histSubject = k.subject;
          histGrade = k.grade;
          break;
        }
        case "worksheet": {
          const ws = result.payload as Worksheet;
          setWorksheet(ws);
          artifactTitle = ws.title;
          artifactId = ws.id;
          histSubject = ws.subject as SubjectSlug;
          histGrade = ws.grade;
          break;
        }
        // TZ-16 §3.1: у CardSet есть свои subject/grade — берём из артефакта.
        case "cards": {
          const cs = result.payload as CardSet;
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
          const mb = result.payload as MaterialBundle;
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
          const lb = result.payload as LessonBundle;
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
        artifact: result.payload as UserHistoryItem["artifact"],
      });

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
              source: "mock",
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
              source: "mock",
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
              source: "mock",
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
              source: "mock",
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
      if (saveInput) {
        void saveWorksheet(saveInput).then((r) => {
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
        });
      }

      // F-04-B: success-burst сверху страницы (~80 частиц, ~1.2с).
      void fireConfetti();

      toast({
        tone: "success",
        title: "Готово!",
        // З6/З7: единое время «30 сек» — столько же стоит в заголовке и в
        // подписи под кнопкой. Слово «demo-режим» в пользовательский текст
        // не выносим: учителю оно ничего не объясняет.
        // Для разработчика: это заявленное время из UI, а не замер. Когда
        // подключим реальный LLM — считаем `performance.now()` и подставляем
        // фактическое, тогда здесь же уйдёт и «· demo-режим».
        description: "Готово за 30 сек · сохраните в PDF",
      });
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

  const handleNewVariant = () => {
    if (subject && grade && topic) generate();
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
      const filename = `${lessonPlan.subject}-${lessonPlan.grade}kl-${lessonPlan.topic}-plan.docx`
        .toLowerCase()
        .replace(/\s+/g, "-");
      downloadBlob(blob, filename);
      toast({ tone: "success", title: "DOCX скачан", description: "Откройте в Word или LibreOffice" });
      return;
    }
    if (type === "ktp" && ktp) {
      const blob = await generateKtpDocx(ktp);
      const filename = `${ktp.subject}-${ktp.grade}kl-${ktp.schoolYear}-ktp.docx`
        .toLowerCase()
        .replace(/\s+/g, "-");
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
      const filename = `${cardSet.subject}-${cardSet.grade}kl-${cardSet.topic}-cards.docx`
        .toLowerCase()
        .replace(/\s+/g, "-");
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
    const blob = await generateWorksheetDocx(worksheet, { withAnswers, withExplanations });
    const filename = `${worksheet.subject}-${worksheet.grade}kl-${worksheet.topic}.docx`
      .toLowerCase()
      .replace(/\s+/g, "-");
    downloadBlob(blob, filename);
    toast({ tone: "success", title: "DOCX скачан", description: "Откройте в Word или LibreOffice" });
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

  return (
    <>
      <div className="container-tight py-8 sm:py-12">
        <div className={`grid gap-6 lg:gap-8 items-start ${step === "select" && mode === "topic" ? "grid-cols-1" : "lg:grid-cols-[420px_1fr]"}`}>
          {/* Left: form / steps */}
          <div className="lg:sticky lg:top-20 space-y-5">
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
                    <h2 className="text-lg font-semibold text-warm-950">Сценарий</h2>
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

          {/* Right: preview / empty state (hidden on Шаг 1, full width for subject picker) */}
          {!(step === "select" && mode === "topic") && (
          <div>
            {!worksheet && !generating && (
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
                  setSubject("math");
                  setGrade(5);
                  setTimeout(() => {
                    const g = getGrade("math", 5);
                    if (g && g.topics[0]) {
                      setTopic(g.topics[0].slug);
                      setStep("configure");
                    }
                  }, 100);
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
                  ? `${worksheet!.tasks.length} ${pluralizeTasks(worksheet!.tasks.length)} · ${type === "control" ? "Контрольная" : "Рабочий лист"} · вариант ${Math.floor(Math.random() * 9) + 1}`
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
                    <Button variant="secondary" size="sm" leftIcon={<RotateCcw className="w-4 h-4" />} onClick={handleNewVariant} loading={generating}>
                      <span className="hidden sm:inline">Новый вариант</span>
                      <span className="sm:hidden">Заново</span>
                    </Button>
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
                      <p className="font-semibold">Это демонстрационная заготовка</p>
                      <p className="mt-1 text-warm-700">
                        Сервис сейчас недоступен, поэтому задания типовые: они взяты из заготовки, а не собраны
                        под вашу тему. Формат и разметку посмотреть можно, но отдавать такой лист ученикам как
                        проверенный материал не стоит. Попробуйте ещё раз — обычно помогает.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        onClick={() => generate()}
                        disabled={generating}
                      >
                        Повторить
                      </Button>
                    </div>
                  )}

                  {kind === "worksheet" && (
                    <WorksheetPreview
                      worksheet={worksheet!}
                      withAnswers={withAnswers}
                      withExplanations={withExplanations}
                      type={type}
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
                              const left = isUnlimited
                                ? Number.POSITIVE_INFINITY
                                : Math.max(0, serverUsage.generationsLimit - serverUsage.generationsToday);
                              if (isUnlimited) {
                                return `Безлимит (план ${serverUsage.plan}). Сегодня уже сгенерировано: ${serverUsage.generationsToday}.`;
                              }
                              return `Осталось ${left} из ${serverUsage.generationsLimit} на сегодня. ${PLANS_TEXT}`;
                            }
                            return `Осталось ${remaining} из 3 на сегодня. ${PLANS_TEXT}`;
                          })()}
                        </p>
                        <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 transition-all"
                            style={{
                              width: `${(() => {
                                if (serverUsage) {
                                  if (serverUsage.generationsLimit === -1) return 100;
                                  return Math.max(0, Math.min(100, ((serverUsage.generationsLimit - serverUsage.generationsToday) / serverUsage.generationsLimit) * 100));
                                }
                                return Math.max(0, Math.min(100, (remaining / 3) * 100));
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

      {/* TZ-13 §4.9, шаги 3–8: панель создания игры. Показываем только когда
          учитель пришёл именно за интерактивом (блок «Оживить урок» на листе
          или `?interactiveFormat=` в URL) — в обычном флоу листа её быть не
          должно, это лишний блок перед teacher-only зоной.

          `worksheetId` — серверный id листа: ранклер берёт задания из
          `payload_json`, а клиентский id из localStorage бэку неизвестен. */}
      {interactiveFormat && mode === "topic" && (
        <div className="container-tight pb-8 no-print">
          <InteractiveCreatePanel
            worksheetId={savedWorksheetId}
            format={interactiveFormat}
            title={worksheet?.title ?? "Лист"}
            subject={subject ?? (worksheet ? String(worksheet.subject) : "")}
            grade={worksheet?.grade ?? grade ?? 0}
            itemCount={count}
          />
        </div>
      )}

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
  const items: Array<{ id: Step; label: string }> = mode === "exam"
    ? [
        { id: "exam-select", label: "Экзамен" },
        { id: "exam-subject", label: "Предмет" },
        { id: "exam-number", label: "Номера" },
        { id: "configure", label: "Параметры" },
      ]
    : [
        { id: "select", label: "Что" },
        { id: "topic", label: "Тема" },
        { id: "configure", label: "Параметры" },
      ];
  const currentIdx = items.findIndex((i) => i.id === step);

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
      {/* 3 (или 4 в exam) точки с подписями. Клик на предыдущую точку = вернуться к шагу. */}
      <div className="grid gap-1.5 mb-5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            onClick={() => i < currentIdx && onStep(it.id)}
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
        <h2 className="text-lg font-semibold text-warm-950">Что и для кого</h2>
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
                    ? "bg-warm-50 text-warm-300 border border-warm-100 cursor-not-allowed"
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
        <h2 className="text-xl font-semibold text-warm-950">Выберите тему</h2>
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
            Для выбранного учебника нет тем. Попробуйте сбросить выбор УМК — кнопка «Назад».
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
              <ArrowRight className="w-4 h-4 text-warm-400 group-hover:text-brand-500 transition-colors shrink-0 mt-0.5" />
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
      case "image": return "Картинка";
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
          <h2 className="mt-1 text-lg font-semibold text-warm-950">Параметры</h2>
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
            <ArtifactTypePicker value={type} onChange={onArtifactTypeChange} hasPlus={hasPlus} />
          )}
        </div>

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
              ? "Лимит исчерпан — оформить подписку"
              : generating
                ? "Генерируем…"
                : "Создать рабочий лист"}
          </Button>
          <p className="text-xs text-warm-500 text-center mt-2">
            Готовый PDF за ~30 сек. Без регистрации.
          </p>
        </div>
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
      ? `Готовы сгенерировать ${subject.shortTitle.toLowerCase()} ${grade ?? ""} класса`
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
      desc: "Все задания — multiple-choice, легко проверить по шифру ответов.",
    },
    cards: {
      label: "Карточки",
      desc: "Компактная сетка карточек для повторения и запоминания.",
    },
    control: {
      label: "Контрольная",
      desc: "Два варианта одной работы плюс критерии оценивания.",
    },
    "lesson-plan": {
      label: "План урока",
      desc: "ФГОС-конспект на 45 минут, готовый к проведению.",
    },
    presentation: {
      label: "Презентация",
      desc: "5–20 слайдов в PPTX. Иллюстрации и тезисы подобраны LLM.",
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
    image: {
      label: "Картинка",
      desc: "Иллюстрация к заданию: плакат, схема или наглядное пособие. PNG.",
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
              ? "Завершите выбор темы и параметров, и через 30 секунд у вас будет готовый PDF."
              : "ИИ создаст рабочий лист, проверит ответы сам и пришлёт готовый файл."}
        </p>
        {!isExam && (
          <Button variant="primary" size="lg" onClick={onPickPopular} leftIcon={<Sparkles className="w-4 h-4" />}>
            Попробовать: дроби, 5 класс
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

      <div className="px-4 sm:px-6 pb-8 grid grid-cols-3 gap-6 text-center w-full">
        <div>
          <div className="text-2xl font-bold text-brand-600">~30 сек</div>
          <div className="text-xs text-warm-500 mt-0.5">Среднее время</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-brand-600">100%</div>
          <div className="text-xs text-warm-500 mt-0.5">Проверено ИИ</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-brand-600">PDF A4</div>
          <div className="text-xs text-warm-500 mt-0.5">Готов к печати</div>
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
                <span className="inline-block w-4 text-left text-warm-400 animate-pulse">…</span>
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
      <h2 className="text-xl font-semibold text-warm-950 mb-1">Выберите экзамен</h2>
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
        <h2 className="text-xl font-semibold text-warm-950">Выберите предмет</h2>
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
        <h2 className="text-xl font-semibold text-warm-950">Выберите номера</h2>
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
