import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumb } from "@/components/seo";
import { Card } from "@/components/ui/Card";
import { PageTracker } from "@/components/shared/PageTracker";
import {
  catalogStats,
  difficultyLevels,
  examTasksWord,
  gradeRange,
  gradeRangeLabel,
  subjectsWord,
  taskTypes,
  topicsWord,
  umkDative,
} from "@/lib/content/trust";
import { SITE_URL } from "@/lib/site";
import { clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";

/**
 * Как собирается рабочий лист.
 *
 * Страница описывает не идеал, а то, что делает код:
 *  - содержание — из таксономии `src/lib/content/subjects.ts` (темы, разделы
 *    ФГОС, примеры) и привязки к УМК из `src/lib/content/umk.ts`;
 *  - ограничения генерации — из системного промпта
 *    `backend/src/llm/prompts/worksheet-gen.ts` (правила 3, 4, 9–12);
 *  - проверка ответов — из `src/lib/llm/self-verify.ts` (два прохода по
 *    запросу учителя) и валидатора качества листа
 *    `backend/src/llm/prompts/validate.ts`.
 *
 * Каждая цифра на странице считается из таксономии, а не вписана.
 */

const canonicalUrl = `${SITE_URL}/methodology/`;

export const metadata: Metadata = {
  title: "Методика — как мы собираем рабочие листы и проверяем ответы",
  description: clipDescription(
    `Темы и задания для ${gradeRange} классов: ${catalogStats.topics} ${topicsWord}, ${catalogStats.subjects} ${subjectsWord}. Критерии сложности, типы заданий и честная схема проверки ответов.`,
  ),
  alternates: { canonical: canonicalUrl },
  openGraph: {
    title: "Методика УчЛист",
    description: clipDescription(
      "Источники тем, правила сложности, типы заданий и честная схема проверки ответов — без обещаний точности.",
    ),
    url: canonicalUrl,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "Методика УчЛист"),
  },
  twitter: twitterCard(undefined),
};

export default function MethodologyPage() {
  return (
    <>
      <PageTracker eventName="methodology_view" />

      <section className="bg-gradient-to-b from-warm-50 to-white pt-12 pb-14 sm:pt-16">
        <div className="container-tight">
          <Breadcrumb
            className="mb-4 flex flex-wrap items-center text-sm"
            items={[
              { name: "Главная", url: "/" },
              { name: "Методика", url: "" },
            ]}
          />
          <h1 className="text-4xl font-display font-bold tracking-tight sm:text-5xl">
            Как собирается рабочий лист
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-warm-600">
            Четыре шага: откуда берём содержание, что выбирает учитель, чем
            измеряем сложность и как проверяем ответы.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight max-w-3xl space-y-8">
          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">
              1. Откуда берём содержание
            </h2>
            <p className="mt-3 text-warm-700">
              Темы лежат в собственной таксономии, а не берутся из случайной
              выдачи: {catalogStats.subjects} {subjectsWord}, {catalogStats.topics}{" "}
              {topicsWord} по {gradeRangeLabel}. У{" "}
              {catalogStats.topicsWithSection} {topicsWord} указан раздел ФГОС,
              по которому тема идёт в программе.
            </p>
            <p className="mt-3 text-warm-700">
              Если школа работает по конкретному учебнику, тема привязывается к
              нему: в базе {catalogStats.umkEntries} {umkDative} из федерального
              перечня, у каждого указаны классы, где он используется. Учитель
              выбирает УМК — и получает темы своего учебника, а не соседнего.
            </p>
            <p className="mt-3 text-warm-700">
              Для ОГЭ и ЕГЭ темы выстроены по кодификатору ФИПИ. Это отдельный
              слой из {catalogStats.examTasks} {examTasksWord} — номер задания, его смысл и то, что оно
              проверяет.
            </p>
            <p className="mt-3 text-warm-700">
              Тексты заданий пишет модель по этим рамкам. Из чужих сборников
              мы ничего не копируем.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">
              2. Что выбирает учитель
            </h2>
            <p className="mt-3 text-warm-700">
              Предмет, класс, тему, количество заданий и уровень сложности
              выбирает учитель. Подбора «похожего» случайным образом в
              продукте нет: если тема не подходит классу, это видно сразу на
              странице темы.
            </p>
            <p className="mt-3 text-warm-700">
              Есть ограничения, которые мы задали модели жёстко, потому что они
              повторялись: в задании не может быть вычислений из чужого
              предмета, не может быть ссылки на «образец», которого на листе
              нет, и ответ не может быть «индивидуальный». Если задание
              требует того, чего в кабинете школьника нет, оно переписывается
              под школьную практику.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">
              3. Чем задаётся сложность
            </h2>
            <p className="mt-3 text-warm-700">
              Три уровня, у каждого своя рамка в баллах. Уровень выбирает
              учитель, а модель обязана ему соответствовать.
            </p>
            <Card className="mt-4" padded={false}>
              <ul className="divide-y divide-warm-100">
                {difficultyLevels.map((level) => (
                  <li key={level.id} className="flex flex-col gap-1 px-5 py-4">
                    <span className="font-semibold text-warm-950">{level.label}</span>
                    <span className="text-sm text-warm-600">{level.criterion}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <p className="mt-4 text-warm-700">
              Форма задания выбирается отдельно:{" "}
              {taskTypes.map((type, index) => (
                <span key={type.id}>
                  {index > 0 && ", "}
                  {type.label}
                </span>
              ))}
              . Подряд одинаковые формы не идут: лист из пяти одинаковых заданий
              проверяет один навык и ничего больше.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">
              4. Как проверяются ответы
            </h2>
            <p className="mt-3 text-warm-700">
              Проверка запускается учителем и только по его запросу. Схема в
              два прохода: модель решает задание заново, затем сверяет свой
              ответ с ответом в ключе. Расхождение помечается и учителю
              показывается.
            </p>
            <p className="mt-3 text-warm-700">
              Отдельно проверяется качество самого листа: дубли заданий,
              верность ответов, соответствие классу и разнообразие
              формулировок.
            </p>
            <p className="mt-3 text-warm-700">
              Если сервис проверки недоступен или не ответил, лист честно
              помечается как «не проверено», а не как «проверено». Пустой бейдж
              — это сигнал, что результат нужно посмотреть глазами.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">
              Чего мы не обещаем
            </h2>
            <ul className="mt-3 space-y-2 text-warm-700">
              <li>Ни один лист не проверяет живой методист перед выдачей.</li>
              <li>
                Ответ — черновик. Он помогает проверить класс, но решение всегда
                за учителем.
              </li>
              <li>
                Ошибки случаются. Найти и исправить их можно только пересмотрев
                лист, поэтому мы не обещаем точность в процентах.
              </li>
            </ul>
            <Link
              href="/pricing/"
              className="mt-5 inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
            >
              Тарифы и лимиты
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}