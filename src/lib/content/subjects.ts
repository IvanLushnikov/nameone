import type { Subject, Topic, Grade, TopicExample } from "../types";
import { GRADE_EXTENSIONS } from "./grade-extensions";
import { EXTRA_EXAMPLES } from "./topic-examples-extra";

/**
 * Таксономия предметов, классов и тем.
 * Реальные темы ФГОС с примерами заданий.
 * Раздел ФГОС — человекочитаемое название раздела (не код вида 1.1.1).
 */

export type { Subject, Topic, Grade };

// ====================== МАТЕМАТИКА (1–6) + АЛГЕБРА + ГЕОМЕТРИЯ ======================

const mathGrades: Grade[] = [
  {
    num: 1,
    title: "1 класс",
    topics: [
      {
        slug: "chisla-ot-1-do-10",
        title: "Числа от 1 до 10",
        fgosRef: "Числа и величины",
        examples: [
          { text: "Запишите число, которое идёт после 5: __", answer: "6" },
          { text: "Сосчитайте: 3 + 2 = __", answer: "5" },
          { text: "Какое число больше: 4 или 7? __", answer: "7" },
        ],
      },
      {
        slug: "chisla-do-100-desyatki",
        title: "Круглые числа (10, 20, …, 100)",
        examples: [
          { text: "Сколько десятков в числе 90? __", answer: "9" },
          { text: "Запишите число, которое идёт после 70: __", answer: "80" },
        ],
      },
      {
        slug: "slozhenie-i-vychitanie-do-10",
        title: "Сложение и вычитание до 10",
        examples: [
          { text: "2 + 3 = __", answer: "5" },
          { text: "7 − 4 = __", answer: "3" },
          { text: "В вазе 6 яблок, 2 съели. Сколько осталось? __", answer: "4" },
        ],
      },
      {
        slug: "sravnenie-chisel",
        title: "Сравнение чисел",
        examples: [
          { text: "Поставьте знак >, < или =: 5 ☐ 3", answer: ">" },
          { text: "Что больше: 9 или 6? __", answer: "9" },
        ],
      },
      {
        slug: "geometricheskie-figury-1",
        title: "Геометрические фигуры: круг, квадрат, треугольник",
        examples: [
          { text: "Сколько углов у треугольника? __", answer: "3" },
          { text: "У какой фигуры нет углов?", answer: "у круга" },
        ],
      },
      {
        slug: "izmerenie-dliny-1",
        title: "Измерение длины (см, дм)",
        examples: [
          { text: "Сколько сантиметров в 1 дециметре?", answer: "10" },
          { text: "Переведите: 3 дм = __ см", answer: "30" },
        ],
      },
      {
        slug: "zadachi-v-odno-deystvie",
        title: "Задачи в одно действие",
        examples: [
          { text: "У Оли 5 яблок, а у Поли — на 2 больше. Сколько у Поли?", answer: "7" },
          { text: "В корзине 9 грибов, 4 съели. Сколько осталось?", answer: "5" },
        ],
      },
    ],
  },
  {
    num: 2,
    title: "2 класс",
    topics: [
      {
        slug: "chisla-ot-11-do-20",
        title: "Числа от 11 до 20",
        fgosRef: "Числа и величины",
        examples: [
          { text: "Какое число идёт после 14? __", answer: "15" },
          { text: "Запишите число, в котором 1 десяток и 5 единиц: __", answer: "15" },
          { text: "Сравните: 18 ☐ 12", answer: "больше (>)" },
        ],
      },
      {
        slug: "tablitsa-umnozheniya",
        title: "Таблица умножения",
        examples: [
          { text: "3 × 4 = __", answer: "12" },
          { text: "6 × 7 = __", answer: "42" },
          { text: "В каждой коробке 5 карандашей. Сколько в 4 коробках? __", answer: "20" },
        ],
      },
      {
        slug: "delenie-na-ravnye-chasti",
        title: "Деление на равные части",
        examples: [
          { text: "12 яблок разложили поровну в 3 корзины. Сколько в каждой?", answer: "4" },
          { text: "18 ÷ 6 = __", answer: "3" },
        ],
      },
      {
        slug: "slozhenie-i-vychitanie-do-100",
        title: "Сложение и вычитание до 100",
        examples: [
          { text: "45 + 23 = __", answer: "68" },
          { text: "67 − 28 = __", answer: "39" },
          { text: "В автобусе 38 пассажиров, 15 вышли. Сколько осталось? __", answer: "23" },
        ],
      },
      {
        slug: "chisla-do-1000",
        title: "Числа в пределах 1000",
        examples: [
          { text: "Запишите число 6 сотен 3 десятка 5 единиц: __", answer: "635" },
          { text: "Сколько десятков в числе 540? __", answer: "4 (в числе 540: 5 сотен, 4 десятка, 0 единиц)" },
        ],
      },
      {
        slug: "edinitsy-dliny",
        title: "Единицы длины (мм, см, дм, м)",
        examples: [
          { text: "Переведите: 5 м = __ см", answer: "500" },
          { text: "Сравните: 1 м ☐ 99 см", answer: "больше (>)" },
        ],
      },
      {
        slug: "edinitsy-massy",
        title: "Единицы массы (кг, г)",
        examples: [
          { text: "Сколько граммов в 2 кг?", answer: "2000" },
          { text: "В пакете 1 кг 200 г муки. Сколько это в граммах? __", answer: "1200" },
        ],
      },
      {
        slug: "edinitsy-vremeni",
        title: "Единицы времени (час, минута, сутки)",
        examples: [
          { text: "Сколько минут в 1 часе?", answer: "60" },
          { text: "Переведите: 2 ч 30 мин = __ мин", answer: "150" },
        ],
      },
      {
        slug: "zadachi-na-dvizhenie-prostye",
        title: "Задачи на движение (простые)",
        examples: [
          { text: "Скорость 6 км/ч, время 3 ч. Путь = __ км", answer: "18" },
          { text: "Путь 24 км, скорость 8 км/ч. Время = __ ч", answer: "3" },
        ],
      },
    ],
  },
  {
    num: 3,
    title: "3 класс",
    topics: [
      {
        slug: "umnozhenie-i-delenie",
        title: "Умножение и деление",
        examples: [
          { text: "8 × 6 = __", answer: "48" },
          { text: "56 ÷ 7 = __", answer: "8" },
          { text: "Мама купила 3 кг яблок по 45 руб. Сколько заплатила? __", answer: "135" },
        ],
      },
      {
        slug: "vse-deystviya-v-predelah-1000",
        title: "Все действия в пределах 1000",
        examples: [
          { text: "700 − 348 = __", answer: "352" },
          { text: "125 × 4 = __", answer: "500" },
          { text: "840 ÷ 6 = __", answer: "140" },
        ],
      },
      {
        slug: "drobi-prostye",
        title: "Доли. Начальные понятия",
        fgosRef: "Числа и величины. Доли",
        examples: [
          { text: "Чему равна 1/4 от 20? __", answer: "5" },
          { text: "Половина от 20 = __", answer: "10" },
          { text: "Сколько будет 1/3 от 12? __", answer: "4" },
        ],
      },
      {
        slug: "ploschad-edinitsy",
        title: "Площадь и единицы площади",
        examples: [
          { text: "Переведите: 1 м² = __ см²", answer: "10000" },
          { text: "Площадь квадрата со стороной 6 см = __ см²", answer: "36" },
        ],
      },
      {
        slug: "tekstovye-zadachi-3",
        title: "Текстовые задачи на разностное и кратное сравнение",
        examples: [
          { text: "В одной вазе 15 яблок, в другой — 7. На сколько в первой больше?", answer: "на 8" },
          { text: "В 3 коробках 24 карандаша поровну. Сколько карандашей в каждой?", answer: "8" },
        ],
      },
      {
        slug: "skorost-vremya-rasstoyanie",
        title: "Связь скорости, времени и расстояния",
        examples: [
          { text: "v = 60 км/ч, t = 4 ч. S = __ км", answer: "240" },
          { text: "S = 360 км, v = 90 км/ч. t = __ ч", answer: "4" },
        ],
      },
    ],
  },
  {
    num: 4,
    title: "4 класс",
    topics: [
      {
        slug: "uravneniya-3",
        title: "Уравнения в одно действие",
        fgosRef: "Числовые и буквенные уравнения",
        examples: [
          { text: "Решите: x + 27 = 50, x = __", answer: "23" },
          { text: "Решите: 5x = 65, x = __", answer: "13" },
        ],
      },
      {
        slug: "umnozhenie-mnogoznachnykh",
        title: "Умножение многозначных чисел",
        examples: [
          { text: "456 × 7 = __", answer: "3192" },
          { text: "302 × 45 = __", answer: "13590" },
        ],
      },
      {
        slug: "delenie-mnogoznachnoe-na-mnogoznachnoe",
        title: "Деление многозначных чисел",
        examples: [
          { text: "2880 ÷ 36 = __", answer: "80" },
          { text: "1584 ÷ 12 = __", answer: "132" },
        ],
      },
      {
        slug: "chisla-do-milliona",
        title: "Числа до 1 000 000. Классы и разряды",
        examples: [
          { text: "Запишите: 3 сотни тысяч 4 десятка = __", answer: "300040" },
          { text: "Какой разряд у цифры 5 в числе 654 321? __", answer: "десятки тысяч" },
        ],
      },
      {
        slug: "ploschad-i-perimetr",
        title: "Площадь и периметр",
        examples: [
          { text: "Периметр прямоугольника со сторонами 5 и 8 = __", answer: "26" },
          { text: "Площадь квадрата со стороной 7 = __", answer: "49" },
        ],
      },
      {
        slug: "uravneniya-4",
        title: "Уравнения в два действия",
        examples: [
          { text: "Реши: 3x + 7 = 25, x = __", answer: "6" },
          { text: "Реши: (x − 5) × 4 = 16, x = __", answer: "9" },
        ],
      },
      {
        slug: "drobi-4",
        title: "Дроби. Сравнение и сложение",
        examples: [
          { text: "Сравните: 3/4 ☐ 2/3", answer: ">" },
          { text: "Сложите: 2/7 + 3/7 = __", answer: "5/7" },
        ],
      },
      {
        slug: "tekstovye-zadachi-na-dvizhenie",
        title: "Задачи на движение с двух направлений",
        examples: [
          { text: "Два автобуса выехали навстречу: один 60 км/ч, другой 50 км/ч. Через 2 ч расстояние между ними 220 км. Какое расстояние было сначала?", answer: "440 км" },
          { text: "Лодка плывёт по течению 12 км/ч, против — 8 км/ч. Скорость течения = __ км/ч", answer: "2" },
        ],
      },
      {
        slug: "mnogougolniki-i-parallelepipedy",
        title: "Многоугольники. Прямоугольный параллелепипед",
        examples: [
          { text: "Сколько граней у куба?", answer: "6" },
          { text: "Сколько рёбер у прямоугольного параллелепипеда?", answer: "12" },
        ],
      },
    ],
  },
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "drobi-obyknovennye",
        title: "Обыкновенные дроби",
        fgosRef: "Числа и действия с ними",
        examples: [
          { text: "Сократите дробь: 8/12 = __", answer: "2/3" },
          { text: "Сложите: 2/5 + 1/5 = __", answer: "3/5" },
          { text: "Приведите к общему знаменателю: 1/3 и 2/5. Сумма = __", answer: "11/15" },
          { text: "Из 3/4 м ткани отрезали 1/2 м. Сколько осталось? __", answer: "1/4" },
        ],
      },
      {
        slug: "sravnenie-drobey",
        title: "Сравнение обыкновенных дробей",
        examples: [
          { text: "Сравните: 5/6 ☐ 7/8", answer: "<" },
          { text: "Расположите в порядке возрастания: 1/2, 1/4, 3/4", answer: "1/4, 1/2, 3/4" },
        ],
      },
      {
        slug: "smeshannye-chisla",
        title: "Смешанные числа",
        examples: [
          { text: "Переведите в неправильную дробь: 2 1/3 = __", answer: "7/3" },
          { text: "Выделите целую часть: 17/5 = __", answer: "3 2/5" },
        ],
      },
      {
        slug: "desyatichnye-drobi",
        title: "Десятичные дроби",
        examples: [
          { text: "0,5 + 0,25 = __", answer: "0,75" },
          { text: "3,6 × 2 = __", answer: "7,2" },
          { text: "2,4 ÷ 0,6 = __", answer: "4" },
        ],
      },
      {
        slug: "protsenty-5",
        title: "Проценты. Нахождение процента от числа",
        examples: [
          { text: "Найдите 15% от 200: __", answer: "30" },
          { text: "Что больше: 25% от 100 или 40% от 60?", answer: "25% от 100 (=25); 40% от 60 (=24); больше первое" },
        ],
      },
      {
        slug: "srednee-arifmeticheskoe",
        title: "Среднее арифметическое",
        examples: [
          { text: "Среднее арифметическое чисел 4, 6, 8 = __", answer: "6" },
          { text: "За неделю 5 дней температура: 18, 20, 22, 19, 21. Средняя = __ °C", answer: "20" },
        ],
      },
      {
        slug: "uravneniya-prostye",
        title: "Простые уравнения",
        examples: [
          { text: "Реши: 3x = 27, x = __", answer: "9" },
          { text: "Реши: 2x + 5 = 17, x = __", answer: "6" },
        ],
      },
      {
        slug: "ugly-izmerenie-uglov",
        title: "Углы. Измерение углов",
        examples: [
          { text: "Какой угол называется прямым?", answer: "равный 90°" },
          { text: "Сколько градусов в развёрнутом угле?", answer: "180°" },
        ],
      },
      {
        slug: "koordinatnyy-luch",
        title: "Координатный луч. Шкалы",
        examples: [
          { text: "Какие координаты у точки, находящейся правее начала координат на 4 единицы? __", answer: "(4)" },
          { text: "Какой луч называют координатным?", answer: "луч с началом отсчёта, единичным отрезком и направлением" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "otritsatelnye-chisla",
        title: "Положительные и отрицательные числа",
        examples: [
          { text: "−5 + 9 = __", answer: "4" },
          { text: "−3 × −6 = __", answer: "18" },
          { text: "|−8| = __", answer: "8" },
        ],
      },
      {
        slug: "deystviya-s-ratsionalnymi",
        title: "Действия с рациональными числами",
        examples: [
          { text: "−3,5 + 2,7 = __", answer: "−0,8" },
          { text: "−4 × 2,5 = __", answer: "−10" },
        ],
      },
      {
        slug: "modul-chisla",
        title: "Модуль числа",
        examples: [
          { text: "|−12| = __", answer: "12" },
          { text: "|7 − 10| = __", answer: "3" },
        ],
      },
      {
        slug: "proportsii",
        title: "Пропорции",
        examples: [
          { text: "Найдите x: 3/4 = x/12, x = __", answer: "9" },
          { text: "За 3 кг заплатили 240 руб. Сколько за 5 кг? __", answer: "400" },
        ],
      },
      {
        slug: "linear-inequalities-6",
        title: "Линейные неравенства",
        examples: [
          { text: "Реши: 2x − 3 > 7, x > __", answer: "5" },
          { text: "При каком x выполняется: x − 4 ≤ 0?", answer: "x ≤ 4" },
        ],
      },
      {
        slug: "koordinatnaya-ploskost",
        title: "Координатная плоскость",
        examples: [
          { text: "Какая это координата: (0, 0)?", answer: "начало координат" },
          { text: "В какой четверти находится точка (−2, 3)?", answer: "во II" },
        ],
      },
      {
        slug: "delenie-v-drobyakh",
        title: "Деление обыкновенных дробей",
        examples: [
          { text: "3/4 ÷ 1/2 = __", answer: "3/2 = 1 1/2" },
          { text: "5 ÷ 2/3 = __", answer: "15/2 = 7,5" },
        ],
      },
      {
        slug: "simmetriya-6",
        title: "Симметрия. Осевая и центральная",
        examples: [
          { text: "Сколько осей симметрии у квадрата?", answer: "4" },
          { text: "Какая фигура имеет бесконечно много осей симметрии?", answer: "окружность" },
        ],
      },
    ],
  },
];

// ====================== АЛГЕБРА (7–9) ======================

