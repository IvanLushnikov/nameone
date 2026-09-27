/**
 * Mock-фикстуры chart_spec для топиков из таксономии.
 *
 * Phase 1: 5 типов покрыты (bar/line/pie).
 * Phase 2: number_line + geometry добавлены.
 * Phase 3: biology_diagram + chemistry_structure + timeline.
 *
 * Slug'и берутся из реальной таксономии `src/lib/content/subjects.ts`.
 * Чтобы добавить новую фикстуру — найди slug, добавь объект в массив FIXTURES.
 *
 * Эти фикстуры заменятся на LLM-выдачу, когда подключим Generator.
 * Используются:
 *   - в мок-генераторе (src/lib/mock/generator.ts)
 *   - в dev-режиме превью (когда LLM ещё не подключён)
 *   - в self-verification (golden outputs для validator'а)
 */
import type { ChartSpec } from '@/lib/llm/svg-renderer';

type ChartFixtureEntry = {
  /** Stable ID для тестов и golden outputs. */
  id: string;
  /** Display title для логов и admin-UI. */
  title: string;
  spec: ChartSpec;
};

/**
 * Whitelist топиков с графиками. Slug'и обязаны совпадать с subjects.ts.
 * Phase 1+2: 5 типов (bar/line/pie/number_line/geometry).
 */
