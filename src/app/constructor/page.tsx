"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import { LessonPlanPreview } from "@/components/constructor/LessonPlanPreview";
import { PresentationPreview } from "@/components/constructor/PresentationPreview";
import { KtpPreview } from "@/components/constructor/KtpPreview";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { ArtifactTypePicker } from "@/components/constructor/ArtifactTypePicker";
import { TypePreviewThumb } from "@/components/constructor/TypePreviewThumb";
import {
  PresetGrid,
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
  Worksheet,
  LessonPlan,
  Presentation,
  Ktp,
  Subject as SubjectType,
  Grade as GradeType,
} from "@/lib/types";
import { addToHistory, saveFavorite, toggleFavorite, trackExamModeSelected } from "@/lib/utils/storage";
import {
  generateWorksheetSmart,
  generateLessonPlanSmart,
  generatePresentationSmart,
  generateKtpSmart,
} from "@/lib/client/llm";
import { generateWorksheetDocx, downloadBlob } from "@/lib/utils/docx";
import { trackEvent } from "@/lib/track";
import { generateLessonPlanDocx } from "@/lib/utils/lesson-plan-docx";
import { generateKtpDocx } from "@/lib/utils/ktp-docx";
import { generatePptx, pptxFilename } from "@/lib/utils/pptx";
import { canGenerate, consume, getRemaining } from "@/lib/utils/limit";
import { pluralizeTasks } from "@/lib/utils/cn";
import { saveWorksheet } from "@/lib/worksheets/api";
import { useUsage } from "@/lib/hooks/useUsage";
import { EditChat } from "@/components/f08/EditChat";
import { PhotoCheckPanel } from "@/components/f06/PhotoCheckPanel";

/** F-04-C: режим wizard. «По теме» — текущий flow. «По номеру» — экзамен → предмет → номера → параметры. */
type Mode = "topic" | "exam";

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
 * F-04-B: success-конфетти после удачной генерации.
 * ~80 частиц сверху страницы, ~1.2с (ticks ~75 × 16мс).
 * Dynamic import — SSR-safe: canvas-confetti трогает window/canvas, не годится для server-render.
 */
