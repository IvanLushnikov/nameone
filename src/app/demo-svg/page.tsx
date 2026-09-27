/**
 * Demo-страница SVG-графиков в рабочих листах ЛистAI.
 *
 * Внутренний показ для коллег (2026-09-25).
 * 9 примеров — по одному на каждый из 7 типов графиков + 2 phase1-baseline (bar/line).
 * Чарты генерируются через мок-генератор (chart-fixtures.ts) и рендерятся
 * в SvgChart (см. docs/04-product-features-svg-graphs.md).
 *
 * Без LLM-интеграции: данные захардкожены в фикстурах.
 * Когда подключим LLM (см. docs/02-llm-architecture.md) — те же шаблоны
 * будут использоваться с реальной AI-выдачей chart_spec.
 */
import { generateWorksheet } from "@/lib/mock/generator";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import type { SubjectSlug } from "@/lib/types";

type DemoEntry = {
  title: string;
  description: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  expectedChartType: string;
};

const DEMO_ENTRIES: DemoEntry[] = [
  // === Bar chart (Phase 1) ===
  {
    title: "Распределение оценок",
    description: "Bar — категории × числовые значения. Самый простой и привычный тип.",
    subject: "math",
    grade: 5,
    topic: "gistory",
    difficulty: "medium",
    expectedChartType: "bar",
  },
  // === Line chart (Phase 1) ===
  {
    title: "Линейная функция: y = x vs y = 2x",
    description: "Line — 2 серии, общий x-базис. Подходит для функций и трендов.",
    subject: "math",
    grade: 7,
    topic: "lineynaya-funktsiya",
    difficulty: "medium",
    expectedChartType: "line",
  },
  // === Pie chart (Phase 1) ===
  {
    title: "Бюджет класса",
    description: "Pie — доли от целого. Хорошо для процентов и распределений.",
    subject: "math",
    grade: 5,
    topic: "doli-i-protsenty",
    difficulty: "medium",
    expectedChartType: "pie",
  },
  // === Number line (Phase 2) ===
  {
    title: "Координатный луч (5 класс)",
    description: "Number line — точки на числовой прямой. Для задач на отрицательные числа, модуль, координаты.",
    subject: "math",
    grade: 5,
    topic: "koordinatnyy-luch-i-shkaly",
    difficulty: "medium",
    expectedChartType: "number_line",
  },
  {
    title: "Модуль числа (6 класс)",
    description: "Number line с highlight точками для |x|.",
    subject: "math",
    grade: 6,
    topic: "modul-chisla",
    difficulty: "medium",
    expectedChartType: "number_line",
  },
  // === Geometry (Phase 2) ===
  {
    title: "Углы. Измерение углов (5 класс)",
    description: "Geometry — треугольник с подписями углов. Подходит для геометрических задач.",
    subject: "math",
    grade: 5,
    topic: "ugly-izmerenie-uglov",
    difficulty: "medium",
    expectedChartType: "geometry",
  },
  {
    title: "Площадь и периметр (4 класс)",
    description: "Geometry — прямоугольник с подписями сторон. Для задач на S и P.",
    subject: "math",
    grade: 4,
    topic: "ploschad-i-perimetr",
    difficulty: "medium",
    expectedChartType: "geometry",
  },
  // === Biology (Phase 3) ===
  {
    title: "Строение растения (5 класс)",
    description: "Biology — иконочная схема: стебель + листья + цветок + корни. Подходит для ботаники.",
    subject: "biology",
    grade: 5,
    topic: "rasteniya",
    difficulty: "medium",
    expectedChartType: "biology",
  },
  {
    title: "Классификация животных (7 класс)",
    description: "Biology — иерархия: Беспозвоночные / Моллюски / Членистоногие / Хордовые с примерами.",
    subject: "biology",
    grade: 7,
    topic: "zhivotnye",
    difficulty: "medium",
    expectedChartType: "biology",
  },
  {
    title: "Двойная спираль ДНК (9 класс)",
    description: "Biology — упрощённая двойная спираль с водородными связями.",
    subject: "biology",
    grade: 9,
    topic: "genetika",
    difficulty: "medium",
    expectedChartType: "biology",
  },
  // === Chemistry (Phase 3) ===
  {
    title: "Строение атома (8 класс)",
    description: "Chemistry — атом с ядром + электронные оболочки. Для задач на строение атома.",
    subject: "chemistry",
    grade: 8,
    topic: "osnovnye-ponyatiya",
    difficulty: "medium",
    expectedChartType: "chemistry",
  },
  {
    title: "Периодическая таблица (8 класс)",
    description: "Chemistry — мини-таблица с первыми 6 элементами (H, He, Li, Be, B, C).",
    subject: "chemistry",
    grade: 8,
    topic: "periodicheskaya-tablitsa",
    difficulty: "medium",
    expectedChartType: "chemistry",
  },
  {
    title: "Горение водорода: 2H₂ + O₂ → 2H₂O (9 класс)",
    description: "Chemistry — схема реакции с реагентами, стрелкой и продуктами. Угол H-O-H = 104.5°.",
    subject: "chemistry",
    grade: 9,
    topic: "himicheskie-reakcii",
    difficulty: "medium",
    expectedChartType: "chemistry",
  },
];

