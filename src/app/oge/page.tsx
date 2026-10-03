"use client";

/**
 * /oge/ — подготовка к ОГЭ и ЕГЭ.
 *
 * ── ГЛАВНОЕ ПРАВИЛО СТРАНИЦЫ ────────────────────────────────────────────────
 * Настоящий вариант приходит с бэкенд-воркера (POST /api/exams/generate).
 * Локальный мок НИКОГДА не выдаётся как настоящая генерация: он показывается
 * только когда сервис недоступен (5xx, сеть, ответ без варианта) и только с
 * явной пометкой «это демонстрационный вариант». Раньше здесь стоял мок с
 * фейковой задержкой 1,2 с и случайным номером — учитель получал заготовку
 * и думал, что это рабочий тренажёр.
 *
 * Номер варианта задаёт учитель и он же лежит в URL (`?exam=&subject=&variant=`),
 * поэтому ссылкой можно поделиться и получить тот же вариант. Незавершённая
 * генерация дополнительно пишется в sessionStorage: после F5 она продолжается
 * сама, учителю не нужно нажимать «Начать» заново.
 *
 * Показанные ошибки бэка — учителю, без кодов и терминов:
 *   402 → нужен тариф «Плюс» · 403 GENERATION_FORBIDDEN → вход ученический
 *   429 → бесплатная квота кончилась · 409 → подтвердить, что не робот
 *   5xx/сеть → демонстрационный вариант с пометкой и кнопкой «Повторить».
 *
 * Query читается из `window.location.search` внутри `useEffect`, а не через
 * `useSearchParams()`: хук при `output: "export"` требует границы <Suspense>,
 * а её fallback («Загрузка…») закрывал собой всю страницу на 3–4 секунды,
 * пока догружается JS. Статический HTML теперь сразу содержит контент.
 */

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ExamRunner } from "@/components/oge/ExamRunner";
import {
  GraduationCap,
  Timer,
  Sparkles,
  TrendingUp,
  Lock,
  Calculator,
  BookOpen,
  Atom,
  FlaskConical,
  Leaf,
  Landmark,
  Scale,
  Languages,
  Monitor,
  BookMarked,
  AlertTriangle,
  CheckCircle2,
  Circle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { plural } from "@/lib/utils/cn";
import { consume, getRemaining, FREE_LIMIT } from "@/lib/utils/limit";
import { priceLabel } from "@/lib/content/plans";
import {
  generateExam,
  loadDemoVariant,
  clampVariantNumber,
  checkVariant,
  hasExplanations,
  ExamApiError,
  type ExamKind,
  type ExamFailureReason,
} from "@/lib/client/exam";
import type { ExamVariant, SubjectSlug } from "@/lib/types";

type SubjectColor = "brand" | "accent" | "info" | "warm";

/** Состояния бэка, в которых показывают настоящий вариант. */
type BlockerReason = Exclude<ExamFailureReason, "unavailable">;

/** Что именно собираем. Живёт в URL и в sessionStorage — отсюда и восстановление. */
interface Target {
  exam: ExamKind;
  subject: SubjectSlug;
  variantNumber: number;
}

type Phase =
  | { kind: "idle" }
  | { kind: "generating"; stage: 0 | 1 | 2; target: Target }
  | {
      kind: "blocked";
      reason: BlockerReason;
      target: Target;
      serverMessage: string | null;
      /** 429: квота не сбрасывается по суткам, а тратится на весь период. */
      quotaIsTotal: boolean;
    }
  | { kind: "ready"; variant: ExamVariant; demo: boolean; target: Target };

/** Стадии генерации. Идут по РЕАЛЬНЫМ вехам запроса, без искусственных таймеров. */
const STAGE_LABELS = [
  "собираем задания по программе",
  "проверяем формулировки",
  "готовим разбор",
] as const;

const PENDING_KEY = "uchlist_oge_pending_v1";

const SUBJECTS_BY_SLUG: Record<string, string> = {
  math: "Математика",
  russian: "Русский язык",
  physics: "Физика",
  chemistry: "Химия",
  biology: "Биология",
  history: "История",
  social: "Обществознание",
  english: "Английский язык",
  informatics: "Информатика",
  literature: "Литература",
};

// TZ-7: иконки предметов — единый стиль Lucide в цветной плашке
// (раньше были emoji, выглядели как сборная солянка).
const iconBgByColor: Record<SubjectColor, string> = {
  brand: "bg-brand-100 text-brand-700",
  accent: "bg-accent-100 text-accent-700",
  info: "bg-blue-100 text-blue-700",
  warm: "bg-warm-200 text-warm-800",
};

const examSubjects: Array<{
  slug: SubjectSlug;
  name: string;
  Icon: LucideIcon;
  color: SubjectColor;
  popular: boolean;
}> = [
  { slug: "math", name: "Математика", Icon: Calculator, color: "brand", popular: true },
  { slug: "russian", name: "Русский язык", Icon: BookOpen, color: "accent", popular: true },
  { slug: "physics", name: "Физика", Icon: Atom, color: "info", popular: false },
  { slug: "chemistry", name: "Химия", Icon: FlaskConical, color: "info", popular: false },
  { slug: "biology", name: "Биология", Icon: Leaf, color: "info", popular: false },
  { slug: "history", name: "История", Icon: Landmark, color: "info", popular: false },
  { slug: "social", name: "Обществознание", Icon: Scale, color: "info", popular: true },
  { slug: "english", name: "Английский язык", Icon: Languages, color: "warm", popular: false },
  { slug: "informatics", name: "Информатика", Icon: Monitor, color: "info", popular: false },
  { slug: "literature", name: "Литература", Icon: BookMarked, color: "accent", popular: false },
];

export default function OgeHubInner() {
  const [exam, setExam] = React.useState<ExamKind>("oge");
  /** Поле выбора номера варианта: задаёт учитель, уходит в URL. */
  const [variantInput, setVariantInput] = React.useState("1");
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  // Спиннер только на нажатой карточке: общий `loading` дёргал все кнопки сразу.
  const [loadingSubject, setLoadingSubject] = React.useState<SubjectSlug | null>(null);
  // Счётчик лимита — видимый, а не мимолётный тост (жалоба: «кнопки не реагируют»).
  const [remaining, setRemaining] = React.useState<number>(FREE_LIMIT);

  const { toast } = useToast();
  /** StrictMode дважды монтирует эффект — автостарт должен быть один. */
  const resumedRef = React.useRef(false);

  const busy = phase.kind === "generating";

  // Лимит живёт в localStorage — читаем только на клиенте.
  React.useEffect(() => {
    setRemaining(getRemaining());
  }, []);

  /**
   * Собрать вариант. Один вход на все сценарии: клик по карточке, автостарт
   * после F5 и кнопка «Повторить» на демо-экране.
   */
  const run = React.useCallback(
    async (target: Target) => {
      setLoadingSubject(target.subject);
      setPhase({ kind: "generating", stage: 0, target });
      // Пишем ДО запроса: если вкладку закрыли или F5 — генерация продолжится.
      writePending(target);
      writeUrlTarget(target);

      try {
        const variant = await generateExam(target, {
          onPhase: (p) =>
            setPhase((cur) => {
              if (cur.kind !== "generating") return cur;
              const stage: 0 | 1 | 2 = p === "collecting" ? 0 : p === "checking" ? 1 : 2;
              return { kind: "generating", stage, target };
            }),
        });

        // Стадия 2 — настоящая проверка ответа: пустой набор заданий тренажёр
        // не запустит, поэтому это повод уйти в демо, а не показать пустоту.
        if (!checkVariant(variant)) {
          throw new ExamApiError("unavailable", 200, "EMPTY_VARIANT", null);
        }
        setPhase((cur) => (cur.kind === "generating" ? { ...cur, stage: 1 } : cur));

        // Стадия 3 — разбор должен быть у каждого задания, иначе обещанный
        // «разбор каждого задания» не выполнен и показывать надо демо.
        if (!hasExplanations(variant)) {
          throw new ExamApiError("unavailable", 200, "NO_EXPLANATIONS", null);
        }
        setPhase((cur) => (cur.kind === "generating" ? { ...cur, stage: 2 } : cur));

        clearPending();
        // Списываем оптимистичный счётчик только за настоящий вариант: демо и
        // отказ бэка учителя не должны стоить ему попытки.
        consume();
        setRemaining(getRemaining());
        setPhase({ kind: "ready", variant, demo: false, target });
      } catch (err) {
        const failure = toFailure(err);
        if (failure.reason === "unavailable") {
          // Сервис недоступен — показываем демо, но честно и с повтором.
          // pending из sessionStorage НЕ чистим: после F5 попробуем собрать
          // настоящий вариант снова, и учителю не придётся начинать заново.
          setPhase({
            kind: "ready",
            variant: loadDemoVariant(target),
            demo: true,
            target,
          });
          toast({
            tone: "error",
            title: "Настоящий вариант пока не собрался",
            description:
              failure.serverMessage ??
              "Открыли демонстрационный вариант — задания в нём типовые.",
          });
          return;
        }
        clearPending();
        setPhase({
          kind: "blocked",
          reason: failure.reason,
          target,
          serverMessage: failure.serverMessage,
          quotaIsTotal: failure.quotaIsTotal,
        });
      } finally {
        setLoadingSubject(null);
      }
    },
    [toast],
  );

  /**
   * Восстановление после перезагрузки. Порядок важен: sessionStorage важнее
   * URL — незавершённая генерация должна продолжиться сама. Ссылка без
   * sessionStorage просто восстанавливает номер варианта (её открытие не
   * сжигает квоту учителя молча).
   */
  React.useEffect(() => {
    const pending = readPending();
    if (pending) {
      setExam(pending.exam);
      setVariantInput(String(pending.variantNumber));
      if (resumedRef.current) return;
      resumedRef.current = true;
      void run(pending);
      return;
    }
    // Читаем query из window.location, а не через useSearchParams: хук требовал
    // <Suspense> при статическом экспорте, и fallback прятал всю страницу до
    // гидратации. Эффект и так с пустым списком зависимостей — читаем один раз.
    const fromUrl = readUrlTarget(new URLSearchParams(window.location.search));
    if (!fromUrl) return;
    setExam(fromUrl.exam);
    setVariantInput(String(fromUrl.variantNumber));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = (subject: SubjectSlug) => {
    if (busy) return;
    void run({ exam, subject, variantNumber: clampVariantNumber(variantInput) });
  };

  /** 402/403/429/409 — экран с причиной, которую учитель понимает, без кодов. */
  if (phase.kind === "ready") {
    return (
      <div>
        {phase.demo && (
          <div className="container-tight max-w-3xl pt-6 sm:pt-10">
            <Card className="border-amber-300 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-semibold text-amber-900">
                    Это демонстрационный вариант, задания типовые. Настоящий вариант соберём,
                    когда сервис будет доступен
                  </p>
                  <p className="text-sm text-amber-800 mt-1">
                    Вариант {phase.variant.variantNumber} ·{" "}
                    {SUBJECTS_BY_SLUG[phase.variant.subject] ?? phase.variant.subject}. Решать
                    можно — тренажёр работает, но эти задания не проверялись и не разбирались под
                    ваш класс.
                  </p>
                  <Button
                    variant="primary"
                    size="md"
                    className="mt-4"
                    leftIcon={<RefreshCw className="w-4 h-4" />}
                    onClick={() => void run(phase.target)}
                  >
                    Повторить
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}
        <ExamRunner
          variant={phase.variant}
          onExit={() => setPhase({ kind: "idle" })}
        />
      </div>
    );
  }

  const exhausted = remaining <= 0;

  return (
    <div className="container-tight py-8 sm:py-12">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <Badge tone="accent" className="mb-4">
          <Sparkles className="w-3 h-3" />
          Подготовка к экзаменам
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight">
          ОГЭ и ЕГЭ с&nbsp;разбором каждого задания
        </h1>
        <p className="mt-4 text-lg text-warm-600">
          Свежий вариант по любому предмету. Решайте по одному заданию — сразу видите правильный ответ и подробный разбор.
        </p>
        {/* Постоянный счётчик лимита: раньше исчерпанный лимит сообщал только
            мимолётным тостом, и кнопки выглядели «нерабочими». */}
        <div
          className={cn(
            "inline-flex items-center gap-2 mt-5 px-3 py-1.5 rounded-full text-sm font-medium",
            exhausted
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-brand-50 text-brand-700 border border-brand-100"
          )}
        >
          {exhausted ? <Lock className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
          {exhausted
            ? "Бесплатные варианты закончились"
            : `Осталось генераций: ${remaining} из ${FREE_LIMIT}`}
        </div>
      </div>

      {/* Tabs ОГЭ/ЕГЭ */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 p-1 bg-warm-100 rounded-2xl">
          {(["oge", "ege"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setExam(e)}
              className={`px-5 h-10 rounded-xl text-sm font-semibold transition-all ${
                exam === e
                  ? "bg-white text-warm-950 shadow-soft"
                  : "text-warm-600 hover:text-warm-900"
              }`}
            >
              {e === "oge" ? "ОГЭ · 9 класс" : "ЕГЭ · 11 класс"}
            </button>
          ))}
        </div>
      </div>

      {/* Стадия генерации — реальный прогресс по вехам запроса. Сетка предметов
          остаётся на месте, но кнопки на время сборки заблокированы: раньше
          клик по второй карточке просто ничего не делал, и это читалось как
          «кнопки не реагируют». */}
      {phase.kind === "generating" && (
        <Card className="max-w-2xl mx-auto mb-8 border-brand-200 bg-brand-50">
          <p className="font-semibold text-warm-950 mb-4">
            Собираем вариант {phase.target.variantNumber} ·{" "}
            {phase.target.exam === "oge" ? "ОГЭ" : "ЕГЭ"} ·{" "}
            {SUBJECTS_BY_SLUG[phase.target.subject] ?? phase.target.subject}
          </p>
          <ol className="space-y-2">
            {STAGE_LABELS.map((label, i) => {
              const done = i < phase.stage;
              const current = i === phase.stage;
              return (
                <li
                  key={label}
                  className={cn(
                    "flex items-center gap-2.5 text-sm",
                    done
                      ? "text-brand-700"
                      : current
                        ? "text-warm-950 font-medium"
                        : "text-[color:var(--text-muted)]"
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : current ? (
                    <span
                      className="w-4 h-4 shrink-0 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Circle className="w-4 h-4 shrink-0" />
                  )}
                  {label}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {/* Отказ бэка: 402 / 403 / 429 / 409 — словами, без кодов и терминов. */}
      {phase.kind === "blocked" && (
        <BlockedNotice
          reason={phase.reason}
          serverMessage={phase.serverMessage}
          quotaIsTotal={phase.quotaIsTotal}
          onRetry={() => void run(phase.target)}
          onDismiss={() => setPhase({ kind: "idle" })}
        />
      )}

      {/* Номер варианта — задаёт учитель, переживает перезагрузку и попадает
          в ссылку. Раньше его подставлял Math.random(), и «вариант 57» из
          ссылки не существовал ни на чьём сервере. */}
      <div className="max-w-md mx-auto mb-8">
        <Input
          id="oge-variant"
          label="Номер варианта"
          hint="От 1 до 999. Номер попадёт в ссылку — по ней можно вернуться к тому же варианту."
          inputMode="numeric"
          value={variantInput}
          disabled={busy}
          onChange={(e) => setVariantInput(e.target.value)}
          onBlur={() => setVariantInput(String(clampVariantNumber(variantInput)))}
          className="text-center"
        />
      </div>

      {/* Subject picker */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 max-w-6xl mx-auto">
        {examSubjects.map((s) => {
          const Icon = s.Icon;
          return (
            <Card key={s.slug} hover className="text-center relative">
              {s.popular && (
                <Badge tone="brand" className="absolute top-3 right-3">
                  <Sparkles className="w-3 h-3" />
                </Badge>
              )}
              {/* TZ-7: единый стиль — Lucide-иконка w-12 h-12 в цветной плашке 56×56. */}
              <div
                className={cn(
                  "w-14 h-14 mx-auto rounded-2xl grid place-items-center mb-3 mt-2",
                  iconBgByColor[s.color]
                )}
                aria-hidden
              >
                <Icon className="w-7 h-7" strokeWidth={1.75} />
              </div>
              <h3 className="text-base font-semibold text-warm-950">{s.name}</h3>
              <p className="text-xs text-warm-500 mt-1">
                {exam === "oge" ? "9 класс" : "11 класс"}
              </p>
              <Button
                size="md"
                fullWidth
                className="mt-4"
                onClick={() => handleStart(s.slug)}
                loading={loadingSubject === s.slug}
                disabled={busy && loadingSubject !== s.slug}
                leftIcon={<GraduationCap className="w-4 h-4" />}
              >
                Начать
              </Button>
              {exhausted && (
                <Link
                  href="/pricing"
                  className="mt-2 inline-block text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  Снять лимит — тарифы
                </Link>
              )}
            </Card>
          );
        })}
      </div>

      {/* Features */}
      <section className="mt-16 grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
        {[
          {
            icon: Timer,
            title: "Таймер как на экзамене",
            text: "Реальные 3-4 часа. По окончании — автоматическая проверка.",
          },
          {
            icon: TrendingUp,
            title: "Видно слабые темы",
            text: "После варианта — карта: где ошиблись, где точно знаете. Подскажет, что подтянуть.",
          },
          {
            icon: Sparkles,
            title: "Разбор каждого задания",
            text: "Не просто «правильно/неправильно», а пошаговое объяснение от AI.",
          },
        ].map((f) => (
          <div key={f.title} className="flex flex-col items-center text-center">
            <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 grid place-items-center mb-3">
              <f.icon className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-warm-950 mb-1">{f.title}</h4>
            <p className="text-sm text-warm-600">{f.text}</p>
          </div>
        ))}
      </section>

      {/* B2C link */}
      <div className="text-center mt-12">
        <p className="text-sm text-warm-600">
          Бесплатно доступно{" "}
          {FREE_LIMIT} {plural(FREE_LIMIT, "вариант", "варианта", "вариантов")} — не каждый день,
          а на весь период. Безлимит — на тарифе Плюс ({priceLabel("plus", "month")}).
        </p>
        <Link
          href="/pricing"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-warm-500 hover:text-warm-900"
        >
          <Lock className="w-3.5 h-3.5" />
          Смотреть тарифы
        </Link>
      </div>
    </div>
  );
}

/**
 * Экран отказа. Тексты — на языке учителя: ни кодов (402/429), ни слов
 * «квота» или «тарифный план API». Текст бэка, если он есть, безопасен для
 * показа — он тоже написан по-русски и без терминов, поэтому дублируем его
 * только там, где он несёт смысл (квота).
 */
function BlockedNotice({
  reason,
  serverMessage,
  quotaIsTotal,
  onRetry,
  onDismiss,
}: {
  reason: BlockerReason;
  serverMessage: string | null;
  quotaIsTotal: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const copy: Record<BlockerReason, { title: string; text: string[]; cta: string }> = {
    upgrade: {
      title: "Варианты ОГЭ и ЕГЭ — в тарифе «Плюс»",
      text: [
        "Сборка варианта с проверкой и пошаговым разбором входит в тариф «Плюс».",
        "На бесплатном тарифе доступны рабочие листы, конспекты и тесты — их можно собирать без ограничений по времени.",
      ],
      cta: "Посмотреть тарифы",
    },
    forbidden: {
      title: "Под этим входом варианты не собираются",
      text: [
        "Сейчас вы вошли как ученик. Варианты собирает учитель — попросите его выдать готовый вариант со ссылкой.",
      ],
      cta: "Понятно",
    },
    rate_limit: {
      title: "Бесплатные варианты закончились",
      text: [
        quotaIsTotal
          ? "Использованы все бесплатные генерации. Они не обновляются каждый день — счёт не сбрасывается."
          : "Бесплатные генерации на этом аккаунте исчерпаны.",
        "Чтобы собирать варианты без ограничений, нужен тариф «Плюс».",
      ],
      cta: "Посмотреть тарифы",
    },
    challenge: {
      title: "Подтвердите, что запрос отправил человек",
      text: [
        "Сервис заметил признаки автоматического запроса и попросил подтверждение.",
        "Нажмите «Попробовать ещё раз» — вариант будет собран заново.",
      ],
      cta: "Попробовать ещё раз",
    },
  };
  const c = copy[reason];
  const showPricing = reason === "upgrade" || reason === "rate_limit";

  return (
    <Card className="max-w-2xl mx-auto mb-8 border-amber-200 bg-amber-50">
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-warm-950">{c.title}</p>
          {c.text.map((line) => (
            <p key={line} className="text-sm text-warm-600 mt-1">
              {line}
            </p>
          ))}
          {reason === "rate_limit" && serverMessage && (
            <p className="text-sm text-warm-500 mt-1">{serverMessage}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            {showPricing ? (
              <>
                <Button as="link" href="/pricing" variant="primary" size="md">
                  {c.cta}
                </Button>
                <Button variant="ghost" size="md" onClick={onDismiss}>
                  Остаться на странице
                </Button>
              </>
            ) : reason === "challenge" ? (
              <Button variant="primary" size="md" onClick={onRetry}>
                {c.cta}
              </Button>
            ) : (
              <Button variant="secondary" size="md" onClick={onDismiss}>
                {c.cta}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── URL и sessionStorage ───────────────────────────────────────────────────

function writeUrlTarget(target: Target): void {
  if (typeof window === "undefined") return;
  const qs = new URLSearchParams({
    exam: target.exam,
    subject: target.subject,
    variant: String(target.variantNumber),
  }).toString();
  // pathname из window.location, а не жёсткий "/oge": при output:"export"
  // путь с trailingSlash, и жёсткая ссылка ломала бы на нём навигацию.
  const url = `${window.location.pathname}?${qs}`;
  window.history.replaceState(null, "", url);
}

function readUrlTarget(params: URLSearchParams | null): Target | null {
  if (!params) return null;
  const exam = params.get("exam");
  const subject = params.get("subject");
  const variant = params.get("variant");
  if (exam !== "oge" && exam !== "ege") return null;
  if (!subject || !(subject in SUBJECTS_BY_SLUG)) return null;
  const n = Number.parseInt(variant ?? "", 10);
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  return { exam, subject: subject as SubjectSlug, variantNumber: n };
}

function writePending(target: Target): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(target));
  } catch {
    /* приватный режим — не повод отказывать в генерации */
  }
}

function readPending(): Target | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<Target>;
    if (t.exam !== "oge" && t.exam !== "ege") return null;
    if (typeof t.subject !== "string" || !(t.subject in SUBJECTS_BY_SLUG)) return null;
    // `Number.isInteger(x)` — это функция, а не оператор, поэтому она НЕ сужает
    // тип: `t.variantNumber` остаётся `number | undefined` и не assignable в
    // `number`. Проверяем через `typeof` — он сужает, и результат в early-return
    // гарантированно число.
    if (typeof t.variantNumber !== "number" || !Number.isInteger(t.variantNumber)) return null;
    return { exam: t.exam, subject: t.subject as SubjectSlug, variantNumber: t.variantNumber };
  } catch {
    return null;
  }
}

function clearPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* см. выше */
  }
}

/** Любая ошибка → ExamApiError. Неизвестное считаем недоступностью сервиса. */
function toFailure(err: unknown): ExamApiError {
  if (err instanceof ExamApiError) return err;
  return new ExamApiError("unavailable", 0, "UNKNOWN", null);
}
