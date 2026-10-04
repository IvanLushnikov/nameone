import type { Metadata } from "next";
import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Check, X, GraduationCap, Building2 } from "lucide-react";
import { PageTracker } from "@/components/shared/PageTracker";
import {
  ACADEMIC_YEAR_NOTE,
  ARTIFACT_NAMES,
  FREE_QUOTA_LABEL,
  PLANS,
  academicYearSaving,
  formatRub,
  priceLabel,
  priceShort,
  priceSummary,
} from "@/lib/content/plans";
import { SITE_URL } from "@/lib/site";

/**
 * Коммерческий поиск: «сколько стоит рабочие листы», «тарифы», «цена подписки
 * для учителя». Без своих метаданных страница наследовала заголовок главной и
 * не отвечала ни на один денежный запрос.
 *
 * Цены в description НЕ зашиты строкой, а собраны хелперами `plans.ts` — тем
 * же путём, что и подписи на самой странице. Иначе цена в сниппете Google
 * разошлась бы с ценой под кнопкой: пользователь увидел бы одно, посетил
 * страницу и увидел другое, а на «/год» вместо «учебный год» ещё и обещание
 * несуществующего периода.
 *
 * Период везде «учебный год», а НЕ «год»: календарного года в продукте нет,
 * и это же проверяет tests/unit/plans-consistency.test.ts.
 */
export const metadata: Metadata = {
  title: `Тарифы — 3 генерации бесплатно, дальше от ${priceShort("base", "month")}`,
  description: `Базовый ${priceShort("base", "month")} или ${priceShort("base", "academicYear")}. Плюс — ${priceShort("plus", "month")}, включает ОГЭ/ЕГЭ, презентации и КТП. ${FREE_QUOTA_LABEL} — без карты и без регистрации. Оплата картой РФ и СБП.`,
  alternates: { canonical: `${SITE_URL}/pricing` },
};

/**
 * Строка «Цена» собирается из plans.ts — тот же источник, что и карточки
 * тарифов на лендинге. Периодов ровно два: учебный год (9 мес) и помесячно.
 */
const priceCell = (planId: "free" | "base" | "plus" | "school") => priceSummary(planId);

const comparison = [
  {
    feature: "Цена",
    free: priceCell("free"),
    base: priceCell("base"),
    plus: priceCell("plus"),
    school: priceCell("school"),
  },
  {
    feature: "Бесплатные генерации",
    free: "3",
    base: "Безлимит",
    plus: "Безлимит",
    school: "Безлимит",
  },
  {
    feature: "Предметы",
    free: "Все 21 предмет",
    base: "Все 21 предмет",
    plus: "Все 21 предмет",
    school: "Все 21 предмет",
  },
  {
    feature: "Классы",
    free: "1–11",
    base: "1–11",
    plus: "1–11",
    school: "1–11",
  },
  {
    feature: "PDF с ответами и пояснениями",
    free: "✓",
    base: "✓",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "История генераций",
    free: "—",
    base: "30 дней",
    plus: "Без ограничений",
    school: "Без ограничений",
  },
  {
    feature: "Избранное и шаблоны",
    free: "—",
    base: "✓",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Варианты ОГЭ/ЕГЭ",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Разбор каждого задания",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.control} с критериями оценивания`,
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Ранний доступ к новым темам и предметам",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.lessonPlan} по ФГОС`,
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.presentation} (PPTX)`,
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.ktp} на год (DOCX)`,
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Форматы файла",
    free: "PDF",
    base: "PDF · DOCX",
    plus: "PDF · DOCX · PPTX",
    school: "PDF · DOCX · PPTX",
  },
  {
    feature: "Учеников",
    free: "—",
    base: "5",
    plus: "20",
    school: "Без ограничений",
  },
  {
    feature: "Членов семьи",
    free: "—",
    base: "До 5 человек",
    plus: "До 5 человек",
    school: "До 5 человек",
  },
  {
    feature: "Админка учителя",
    free: "—",
    base: "—",
    plus: "—",
    school: "✓",
  },
  {
    feature: "Отчёты по классу",
    free: "—",
    base: "—",
    plus: "—",
    school: "✓",
  },
  {
    feature: "API для интеграции",
    free: "—",
    base: "—",
    plus: "—",
    school: "по запросу",
  },
];

