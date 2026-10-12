import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, GraduationCap, ListChecks } from "lucide-react";
import { plural } from "@/lib/utils/cn";
import { countNumbers, subjectLabel, subjectsOfExam } from "./hub-data";

/**
 * Блок «Подготовка к ОГЭ» на главной.
 *
 * Зачем он главной: 218 страниц заданий `/exam/*` не имели ни одной входящей
 * ссылки с сайта — для робота они были сиротами. Эта ссылка даёт два клика
 * до любого задания: главная → `/exam/oge/` → `/exam/oge/math/1/`.
 *
 * Ссылка на ЕГЭ обязана быть здесь же, а не на `/exam/`: хабы экзаменов
 * друг на друга не ссылаются, и с одной ссылкой на ОГЭ до 126 страниц ЕГЭ
 * было четыре клика вместо двух (главная → `/exam/` → `/exam/ege/` →
 * задание). Вариант «сделать хабы взаимно связанными» задачу не решает:
 * через `/exam/` любой путь становится длиннее на один клик.
 *
 * Все числа берутся из `EXAM_SUBJECTS`, ничего не выдумано.
 */

const ogeSubjects = subjectsOfExam("oge");
const ogeTotal = countNumbers(ogeSubjects);
const egeSubjects = subjectsOfExam("ege");
const egeTotal = countNumbers(egeSubjects);

export function OgeTeaser() {
  return (
    <section className="py-20 sm:py-28 bg-warm-50/60">
      <div className="container-tight">
        <div className="grid lg:grid-cols-[1fr_420px] gap-8 items-start">
          <div>
            <Badge tone="brand" className="mb-3">
              <GraduationCap className="w-3 h-3" />
              ОГЭ · 9 класс
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
              Подготовка к&nbsp;ОГЭ по&nbsp;номерам заданий
            </h2>
            <p className="mt-3 text-warm-600 max-w-2xl">
              {ogeTotal} {plural(ogeTotal, "задание", "задания", "заданий")} по{" "}
              {ogeSubjects.length}{" "}
              {plural(ogeSubjects.length, "предмету", "предметам", "предметам")} —
              номера как в&nbsp;кодификаторе ФИПИ. Откройте номер, и&nbsp;конструктор
              соберёт лист по&nbsp;нему.
            </p>
            <Link
              href="/exam/oge/"
              className="mt-6 inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-brand-700 text-white font-medium hover:bg-brand-800 transition-colors"
            >
              <ListChecks className="w-4 h-4" />
              Все задания ОГЭ
              <ArrowRight className="w-4 h-4" />
            </Link>
            {/* Второй экзамен — ссылка рядом, а не через `/exam/`: от неё до
                любой страницы ЕГЭ ровно два клика, как до ОГЭ. */}
            <p className="mt-4 text-sm text-warm-600">
              Сдаёте ЕГЭ?{" "}
              <Link
                href="/exam/ege/"
                className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:text-brand-800"
              >
                Все задания ЕГЭ — {egeTotal}{" "}
                {plural(egeTotal, "задание", "задания", "заданий")} по{" "}
                {egeSubjects.length}{" "}
                {plural(egeSubjects.length, "предмету", "предметам", "предметам")}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </p>
          </div>

          <Card>
            <p className="text-sm font-semibold text-warm-950">
              Что внутри по&nbsp;предметам
            </p>
            <ul className="mt-3 space-y-2">
              {ogeSubjects.map((s) => (
                <li
                  key={s.slug}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-warm-700">
                    <span aria-hidden className="mr-1.5">
                      {s.emoji}
                    </span>
                    {subjectLabel(s)}
                  </span>
                  <span className="text-warm-500 tabular-nums">
                    {s.numbers.length}{" "}
                    {plural(s.numbers.length, "задание", "задания", "заданий")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 pt-4 border-t border-warm-100 text-xs text-warm-500">
              Нужен целый вариант с&nbsp;таймером —{" "}
              <Link href="/oge/" className="text-brand-700 hover:text-brand-800 font-medium">
                откройте тренажёр
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}