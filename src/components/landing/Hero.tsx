"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Sparkles, FileCheck, Wand2, ArrowRight, Play, Check } from "lucide-react";
import { useTilt } from "@/hooks/useTilt";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { getRealMetrics } from "@/components/landing/Stats";
import { FREE_QUOTA_LABEL } from "@/lib/content/plans";
import { SITE_HOST } from "@/lib/site";
import { useRouter } from "next/navigation";

const DOWNLOAD_HREF =
  "/constructor?subject=math&grade=5&topic=drobi-obyknovennye&type=worksheet";
const REGEN_HREF = "/constructor?subject=math&grade=5&type=worksheet";

/**
 * Число тем в каталоге считается из таксономии, а не вписано в разметку:
 * секция «Что внутри» (Stats) и секция предметов (Subjects) показывают то же
 * самое значение, поэтому расходиться им больше не с чем.
 */
const CATALOG_TOPICS = getRealMetrics().topics;

export function Hero() {
  return (
    <section className="relative pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-16 overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
      <div className="absolute inset-0 -z-10 bg-noise" />
      <div className="absolute -top-20 right-0 -z-10 w-[480px] h-[480px] blob-shape bg-gradient-to-br from-brand-200/60 to-brand-300/40 blur-3xl" />
      <div className="absolute top-40 -left-32 -z-10 w-[400px] h-[400px] blob-shape bg-gradient-to-br from-accent-200/40 to-accent-300/30 blur-3xl" />
      <div className="absolute top-32 right-1/4 w-2 h-2 rounded-full bg-accent-400 animate-bounce-subtle" style={{ animationDelay: "0s" }} />
      <div className="absolute top-48 right-1/3 w-3 h-3 rounded-full bg-brand-300 animate-bounce-subtle" style={{ animationDelay: "0.6s" }} />
      <div className="absolute top-64 left-1/4 w-2 h-2 rounded-full bg-warm-400 animate-bounce-subtle" style={{ animationDelay: "1.2s" }} />

      <div className="container-tight">
        <div className="max-w-3xl mx-auto text-center">
          <Badge tone="brand" className="mb-5 animate-fade-in">
            <Sparkles className="w-3.5 h-3.5" />
            Бета · {FREE_QUOTA_LABEL}, без регистрации
          </Badge>

          {/* TZ-1: убран animate-fade-in — он оставлял H1 на opacity:0 при первом кадре
              keyframe (fill-mode:none), и заголовок мерцал бледно-серым.
              text-warm-950 добавлен явно (хотя он и так в base layer @apply для h1),
              чтобы перебить любые потенциальные override'ы. */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold tracking-tight text-balance text-warm-950">
            Не&nbsp;тратьте вечер на&nbsp;рабочий&nbsp;лист.
            <br />
            {/* Подсветка задаётся фоном самого текста, а не отдельной полосой.
                Раньше здесь был absolute-блок `bottom-1 h-3` внутри inline-block:
                текст переносится на две строки, полоса рисовалась по нижней границе
                последней строки, но по ширине самой широкой — на мобильном она шла
                прямо по буквам. `box-decoration-break: clone` заставляет фон
                повторяться на каждой строке, а градиент в стиле ограничивает его
                нижней третью строки — получается штрих маркера, а не заливка блока. */}
            <span className="mt-2 block">
              <span
                className="text-brand-600 rounded-[0.3em] px-[0.12em] -mx-[0.12em] [-webkit-box-decoration-break:clone] [box-decoration-break:clone]"
                style={{
                  backgroundImage:
                    "linear-gradient(to top, rgba(255,202,184,0.9) 0 34%, rgba(255,202,184,0) 34%)",
                }}
              >
                Сделайте его за&nbsp;30&nbsp;секунд
              </span>
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-warm-600 text-pretty max-w-2xl mx-auto leading-relaxed animate-fade-in" style={{ animationDelay: "0.1s", animationFillMode: "both" }}>
            Вечер уходит на&nbsp;поиск заданий по&nbsp;программе, перенос в&nbsp;Word и&nbsp;проверку, что класс и&nbsp;тема&nbsp;— правильные. Мы&nbsp;делаем рабочий лист за&nbsp;30&nbsp;секунд: задачи под&nbsp;ФГОС, верный класс и&nbsp;тема, ответы и&nbsp;пояснения внутри.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
            <Button as="link" href="/constructor" variant="primary" size="xl" leftIcon={<Wand2 className="w-5 h-5" />}>
              Сделать рабочий лист
            </Button>
            <Button as="link" href="/oge" variant="secondary" size="xl" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Потренироваться к ОГЭ
            </Button>
          </div>

          <p className="mt-4 text-sm text-warm-500 animate-fade-in" style={{ animationDelay: "0.3s", animationFillMode: "both" }}>
            Без регистрации · PDF или DOCX · Подходит для&nbsp;печати
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm animate-fade-in" style={{ animationDelay: "0.4s", animationFillMode: "both" }}>
            {/* Плитку «Среднее время ~30 сек» убрали: замера длительности
                генерации в коде нет, а в блоке метрик это было единственное
                придуманное число. Обещание «за 30 секунд» осталось в
                заголовке и кнопках — там оно приписывает скорость работы,
                а не измеренный факт. */}

            <Stat icon={<FileCheck className="w-4 h-4" />} label="с&nbsp;ответами и&nbsp;пояснениями" value="Все листы" />
            <Stat icon={<Sparkles className="w-4 h-4" />} label="Тем в&nbsp;каталоге" value={`${CATALOG_TOPICS}`} />
          </div>
        </div>

        <HeroMockup />
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="group inline-flex items-center gap-2 text-warm-600">
      <span className="grid place-items-center w-7 h-7 rounded-full bg-brand-100 text-brand-700 transition-transform duration-200 motion-safe:group-hover:scale-110">
        {icon}
      </span>
      <div className="text-left">
        <div className="font-semibold text-warm-950">{value}</div>
        <div className="text-xs text-warm-500">{label}</div>
      </div>
    </div>
  );
}

const MOCK_TASKS = [
  "Сократите дробь: 8/12 = __",
  "Сложите: 2/5 + 1/5 = __",
  "Приведите 1/3 и 2/5 к общему знаменателю",
  "Из 3/4 м ткани отрезали 1/2 м. Сколько осталось?",
  "Найдите x: x/6 = 4/12",
];

function HeroMockup() {
  const [ref, tiltStyle] = useTilt<HTMLDivElement>({ max: 5 });
  const router = useRouter();
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const [showReadyHint, setShowReadyHint] = React.useState(false);
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    let timer: number | undefined;
    try {
      if (
        typeof window !== "undefined" &&
        window.localStorage.getItem("preview_ready")
      ) {
        setShowReadyHint(true);
        timer = window.setTimeout(() => setShowReadyHint(false), 1500);
      }
    } catch {
      // localStorage недоступен (SSR / disabled) — пропускаем хинт молча.
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const handleNav = React.useCallback(
    (href: string) => {
      if (pendingHref) return;
      setPendingHref(href);
      window.setTimeout(() => {
        router.push(href);
      }, 400);
    },
    [pendingHref, router],
  );

  return (
    <div
      ref={ref}
      style={{ perspective: "1500px", ...tiltStyle }}
      className="group mt-14 relative mx-auto max-w-5xl animate-fade-in"
    >
      <div className="absolute -top-6 -left-8 hidden lg:block animate-bounce-subtle" style={{ animationDelay: "0s" }}>
        <div className="bg-white rounded-2xl shadow-soft-lg p-3 rotate-[-8deg]">
          <div className="text-xs font-semibold text-warm-950">5 класс</div>
          <div className="text-[10px] text-warm-500">Математика</div>
        </div>
      </div>
      <div className="absolute -top-4 -right-6 hidden lg:block animate-bounce-subtle" style={{ animationDelay: "0.8s" }}>
        <div className="bg-white rounded-2xl shadow-soft-lg p-3 rotate-[6deg] flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-100 grid place-items-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-xs font-semibold text-warm-950">Готово за 30 сек</div>
            <div className="text-[10px] text-warm-500">Ответы внутри</div>
          </div>
        </div>
      </div>

      <div className="absolute -inset-x-2 sm:-inset-x-4 -top-4 sm:-top-6 h-12 bg-white rounded-t-2xl border border-warm-200 shadow-soft flex items-center px-4 gap-2 z-10">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-rose-400" />
          <span className="w-3 h-3 rounded-full bg-amber-400" />
          <span className="w-3 h-3 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 mx-4 h-7 rounded-md bg-warm-50 grid place-items-center text-xs text-warm-500 font-mono">
          {SITE_HOST}/subject/math/5/drobi-obyknovennye
        </div>
      </div>

      <div className="pt-12 sm:pt-14 grid lg:grid-cols-[1fr_360px] gap-4 sm:gap-6">
        <div className="relative bg-white rounded-2xl border border-warm-100 shadow-soft-lg p-6 sm:p-8 aspect-[1/1.41] overflow-hidden transition-transform duration-500 ease-out motion-safe:group-hover:-rotate-1">
          <div className="absolute inset-0 bg-noise opacity-50 pointer-events-none" />

          <div className="relative flex items-start justify-between mb-4 pb-3 border-b border-warm-200">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-muted)]">
                Рабочий лист
              </div>
              <div className="text-sm font-semibold text-warm-950 mt-0.5">
                Обыкновенные дроби · 5 класс
              </div>
            </div>
            <div className="text-right text-[10px] text-[color:var(--text-muted)]">Вариант 1 · ⏱ 15 мин</div>
          </div>

          <ol className="space-y-3 text-[12px] sm:text-[13px] leading-relaxed text-warm-900">
            {MOCK_TASKS.map((task, i) => (
              <li
                key={i}
                className="flex items-start animate-fade-in"
                style={{ animationDelay: `${0.7 + i * 0.18}s`, animationFillMode: "both" }}
              >
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-100 text-brand-800 font-semibold text-[10px] mr-2 shrink-0">
                  {i + 1}
                </span>
                <span>{task}</span>
              </li>
            ))}
          </ol>

          <div className="mt-6 pt-3 border-t border-dashed border-warm-200 text-[10px] text-[color:var(--text-muted)] text-center">
            УчЛист · Ответы и пояснения на&nbsp;отдельной странице · Подходит для&nbsp;печати на&nbsp;A4
          </div>

          <div className="absolute right-3 bottom-3 flex items-center gap-1 text-[10px] text-warm-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Загрузка&nbsp;PDF…
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-warm-100 shadow-soft p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-warm-500">Генерация</span>
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Готово за 30 сек
              </span>
            </div>
            <div className="text-sm font-semibold text-warm-950">5 заданий · со&nbsp;сложностью средняя</div>
            <div className="mt-3 h-1.5 bg-warm-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-400 to-brand-600"
                style={{ animation: reducedMotion ? "none" : "shimmer 2s linear infinite, fade-in 1s 0.7s both", backgroundSize: "200% 100%" }}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-warm-100 shadow-soft p-4 space-y-2">
            <Row label="Задания" value="5" />
            <Row label="С&nbsp;ответами" value="+ 1 стр." accent="success" />
            <Row label="Пояснения" value="+ 1 стр." accent="success" />
            <Row label="Формат" value="PDF · DOCX" />
          </div>

          <div className="bg-warm-900 text-white rounded-2xl p-4 relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-brand-500/20 blur-2xl" />
            <div className="relative">
              <div className="text-xs text-warm-500 mb-2">Что дальше</div>
              <div className="text-sm font-semibold leading-snug">
                Скачайте в&nbsp;PDF или&nbsp;DOCX, или&nbsp;сделайте ещё&nbsp;вариант
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={() => handleNav(DOWNLOAD_HREF)}
                  loading={pendingHref === DOWNLOAD_HREF}
                  disabled={pendingHref !== null}
                  variant="secondary"
                  size="sm"
                  className="flex-1 motion-safe:hover:scale-[1.02] motion-safe:active:scale-95"
                  aria-label="Скачать рабочий лист"
                >
                  {pendingHref === DOWNLOAD_HREF ? (
                    "Открываю…"
                  ) : (
                    <>
                      Скачать
                      {showReadyHint && (
                        <Check
                          className="w-3 h-3 ml-1.5 text-emerald-300 motion-safe:animate-fade-in"
                          aria-hidden
                        />
                      )}
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={() => handleNav(REGEN_HREF)}
                  loading={pendingHref === REGEN_HREF}
                  disabled={pendingHref !== null}
                  variant="primary"
                  size="sm"
                  className="flex-1 motion-safe:hover:scale-[1.02] motion-safe:active:scale-95"
                  leftIcon={<Play className="w-3 h-3" />}
                  aria-label="Новый вариант рабочего листа"
                >
                  {pendingHref === REGEN_HREF ? "Открываю…" : "Новый вариант"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Подсказка 3D-tilt для десктопа */}
      <div className="hidden lg:block absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] text-[color:var(--text-muted)] uppercase tracking-wider opacity-60">
        ↔ двигайте мышью для&nbsp;3D
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: "success" }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-warm-500">{label}</span>
      <span className={accent === "success" ? "text-emerald-600 font-semibold" : "text-warm-950 font-semibold"}>
        {value}
      </span>
    </div>
  );
}

function CheckCircle2(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 4L12 14.01l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}