export default async function DemoSvgPage() {
  // Генерируем все 13 листов сразу (server-side, без LLM — через мок-фикстуры).
  const worksheets = await Promise.all(
    DEMO_ENTRIES.map(async (entry) => {
      const ws = await generateWorksheet({
        subject: entry.subject,
        grade: entry.grade,
        topic: entry.topic,
        difficulty: entry.difficulty,
        count: 6, // компактнее для demo
        type: "worksheet",
        withAnswers: true,
        withExplanations: false,
      });
      return { entry, worksheet: ws };
    }),
  );

  // Группируем по типу графика для навигации.
  const groups: Record<string, typeof worksheets> = {};
  for (const item of worksheets) {
    const t = item.worksheet.chartSpec?.type ?? "no_chart";
    if (!groups[t]) groups[t] = [];
    groups[t].push(item);
  }

  return (
    <main className="min-h-screen bg-warm-50">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-brand-900 sm:text-4xl">
            РабочиеЛисты AI — SVG-графики
          </h1>
          <p className="mt-3 text-base text-warm-700 sm:text-lg">
            Внутренний demo от 25.09.2026. {worksheets.length} примеров рабочих листов
            с графиками разных типов. В production эти SVG будут генериться LLM
            под конкретную тему; здесь данные — из mock-фикстур для стабильной
            демонстрации.
          </p>
          <p className="mt-2 text-sm text-warm-600">
            Главный блокер до прода — <strong>подключение LLM</strong> (см.{" "}
            <code className="rounded bg-warm-100 px-1.5 py-0.5 text-xs">
              docs/02-llm-architecture.md
            </code>
            ). Когда LLM готов, mock-фикстуры заменятся на AI-выдачу chart_spec.
          </p>
        </header>

        {/* Группировка по типам графиков */}
        {Object.entries(groups).map(([chartType, items]) => (
          <section key={chartType} className="mb-12">
            <h2 className="mb-4 flex items-center gap-3 text-xl font-semibold text-brand-800 sm:text-2xl">
              <span className="rounded-full bg-brand-100 px-3 py-1 font-mono text-sm uppercase tracking-wider text-brand-700">
                {chartType}
              </span>
              <span className="text-sm font-normal text-warm-600">
                ({items.length}{" "}
                {items.length === 1 ? "пример" : items.length < 5 ? "примера" : "примеров"})
              </span>
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              {items.map(({ entry, worksheet }) => (
                <article
                  key={`${entry.subject}-${entry.topic}`}
                  className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-warm-200"
                >
                  <header className="mb-2">
                    <h3 className="text-base font-semibold text-warm-900">
                      {entry.title}
                    </h3>
                    <p className="mt-1 text-xs text-warm-600">
                      {entry.subject} · {entry.grade} класс
                    </p>
                    <p className="mt-2 text-sm text-warm-700">{entry.description}</p>
                  </header>
                  <div className="overflow-hidden rounded-lg border border-warm-200 bg-warm-50/30">
                    <WorksheetPreview
                      worksheet={worksheet}
                      withAnswers={true}
                      withExplanations={false}
                    />
                  </div>
                  {worksheet.chartSpec ? (
                    <p className="mt-2 text-xs text-warm-500">
                      chart_spec.type ={" "}
                      <code className="rounded bg-warm-100 px-1.5 py-0.5 text-[10px]">
                        {worksheet.chartSpec.type}
                      </code>
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-warm-500 italic">
                      без графика (не в whitelist фикстур)
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}

        <footer className="mt-16 border-t border-warm-200 pt-6 text-sm text-warm-600">
          <h3 className="mb-2 font-semibold text-warm-800">Как это сделано</h3>
          <ul className="list-inside list-disc space-y-1">
            <li>
              7 рендереров в <code>src/lib/llm/svg-templates/</code>: bar, line,
              pie, number-line, geometry, biology, chemistry
            </li>
            <li>
              Discriminated union в <code>src/lib/llm/svg-templates/types.ts</code>{" "}
              (Phase 1+2+3)
            </li>
            <li>
              Zod-валидация в <code>src/lib/llm/svg-spec.ts</code> (84/84 тестов
              проходят)
            </li>
            <li>
              React-компонент <code>SvgChart</code> встраивает SVG через{" "}
              <code>dangerouslySetInnerHTML</code>
            </li>
            <li>
              Mock-фикстуры в <code>src/lib/mock/chart-fixtures.ts</code> (13 тем)
            </li>
            <li>
              Roadmap: <code>docs/04-product-features-svg-graphs.md</code>
            </li>
          </ul>
        </footer>
      </div>
    </main>
  );
}

export const metadata = {
  title: "РабочиеЛисты AI — SVG-графики (внутренний demo)",
  description: "Внутренний показ SVG-графиков в рабочих листах для коллег.",
};