const algebraGrades: Grade[] = [
  {
    num: 7,
    title: "7 класс · Алгебра",
    topics: [
      // === МЕРЗЛЯК 7 (Главы 1–4) ===
      {
        slug: "m-lin-uravn-7",
        title: "Линейное уравнение с одной переменной",
        fgosRef: "Мерзляк Гл. 1",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "5(x − 3) = 2x + 6, x = __", answer: "7" },
          { text: "3x − 4 = 8 − x, x = __", answer: "3" },
          { text: "Уравнение 0·x = 5 имеет корни?", answer: "не имеет" },
          { text: "Уравнение 0·x = 0 имеет корни?", answer: "бесконечно много (любое x)" },
        ],
      },
      {
        slug: "m-tselye-vyrazheniya-7",
        title: "Целые выражения. Тождества, тождественные преобразования",
        fgosRef: "Мерзляк Гл. 2",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Преобразуйте: 5a − (3a − 7) = __", answer: "2a + 7" },
          { text: "Какое выражение называют тождеством?", answer: "равенство, верное при любых значениях переменных" },
        ],
      },
      {
        slug: "m-stepen-natural-7",
        title: "Степень с натуральным показателем и её свойства",
        fgosRef: "Мерзляк Гл. 2 §7–9",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "2⁴ = __", answer: "16" },
          { text: "(−3)³ = __", answer: "−27" },
          { text: "5² × 5³ = __", answer: "5⁵ = 3125" },
          { text: "Чему равно a⁰ при a ≠ 0?", answer: "1" },
        ],
      },
      {
        slug: "m-odnochleny-7",
        title: "Одночлены. Операции с одночленами (умножение, возведение в степень)",
        fgosRef: "Мерзляк Гл. 2 §10–12",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "3a²b × 2ab³ = __", answer: "6a³b⁴" },
          { text: "(2x²)³ = __", answer: "8x⁶" },
          { text: "Степень одночлена −5a²b³:", answer: "5 (2 + 3)" },
        ],
      },
      {
        slug: "m-mnogochleny-7",
        title: "Многочлены. Сложение, вычитание и умножение многочленов",
        fgosRef: "Мерзляк Гл. 2 §13–18",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "(3x² + 2x) + (5x² − 4x) = __", answer: "8x² − 2x" },
          { text: "(4a² − 3ab) − (a² + 2ab) = __", answer: "3a² − 5ab" },
          { text: "(x + 2)(x − 3) = __", answer: "x² − x − 6" },
        ],
      },
      {
        slug: "m-fsu-7",
        title: "Формулы сокращённого умножения: a²−b², (a±b)², a³±b³",
        fgosRef: "Мерзляк Гл. 2 §19–22",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "(a + b)² = __", answer: "a² + 2ab + b²" },
          { text: "(a − 3)(a + 3) = __", answer: "a² − 9" },
          { text: "(x + 4)² = __", answer: "x² + 8x + 16" },
        ],
      },
      {
        slug: "m-funktsiya-7",
        title: "Функции. Область определения и значения. Графики y = kx + b",
        fgosRef: "Мерзляк Гл. 3 §23–26",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Какой график у функции y = 3x?", answer: "прямая через начало координат" },
          { text: "График y = kx + b пересекает Oy в точке:", answer: "(0, b)" },
        ],
      },
      {
        slug: "m-lineynye-uravn-2-perem-7",
        title: "Линейные уравнения с двумя переменными и их графики",
        fgosRef: "Мерзляк Гл. 3 §27",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Постройте график y = 2x − 4. Точки пересечения с осями:", answer: "Ox: (2, 0); Oy: (0, −4)" },
        ],
      },
      {
        slug: "m-sistemy-lineynye-7",
        title: "Системы линейных уравнений с двумя переменными",
        fgosRef: "Мерзляк Гл. 4 §28–33",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Решите: x + y = 7, x − y = 1. (x, y) = __", answer: "(4, 3)" },
          { text: "Сколько решений может иметь система линейных уравнений?", answer: "0, 1 или ∞" },
        ],
      },
      // === МОРДКОВИЧ 7 ===
      {
        slug: "md-mat-yazyk-7",
        title: "Математический язык. Числовые и алгебраические выражения",
        fgosRef: "Мордкович Гл. 1 §1–5",
        umk: ["morozovich"],
        examples: [
          { text: "Запишите в виде выражения: удвоенное произведение a и b", answer: "2ab" },
          { text: "Числовое выражение содержит:", answer: "только числа, знаки и скобки (без букв)" },
        ],
      },
      {
        slug: "md-lineynaya-funktsiya-7",
        title: "Линейная функция y = kx + m и её график",
        fgosRef: "Мордкович Гл. 2 §6–11",
        umk: ["morozovich"],
        examples: [
          { text: "График y = kx + m при k < 0:", answer: "сверху вниз слева направо" },
          { text: "Параллельны ли y = 2x + 3 и y = 2x − 5?", answer: "да (одинаковый k)" },
        ],
      },
      {
        slug: "md-stepen-natural-7",
        title: "Степень с натуральным показателем. Таблица степеней",
        fgosRef: "Мордкович Гл. 3 §15–19",
        umk: ["morozovich"],
        examples: [
          { text: "2⁷ = __", answer: "128" },
          { text: "Степень отрицательного числа с чётным показателем:", answer: "положительное число" },
          { text: "a⁰ (при a ≠ 0) = __", answer: "1" },
        ],
      },
      {
        slug: "md-odnochleny-7",
        title: "Одночлены. Стандартный вид. Умножение и возведение в степень",
        fgosRef: "Мордкович Гл. 4 §20–23",
        umk: ["morozovich"],
        examples: [
          { text: "Стандартный вид 5x · 2x² = __", answer: "10x³" },
          { text: "Коэффициент одночлена −3ab:", answer: "−3" },
          { text: "Степень одночлена 7xy²z³:", answer: "6" },
        ],
      },
      {
        slug: "md-mnogochleny-arifmet-7",
        title: "Многочлены. Сложение, вычитание, умножение, приведение подобных",
        fgosRef: "Мордкович Гл. 5 §24–29",
        umk: ["morozovich"],
        examples: [
          { text: "(2x + 1)(3x − 4) = __", answer: "6x² − 5x − 4" },
          { text: "Степень многочлена 4x³ − 2x + 7:", answer: "3" },
        ],
      },
      {
        slug: "md-fsu-7",
        title: "Формулы сокращённого умножения — разбор всех случаев",
        fgosRef: "Мордкович Гл. 6 §32–38",
        umk: ["morozovich"],
        examples: [
          { text: "(a − b)(a² + ab + b²) = __", answer: "a³ − b³" },
          { text: "(a + b)³ = __", answer: "a³ + 3a²b + 3ab² + b³" },
        ],
      },
      {
        slug: "md-funktsii-grafiki-7",
        title: "Функции y = x², y = x³, y = x, y = |x| и их графики",
        fgosRef: "Мордкович Гл. 7 §39–44",
        umk: ["morozovich"],
        examples: [
          { text: "График y = x² — это:", answer: "парабола, вершина в начале координат" },
          { text: "y = x³ — функция:", answer: "нечётная, возрастает на всей области определения" },
        ],
      },
      {
        slug: "md-sistemy-lineynye-7",
        title: "Системы линейных уравнений: графический, подстановки, сложения",
        fgosRef: "Мордкович Гл. 8 §45–48",
        umk: ["morozovich"],
        examples: [
          { text: "Решите систему: 2x + 3y = 5, x − y = 1. (x, y) = __", answer: "(1.6, 0.6)" },
          { text: "Метод, при котором складываются/вычитаются уравнения:", answer: "метод алгебраического сложения" },
        ],
      },
      // === АЛИМОВ 7 ===
      {
        slug: "a-povtorenie-7",
        title: "Повторение курса 5–6 классов. Числовые и алгебраические выражения",
        fgosRef: "Алимов Гл. 1 §1–3",
        umk: ["alimov"],
        examples: [
          { text: "Раскройте скобки: 3 · (a + 2) = __", answer: "3a + 6" },
          { text: "Найдите значение 5x − 3 при x = 4:", answer: "17" },
        ],
      },
      {
        slug: "a-uravneniya-7",
        title: "Уравнения с одним неизвестным. Линейные уравнения",
        fgosRef: "Алимов Гл. 2 §4–7",
        umk: ["alimov"],
        examples: [
          { text: "Решите: 3x − 7 = 2x + 5, x = __", answer: "12" },
          { text: "Корень уравнения 5(x − 1) = 3(x + 2):", answer: "5,5" },
        ],
      },
      {
        slug: "a-funktsii-7",
        title: "Функция и её график. Линейная функция y = kx + b",
        fgosRef: "Алимов Гл. 3 §8–13",
        umk: ["alimov"],
        examples: [
          { text: "Что такое аргумент функции?", answer: "независимая переменная (обычно x)" },
          { text: "Область определения функции — это:", answer: "все x, при которых выражение имеет смысл" },
        ],
      },
      {
        slug: "a-stepen-natural-7",
        title: "Степень с натуральным показателем и её свойства",
        fgosRef: "Алимов Гл. 4 §14–17",
        umk: ["alimov"],
        examples: [
          { text: "aᵐ · aⁿ = __", answer: "aᵐ⁺ⁿ" },
          { text: "(aᵐ)ⁿ = __", answer: "aᵐ·ⁿ" },
          { text: "aᵐ / aⁿ = __", answer: "aᵐ⁻ⁿ (при a ≠ 0)" },
        ],
      },
      {
        slug: "a-odnochleny-7",
        title: "Одночлены и операции над ними",
        fgosRef: "Алимов Гл. 5 §18–21",
        umk: ["alimov"],
        examples: [
          { text: "Приведите к стандартному виду 4x²y · (−2xy²):", answer: "−8x³y³" },
          { text: "Одночлен — это:", answer: "произведение числового коэффициента и степеней переменных" },
        ],
      },
      {
        slug: "a-mnogochleny-7",
        title: "Многочлены. Алгебраическая сумма. Стандартный вид",
        fgosRef: "Алимов Гл. 6 §22–25",
        umk: ["alimov"],
        examples: [
          { text: "Подобные члены в 3x² − 5x + 2x² + 7:", answer: "3x² и 2x² (сумма 5x²)" },
          { text: "Степень многочлена 4x³ + 2x² − 5x + 7:", answer: "3" },
        ],
      },
      {
        slug: "a-fsu-7",
        title: "Формулы сокращённого умножения. Применение для разложения на множители",
        fgosRef: "Алимов Гл. 7 §26–31",
        umk: ["alimov"],
        examples: [
          { text: "Разложите на множители: a² − 9 = __", answer: "(a − 3)(a + 3)" },
          { text: "a³ − b³ = __", answer: "(a − b)(a² + ab + b²)" },
        ],
      },
      {
        slug: "a-sistemy-lineynye-7",
        title: "Системы линейных уравнений с двумя неизвестными",
        fgosRef: "Алимов Гл. 8 §32–35",
        umk: ["alimov"],
        examples: [
          { text: "Решите систему: x + 2y = 7, 3x − 2y = 5. (x, y) = __", answer: "(3, 2)" },
          { text: "Система не имеет решений, если прямые:", answer: "параллельны и не совпадают" },
        ],
      },
      // === ОБЩИЕ ТЕМЫ (все 3 УМК) ===
      {
        slug: "statistika-7",
        title: "Статистические характеристики: среднее, медиана, мода, размах",
        fgosRef: "статистика в курсе 7–9 классов",
        umk: ["merzlyak-alg", "morozovich", "alimov"],
        examples: [
          { text: "Ряд: 3, 7, 7, 12, 5. Мода = __", answer: "7" },
          { text: "Медиана ряда 2, 5, 8, 11, 14:", answer: "8" },
          { text: "Размах ряда 4, 9, 2, 11:", answer: "9" },
          { text: "Среднее арифметическое 3, 5, 8, 4:", answer: "5" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс · Алгебра",
    topics: [
      // === МЕРЗЛЯК 8 ===
      {
        slug: "m-rats-drobi-8",
        title: "Рациональные дроби. Сложение и вычитание (одинаковые знаменатели)",
        fgosRef: "Мерзляк Гл. 1 §1–7",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "3/x + 5/x = __", answer: "8/x" },
          { text: "a/3 − b/3 = __", answer: "(a − b)/3" },
        ],
      },
      {
        slug: "m-rats-drobi-umn-del-8",
        title: "Умножение и деление рациональных дробей. Возведение в степень",
        fgosRef: "Мерзляк Гл. 1 §8–12",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "(a/b) · (c/d) = __", answer: "ac / bd" },
          { text: "(a/b) : (c/d) = __", answer: "ad / bc" },
          { text: "(a/b)² = __", answer: "a² / b²" },
        ],
      },
      {
        slug: "m-kvadratnye-korni-8",
        title: "Квадратные корни. Арифметический квадратный корень и его свойства",
        fgosRef: "Мерзляк Гл. 2 §13–19",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "√144 = __", answer: "12" },
          { text: "√50 = __ в виде 5√2", answer: "5√2" },
          { text: "√12 + √27 = __", answer: "5√3" },
        ],
      },
      {
        slug: "m-deystvitelnye-chisla-8",
        title: "Действительные числа. Числовые промежутки. Иррациональные числа",
        fgosRef: "Мерзляк Гл. 2 §20–21",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "√2 — это:", answer: "иррациональное число" },
          { text: "Отрезок [2; 5] содержит концы?", answer: "да (замкнутый)" },
        ],
      },
      {
        slug: "m-kvadratnye-uravn-8",
        title: "Квадратные уравнения. Дискриминант и теорема Виета",
        fgosRef: "Мерзляк Гл. 3 §22–26",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "x² − 5x + 6 = 0. D, x = __", answer: "D = 1; x = 2 и x = 3" },
          { text: "По теореме Виета: x² − 7x + 12 = 0. x₁ + x₂ = __", answer: "7; x₁ · x₂ = 12" },
        ],
      },
      {
        slug: "m-drobnye-rats-uravn-8",
        title: "Дробные рациональные уравнения",
        fgosRef: "Мерзляк Гл. 3 §27–30",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Решите 2/(x − 1) = 3/(x + 2). x = __", answer: "7" },
          { text: "Уравнение x/(x − 3) = 0 имеет корни?", answer: "x = 0 (при условии x ≠ 3)" },
        ],
      },
      {
        slug: "m-neravenstva-8",
        title: "Числовые неравенства и их свойства. Неравенства с одной переменной",
        fgosRef: "Мерзляк Гл. 4 §31–36",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Если a < b и c > 0, то a + c", answer: "< b + c" },
          { text: "Если a < b и c < d, то a + c", answer: "< b + d" },
          { text: "Решите 5x − 1 < 2x + 8, x = __", answer: "x < 3" },
        ],
      },
      // === МОРДКОВИЧ 8 ===
      {
        slug: "md-algebraicheskie-drobi-8",
        title: "Алгебраические дроби: допустимые значения, сокращение",
        fgosRef: "Мордкович Гл. 1 §1–5",
        umk: ["morozovich"],
        examples: [
          { text: "Сократите дробь (x² − 9)/(x − 3):", answer: "x + 3" },
          { text: "Допустимое значение дроби a/b — это:", answer: "b ≠ 0" },
        ],
      },
      {
        slug: "md-deystviya-drobey-8",
        title: "Сложение, вычитание, умножение и деление алгебраических дробей",
        fgosRef: "Мордкович Гл. 1 §6–11",
        umk: ["morozovich"],
        examples: [
          { text: "(a/b) + (c/b) = __", answer: "(a + c)/b" },
          { text: "(3/(x − 1)) + (1/(x + 1)) = __", answer: "(4x + 2)/(x² − 1)" },
        ],
      },
      {
        slug: "md-funktsiya-koren-8",
        title: "Функция y = √x, её свойства и график",
        fgosRef: "Мордкович Гл. 2 §12–16",
        umk: ["morozovich"],
        examples: [
          { text: "Область определения y = √x:", answer: "x ≥ 0" },
          { text: "График y = √x проходит через (1, __):", answer: "(1, 1)" },
        ],
      },
      {
        slug: "md-kvadratichnaya-funk-8",
        title: "Квадратичная функция y = ax² + bx + c, её парабола",
        fgosRef: "Мордкович Гл. 3 §17–25",
        umk: ["morozovich"],
        examples: [
          { text: "y = −x² + 4. Ветви параболы:", answer: "вниз (a < 0)" },
          { text: "Вершина y = x² − 6x + 5: (x₀, y₀) = __", answer: "(3, −4)" },
        ],
      },
      {
        slug: "md-funktsiya-obratnoy-proportsional-8",
        title: "Функция обратной пропорциональности y = k/x",
        fgosRef: "Мордкович Гл. 3 §26",
        umk: ["morozovich"],
        examples: [
          { text: "Гипербола y = k/x при k > 0 расположена в:", answer: "I и III четвертях" },
          { text: "y = 12/x при x = 3: y = __", answer: "4" },
        ],
      },
      {
        slug: "md-kvadratnye-uravn-8",
        title: "Квадратные уравнения. Дискриминант, теорема Виета",
        fgosRef: "Мордкович Гл. 4 §27–33",
        umk: ["morozovich"],
        examples: [
          { text: "x² − 9 = 0: x = __", answer: "±3" },
          { text: "Сколько действительных корней у x² + 0x + 25 = 0?", answer: "0 (D < 0)" },
        ],
      },
      {
        slug: "md-uravneniya-s-modulem-8",
        title: "Уравнения с модулем. Графический метод",
        fgosRef: "Мордкович Гл. 4 §34",
        umk: ["morozovich"],
        examples: [
          { text: "|x − 2| = 5: x = __", answer: "−3; 7" },
          { text: "|2x + 1| = 7: x = __", answer: "−4; 3" },
        ],
      },
      {
        slug: "md-neravenstva-8",
        title: "Неравенства с одной переменной. Числовые промежутки",
        fgosRef: "Мордкович Гл. 5 §35–39",
        umk: ["morozovich"],
        examples: [
          { text: "x > 3 — это:", answer: "луч (3; +∞)" },
          { text: "Решите 2x − 7 < 4x + 1, x ∈ __", answer: "x > −4" },
        ],
      },
      // === АЛИМОВ 8 ===
      {
        slug: "a-neravenstva-8",
        title: "Числовые неравенства и их свойства. Линейные неравенства с одной переменной",
        fgosRef: "Алимов Гл. 1 §1–12",
        umk: ["alimov"],
        examples: [
          { text: "Если a > b, то a − b", answer: "> 0" },
          { text: "Если a > b и b > c, то a", answer: "> c (транзитивность)" },
          { text: "Решите 3(x − 1) ≥ 2(x + 2), x ∈ __", answer: "x ≥ 7" },
        ],
      },
      {
        slug: "a-kvadratnye-korni-8",
        title: "Квадратные корни. Арифметический квадратный корень и его свойства",
        fgosRef: "Алимов Гл. 2 §13–22",
        umk: ["alimov"],
        examples: [
          { text: "√(a · b) = __", answer: "√a · √b" },
          { text: "√(a/b) = __", answer: "√a / √b" },
          { text: "√(a²) = __", answer: "|a|" },
        ],
      },
      {
        slug: "a-preobrazovaniya-korney-8",
        title: "Преобразования выражений с корнями. Вынесение и внесение множителя",
        fgosRef: "Алимов Гл. 2 §23–28",
        umk: ["alimov"],
        examples: [
          { text: "√75 = __ в виде", answer: "5√3" },
          { text: "Упростите: √8 + √18 − √50 = __", answer: "0 (2√2 + 3√2 − 5√2)" },
        ],
      },
      {
        slug: "a-kvadratnye-uravn-8",
        title: "Квадратные уравнения. Дискриминант, теорема Виета",
        fgosRef: "Алимов Гл. 3 §29–37",
        umk: ["alimov"],
        examples: [
          { text: "x² − 5x + 6 = 0: x = __", answer: "2; 3" },
          { text: "Приведённое кв. уравнение:", answer: "x² + px + q = 0" },
          { text: "По теореме Виета: сумма корней = __", answer: "−p, произведение = q" },
        ],
      },
      {
        slug: "a-rats-uravn-8",
        title: "Рациональные и дробные рациональные уравнения",
        fgosRef: "Алимов Гл. 3 §38–40",
        umk: ["alimov"],
        examples: [
          { text: "x/(x − 2) = 5/(x + 1): x = __", answer: "действительных корней нет (D = −24 < 0)" },
          { text: "Посторонний корень — это:", answer: "корень, обращающий знаменатель в 0" },
        ],
      },
      {
        slug: "a-kvadratichnaya-8",
        title: "Квадратичная функция y = ax² + bx + c. График и свойства",
        fgosRef: "Алимов Гл. 4 §41–50",
        umk: ["alimov"],
        examples: [
          { text: "y = x² − 4x + 3. Нули функции:", answer: "x = 1; x = 3" },
          { text: "y = −x² + 5. Возрастает на отрезке:", answer: "(−∞; 0]" },
        ],
      },
      {
        slug: "a-kvadratnye-neravenstva-8",
        title: "Квадратные неравенства. Метод параболы",
        fgosRef: "Алимов Гл. 5 §51–55",
        umk: ["alimov"],
        examples: [
          { text: "(x − 2)(x + 5) > 0: x ∈ __", answer: "(−∞; −5) ∪ (2; +∞)" },
          { text: "x² − 9 ≤ 0: x ∈ __", answer: "[−3; 3]" },
        ],
      },
      // === ОБЩИЕ ===
      {
        slug: "stepen-tselym-pokazatelem-8",
        title: "Степень с целым отрицательным показателем. Стандартный вид числа",
        fgosRef: "Алимов Гл. 2 §16; Мордкович §14",
        umk: ["merzlyak-alg", "morozovich", "alimov"],
        examples: [
          { text: "5⁻² = __", answer: "1/25" },
          { text: "(1/3)⁻² = __", answer: "9" },
          { text: "0,0034 в стандартном виде:", answer: "3,4 · 10⁻³" },
        ],
      },
      {
        slug: "povtorenie-8",
        title: "Итоговое повторение курса алгебры 8 класса",
        fgosRef: "Мерзляк §39; Алимов §56",
        umk: ["merzlyak-alg", "morozovich", "alimov"],
        examples: [
          { text: "D уравнения 3x² − 7x + 2 = 0: D = __", answer: "49 − 24 = 25" },
          { text: "Сумма первых 4 членов AP 2, 5, 8, 11:", answer: "26" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс · Алгебра",
    topics: [
      // === МЕРЗЛЯК 9 (5 глав) ===
      {
        slug: "m-neravenstva-9",
        title: "Числовые неравенства. Свойства. Неравенства с одной переменной",
        fgosRef: "Мерзляк Гл. 1 §1–8",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Какое из чисел больше: −7 или −10?", answer: "−7 (ближе к нулю)" },
          { text: "5x − 3 ≥ 7, x ≥ __", answer: "2" },
          { text: "x² − 9 < 0, x ∈ __", answer: "(−3; 3)" },
        ],
      },
      {
        slug: "m-kvadratichnaya-9",
        title: "Квадратичная функция и её график. Неравенства второй степени",
        fgosRef: "Мерзляк Гл. 2 §9–19",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Вершина y = x² − 6x + 5:", answer: "(3, −4)" },
          { text: "x² − 5x − 6 < 0: x ∈ __", answer: "(−1; 6)" },
          { text: "Метод интервалов применяется для:", answer: "(x − a₁)(x − a₂)…(x − aₙ) ◯ 0" },
        ],
      },
      {
        slug: "m-uravneniya-dve-perem-9",
        title: "Уравнения с двумя переменными и их системы",
        fgosRef: "Мерзляк Гл. 3 §20–26",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "График xy = 12 — это:", answer: "гипербола" },
          { text: "Решите систему x + y = 7, x − y = 1:", answer: "(4, 3)" },
        ],
      },
      {
        slug: "m-arifm-progressiya-9",
        title: "Арифметическая прогрессия: формулы, характеристическое свойство",
        fgosRef: "Мерзляк Гл. 4 §27–30",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "a₁ = 3, d = 5. a₆ = __", answer: "3 + 5·5 = 28" },
          { text: "Характеристическое свойство AP:", answer: "aₙ = (aₙ₋₁ + aₙ₊₁)/2" },
          { text: "Sₙ = n·(a₁ + aₙ)/2. S₁₀ при a₁ = 2, a₁₀ = 29:", answer: "155" },
        ],
      },
      {
        slug: "m-geom-progressiya-9",
        title: "Геометрическая прогрессия: формулы, сумма n членов",
        fgosRef: "Мерзляк Гл. 4 §31–34",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "b₁ = 2, q = 3. b₄ = __", answer: "2·3³ = 54" },
          { text: "b₁/(1 − q) при |q| < 1:", answer: "сумма бесконечной GP" },
        ],
      },
      {
        slug: "m-mnozhestva-9",
        title: "Множества и операции над ними",
        fgosRef: "Мерзляк Гл. 5 §35–37",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "A = {1, 2, 3, 4}, B = {3, 4, 5, 6}. A ∩ B = __", answer: "{3, 4}" },
          { text: "A ∪ B = __", answer: "{1, 2, 3, 4, 5, 6}" },
          { text: "|{a, b, c}| = __", answer: "3" },
        ],
      },
      {
        slug: "m-kombinatorika-9",
        title: "Комбинаторика: правило умножения, перестановки, размещения, сочетания",
        fgosRef: "Мерзляк Гл. 5 §38–42",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "P₅ = 5! = __", answer: "120" },
          { text: "C₆³ = __", answer: "20" },
          { text: "Число способов выбрать 2 книги из 5:", answer: "C₅² = 10" },
        ],
      },
      {
        slug: "m-veroyatnost-9",
        title: "Случайные события и их вероятность. Классическое определение",
        fgosRef: "Мерзляк Гл. 5 §43–46",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "P(орла при бросании монеты):", answer: "1/2" },
          { text: "P(выпадение шестёрки на игральной кости): __", answer: "1/6" },
          { text: "В корзине 3 кр. и 5 син. P(красный):", answer: "3/8" },
        ],
      },
      {
        slug: "m-statistika-9",
        title: "Статистические данные. Средние значения. Дисперсия",
        fgosRef: "Мерзляк Гл. 5 §47–49",
        umk: ["merzlyak-alg"],
        examples: [
          { text: "Среднее арифметическое 2, 6, 9, 7:", answer: "6" },
          { text: "Медиана 2, 5, 8, 11, 14:", answer: "8" },
          { text: "Дисперсия 2, 4, 6:", answer: "56/3 − 16 = 8/3" },
        ],
      },
      // === МОРДКОВИЧ 9 ===
      {
        slug: "md-ratsionalnye-neravenstva-9",
        title: "Рациональные неравенства и их системы. Метод интервалов",
        fgosRef: "Мордкович Гл. 1 §1–6",
        umk: ["morozovich"],
        examples: [
          { text: "(x − 1)(x + 4) > 0: x ∈ __", answer: "(−∞; −4) ∪ (1; +∞)" },
          { text: "(x² − 9)/(x − 2) ≤ 0: x ∈ __", answer: "(−∞; −3] ∪ (2; 3]" },
          { text: "Система {x + 1 ≥ 0; x² − 4 ≤ 0}: x ∈ __", answer: "[−1; 2]" },
        ],
      },
      {
        slug: "md-sistemy-uravneniy-9",
        title: "Системы уравнений с двумя переменными",
        fgosRef: "Мордкович Гл. 2 §7–15",
        umk: ["morozovich"],
        examples: [
          { text: "Решите {x² + y² = 25, x − y = 1}: решения", answer: "(4, 3) и (−3, −4)" },
          { text: "Графический метод используется, когда:", answer: "систему сложно решить аналитически" },
        ],
      },
      {
        slug: "md-chislovye-funkcii-9",
        title: "Числовые функции: определение, D(y), свойства, графики",
        fgosRef: "Мордкович Гл. 3 §16–22",
        umk: ["morozovich"],
        examples: [
          { text: "y = √(x − 4): D(y) = __", answer: "x ≥ 4" },
          { text: "y = 1/(x + 2): D(y) = __", answer: "x ≠ −2" },
          { text: "Чётная функция симметрична относительно:", answer: "оси Oy" },
        ],
      },
      {
        slug: "md-kvadratichnaya-9",
        title: "Квадратичная функция y = ax² + bx + c. Преобразования графика",
        fgosRef: "Мордкович Гл. 3 §23–26",
        umk: ["morozovich"],
        examples: [
          { text: "График y = (x − 2)² + 3 — это парабола с вершиной:", answer: "(2, 3), ветви вверх" },
          { text: "Преобразование y = x² → y = (x − 2)² + 3:", answer: "сдвиг вправо на 2 и вверх на 3" },
        ],
      },
      {
        slug: "md-stepennaya-natural-9",
        title: "Степенная функция y = xⁿ (n ∈ N). Свойства и график",
        fgosRef: "Мордкович Гл. 3 §27",
        umk: ["morozovich"],
        examples: [
          { text: "y = x² при x = −3: y = __", answer: "9" },
          { text: "y = x³:", answer: "нечётная, возрастает на R" },
        ],
      },
      {
        slug: "md-koren-9",
        title: "Функция y = ³√x. Свойства и график",
        fgosRef: "Мордкович Гл. 3 §28",
        umk: ["morozovich"],
        examples: [
          { text: "D(y = ³√x):", answer: "все действительные" },
          { text: "³√125 = __", answer: "5" },
        ],
      },
      {
        slug: "md-arifm-progressiya-9",
        title: "Арифметическая прогрессия. Формулы aₙ и Sₙ",
        fgosRef: "Мордкович Гл. 4 §29–31",
        umk: ["morozovich"],
        examples: [
          { text: "a₁ = 7, d = −2. a₅ = __", answer: "7 + (−2)·4 = −1" },
          { text: "Формула n-го члена AP:", answer: "aₙ = a₁ + (n − 1)·d" },
          { text: "Sₙ = __", answer: "(a₁ + aₙ)·n / 2" },
        ],
      },
      {
        slug: "md-geom-progressiya-9",
        title: "Геометрическая прогрессия. Сумма бесконечной геометрической прогрессии",
        fgosRef: "Мордкович Гл. 4 §32–36",
        umk: ["morozovich"],
        examples: [
          { text: "bₙ = b₁·qⁿ⁻¹. b₁=3, q=2. b₅ = __", answer: "48" },
          { text: "Сумма бесконечной GP при |q| < 1:", answer: "S = b₁ / (1 − q)" },
        ],
      },
      {
        slug: "md-elementy-komb-9",
        title: "Элементы комбинаторики, статистики и теории вероятностей",
        fgosRef: "Мордкович Гл. 5 §37–42",
        umk: ["morozovich"],
        examples: [
          { text: "Число способов выбрать 2 из 8:", answer: "C₈² = 28" },
          { text: "Классическая вероятность P(A) — это:", answer: "|A| / |Ω|" },
          { text: "Среднее 2,4,4,4,5,5,7,9:", answer: "5" },
        ],
      },
      // === АЛИМОВ 9 ===
      {
        slug: "a-stepen-rats-9",
        title: "Степень с рациональным показателем. Определение и свойства",
        fgosRef: "Алимов Гл. 2 §1–9",
        umk: ["alimov"],
        examples: [
          { text: "8^(1/3) = __", answer: "2" },
          { text: "x^(1/2) · x^(1/3) = __", answer: "x^(5/6)" },
          { text: "27^(2/3) = __", answer: "(³√27)² = 3² = 9" },
          { text: "a⁰ = __", answer: "1 (при a ≠ 0)" },
        ],
      },
      {
        slug: "a-stepennaya-funkciya-9",
        title: "Степенная функция y = xⁿ (n ∈ Z). График и свойства",
        fgosRef: "Алимов Гл. 3 §10–14",
        umk: ["alimov"],
        examples: [
          { text: "При чётном n > 0 функция y = xⁿ:", answer: "чётная, возрастает при x > 0" },
          { text: "При нечётном отрицательном n:", answer: "нечётная, убывает" },
        ],
      },
      {
        slug: "a-korni-n-9",
        title: "Арифметический корень n-й степени (n ∈ N)",
        fgosRef: "Алимов Гл. 3 §15–21",
        umk: ["alimov"],
        examples: [
          { text: "⁴√81 = __", answer: "3" },
          { text: "√[6]{64} = __", answer: "2" },
          { text: "ⁿ√(xⁿ) при x ≥ 0:", answer: "x" },
        ],
      },
      {
        slug: "a-arifm-progressiya-9",
        title: "Арифметическая прогрессия. Формулы aₙ и Sₙ",
        fgosRef: "Алимов Гл. 4 §22–26",
        umk: ["alimov"],
        examples: [
          { text: "a₁ = 5, d = −3. a₄ = __", answer: "5 + (−3)·3 = −4" },
          { text: "Характеристическое свойство AP:", answer: "aₙ = (aₙ₋₁ + aₙ₊₁)/2" },
          { text: "S₆ AP 2,4,6,8,10,12:", answer: "42" },
        ],
      },
      {
        slug: "a-geom-progressiya-9",
        title: "Геометрическая прогрессия. Формулы bₙ и Sₙ. Бесконечная",
        fgosRef: "Алимов Гл. 4 §27–30",
        umk: ["alimov"],
        examples: [
          { text: "b₁ = 2, q = 3. b₄ = __", answer: "54" },
          { text: "Геом. прогрессия знаков постоянна при q", answer: "> 0; иначе знаки чередуются" },
          { text: "Сумма бесконечной GP при |q| < 1:", answer: "b₁ / (1 − q)" },
        ],
      },
      {
        slug: "a-neravenstva-dva-perem-9",
        title: "Неравенства с двумя переменными. Линейные и дробные",
        fgosRef: "Алимов Гл. 5 §31–35",
        umk: ["alimov"],
        examples: [
          { text: "y > 2x + 1 на плоскости:", answer: "полуплоскость выше прямой y = 2x + 1" },
          { text: "Решите (x − 2)(y + 3) > 0:", answer: "плоскость без прямой x = 2 и y = −3" },
        ],
      },
      {
        slug: "a-perestanovki-razmeschenia-9",
        title: "Перестановки, размещения, сочетания (комбинаторика)",
        fgosRef: "Алимов Гл. 6 §36–40",
        umk: ["alimov"],
        examples: [
          { text: "P₄ = __", answer: "24" },
          { text: "C₅² = __", answer: "10" },
          { text: "A₅³ = __", answer: "60" },
        ],
      },
      {
        slug: "a-veroyatnost-sobytie-9",
        title: "Вероятность случайного события. Сложение и умножение вероятностей",
        fgosRef: "Алимов Гл. 7 §41–49",
        umk: ["alimov"],
        examples: [
          { text: "P(A и B) = P(A)·P(B) при:", answer: "независимых" },
          { text: "P(A или B) = P(A) + P(B) при:", answer: "несовместных" },
          { text: "P(6 на игральной кости) = __", answer: "1/6" },
        ],
      },
      // === АЛИМОВ: тригонометрия — уникальная глава ===
      {
        slug: "a-trigon-ugly-9",
        title: "Определение sin, cos, tg, ctg. Зависимости sin² + cos² = 1",
        fgosRef: "Алимов Гл. 8 §50–55",
        umk: ["alimov"],
        examples: [
          { text: "Определение sin α:", answer: "противолежащий катет / гипотенуза" },
          { text: "sin 30° = __", answer: "1/2" },
          { text: "cos 60° = __", answer: "1/2" },
          { text: "sin² α + cos² α:", answer: "1" },
          { text: "tg α = __", answer: "sin α / cos α" },
        ],
      },
      {
        slug: "a-formuly-privedeniya-9",
        title: "Формулы приведения. Знаки по четвертям",
        fgosRef: "Алимов Гл. 8 §56–60",
        umk: ["alimov"],
        examples: [
          { text: "sin(90° − α) = __", answer: "cos α" },
          { text: "cos(180° − α) = __", answer: "−cos α" },
          { text: "tg(180° + α) = __", answer: "tg α" },
          { text: "Четверть, где sin α > 0, cos α < 0:", answer: "II четверть" },
        ],
      },
      {
        slug: "a-trig-formuly-9",
        title: "Тригонометрические формулы сложения",
        fgosRef: "Алимов Гл. 8 §61–66",
        umk: ["alimov"],
        examples: [
          { text: "sin(α + β) = __", answer: "sin α cos β + cos α sin β" },
          { text: "cos(α − β) = __", answer: "cos α cos β + sin α sin β" },
          { text: "tg(α + β) = __", answer: "(tg α + tg β)/(1 − tg α·tg β)" },
        ],
      },
      // === ОБЩИЕ ===
      {
        slug: "povtorenie-9",
        title: "Итоговое повторение курса алгебры 7–9 классов",
        fgosRef: "Мерзляк §49–50; Мордкович §43; Алимов §67",
        umk: ["merzlyak-alg", "morozovich", "alimov"],
        examples: [
          { text: "Упростите (a − 3)² − a(a − 6):", answer: "9" },
          { text: "Какие из дробей 1/2, 2/3, 5/8, 4/6 сократимы?", answer: "4/6 = 2/3" },
        ],
      },
    ],
  },
];
// ====================== ГЕОМЕТРИЯ (7–9) ======================

