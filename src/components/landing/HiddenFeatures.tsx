import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ArrowRight, Send, Gamepad2, ClipboardCheck, MessageCircleQuestion } from "lucide-react";

/**
 * ТЗ-21 п.3: четыре функции, которые в коде работают, но на сайте о них молчали.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ БЛОК, А НЕ ЕЩЁ ЧЕТЫРЕ КАРТОЧКИ В Features.
 * Features перечисляет ЧТО МОЖНО СДЕЛАТЬ (лист, тест, презентация). Этот блок —
 * про то, что происходит ПОСЛЕ того, как лист готов: как отдать его ученикам
 * и как проверить, что работу сделал ученик. Это другой вопрос учителя и другой
 * момент боли, поэтому смешивать их в одной сетке нельзя — блок «десять
 * карточек» уже переполнен, а эти четыре функции в сетку Features не влезали
 * по смыслу, а не по месту.
 *
 * ЧТО ЗДЕСЬ РАБОТАЕТ (проверено в коде, обещаем только это):
 *   • Выдача по ссылке и QR — вкладка «Выданное» в кабинете учителя
 *     (src/components/teacher/FormsTab.tsx), страница ученика без входа
 *     (src/app/form/[token]), выгрузка в Excel
 *     (src/components/teacher/FormSummary.tsx), блок QR — FormQrBlock.tsx.
 *   • Интерактив — лист превращается в игру, ученик решает с телефона
 *     (src/app/play/), учитель видит сводку (src/app/dashboard/interactives/).
 *   • Журнал проверок — src/app/journal/, ручные отметки.
 *   • Вопросы для беседы — src/components/f06/InterviewQuestions.tsx,
 *     бэкенд interview-questions в routes/f06.ts.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни «ИИ-ассистента», ни «нейросети», ни «проверки на списывание
 * в один клик»: система не умеет отличать ученика от копиратора, и обещать это
 * было бы враньём. Что она умеет — задавать вопросы вслух, которые ученик,
 * не решавший задание, ответить не сможет. Ровно это здесь и написано.
 *
 * Блок серверный (без "use client"): интерактива не нужна, а серверный
 * компонент на главной не тянет в клиентский бандл лишний JS.
 */
const hiddenFeatures = [
  {
    Icon: Send,
    title: "Отдайте лист ученикам, не печатая 25 копий",
    description:
      "В кабинете есть вкладка «Выданное»: жмите «Выдать» — ученик получает ссылку и QR-код. Заходит с телефона без регистрации, решает прямо там. Вам остаётся сводка: кто выполнил, где ошибся. Ответы выгружаются в Excel одной кнопкой.",
    href: "/dashboard?tab=forms",
  },
  {
    Icon: Gamepad2,
    title: "Лист превращается в игру",
    description:
      "Из готового листа собирается интерактив: задания появляются по одному, ученик отвечает с телефона, время на ответ видно учителю. Кто-то списывает — тот и отвечает на вопросы из листа, а не из интернета.",
    href: "/dashboard/interactives",
  },
  {
    Icon: ClipboardCheck,
    title: "Журнал проверок — в одном месте",
    description:
      "Отметки по работам, выставленные вручную, собираются в журнал. Видно, по каким темам класс проседает, и понятно, какую тему надо повторить на следующем уроке.",
    href: "/journal",
  },
  {
    Icon: MessageCircleQuestion,
    title: "Вопросы для беседы по работе",
    description:
      "После проверки по фото мы собираем 3–5 вопросов по конкретным заданиям работы. Ученик, который переписал у соседа, на них ответить не сможет — а вы спокойно разберёте материал вместе с ним.",
    href: "/constructor?photo=1",
  },
] as const;

export function HiddenFeatures() {
  return (
    <section className="py-20 sm:py-28 bg-warm-50 border-y border-warm-100">
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center mb-12 sm:mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            После генерации
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Что происходит с&nbsp;листом дальше
          </h2>
          <p className="mt-4 text-lg text-warm-600">
            Четыре вещи, которые есть в&nbsp;кабинете, но про которые обычно не&nbsp;рассказывают:
            как отдать лист классу и&nbsp;как понять, что его сделал&nbsp;ученик.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
          {hiddenFeatures.map(({ Icon, title, description, href }) => (
            <Card
              key={title}
              hover
              className="h-full relative overflow-hidden group transition-all duration-500"
            >
              <div className="relative">
                {/* Иконка lucide вместо иллюстраций Features: здесь важнее
                    узнаваемость действия (отдать / играть / отметить /
                    спросить), чем украшение. Те же размеры 56px и те же
                    токены brand-*, чтобы ряд читался как часть лендинга. */}
                <div className="mb-4 w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon className="w-7 h-7" aria-hidden />
                </div>
                <h3 className="text-lg font-semibold text-warm-950 mb-2 transition-colors group-hover:text-brand-700">
                  {title}
                </h3>
                <p className="text-sm text-warm-600 leading-relaxed">{description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 group-hover:text-brand-700">
                  Открыть
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </span>
                <Link href={href} className="absolute inset-0" aria-label={title}>
                  <span className="sr-only">{title}</span>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
