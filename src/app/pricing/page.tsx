import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Check, X, GraduationCap, Building2 } from "lucide-react";
import { PageTracker } from "@/components/shared/PageTracker";

const comparison = [
  {
    feature: "Цена",
    free: "0 ₽",
    base: "500 ₽/мес · 4 500 ₽/год",
    plus: "1 500 ₽/мес · 12 000 ₽/год",
    school: "3 000 ₽/класс",
  },
  {
    feature: "Генерации в сутки",
    free: "3",
    base: "Безлимит",
    plus: "Безлимит",
    school: "Безлимит",
  },
  {
    feature: "Предметы",
    free: "Все 21+",
    base: "Все 21+",
    plus: "Все 21+",
    school: "Все 21+",
  },
  {
    feature: "Классы",
    free: "1-11",
    base: "1-11",
    plus: "1-11",
    school: "1-11",
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
    plus: "∞",
    school: "∞",
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
    feature: "Адаптивные тесты",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Telegram-бот",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Планы уроков по ФГОС",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Презентации PPTX",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "КТП на год (DOCX)",
    free: "—",
    base: "—",
    plus: "✓",
    school: "✓",
  },
  {
    feature: "Экспорт DOCX и PPTX",
    free: "PDF",
    base: "PDF + DOCX",
    plus: "PDF + DOCX + PPTX",
    school: "PDF + DOCX + PPTX",
  },
  {
    feature: "Учеников в кабинете",
    free: "—",
    base: "5",
    plus: "20",
    school: "∞",
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
      <div className="container-tight pt-12 sm:pt-16 pb-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
          Тарифы
        </p>
        <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight">
          Простая экономика
        </h1>
        <p className="mt-4 text-lg text-warm-600 max-w-2xl mx-auto">
          500 ₽/мес или 375 ₽/мес при оплате за год. Без скрытых платежей. Отмена в 1 клик. Возврат за 7 дней.
        </p>
      </div>

      <PricingTeaser />

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
                Скоро · запуск Q1 2027
              </div>
              <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight mb-4">
                Скоро: тариф «Школа» для классов
              </h2>
              <p className="text-warm-600 mb-6">
                Учитель получит админку с отчётами по успеваемости класса. Ученики — личные кабинеты с историей. Интеграция со школьной LMS. Ориентир цены — 3 000 ₽/мес за класс.
              </p>

              <ul className="space-y-2 mb-6">
                {[
                  "Админка учителя с отчётами",
                  "Личные кабинеты учеников",
                  "Отслеживание прогресса по темам",
                  "Шаблоны для контрольных",
                  "Интеграция со Сферум / Moodle",
                  "Безлимит по ученикам в классе",
                  "Готовые КТП для администрации",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-warm-700">
                    <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-baseline gap-2 mb-6">
                <span className="text-3xl font-bold text-warm-950 whitespace-nowrap">3 000 ₽</span>
                <span className="text-warm-500 whitespace-nowrap">/мес за класс</span>
                <span className="text-sm text-warm-500">(ориентир)</span>
              </div>
              <p className="text-xs text-warm-500 mb-4">
                Финальные условия и скидки за объём уточним ближе к запуску.
              </p>

              <Button variant="primary" size="lg" disabled leftIcon={<GraduationCap className="w-4 h-4" />}>
                Скоро · запуск Q1 2027
              </Button>
            </div>

            <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
              <h3 className="font-semibold text-warm-950 mb-3">Сценарии — превью</h3>
              <div className="space-y-2.5">
                {[
                  { title: "Контрольная на 2 варианта за 5 минут", desc: "Учитель физики делает 2 PDF и шифр ответов." },
                  { title: "Домашка по теме для всего класса", desc: "Классрук выдаёт задания через LMS." },
                  { title: "Подготовка к ОГЭ по классу", desc: "Автоматический подбор вариантов по слабым темам." },
                  { title: "Отчёт за четверть", desc: "Сколько задач решил класс, какие темы просели." },
                  { title: "Годовое КТП по предмету", desc: "Учитель делает КТП на 34 недели для администрации за 5 минут." },
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
                a: "Да, через ЮKassa принимаются карты Visa/MasterCard/МИР любых стран. Также доступна оплата через СБП и кошельки.",
              },
              {
                q: "Когда списываются деньги?",
                a: "Подписка продлевается автоматически раз в месяц. За день до списания мы присылаем напоминание. Отменить можно в любой момент — деньги не спишутся в следующем периоде.",
              },
              {
                q: "Есть ли скидки для годовых подписок?",
                a: "Да. Базовый: 4 500 ₽/год (375 ₽/мес — на 25% дешевле). Плюс: 12 000 ₽/год (1 000 ₽/мес — на 33% дешевле). Оплата за год — без автоматических списаний, продление по желанию.",
              },
              {
                q: "А если AI ошибётся в задании — деньги вернут?",
                a: "Если задание содержит ошибку в условии или ответе — напишите в поддержку, заменим или вернём деньги за этот лист. Для ОГЭ/ЕГЭ-вариантов действует расширенная гарантия: пересборка варианта бесплатно.",
              },
              {
                q: "Можно попробовать Базовый бесплатно?",
                a: "Да, 7 дней бесплатно — без оплаты и без привязки карты. Если не понравится — отмените в 1 клик, деньги не спишутся. После триала подписка продлевается автоматически.",
              },
              {
                q: "Что если я хочу вернуть деньги?",
                a: "В течение 7 дней после оплаты можно вернуть всю сумму — просто напишите в поддержку. Без объяснения причин.",
              },
              {
                q: "Можно ли использовать для коммерческих целей?",
                a: "Подписка Плюс включает коммерческую лицензию: можно генерировать листы для учеников и продавать свои курсы. Базовый — только для личного использования.",
              },
              {
                q: "Что входит в тариф Плюс по новым материалам?",
                a: "В тариф Плюс входят планы уроков по ФГОС, презентации PPTX и КТП на год (DOCX). Экспорт доступен в PDF, DOCX и PPTX.",
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