const FIXTURES: Array<{
  subject: 'math' | 'russian' | 'english' | 'history' | 'biology' | 'chemistry';
  topicSlug: string;
  fixture: ChartFixtureEntry;
}> = [
  // ============================================================
  // === МАТЕМАТИКА — bar / line / pie (Phase 1) ===
  // ============================================================
  {
    subject: 'math',
    topicSlug: 'gistory',
    fixture: {
      id: 'math/gistory/bar',
      title: 'Гистограмма: распределение оценок',
      spec: {
        type: 'bar',
        title: 'Распределение оценок за контрольную',
        x_label: 'Оценка',
        y_label: 'Кол-во учеников',
        data: {
          labels: ['2', '3', '4', '5'],
          values: [2, 8, 14, 6],
        },
        caption: 'Данные: 30 учеников 5 класса',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'lineynaya-funktsiya',
    fixture: {
      id: 'math/lineynaya-funktsiya/line',
      title: 'Линейная функция: y=x vs y=2x',
      spec: {
        type: 'line',
        title: 'Графики линейных функций',
        x_label: 'x',
        y_label: 'y',
        data: {
          labels: ['-2', '-1', '0', '1', '2', '3', '4'],
          series: [
            { name: 'y = x', values: [-2, -1, 0, 1, 2, 3, 4] },
            { name: 'y = 2x', values: [-4, -2, 0, 2, 4, 6, 8] },
          ],
        },
        caption: 'Чем больше k, тем круче прямая',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'doli-i-protsenty',
    fixture: {
      id: 'math/doli-i-protsenty/pie',
      title: 'Доли: бюджет класса',
      spec: {
        type: 'pie',
        title: 'Бюджет класса на месяц',
        data: {
          labels: ['Учебники', 'Транспорт', 'Еда', 'Развлечения'],
          values: [40, 25, 25, 10],
        },
        caption: 'Всего 10 000 ₽ в месяц',
      },
    },
  },

  // ============================================================
  // === МАТЕМАТИКА — number_line (Phase 2) ===
  // ============================================================
  {
    subject: 'math',
    topicSlug: 'koordinatnyy-luch-i-shkaly',
    fixture: {
      id: 'math/koordinatnyy-luch/number_line',
      title: 'Координатный луч: шкала',
      spec: {
        type: 'number_line',
        title: 'Координатный луч (5 класс)',
        range: [0, 12],
        step: 1,
        points: [
          { value: 0, label: 'O (начало)', color: 'highlight' },
          { value: 5, label: 'A', color: 'normal' },
          { value: 9, label: 'B', color: 'highlight' },
        ],
        caption: 'Точка O — начало отсчёта',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'deystviya-s-ratsionalnymi-chislami',
    fixture: {
      id: 'math/deystviya-s-ratsionalnymi-chislami/number_line',
      title: 'Действия с рациональными числами',
      spec: {
        type: 'number_line',
        title: 'Числовая прямая: -5 + 3 = -2',
        range: [-6, 4],
        step: 1,
        points: [
          { value: -5, label: 'A (-5)', color: 'highlight' },
          { value: -3, label: '← 2', color: 'normal' },
          { value: -2, label: 'B (-2)', color: 'highlight' },
        ],
        caption: 'Сложение: -5 + 3 = -2',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'modul-chisla',
    fixture: {
      id: 'math/modul-chisla/number_line',
      title: 'Модуль числа (6 класс)',
      spec: {
        type: 'number_line',
        title: 'Модуль числа',
        range: [-5, 5],
        step: 1,
        points: [
          { value: -3, label: '|-3| = 3', color: 'highlight' },
          { value: 3, label: '|3| = 3', color: 'highlight' },
        ],
        caption: '|-3| = |3| = 3',
      },
    },
  },

  // ============================================================
  // === МАТЕМАТИКА — geometry (Phase 2) ===
  // ============================================================
  {
    subject: 'math',
    topicSlug: 'ugly-izmerenie-uglov',
    fixture: {
      id: 'math/ugly-izmerenie-uglov/geometry',
      title: 'Углы. Измерение углов (5 класс)',
      spec: {
        type: 'geometry',
        shape: 'triangle',
        title: 'Треугольник с разными углами',
        measurements: {
          angles: [
            { id: 'A', value: 30, unit: '°' },
            { id: 'B', value: 60, unit: '°' },
            { id: 'C', value: 90, unit: '°' },
          ],
        },
        question: 'Какой это треугольник?',
        caption: '∠A + ∠B + ∠C = 180°',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'ploschad-i-perimetr',
    fixture: {
      id: 'math/ploshchad-i-perimetr/geometry',
      title: 'Площадь и периметр (4 класс)',
      spec: {
        type: 'geometry',
        shape: 'rectangle',
        title: 'Прямоугольник ABCD',
        measurements: {
          sides: [
            { id: 'AB', value: 8, unit: 'см' },
            { id: 'BC', value: 3, unit: 'см' },
            { id: 'CD', value: 8, unit: 'см' },
            { id: 'DA', value: 3, unit: 'см' },
          ],
        },
        question: 'Найдите площадь и периметр',
        caption: 'S = AB · BC = 24 см²; P = 2·(AB + BC) = 22 см',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'pravye-i-ugly',
    fixture: {
      id: 'math/pravye-i-ugly/geometry',
      title: 'Прямые и углы (5 класс)',
      spec: {
        type: 'geometry',
        shape: 'parallelogram',
        title: 'Параллелограмм ABCD',
        measurements: {
          angles: [
            { id: 'A', value: 60, unit: '°' },
            { id: 'B', value: 120, unit: '°' },
          ],
        },
        question: 'Чему равны углы C и D?',
        caption: 'Противоположные углы параллелограмма равны',
      },
    },
  },
  {
    subject: 'math',
    topicSlug: 'krug',
    fixture: {
      id: 'math/krug/geometry',
      title: 'Круг и окружность (2 класс)',
      spec: {
        type: 'geometry',
        shape: 'circle',
        title: 'Окружность с центром O',
        question: 'Чем отличается окружность от круга?',
        caption: 'Окружность — это граница, круг — это вся фигура',
      },
    },
  },

  // ============================================================
  // === БИОЛОГИЯ (Phase 3 — biology diagrams) ===
  // ============================================================
  {
    subject: 'biology',
    topicSlug: 'rasteniya',
    fixture: {
      id: 'biology/rasteniya/plant',
      title: 'Растения: части (5 класс)',
      spec: {
        type: 'biology',
        diagram: 'plant',
        title: 'Строение растения',
        question: 'Какая часть растения участвует в фотосинтезе?',
        caption: 'Листья содержат хлоропласты с хлорофиллом',
      },
    },
  },
  {
    subject: 'biology',
    topicSlug: 'zhivotnye',
    fixture: {
      id: 'biology/zhivotnye/animal-class',
      title: 'Животные: классификация (7 класс)',
      spec: {
        type: 'biology',
        diagram: 'animal-class',
        title: 'Классификация животных',
        question: 'К какому типу относятся насекомые?',
        caption: 'Членистоногие — самый многочисленный тип',
      },
    },
  },
  {
    subject: 'biology',
    topicSlug: 'genetika',
    fixture: {
      id: 'biology/genetika/dna',
      title: 'Генетика: ДНК (9 класс)',
      spec: {
        type: 'biology',
        diagram: 'dna',
        title: 'Двойная спираль ДНК',
        question: 'Сколько хромосом у человека?',
        caption: '46 хромосом (23 пары)',
      },
    },
  },

  // ============================================================
  // === ХИМИЯ (Phase 3 — chemistry diagrams) ===
  // ============================================================
  {
    subject: 'chemistry',
    topicSlug: 'osnovnye-ponyatiya',
    fixture: {
      id: 'chemistry/osnovnye-ponyatiya/atom',
      title: 'Основные понятия: атом (8 класс)',
      spec: {
        type: 'chemistry',
        diagram: 'atom',
        title: 'Строение атома водорода',
        question: 'Что такое атом?',
        caption: '1 протон + 1 электрон',
      },
    },
  },
  {
    subject: 'chemistry',
    topicSlug: 'periodicheskaya-tablitsa',
    fixture: {
      id: 'chemistry/periodicheskaya-tablitsa/periodic',
      title: 'Периодическая таблица (8 класс)',
      spec: {
        type: 'chemistry',
        diagram: 'periodic',
        title: 'Первые 6 элементов',
        question: 'Сколько периодов в таблице Менделеева?',
        caption: '7 периодов, 8 групп',
      },
    },
  },
  {
    subject: 'chemistry',
    topicSlug: 'himicheskie-reakcii',
    fixture: {
      id: 'chemistry/himicheskie-reakcii/reaction',
      title: 'Химические реакции (9 класс)',
      spec: {
        type: 'chemistry',
        diagram: 'reaction',
        title: 'Горение водорода: 2H₂ + O₂ → 2H₂O',
        question: 'Какие признаки этой реакции?',
        caption: 'Экзотермическая реакция соединения',
      },
    },
  },
];

/**
 * Ищет chart_spec для заданной темы.
 * Возвращает null если тема не в whitelist или если фикстура не валидна.
 *
 * Безопасный fallback: если что-то не так — лучше вернуть null
 * и показать ученику лист БЕЗ графика, чем упасть с ошибкой.
 */
export function pickChartForTopic(
  subject: string,
  topicSlug: string,
): ChartSpec | null {
  const entry = FIXTURES.find(
    (f) => f.subject === subject && f.topicSlug === topicSlug,
  );
  if (!entry) return null;
  return entry.fixture.spec;
}

/**
 * Список всех тем с графиками — для admin-UI и SEO-карты.
 */
export const CHART_TOPICS: Array<{
  subject: string;
  topicSlug: string;
  title: string;
}> = FIXTURES.map((f) => ({
  subject: f.subject,
  topicSlug: f.topicSlug,
  title: f.fixture.title,
}));