const geometryGrades: Grade[] = [
  {
    num: 7,
    title: "7 класс · Геометрия",
    topics: [
      {
        slug: "priamye-i-ugly",
        title: "Прямые и углы. Смежные и вертикальные",
        fgosRef: "Начальные геометрические сведения",
        examples: [
          { text: "Смежные углы: один 70°. Второй = __", answer: "110°" },
          { text: "Вертикальные углы равны? да/нет", answer: "да" },
          { text: "Сумма смежных углов = __", answer: "180°" },
        ],
      },
      {
        slug: "treugolnik",
        title: "Треугольники. Признаки равенства (I, II, III)",
        fgosRef: "Треугольники",
        examples: [
          { text: "Два угла треугольника 50° и 70°. Третий = __", answer: "60°" },
          { text: "Стороны 5, 12, 13. Этот треугольник __", answer: "прямоугольный" },
          { text: "По признаку равенства I: если две стороны и угол между ними равны, то треугольники", answer: "равны" },
        ],
      },
      {
        slug: "okruzhnost-7",
        title: "Окружность. Радиус, диаметр, хорда, касательная",
        fgosRef: "Окружность",
        examples: [
          { text: "Радиус 7. Диаметр = __", answer: "14" },
          { text: "Касательная к окружности перпендикулярна:", answer: "радиусу в точке касания" },
        ],
      },
      {
        slug: "mediana-bissektrisa-vysota-7",
        title: "Медиана, биссектриса, высота треугольника",
        fgosRef: "Треугольник",
        examples: [
          { text: "Медиана делит сторону треугольника на:", answer: "два равных отрезка" },
          { text: "Биссектриса делит угол:", answer: "пополам" },
        ],
      },
      {
        slug: "ravnobedrennyy-treugolnik",
        title: "Равнобедренный и равносторонний треугольники",
        fgosRef: "Треугольники",
        examples: [
          { text: "Угол при основании равнобедренного треугольника 50°. Вершина угла = __", answer: "80°" },
          { text: "В равностороннем треугольнике все углы = __", answer: "60°" },
        ],
      },
      {
        slug: "priznaki-ravenstva-treugolnikov",
        title: "Признаки равенства треугольников. Задачи на доказательство",
        fgosRef: "Признаки",
        examples: [
          { text: "Сформулируйте II признак равенства треугольников:", answer: "по стороне и двум прилежащим к ней углам" },
        ],
      },
      {
        slug: "paralelnye-pryamye-7",
        title: "Параллельные прямые. Признаки параллельности",
        fgosRef: "Параллельность",
        examples: [
          { text: "Если две прямые параллельны третьей, то они:", answer: "параллельны между собой" },
          { text: "Сумма односторонних углов при параллельных и секущей:", answer: "180°" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс · Геометрия",
    topics: [
      {
        slug: "chetyrekhugolniki",
        title: "Четырёхугольники: параллелограмм, прямоугольник, ромб, квадрат",
        fgosRef: "Четырёхугольники",
        examples: [
          { text: "Сумма углов четырёхугольника = __", answer: "360°" },
          { text: "Диагонали прямоугольника 8 и 6. Стороны = __", answer: "6 и 8 (прямоугольник)" },
          { text: "У ромба все стороны:", answer: "равны" },
        ],
      },
      {
        slug: "ploschadi-figur",
        title: "Площади фигур: треугольник, параллелограмм, трапеция, ромб",
        fgosRef: "Площади",
        examples: [
          { text: "Площадь трапеции с основаниями 6 и 10 и высотой 4 = __", answer: "32" },
          { text: "Площадь ромба с диагоналями 8 и 6 = __", answer: "24" },
          { text: "Площадь треугольника a = 5, h = 8: __", answer: "20" },
        ],
      },
      {
        slug: "teorema-pifagora",
        title: "Теорема Пифагора. Применение",
        fgosRef: "Теорема Пифагора",
        examples: [
          { text: "Катеты 6 и 8. Гипотенуза = __", answer: "10" },
          { text: "Гипотенуза 13, катет 5. Другой катет = __", answer: "12" },
          { text: "Диагональ прямоугольника 5 и 12. Диагональ = __", answer: "13" },
        ],
      },
      {
        slug: "podobnye-treugolniki-8",
        title: "Подобные треугольники. Признаки подобия",
        fgosRef: "Подобие",
        examples: [
          { text: "Два треугольника подобны с k = 3. Стороны одного 4 и 5. Соответствующие стороны другого:", answer: "12 и 15" },
        ],
      },
      {
        slug: "srednyaya-liniya",
        title: "Средняя линия треугольника и трапеции",
        fgosRef: "Средняя линия",
        examples: [
          { text: "Средняя линия треугольника параллельна основанию и равна:", answer: "его половине" },
        ],
      },
      {
        slug: "okruzhnost-8",
        title: "Окружность. Вписанные и центральные углы",
        fgosRef: "Окружность",
        examples: [
          { text: "Центральный угол 60°, опирается на дугу:", answer: "60°" },
          { text: "Вписанный угол опирается на ту же дугу и равен:", answer: "половине центрального" },
        ],
      },
      {
        slug: "vektory-8",
        title: "Векторы. Сложение, вычитание, умножение на скаляр (без координат)",
        fgosRef: "Векторы",
        examples: [
          { text: "Вектор AB плюс вектор BC равен вектору:", answer: "AC" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс · Геометрия",
    topics: [
      {
        slug: "vektory-9",
        title: "Векторы. Координаты, длина, скалярное произведение",
        fgosRef: "Векторы и координаты",
        examples: [
          { text: "Координаты вектора AB: A(2,3), B(5,7). AB = __", answer: "(3, 4)" },
          { text: "|AB| где AB = (3, 4) = __", answer: "5" },
          { text: "Векторы перпендикулярны, если их скалярное произведение = __", answer: "0" },
        ],
      },
      {
        slug: "koordinaty-9",
        title: "Метод координат. Уравнение прямой и окружности",
        fgosRef: "Метод координат",
        examples: [
          { text: "Уравнение окружности с центром (0, 0) и r = 5:", answer: "x² + y² = 25" },
          { text: "Уравнение прямой через (0, 3) с k = 2:", answer: "y = 2x + 3" },
        ],
      },
      {
        slug: "okruzhnost-9",
        title: "Окружность. Длина и площадь круга. Касательная и секущая",
        fgosRef: "Окружность и круг",
        examples: [
          { text: "Длина окружности с r = 5 ≈ __ (π = 3,14)", answer: "31,4" },
          { text: "Площадь круга с d = 10 ≈ __", answer: "78,5" },
          { text: "Касательная и секущая из одной точки: квадрат касательной = произведению отрезков секущей. Имя теоремы:", answer: "степени точки" },
        ],
      },
      {
        slug: "ploschadi-i-objomy",
        title: "Площади плоских фигур и объёмы тел",
        fgosRef: "Измерения",
        examples: [
          { text: "Объём куба с ребром 3:", answer: "27" },
          { text: "Объём параллелепипеда V = a × b × h. a=5, b=3, h=4. V = __", answer: "60" },
        ],
      },
      {
        slug: "pravilnye-mnogogranniki-9",
        title: "Правильные многоугольники и многогранники",
        fgosRef: "Многоугольники",
        examples: [
          { text: "Сумма углов правильного шестиугольника = __°", answer: "720°" },
          { text: "У правильного n-угольника n вершин и __ диагоналей", answer: "n(n − 3)/2" },
        ],
      },
      {
        slug: "dvizhenie-i-simmetriya",
        title: "Движение. Симметрия и её виды",
        fgosRef: "Движения",
        examples: [
          { text: "Осевая симметрия — это отражение относительно:", answer: "прямой" },
        ],
      },
      {
        slug: "vektornoe-proizvedenie-9",
        title: "Скалярное произведение векторов в координатах",
        fgosRef: "Векторы",
        examples: [
          { text: "a = (3, 4), b = (1, 2). a · b = __", answer: "3·1 + 4·2 = 11" },
          { text: "Если a · b = 0, то векторы:", answer: "перпендикулярны" },
        ],
      },
      {
        slug: "proportsionalnost-otrezkov",
        title: "Пропорциональные отрезки. Теорема Фалеса",
        fgosRef: "Пропорциональные отрезки",
        examples: [
          { text: "Сформулируйте теорему Фалеса:", answer: "параллельные прямые отсекают на сторонах угла пропорциональные отрезки" },
        ],
      },
    ],
  },
];

// ====================== РУССКИЙ ЯЗЫК ======================

const russianGrades: Grade[] = [
  {
    num: 2,
    title: "2 класс",
    topics: [
      {
        slug: "bezudarnye-glasnye",
        title: "Безударные гласные в корне",
        fgosRef: "Орфография",
        examples: [
          { text: "Вставьте букву: л_сточка — т_рава — м_сто", answer: "листочка, трава, место", hint: "проверочные слова: листочки, травы, места" },
          { text: "Вставьте букву: м_ряк", answer: "о", hint: "морЯк" },
          { text: "Вставьте букву: тр_ва", answer: "а", hint: "травА" },
        ],
      },
      {
        slug: "zvonkie-i-glukhie",
        title: "Звонкие и глухие согласные",
        fgosRef: "Орфография. Звонкие и глухие согласные",
        examples: [
          { text: "Произнесите слова и определите, какая согласная звонкая, а какая глухая: дуб, дух, дубы, рука", answer: "дуб, дух — звонкие; дубы, рука — глухие", hint: "в конце слова и после шипящих звонкая согласная оговаривается, в середине слова она глухая" },
          { text: "Произнесите и определите: лук, луга", answer: "лук — звонкая, луга — глухая", hint: "то же правило: в конце слова — звонкая, в середине — глухая" },
        ],
      },
      {
        slug: "udarenie",
        title: "Ударение. Ударный слог",
        examples: [
          { text: "Поставьте ударение: щавель, торты, банты", answer: "щавЕль, тОрты, бАнты" },
          { text: "Сколько слогов в слове «яблоня»?", answer: "3 (я-бло-ня)" },
        ],
      },
      {
        slug: "bolshaya-bukva",
        title: "Заглавная буква в именах собственных",
        examples: [
          { text: "Подчеркните имена собственные: маша живёт в москве на улице ленина", answer: "Маша, Москве, Ленина" },
          { text: "Запишите правильно: (м,М)арья (и,И)вановна (с,С)идорова", answer: "Марья Ивановна Сидорова" },
        ],
      },
      {
        slug: "razdelnoe-napisanie-predlogov",
        title: "Раздельное написание предлогов",
        examples: [
          { text: "Вставьте предлог: Я живу ___ городе.", answer: "в" },
          { text: "Объясните правило: почему «на полу» пишется раздельно?", answer: "предлог с существительным пишется раздельно" },
        ],
      },
      {
        slug: "tekst-i-predlozhenie",
        title: "Текст. Предложение",
        examples: [
          { text: "Чем отличается текст от набора предложений?", answer: "в тексте предложения связаны по смыслу и теме" },
          { text: "Сколько предложений в тексте: «Наступила зима. Выпал первый снег. Дети вышли на прогулку.»", answer: "3" },
        ],
      },
    ],
  },
  {
    num: 3,
    title: "3 класс",
    topics: [
      {
        slug: "morfemnyy-razbor",
        title: "Состав слова. Морфемный разбор",
        examples: [
          { text: "Разберите по составу: подснежник", answer: "под- (приставка) + снеж (корень) + -ник (суффикс)" },
          { text: "Найдите корень в слове «водяной»", answer: "вод-" },
        ],
      },
      {
        slug: "rod-i-padezh-suschestvitelnykh",
        title: "Род и падеж существительных",
        examples: [
          { text: "Определите род: книга, окно, поле", answer: "книга (ж.р.), окно (ср.р.), поле (ср.р.)" },
          { text: "Поставьте в Р.п.: много (стулья) — __", answer: "стульев" },
        ],
      },
      {
        slug: "sklonenie-prilagatelnykh-3",
        title: "Падеж и род существительных",
        fgosRef: "Морфология. Существительное: род, падеж, согласование",
        examples: [
          { text: "Определите род существительных: учитель, письмо, окно", answer: "учитель — м. р., письмо — с. р., окно — с. р." },
          { text: "Согласуйте прилагательное с существительным: (красный) шарик — запишите, как будет: ____", answer: "красный шарик", hint: "шарик — мужской род, прилагательное на -ый" },
          { text: "Согласуйте прилагательное с существительным: много (синяя) ручка — запишите, как будет: ____", answer: "много синих ручек", hint: "после «много» — родительный падеж множественного числа: синих ручек" },
        ],
      },
      {
        slug: "neproiznosimye-soglasnye",
        title: "Непроизносимые согласные",
        examples: [
          { text: "Вставьте букву: солн…е", answer: "ц", hint: "солнце — солнечный" },
          { text: "Вставьте букву: сер…це", answer: "д", hint: "сердце — сердечный" },
        ],
      },
      {
        slug: "tipy-teksta",
        title: "Типы текста: описание, повествование, рассуждение",
        fgosRef: "Развитие речи. Типы текста",
        examples: [
          { text: "Какой это тип текста: «Снег покрыл землю. Мороз сковал реку.»", answer: "повествование" },
          { text: "Приведите пример текста-описания", answer: "«Река широкая и глубокая, берега песчаные.»" },
        ],
      },
    ],
  },
  {
    num: 4,
    title: "4 класс",
    topics: [
      {
        slug: "sklonenie-prilagatelnykh",
        title: "Склонение прилагательных",
        examples: [
          { text: "Согласуйте прилагательное с существительным в предложном падеже: на (большой) доме — ____", answer: "на большом доме", hint: "предложный падеж: большом доме" },
          { text: "Согласуйте прилагательное с существительным: на (дальний) поляне — ____", answer: "на дальней поляне", hint: "предложный падеж: дальней поляне" },
        ],
      },
      {
        slug: "myagkiy-znak-posle-shipyashchikh",
        title: "Мягкий знак",
        fgosRef: "Орфография. Мягкий знак: перед гласной в середине слова и в конце слова",
        examples: [
          { text: "Вставьте ь в середине слова перед гласной: л_ижи, д_т_ли, ст_ул_ья, п_л_тье", answer: "лижи, дети, стулья, платье" },
          { text: "Вставьте ь в конце слова: ноч_, ключ_, рож_, мыш_", answer: "ночь, ключ, рожь, мышь" },
          { text: "В каких словах ь не пишется? Запишите эти слова без мягкого знака: врач, луч, ландыш, ночь", answer: "врач, луч, ландыш", hint: "ь пишется не после каждой шипящей: в словах врач и луч мягкий знак не нужен" },
        ],
      },
      {
        slug: "skazuemoe-i-podlezhaschee",
        title: "Подлежащее и сказуемое",
        examples: [
          { text: "Найдите подлежащее: Утром взошло солнце.", answer: "солнце" },
          { text: "Найдите сказуемое: Дети весело играли во дворе.", answer: "играли" },
        ],
      },
      {
        slug: "glagol-spryazhenie",
        title: "Глагол. Спряжение",
        fgosRef: "Морфология. Глагол. Спряжение",
        examples: [
          { text: "Вставьте букву: пиш__т", answer: "пишут", hint: "пишут: глагол оканчивается на -ут/-ют и не на -ить → I спряжение" },
          { text: "Определите спряжение: писать, смотреть, говорить, стоять", answer: "1 спр., 2 спр., 2 спр., 2 спр.", hint: "I спряжение — глаголы на -ить (кроме бить, лить, шить и др.), II спряжение — остальные" },
        ],
      },
      {
        slug: "pravopisanie-suffiksov-4",
        title: "Правописание суффиксов -ик- и -ек-",
        examples: [
          { text: "Вставьте букву: ключ_к (нет ключ_ка) — замоч_к (нет замоч_ка) — горош_к (нет горош_ка)", answer: "ключик, замочек, горошек; правило: -ик, если во всех формах гласная, -ек — иначе" },
          { text: "Выберите верный вариант: ключик / ключок", answer: "ключик", hint: "во всех формах гласная: ключи, ключам" },
        ],
      },
    ],
  },
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "odnorodnye-chleny",
        title: "Однородные члены предложения",
        fgosRef: "Синтаксис. Однородные члены предложения",
        examples: [
          { text: "Расставьте запятые: В корзине лежали яблоки груши и сливы.", answer: "запятые не нужны", hint: "однородные существительные одного рода, с одинаковыми окончаниями и без прилагательных" },
          { text: "Расставьте запятые: В корзине лежали яблоки, груши и сливы. Дома стояли старая чашка, блюдо и синяя кастрюля.", answer: "Дома стояли старая чашка, блюдо и синяя кастрюля.", hint: "в первом предложении запятые не нужны, во втором — нужны: есть прилагательные разных форм" },
          { text: "Подчеркните однородные члены: Дети собирали грибы и ягоды.", answer: "грибы, ягоды" },
        ],
      },
      {
        slug: "orfografiya-korney",
        title: "Чередующиеся гласные в корне",
        examples: [
          { text: "Вставьте букву: р…стение", answer: "а", hint: "растение — растёт, росток" },
          { text: "Вставьте букву: к…саться", answer: "а", hint: "касаться — касается" },
          { text: "Вставьте букву: з…рница", answer: "а", hint: "зарница — зарево" },
        ],
      },
      {
        slug: "tipy-svyazi-v-slovosochetanii",
        title: "Типы связи слов в словосочетании",
        examples: [
          { text: "Определите тип связи: читать книгу", answer: "управление" },
          { text: "Определите тип связи: очень громкий", answer: "согласование" },
        ],
      },
      {
        slug: "sinonimy-i-antonimy",
        title: "Синонимы и антонимы",
        examples: [
          { text: "Подберите синоним к слову «большой»", answer: "огромный, крупный, гигантский" },
          { text: "Подберите антоним к слову «смелый»", answer: "трусливый" },
        ],
      },
      {
        slug: "imya-prilagatelnoe-5",
        title: "Имя прилагательное (обобщение)",
        examples: [
          { text: "Укажите разряд: деревянный стол", answer: "относительное" },
          { text: "Укажите разряд: смелый человек", answer: "качественное" },
        ],
      },
      {
        slug: "imya-chislitelnoe-5",
        title: "Имя числительное",
        examples: [
          { text: "Какой разряд: пять? (количественное / порядковое)", answer: "количественное" },
          { text: "Просклоняйте: семь книг — Р.п.", answer: "семи книг" },
        ],
      },
      {
        slug: "mestoimenie-5",
        title: "Местоимение. Личные местоимения",
        examples: [
          { text: "Определите лицо: ты, вы, мы", answer: "ты — 2-е ед., вы — 2-е мн., мы — 1-е мн." },
          { text: "Замените существительное местоимением: Иван пошёл в школу.", answer: "Он пошёл в школу." },
        ],
      },
      {
        slug: "slozhnoe-predlozhenie-5",
        title: "Простое и сложное предложение",
        examples: [
          { text: "Простое или сложное: Светит солнце, и тает снег.", answer: "сложное (две основы)" },
          { text: "Найдите грамматические основы: Весна пришла, и птицы вернулись.", answer: "весна пришла; птицы вернулись" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "pristavki-pri-pre-pre",
        title: "Приставки ПРИ- и ПРЕ-",
        examples: [
          { text: "Вставьте букву: пр…открыть", answer: "и", hint: "приоткрыть = немного открыть" },
          { text: "Вставьте букву: пр…пятствие", answer: "е", hint: "препятствие = то, что мешает (≈ очень)" },
        ],
      },
      {
        slug: "deyepricastie-i-deeprichastnyy-oborot",
        title: "Деепричастие. Деепричастный оборот",
        examples: [
          { text: "Найдите деепричастие: прыгая, прыгнул, прыжок", answer: "прыгая" },
          { text: "Расставьте запятые: Прочитав книгу я понял главное.", answer: "Прочитав книгу, я понял главное." },
        ],
      },
      {
        slug: "chislo-imyon-suschestvitelnykh",
        title: "Число имён существительных",
        examples: [
          { text: "Какие существительные имеют только форму единственного числа?", answer: "вещественные и абстрактные (молоко, сахар; дружба)" },
          { text: "Приведите пример существительного, которое имеет только множественное число", answer: "сани, ножницы, грабли" },
        ],
      },
      {
        slug: "stepeni-sravneniya",
        title: "Степени сравнения прилагательных и наречий",
        examples: [
          { text: "Образуйте сравнительную степень: красивый — __", answer: "красивее" },
          { text: "Образуйте превосходную степень: сильный — __", answer: "сильнейший" },
        ],
      },
      {
        slug: "mestoimenie-6",
        title: "Разряды местоимений",
        examples: [
          { text: "Какой разряд: мой?", answer: "притяжательное" },
          { text: "Какой разряд: никто?", answer: "отрицательное" },
        ],
      },
      {
        slug: "slozhnosochinennoe-predlozhenie",
        title: "Сложносочинённое предложение",
        examples: [
          { text: "Сколько грамматических основ в ССП: Сверкнула молния, и раздался гром.", answer: "2" },
          { text: "Расставьте запятые: Гремел гром и шёл дождь.", answer: "Гремел гром, и шёл дождь." },
        ],
      },
      {
        slug: "obosoblenie-opredeleniy",
        title: "Обособление определений",
        examples: [
          { text: "Расставьте запятые: Уставший после дороги отец присел отдохнуть.", answer: "Уставший после дороги, отец присел отдохнуть." },
          { text: "Обособляется ли определение, стоящее после определяемого слова?", answer: "да" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "prichastie-i-prichastnyy-oborot",
        title: "Причастие. Причастный оборот",
        examples: [
          { text: "Найдите причастие: бегущий, бег, бегать", answer: "бегущий" },
          { text: "Расставьте запятые: Солнце освещавшее поля поднялось выше.", answer: "Солнце, освещавшее поля, поднялось выше." },
        ],
      },
      {
        slug: "prichastie-kak-chast-rechi",
        title: "Н и НН в суффиксах причастий",
        examples: [
          { text: "Вставьте Н или НН: реше_ая задача", answer: "нн", hint: "полное страдательное причастие с приставкой" },
          { text: "Вставьте Н или НН: варё_ое яйцо", answer: "н", hint: "исключение: варёный, жареный, кованый" },
        ],
      },
      {
        slug: "naritsanie",
        title: "Наречие. Смысловые группы",
        examples: [
          { text: "Определите группу: очень быстро", answer: "наречие меры и степени" },
          { text: "Подберите наречие к глаголу: читать __", answer: "громко, медленно, внимательно" },
        ],
      },
      {
        slug: "kategoriya-sostoyaniya",
        title: "Категория состояния (слова состояния)",
        examples: [
          { text: "Найдите слово категории состояния: нельзя, можно, жаль", answer: "все три — слова категории состояния" },
          { text: "От какой части речи отличаются слова категории состояния?", answer: "от наречий (не изменяются и не относятся к глаголу, а обозначают состояние)" },
        ],
      },
      {
        slug: "slozhnopodchinennye-predlozheniya",
        title: "Сложноподчинённые предложения",
        examples: [
          { text: "Найдите главное и придаточное: Я знаю, что ты придёшь.", answer: "главное: Я знаю; придаточное: что ты придёшь" },
          { text: "Определите тип придаточного: Где мы встретимся, решим завтра.", answer: "придаточное места" },
        ],
      },
      {
        slug: "tip-prilagodnovo-v-spp",
        title: "Типы придаточных в СПП",
        examples: [
          { text: "Определите тип придаточного: Я знаю, что он придёт.", answer: "придаточное изъяснительное" },
          { text: "Определите тип: Дом, который стоит на углу, наш.", answer: "придаточное определительное" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "obstoyatelstvo",
        title: "Обособленные обстоятельства",
        examples: [
          { text: "Расставьте запятые: Несмотря на дождь мы вышли из дома.", answer: "Несмотря на дождь, мы вышли из дома." },
          { text: "Обособляется ли деепричастный оборот?", answer: "да, всегда обособляется" },
        ],
      },
      {
        slug: "slozhnoe-predlozhenie",
        title: "Сложноподчинённое предложение",
        examples: [
          { text: "Определите тип придаточного: Я знаю, что он придёт.", answer: "придаточное изъяснительное" },
          { text: "Найдите придаточное определительное: Книга, которую я читаю, интересная.", answer: "которую я читаю (придаточное определительное)" },
        ],
      },
      {
        slug: "obosoblenie-prilozheniy",
        title: "Обособление приложений",
        examples: [
          { text: "Расставьте запятые: Мой друг студент живёт в Москве.", answer: "Мой друг, студент, живёт в Москве." },
          { text: "Когда приложение обособляется?", answer: "когда стоит после определяемого слова или имеет дополнительное обстоятельственное значение" },
        ],
      },
      {
        slug: "vvodnye-slova",
        title: "Вводные слова и предложения",
        examples: [
          { text: "Расставьте запятые: Кажется скоро пойдёт дождь.", answer: "Кажется, скоро пойдёт дождь." },
          { text: "Чем отличаются вводные слова от членов предложения?", answer: "вводные слова не являются членами предложения" },
        ],
      },
      {
        slug: "pryamaya-i-kosvennaya-rech",
        title: "Прямая и косвенная речь",
        examples: [
          { text: "Переведите в косвенную речь: Он сказал: «Я учусь в школе».", answer: "Он сказал, что учится в школе." },
          { text: "Поставьте знаки препинания: Мама сказала я иду в школу", answer: "Мама сказала: «Я иду в школу»." },
        ],
      },
      {
        slug: "tire-v-prostom-predlozhenii",
        title: "Тире в простом предложении",
        examples: [
          { text: "Когда ставится тире между подлежащим и сказуемым?", answer: "когда оба выражены существительными или один — существительное, другой — числительное" },
          { text: "Расставьте знаки: Жизнь это движение.", answer: "Жизнь — это движение." },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "slozhnye-predlozheniya-s-raznymi-vidami-svyazi",
        title: "Сложные предложения с разными видами связи",
        examples: [
          { text: "Определите вид связи: Когда солнце взошло, лес, который спал всю ночь, ожил.", answer: "сочинительная + подчинительная" },
          { text: "Сколько грамматических основ в этом предложении?", answer: "3" },
        ],
      },
      {
        slug: "yazykovye-sredstva-svyazi",
        title: "Языковые средства связи предложений",
        examples: [
          { text: "Какое средство связи соединяет предложения «В доме было тепло. Я закрыл окно.»?", answer: "союз «но» (контраст)", hint: "смысловой — противопоставление" },
          { text: "Какое средство связи: «Утром мы пошли в лес. Там было тихо.»", answer: "наречие (там)" },
        ],
      },
      {
        slug: "publicisticheskiy-stil",
        title: "Публицистический стиль",
        examples: [
          { text: "Жанр публицистического стиля, где журналист едет на место события и описывает, — как он называется?", answer: "репортаж" },
          { text: "Какова цель публицистического стиля?", answer: "воздействовать на читателя, привлечь внимание к проблеме" },
        ],
      },
      {
        slug: "nauchnyy-stil",
        title: "Научный стиль",
        examples: [
          { text: "Жанр научного стиля, в котором автор защищает исследование перед комиссией, — как он называется?", answer: "диссертация" },
          { text: "Какие особенности научного стиля?", answer: "точность, логичность, объективность, терминология" },
        ],
      },
      {
        slug: "ofitsialno-delovoy-stil",
        title: "Официально-деловой стиль",
        examples: [
          { text: "Документ, который подают на имя руководителя с просьбой о предоставлении отпуска, — как он называется?", answer: "заявление" },
          { text: "Какие особенности официально-делового стиля?", answer: "точность, стандартизация, отсутствие эмоциональности" },
        ],
      },
      {
        slug: "sredstva-vyrazitelnosti",
        title: "Средства выразительности: эпитет, метафора, олицетворение",
        examples: [
          { text: "Найдите эпитет: золотая осень", answer: "золотая" },
          { text: "Найдите метафору: ветер гонит тучи", answer: "гонит" },
        ],
      },
      {
        slug: "podgotovka-k-oge-rus",
        title: "Подготовка к ОГЭ. Сжатое изложение",
        examples: [
          { text: "Сформулируйте главную мысль текста в одном предложении (сжатое изложение).", answer: "Главная мысль выражена одним предложением без второстепенных деталей" },
          { text: "Какие приёмы сжатия текста ты знаешь?", answer: "исключение, обобщение, упрощение" },
        ],
      },
    ],
  },
];

// ====================== ЛИТЕРАТУРА ======================

const literatureGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "ustnoe-narodnoe",
        title: "Устное народное творчество: сказки, пословицы, загадки, былины",
        fgosRef: "Фольклор",
        examples: [
          { text: "Какие жанры устного народного творчества вы изучаете в 5 классе?", answer: "сказки, пословицы, загадки, былины." },
          { text: "Что такое пословица?", answer: "краткое народное изречение с поучением." },
          { text: "Главный герой русских былин — кто?", answer: "Илья Муромец." },
        ],
      },
      {
        slug: "pushkin-i-lyrmonov",
        title: "А.С. Пушкин. Стихотворения и М.Ю. Лермонтов. «Казачья колыбельная песня»",
        examples: [
          { text: "Что происходит в стихотворении Пушкина «Зимний вечер»?", answer: "метель заметает следы волков, и рассказчик не может найти дорогу домой." },
          { text: "Кто автор стихотворения «Бородино»?", answer: "М.Ю. Лермонтов." },
          { text: "Кто в стихотворении «Бородино» рассказывает о сражении с французами?", answer: "старый солдат-ополченец." },
          { text: "О чём стихотворение «Казачья колыбельная песня»?", answer: "о матери, которая убаюкивает сына и оплакивает его гибель." },
        ],
      },
      {
        slug: "tolstoy-5",
        title: "Н. А. Некрасов. Стихотворения",
        examples: [
          { text: "Какой поэт написал стихотворение «Железная дорога»?", answer: "Н. А. Некрасов." },
          { text: "Что такое «образ» в поэзии Некрасова?", answer: "конкретный предмет или явление, названное поэтом, чтобы передать отношение к нему." },
        ],
      },
      {
        slug: "griboedov-krylov",
        title: "Басни И.А. Крылова",
        examples: [
          { text: "Автор басни «Стрекоза и Муравей» — кто?", answer: "И.А. Крылов." },
          { text: "О чём басня «Стрекоза и Муравей»?", answer: "о том, что без совместного труда и взаимной помощи всем плохо." },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "gogol-revizor",
        title: "Н.В. Гоголь. «Петербургские повести»",
        examples: [
          { text: "В какой повести Н.В. Гоголя рассказано о чиновнике Очкуеве?", answer: "в повести «Невский проспект»." },
          { text: "Чем «Петербургские повести» отличаются от поэмы «Мёртвые души»?", answer: "это сборник повестей, а «Мёртвые души» — поэма." },
        ],
      },
      {
        slug: "pushkin-proza",
        title: "А.С. Пушкин. «Повести Белкина» — «Барышня-крестьянка», «Метель»",
        examples: [
          { text: "О чём повесть «Метель»?", answer: "о любви Бурмина и Марьи и о том, что верность и воля сильнее выгоды." },
        ],
      },
      {
        slug: "turgenev-belkin",
        title: "И.С. Тургенев. «Муму», рассказы цикла «Записки охотника»",
        examples: [
          { text: "Главный герой рассказа «Муму» — кто?", answer: "Герасим." },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "pushkin-poetry",
        title: "А.С. Пушкин. Лирика. «Медный всадник»",
        examples: [
          { text: "Кому посвящён «Памятник» Пушкина?", answer: "самому поэту — символ вечного искусства." },
        ],
      },
      {
        slug: "lermontov-proza",
        title: "М.Ю. Лермонтов. «Песня про купца Калашникова», «Мцыри»",
        examples: [
          { text: "Главный герой поэмы «Мцыри» — кто?", answer: "молодой горец, выросший в монастыре." },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "tolstoy-vojna-i-mir",
        title: "Л.Н. Толстой. Роман-эпопея «Война и мир»",
        examples: [
          { text: "Кто автор теории «непротивления злу насилием»?", answer: "Л.Н. Толстой." },
          { text: "Какие три семьи стали главными в романе «Война и мир»?", answer: "Болконских, Ростовых и Безуховых." },
        ],
      },
      {
        slug: "dostoevsky",
        title: "Ф.М. Достоевский. «Преступление и наказание»",
        examples: [
          { text: "Главный герой «Преступления и наказания» — кто?", answer: "Родион Раскольников." },
          { text: "Какая теория лежит в основе поступка Раскольникова?", answer: "теория «о праве сильной личности» (разрешено всё, если ты выше других)." },
        ],
      },
      {
        slug: "pushkin-kapitan",
        title: "А.С. Пушкин «Капитанская дочка»",
        examples: [
          { text: "Главный герой «Капитанской дочки» — кто?", answer: "Пётр Гринёв." },
          { text: "Какой исторический период описывается?", answer: "восстание Емельяна Пугачёва 1773–1775 гг." },
        ],
      },
      {
        slug: "lermontov-geroy",
        title: "М.Ю. Лермонтов. «Герой нашего времени»",
        examples: [
          { text: "Главный герой романа «Герой нашего времени» — кто?", answer: "Григорий Печорин." },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "serebryanyy-vek",
        title: "Серебряный век русской поэзии: Блок, Есенин, Маяковский, Ахматова, Цветаева",
        examples: [
          { text: "Какие поэты относятся к Серебряному веку?", answer: "А. Блок, С. Есенин, В. Маяковский, А. Ахматова, М. Цветаева, Н. Гумилёв." },
          { text: "Кто написал поэму «Анафема»?", answer: "А. Ахматова." },
          { text: "В каком году вышла поэма Блока «Двенадцать»?", answer: "в 1918 году." },
        ],
      },
      {
        slug: "gogol-poema",
        title: "Н.В. Гоголь. «Мёртвые души». Поэма",
        examples: [
          { text: "Сколько мёртвых душ купил Чичиков в первом томе поэмы?", answer: "4 — у Собакевича и Ноздрёва по две." },
        ],
      },
      {
        slug: "ostrovsky-drama",
        title: "А.Н. Островский. «Гроза» — социально-бытовая драма",
        examples: [
          { text: "Главная героиня «Грозы» — кто?", answer: "Катерина Кабанова." },
          { text: "Куда уходит Катерина после сцены покаяния?", answer: "на берег Волги (бросается в воду)." },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "goncharov-obryv",
        title: "И.А. Гончаров «Обломов». Образ Обломова",
        examples: [
          { text: "Что такое «обломовщина»?", answer: "апатия, лень, бездеятельность и показная пассивность." },
        ],
      },
      {
        slug: "turgenev-otcy",
        title: "И.С. Тургенев. «Отцы и дети» — роман нигилиста Базарова",
        examples: [
          { text: "Главный герой «Отцов и детей» — кто?", answer: "Евгений Базаров." },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "tolstoy-i-dostoevsky",
        title: "Л.Н. Толстой и Ф.М. Достоевский — вершины русской прозы",
        examples: [
          { text: "Какое произведение Толстого названо «эпопеей»?", answer: "«Война и мир»." },
        ],
      },
      {
        slug: "sholokhov",
        title: "М.А. Шолохов. «Тихий Дон» — роман о казачестве",
        examples: [
          { text: "Главный герой «Тихого Дона» — кто?", answer: "Григорий Мелехов." },
        ],
      },
    ],
  },
];

// ====================== АНГЛИЙСКИЙ ЯЗЫК (2–9, Школа России / Spotlight) ======================

const englishGrades: Grade[] = [
  {
    num: 2,
    title: "2 класс",
    topics: [
      {
        slug: "alphabet-letters",
        title: "Алфавит и транскрипция",
        examples: [
          { text: "Произнесите: cat, dog, fish", answer: "[kæt], [dɒɡ], [fɪʃ]" },
          { text: "Какая буква в алфавите идёт после D?", answer: "E" },
        ],
      },
      {
        slug: "animals-vocabulary",
        title: "Животные. Лексика",
        examples: [
          { text: "Переведите на английский: кошка, собака, птица", answer: "cat, dog, bird" },
          { text: "Напишите по-английски: a bear and a fox", answer: "медведь и лиса (перевод на русский)" },
        ],
      },
      {
        slug: "colors-and-numbers",
        title: "Цвета и числа 1–10",
        examples: [
          { text: "Переведите: красный, синий, зелёный", answer: "red, blue, green" },
          { text: "Запишите по-английски: 1, 5, 10", answer: "one, five, ten" },
        ],
      },
      {
        slug: "family-members",
        title: "Семья. Лексика",
        examples: [
          { text: "Переведите: мама, папа, брат, сестра", answer: "mother / mum, father / dad, brother, sister" },
          { text: "Заполните пропуск: My ___ is a teacher. (mother/father)", answer: "mother (или father, по смыслу)" },
        ],
      },
      {
        slug: "clothes-vocabulary",
        title: "Одежда. Лексика",
        fgosRef: "Лексика. Одежда",
        examples: [
          { text: "Переведите на английский: платье, рубашка, брюки", answer: "dress, shirt, trousers" },
          { text: "Подберите слово: I wear a ___ on my head. (cap / table / door)", answer: "cap" },
          { text: "Вставьте артикль: I want ___ jacket, please.", answer: "a" },
        ],
      },
    ],
  },
  {
    num: 3,
    title: "3 класс",
    topics: [
      {
        slug: "present-simple-beginner",
        title: "Present Simple (начальный уровень)",
        fgosRef: "Грамматика: Present Simple",
        examples: [
          { text: "Раскройте скобки: She (go) to school every day.", answer: "goes" },
          { text: "Поставьте глагол в нужную форму: They (play) football.", answer: "play" },
          { text: "Подберите форму глагола: I ___ (have) a cat.", answer: "have" },
        ],
      },
      {
        slug: "present-continuous",
        title: "Present Continuous",
        examples: [
          { text: "Раскройте скобки: I (read) a book now.", answer: "am reading" },
          { text: "Поставьте глагол: Look! She (swim).", answer: "is swimming" },
          { text: "What ___ you (do) now?", answer: "are ... doing" },
        ],
      },
      {
        slug: "modal-can-cant",
        title: "Модальный глагол can / can’t",
        examples: [
          { text: "Переведите: Я умею плавать.", answer: "I can swim." },
          { text: "Сделайте отрицательным: She can dance.", answer: "She can’t dance." },
        ],
      },
      {
        slug: "school-things",
        title: "Школьные принадлежности",
        examples: [
          { text: "Переведите: ручка, карандаш, линейка, тетрадь", answer: "pen, pencil, ruler, copybook / notebook" },
          { text: "Подберите слово: I write with a __.", answer: "pen" },
        ],
      },
      {
        slug: "weather-vocabulary",
        title: "Погода. Времена года",
        examples: [
          { text: "Переведите: солнечно, дождливо, холодно", answer: "sunny, rainy, cold" },
          { text: "Вставьте слово: It ___ (snowing) today.", answer: "is snowing" },
        ],
      },
    ],
  },
  {
    num: 4,
    title: "4 класс",
    topics: [
      {
        slug: "past-simple",
        title: "Past Simple",
        examples: [
          { text: "Раскройте скобки: I (see) a film yesterday.", answer: "saw" },
          { text: "Поставьте в Past Simple: They (go) to the park.", answer: "went" },
          { text: "Did you ___ (play) tennis last Sunday?", answer: "play (в вопросе)" },
        ],
      },
      {
        slug: "irregular-verbs",
        title: "Неправильные глаголы",
        examples: [
          { text: "Напишите три формы: go — ___ — ___", answer: "go — went — gone" },
          { text: "Выберите правильную форму: I ___ (buy) a book yesterday.", answer: "bought" },
        ],
      },
      {
        slug: "articles-a-an-the",
        title: "Артикли a / an / the",
        examples: [
          { text: "Вставьте артикль: I see ___ apple on the table.", answer: "an" },
          { text: "Вставьте артикль: ___ sun is bright today.", answer: "The" },
        ],
      },
      {
        slug: "comparatives-superlatives",
        title: "Степени сравнения прилагательных",
        examples: [
          { text: "Образуйте сравнительную степень: big — ___", answer: "bigger" },
          { text: "Образуйте превосходную степень: happy — ___", answer: "the happiest" },
        ],
      },
      {
        slug: "plural-nouns",
        title: "Множественное число существительных",
        examples: [
          { text: "Образуйте множественное число: child — ___", answer: "children" },
          { text: "Образуйте множественное число: box — ___", answer: "boxes" },
        ],
      },
    ],
  },
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "future-simple",
        title: "Future Simple (will)",
        examples: [
          { text: "Раскройте скобки: I (call) you tomorrow.", answer: "will call" },
          { text: "Will / Be going to: We (visit) Grandma next Sunday. (plan)", answer: "are going to visit" },
          { text: "Сделайте отрицательным: She will dance.", answer: "She won’t dance." },
        ],
      },
      {
        slug: "present-perfect-intro",
        title: "Present Perfect: введение",
        examples: [
          { text: "Раскройте скобки: I (already / eat) lunch.", answer: "have already eaten" },
          { text: "Вставьте ever или never: Have you ___ been to Paris?", answer: "ever" },
        ],
      },
      {
        slug: "modal-must-should",
        title: "Модальные глаголы must / should",
        examples: [
          { text: "Переведите: Ты должен делать домашнюю работу.", answer: "You must do your homework." },
          { text: "Дайте совет: I have a headache.", answer: "You should take a pill. / You should see a doctor." },
        ],
      },
      {
        slug: "there-is-there-are",
        title: "Конструкция There is / There are",
        examples: [
          { text: "Переведите: В классе 30 учеников.", answer: "There are 30 students in the classroom." },
          { text: "Сделайте отрицательным: There is a book on the table.", answer: "There isn’t a book on the table." },
        ],
      },
      {
        slug: "ordinal-numbers",
        title: "Порядковые числительные",
        examples: [
          { text: "Напишите порядковое числительное: 1 — ___ (first/five?)", answer: "first" },
          { text: "Заполните пропуск: Today is the ___ of March. (5)", answer: "fifth" },
        ],
      },
      {
        slug: "prepositions-place-time",
        title: "Предлоги места и времени",
        examples: [
          { text: "Вставьте предлог: I live ___ Russia. (in/on/at)", answer: "in" },
          { text: "Вставьте предлог: We have English ___ Monday. (in/on/at)", answer: "on" },
        ],
      },
      {
        slug: "much-many-a-lot-of",
        title: "Much / many / a lot of",
        examples: [
          { text: "Вставьте much или many: There are ___ books on the shelf.", answer: "many" },
          { text: "Вставьте much или many: I don’t have ___ money.", answer: "much" },
        ],
      },
      {
        slug: "hobbies-vocabulary",
        title: "Хобби и увлечения. Лексика",
        examples: [
          { text: "Переведите: рисовать, читать, плавать, танцевать", answer: "to draw, to read, to swim, to dance" },
          { text: "Заполните пропуск: My hobby is ___. (чтение / reading)", answer: "reading" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "present-perfect",
        title: "Present Perfect (углублённо)",
        examples: [
          { text: "Раскройте скобки: I (never / be) to London.", answer: "have never been" },
          { text: "Ever / Never: ___ you have visited Paris?", answer: "Have ... ever" },
          { text: "Сравните: I ___ (already / read) this book. (Present Perfect)", answer: "have already read" },
        ],
      },
      {
        slug: "past-simple-vs-present-perfect",
        title: "Past Simple vs Present Perfect",
        examples: [
          { text: "Выберите правильное время: I ___ (see) this film last week.", answer: "saw (Past Simple — есть указание на прошлое)" },
          { text: "Выберите правильное время: I ___ (never / see) this film.", answer: "have never seen (Present Perfect — опыт)" },
        ],
      },
      {
        slug: "comparative-constructions",
        title: "Конструкции as … as / not as … as",
        examples: [
          { text: "Переведите: Он такой же высокий, как его брат.", answer: "He is as tall as his brother." },
          { text: "Сделайте отрицательным: She is as clever as her sister.", answer: "She isn’t as clever as her sister." },
        ],
      },
      {
        slug: "modal-should-ought",
        title: "Модальный глагол should / ought to",
        examples: [
          { text: "Дайте совет другу: You look tired.", answer: "You should rest. / You ought to rest." },
          { text: "Сделайте отрицательным: You should eat so much.", answer: "You shouldn’t eat so much." },
        ],
      },
      {
        slug: "question-types",
        title: "Типы вопросов: general, special, tag",
        examples: [
          { text: "Задайте общий вопрос: She is a teacher.", answer: "Is she a teacher?" },
          { text: "Задайте вопрос к подлежащему: ___ (что?) is on the table?", answer: "What is on the table?" },
          { text: "Переведите разделительный вопрос: Он студент, не так ли?", answer: "He is a student, isn’t he?" },
        ],
      },
      {
        slug: "few-little-a-little",
        title: "Few / little / a few / a little",
        examples: [
          { text: "Вставьте few или little: I have ___ friends in this city. (исчисл.)", answer: "few (мало)" },
          { text: "Вставьте few или little: There is ___ milk in the cup. (неисчисл.)", answer: "little" },
        ],
      },
      {
        slug: "appearance-vocabulary",
        title: "Внешность. Лексика",
        examples: [
          { text: "Переведите: высокий, низкий, худой, полный", answer: "tall, short, thin, fat / plump" },
          { text: "Опишите внешность: She has ___ (длинные) hair.", answer: "long" },
        ],
      },
      {
        slug: "professions-vocabulary",
        title: "Профессии. Лексика",
        examples: [
          { text: "Переведите: врач, учитель, инженер", answer: "doctor, teacher, engineer" },
          { text: "Заполните пропуск: A ___ helps sick people.", answer: "doctor" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "conditionals-type-1-2",
        title: "Conditionals Type 1 & 2",
        examples: [
          { text: "Поставьте в Conditional I: If it (rain), we (stay) at home.", answer: "rains / will stay" },
          { text: "Поставьте в Conditional II: If I (be) a bird, I (fly) to you.", answer: "were / would fly" },
          { text: "Переведите в Conditional I: Если будет солнечно, мы пойдём гулять.", answer: "If it is sunny, we will go for a walk." },
        ],
      },
      {
        slug: "reported-speech",
        title: "Reported Speech (косвенная речь)",
        examples: [
          { text: "Переведите в косвенную речь: He said: \"I am tired.\"", answer: "He said (that) he was tired." },
          { text: "Преобразуйте: She said: \"I like coffee.\"", answer: "She said (that) she liked coffee." },
        ],
      },
      {
        slug: "past-continuous",
        title: "Past Continuous",
        examples: [
          { text: "Раскройте скобки: I (read) a book at 5 p.m. yesterday.", answer: "was reading" },
          { text: "Вставьте глагол: While she (cook), the phone rang.", answer: "was cooking" },
        ],
      },
      {
        slug: "past-perfect",
        title: "Past Perfect",
        examples: [
          { text: "Раскройте скобки: He (already / leave) when I came.", answer: "had already left" },
          { text: "Объясните разницу Past Perfect и Past Simple на примере", answer: "Past Perfect — действие, случившееся раньше другого прошлого действия" },
        ],
      },
      {
        slug: "passive-simple",
        title: "Passive Voice (Present/Past Simple)",
        examples: [
          { text: "Сделайте пассивным: They built a new school.", answer: "A new school was built." },
          { text: "Сделайте пассивным: Someone stole my bike.", answer: "My bike was stolen." },
        ],
      },
      {
        slug: "phrasal-verbs-get",
        title: "Фразовые глаголы (get)",
        examples: [
          { text: "Переведите: get up", answer: "вставать, подниматься" },
          { text: "Вставьте: I always ___ (get on / get off) the bus at school.", answer: "get off (выхожу)" },
        ],
      },
      {
        slug: "prepositions-for-since",
        title: "Предлоги for / since",
        examples: [
          { text: "Вставьте for или since: I have lived here ___ 2015.", answer: "since" },
          { text: "Вставьте for или since: She has worked here ___ ten years.", answer: "for" },
        ],
      },
      {
        slug: "word-formation",
        title: "Словообразование: суффиксы и приставки",
        examples: [
          { text: "Образуйте существительное от happy: ___", answer: "happiness" },
          { text: "Образуйте глагол от слова decision: ___", answer: "to decide" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "passive-voice",
        title: "Passive Voice (все времена)",
        examples: [
          { text: "Сделайте пассивным: They built a new school.", answer: "A new school was built." },
          { text: "Сделайте пассивным: Someone stole my bike.", answer: "My bike was stolen." },
          { text: "Преобразуйте в Past Simple Passive: She writes poems.", answer: "Poems were written by her." },
        ],
      },
      {
        slug: "complex-object",
        title: "Complex Object (сложное дополнение)",
        examples: [
          { text: "Переведите: Я хочу, чтобы ты прочитал эту книгу.", answer: "I want you to read this book." },
          { text: "Используйте Complex Object: I saw him ___ (cross) the road.", answer: "cross" },
        ],
      },
      {
        slug: "mixed-conditionals",
        title: "Mixed Conditionals",
        examples: [
          { text: "Переведите в Mixed Conditional: Если бы я не был ленивым, я бы добился большего.", answer: "If I weren’t lazy, I would have achieved more." },
          { text: "Объясните смешанный тип условного", answer: "смешивает Conditionals 2 и 3 (нереалистичное условие в прошлом, результат в настоящем или наоборот)" },
        ],
      },
      {
        slug: "modal-perfect-infinitive",
        title: "Модальные глаголы с перфектным инфинитивом",
        examples: [
          { text: "Переведите: Он, должно быть, потерял ключ.", answer: "He must have lost the key." },
          { text: "Заполните: She ___ (could / could have) helped us, but she didn’t.", answer: "could have" },
        ],
      },
      {
        slug: "articles-advanced",
        title: "Артикли: систематизация",
        examples: [
          { text: "Вставьте артикль: ___ Mount Everest is the highest mountain.", answer: "не нужен (собственное имя)", hint: "собственные имена географических объектов употребляются без артикля" },
          { text: "Вставьте артикль: ___ honey is sweet.", answer: "не нужен (неисчисляемое)", hint: "неисчисляемые вещества (honey, sugar, milk) — без артикля" },
          { text: "Вставьте артикль: I saw ___ interesting film yesterday.", answer: "an" },
        ],
      },
      {
        slug: "linking-words",
        title: "Связующие слова (however, moreover, therefore)",
        examples: [
          { text: "Переведите: Он устал; тем не менее, он продолжил работать.", answer: "He was tired; however, he continued to work." },
          { text: "Вставьте: It was raining; ___, we stayed at home. (therefore)", answer: "therefore" },
        ],
      },
      {
        slug: "formal-informal-style",
        title: "Стили речи: формальный и неформальный",
        examples: [
          { text: "Перепишите формально: Hi, can you help me out?", answer: "Hello, could you please assist me?" },
          { text: "Выберите формальный вариант: wanna / would like", answer: "would like" },
        ],
      },
      {
        slug: "phrasal-verbs-advanced",
        title: "Фразовые глаголы (продвинутый уровень)",
        examples: [
          { text: "Переведите: put off", answer: "откладывать" },
          { text: "Переведите: give up", answer: "сдаваться, бросать" },
          { text: "Вставьте: Don’t ___ (give in / give up) — keep trying!", answer: "give up" },
        ],
      },
      {
        slug: "opinion-essay",
        title: "Эссе: opinion essay",
        examples: [
          { text: "Подберите вводную фразу для opinion essay", answer: "In my opinion, … / I believe that …" },
          { text: "Перечислите 3 элемента структуры opinion essay", answer: "вступление, основная часть (аргументы), заключение" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "complex-grammar",
        title: "Сложные грамматические конструкции (wish, would rather)",
        examples: [
          { text: "Выберите правильный вариант: I wish I ___ taller.", answer: "were" },
          { text: "Переведите: Жаль, что я не пошёл на вечеринку.", answer: "I wish I had gone to the party." },
          { text: "Переведите: Я бы предпочёл, чтобы мы остались дома.", answer: "I would rather we stayed at home." },
        ],
      },
      {
        slug: "all-tenses-system",
        title: "Все времена английского языка (систематизация)",
        examples: [
          { text: "Выберите правильное время: I ___ (already / finish) my homework. (Present Perfect)", answer: "have already finished" },
          { text: "Поставьте глагол в Past Continuous: We ___ (watch) TV at 8 p.m. yesterday.", answer: "were watching" },
        ],
      },
      {
        slug: "all-conditionals",
        title: "Условные предложения (все типы)",
        examples: [
          { text: "Определите тип: If I had studied harder, I would have passed the exam.", answer: "Conditional III (Past)" },
          { text: "Переведите в Mixed Conditional: Если бы я знала английский, я бы жила в Лондоне.", answer: "If I knew English, I would be living in London." },
        ],
      },
      {
        slug: "passive-all-tenses",
        title: "Passive Voice (все времена, углублённо)",
        examples: [
          { text: "Преобразуйте в Present Perfect Passive: They have written a new book.", answer: "A new book has been written." },
          { text: "Преобразуйте в Past Continuous Passive: When I came, they were painting the house.", answer: "When I came, the house was being painted." },
        ],
      },
      {
        slug: "modal-verbs-system",
        title: "Модальные глаголы (систематизация)",
        examples: [
          { text: "Выберите модальный глагол: You ___ drive without a license. (must / may / can — запрет)", answer: "must not / can’t" },
          { text: "Переведите: Возможно, он сейчас в школе.", answer: "He may be at school now." },
        ],
      },
      {
        slug: "sequence-of-tenses",
        title: "Согласование времён",
        examples: [
          { text: "Преобразуйте: He said: \"I am a student.\" → He said that he ___ a student.", answer: "was" },
          { text: "Преобразуйте: She said: \"I will come.\" → She said that she ___ come.", answer: "would" },
        ],
      },
      {
        slug: "punctuation-english",
        title: "Пунктуация в английском языке",
        examples: [
          { text: "Где нужна запятая: After dinner we played games.", answer: "After dinner, we played games." },
          { text: "Объясните правило: перед and в простом перечислении запятая не нужна", answer: "в коротких простых предложениях перед and запятая не ставится (Oxford comma — факультативно)" },
        ],
      },
      {
        slug: "oge-vocabulary-topics",
        title: "Лексика по темам ОГЭ",
        examples: [
          { text: "Переведите: окружающая среда", answer: "environment" },
          { text: "Подберите слово: My ___ is to become a doctor. (мечта / dream)", answer: "dream" },
        ],
      },
      {
        slug: "writing-letters-reviews",
        title: "Письмо: эссе, письмо, отзыв",
        examples: [
          { text: "Какая структура у личного письма?", answer: "обращение, вступление, основная часть (ответы на вопросы), завершающая фраза, подпись" },
          { text: "Переведите заключительную фразу: With love,", answer: "С любовью, …" },
        ],
      },
      {
        slug: "reading-strategies",
        title: "Чтение: стратегии работы с текстом",
        examples: [
          { text: "Что такое skimming?", answer: "чтение с целью понять основную мысль (просмотровое чтение)" },
          { text: "Что такое scanning?", answer: "чтение с целью найти конкретную информацию (поисковое чтение)" },
        ],
      },
      {
        slug: "speaking-monologue-dialogue",
        title: "Говорение: монолог и диалог",
        examples: [
          { text: "Сколько обычно длится ответ в задании ОГЭ «монолог»?", answer: "1–1,5 минуты" },
          { text: "Какие клише можно использовать в диалоге?", answer: "I think…, In my opinion…, On the one hand…, To be honest…" },
        ],
      },
    ],
  },
];

// ====================== ИНФОРМАТИКА ======================

const informaticsGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "computer-basics",
        title: "Устройство компьютера",
        fgosRef: "Цифровая грамотность",
        examples: [
          { text: "Что такое процессор?", answer: "устройство, выполняющее вычисления и управляющее работой компьютера" },
          { text: "Что такое оперативная память?", answer: "память для временного хранения данных во время работы" },
        ],
      },
      {
        slug: "informacia-edinicy",
        title: "Информация и единицы измерения (бит, байт, КБ, МБ, ГБ)",
        examples: [
          { text: "Сколько байт в 1 килобайте?", answer: "1024" },
          { text: "Переведи: 2 КБ = __ байт", answer: "2048" },
          { text: "Переведи: 1 ГБ = __ МБ", answer: "1024" },
        ],
      },
      {
        slug: "tipy-faylov",
        title: "Типы файлов и их расширения",
        examples: [
          { text: "Расширение .jpg означает:", answer: "изображение" },
          { text: "Файл .docx — это:", answer: "документ Microsoft Word" },
        ],
      },
      {
        slug: "paskaklassifikacia",
        title: "Классификация информации по разным признакам",
        examples: [
          { text: "По способу восприятия информация бывает:", answer: "визуальная, звуковая, тактильная, обонятельная, вкусовая" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "systemy-schisleniya",
        title: "Системы счисления: двоичная, восьмеричная, десятичная, шестнадцатеричная",
        examples: [
          { text: "Переведи 1010₂ в десятичную", answer: "10" },
          { text: "Переведи 255 в двоичную", answer: "11111111" },
          { text: "Переведи 16₁₆ в десятичную", answer: "22" },
        ],
      },
      {
        slug: "dvoichnaya-arifmetika",
        title: "Двоичная арифметика: сложение и вычитание",
        examples: [
          { text: "101₂ + 11₂ = __", answer: "1000₂" },
          { text: "110₂ − 101₂ = __", answer: "1₂" },
        ],
      },
      {
        slug: "kodirovanie-informacii",
        title: "Кодирование информации: ASCII, Unicode",
        examples: [
          { text: "Сколько символов в кодировке ASCII?", answer: "128" },
          { text: "Сколько байт занимает один символ в UTF-8?", answer: "от 1 до 4 (чаще 1–2)" },
        ],
      },
      {
        slug: "tekst-i-grafika",
        title: "Текстовые и графические форматы файлов",
        examples: [
          { text: "Разрешение изображения 1920×1080, глубина цвета 24 бита. Объём = __ байт", answer: "1920 × 1080 × 3 ≈ 6 220 800" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "algoritmy",
        title: "Алгоритмы: линейные, разветвляющиеся, циклические",
        examples: [
          { text: "Как называется алгоритм, в котором команды выполняются последовательно, без ветвлений и циклов?", answer: "линейный алгоритм" },
          { text: "Чем отличается цикл от ветвления?", answer: "цикл — повторение, ветвление — выбор одного из путей" },
          { text: "Какая структура описывает развилку в блок-схеме?", answer: "ромб" },
        ],
      },
      {
        slug: "osnovy-programmirovaniya-8",
        title: "Основы программирования: переменные, типы данных, условия",
        examples: [
          { text: "Переменная x хранит целое число. Тип данных:", answer: "int (целочисленный)" },
          { text: "Условие на Python: if x > 0 and x < 10:", answer: "x в диапазоне от 1 до 9" },
        ],
      },
      {
        slug: "modeli-i-obekty-8",
        title: "Модели и моделирование: модель объекта, типы моделей",
        examples: [
          { text: "Глобус — это модель чего?", answer: "Земли" },
          { text: "Какая модель точнее: словесная или математическая?", answer: "математическая (однозначное описание)" },
        ],
      },
      {
        slug: "algoritmicheskaya-konstrukciya-8",
        title: "Циклы с постусловием и предусловием. Массивы",
        examples: [
          { text: "До какого момента работает цикл while (x < 100)?", answer: "пока x не достигнет 100" },
          { text: "Массив A = [3, 7, 2, 9]. A[2] = __", answer: "2" },
        ],
      },
    ],
  },
];

// ====================== ФИЗИКА (7–9, Школа России / Перышкин) ======================

const physicsGrades: Grade[] = [
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "mekhanika",
        title: "Механическое движение. Скорость",
        fgosRef: "Механические явления",
        examples: [
          { text: "Автомобиль проехал 100 км за 2 часа. Скорость = __ км/ч", answer: "50" },
          { text: "Переведи: 36 км/ч = __ м/с", answer: "10" },
          { text: "Велосипедист едет со скоростью 15 км/ч. За 3 ч он проедет __ км", answer: "45" },
        ],
      },
      {
        slug: "srednyaya-skorost",
        title: "Средняя скорость неравномерного движения",
        examples: [
          { text: "Первые 2 ч тело двигалось 60 км/ч, следующие 2 ч — 40 км/ч. Средняя скорость = __ км/ч", answer: "50" },
          { text: "Путь 30 км пройден за 1,5 ч. Средняя скорость = __ км/ч", answer: "20" },
        ],
      },
      {
        slug: "inerciya-i-vzaimodeystvie",
        title: "Инерция. Взаимодействие тел",
        examples: [
          { text: "Когда автобус резко тормозит, пассажир наклоняется вперёд. Какое явление?", answer: "инерция" },
          { text: "Тело массой 2 кг движется со скоростью 3 м/с. Чему равна его инертность?", answer: "определяется массой (2 кг); при прочих равных тяжелее тело — сильнее инерция" },
        ],
      },
      {
        slug: "massa-i-plotnost",
        title: "Масса. Плотность вещества",
        examples: [
          { text: "Масса тела 300 г, объём 150 см³. Плотность = __ г/см³", answer: "2" },
          { text: "Плотность алюминия 2,7 г/см³. Объём тела 100 см³. Масса = __ г", answer: "270" },
          { text: "Сколько весит 2 л воды? ρ = 1000 кг/м³", answer: "2 кг" },
        ],
      },
      {
        slug: "sila-tyazhesti",
        title: "Сила тяжести. Вес тела. Невесомость",
        examples: [
          { text: "Чему равна сила тяжести, действующая на тело массой 5 кг? (g = 10 Н/кг)", answer: "50 Н" },
          { text: "Космонавт на орбите находится в состоянии __", answer: "невесомости" },
        ],
      },
      {
        slug: "sila-uprugosti-zakon-guka",
        title: "Сила упругости. Закон Гука",
        examples: [
          { text: "F = kx. k = 200 Н/м, x = 0,05 м. F = __ Н", answer: "10" },
          { text: "От каких величин зависит сила упругости?", answer: "от жёсткости тела и удлинения" },
        ],
      },
      {
        slug: "sila-treniya",
        title: "Сила трения",
        examples: [
          { text: "Какой вид трения возникает при качении колеса?", answer: "трение качения" },
          { text: "Зачем на обуви делают рифлёную подошву?", answer: "чтобы увеличить трение и не скользить" },
        ],
      },
      {
        slug: "davlenie-tverdykh-tel",
        title: "Давление твёрдых тел",
        examples: [
          { text: "p = F/S. F = 200 Н, S = 4 м². p = __ Па", answer: "50" },
          { text: "Зачем у гвоздей острие?", answer: "чтобы увеличить давление (уменьшить площадь опоры)" },
        ],
      },
      {
        slug: "davlenie-zhidkostey-i-gazov",
        title: "Давление в жидкости и газе. Закон Паскаля",
        examples: [
          { text: "p = ρgh. ρ = 1000 кг/м³, g = 10 Н/кг, h = 5 м. p = __ Па", answer: "50000" },
          { text: "Сформулируй закон Паскаля", answer: "давление, производимое на жидкость или газ, передаётся в любую точку одинаково во всех направлениях" },
        ],
      },
      {
        slug: "soobshchayushchiesya-sosudy",
        title: "Сообщающиеся сосуды",
        examples: [
          { text: "В каком сообщающемся сосуде уровень жидкости выше?", answer: "в обоих одинаково (при одной плотности)" },
          { text: "К одному концу U-образной трубки долили воду, к другому — керосин. Где уровень выше и почему?", answer: "уровень керосина выше, так как его плотность меньше" },
        ],
      },
      {
        slug: "atmosfernoe-davlenie",
        title: "Атмосферное давление. Опыт Торричелли",
        examples: [
          { text: "Чему равно нормальное атмосферное давление на уровне моря? (мм рт. ст.)", answer: "760 мм рт. ст." },
          { text: "Почему мы не чувствуем давления атмосферы?", answer: "оно уравновешивается внутренним давлением воздуха в организме" },
        ],
      },
      {
        slug: "arkhimedova-sila",
        title: "Архимедова сила. Плавание тел",
        examples: [
          { text: "Fₐ = ρgV. ρ = 1000 кг/м³, g = 10 Н/кг, V = 0,002 м³. Fₐ = __ Н", answer: "20" },
          { text: "Тело всплывает, если сила Архимеда __ силы тяжести", answer: "больше" },
          { text: "Утонет ли деревянный брусок (ρ = 500 кг/м³) в воде (ρ = 1000 кг/м³)?", answer: "нет, всплывёт, так как его плотность меньше плотности воды" },
        ],
      },
      {
        slug: "mekhanicheskaya-rabota",
        title: "Механическая работа",
        examples: [
          { text: "A = Fs. F = 50 Н, s = 4 м. A = __ Дж", answer: "200" },
          { text: "Какую работу совершает сила 10 Н, если тело под действием этой силы перемещается на 5 м?", answer: "50 Дж" },
        ],
      },
      {
        slug: "moshchnost",
        title: "Мощность",
        examples: [
          { text: "N = A/t. A = 100 Дж, t = 5 с. N = __ Вт", answer: "20" },
          { text: "Двигатель подъёмника за 10 с совершил работу 5000 Дж. Мощность = __ Вт", answer: "500" },
        ],
      },
      {
        slug: "prostye-mekhanizmy-rychag",
        title: "Простые механизмы. Рычаг. Момент силы",
        examples: [
          { text: "Короткое плечо рычага 20 см, длинное — 60 см. Груз 30 Н висит на длинном. Какую силу надо приложить к короткому для равновесия?", answer: "90 Н" },
          { text: "Дайте определение момента силы", answer: "произведение силы на её плечо (M = F·d)" },
        ],
      },
      {
        slug: "kpd-mekhanizma",
        title: "Коэффициент полезного действия",
        examples: [
          { text: "Полезная работа 80 Дж, затраченная 100 Дж. КПД = __ %", answer: "80" },
          { text: "КПД наклонной плоскости 60 %. Полезная работа 30 Дж. Затраченная = __ Дж", answer: "50" },
        ],
      },
      {
        slug: "energiya",
        title: "Кинетическая и потенциальная энергия",
        examples: [
          { text: "Камень массой 2 кг поднят на высоту 3 м. Его потенциальная энергия = __ Дж (g = 10)", answer: "60" },
          { text: "У какого тела больше кинетическая энергия: у движущегося автомобиля или у стоящего на месте?", answer: "у движущегося: кинетическая энергия тем больше, чем больше скорость (у стоящего она равна нулю)" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "teplovoe-dvizhenie-temperatura",
        title: "Тепловое движение. Температура",
        examples: [
          { text: "Какая физическая величина характеризует среднюю кинетическую энергию молекул?", answer: "температура" },
          { text: "Переведи 25 °C в Кельвины", answer: "298 K" },
        ],
      },
      {
        slug: "vnutrennyaya-energiya",
        title: "Внутренняя энергия",
        examples: [
          { text: "От чего зависит внутренняя энергия тела?", answer: "от температуры тела и его агрегатного состояния (массы)" },
          { text: "Как изменится внутренняя энергия газа при его сжатии без теплообмена?", answer: "увеличится (работа внешних сил переходит во внутреннюю энергию)" },
        ],
      },
      {
        slug: "teploperedacha-vidy",
        title: "Теплопередача. Виды теплопередачи",
        examples: [
          { text: "Какой вид теплопередачи происходит без переноса вещества?", answer: "излучение" },
          { text: "Что лучше передаёт тепло: металл или воздух?", answer: "металл (у металлов теплопроводность высокая, у воздуха — низкая)" },
        ],
      },
      {
        slug: "kolichestvo-teploty",
        title: "Количество теплоты. Удельная теплоёмкость",
        examples: [
          { text: "Q = cmΔT. m = 2 кг, c = 4000 Дж/(кг·°C), ΔT = 10°C. Q = __ Дж", answer: "80000" },
          { text: "Какой металл нагреется быстрее при одинаковом количестве теплоты: алюминий (c = 920) или медь (c = 400)?", answer: "медь — у неё удельная теплоёмкость меньше" },
        ],
      },
      {
        slug: "energiya-topliva",
        title: "Энергия топлива. Удельная теплота сгорания",
        examples: [
          { text: "Q = qm. q = 4,2·10⁷ Дж/кг, m = 0,5 кг. Q = __ Дж", answer: "2,1·10⁷" },
          { text: "Какое топливо выделяет больше теплоты на 1 кг: уголь (q ≈ 27 МДж/кг) или бензин (q ≈ 44 МДж/кг)?", answer: "бензин" },
        ],
      },
      {
        slug: "plavlenie-otverdevanie",
        title: "Плавление и отвердевание. Удельная теплота плавления",
        examples: [
          { text: "Какая температура плавления льда (при нормальном давлении)?", answer: "0 °C" },
          { text: "При плавлении температура кристаллического тела __", answer: "не меняется (остаётся постоянной)" },
        ],
      },
      {
        slug: "isparenie-kipenie",
        title: "Испарение, конденсация, кипение",
        examples: [
          { text: "При какой температуре кипит вода при нормальном давлении?", answer: "100 °C" },
          { text: "От чего зависит скорость испарения жидкости?", answer: "от температуры, площади поверхности, рода жидкости, наличия ветра" },
        ],
      },
      {
        slug: "vlazhnost-vozdukha",
        title: "Влажность воздуха",
        examples: [
          { text: "Каким прибором измеряют влажность воздуха?", answer: "гигрометром (психрометром)" },
          { text: "Если относительная влажность 100 %, что это значит?", answer: "воздух насыщен водяным паром, испарение прекращается" },
        ],
      },
      {
        slug: "rabota-teplovogo-dvigatelya",
        title: "Тепловые двигатели. КПД теплового двигателя",
        examples: [
          { text: "Назови три основных части любого теплового двигателя", answer: "нагреватель, рабочее тело (газ/пар), холодильник" },
          { text: "Какой двигатель стоит в большинстве легковых автомобилей?", answer: "двигатель внутреннего сгорания (ДВС)" },
        ],
      },
      {
        slug: "elektrizatsiya-tel",
        title: "Электризация тел. Два рода зарядов",
        examples: [
          { text: "Какого знака заряд появляется на стекле, натёртом шёлком?", answer: "положительный" },
          { text: "Одноимённые заряды __, разноимённые __", answer: "отталкиваются; притягиваются" },
        ],
      },
      {
        slug: "elektricheskoe-pole",
        title: "Электрическое поле. Строение атома",
        examples: [
          { text: "Из каких частиц состоит атом?", answer: "из ядра (протоны + нейтроны) и электронов" },
          { text: "Какой заряд у электрона?", answer: "отрицательный, e = −1,6·10⁻¹⁹ Кл" },
        ],
      },
      {
        slug: "elektricheskiy-tok",
        title: "Электрический ток. Источники тока",
        examples: [
          { text: "Какие условия необходимы для существования тока в цепи?", answer: "замкнутая цепь, источник тока, свободные носители заряда" },
          { text: "Назови 3 источника тока", answer: "батарейка (гальванический элемент), аккумулятор, генератор" },
        ],
      },
      {
        slug: "sila-toka-napryazhenie",
        title: "Сила тока и напряжение",
        examples: [
          { text: "I = q/t. q = 12 Кл, t = 4 с. I = __ А", answer: "3" },
          { text: "U = A/q. A = 220 Дж, q = 11 Кл. U = __ В", answer: "20" },
        ],
      },
      {
        slug: "zakon-oma",
        title: "Закон Ома для участка цепи. Сопротивление",
        examples: [
          { text: "I = U/R. U = 220 В, R = 110 Ом. I = __ А", answer: "2" },
          { text: "Какой формулой связаны сопротивление, длина и площадь поперечного сечения?", answer: "R = ρ·l/S (удельное сопротивление · длина / площадь)" },
        ],
      },
      {
        slug: "soedineniya-provodnikov",
        title: "Последовательное и параллельное соединения",
        examples: [
          { text: "Два резистора 2 Ом и 3 Ом соединены последовательно. Общее сопротивление = __ Ом", answer: "5" },
          { text: "Два резистора 6 Ом и 3 Ом соединены параллельно. Общее сопротивление = __ Ом", answer: "2" },
        ],
      },
      {
        slug: "rabota-moshchnost-toka",
        title: "Работа и мощность электрического тока",
        examples: [
          { text: "A = UIt. U = 220 В, I = 5 А, t = 60 с. A = __ Дж", answer: "66000" },
          { text: "P = UI. U = 220 В, I = 10 А. P = __ Вт", answer: "2200" },
        ],
      },
      {
        slug: "zakon-dzhoulya-lenca",
        title: "Закон Джоуля-Ленца",
        examples: [
          { text: "Q = I²Rt. I = 2 А, R = 10 Ом, t = 5 с. Q = __ Дж", answer: "200" },
          { text: "Зачем в электрических лампах используют тонкую вольфрамовую нить?", answer: "чтобы увеличить сопротивление и выделить много тепла для свечения" },
        ],
      },
      {
        slug: "elektromagnitnye-yavleniya",
        title: "Электромагниты. Электромагнитные явления",
        examples: [
          { text: "От чего зависит сила, с которой магнит притягивает железные предметы?", answer: "от магнитных свойств магнита и расстояния до предмета" },
          { text: "Как определить полюса катушки с током?", answer: "по правилу правой руки / буравчика: направление тока → направление магнитных линий → северный полюс там, где линии выходят" },
        ],
      },
      {
        slug: "svetovye-yavleniya",
        title: "Световые явления. Отражение и преломление света",
        examples: [
          { text: "Угол падения равен 30°. Чему равен угол отражения?", answer: "30°" },
          { text: "Луч переходит из воздуха в воду. Как изменяется его скорость?", answer: "уменьшается (среда оптически плотнее)" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "kinematika",
        title: "Кинематика. Равномерное движение",
        examples: [
          { text: "v = v₀ + at. v₀ = 0, a = 2 м/с², t = 5 с. v = __ м/с", answer: "10" },
          { text: "Какое движение называется равноускоренным?", answer: "с постоянным ускорением" },
          { text: "Запиши уравнение пути при равноускоренном движении", answer: "s = v₀t + at²/2" },
        ],
      },
      {
        slug: "otnositelnost-dvizheniya",
        title: "Относительность механического движения",
        examples: [
          { text: "Пассажир идёт по вагону со скоростью 1 м/с, поезд — 20 м/с. Чему равна скорость пассажира относительно земли (по направлению движения поезда)?", answer: "21 м/с" },
          { text: "Что такое система отсчёта?", answer: "тело отсчёта + система координат + часы, относительно которых задаётся положение тела" },
        ],
      },
      {
        slug: "dvizhenie-po-okruzhnosti",
        title: "Движение по окружности",
        examples: [
          { text: "T = 2 с, R = 1 м. Скорость = __ м/с (π ≈ 3)", answer: "3" },
          { text: "Как направлено ускорение при равномерном движении по окружности?", answer: "к центру окружности (центростремительное)" },
        ],
      },
      {
        slug: "zakony-novtona",
        title: "Законы Ньютона",
        examples: [
          { text: "Сформулируй II закон Ньютона", answer: "сила равна произведению массы на ускорение: F = ma" },
          { text: "Тело массой 4 кг движется с ускорением 2 м/с². Равнодействующая сил = __ Н", answer: "8" },
          { text: "Какой закон Ньютона объясняет явление инерции?", answer: "первый закон Ньютона (закон инерции)" },
        ],
      },
      {
        slug: "zakon-vsemirnogo-tyagoteniya",
        title: "Закон всемирного тяготения",
        examples: [
          { text: "Запиши формулу закона всемирного тяготения", answer: "F = G·m₁·m₂ / r²" },
          { text: "При увеличении расстояния между телами в 2 раза сила тяготения __", answer: "уменьшится в 4 раза" },
        ],
      },
      {
        slug: "iskusstvennye-sputniki",
        title: "Искусственные спутники Земли. Первая космическая скорость",
        examples: [
          { text: "Чему равна первая космическая скорость для Земли (приблизительно)?", answer: "≈ 7,9 км/с (≈ 8 км/с)" },
          { text: "По какой формуле находят первую космическую скорость?", answer: "v = √(g·R)" },
        ],
      },
      {
        slug: "impuls-zakon-sokhraneniya",
        title: "Импульс. Закон сохранения импульса",
        examples: [
          { text: "p = mv. m = 2 кг, v = 3 м/с. p = __ кг·м/с", answer: "6" },
          { text: "Сформулируй закон сохранения импульса", answer: "векторная сумма импульсов тел в замкнутой системе остаётся постоянной" },
        ],
      },
      {
        slug: "reaktivnoe-dvizhenie",
        title: "Реактивное движение",
        examples: [
          { text: "Какой принцип лежит в основе реактивного движения?", answer: "закон сохранения импульса (отбрасывание части массы в одну сторону даёт движение тела в противоположную)" },
          { text: "Назови учёного, разработавшего теорию полёта ракет", answer: "К.Э. Циолковский" },
        ],
      },
      {
        slug: "mekhanicheskie-kolebaniya",
        title: "Механические колебания и волны",
        examples: [
          { text: "Какие колебания называются свободными?", answer: "колебания, происходящие под действием только внутренних сил системы после выведения её из равновесия" },
          { text: "Что такое амплитуда колебаний?", answer: "наибольшее отклонение колеблющейся точки от положения равновесия" },
        ],
      },
      {
        slug: "zvuk",
        title: "Звук. Акустика",
        examples: [
          { text: "От чего зависит высота звука?", answer: "от частоты колебаний (чем выше частота, тем выше звук)" },
          { text: "В каких средах звук распространяется быстрее всего?", answer: "в твёрдых телах (в стали ~5000 м/с, в воздухе ~340 м/с)" },
        ],
      },
      {
        slug: "magnitnoe-pole",
        title: "Магнитное поле. Магнитные линии",
        examples: [
          { text: "Чем отличаются магнитные линии от электрических?", answer: "магнитные линии замкнуты, электрические начинаются на + и заканчиваются на −" },
          { text: "Сформулируй правило буравчика", answer: "если направление поступательного движения буравчика совпадает с направлением тока, то направление вращения рукоятки совпадает с направлением линий магнитного поля" },
        ],
      },
      {
        slug: "elektromagnitnaya-indukciya",
        title: "Электромагнитная индукция",
        examples: [
          { text: "Сформулируй закон электромагнитной индукции Фарадея", answer: "ЭДС индукции равна скорости изменения магнитного потока через контур: ε = −ΔΦ/Δt" },
          { text: "При вдвигании магнита в катушку в ней возникает __", answer: "индукционный ток" },
        ],
      },
      {
        slug: "elektromagnitnye-volny",
        title: "Электромагнитные волны и колебания",
        examples: [
          { text: "Какие колебания называются электромагнитными?", answer: "взаимосвязанные колебания электрического и магнитного полей, распространяющиеся в пространстве" },
          { text: "С какой скоростью электромагнитные волны распространяются в вакууме?", answer: "≈ 3·10⁸ м/с (скорость света)" },
        ],
      },
      {
        slug: "svetovye-volny",
        title: "Свет как электромагнитная волна. Дисперсия",
        examples: [
          { text: "Какой цвет получается при смешении красного и синего?", answer: "фиолетовый (или пурпурный — для дополнительных цветов)" },
          { text: "Какой свет сильнее преломляется: красный или фиолетовый?", answer: "фиолетовый (у него показатель преломления больше)" },
        ],
      },
      {
        slug: "radioaktivnost",
        title: "Радиоактивность. α-, β-, γ-излучения",
        examples: [
          { text: "Какое излучение обладает наибольшей проникающей способностью?", answer: "γ-излучение" },
          { text: "Кто открыл явление радиоактивности?", answer: "А. Беккерель (1896); затем изучали Пьер и Мария Кюри" },
        ],
      },
      {
        slug: "stroenie-atomnogo-yadra",
        title: "Строение атомного ядра. Ядерные реакции",
        examples: [
          { text: "Какой заряд имеет ядро атома (в единицах заряда электрона)?", answer: "равен порядковому номеру элемента (зарядовое число Z)" },
          { text: "Сколько протонов и нейтронов в ядре атома углерода ¹²₆C?", answer: "6 протонов и 6 нейтронов" },
        ],
      },
      {
        slug: "yadernaya-energetika",
        title: "Ядерная энергетика. Деление ядер урана",
        examples: [
          { text: "Какой процесс лежит в основе работы АЭС?", answer: "управляемая цепная реакция деления ядер урана" },
          { text: "Какой изотоп урана используется как топливо в реакторах?", answer: "уран-235 (²³⁵₉₂U)" },
        ],
      },
    ],
  },
];

// ====================== ХИМИЯ ======================

const chemistryGrades: Grade[] = [
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "osnovnye-ponyatiya",
        title: "Основные понятия химии: вещество, атом, молекула, элемент",
        fgosRef: "Вещество",
        examples: [
          { text: "Что такое атом?", answer: "мельчайшая частица химического элемента" },
          { text: "Что такое молекула?", answer: "частица из двух и более атомов" },
          { text: "Пример простого вещества:", answer: "O₂ (кислород)" },
        ],
      },
      {
        slug: "periodicheskaya-tablitsa",
        title: "Периодическая таблица и строение атома",
        examples: [
          { text: "Сколько периодов в таблице Менделеева?", answer: "7" },
          { text: "Атомный номер водорода = __", answer: "1" },
          { text: "Номер группы = числу:", answer: "валентных электронов" },
        ],
      },
      {
        slug: "himicheskaya-svyaz",
        title: "Химическая связь: ковалентная, ионная, металлическая",
        examples: [
          { text: "Связь в NaCl:", answer: "ионная" },
          { text: "Связь в H₂O:", answer: "ковалентная полярная" },
        ],
      },
      {
        slug: "klassifikaciya-veshchestv",
        title: "Классификация веществ: простые и сложные, металлы и неметаллы",
        examples: [
          { text: "Пример металла:", answer: "железо (Fe), медь (Cu)" },
          { text: "Сложное вещество:", answer: "H₂SO₄ (серная кислота)" },
        ],
      },
      {
        slug: "kisloty-i-shchelochi",
        title: "Кислоты, щёлочи, соли — классы неорганических соединений",
        examples: [
          { text: "Формула соляной кислоты:", answer: "HCl" },
          { text: "Формула гидроксида натрия:", answer: "NaOH" },
          { text: "Соль калия и серной кислоты:", answer: "K₂SO₄" },
        ],
      },
      {
        slug: "raschety-po-uravneniyam",
        title: "Расчёты по уравнению реакции: моль, молярная масса",
        examples: [
          { text: "Молярная масса воды H₂O = __ г/моль", answer: "18" },
          { text: "Сколько молей в 44 г CO₂?", answer: "1 (M(CO₂) = 44 г/моль)" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "himicheskie-reakcii",
        title: "Типы химических реакций: соединения, разложения, замещения, обмена",
        examples: [
          { text: "Какая реакция: 2H₂ + O₂ → 2H₂O?", answer: "соединения (экзотермическая)" },
          { text: "Какие признаки химической реакции?", answer: "изменение цвета, выделение газа, выпадение осадка, выделение теплоты/света" },
          { text: "Zn + 2HCl → ZnCl₂ + H₂↑ — это реакция:", answer: "замещения" },
        ],
      },
      {
        slug: "rastvory-i-elektroliticheskaya-dissotsiatsiya",
        title: "Растворы. Электролитическая диссоциация",
        examples: [
          { text: "Что такое электролит?", answer: "вещество, которое в растворе распадается на ионы" },
          { text: "NaCl в воде:", answer: "Na⁺ + Cl⁻" },
        ],
      },
      {
        slug: "okislitelno-vosstanovitelnye-reakcii",
        title: "Окислительно-восстановительные реакции (ОВР)",
        examples: [
          { text: "Что такое окислитель?", answer: "вещество, которое принимает электроны" },
          { text: "В реакции Fe + CuSO₄ → FeSO₄ + Cu что окисляется?", answer: "Fe (железо)" },
        ],
      },
      {
        slug: "nemetal-nitrogen-i-fosfor",
        title: "Неметаллы: азот, фосфор и их соединения",
        examples: [
          { text: "Формула аммиака:", answer: "NH₃" },
          { text: "Формула фосфорной кислоты:", answer: "H₃PO₄" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "organicheskaya-himiya-vvedenie",
        title: "Введение в органическую химию. Теория строения Бутлерова",
        examples: [
          { text: "Что такое органические вещества?", answer: "соединения углерода (обычно с H, O, N, S)" },
          { text: "Сформулируйте положение Бутлерова:", answer: "свойства вещества определяются его строением (порядком связей и взаимным влиянием атомов)" },
        ],
      },
      {
        slug: "uglevodorody-10",
        title: "Предельные и непредельные углеводороды",
        examples: [
          { text: "Общая формула алканов:", answer: "CₙH₂ₙ₊₂" },
          { text: "Формула этена (этилена):", answer: "C₂H₄" },
          { text: "Гомолог метана состава C₄H₁₀:", answer: "бутан" },
        ],
      },
      {
        slug: "kislorodsoderzhashchie-10",
        title: "Кислородсодержащие: спирты, альдегиды, карбоновые кислоты",
        examples: [
          { text: "Формула этанола:", answer: "C₂H₅OH" },
          { text: "Формула уксусной кислоты:", answer: "CH₃COOH" },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "belki-i-nukleinovye-kisloty",
        title: "Белки, нуклеиновые кислоты, углеводы",
        examples: [
          { text: "Мономерами белков являются:", answer: "аминокислоты" },
          { text: "Генетический код записан в:", answer: "ДНК" },
        ],
      },
      {
        slug: "himicheskie-ravnovesiya",
        title: "Химическое равновесие и принцип Ле Шателье",
        examples: [
          { text: "Что происходит с равновесием при увеличении концентрации продукта?", answer: "смещается влево (в сторону реагентов)" },
        ],
      },
    ],
  },
];

// ====================== БИОЛОГИЯ ======================

const biologyGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "rasteniya",
        title: "Растения. Строение, разнообразие, значение",
        fgosRef: "Живые организмы",
        examples: [
          { text: "Что такое фотосинтез?", answer: "процесс образования органических веществ из воды и CO₂ на свету" },
          { text: "Какие части растения участвуют в фотосинтезе?", answer: "листья (хлоропласты); CO₂ — через устьица, вода — через корни" },
          { text: "Орган растения, который удерживает его в почве и поглощает воду:", answer: "корень" },
        ],
      },
      {
        slug: "bakurii-gribi-lishainiki",
        title: "Бактерии, грибы, лишайники",
        examples: [
          { text: "Чем грибы отличаются от растений?", answer: "нет хлорофилла, питаются гетеротрофно" },
          { text: "Лишайник — это симбиоз:", answer: "гриба и водоросли (цианобактерии)" },
        ],
      },
      {
        slug: "kletochnoe-stroenie",
        title: "Клеточное строение организмов",
        examples: [
          { text: "Что такое клетка?", answer: "структурная и функциональная единица живого" },
          { text: "Чем отличается растительная клетка от животной?", answer: "у растений есть клеточная стенка, хлоропласты и крупная вакуоль" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "kulturnye-rasteniya",
        title: "Культурные растения. Селекция",
        examples: [
          { text: "Что такое селекция?", answer: "наука о создании новых сортов растений и пород животных" },
        ],
      },
      {
        slug: "podsolnechnik",
        title: "Семейство: покрытосеменные (цветковые)",
        examples: [
          { text: "Класс однодольных:", answer: "злаки, лилейные" },
          { text: "Класс двудольных:", answer: "бобовые, розоцветные, паслёновые, крестоцветные, сложноцветные" },
        ],
      },
      {
        slug: "tkani",
        title: "Ткани растений и животных",
        examples: [
          { text: "Виды тканей у растений:", answer: "образовательная, покровная, проводящая, основная, механическая" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "zhivotnye-bespozvonochnye",
        title: "Беспозвоночные животные: черви, моллюски, членистоногие, иглокожие",
        examples: [
          { text: "К какому типу относятся медузы?", answer: "Кишечнополостные" },
          { text: "Какие классы относятся к типу Моллюски?", answer: "брюхоногие, двустворчатые, головоногие" },
          { text: "Сколько пар ног у насекомых?", answer: "3" },
        ],
      },
      {
        slug: "kholodnosrochnye",
        title: "Холоднокровные: рыбы, земноводные, пресмыкающиеся",
        examples: [
          { text: "Чем рыбы отличаются от земноводных?", answer: "рыбы всю жизнь в воде и дышат жабрами; земноводные — кожа + лёгкие" },
        ],
      },
      {
        slug: "teplokrovnye",
        title: "Теплокровные: птицы и млекопитающие",
        examples: [
          { text: "Чем млекопитающие отличаются от птиц?", answer: "выкармливают детёнышей молоком, живорождение; у птиц — яйца и перья" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "chelovek-i-ego-zdorove",
        title: "Человек и его здоровье. Ткани, системы органов",
        examples: [
          { text: "Сколько пар рёбер у человека?", answer: "12" },
          { text: "Какой отдел мозга отвечает за координацию?", answer: "мозжечок" },
        ],
      },
      {
        slug: "skelet-i-myshtsy",
        title: "Скелет и мышцы. Осанка и гигиена",
        examples: [
          { text: "Сколько костей в скелете взрослого человека?", answer: "около 206" },
        ],
      },
      {
        slug: "krov-i-krovoobrashchenie",
        title: "Кровь и кровообращение. Сердечно-сосудистая система",
        examples: [
          { text: "Какой пульс в покое у здорового взрослого?", answer: "60–80 ударов в минуту" },
          { text: "Сколько камер в сердце человека?", answer: "4 (два предсердия и два желудочка)" },
        ],
      },
      {
        slug: "dyhanie-i-pishchevarenie",
        title: "Дыхание и пищеварение",
        examples: [
          { text: "Где происходит газообмен в лёгких?", answer: "в альвеолах" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "kletochnyj-uroven",
        title: "Клеточный уровень: строение, деление, обмен веществ",
        examples: [
          { text: "Что такое митоз?", answer: "деление клетки с сохранением числа хромосом" },
        ],
      },
      {
        slug: "genetika-i-nasledstvennost",
        title: "Генетика. Законы Менделя. Наследственность",
        examples: [
          { text: "Сколько хромосом у человека?", answer: "46" },
          { text: "Что такое ген?", answer: "участок ДНК, отвечающий за определённый признак" },
          { text: "Закон расщепления Менделя:", answer: "при моногибридном скрещивании во втором поколении наблюдается отношение 3:1" },
        ],
      },
      {
        slug: "evolyutsiya",
        title: "Эволюция. Дарвинизм. Естественный отбор",
        examples: [
          { text: "Кто создал теорию эволюции путём естественного отбора?", answer: "Чарльз Дарвин" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "biokletochnye-processy",
        title: "Биохимия: белки, липиды, углеводы, нуклеиновые кислоты",
        examples: [
          { text: "Мономер белков:", answer: "аминокислота" },
          { text: "Мономер нуклеиновых кислот:", answer: "нуклеотид" },
        ],
      },
      {
        slug: "kletochnye-protsessy-10",
        title: "Энергетический и пластический обмен клетки",
        examples: [
          { text: "Что такое АТФ?", answer: "аденозинтрифосфат — основной переносчик энергии в клетке" },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "ekosistemy-i-biosfera",
        title: "Экосистемы и биосфера. Круговорот веществ",
        examples: [
          { text: "Что такое экосистема?", answer: "сообщество живых организмов и их среды обитания, объединённые обменом веществ и энергии" },
        ],
      },
      {
        slug: "proishozhdenie-zhizni",
        title: "Происхождение жизни и человека",
        examples: [
          { text: "Как называется гипотеза о возникновении жизни на Земле из неживых веществ?", answer: "абиогенез (теория Опарина — Холдейна)" },
        ],
      },
    ],
  },
];

// ====================== ГЕОГРАФИЯ ======================

const geographyGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "plan-i-karta",
        title: "План и карта. Масштаб, условные обозначения",
        fgosRef: "Географические модели",
        examples: [
          { text: "Что такое масштаб?", answer: "отношение длины на карте к длине на местности" },
          { text: "Что такое условные обозначения?", answer: "знаки, которыми на плане/карте обозначают объекты (лес, река, дорога)" },
        ],
      },
      {
        slug: "gorizont-storony",
        title: "Горизонт. Стороны горизонта. Компас и ориентирование",
        examples: [
          { text: "Сколько основных сторон горизонта?", answer: "4 (С, Ю, З, В) — плюс промежуточные (СВ, ЮЗ и т.д.)" },
        ],
      },
      {
        slug: "litosfera",
        title: "Литосфера: горные породы, равнины, горы",
        examples: [
          { text: "Самая высокая гора в мире:", answer: "Эверест (8848 м)" },
        ],
      },
      {
        slug: "gidrosfera",
        title: "Гидросфера: океаны, моря, реки, озёра",
        examples: [
          { text: "Самый большой океан:", answer: "Тихий" },
          { text: "Самая длинная река:", answer: "Нил" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "atmosfera-i-klimat",
        title: "Атмосфера и климат. Температура, осадки, ветер",
        examples: [
          { text: "Как изменяется температура воздуха с высотой?", answer: "понижается примерно на 1 °C на каждые 100 м подъёма" },
        ],
      },
      {
        slug: "gidrosfera-6",
        title: "Гидросфера. Океаны и течения",
        examples: [
          { text: "Что такое течение?", answer: "поток воды в океане, движущийся в определённом направлении" },
        ],
      },
      {
        slug: "biomnye-zony",
        title: "Природные зоны: тундра, тайга, степь, пустыня",
        examples: [
          { text: "Какие природные зоны есть в России?", answer: "тундра, тайга, смешанные леса, степи, пустыни, субтропики" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "materiki",
        title: "Материки и океаны: Африка, Южная Америка, Австралия, Антарктида",
        examples: [
          { text: "Самый большой материк", answer: "Евразия" },
          { text: "Самый глубокий океан", answer: "Тихий" },
          { text: "Самая длинная река Африки:", answer: "Нил" },
        ],
      },
      {
        slug: "severnaya-amerika-i-evrazia",
        title: "Северная Америка и Евразия",
        examples: [
          { text: "Самое большое озеро по площади:", answer: "Каспийское (но это озеро, не море)" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "rossiya-priroda",
        title: "Россия: природа, рельеф, климат",
        examples: [
          { text: "Самая длинная река России:", answer: "Обь — Иртыш" },
          { text: "Самый большой полуостров России:", answer: "Таймыр" },
        ],
      },
      {
        slug: "naselenie-rossii",
        title: "Население России. Народы и религии",
        examples: [
          { text: "Самая многочисленная национальность России:", answer: "русские" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "rossiya-hozyajstvo",
        title: "Россия: хозяйство, отрасли, регионы",
        examples: [
          { text: "Самый большой по площади регион России", answer: "Республика Саха (Якутия)" },
          { text: "Сколько федеральных округов в России?", answer: "8 (по состоянию на 2026)" },
        ],
      },
      {
        slug: "ekonomicheskie-rayony",
        title: "Экономические районы России",
        examples: [
          { text: "Сколько экономических районов выделяют?", answer: "11 (по традиционному делению)" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "mirovoj-okean",
        title: "Мировой океан и его ресурсы",
        examples: [
          { text: "Сколько процентов Земли покрыто океаном?", answer: "около 71%" },
        ],
      },
      {
        slug: "globalnye-problemy",
        title: "Глобальные проблемы: изменение климата, опустынивание",
        examples: [
          { text: "Что такое парниковый эффект?", answer: "задержка тепла у поверхности Земли из-за CO₂ и других газов в атмосфере" },
        ],
      },
    ],
  },
];

// ====================== ИСТОРИЯ ======================

const historyGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "drevny-mir",
        title: "Древний мир: первобытность, Древний Восток, Античность",
        fgosRef: "История России и мира",
        examples: [
          { text: "Где зародились Олимпийские игры?", answer: "Древняя Греция" },
          { text: "Какие древние государства существовали в Месопотамии?", answer: "Шумер, Вавилон, Ассирия" },
          { text: "В каком веке пала Западная Римская империя?", answer: "476 г. н.э." },
        ],
      },
      {
        slug: "drevnyaya-rus",
        title: "Древняя Русь: от призвания варягов до раздробленности",
        examples: [
          { text: "Год призвания варягов:", answer: "862 (по «Повести временных лет»)" },
          { text: "Крещение Руси:", answer: "988" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "srednevekovye",
        title: "Средневековье. Русь до XV века. Европа и Азия",
        examples: [
          { text: "Год крещения Руси", answer: "988" },
          { text: "Кто был первым царём единого Русского государства?", answer: "Иван IV (Грозный)" },
          { text: "Битва на Чудском озере (1242):", answer: "Александр Невский против Тевтонского ордена" },
        ],
      },
      {
        slug: "mongolskoe-igo",
        title: "Монгольское иго и его последствия",
        examples: [
          { text: "В каком году произошла битва на Калке?", answer: "1223" },
          { text: "Столица Золотой Орды:", answer: "Сарай" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "novoe-vremya",
        title: "Новое время в России (XVI–XVII вв). Иван Грозный. Смута. Романовы",
        examples: [
          { text: "Год начала Смутного времени", answer: "1598" },
          { text: "Кто был первым царём из династии Романовых?", answer: "Михаил Фёдорович (1613)" },
          { text: "Год восстания под предводительством Степана Разина:", answer: "1670–1671" },
        ],
      },
      {
        slug: "russia-18-vek",
        title: "Россия в XVIII веке. Реформы Петра I и Екатерины II",
        examples: [
          { text: "Год Северной войны:", answer: "1700–1721" },
          { text: "Год указа о единонаследии и табели о рангах:", answer: "1722" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "russia-19-vek",
        title: "Россия в первой половине XIX века. Реформы Александра I",
        examples: [
          { text: "Год отмены крепостного права:", answer: "1861 (Александр II)" },
          { text: "Кто автор «Оттепели»? (не путать с исторической эпохой)", answer: "И. Эренбург" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "russia-xx-vek-9",
        title: "Россия в XX веке: революции, гражданская война, СССР",
        examples: [
          { text: "Год Октябрьской революции", answer: "1917" },
          { text: "Год окончания Гражданской войны в России:", answer: "1922 (условно)" },
          { text: "Год образования СССР:", answer: "1922" },
        ],
      },
      {
        slug: "velikaya-otechestvennaya",
        title: "Великая Отечественная война 1941–1945",
        examples: [
          { text: "Дата начала Великой Отечественной:", answer: "22 июня 1941" },
          { text: "Битва за Сталинград — сроки:", answer: "17 июля 1942 — 2 февраля 1943" },
        ],
      },
      {
        slug: "post-sovetskaya-rossiya",
        title: "Постсоветская Россия: 1991–2000-е. Конституция 1993",
        examples: [
          { text: "Год принятия Конституции РФ:", answer: "1993 (12 декабря)" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "mirovoj-istoricheskij-process",
        title: "Мировой исторический процесс. Глобализация",
        examples: [
          { text: "Что такое глобализация?", answer: "процесс всемирной экономической, политической и культурной интеграции" },
        ],
      },
      {
        slug: "postindustrialnoe-obshchestvo",
        title: "Постиндустриальное общество",
        examples: [
          { text: "Что характеризует постиндустриальное общество?", answer: "высокая доля сферы услуг и информации, экономика знаний" },
        ],
      },
    ],
  },
];

// ====================== ОБЩЕСТВОЗНАНИЕ ======================

const societyGrades: Grade[] = [
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "semya",
        title: "Семья. Семейные ценности и роли",
        fgosRef: "Человек и общество",
        examples: [
          { text: "Что такое семья?", answer: "группа людей, связанных родством и совместным бытом" },
          { text: "Какие функции выполняет семья?", answer: "воспитательная, экономическая, эмоциональная, защитная" },
        ],
      },
      {
        slug: "obshchestvo-i-ya",
        title: "Общество и я. Личность",
        examples: [
          { text: "Что такое личность?", answer: "человек с его социальными качествами, которые он приобрёл в обществе" },
        ],
      },
      {
        slug: "sotsialnye-normy",
        title: "Социальные нормы и правила",
        examples: [
          { text: "Примеры социальных норм:", answer: "обычаи, традиции, мораль, право, этикет" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "ekonomika-doma",
        title: "Экономика семьи. Бюджет. Доходы и расходы",
        examples: [
          { text: "Что такое бюджет?", answer: "план доходов и расходов семьи на определённый период" },
        ],
      },
      {
        slug: "sotsialnye-gruppy",
        title: "Социальные группы: семья, друзья, школа, нация",
        examples: [
          { text: "Пример большой социальной группы:", answer: "этнос (нация)" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "pravo-8",
        title: "Право. Нормативные акты. Правовые отношения",
        examples: [
          { text: "С какого возраста наступает уголовная ответственность по УК РФ?", answer: "с 16 лет (по некоторым статьям с 14)" },
          { text: "Чем отличается право от морали?", answer: "право обеспечивается силой государства, мораль — силой общественного мнения и совести" },
        ],
      },
      {
        slug: "konstitucia-rf",
        title: "Конституция РФ: основы конституционного строя",
        examples: [
          { text: "Год принятия Конституции РФ:", answer: "1993 (12 декабря)" },
          { text: "Сколько субъектов входит в состав Российской Федерации сейчас?", answer: "85" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "gosudarstvo-9",
        title: "Государство. Формы правления и государственного устройства",
        examples: [
          { text: "Какая форма правления в РФ?", answer: "республика" },
          { text: "Назови три ветви государственной власти в РФ", answer: "законодательная, исполнительная, судебная" },
        ],
      },
      {
        slug: "ekonomicheskaya-sistema",
        title: "Экономика: типы экономических систем, рынок, спрос и предложение",
        examples: [
          { text: "Что такое спрос?", answer: "желание и способность потребителей купить товар по определённой цене" },
          { text: "Типы экономических систем:", answer: "традиционная, командная, рыночная, смешанная" },
        ],
      },
      {
        slug: "politicheskie-partii",
        title: "Политические партии и общественные движения",
        examples: [
          { text: "Сколько политических партий в РФ зарегистрировано?", answer: "около 30 (точные данные меняются)" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "chelovek-i-poznanie",
        title: "Философия: человек, познание, истина",
        examples: [
          { text: "Что такое истина?", answer: "соответствие знания действительности" },
        ],
      },
      {
        slug: "ekonomicheskaya-zona",
        title: "Экономические системы и современные теории",
        examples: [
          { text: "Что такое ВВП?", answer: "валовой внутренний продукт — стоимость всех товаров и услуг, произведённых в стране за год" },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "sotsialnye-protsessy",
        title: "Социальные процессы. Глобализация и миграция",
        examples: [
          { text: "Что такое миграция?", answer: "перемещение людей между территориями с сменой места жительства" },
        ],
      },
      {
        slug: "pravo-i-zashchita",
        title: "Защита прав человека. Гражданство РФ",
        examples: [
          { text: "Кто является гражданином РФ по рождению?", answer: "лицо, родившееся на территории РФ или принадлежащее к российскому гражданину" },
        ],
      },
    ],
  },
];

// ====================== ОКРУЖАЮЩИЙ МИР ======================

const okruzhaetGrades: Grade[] = [
  {
    num: 1,
    title: "1 класс",
    topics: [
      {
        slug: "priroda-letom",
        title: "Природа летом и признаки сезона",
        fgosRef: "Природа",
        examples: [
          { text: "Назови 3 признака лета", answer: "жарко, длинный день, зелень" },
          { text: "Какие ягоды созревают летом в средней полосе России?", answer: "земляника, черника, малина, смородина" },
        ],
      },
      {
        slug: "vremena-goda-1",
        title: "Времена года. Сезонные изменения",
        examples: [
          { text: "Какое время года после зимы?", answer: "весна" },
        ],
      },
      {
        slug: "zhivotnye-i-rasteniya",
        title: "Животные и растения вокруг нас",
        examples: [
          { text: "Какие животные живут в лесу?", answer: "волк, лиса, заяц, медведь, лось, белка" },
        ],
      },
    ],
  },
  {
    num: 2,
    title: "2 класс",
    topics: [
      {
        slug: "vremena-goda",
        title: "Времена года. Календарь и месяцы",
        examples: [
          { text: "Сколько месяцев в году?", answer: "12" },
          { text: "Какой месяц последний зимний?", answer: "февраль" },
        ],
      },
      {
        slug: "gorizont-i-storony",
        title: "Стороны горизонта. Компас",
        examples: [
          { text: "Сколько основных сторон горизонта?", answer: "4 (С, Ю, З, В)" },
        ],
      },
      {
        slug: "teplo-i-svet",
        title: "Свет и тепло в жизни растений и животных",
        examples: [
          { text: "Почему медведи впадают в спячку зимой?", answer: "не хватает корма и тепла — зимняя спячка помогает пережить холодный сезон" },
        ],
      },
    ],
  },
  {
    num: 3,
    title: "3 класс",
    topics: [
      {
        slug: "telo-cheloveka",
        title: "Тело человека. Системы органов",
        examples: [
          { text: "Сколько костей в теле взрослого человека?", answer: "около 206" },
          { text: "Какой орган перекачивает кровь?", answer: "сердце" },
        ],
      },
      {
        slug: "organy-chuvstv",
        title: "Органы чувств: зрение, слух, обоняние, осязание, вкус",
        examples: [
          { text: "Сколько органов чувств у человека?", answer: "5: зрение, слух, обоняние, осязание, вкус" },
        ],
      },
      {
        slug: "krugovorot-vody-v-prirode",
        title: "Круговорот воды в природе",
        examples: [
          { text: "Какие состояния воды встречаются в природе?", answer: "твёрдое (лёд), жидкое, газообразное (пар)" },
        ],
      },
    ],
  },
  {
    num: 4,
    title: "4 класс",
    topics: [
      {
        slug: "prirodnye-zony",
        title: "Природные зоны России",
        examples: [
          { text: "В какой зоне растёт берёза?", answer: "лесная (тайга, смешанные леса)" },
          { text: "Какая природная зона самая большая по площади в России?", answer: "тайга" },
        ],
      },
      {
        slug: "ekologiya",
        title: "Экология: охрана природы, цепи питания",
        examples: [
          { text: "Пример пищевой цепи в лесу:", answer: "растения → заяц → волк" },
          { text: "Что такое экология?", answer: "наука о взаимоотношениях живых организмов с окружающей средой" },
        ],
      },
      {
        slug: "poleznye-iskopaemye",
        title: "Полезные ископаемые: нефть, газ, уголь, руды",
        examples: [
          { text: "Какие полезные ископаемые относятся к горючим?", answer: "нефть, газ, уголь, торф" },
        ],
      },
      {
        slug: "solnechnaya-sistema",
        title: "Солнечная система. Планеты",
        examples: [
          { text: "Сколько планет в Солнечной системе?", answer: "8 (Меркурий, Венера, Земля, Марс, Юпитер, Сатурн, Уран, Нептун)" },
          { text: "Ближайшая к Солнцу планета:", answer: "Меркурий" },
        ],
      },
    ],
  },
];

// ====================== НЕМЕЦКИЙ ЯЗЫК ======================

const germanGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "kennenlernen",
        title: "Знакомство. Приветствие.",
        fgosRef: "Знакомство и семья",
        examples: [
          { text: "Guten Tag! Ich ___ Anna.", answer: "heiße" },
          { text: "Wie ___ du?", answer: "heißt" },
          { text: "Переведи: Wie geht es dir?", answer: "Как дела? / Как ты поживаешь?" },
        ],
      },
      {
        slug: "schule",
        title: "Школа. Расписание.",
        examples: [
          { text: "Wie viele Stunden ___ du heute?", answer: "hast" },
          { text: "Die Schule ___ um 8 Uhr.", answer: "beginnt" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "familie",
        title: "Семья. Родственники.",
        examples: [
          { text: "Das ist meine ___. (мама)", answer: "Mutter" },
          { text: "Ich habe einen ___. (брат)", answer: "Bruder" },
        ],
      },
    ],
  },
];

// ====================== ОБЖ / ОБЗР (ОСНОВЫ БЕЗОПАСНОСТИ И ЗАЩИТЫ РОДИНЫ) ======================
//
// F-09: расширено с 8–9 до 5–11 классов. С 2024/25 учебного года ОБЗР (ранее ОБЖ)
// преподаётся в т.ч. в 5–7 классах (пилот Минпросвещения) + 8–11 базово.
// Темы взяты из кодификатора ФГОС 2023 и Примерной рабочей программы ОБЗР.

const obzhGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "lichnaya-bezopasnost",
        title: "Личная безопасность в быту и школе",
        fgosRef: "Опасные и чрезвычайные ситуации",
        examples: [
          { text: "Какие опасности подстерегают ребёнка дома?", answer: "открытое окно, электроприборы, бытовая химия, острые предметы, газ" },
          { text: "Что нужно сделать в первую очередь при порезе стеклом?", answer: "промыть рану, обработать антисептиком, при сильном кровотечении — наложить давящую повязку и вызвать скорую" },
        ],
      },
      {
        slug: "dorozhnaya-bezopasnost",
        title: "Безопасность на дороге",
        fgosRef: "Безопасное поведение на дорогах",
        examples: [
          { text: "Где разрешено переходить проезжую часть?", answer: "по пешеходному переходу (зебре), на зелёный сигнал светофора" },
          { text: "Какие правила должен соблюдать пешеход в тёмное время суток?", answer: "носить световозвращающие элементы (фликеры), идти по освещённой стороне дороги" },
        ],
      },
      {
        slug: "prirodnye-chs",
        title: "Опасные природные явления",
        fgosRef: "ЧС природного характера",
        examples: [
          { text: "Как вести себя во время грозы?", answer: "не прятаться под одиноким деревом, отключить телефон, закрыть окна" },
          { text: "Что делать при сильном ветре (урагане)?", answer: "укрыться в здании, отойти от окон, не выходить на улицу" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "bezopasnost-na-vode",
        title: "Безопасность на воде",
        fgosRef: "Водные ЧС и безопасное поведение",
        examples: [
          { text: "В чём опасность купания в необорудованных местах?", answer: "неизвестное дно, сильные течения, отсутствие спасателей" },
          { text: "Как помочь тонущему, не заходя в воду?", answer: "бросить спасательный круг, длинную палку или верёвку, позвать взрослых, позвонить 112" },
        ],
      },
      {
        slug: "pozharnaya-bezopasnost-6",
        title: "Пожарная безопасность. Бытовые ЧС.",
        fgosRef: "Пожарная безопасность",
        examples: [
          { text: "Что запрещено тушить водой?", answer: "горящее масло на сковороде, электроприборы под напряжением, бензин" },
          { text: "Каковы первые действия при пожаре в квартире?", answer: "сообщить по 112, начать тушить подручными средствами, если не получается — покинуть помещение, плотно закрыть дверь, не открывать окна" },
        ],
      },
      {
        slug: "infektsii-i-zdorove",
        title: "Здоровье и инфекционная безопасность",
        fgosRef: "Основы здорового образа жизни",
        examples: [
          { text: "Какие правила гигиены снижают риск ОРВИ?", answer: "мыть руки после улицы, не трогать лицо грязными руками, проветривать помещение" },
          { text: "Что такое вакцинация и зачем она нужна?", answer: "введение ослабленного возбудителя для выработки иммунитета и защиты от тяжёлых форм болезни" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "transportnaya-bezopasnost",
        title: "Безопасность на транспорте",
        fgosRef: "Безопасное поведение на транспорте",
        examples: [
          { text: "Почему нельзя высовываться из окна движущегося транспорта?", answer: "можно получить травму от встречного объекта или выпасть" },
          { text: "Как вести себя в метро при ЧС?", answer: "следовать указаниям сотрудников, не пользоваться лифтом, двигаться к выходу по указателям" },
        ],
      },
      {
        slug: "terrorizm-i-ekstremizm",
        title: "Противодействие терроризму и экстремизму",
        fgosRef: "Современный терроризм",
        examples: [
          { text: "Что такое телефонный терроризм и чем он опасен?", answer: "ложные сообщения об угрозе взрыва — отвлекают экстренные службы и создают панику, караются уголовно" },
          { text: "Как действовать при обнаружении бесхозного предмета?", answer: "не трогать, отойти на безопасное расстояние, сообщить взрослым или позвонить 112" },
        ],
      },
      {
        slug: "informacionnaya-bezopasnost",
        title: "Информационная и цифровая безопасность",
        fgosRef: "Безопасность в информационном пространстве",
        examples: [
          { text: "Какие данные нельзя публиковать в интернете?", answer: "адрес проживания, номер телефона, паспортные данные, фото документов, геолокацию" },
          { text: "Что такое фишинг и как его распознать?", answer: "поддельные письма/сайты, которые выманивают логины и пароли; признаки — срочность, ошибки, странный адрес отправителя" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "pdd-8",
        title: "Правила дорожного движения (углублённо)",
        fgosRef: "Безопасность на дорогах",
        examples: [
          { text: "С какого возраста можно ездить на велосипеде по проезжей части?", answer: "с 14 лет" },
          { text: "Что такое «зебра» и где разрешён переход?", answer: "пешеходный переход, обозначенный белыми полосами; переходить можно только по нему или по светофору" },
        ],
      },
      {
        slug: "pozharnaya-bezopasnost-8",
        title: "Пожарная безопасность. Огнетушители.",
        fgosRef: "Пожарная безопасность",
        examples: [
          { text: "По какому номеру вызывать пожарных?", answer: "101 или 112" },
          { text: "Как пользоваться порошковым огнетушителем?", answer: "сорвать пломбу, выдернуть чеку, направить раструб на очаг, нажать рычаг, тушить с наветренной стороны" },
        ],
      },
      {
        slug: "zdorovy-obraz-zhizni",
        title: "Здоровый образ жизни. Вредные привычки.",
        fgosRef: "Основы здорового образа жизни",
        examples: [
          { text: "Какое влияние оказывает курение на организм подростка?", answer: "снижает ёмкость лёгких, ухудшает кровообращение, замедляет физическое развитие, вызывает зависимость" },
          { text: "Чем опасен алкоголь для растущего организма?", answer: "поражает печень, мозг, нервную систему; нарушает формирование личности и учебу" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "voennaya-sluzhba",
        title: "Воинская служба. Защита Отечества.",
        fgosRef: "Основы военной службы",
        examples: [
          { text: "В каком возрасте призывают на срочную военную службу в РФ?", answer: "с 18 до 30 лет" },
          { text: "Какие вооружённые силы есть в РФ?", answer: "Сухопутные войска, ВКС, ВМФ, РВСН, ВДВ" },
        ],
      },
      {
        slug: "grajdanskaya-oborona",
        title: "Гражданская оборона. ЧС техногенного характера.",
        fgosRef: "Гражданская оборона",
        examples: [
          { text: "Что такое гражданская оборона (ГО)?", answer: "система мероприятий по подготовке к защите и по защите населения от ЧС" },
          { text: "Какие сигналы оповещения ГО вы знаете?", answer: "«Внимание всем!», сирена, речевые сообщения по радио и телевидению" },
        ],
      },
      {
        slug: "pervaya-pomoshch-9",
        title: "Первая помощь пострадавшим",
        fgosRef: "Оказание первой помощи",
        examples: [
          { text: "Каковы признаки артериального кровотечения?", answer: "алая кровь бьёт пульсирующей струёй; нужно немедленно наложить жгут выше раны" },
          { text: "Что делать при подозрении на перелом конечности?", answer: "обеспечить неподвижность (шина), вызвать скорую, не пытаться вправить самостоятельно" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "voennaya-podgotovka-10",
        title: "Основы военной подготовки. Уставы ВС РФ.",
        fgosRef: "Военная подготовка",
        examples: [
          { text: "Какие виды уставов существуют в ВС РФ?", answer: "общевоинские уставы (строевой, внутренней службы, гарнизонной и караульной служб, дисциплинарный)" },
          { text: "Что такое воинская дисциплина?", answer: "строгое и точное соблюдение всеми военнослужащими порядка и правил, установленных законами и воинскими уставами" },
        ],
      },
      {
        slug: "medicinskaya-podgotovka-10",
        title: "Основы медицинских знаний. Тактическая медицина.",
        fgosRef: "Первая помощь",
        examples: [
          { text: "Как остановить сильное кровотечение жгутом?", answer: "наложить выше раны на одежду, затянуть до остановки кровотечения, записать время наложения (не более 1 часа летом, 30 мин зимой)" },
          { text: "Что входит в аптечку первой помощи?", answer: "бинты, жгут, антисептик, обезболивающее, перекись водорода, пластырь" },
        ],
      },
      {
        slug: "otechestvennye-tradicii",
        title: "Героизм и воинские традиции России",
        fgosRef: "Историческое наследие",
        examples: [
          { text: "Кто такие былинные богатыри и зачем их помнят?", answer: "защитники Родины в Древней Руси (Илья Муромец, Добрыня, Алёша) — символы мужества и верности долгу" },
          { text: "Какие современные воинские традиции ВС РФ вы знаете?", answer: "День Победы 9 мая, День защитника Отечества 23 февраля, День Героев Отечества 9 декабря" },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "prizyv-i-ko",
        title: "Призыв на военную службу. Конституционный долг.",
        fgosRef: "Подготовка к военной службе",
        examples: [
          { text: "Какова продолжительность срочной военной службы по призыву?", answer: "1 год" },
          { text: "Какие основания для отсрочки или освобождения от призыва?", answer: "по состоянию здоровья, по учёбе (очная форма, аккредитация), семейные обстоятельства" },
        ],
      },
      {
        slug: "takticheskaya-podgotovka",
        title: "Тактическая подготовка. Действия в бою.",
        fgosRef: "Тактика",
        examples: [
          { text: "Что такое позиционная оборона?", answer: "вид оборонительного боя с использованием укреплений, опорных пунктов и огневых точек" },
          { text: "Какие свойства местности учитываются при выборе позиции?", answer: "естественные укрытия, обзор, дальность до противника, скрытые подходы" },
        ],
      },
      {
        slug: "strelkovoe-oruzhie",
        title: "Стрелковое оружие. Техника безопасности.",
        fgosRef: "Огневая подготовка",
        examples: [
          { text: "Из каких основных частей состоит автомат Калашникова?", answer: "ствол, затворная рама с затвором, возвратный механизм, приклад, магазин, цевьё" },
          { text: "Каковы правила обращения с оружием?", answer: "оружие всегда считать заряженным; не направлять на людей; палец на спусковой крючок — только перед выстрелом" },
        ],
      },
    ],
  },
];

// ====================== ТЕХНОЛОГИЯ (ТРУД) ======================

const technologyGrades: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "materialy",
        title: "Материаловедение",
        fgosRef: "Технологии и материалы",
        examples: [
          { text: "Какие натуральные волокна вы знаете?", answer: "хлопок, лён, шерсть, шёлк" },
          { text: "Какой инструмент для раскроя ткани?", answer: "ножницы" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "kulinariya",
        title: "Кулинария. Приготовление пищи.",
        examples: [
          { text: "Какой вид тепловой обработки сохраняет больше витаминов?", answer: "приготовление на пару" },
          { text: "Зачем нужно мыть руки и продукты перед готовкой?", answer: "чтобы удалить микробы и загрязнения, снизить риск пищевых отравлений" },
        ],
      },
    ],
  },
];

// ====================== ФИНАНСОВАЯ ГРАМОТНОСТЬ ======================

const financeGrades: Grade[] = [
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "byudzhet",
        title: "Семейный бюджет",
        fgosRef: "Финансовое планирование",
        examples: [
          { text: "Что такое доход семьи?", answer: "деньги, которые семья получает (зарплата, пенсия, пособия)" },
          { text: "Что такое расход?", answer: "траты семьи (еда, одежда, жильё, развлечения)" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "banki-kredity",
        title: "Банки и кредиты",
        examples: [
          { text: "Что такое кредит?", answer: "деньги, которые банк даёт в долг под процент" },
          { text: "Что такое депозит?", answer: "деньги, размещённые в банке под процент" },
        ],
      },
    ],
  },
];

// ====================== МУЗЫКА ======================

const musicGrades: Grade[] = [
  {
    num: 1,
    title: "1 класс",
    topics: [
      {
        slug: "zvuki-vokrug",
        title: "Звуки вокруг нас",
        fgosRef: "Музыка как вид искусства",
        examples: [
          { text: "Какие бывают звуки по высоте?", answer: "высокие и низкие" },
          { text: "Что такое тембр?", answer: "окраска звука, по которой различают инструменты и голоса" },
        ],
      },
    ],
  },
  {
    num: 3,
    title: "3 класс",
    topics: [
      {
        slug: "noty-dolzhny",
        title: "Ноты. Длительности.",
        examples: [
          { text: "Сколько длительностей в размере 4/4?", answer: "четыре четверти (или эквивалент)" },
          { text: "Сколько нот помещается на одной линейке нотного стана?", answer: "пять линеек, между ними — ноты" },
        ],
      },
    ],
  },
];

// ====================== ИЗО (ИСКУССТВО) ======================

const artGrades: Grade[] = [
  {
    num: 1,
    title: "1 класс",
    topics: [
      {
        slug: "tsveta",
        title: "Основные цвета. Тёплые и холодные.",
        fgosRef: "Мир цвета",
        examples: [
          { text: "Какие цвета тёплые?", answer: "красный, оранжевый, жёлтый" },
          { text: "Какие цвета холодные?", answer: "синий, голубой, зелёный, фиолетовый" },
        ],
      },
    ],
  },
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "perspektiva",
        title: "Перспектива. Линейная и воздушная.",
        examples: [
          { text: "Что такое линия горизонта?", answer: "воображаемая линия, где небо как бы сходится с землёй" },
          { text: "Чем отличается линейная перспектива от воздушной?", answer: "линейная — изменение размеров и сходимость линий; воздушная — изменение цвета и чёткости по мере удаления" },
        ],
      },
    ],
  },
];

// ====================== ФИЗКУЛЬТУРА ======================

const peGrades: Grade[] = [
  {
    num: 1,
    title: "1 класс",
    topics: [
      {
        slug: "osnovy-dvizheniya",
        title: "Основы движения. Бег, прыжки.",
        fgosRef: "Физическая активность",
        examples: [
          { text: "Сколько секунд длится 1 минута?", answer: "60" },
          { text: "Зачем нужна разминка перед бегом?", answer: "чтобы разогреть мышцы и снизить риск травмы" },
        ],
      },
    ],
  },
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "normy-gto",
        title: "Нормы ГТО",
        examples: [
          { text: "Какой норматив ГТО для 5 класса в беге на 60 м (мальчики)?", answer: "примерно 10,3 сек (бронза)" },
          { text: "С какого класса можно сдавать ГТО?", answer: "с 1 класса (с учётом возрастной ступени)" },
        ],
      },
    ],
  },
];

// ====================== SUBJECTS ARRAY ======================

/**
 * Подмешиваем классы из `grade-extensions/` к базовым массивам.
 *
 * База ниже описывает исторически сложившееся покрытие; расширения его
 * дополняют. Ключ — slug предмета, значение — `Grade[]`.
 *
 * Правила слияния:
 *  - класс с номером, которого нет в базе, → добавляется целиком;
 *  - класс, который в базе уже есть, → его темы ДОПИСЫВАЮТСЯ
 *    (а не заменяются), чтобы расширение могло «дозаполнить» класс
 *    с 2–3 темами до нормального покрытия;
 *  - результат сортируется по номеру класса: навигация по предмету и
 *    sitemap идут в порядке `grades`.
 *
 * Расширения одного предмета можно держать в нескольких файлах, если
 * они трогают разные номера классов — конфликтов не будет.
 */
function withExtensions(slug: Subject["slug"], base: Grade[]): Grade[] {
  const extra = GRADE_EXTENSIONS[slug];
  const extraMap = EXTRA_EXAMPLES;

  // Дополнения примерами живут отдельным слоем: ключ `класс/slug`.
  // Применяем их первыми, чтобы достраивание классов ниже их не потеряло.
  const withExamples: Grade[] = extraMap
    ? base.map((g) => {
        const touched = g.topics.map((t) => {
          const add = extraMap[`${slug}/${g.num}/${t.slug}`];
          if (!add || add.length === 0) return t;
          const have = new Set(t.examples.map((ex) => ex.text));
          return { ...t, examples: [...t.examples, ...add.filter((ex) => !have.has(ex.text))] };
        });
        return { ...g, topics: touched };
      })
    : base;

  if (!extra || extra.length === 0) return withExamples;

  const merged = new Map<number, Grade>();
  for (const g of withExamples) merged.set(g.num, g);

  for (const g of extra) {
    const existing = merged.get(g.num);
    if (!existing) {
      merged.set(g.num, g);
      continue;
    }
    // Дописываем только темы, которых ещё нет по slug: иначе повторная
    // загрузка модуля или пересечение двух файлов даст дубли URL.
    const have = new Set(existing.topics.map((t) => t.slug));
    const additions = g.topics.filter((t) => !have.has(t.slug));
    merged.set(g.num, {
      ...existing,
      topics: [...existing.topics, ...additions],
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.num - b.num);
}

export const subjects: Subject[] = [
  {
    slug: "math",
    title: "Математика",
    shortTitle: "Математика",
    emoji: "🔢",
    color: "brand",
    description:
      "От таблицы умножения до дробей и уравнений. Задания под школьную программу с проверкой ответов.",
    grades: withExtensions("math", mathGrades),
  },
  {
    slug: "algebra",
    title: "Алгебра",
    shortTitle: "Алгебра",
    emoji: "🧮",
    color: "brand",
    description: "Уравнения, неравенства, функции, прогрессии. Для 7–9 классов.",
    grades: withExtensions("algebra", algebraGrades),
  },
  {
    slug: "geometry",
    title: "Геометрия",
    shortTitle: "Геометрия",
    emoji: "📐",
    color: "brand",
    description: "Треугольники, четырёхугольники, окружности, теоремы. Для 7–9 классов.",
    grades: withExtensions("geometry", geometryGrades),
  },
  {
    slug: "russian",
    title: "Русский язык",
    shortTitle: "Русский",
    emoji: "📖",
    color: "accent",
    description:
      "Орфография, грамматика, морфемика, пунктуация. По уровням школьной программы.",
    grades: withExtensions("russian", russianGrades),
  },
  {
    slug: "literature",
    title: "Литература",
    shortTitle: "Литература",
    emoji: "📚",
    color: "accent",
    description: "Анализ произведений, авторы, жанры, литературные направления.",
    grades: withExtensions("literature", literatureGrades),
  },
  {
    slug: "english",
    title: "Английский язык",
    shortTitle: "Английский",
    emoji: "🇬🇧",
    color: "warm",
    description: "Грамматика, лексика, времена. От Present Simple до Conditionals.",
    grades: withExtensions("english", englishGrades),
  },
  {
    slug: "informatics",
    title: "Информатика",
    shortTitle: "Информатика",
    emoji: "💻",
    color: "info",
    description: "Устройство ПК, системы счисления, алгоритмы, программирование.",
    grades: withExtensions("informatics", informaticsGrades),
  },
  {
    slug: "physics",
    title: "Физика",
    shortTitle: "Физика",
    emoji: "⚛️",
    color: "info",
    description: "Механика, тепло, электричество. Формулы с расшифровкой.",
    grades: withExtensions("physics", physicsGrades),
  },
  {
    slug: "chemistry",
    title: "Химия",
    shortTitle: "Химия",
    emoji: "🧪",
    color: "info",
    description: "Атомы, молекулы, таблица Менделеева, реакции.",
    grades: withExtensions("chemistry", chemistryGrades),
  },
  {
    slug: "biology",
    title: "Биология",
    shortTitle: "Биология",
    emoji: "🌿",
    color: "info",
    description: "Растения, животные, генетика, человек.",
    grades: withExtensions("biology", biologyGrades),
  },
  {
    slug: "geography",
    title: "География",
    shortTitle: "География",
    emoji: "🗺️",
    color: "info",
    description: "План и карта, материки, Россия и её регионы.",
    grades: withExtensions("geography", geographyGrades),
  },
  {
    slug: "history",
    title: "История",
    shortTitle: "История",
    emoji: "🏛️",
    color: "info",
    description: "От Древнего мира до XX века. Россия и мир.",
    grades: withExtensions("history", historyGrades),
  },
  {
    slug: "social",
    title: "Обществознание",
    shortTitle: "Общество",
    emoji: "⚖️",
    color: "info",
    description: "Семья, государство, право, экономика.",
    grades: withExtensions("social", societyGrades),
  },
  {
    slug: "okruzhaet",
    title: "Окружающий мир",
    shortTitle: "Окр. мир",
    emoji: "🌍",
    color: "warm",
    description: "Природа, тело человека, времена года, природные зоны. 1–4 классы.",
    grades: withExtensions("okruzhaet", okruzhaetGrades),
  },
  {
    slug: "german",
    title: "Немецкий язык",
    shortTitle: "Немецкий",
    emoji: "🇩🇪",
    color: "warm",
    description: "Грамматика, лексика. Аналогично английскому, но на немецком.",
    grades: withExtensions("german", germanGrades),
  },
  {
    slug: "obzh",
    title: "ОБЖ / ОБЗР",
    shortTitle: "ОБЖ",
    emoji: "🚨",
    color: "accent",
    description: "Безопасность на дороге, пожарная безопасность, военная служба. 5–11 классы.",
    grades: withExtensions("obzh", obzhGrades),
  },
  {
    slug: "technology",
    title: "Технология",
    shortTitle: "Технология",
    emoji: "🛠️",
    color: "warm",
    description: "Труд, кулинария, материаловедение. 5–9 классы.",
    grades: withExtensions("technology", technologyGrades),
  },
  {
    slug: "finance",
    title: "Финансовая грамотность",
    shortTitle: "Фин. грамотность",
    emoji: "💰",
    color: "brand",
    description: "Бюджет, кредиты, депозиты, налоги. 7–11 классы.",
    grades: withExtensions("finance", financeGrades),
  },
  {
    slug: "music",
    title: "Музыка",
    shortTitle: "Музыка",
    emoji: "🎵",
    color: "accent",
    description: "Ноты, ритм, мелодия, композиторы. 1–8 классы.",
    grades: withExtensions("music", musicGrades),
  },
  {
    slug: "art",
    title: "Изобразительное искусство",
    shortTitle: "ИЗО",
    emoji: "🎨",
    color: "accent",
    description: "Цвет, композиция, рисунок, перспектива. 1–8 классы.",
    grades: withExtensions("art", artGrades),
  },
  {
    slug: "pe",
    title: "Физическая культура",
    shortTitle: "Физ-ра",
    emoji: "⚽",
    color: "info",
    description: "Нормы ГТО, основы движения, спортивные игры. 1–11 классы.",
    grades: withExtensions("pe", peGrades),
  },
];

// ====================== HELPERS ======================

export function getSubject(slug: string): Subject | undefined {
  return subjects.find((s) => s.slug === slug);
}

export function getGrade(subjectSlug: string, gradeNum: number) {
  const subject = getSubject(subjectSlug);
  if (!subject) return undefined;
  return subject.grades.find((g) => g.num === gradeNum);
}

export function getTopic(subjectSlug: string, gradeNum: number, topicSlug: string) {
  const grade = getGrade(subjectSlug, gradeNum);
  if (!grade) return undefined;
  return grade.topics.find((t) => t.slug === topicSlug);
}

export function allTopics(): Array<{
  subject: Subject;
  grade: number;
  topic: Topic;
}> {
  const items: Array<{ subject: Subject; grade: number; topic: Topic }> = [];
  for (const subject of subjects) {
    for (const grade of subject.grades) {
      for (const topic of grade.topics) {
        items.push({ subject, grade: grade.num, topic });
      }
    }
  }
  return items;
}