async function fireConfetti() {
  if (typeof window === "undefined") return;
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

function ConstructorPage() {
  const searchParams = useSearchParams();
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
  const [remaining, setRemaining] = React.useState<number>(3);
  const [showPaywall, setShowPaywall] = React.useState(false);
  /** F-06: видна ли inline-панель проверки фото тетради (только worksheet). */
  const [photoCheckOpen, setPhotoCheckOpen] = React.useState(false);
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

  // Init: подтянуть query params из SEO-страниц тем + лимит
  React.useEffect(() => {
    setRemaining(getRemaining());

    // F-04-C: deep-link для режима «По номеру ОГЭ/ЕГЭ».
    // Имеет приоритет над topic-флоу, т.к. `?exam=` — это маркер экзамен-режима.
    const examParam = searchParams.get("exam");
    if (examParam === "oge" || examParam === "ege") {
      const subjParam = searchParams.get("subject") as SubjectSlug | null;
      const numParam = Number(searchParams.get("number"));
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
    const s = searchParams.get("subject") as SubjectSlug | null;
    const g = Number(searchParams.get("grade"));
    const t = searchParams.get("topic");
    const d = searchParams.get("difficulty") as Difficulty | null;
    const c = Number(searchParams.get("count"));
    const ty = searchParams.get("type") as TaskType | null;
    if (s && getSubject(s)) {
      setSubject(s);
      const validGrade = !Number.isNaN(g) && g > 0 ? g : null;
      if (validGrade) setGrade(validGrade);
      if (t) setTopic(t);
      if (d && ["easy", "medium", "hard"].includes(d)) setDifficulty(d);
      if (!Number.isNaN(c) && c >= 5 && c <= 30) setCount(c);
      if (ty && ["worksheet", "test", "cards", "control", "lesson-plan", "presentation", "ktp"].includes(ty)) setType(ty as TaskType);
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
  }, [searchParams]);

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

    if (!canGenerate()) {
      setShowPaywall(true);
      return;
    }

    setGenerating(true);
    setWorksheet(null);
    setLessonPlan(null);
    setPresentation(null);
    setKtp(null);
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

    try {
      // Q1-2027: switch по типу артефакта — разные smart-функции и разный result-handling.
      const result = await (async () => {
        switch (type) {
          case "lesson-plan":
            return { kind: "lesson-plan" as const, payload: (await generateLessonPlanSmart(body)).data };
          case "presentation":
            return { kind: "presentation" as const, payload: (await generatePresentationSmart(body)).data };
          case "ktp":
            return { kind: "ktp" as const, payload: (await generateKtpSmart(body)).data };
          default:
            return { kind: "worksheet" as const, payload: (await generateWorksheetSmart(body)).worksheet };
        }
      })();

      const counter = consume();
      const left = Math.max(0, 3 - counter.count);

      // Снэпим к "done" и сбрасываем pending-переходы.
      stageTimers.forEach((id) => window.clearTimeout(id));
      setProgressStage("done");

      // Сохраняем в правильный state.
      let artifactTitle = "";
      let historyType: TaskType = "worksheet";
      let histSubject: SubjectSlug | null = null;
      let histGrade: number | undefined = undefined;

      if (result.kind === "lesson-plan") {
        const lp = result.payload as LessonPlan;
        setLessonPlan(lp);
        artifactTitle = lp.title;
        historyType = "lesson-plan";
        histSubject = lp.subject;
        histGrade = lp.grade;
      } else if (result.kind === "presentation") {
        const p = result.payload as Presentation;
        setPresentation(p);
        artifactTitle = p.title;
        historyType = "presentation";
        histSubject = p.subject;
        histGrade = p.grade;
      } else if (result.kind === "ktp") {
        const k = result.payload as Ktp;
        setKtp(k);
        artifactTitle = k.title;
        historyType = "ktp";
        histSubject = k.subject;
        histGrade = k.grade;
      } else {
        const ws = result.payload as Worksheet;
        setWorksheet(ws);
        artifactTitle = ws.title;
        histSubject = ws.subject as SubjectSlug;
        histGrade = ws.grade;
      }

      setRemaining(left);

      addToHistory({
        id: result.kind === "lesson-plan" ? (result.payload as LessonPlan).id
          : result.kind === "presentation" ? (result.payload as Presentation).id
          : result.kind === "ktp" ? (result.payload as Ktp).id
          : (result.payload as Worksheet).id,
        type: historyType,
        title: artifactTitle,
        subject: (histSubject ?? subject) as SubjectSlug,
        grade: histGrade,
        createdAt: new Date().toISOString(),
        isFavorite: false,
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
      const saveInput: Parameters<typeof saveWorksheet>[0] = (() => {
        if (result.kind === "worksheet") {
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
        if (result.kind === "lesson-plan") {
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
        if (result.kind === "presentation") {
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
        // ktp
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
      })();

      void saveWorksheet(saveInput).then((r) => {
        if (r.ok) {
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

      // F-04-B: success-burst сверху страницы (~80 частиц, ~1.2с).
      void fireConfetti();

      toast({
        tone: "success",
        title: "Готово!",
        description: `Сгенерировано за 1 сек · demo-режим.`,
      });
    } catch (err) {
      stageTimers.forEach((id) => window.clearTimeout(id));
      setProgressStage(null);
      toast({
        tone: "error",
        title: "Не получилось",
        description: "Попробуйте ещё раз через пару секунд",
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
      '[aria-label="Открыть чат с AI для правок"]',
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
                      Выбраны: {getSubject(subject)?.shortTitle} · {grade} кл. Можно поменять в шаге «Что».
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
                /** Q1-2027: флаг подписки Плюс — пока true, реальный тариф привяжем позже. */
                hasPlus={true}
                summary={mode === "topic"
                  ? subjectData && grade
                    ? `${subjectData.emoji} ${subjectData.shortTitle} · ${grade} кл${topic && gradeData?.topics.find((tt) => tt.slug === topic) ? ` · ${gradeData.topics.find((tt) => tt.slug === topic)!.title}` : ""}`
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

            {/* Q1-2027: switch по типу — рендерим правильный preview + кнопки. */}
            {!generating && (worksheet || lessonPlan || presentation || ktp) && (() => {
              const kind: "worksheet" | "lesson-plan" | "presentation" | "ktp" =
                worksheet ? "worksheet" : lessonPlan ? "lesson-plan" : presentation ? "presentation" : "ktp";

              const title =
                kind === "worksheet" ? worksheet!.title :
                kind === "lesson-plan" ? lessonPlan!.title :
                kind === "presentation" ? presentation!.title :
                ktp!.title;

              const subtitle =
                kind === "worksheet"
                  ? `${worksheet!.tasks.length} ${pluralizeTasks(worksheet!.tasks.length)} · ${type === "control" ? "Контрольная" : "Рабочий лист"} · вариант ${Math.floor(Math.random() * 9) + 1}`
                  : kind === "lesson-plan"
                    ? `План урока · ${lessonPlan!.stages.length} этапов · ~${lessonPlan!.stages.reduce((s, x) => s + x.durationMin, 0)} мин`
                    : kind === "presentation"
                      ? `Презентация · ${presentation!.slideCount} слайдов · тема ${presentation!.theme}`
                      : `КТП · ${ktp!.schoolYear} · ${ktp!.totalHours} ч`;

              const downloadLabel =
                kind === "presentation" ? "PPTX" : "DOCX";

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
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Sparkles className="w-4 h-4" />}
                          onClick={handleOpenEditChat}
                          aria-label="Открыть AI-правки"
                          data-testid="open-edit-chat"
                        >
                          <span className="hidden sm:inline">AI-правки</span>
                          <span className="sm:hidden">AI</span>
                        </Button>
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
                      </>
                    )}
                    {kind !== "presentation" && (
                      <Button variant="primary" size="sm" leftIcon={<Download className="w-4 h-4" />} onClick={handlePrint}>
                        PDF
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={handleDocx}>
                      {downloadLabel}
                    </Button>
                  </div>

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
                  {kind === "worksheet" && worksheet && (
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

                  <Card className="no-print bg-gradient-to-br from-brand-50 to-white border-brand-200">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-500 grid place-items-center text-white shrink-0">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-warm-950">Лимит бесплатных генераций</h3>
                        {/* W1+п.2: для залогиненного юзера — серверный счётчик (useUsage),
                            для анонимного — localStorage (`limit.ts`). Один источник UI. */}
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
                              return `Осталось ${left} из ${serverUsage.generationsLimit} на сегодня. Подписка Базовый — безлимит за 500 ₽/мес (или 375 ₽/мес при оплате за год).`;
                            }
                            return `Осталось ${remaining} из 3 на сегодня. Подписка Базовый — безлимит за 500 ₽/мес (или 375 ₽/мес при оплате за год).`;
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
                i <= currentIdx ? "text-warm-700" : "text-warm-400"
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
        <span className="text-xs text-warm-500">Темы по ФГОС, 1-11 класс</span>
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
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-warm-400 mb-0.5">
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
  const showUmkChips = umkList.length > 1;

  // F-09: реальный фильтр по УМК. Тема показывается если:
  //   - у темы НЕТ поля umk (общая для всех УМК), или
  //   - выбранный umk входит в список umk темы.
  // Без активного фильтра показываем всё (на случай если UMK не выбран).
  const filteredTopics = gradeData.topics.filter((t) => {
    if (!umk) return true;
    if (!t.umk || t.umk.length === 0) return true;
    return t.umk.includes(umk);
  });

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

      <div className="space-y-2 max-h-[420px] overflow-y-auto -mx-2 px-2 scrollbar-hide">
        {filteredTopics.length === 0 ? (
          <div className="text-sm text-warm-500 py-6 text-center">
            Для выбранного учебника нет тем. Попробуйте сбросить выбор УМК — кнопка «Назад».
          </div>
        ) : filteredTopics.map((t) => (
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
  /**
   * TZ-12: id выбранного шаблонного пресета (Шаг 1 «Сценарий»).
   * Если пресет выбран — тип артефакта уже задан им, и повторно спрашивать
   * «Лист / Тест / Карточки» на Шаге 3 не нужно (юзер: «вроде же ранее выбирали?»).
   */
  selectedPresetId: string | null;
  /** Название выбранного пресета — для подписи «Тип выбран шаблоном: …». */
  selectedPresetTitle: string | null;
}) {

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
            TZ-12: если тип уже задан шаблоном на Шаге 1, не спрашиваем повторно —
            вместо сегментера показываем строку «Тип выбран шаблоном» + ссылку «Сменить». */}
        <div>
          <label className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-1.5 block">Тип</label>
          {typeFixedByPreset ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-warm-200 bg-warm-50 px-3 h-11">
              <span className="text-sm text-warm-700 truncate min-w-0">
                Выбран шаблоном: <span className="font-medium text-warm-950">{selectedPresetTitle}</span>
              </span>
              <button
                type="button"
                onClick={onEditSummary}
                className="text-xs font-medium text-brand-600 hover:underline shrink-0 whitespace-nowrap"
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
          <div className="flex justify-between text-[10px] text-warm-400 mt-0.5">
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
  const TYPE_PREVIEW: Record<TaskType, { label: string; sample: string; desc: string }> = {
    worksheet: {
      label: "Рабочий лист",
      sample: "1. Решите уравнение: 3x + 12 = 0…",
      desc: "Классический список заданий с местом для ответов. PDF или DOCX.",
    },
    test: {
      label: "Тест",
      sample: "1. Сократите дробь 8/12.   ○ A) 1/2  ○ B) 2/3  ○ C) 4/6  ○ D) 3/4",
      desc: "Все задания — multiple-choice, легко проверить по шифру ответов.",
    },
    cards: {
      label: "Карточки",
      sample: "Карточка 1: «Столица Франции?» → ответ: Париж",
      desc: "Компактная сетка карточек для повторения и запоминания.",
    },
    control: {
      label: "Контрольная",
      sample: "Вариант 1 / Вариант 2 · 2 балла за задание · критерии оценки",
      desc: "Два варианта одной работы плюс критерии оценивания.",
    },
    "lesson-plan": {
      label: "План урока",
      sample: "Этапы: 1) Оргмомент 2 мин · 2) Опрос 7 мин · 3) Новая тема 18 мин…",
      desc: "ФГОС-конспект на 45 минут, готовый к проведению.",
    },
    presentation: {
      label: "Презентация",
      sample: "Слайд 3: «Дроби в нашей жизни» — картинка + 3 пункта",
      desc: "5–20 слайдов в PPTX. Иллюстрации и тезисы подобраны LLM.",
    },
    ktp: {
      label: "КТП",
      sample: "Сентябрь · Тема 1 (4 ч) · Тема 2 (3 ч) · …",
      desc: "Календарно-тематическое планирование на учебный год.",
    },
    oge: {
      label: "Вариант ОГЭ",
      sample: "Часть 1 (задания 1–19) + Часть 2 (20–25)",
      desc: "Полный вариант ОГЭ по номерам заданий ФИПИ.",
    },
    ege: {
      label: "Вариант ЕГЭ",
      sample: "Часть 1 (задания 1–27) + Часть 2 (28–…)",
      desc: "Полный вариант ЕГЭ по номерам заданий ФИПИ.",
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
              : "AI создаст рабочий лист, проверит ответы сам и пришлёт готовый файл."}
        </p>
        {!isExam && (
          <Button variant="primary" size="lg" onClick={onPickPopular} leftIcon={<Sparkles className="w-4 h-4" />}>
            Попробовать: дроби, 5 класс
          </Button>
        )}
      </div>

      {/* F-09: превью выбранного типа — образец результата.
          TZ-12: вместо строки текста — визуальная миниатюра формата (квадратики,
          радио-кружки, сетка слайдов и т.п.), чтобы юзер сразу видел результат. */}
      <div className="px-4 sm:px-6 pb-4">
        <div className="text-[10px] uppercase tracking-wider text-warm-500 font-semibold mb-2">
          Как будет выглядеть результат
        </div>
        <div className="rounded-xl border border-warm-200 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-warm-950">{preview.label}</div>
            <div className="text-[10px] text-warm-500 uppercase tracking-wider">пример</div>
          </div>
          <TypePreviewThumb type={type} />
          <div className="text-[11px] text-warm-500 mt-3">{preview.desc}</div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pb-8 grid grid-cols-3 gap-6 text-center w-full">
        <div>
          <div className="text-2xl font-bold text-brand-600">~30 сек</div>
          <div className="text-xs text-warm-500 mt-0.5">Среднее время</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-brand-600">100%</div>
          <div className="text-xs text-warm-500 mt-0.5">Проверено AI</div>
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
  { id: "selecting", label: "Подбираю задания по программе", hint: "Читаем ФГОС и подбираем задания под уровень" },
  { id: "verifying", label: "Решаю и проверяю каждое задание", hint: "AI прогоняет каждый ответ, чтобы не было мусора" },
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
                    : "text-warm-400"
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
// Обертка в Suspense обязательна при использовании useSearchParams + output: export
export default function ConstructorPageWrapper() {
  return (
    <Suspense fallback={<div className="container-tight py-20 text-center text-warm-500">Загрузка…</div>}>
      <ConstructorPage />
    </Suspense>
  );
}

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
        {exam === "oge" ? "ОГЭ · 9 класс" : "ЕГЭ · 11 класс"} — доступно {list.length} предметов
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

      {/* Сетка доступных номеров */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5 max-h-[280px] overflow-y-auto -mx-2 px-2 scrollbar-hide">
        {list.map((it) => {
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
