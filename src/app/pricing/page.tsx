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
  priceFor,
  priceLabel,
  priceShort,
  priceSummary,
  type PlanId,
} from "@/lib/content/plans";
import { SITE_URL } from "@/lib/site";
import { clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";
import { JsonLd } from "@/components/seo";

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
  title: `Тарифы — ${FREE_QUOTA_LABEL} бесплатно, дальше от ${priceShort("base", "month")}`,
  // ТЗ-21 п.14: описание шло 197 знаков. Режем по границе слова до 150–160.
  description: clipDescription(
    `Базовый ${priceShort("base", "month")} или ${priceShort("base", "academicYear")}. Плюс — ${priceShort("plus", "month")}, включает ОГЭ/ЕГЭ, презентации и КТП. ${FREE_QUOTA_LABEL} — без карты и без регистрации.`,
  ),
  alternates: { canonical: `${SITE_URL}/pricing` },
  // ТЗ-21 п.14: og:image на странице тарифов не было.
  openGraph: {
    title: `Тарифы УчЛист — от ${priceShort("base", "month")}`,
    description: clipDescription(
      `Базовый ${priceShort("base", "month")}, Плюс — ${priceShort("plus", "month")}. ${FREE_QUOTA_LABEL} — без карты и без регистрации.`,
    ),
    url: `${SITE_URL}/pricing`,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "Тарифы УчЛист — рабочие листы по ФГОС"),
  },
  twitter: twitterCard(undefined),
};

/**
 * ТЗ-21 п.15 / SEO-аудит P1-6: разметка `Product` + `Offer` на странице тарифов.
 *
 * Раньше в `out/pricing/index.html` не было ни одного блока JSON-LD — при том
 * что это единственная страница сайта с прямым коммерческим интентом. Без
 * разметки цена из выдачи не подставляется, и страница отвечает на запросы
 * «сколько стоит рабочие листы» хуже конкурента, у которого цена стоит
 * прямо в сниппете.
 *
 * ВАЖНО: ни одна цифра в разметке не зашита строкой. Все суммы берутся из
 * `PLANS[...].prices` через `priceFor`. Причина не в аккуратности: `plans.ts`
 * меняют вместе с экономикой (ТЗ-4 добавляет средний тариф ~990 ₽), и
 * зашитая в разметку «3 800 ₽» разошлась бы с ценой под кнопкой. Учитель
 * увидел бы в выдаче одну сумму, на странице — другую, и доверие к ценам
 * после этого не восстанавливается.
 *
 * Про «Школу» (3 000 ₽/мес за класс) объявление не выводим: тариф ещё не
 * запущен (`comingSoon: "Q1 2027"`). Выдавать цену на то, что нельзя купить,
 * означает получить недовольного учителя, который не нашёл кнопки оплаты.
 */
const pricingJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "УчЛист — рабочие листы по ФГОС",
  description:
    "Генератор рабочих листов, тестов, карточек, планов урока, презентаций и КТП по ФГОС для учителей 1–11 классов.",
  brand: { "@type": "Brand", name: "УчЛист" },
  category: "Образовательные материалы",
  inLanguage: "ru-RU",
  offers: (
    [
      // Тариф «Бесплатно» в offers не выводим: цена 0 ₽ — это не товар, а
      // отсутствие оплаты. По той же причине молчим про «Школу» (3 000 ₽
      // за класс) — тариф ещё не запущен (`comingSoon: "Q1 2027"`), и цена
      // на то, что нельзя купить, приводит к вопросу «где тут кнопка оплаты».
      { planId: "base" as const, periodId: "academicYear" as const },
      { planId: "base" as const, periodId: "month" as const },
      { planId: "plus" as const, periodId: "academicYear" as const },
      { planId: "plus" as const, periodId: "month" as const },
    ]
  ).map(({ planId, periodId }) => {
    const price = priceFor(planId, periodId);
    return {
      "@type": "Offer",
      name: `Тариф «${PLANS[planId].name}» — ${price.unit}`,
      description: PLANS[planId].shortDescription,
      price: price.amount,
      // Цена в рублях: сайт русский, оплата картой РФ или СБП.
      priceCurrency: "RUB",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/pricing`,
      // Период оплаты — обязательное поле для подписки: без него 11 000 ₽
      // читались бы как разовая покупка, а это девять месяцев.
      priceSpecification: {
        "@type": "PriceSpecification",
        price: price.amount,
        priceCurrency: "RUB",
        // Пересчёт в месяц — то, чем мы отличаемся от конкурента: учебный
        // год у нас 9 месяцев, а не календарный (ТЗ-21 п.2.3).
        ...(price.perMonth != null && price.perMonth !== price.amount
          ? { description: `В пересчёте — ${formatRub(price.perMonth)} в месяц` }
          : {}),
      },
    };
  }),
};

/**
 * Строка «Цена» собирается из plans.ts — тот же источник, что и карточки
 * тарифов на лендинге. Периодов ровно два: учебный год (9 мес) и помесячно.
 */
const priceCell = (planId: PlanId) => priceSummary(planId);

const comparison = [
  {
    feature: "Цена",
    free: priceCell("free"),
    base: priceCell("base"),
    standard: priceCell("standard"),
    plus: priceCell("plus"),
    school: priceCell("school"),
  },
  {
    feature: "Бесплатные генерации",
    free: "3",
    base: "Безлимит",
    standard: "Безлимит",
    plus: "Безлимит",
    school: "Безлимит",
  },
  {
    feature: "Предметы",
    free: "Все 21+",
    base: "Все 21+",
    standard: "Все 21+",
    plus: "Все 21+",
    school: "Все 21+",
  },
  {
    feature: "Классы",
    free: "1-11",
    base: "1-11",
    standard: "1-11",
    plus: "1-11",
    school: "1-11",
  },
  {
    feature: "PDF с ответами и пояснениями",
    free: "✓",
    base: "✓",
    standard: "✓",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "История генераций",
    free: "—",
    base: "30 дней",
    standard: "∞",
    plus: "∞",
    school: "∞",
  },
  {
    feature: "Избранное и шаблоны",
    free: "—",
    base: "✓",
    standard: "✓",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Варианты ОГЭ/ЕГЭ",
    free: "—",
    base: "—",
    standard: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Разбор каждого задания",
    free: "—",
    base: "—",
    standard: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.control} с критериями оценивания`,
    free: "—",
    base: "—",
    standard: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.lessonPlan} по ФГОС`,
    free: "—",
    base: "—",
    standard: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.presentation} (PPTX)`,
    free: "—",
    base: "—",
    standard: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: `${ARTIFACT_NAMES.ktp} на год (DOCX)`,
    free: "—",
    base: "—",
    standard: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Экспорт DOCX и PPTX",
    free: "PDF",
    base: "PDF + DOCX",
    standard: "PDF + DOCX",
    plus: "PDF + DOCX + PPTX",
    school: "PDF + DOCX + PPTX",
  },
  {
    feature: "Учеников в кабинете",
    free: "—",
    base: "5",
    standard: "10",
    plus: "20",
    school: "∞",
  },
  {
    feature: "Админка учителя",
    free: "—",
    base: "—",
    standard: "—",
    plus: "—",
    school: "✓",
  },
  {
    feature: "Отчёты по классу",
    free: "—",
    base: "—",
    standard: "—",
    plus: "—",
    school: "✓",
  },
  {
    feature: "API для интеграции",
    free: "—",
    base: "—",
    standard: "—",
    plus: "—",
    school: "по запросу",
  },
];

const renderCell = (v: string) => {
  if (v === "✓") return <Check className="w-4 h-4 text-brand-500 mx-auto" />;
  if (v === "—") return <X className="w-4 h-4 text-warm-500 mx-auto" />;
  return <span className="text-sm">{v}</span>;
};

export default function PricingPage() {
  return (
    <>
      {/* ТЗ-21 п.15: Product + Offer с ценами из plans.ts. */}
      <JsonLd data={pricingJsonLd} id="ld-pricing-product" />

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
                  {/* ТЗ-21 п.4: колонка «Оптимальный» добавлена между Базовым и
                      Плюсом — так тариф стоит в шкале, а не отдельным блоком. */}
                  <th className="text-center text-sm font-semibold text-warm-700 px-4 py-4">
                    Оптимальный
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
                    <td className="text-center px-4 py-3">{renderCell(row.standard)}</td>
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
                Скоро · запуск {PLANS.school.comingSoon}
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
                  { title: "Контрольная на 2 варианта за 5 минут", desc: "Учитель физики делает 2 PDF и шифр ответов." },
                  { title: "Задания по теме для всего класса", desc: "Классрук выдаёт задания через LMS." },
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
                a: "Да, через ЮКасса принимаются карты Visa/MasterCard/МИР любых стран. Также доступна оплата через СБП и кошельки.",
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
                a: `Учебный год — это 9 месяцев подряд, а не 12: платить летом, когда вы не работаете, не нужно. Старт считается от даты оплаты. ${ACADEMIC_YEAR_NOTE}. ${PLANS.base.name}: ${priceLabel("base", "academicYear")} — ${academicYearSaving("base")}. ${PLANS.standard.name}: ${priceLabel("standard", "academicYear")} — ${academicYearSaving("standard")}. ${PLANS.plus.name}: ${priceLabel("plus", "academicYear")} — ${academicYearSaving("plus")}. Можно и помесячно: ${priceLabel("base", "month")}, ${priceLabel("standard", "month")} и ${priceLabel("plus", "month")}.`,
              },
              {
                q: "А если AI ошибётся в задании — деньги вернут?",
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
                q: "Что если я хочу вернуть деньги?",
                a: "Возврат в течение 7 дней с момента оплаты — напишите в поддержку, разберёмся по существу. Подписку можно отменить в любой момент: уже оплаченный период доиграется до конца, новых списаний не будет.",
              },
              {
                q: "Можно ли использовать для коммерческих целей?",
                a: "Подписка Плюс включает коммерческую лицензию: можно генерировать листы для учеников и продавать свои курсы. Базовый — только для личного использования.",
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
                  <span className="text-warm-600 group-open:rotate-45 transition-transform text-2xl leading-none">
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