const renderCell = (v: string) => {
  if (v === "✓") return <Check className="w-4 h-4 text-brand-500 mx-auto" />;
  if (v === "—") return <X className="w-4 h-4 text-warm-300 mx-auto" />;
  return <span className="text-sm">{v}</span>;
};

export default function PricingPage() {
  return (
    <>

      {/* TZ-2: убран дубль-hero «Простая экономика» — PricingTeaser ниже уже имеет
          свой eyebrow «Тарифы» + h2 «Начните бесплатно…» + описание + переключатель
          «Учебный год (9 мес)» / «Помесячно». */}
      {/* Заголовок страницы — тот же блок, что и на главной, но повышенный до
          h1. Раньше здесь стоял скрытый `sr-only` h1, потому что общий
          компонент PricingTeaser не давал выбрать уровень: на главной его
          заголовок обязан остаться h2 (там h1 уже в Hero), а на странице
          тарифов он и есть главный. Теперь уровень задаётся пропом, поэтому
          страница получила настоящий видимый заголовок, а главная — второй
          h1 не получила. */}
      <PricingTeaser headingLevel="h1" />

      {/* Comparison table */}
      <section className="py-12 sm:py-20">
        <div className="container-tight">
          <div className="max-w-2xl mx-auto text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
              Сравнение тарифов
            </h2>
            <p className="mt-3 text-warm-600">
              Все цифры — реальные. Без звёздочек.
            </p>
          </div>

          <Card padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-warm-200">
                  <th className="text-left text-sm font-semibold text-warm-700 px-6 py-4 w-[40%]">
                    Возможность
                  </th>
                  <th className="text-center text-sm font-semibold text-warm-700 px-4 py-4">
                    Бесплатно
                  </th>
                  <th className="text-center text-sm font-semibold text-warm-950 px-4 py-4 bg-brand-50">
                    Базовый
                  </th>
                  <th className="text-center text-sm font-semibold text-warm-700 px-4 py-4">
                    Плюс
                  </th>
                  <th className="text-center text-sm font-semibold text-warm-700 px-4 py-4">
                    Школа
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, i) => (
                  <tr key={i} className="border-b border-warm-100 last:border-0">
                    <td className="text-sm text-warm-700 px-6 py-3">{row.feature}</td>
                    <td className="text-center px-4 py-3">{renderCell(row.free)}</td>
                    <td className="text-center px-4 py-3 bg-brand-50/50">{renderCell(row.base)}</td>
                    <td className="text-center px-4 py-3">{renderCell(row.plus)}</td>
                    <td className="text-center px-4 py-3">{renderCell(row.school)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* B2B section */}
      <section id="b2b" className="py-12 sm:py-20 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-warm-200 text-warm-700 text-xs font-semibold mb-4">
                <Building2 className="w-3.5 h-3.5" />
                Скоро · запуск — {PLANS.school.comingSoon}
              </div>
              <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight mb-4">
                Скоро: тариф «{PLANS.school.name}» для классов
              </h2>
              <p className="text-warm-600 mb-6">
                Учитель получит админку с отчётами по успеваемости класса. Ученики — личные кабинеты с историей. Интеграция со школьной LMS. Ориентир цены — {priceLabel("school", "month")}.
              </p>

              <ul className="space-y-2 mb-6">
                {PLANS.school.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-warm-700">
                    <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-baseline gap-2 mb-6">
                <span className="text-3xl font-bold text-warm-950 whitespace-nowrap">
                  {formatRub(PLANS.school.prices.month.amount)}
                </span>
                <span className="text-warm-500 whitespace-nowrap">/мес за класс</span>
                <span className="text-sm text-warm-500">(ориентир)</span>
              </div>
              <p className="text-xs text-warm-500 mb-4">
                Финальные условия и скидки за объём уточним ближе к запуску.
              </p>

              <Button variant="primary" size="lg" disabled leftIcon={<GraduationCap className="w-4 h-4" />}>
                {PLANS.school.cta}
              </Button>
            </div>

            <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
              <h3 className="font-semibold text-warm-950 mb-3">Сценарии — превью</h3>
              <div className="space-y-2.5">
                {[
                  { title: "Контрольная на 2 варианта за 5 минут", desc: "Учитель физики делает два PDF-файла и шифр ответов." },
                  { title: "Задания по теме для всего класса", desc: "Классный руководитель выдаёт задания через LMS." },
                  { title: "Подготовка к ОГЭ по классу", desc: "Автоматический подбор вариантов по слабым темам." },
                  { title: "Отчёт за четверть", desc: "Сколько задач решил класс, какие темы просели." },
                  { title: "КТП на учебный год по предмету", desc: "Учитель делает КТП на 34 недели для администрации за 5 минут." },
                  { title: "Серия листов + план + презентация к четверти", desc: "Все материалы к теме в одном месте." },
                ].map((s) => (
                  <div key={s.title} className="p-3 rounded-xl bg-white border border-blue-100">
                    <div className="text-sm font-medium text-warm-950">{s.title}</div>
                    <div className="text-xs text-warm-500 mt-0.5">{s.desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 sm:py-20">
        <div className="container-tight max-w-3xl">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
              Частые вопросы
            </h2>
          </div>
          <div className="space-y-3">
            {[
              {
                q: "Можно ли оплатить картой иностранного банка?",
                a: "Да, через ЮKassa принимаются карты МИР российских банков. Также доступна оплата через СБП.",
              },
              {
                q: "Когда списываются деньги?",
                // ТЗ-20 §3: обещание «продлевается автоматически» снято с
                // страницы ДО того, как рекуррент заработал. Формулировка
                // честная и конкретная: называем то, что происходит с деньгами.
                a: "Сейчас оплата разовая: вы платите за выбранный период — месяц или учебный год, — и работаете до его конца. Дальше лишних списаний не бывает: без новой оплаты доступ просто закончится. Автопродление мы готовим и включим, как только разрешит платёжный провайдер, — и напишем об этом первым делом.",
              },
              {
                q: "Что такое учебный год и почему он выгоднее?",
                a: `Учебный год — это 9 месяцев подряд, а не 12: платить летом, когда вы не работаете, не нужно. Старт считается от даты оплаты. ${ACADEMIC_YEAR_NOTE}. ${PLANS.base.name}: ${priceLabel("base", "academicYear")} — ${academicYearSaving("base")}. ${PLANS.plus.name}: ${priceLabel("plus", "academicYear")} — ${academicYearSaving("plus")}. Можно и помесячно: ${priceLabel("base", "month")} и ${priceLabel("plus", "month")}.`,
              },
              {
                q: "А если ИИ ошибётся в задании — деньги вернут?",
                a: "Если задание содержит ошибку в условии или ответе — напишите в поддержку, заменим или вернём деньги за этот лист. Для ОГЭ/ЕГЭ-вариантов действует расширенная гарантия: пересборка варианта бесплатно.",
              },
              {
                // Биллинга в проекте пока нет, поэтому обещать пробный период
                // нельзя. Про бесплатный вход честно пишем «3 бесплатные
                // генерации» (FREE_QUOTA_LABEL) — без периода и без карты.
                q: "Что можно попробовать бесплатно?",
                a: `${FREE_QUOTA_LABEL} — без карты и без регистрации. Этого хватает, чтобы понять, подходит ли сервис под ваши предметы и классы. Дальше — подписка.`,
              },
              {
                q: "Что, если я хочу вернуть деньги?",
                a: "Возврат в течение 7 дней с момента оплаты — напишите в поддержку, разберёмся по существу. Подписку можно отменить в любой момент: уже оплаченный период доиграется до конца, новых списаний не будет.",
              },
              {
                q: "Можно ли использовать для коммерческих целей?",
                a: "Подписка Плюс включает коммерческую лицензию: можно генерировать рабочие листы для своих учеников. Перепродавать готовые материалы и курсы нельзя — это не входит в лицензию. Базовый — только для личного использования.",
              },
              {
                q: "Что входит в тариф Плюс по новым материалам?",
                a: `В тариф Плюс входят ${ARTIFACT_NAMES.lessonPlan.toLowerCase()} по ФГОС, ${ARTIFACT_NAMES.presentation.toLowerCase()} (PPTX) и ${ARTIFACT_NAMES.ktp} на год (DOCX). Экспорт доступен в PDF, DOCX и PPTX.`,
              },
            ].map((it) => (
              <details
                key={it.q}
                className="bg-white rounded-2xl border border-warm-100 px-5 py-4 group"
              >
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-medium text-warm-950">
                  {it.q}
                  <span className="text-warm-400 group-open:rotate-45 transition-transform text-2xl leading-none">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-warm-600 leading-relaxed">{it.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <PageTracker eventName="pricing_view" />
    </>
  );
}