/**
 * Честный блок «чего мы не умеем» (аудит 11.10, Д-5).
 *
 * ЗАЧЕМ ОН. Раньше на главной был блок «Десять причин выбрать УчЛист»: десять
 * обещаний, где ни одного ограничения. Учитель узнавал о них после оплаты и
 * после урока — и уходил. Три честных ограничения стоят дешевле, чем один
 * ушедший учитель, поэтому этот блок — не самоуничижение, а часть предложения.
 *
 * КАЖДЫЙ ПУНКТ ПРОВЕРЕН ПО КОДУ, А НЕ ПРИДУМАН. Рядом — ссылка на место в
 * репозитории, где ограничение видно:
 *   1. Выбор учебника меняет подбор тем ТОЛЬКО там, где темы размечены. Метки
 *      `Topic.umk` есть у алгебры 7–9 классов; у остальных предметов их нет,
 *      поэтому чипы учебника и не показываются — src/app/constructor/page.tsx,
 *      комментарий «З9» у `TopicStep` и `hasMarkedTopics`.
 *   2. PDF не редактируется. Формат собран из готовых блоков, правки в нём
 *      не предусмотрено; для правок есть выгрузка в DOCX — форматы тарифов в
 *      `PLANS` (pricing) и ответ в FAQ лендинга.
 *   3. Проверка по фото принимает только изображения (jpeg/png/webp) —
 *      `ACCEPT` в src/components/f06/PhotoUpload.tsx. Голос не распознаётся,
 *      потому что аудио на вход не принимается вовсе.
 *
 * Блок серверный (без "use client"): интерактива тут нет, а на главной его
 * незачем тащить в клиентский бандл.
 */

import { Card } from "@/components/ui/Card";
import { AlertTriangle } from "lucide-react";
import { SUPPORT_EMAIL } from "@/lib/site";

const limitations = [
  {
    title: "Учебник учитывается не у всех предметов",
    text: "Выбор учебника меняет список тем только там, где темы размечены под конкретный УМК. Сейчас это алгебра, 7–9 классы. По остальным предметам список тем одинаковый, какой бы учебник вы ни выбрали.",
  },
  {
    title: "PDF не редактируется",
    text: "В PDF текст уже собран — править его в файле нельзя. Нужны правки: выгружайте лист в DOCX и дорабатывайте в Word.",
  },
  {
    title: "Устные ответы не слышны",
    text: "Проверка по фото читает то, что написано в тетради. Ответ у доски, пересказ, устный опрос она не слышит — это остаётся на вас.",
  },
];

export function Limitations() {
  return (
    <section className="py-20 sm:py-28 bg-warm-50 border-y border-warm-100">
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center mb-12 sm:mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-warm-500 mb-3">
            Ограничения
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Чего мы не умеем
          </h2>
          <p className="mt-4 text-lg text-warm-600">
            Лучше узнать об этом до оплаты, чем после урока.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {limitations.map(({ title, text }) => (
            <Card key={title} className="h-full">
              <div className="mb-4 w-14 h-14 rounded-2xl bg-warm-100 text-warm-600 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold text-warm-950 mb-2">{title}</h3>
              <p className="text-sm text-warm-600 leading-relaxed">{text}</p>
            </Card>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-warm-600">
          Если что-то из этого для вас критично — напишите до оплаты:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-700 hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}