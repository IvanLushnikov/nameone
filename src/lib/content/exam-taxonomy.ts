/**
 * Таксономия ФИПИ для SEO-страниц по номерам ОГЭ/ЕГЭ.
 * Каждый номер = отдельная страница `/exam/[exam]/[subject]/[number]`.
 * Источник: кодификатор ФИПИ 2026 (названия заданий приблизительные,
 * для SEO-каркаса — реальные формулировки подставляются при генерации листов).
 */

export type ExamKind = "oge" | "ege";

/**
 * Один номер (задание) экзамена.
 * `slug` — транслит названия в kebab-case, ≤ 40 символов, уникален в пределах предмета.
 * `fgosRef` — человекочитаемая ссылка на раздел ФИПИ/кодификатор.
 */
export interface ExamNumber {
  exam: ExamKind;
  subject: string;
  number: number;
  slug: string;
  title: string;
  fgosRef: string;
  description: string;
}

/**
 * Предмет экзамена: ОГЭ/ЕГЭ + предмет + список номеров.
 */
export interface ExamSubject {
  slug: string; // "oge-math" | "ege-math-p" | ...
  exam: ExamKind;
  subject: string;
  title: string;
  emoji: string;
  numbers: ExamNumber[];
}

// ====================== ОГЭ МАТЕМАТИКА (1–19) ======================

const ogeMathNumbers: ExamNumber[] = [
  { exam: "oge", subject: "math", number: 1, slug: "lineynye-uravneniya", title: "Линейные уравнения", fgosRef: "Раздел 2.1 · Алгебраические выражения", description: "Решение линейного уравнения с одной переменной. Проверяется умение применять правила переноса слагаемых и раскрытия скобок." },
  { exam: "oge", subject: "math", number: 2, slug: "chislovye-neravenstva", title: "Числовые неравенства", fgosRef: "Раздел 2.2 · Неравенства", description: "Сравнение рациональных чисел, оценка значения выражения. Проверяется понимание свойств числовых неравенств." },
  { exam: "oge", subject: "math", number: 3, slug: "chisla-i-vychisleniya", title: "Числа и вычисления", fgosRef: "Раздел 1.1 · Числа и вычисления", description: "Действия с обыкновенными и десятичными дробями, степенями с целым показателем. Проверяется вычислительная культура." },
  { exam: "oge", subject: "math", number: 4, slug: "protsenty-i-drobi", title: "Проценты и дроби", fgosRef: "Раздел 1.2 · Проценты", description: "Нахождение процента от числа, задачи на проценты. Проверяется умение переводить проценты в дроби и обратно." },
  { exam: "oge", subject: "math", number: 5, slug: "grafiki-funktsiy", title: "Графики функций", fgosRef: "Раздел 3.1 · Функции", description: "Чтение и интерпретация графиков реальных зависимостей. Проверяется умение извлекать информацию по графику." },
  { exam: "oge", subject: "math", number: 6, slug: "arifmeticheskaya-progressiya", title: "Арифметическая прогрессия", fgosRef: "Раздел 2.3 · Последовательности", description: "Задачи на арифметическую прогрессию: нахождение члена, разности, суммы. Проверяется знание формулы n-го члена." },
  { exam: "oge", subject: "math", number: 7, slug: "geometricheskaya-progressiya", title: "Геометрическая прогрессия", fgosRef: "Раздел 2.3 · Последовательности", description: "Задачи на геометрическую прогрессию. Проверяется знание формулы n-го члена и суммы первых n членов." },
  { exam: "oge", subject: "math", number: 8, slug: "algebraicheskie-vyrazheniya", title: "Алгебраические выражения", fgosRef: "Раздел 2.1 · Алгебраические выражения", description: "Преобразование выражений, раскрытие скобок, приведение подобных. Проверяется владение формальным языком алгебры." },
  { exam: "oge", subject: "math", number: 9, slug: "kvadratnye-uravneniya", title: "Квадратные уравнения", fgosRef: "Раздел 2.4 · Уравнения", description: "Решение квадратных уравнений через дискриминант. Проверяется знание формулы корней." },
  { exam: "oge", subject: "math", number: 10, slug: "ratsionalnye-uravneniya", title: "Рациональные уравнения", fgosRef: "Раздел 2.4 · Уравнения", description: "Дробно-рациональные уравнения, приведение к общему знаменателю. Проверяется умение решать уравнения с дробями." },
  { exam: "oge", subject: "math", number: 11, slug: "funktsii-i-grafiki", title: "Функции и их графики", fgosRef: "Раздел 3.1 · Функции", description: "Свойства функций: область определения, возрастание, нули. Проверяется умение читать график и соотносить формулу с графиком." },
  { exam: "oge", subject: "math", number: 12, slug: "neravenstva-s-peremennoy", title: "Неравенства с одной переменной", fgosRef: "Раздел 2.2 · Неравенства", description: "Линейные и квадратные неравенства, метод интервалов. Проверяется умение решать неравенства разных типов." },
  { exam: "oge", subject: "math", number: 13, slug: "sistemy-uravneniy", title: "Системы уравнений", fgosRef: "Раздел 2.4 · Уравнения", description: "Решение систем уравнений подстановкой и сложением. Проверяется умение решать системы двух уравнений с двумя переменными." },
  { exam: "oge", subject: "math", number: 14, slug: "zadachi-na-protsenty", title: "Задачи на проценты и части", fgosRef: "Раздел 1.2 · Текстовые задачи", description: "Текстовые задачи на проценты, части и пропорции. Проверяется умение составлять математическую модель." },
  { exam: "oge", subject: "math", number: 15, slug: "treugolniki-oge", title: "Треугольники", fgosRef: "Раздел 4.1 · Геометрические фигуры", description: "Элементы треугольника, признаки равенства, неравенство треугольника. Проверяется умение применять свойства треугольников." },
  { exam: "oge", subject: "math", number: 16, slug: "okruzhnost-oge", title: "Окружность и её элементы", fgosRef: "Раздел 4.2 · Окружность", description: "Касательная, хорда, центральные и вписанные углы. Проверяется знание свойств окружности." },
  { exam: "oge", subject: "math", number: 17, slug: "ploschadi-figur-oge", title: "Площади фигур", fgosRef: "Раздел 4.3 · Площади", description: "Площадь треугольника, прямоугольника, трапеции. Проверяется знание формул площадей и умение их применять." },
  { exam: "oge", subject: "math", number: 18, slug: "vektory-ploskost", title: "Векторы на плоскости", fgosRef: "Раздел 4.4 · Векторы", description: "Действия с векторами: сложение, вычитание, умножение на число. Проверяется умение работать с векторами координатно и геометрически." },
  { exam: "oge", subject: "math", number: 19, slug: "geometricheskie-zadachi", title: "Прикладные геометрические задачи", fgosRef: "Раздел 4.5 · Прикладная геометрия", description: "Задачи с геометрическим содержанием из практики. Проверяется умение строить математическую модель реальной ситуации." },
];

// ====================== ОГЭ РУССКИЙ ЯЗЫК (1–9) ======================

const ogeRussianNumbers: ExamNumber[] = [
  { exam: "oge", subject: "russian", number: 1, slug: "szhatoe-izlozhenie", title: "Сжатое изложение", fgosRef: "Раздел 5.1 · Речь и текст", description: "Аудирование и письменное сжатие текста. Проверяется умение выделять главную мысль и сохранять микротемы." },
  { exam: "oge", subject: "russian", number: 2, slug: "sintaksicheskiy-analiz", title: "Синтаксический анализ", fgosRef: "Раздел 5.2 · Синтаксис", description: "Определение типа подчинения в сложноподчинённом предложении. Проверяется умение различать виды придаточных." },
  { exam: "oge", subject: "russian", number: 3, slug: "punktuatsionnyy-analiz", title: "Пунктуационный анализ", fgosRef: "Раздел 5.3 · Пунктуация", description: "Расстановка запятых в предложениях с обособленными членами. Проверяется знание правил пунктуации." },
  { exam: "oge", subject: "russian", number: 4, slug: "orfograficheskiy-analiz", title: "Орфографический анализ", fgosRef: "Раздел 5.4 · Орфография", description: "Определение условий выбора орфограмм: приставки, корни, суффиксы, окончания. Проверяется орфографическая грамотность." },
  { exam: "oge", subject: "russian", number: 5, slug: "yazykovye-sredstva", title: "Языковые средства", fgosRef: "Раздел 5.5 · Лексика и фразеология", description: "Определение лексического значения слова, подбор синонимов и антонимов. Проверяется словарный запас." },
  { exam: "oge", subject: "russian", number: 6, slug: "vyrazitelnye-sredstva", title: "Выразительные средства", fgosRef: "Раздел 5.6 · Средства выразительности", description: "Определение эпитета, метафоры, олицетворения и других тропов. Проверяется умение видеть средства художественной выразительности." },
  { exam: "oge", subject: "russian", number: 7, slug: "sintaksicheskiy-razbor", title: "Синтаксический разбор", fgosRef: "Раздел 5.2 · Синтаксис", description: "Разбор словосочетания и предложения: члены предложения, типы связи. Проверяется грамматическая компетенция." },
  { exam: "oge", subject: "russian", number: 8, slug: "grammaticheskie-oshibki", title: "Грамматические ошибки", fgosRef: "Раздел 5.7 · Грамматика", description: "Поиск и исправление грамматических ошибок: управление, согласование, деепричастный оборот. Проверяется речевая грамотность." },
  { exam: "oge", subject: "russian", number: 9, slug: "sochinenie-rassuzhdenie", title: "Сочинение-рассуждение", fgosRef: "Раздел 5.8 · Сочинение", description: "Сочинение-рассуждение на лингвистическую тему: тезис, аргументы, вывод. Проверяется умение строить связный текст." },
];

// ====================== ОГЭ ФИЗИКА (1–25) ======================

const ogePhysicsNumbers: ExamNumber[] = [
  { exam: "oge", subject: "physics", number: 1, slug: "mekhanicheskoe-dvizhenie", title: "Механическое движение", fgosRef: "Раздел 1.1 · Кинематика", description: "Равномерное и равнопеременное движение. Скорость, путь, время. Проверяется умение читать графики движения." },
  { exam: "oge", subject: "physics", number: 2, slug: "zakony-nyutona", title: "Законы Ньютона", fgosRef: "Раздел 1.2 · Динамика", description: "Применение законов Ньютона для описания взаимодействия тел. Проверяется умение находить равнодействующую." },
  { exam: "oge", subject: "physics", number: 3, slug: "sily-v-prirode", title: "Силы в природе", fgosRef: "Раздел 1.3 · Силы", description: "Сила тяжести, упругости, трения, Архимедова сила. Проверяется умение определять направление и модуль сил." },
  { exam: "oge", subject: "physics", number: 4, slug: "davlenie-tverdykh-tel", title: "Давление твёрдых тел", fgosRef: "Раздел 2.1 · Давление", description: "Расчёт давления по площади опоры. Проверяется понимание физического смысла давления." },
  { exam: "oge", subject: "physics", number: 5, slug: "davlenie-zhidkostey", title: "Давление жидкостей", fgosRef: "Раздел 2.2 · Гидростатика", description: "Закон Паскаля, давление столба жидкости. Проверяется умение вычислять гидростатическое давление." },
  { exam: "oge", subject: "physics", number: 6, slug: "arkhimedova-sila", title: "Архимедова сила", fgosRef: "Раздел 2.3 · Гидростатика", description: "Условия плавания тел, расчёт выталкивающей силы. Проверяется умение применять закон Архимеда." },
  { exam: "oge", subject: "physics", number: 7, slug: "mekhanicheskaya-rabota", title: "Механическая работа", fgosRef: "Раздел 3.1 · Работа и энергия", description: "Работа постоянной силы, мощность. Проверяется знание формул работы и мощности." },
  { exam: "oge", subject: "physics", number: 8, slug: "kineticheskaya-energiya", title: "Кинетическая и потенциальная энергия", fgosRef: "Раздел 3.2 · Энергия", description: "Расчёт кинетической и потенциальной энергии. Проверяется умение применять формулы энергии." },
  { exam: "oge", subject: "physics", number: 9, slug: "teplovye-yavleniya", title: "Тепловые явления", fgosRef: "Раздел 4.1 · Теплота", description: "Количество теплоты, удельная теплоёмкость. Проверяется умение составлять уравнение теплового баланса." },
  { exam: "oge", subject: "physics", number: 10, slug: "nagrevanie-i-plavlenie", title: "Нагревание и плавление", fgosRef: "Раздел 4.2 · Фазовые переходы", description: "Расчёт количества теплоты при нагревании и плавлении. Проверяется знание удельной теплоты плавления." },
  { exam: "oge", subject: "physics", number: 11, slug: "isparenie-i-kipenie", title: "Испарение и кипение", fgosRef: "Раздел 4.2 · Фазовые переходы", description: "Парообразование, кипение, удельная теплота парообразования. Проверяется понимание фазовых переходов." },
  { exam: "oge", subject: "physics", number: 12, slug: "vlazhnost-vozdukha", title: "Влажность воздуха", fgosRef: "Раздел 4.3 · Влажность", description: "Абсолютная и относительная влажность, точка росы. Проверяется умение пользоваться психрометром." },
  { exam: "oge", subject: "physics", number: 13, slug: "teplovye-dvigateli", title: "Тепловые двигатели", fgosRef: "Раздел 4.4 · Тепловые машины", description: "КПД теплового двигателя, цикл Карно. Проверяется знание принципа работы тепловых машин." },
  { exam: "oge", subject: "physics", number: 14, slug: "elektricheskiy-zaryad", title: "Электрический заряд", fgosRef: "Раздел 5.1 · Электростатика", description: "Закон сохранения заряда, взаимодействие зарядов. Проверяется понимание электризации тел." },
  { exam: "oge", subject: "physics", number: 15, slug: "zakon-kulona", title: "Закон Кулона", fgosRef: "Раздел 5.1 · Электростатика", description: "Расчёт силы взаимодействия точечных зарядов. Проверяется знание формулы закона Кулона." },
  { exam: "oge", subject: "physics", number: 16, slug: "elektricheskiy-tok", title: "Электрический ток", fgosRef: "Раздел 5.2 · Постоянный ток", description: "Сила тока, напряжение, сопротивление. Проверяется умение работать с электрическими схемами." },
  { exam: "oge", subject: "physics", number: 17, slug: "sila-toka-napryazhenie", title: "Сила тока и напряжение", fgosRef: "Раздел 5.2 · Постоянный ток", description: "Измерение силы тока и напряжения, амперметр и вольтметр. Проверяется знание правил подключения приборов." },
  { exam: "oge", subject: "physics", number: 18, slug: "soprotivlenie-provodnikov", title: "Сопротивление проводников", fgosRef: "Раздел 5.2 · Постоянный ток", description: "Удельное сопротивление, зависимость от температуры. Проверяется умение вычислять сопротивление." },
  { exam: "oge", subject: "physics", number: 19, slug: "zakon-oma", title: "Закон Ома", fgosRef: "Раздел 5.2 · Постоянный ток", description: "Расчёт тока, напряжения и сопротивления по закону Ома. Проверяется умение применять закон для участка цепи." },
  { exam: "oge", subject: "physics", number: 20, slug: "moschnost-toka", title: "Мощность электрического тока", fgosRef: "Раздел 5.2 · Постоянный ток", description: "Расчёт мощности и работы тока. Проверяется знание формул P = UI и A = UIt." },
  { exam: "oge", subject: "physics", number: 21, slug: "magnitnoe-pole", title: "Магнитное поле", fgosRef: "Раздел 5.3 · Магнетизм", description: "Магнитное поле проводника с током, сила Ампера. Проверяется умение определять направление поля." },
  { exam: "oge", subject: "physics", number: 22, slug: "elektromagnitnaya-induktsiya", title: "Электромагнитная индукция", fgosRef: "Раздел 5.3 · Магнетизм", description: "Закон электромагнитной индукции Фарадея. Проверяется умение определять направление индукционного тока." },
  { exam: "oge", subject: "physics", number: 23, slug: "svetovye-yavleniya", title: "Световые явления", fgosRef: "Раздел 6.1 · Оптика", description: "Прямолинейное распространение света, тень, полутень. Проверяется понимание законов геометрической оптики." },
  { exam: "oge", subject: "physics", number: 24, slug: "otrazhenie-sveta", title: "Отражение и преломление света", fgosRef: "Раздел 6.1 · Оптика", description: "Законы отражения и преломления, построение изображений. Проверяется умение строить ход лучей." },
  { exam: "oge", subject: "physics", number: 25, slug: "opticheskie-pribory", title: "Оптические приборы", fgosRef: "Раздел 6.2 · Оптика", description: "Линзы, фокусное расстояние, оптическая сила. Проверяется умение применять формулу тонкой линзы." },
];

// ====================== ОГЭ ИНФОРМАТИКА (1–15) ======================

const ogeInformaticsNumbers: ExamNumber[] = [
  { exam: "oge", subject: "informatics", number: 1, slug: "predstavlenie-informatsii", title: "Представление информации", fgosRef: "Раздел 1.1 · Информация", description: "Виды информации, единицы измерения. Проверяется знание базовых понятий информатики." },
  { exam: "oge", subject: "informatics", number: 2, slug: "kodirovanie-informatsii-oge", title: "Кодирование информации", fgosRef: "Раздел 1.2 · Кодирование", description: "Двоичное кодирование, равномерные и неравномерные коды. Проверяется умение декодировать сообщения." },
  { exam: "oge", subject: "informatics", number: 3, slug: "izmerenie-informatsii-oge", title: "Измерение информации", fgosRef: "Раздел 1.3 · Измерение", description: "Алфавитный и вероятностный подходы к измерению. Проверяется знание формулы Хартли." },
  { exam: "oge", subject: "informatics", number: 4, slug: "sistemy-schisleniya-oge", title: "Системы счисления", fgosRef: "Раздел 1.4 · Системы счисления", description: "Перевод между двоичной, восьмеричной, шестнадцатеричной системами. Проверяется умение выполнять перевод." },
  { exam: "oge", subject: "informatics", number: 5, slug: "logicheskie-operatsii", title: "Логика и логические операции", fgosRef: "Раздел 1.5 · Логика", description: "Логические операции И, ИЛИ, НЕ, таблицы истинности. Проверяется знание законов алгебры логики." },
  { exam: "oge", subject: "informatics", number: 6, slug: "algoritmy-oge", title: "Алгоритмы", fgosRef: "Раздел 2.1 · Алгоритмизация", description: "Свойства алгоритма, способы записи. Проверяется умение анализировать алгоритмы." },
  { exam: "oge", subject: "informatics", number: 7, slug: "ispolnitel-algoritmov", title: "Исполнитель алгоритмов", fgosRef: "Раздел 2.2 · Исполнители", description: "Система команд исполнителя, среда. Проверяется умение строить траектории и работать с переменными." },
  { exam: "oge", subject: "informatics", number: 8, slug: "tsiklicheskie-algoritmy", title: "Циклические алгоритмы", fgosRef: "Раздел 2.3 · Циклы", description: "Алгоритмы с повторением: циклы с предусловием и постусловием. Проверяется умение определять результат." },
  { exam: "oge", subject: "informatics", number: 9, slug: "vetvleniya-v-algoritmakh", title: "Ветвления в алгоритмах", fgosRef: "Раздел 2.4 · Ветвления", description: "Полная и неполная форма ветвления. Проверяется умение составлять алгоритмы с условием." },
  { exam: "oge", subject: "informatics", number: 10, slug: "massivy-oge", title: "Массивы", fgosRef: "Раздел 3.1 · Структуры данных", description: "Одномерные массивы, поиск максимума, суммы. Проверяется умение работать с массивами." },
  { exam: "oge", subject: "informatics", number: 11, slug: "podprogrammy-oge", title: "Подпрограммы", fgosRef: "Раздел 3.2 · Подпрограммы", description: "Процедуры и функции, параметры. Проверяется понимание модульности программы." },
  { exam: "oge", subject: "informatics", number: 12, slug: "osnovy-programmirovaniya-oge", title: "Основы программирования", fgosRef: "Раздел 3.3 · Программирование", description: "Переменные, типы данных, выражения. Проверяется знание синтаксиса одного из языков." },
  { exam: "oge", subject: "informatics", number: 13, slug: "yazyki-programmirovaniya", title: "Языки программирования", fgosRef: "Раздел 3.4 · Языки", description: "Классификация языков, парадигмы. Проверяется общее представление о языках программирования." },
  { exam: "oge", subject: "informatics", number: 14, slug: "elektronnye-tablitsy-oge", title: "Электронные таблицы", fgosRef: "Раздел 4.1 · Таблицы", description: "Формулы, диаграммы, абсолютные и относительные ссылки. Проверяется умение работать в Excel-подобных средах." },
  { exam: "oge", subject: "informatics", number: 15, slug: "bazy-dannykh-oge", title: "Базы данных", fgosRef: "Раздел 4.2 · Базы данных", description: "Таблицы, запросы, ключи. Проверяется понимание реляционной модели данных." },
];

// ====================== ОГЭ ОБЩЕСТВОЗНАНИЕ (1–24) ======================

const ogeSocialNumbers: ExamNumber[] = [
  { exam: "oge", subject: "social", number: 1, slug: "chelovek-i-obshchestvo", title: "Человек и общество", fgosRef: "Раздел 1.1 · Введение", description: "Понятия «человек», «личность», «общество». Проверяется знание базовых категорий обществознания." },
  { exam: "oge", subject: "social", number: 2, slug: "poznanie-mira", title: "Познание мира", fgosRef: "Раздел 1.2 · Познание", description: "Формы и виды познания, истина. Проверяется знание методов научного познания." },
  { exam: "oge", subject: "social", number: 3, slug: "deyatelnost-cheloveka", title: "Деятельность человека", fgosRef: "Раздел 1.3 · Деятельность", description: "Структура деятельности, мотивы, цели. Проверяется понимание видов деятельности." },
  { exam: "oge", subject: "social", number: 4, slug: "potrebnosti-cheloveka", title: "Потребности человека", fgosRef: "Раздел 1.4 · Потребности", description: "Иерархия потребностей по Маслоу, виды потребностей. Проверяется умение их классифицировать." },
  { exam: "oge", subject: "social", number: 5, slug: "sotsialnye-normy", title: "Социальные нормы", fgosRef: "Раздел 1.5 · Нормы", description: "Право, мораль, обычаи, традиции. Проверяется знание видов социальных норм." },
  { exam: "oge", subject: "social", number: 6, slug: "semya-i-brak", title: "Семья и брак", fgosRef: "Раздел 2.1 · Семья", description: "Функции семьи, типы семей, брачно-семейное право. Проверяется знание основ семейного права." },
  { exam: "oge", subject: "social", number: 7, slug: "etnicheskie-obshchnosti", title: "Этнические общности", fgosRef: "Раздел 2.2 · Этнос", description: "Этнос, нация, народность. Межнациональные отношения. Проверяется знание этнических категорий." },
  { exam: "oge", subject: "social", number: 8, slug: "sotsialnaya-struktura", title: "Социальная структура", fgosRef: "Раздел 2.3 · Социальная структура", description: "Социальные группы, страты, слои. Проверяется умение анализировать структуру общества." },
  { exam: "oge", subject: "social", number: 9, slug: "sotsialnyy-status", title: "Социальный статус", fgosRef: "Раздел 2.4 · Статус", description: "Предписанный и достигаемый статус, престиж. Проверяется знание видов статусов." },
  { exam: "oge", subject: "social", number: 10, slug: "sotsialnye-roli", title: "Социальные роли", fgosRef: "Раздел 2.5 · Роли", description: "Социальные роли, ролевые конфликты. Проверяется понимание ролевой теории." },
  { exam: "oge", subject: "social", number: 11, slug: "gosudarstvo-i-funktsii", title: "Государство и его функции", fgosRef: "Раздел 3.1 · Государство", description: "Понятие и признаки государства, функции. Проверяется знание теории государства." },
  { exam: "oge", subject: "social", number: 12, slug: "formy-gosudarstva", title: "Формы государства", fgosRef: "Раздел 3.2 · Формы государства", description: "Формы правления, формы устройства, политические режимы. Проверяется умение их различать." },
  { exam: "oge", subject: "social", number: 13, slug: "pravo-v-obshchestve", title: "Право в системе общества", fgosRef: "Раздел 3.3 · Право", description: "Понятие права, отраслевая система. Проверяется знание отраслей российского права." },
  { exam: "oge", subject: "social", number: 14, slug: "pravovaya-norma", title: "Правовая норма", fgosRef: "Раздел 3.4 · Нормы права", description: "Структура нормы: гипотеза, диспозиция, санкция. Проверяется знание элементов нормы." },
  { exam: "oge", subject: "social", number: 15, slug: "konstitutsiya-rf", title: "Конституция РФ", fgosRef: "Раздел 3.5 · Конституция", description: "Основы конституционного строя, права и свободы. Проверяется знание глав Конституции РФ." },
  { exam: "oge", subject: "social", number: 16, slug: "prava-i-svobody", title: "Права и свободы человека", fgosRef: "Раздел 3.6 · Права человека", description: "Личные, политические, социально-экономические права. Проверяется знание классификации прав." },
  { exam: "oge", subject: "social", number: 17, slug: "grazhdanstvo-rf", title: "Гражданство РФ", fgosRef: "Раздел 3.7 · Гражданство", description: "Основания приобретения и прекращения гражданства. Проверяется знание закона о гражданстве." },
  { exam: "oge", subject: "social", number: 18, slug: "sudebnaya-sistema", title: "Судебная система РФ", fgosRef: "Раздел 3.8 · Суды", description: "Суды общей юрисдикции, арбитраж, Конституционный суд. Проверяется знание судебной системы." },
  { exam: "oge", subject: "social", number: 19, slug: "pravookhranitelnye-organy", title: "Правоохранительные органы", fgosRef: "Раздел 3.9 · Правоохрана", description: "Полиция, прокуратура, ФСБ, следственный комитет. Проверяется знание функций органов." },
  { exam: "oge", subject: "social", number: 20, slug: "ekonomika-kak-nauka", title: "Экономика как наука", fgosRef: "Раздел 4.1 · Экономика", description: "Микро- и макроэкономика, экономические системы. Проверяется знание базовых экономических понятий." },
  { exam: "oge", subject: "social", number: 21, slug: "faktory-proizvodstva", title: "Факторы производства", fgosRef: "Раздел 4.2 · Производство", description: "Труд, земля, капитал, информация. Проверяется знание факторов и их доходов." },
  { exam: "oge", subject: "social", number: 22, slug: "rynok-i-mekhanizm", title: "Рынок и рыночный механизм", fgosRef: "Раздел 4.3 · Рынок", description: "Спрос, предложение, равновесная цена. Проверяется знание законов рынка." },
  { exam: "oge", subject: "social", number: 23, slug: "dengi-i-banki", title: "Деньги и банки", fgosRef: "Раздел 4.4 · Финансы", description: "Функции денег, Центральный банк, коммерческие банки. Проверяется знание банковской системы." },
  { exam: "oge", subject: "social", number: 24, slug: "nalogi-i-byudzhet", title: "Налоги и бюджет", fgosRef: "Раздел 4.5 · Бюджет", description: "Виды налогов, бюджетная система. Проверяется знание налоговой политики государства." },
];

// ====================== ЕГЭ МАТЕМАТИКА ПРОФИЛЬНАЯ (1–19) ======================

const egeMathPNumbers: ExamNumber[] = [
  { exam: "ege", subject: "math-p", number: 1, slug: "prosteyshie-uravneniya-p", title: "Простейшие уравнения", fgosRef: "Раздел 2.1 · Уравнения", description: "Линейные, квадратные, рациональные уравнения. Проверяется умение решать стандартные уравнения." },
  { exam: "ege", subject: "math-p", number: 2, slug: "stereometriya-koordinaty", title: "Стереометрия: координаты и векторы", fgosRef: "Раздел 4.1 · Стереометрия", description: "Координаты точек в пространстве, действия с векторами. Проверяется умение применять координатный метод." },
  { exam: "ege", subject: "math-p", number: 3, slug: "planimetriya-ploskost", title: "Планиметрия: треугольники и окружности", fgosRef: "Раздел 4.2 · Планиметрия", description: "Свойства треугольников, вписанные и описанные окружности. Проверяется умение решать геометрические задачи." },
  { exam: "ege", subject: "math-p", number: 4, slug: "teoriya-veroyatnostey-p", title: "Теория вероятностей", fgosRef: "Раздел 5.1 · Вероятность", description: "Классическая вероятность, формула сложения. Проверяется умение решать задачи на вероятность." },
  { exam: "ege", subject: "math-p", number: 5, slug: "proizvodnaya-funktsii-p", title: "Производная функции", fgosRef: "Раздел 3.1 · Производная", description: "Геометрический и физический смысл производной. Проверяется знание правил дифференцирования." },
  { exam: "ege", subject: "math-p", number: 6, slug: "pokazatelnye-uravneniya", title: "Показательные уравнения", fgosRef: "Раздел 2.2 · Уравнения", description: "Решение показательных уравнений: вынесение общего множителя, замена переменной. Проверяется владение методами." },
  { exam: "ege", subject: "math-p", number: 7, slug: "logarifmicheskie-uravneniya", title: "Логарифмические уравнения", fgosRef: "Раздел 2.3 · Уравнения", description: "Логарифмические уравнения, метод замены переменной. Проверяется знание свойств логарифмов." },
  { exam: "ege", subject: "math-p", number: 8, slug: "trigonometricheskie-uravneniya", title: "Тригонометрические уравнения", fgosRef: "Раздел 2.4 · Тригонометрия", description: "Простейшие тригонометрические уравнения, методы решения. Проверяется умение работать с формулами." },
  { exam: "ege", subject: "math-p", number: 9, slug: "irratsionalnye-uravneniya", title: "Иррациональные уравнения", fgosRef: "Раздел 2.5 · Уравнения", description: "Уравнения с корнями, равносильные переходы. Проверяется умение учитывать область определения." },
  { exam: "ege", subject: "math-p", number: 10, slug: "proizvodnye-i-integraly", title: "Производные и интегралы", fgosRef: "Раздел 3.2 · Интеграл", description: "Применение производной и интеграла в задачах. Проверяется владение аппаратом высшей математики." },
  { exam: "ege", subject: "math-p", number: 11, slug: "zadachi-s-parametrami", title: "Задачи с параметрами", fgosRef: "Раздел 2.6 · Параметры", description: "Уравнения и неравенства с параметром, исследование решений. Проверяется аналитическое мышление." },
  { exam: "ege", subject: "math-p", number: 12, slug: "optimizatsiya-funktsiy", title: "Оптимизация функций", fgosRef: "Раздел 3.3 · Оптимизация", description: "Нахождение наибольших и наименьших значений функции. Проверяется применение производной для оптимизации." },
  { exam: "ege", subject: "math-p", number: 13, slug: "stereometriya-obyomy", title: "Стереометрия: объёмы", fgosRef: "Раздел 4.3 · Стереометрия", description: "Объёмы многогранников и тел вращения. Проверяется знание формул объёмов." },
  { exam: "ege", subject: "math-p", number: 14, slug: "stereometriya-ploschadi", title: "Стереометрия: площади поверхностей", fgosRef: "Раздел 4.4 · Стереометрия", description: "Площади полной и боковой поверхностей. Проверяется умение работать с геометрическими телами." },
  { exam: "ege", subject: "math-p", number: 15, slug: "vektory-v-prostranstve", title: "Векторы в пространстве", fgosRef: "Раздел 4.5 · Стереометрия", description: "Скалярное произведение векторов, углы между прямыми и плоскостями. Проверяется векторный аппарат." },
  { exam: "ege", subject: "math-p", number: 16, slug: "planimetriya-treugolniki", title: "Планиметрия: сложные задачи", fgosRef: "Раздел 4.6 · Планиметрия", description: "Задачи повышенной сложности по планиметрии. Проверяется умение строить сложные геометрические конструкции." },
  { exam: "ege", subject: "math-p", number: 17, slug: "planimetriya-okruzhnosti", title: "Планиметрия: окружности и системы", fgosRef: "Раздел 4.7 · Планиметрия", description: "Вписанные и описанные окружности, касательные. Проверяется владение кругом задач." },
  { exam: "ege", subject: "math-p", number: 18, slug: "ekonomicheskie-zadachi", title: "Экономические задачи", fgosRef: "Раздел 6.1 · Экономика", description: "Задачи на кредиты, вклады, оптимальный выбор. Проверяется построение математической модели." },
  { exam: "ege", subject: "math-p", number: 19, slug: "chisla-i-svoystva", title: "Числа и их свойства", fgosRef: "Раздел 1.1 · Числа", description: "Задачи на делимость, остатки, признаки делимости. Проверяется теоретико-числовая интуиция." },
];

// ====================== ЕГЭ МАТЕМАТИКА БАЗОВАЯ (1–21) ======================

const egeMathBNumbers: ExamNumber[] = [
  { exam: "ege", subject: "math-b", number: 1, slug: "tselye-drobnye-chisla", title: "Целые и дробные числа", fgosRef: "Раздел 1.1 · Числа", description: "Действия с целыми и дробными числами. Проверяется арифметическая грамотность." },
  { exam: "ege", subject: "math-b", number: 2, slug: "protsenty-otnosheniya", title: "Проценты и отношения", fgosRef: "Раздел 1.2 · Проценты", description: "Нахождение процентов, перевод единиц. Проверяется бытовая вычислительная культура." },
  { exam: "ege", subject: "math-b", number: 3, slug: "proportsii-masshtab", title: "Пропорции и масштаб", fgosRef: "Раздел 1.3 · Пропорции", description: "Задачи на пропорции, прямо и обратно пропорциональные величины. Проверяется умение работать с пропорцией." },
  { exam: "ege", subject: "math-b", number: 4, slug: "koordinaty-na-pryamoy", title: "Координаты на прямой", fgosRef: "Раздел 1.4 · Координаты", description: "Координатная прямая, сравнение чисел. Проверяется умение работать с координатной осью." },
  { exam: "ege", subject: "math-b", number: 5, slug: "stepeni-i-korni", title: "Степени и корни", fgosRef: "Раздел 1.5 · Степени", description: "Свойства степеней и корней. Проверяется знание арифметических операций." },
  { exam: "ege", subject: "math-b", number: 6, slug: "lineynye-uravneniya-b", title: "Линейные уравнения и неравенства", fgosRef: "Раздел 2.1 · Уравнения", description: "Линейные уравнения и неравенства. Проверяется владение базовой алгеброй." },
  { exam: "ege", subject: "math-b", number: 7, slug: "kvadratnye-uravneniya-b", title: "Квадратные уравнения", fgosRef: "Раздел 2.2 · Уравнения", description: "Решение квадратных уравнений. Проверяется знание формулы дискриминанта." },
  { exam: "ege", subject: "math-b", number: 8, slug: "grafiki-funktsiy-b", title: "Графики функций", fgosRef: "Раздел 3.1 · Функции", description: "Чтение графиков реальных процессов. Проверяется функциональная грамотность." },
  { exam: "ege", subject: "math-b", number: 9, slug: "arifmeticheskaya-progressiya-b", title: "Арифметическая прогрессия", fgosRef: "Раздел 2.3 · Последовательности", description: "Задачи на арифметическую прогрессию. Проверяется знание формулы n-го члена." },
  { exam: "ege", subject: "math-b", number: 10, slug: "geometricheskaya-progressiya-b", title: "Геометрическая прогрессия", fgosRef: "Раздел 2.3 · Последовательности", description: "Задачи на геометрическую прогрессию. Проверяется знание формулы суммы." },
  { exam: "ege", subject: "math-b", number: 11, slug: "teoriya-veroyatnostey-b", title: "Теория вероятностей", fgosRef: "Раздел 5.1 · Вероятность", description: "Базовая вероятность: классическая схема. Проверяется умение считать вероятность." },
  { exam: "ege", subject: "math-b", number: 12, slug: "kombinatorika-b", title: "Комбинаторика", fgosRef: "Раздел 5.2 · Комбинаторика", description: "Перестановки, размещения, сочетания. Проверяется знание формул комбинаторики." },
  { exam: "ege", subject: "math-b", number: 13, slug: "statistika-b", title: "Статистика и вероятность", fgosRef: "Раздел 5.3 · Статистика", description: "Среднее, медиана, мода, дисперсия. Проверяется умение работать со статистикой." },
  { exam: "ege", subject: "math-b", number: 14, slug: "chtenie-grafikov-b", title: "Чтение графиков и диаграмм", fgosRef: "Раздел 3.2 · Графики", description: "Извлечение информации по графику, круговая диаграмма. Проверяется практическая грамотность." },
  { exam: "ege", subject: "math-b", number: 15, slug: "treugolniki-b", title: "Геометрия: треугольники", fgosRef: "Раздел 4.1 · Геометрия", description: "Свойства треугольников, теорема Пифагора. Проверяется владение базовой геометрией." },
  { exam: "ege", subject: "math-b", number: 16, slug: "chetyrekhugolniki-b", title: "Геометрия: четырёхугольники", fgosRef: "Раздел 4.2 · Геометрия", description: "Свойства параллелограмма, трапеции, прямоугольника. Проверяется знание формул." },
  { exam: "ege", subject: "math-b", number: 17, slug: "okruzhnost-b", title: "Геометрия: окружность", fgosRef: "Раздел 4.3 · Геометрия", description: "Длина окружности, площадь круга, вписанные углы. Проверяется владение геометрией окружности." },
  { exam: "ege", subject: "math-b", number: 18, slug: "ploschadi-b", title: "Геометрия: площади", fgosRef: "Раздел 4.4 · Геометрия", description: "Площадь треугольника, параллелограмма, круга. Проверяется знание формул площадей." },
  { exam: "ege", subject: "math-b", number: 19, slug: "zadachi-na-smekalku", title: "Задачи на смекалку", fgosRef: "Раздел 6.1 · Логика", description: "Логические задачи без сложных вычислений. Проверяется математическая интуиция." },
  { exam: "ege", subject: "math-b", number: 20, slug: "prikladnye-zadachi", title: "Прикладные задачи", fgosRef: "Раздел 6.2 · Прикладная", description: "Задачи с практическим содержанием: расчёт по формулам. Проверяется моделирование реальных ситуаций." },
  { exam: "ege", subject: "math-b", number: 21, slug: "finansovaya-matematika", title: "Финансовая математика", fgosRef: "Раздел 6.3 · Финансы", description: "Проценты по вкладам, кредитам, инфляция. Проверяется финансовая грамотность." },
];

// ====================== ЕГЭ РУССКИЙ ЯЗЫК (1–27) ======================

const egeRussianNumbers: ExamNumber[] = [
  { exam: "ege", subject: "russian", number: 1, slug: "informatsionnaya-obrabotka", title: "Информационная обработка текста", fgosRef: "Раздел 5.1 · Речь и текст", description: "Главная мысль, микротемы, способы сжатия. Проверяется умение работать с текстом." },
  { exam: "ege", subject: "russian", number: 2, slug: "sredstva-svyazi", title: "Средства связи предложений", fgosRef: "Раздел 5.2 · Синтаксис", description: "Лексические и грамматические средства связи. Проверяется умение видеть текстовые скрепы." },
  { exam: "ege", subject: "russian", number: 3, slug: "leksicheskoe-znachenie", title: "Лексическое значение слова", fgosRef: "Раздел 5.3 · Лексика", description: "Многозначность, омонимы, синонимы, антонимы. Проверяется словарный запас." },
  { exam: "ege", subject: "russian", number: 4, slug: "morfologiya-ege", title: "Морфология", fgosRef: "Раздел 5.4 · Морфология", description: "Части речи, морфологические признаки. Проверяется знание морфологической системы." },
  { exam: "ege", subject: "russian", number: 5, slug: "orfografiya-ege", title: "Орфография", fgosRef: "Раздел 5.5 · Орфография", description: "Правописание корней, приставок, суффиксов, окончаний. Проверяется орфографическая грамотность." },
  { exam: "ege", subject: "russian", number: 6, slug: "sintaksicheskie-normy", title: "Синтаксические нормы", fgosRef: "Раздел 5.6 · Синтаксис", description: "Управление, согласование, порядок слов. Проверяется грамматическая правильность." },
  { exam: "ege", subject: "russian", number: 7, slug: "morfologicheskie-normy", title: "Морфологические нормы", fgosRef: "Раздел 5.7 · Морфология", description: "Образование форм слов: падежных, глагольных. Проверяется речевая грамотность." },
  { exam: "ege", subject: "russian", number: 8, slug: "rechevye-oshibki", title: "Речевые ошибки", fgosRef: "Раздел 5.8 · Речь", description: "Тавтология, плеоназм, неточное словоупотребление. Проверяется речевая культура." },
  { exam: "ege", subject: "russian", number: 9, slug: "punktuatsiya-ege", title: "Пунктуация", fgosRef: "Раздел 5.9 · Пунктуация", description: "Запятая, точка с запятой, тире, двоеточие. Проверяется пунктуационная грамотность." },
  { exam: "ege", subject: "russian", number: 10, slug: "sochinenie-ege", title: "Сочинение-рассуждение", fgosRef: "Раздел 5.10 · Сочинение", description: "Сочинение по прочитанному тексту: проблема, позиция автора, аргументы. Проверяется умение строить связный текст." },
  { exam: "ege", subject: "russian", number: 11, slug: "prichastnyy-oborot", title: "Причастный и деепричастный оборот", fgosRef: "Раздел 5.11 · Обособленные члены", description: "Расстановка запятых при обособлении. Проверяется знание правил обособления." },
  { exam: "ege", subject: "russian", number: 12, slug: "slozhnopodchinennye", title: "Сложноподчинённые предложения", fgosRef: "Раздел 5.12 · СПП", description: "Виды придаточных, расстановка запятых. Проверяется знание синтаксиса СПП." },
  { exam: "ege", subject: "russian", number: 13, slug: "slozhnosochinennye", title: "Сложносочинённые предложения", fgosRef: "Раздел 5.13 · ССП", description: "Запятая в ССП, общие второстепенные члены. Проверяется знание правил." },
  { exam: "ege", subject: "russian", number: 14, slug: "vvodnye-slova", title: "Вводные слова и конструкции", fgosRef: "Раздел 5.14 · Вводные слова", description: "Знаки препинания при вводных словах. Проверяется умение различать вводные слова и члены предложения." },
  { exam: "ege", subject: "russian", number: 15, slug: "obosoblenye-chleny", title: "Обособленные члены предложения", fgosRef: "Раздел 5.15 · Обособление", description: "Обособление определений, приложений, обстоятельств, дополнений. Проверяется владение правилами." },
  { exam: "ege", subject: "russian", number: 16, slug: "odnorodnye-chleny-ege", title: "Однородные члены предложения", fgosRef: "Раздел 5.16 · Однородные", description: "Однородные члены с обобщающим словом, повторяющиеся союзы. Проверяется пунктуация." },
  { exam: "ege", subject: "russian", number: 17, slug: "tire-i-dvoetochie", title: "Тире и двоеточие", fgosRef: "Раздел 5.17 · Тире/двоеточие", description: "Условия постановки тире и двоеточия. Проверяется знание случаев их употребления." },
  { exam: "ege", subject: "russian", number: 18, slug: "zapyataya-pridatochnye", title: "Запятая при придаточных", fgosRef: "Раздел 5.18 · Придаточные", description: "Запятые между главным и придаточным, между однородными придаточными. Проверяется пунктуация в СПП." },
  { exam: "ege", subject: "russian", number: 19, slug: "grammaticheskie-osnovy-ege", title: "Грамматические основы", fgosRef: "Раздел 5.19 · Основы", description: "Определение грамматических основ в предложениях. Проверяется умение находить подлежащее и сказуемое." },
  { exam: "ege", subject: "russian", number: 20, slug: "leksicheskie-normy", title: "Лексические нормы", fgosRef: "Раздел 5.20 · Лексика", description: "Употребление слов в точном лексическом значении. Проверяется точность речи." },
  { exam: "ege", subject: "russian", number: 21, slug: "frazeologizmy-ege", title: "Фразеологизмы", fgosRef: "Раздел 5.21 · Фразеология", description: "Значение и происхождение фразеологизмов. Проверяется знание устойчивых выражений." },
  { exam: "ege", subject: "russian", number: 22, slug: "sinonimy-antonimy-ege", title: "Синонимы и антонимы", fgosRef: "Раздел 5.22 · Синонимы", description: "Подбор синонимов и антонимов, контекстуальные замены. Проверяется словарный запас." },
  { exam: "ege", subject: "russian", number: 23, slug: "yazykovye-vyrazitelnosti", title: "Языковые средства выразительности", fgosRef: "Раздел 5.23 · Выразительность", description: "Тропы и фигуры речи, средства выразительности. Проверяется умение их видеть в тексте." },
  { exam: "ege", subject: "russian", number: 24, slug: "khudozhestvennaya-vyrazitelnost", title: "Средства художественной выразительности", fgosRef: "Раздел 5.24 · Художественные", description: "Эпитет, метафора, олицетворение, гипербола, гротеск. Проверяется литературная грамотность." },
  { exam: "ege", subject: "russian", number: 25, slug: "tekst-i-analiz", title: "Текст и его анализ", fgosRef: "Раздел 5.25 · Анализ текста", description: "Смысловой и композиционный анализ текста. Проверяется умение работать с содержанием." },
  { exam: "ege", subject: "russian", number: 26, slug: "funktsionalnye-stili", title: "Функциональные стили", fgosRef: "Раздел 5.26 · Стили", description: "Научный, публицистический, художественный, разговорный, официально-деловой. Проверяется стилистическая грамотность." },
  { exam: "ege", subject: "russian", number: 27, slug: "publitsisticheskiy-stil", title: "Публицистический стиль", fgosRef: "Раздел 5.27 · Публицистика", description: "Жанры публицистики: статья, эссе, очерк. Проверяется умение анализировать публицистический текст." },
];

// ====================== ЕГЭ ФИЗИКА (1–32) ======================

const egePhysicsNumbers: ExamNumber[] = [
  { exam: "ege", subject: "physics", number: 1, slug: "kinematika-ege", title: "Кинематика", fgosRef: "Раздел 1.1 · Кинематика", description: "Равномерное, равнопеременное движение. Графики v(t), x(t). Проверяется владение кинематическими понятиями." },
  { exam: "ege", subject: "physics", number: 2, slug: "dinamika-ege", title: "Динамика", fgosRef: "Раздел 1.2 · Динамика", description: "Законы Ньютона, силы, принцип суперпозиции. Проверяется умение составлять уравнения движения." },
  { exam: "ege", subject: "physics", number: 3, slug: "zakony-sokhraneniya-ege", title: "Законы сохранения", fgosRef: "Раздел 1.3 · Законы сохранения", description: "Импульс, энергия, момент импульса. Проверяется умение применять законы сохранения." },
  { exam: "ege", subject: "physics", number: 4, slug: "rabota-i-energiya-ege", title: "Работа и энергия", fgosRef: "Раздел 1.4 · Работа и энергия", description: "Работа силы, кинетическая и потенциальная энергия. Проверяется знание формул и связи работы с энергией." },
  { exam: "ege", subject: "physics", number: 5, slug: "statika-ege", title: "Статика", fgosRef: "Раздел 1.5 · Статика", description: "Условия равновесия тела, центр масс. Проверяется умение решать задачи на равновесие." },
  { exam: "ege", subject: "physics", number: 6, slug: "gidrostatika-ege", title: "Гидростатика", fgosRef: "Раздел 2.1 · Гидростатика", description: "Давление в жидкостях, сообщающиеся сосуды, закон Архимеда. Проверяется гидростатика." },
  { exam: "ege", subject: "physics", number: 7, slug: "molekulyarnaya-fizika-ege", title: "Молекулярная физика", fgosRef: "Раздел 3.1 · МКТ", description: "Основное уравнение МКТ, температура, идеальный газ. Проверяется владение МКТ." },
  { exam: "ege", subject: "physics", number: 8, slug: "termodinamika-ege", title: "Термодинамика", fgosRef: "Раздел 3.2 · Термодинамика", description: "Первое начало термодинамики, КПД циклов. Проверяется термодинамический аппарат." },
  { exam: "ege", subject: "physics", number: 9, slug: "teplovye-protsessy-ege", title: "Тепловые процессы", fgosRef: "Раздел 3.3 · Теплота", description: "Уравнение теплового баланса, графики процессов. Проверяется умение работать с графиками." },
  { exam: "ege", subject: "physics", number: 10, slug: "agregatnye-sostoyaniya-ege", title: "Агрегатные состояния", fgosRef: "Раздел 3.4 · Фазовые переходы", description: "Плавление, парообразование, насыщенный пар. Проверяется знание фазовых переходов." },
  { exam: "ege", subject: "physics", number: 11, slug: "elektrostatika-ege", title: "Электростатика", fgosRef: "Раздел 4.1 · Электростатика", description: "Закон Кулона, напряжённость, потенциал. Проверяется электростатический аппарат." },
  { exam: "ege", subject: "physics", number: 12, slug: "postoyannyy-tok-ege", title: "Постоянный ток", fgosRef: "Раздел 4.2 · Постоянный ток", description: "Законы Ома, правила Кирхгофа, работа и мощность тока. Проверяется умение рассчитывать цепи." },
  { exam: "ege", subject: "physics", number: 13, slug: "magnitnoe-pole-ege", title: "Магнитное поле", fgosRef: "Раздел 4.3 · Магнетизм", description: "Сила Ампера, сила Лоренца. Проверяется владение магнитостатикой." },
  { exam: "ege", subject: "physics", number: 14, slug: "elektromagnitnaya-induktsiya-ege", title: "Электромагнитная индукция", fgosRef: "Раздел 4.4 · Индукция", description: "Закон Фарадея, самоиндукция. Проверяется знание явления электромагнитной индукции." },
  { exam: "ege", subject: "physics", number: 15, slug: "kolebaniya-ege", title: "Колебания", fgosRef: "Раздел 5.1 · Колебания", description: "Гармонические колебания, маятники, колебательный контур. Проверяется владение колебательными процессами." },
  { exam: "ege", subject: "physics", number: 16, slug: "volny-ege", title: "Волны", fgosRef: "Раздел 5.2 · Волны", description: "Уравнение волны, интерференция, дифракция. Проверяется знание волновой теории." },
  { exam: "ege", subject: "physics", number: 17, slug: "optika-ege", title: "Оптика", fgosRef: "Раздел 6.1 · Оптика", description: "Законы отражения и преломления, линзы, зеркала. Проверяется геометрическая оптика." },
  { exam: "ege", subject: "physics", number: 18, slug: "kvantovaya-fizika-ege", title: "Квантовая физика", fgosRef: "Раздел 7.1 · Кванты", description: "Фотоэффект, давление света, корпускулярно-волновой дуализм. Проверяется знание квантовых явлений." },
  { exam: "ege", subject: "physics", number: 19, slug: "atomnaya-fizika-ege", title: "Атомная физика", fgosRef: "Раздел 7.2 · Атом", description: "Постулаты Бора, спектры, энергетические уровни. Проверяется модель атома." },
  { exam: "ege", subject: "physics", number: 20, slug: "yadernaya-fizika-ege", title: "Ядерная физика", fgosRef: "Раздел 7.3 · Ядро", description: "Радиоактивность, период полураспада, цепная реакция. Проверяется знание ядерной физики." },
  { exam: "ege", subject: "physics", number: 21, slug: "ravnoperemennoe-dvizhenie-ege", title: "Равнопеременное движение", fgosRef: "Раздел 1.6 · Кинематика", description: "Уравнения движения с постоянным ускорением. Проверяется знание кинематических формул." },
  { exam: "ege", subject: "physics", number: 22, slug: "svobodnoe-padenie-ege", title: "Свободное падение", fgosRef: "Раздел 1.7 · Кинематика", description: "Движение тела в поле тяжести. Проверяется умение применять формулы для свободного падения." },
  { exam: "ege", subject: "physics", number: 23, slug: "dvizhenie-po-okruzhnosti-ege", title: "Движение по окружности", fgosRef: "Раздел 1.8 · Кинематика", description: "Угловая скорость, центростремительное ускорение. Проверяется знание формул вращения." },
  { exam: "ege", subject: "physics", number: 24, slug: "sila-uprugosti-ege", title: "Сила упругости", fgosRef: "Раздел 1.9 · Динамика", description: "Закон Гука, деформации. Проверяется знание закона Гука." },
  { exam: "ege", subject: "physics", number: 25, slug: "sila-treniya-ege", title: "Сила трения", fgosRef: "Раздел 1.10 · Динамика", description: "Коэффициент трения, виды трения. Проверяется умение учитывать силу трения." },
  { exam: "ege", subject: "physics", number: 26, slug: "impuls-tela-ege", title: "Импульс тела", fgosRef: "Раздел 1.11 · Законы сохранения", description: "Закон сохранения импульса, реактивное движение. Проверяется умение применять закон." },
  { exam: "ege", subject: "physics", number: 27, slug: "kineticheskaya-energiya-ege", title: "Кинетическая энергия", fgosRef: "Раздел 1.12 · Энергия", description: "Расчёт кинетической энергии, теорема о кинетической энергии. Проверяется знание формул." },
  { exam: "ege", subject: "physics", number: 28, slug: "potentsialnaya-energiya-ege", title: "Потенциальная энергия", fgosRef: "Раздел 1.13 · Энергия", description: "Потенциальная энергия гравитации и упругости. Проверяется знание формул." },
  { exam: "ege", subject: "physics", number: 29, slug: "moschnost-ege", title: "Мощность", fgosRef: "Раздел 1.14 · Работа", description: "Мощность как скорость совершения работы. Проверяется знание формул мощности." },
  { exam: "ege", subject: "physics", number: 30, slug: "kpd-mekhanizmov-ege", title: "КПД механизмов", fgosRef: "Раздел 1.15 · КПД", description: "Коэффициент полезного действия, наклонная плоскость, блоки. Проверяется расчёт КПД." },
  { exam: "ege", subject: "physics", number: 31, slug: "zakon-oma-ege", title: "Закон Ома для полной цепи", fgosRef: "Раздел 4.5 · Постоянный ток", description: "Закон Ома для полной цепи, ЭДС, внутреннее сопротивление. Проверяется знание формул." },
  { exam: "ege", subject: "physics", number: 32, slug: "elektromagnitnye-volny-ege", title: "Электромагнитные волны", fgosRef: "Раздел 5.3 · Волны", description: "Свойства электромагнитных волн, шкала электромагнитных излучений. Проверяется знание теории Максвелла." },
];

// ====================== ЕГЭ ИНФОРМАТИКА (1–27) ======================

const egeInformaticsNumbers: ExamNumber[] = [
  { exam: "ege", subject: "informatics", number: 1, slug: "predstavlenie-informatsii-ege", title: "Представление информации", fgosRef: "Раздел 1.1 · Информация", description: "Виды информации, носители, единицы измерения. Проверяется знание основ информатики." },
  { exam: "ege", subject: "informatics", number: 2, slug: "kodirovanie-informatsii-ege", title: "Кодирование информации", fgosRef: "Раздел 1.2 · Кодирование", description: "Двоичное кодирование, равномерные и неравномерные коды. Проверяется умение кодировать и декодировать." },
  { exam: "ege", subject: "informatics", number: 3, slug: "izmerenie-informatsii-ege", title: "Измерение информации", fgosRef: "Раздел 1.3 · Измерение", description: "Алфавитный и вероятностный подходы. Проверяется умение считать объём информации." },
  { exam: "ege", subject: "informatics", number: 4, slug: "sistemy-schisleniya-ege", title: "Системы счисления", fgosRef: "Раздел 1.4 · Системы счисления", description: "Перевод между системами счисления. Проверяется владение двоичной, восьмеричной, шестнадцатеричной системами." },
  { exam: "ege", subject: "informatics", number: 5, slug: "logika-ege", title: "Логика и логические операции", fgosRef: "Раздел 1.5 · Логика", description: "Логические выражения, таблицы истинности. Проверяется знание алгебры логики." },
  { exam: "ege", subject: "informatics", number: 6, slug: "algoritmizatsiya-ege", title: "Алгоритмизация", fgosRef: "Раздел 2.1 · Алгоритмы", description: "Свойства алгоритма, формы записи, анализ алгоритмов. Проверяется алгоритмическое мышление." },
  { exam: "ege", subject: "informatics", number: 7, slug: "osnovy-programmirovaniya-ege", title: "Основы программирования", fgosRef: "Раздел 3.1 · Программирование", description: "Переменные, типы, выражения, присваивание. Проверяется знание синтаксиса." },
  { exam: "ege", subject: "informatics", number: 8, slug: "peremennye-i-tipy", title: "Переменные и типы данных", fgosRef: "Раздел 3.2 · Типы данных", description: "Целые, вещественные, строки, логические. Проверяется знание системы типов." },
  { exam: "ege", subject: "informatics", number: 9, slug: "tsikly-ege", title: "Циклы", fgosRef: "Раздел 3.3 · Циклы", description: "Циклы for, while, do-while. Проверяется знание итерационных алгоритмов." },
  { exam: "ege", subject: "informatics", number: 10, slug: "vetvleniya-ege", title: "Ветвления", fgosRef: "Раздел 3.4 · Ветвления", description: "Условные операторы if, switch. Проверяется знание разветвляющихся алгоритмов." },
  { exam: "ege", subject: "informatics", number: 11, slug: "massivy-ege", title: "Массивы", fgosRef: "Раздел 4.1 · Массивы", description: "Одномерные и двумерные массивы, обработка данных. Проверяется знание массивов." },
  { exam: "ege", subject: "informatics", number: 12, slug: "stroki-ege", title: "Строки", fgosRef: "Раздел 4.2 · Строки", description: "Операции над строками, методы обработки. Проверяется работа со строками." },
  { exam: "ege", subject: "informatics", number: 13, slug: "podprogrammy-ege", title: "Подпрограммы", fgosRef: "Раздел 3.5 · Подпрограммы", description: "Процедуры и функции, параметры по значению и ссылке. Проверяется модульный подход." },
  { exam: "ege", subject: "informatics", number: 14, slug: "rekursiya-ege", title: "Рекурсия", fgosRef: "Раздел 3.6 · Рекурсия", description: "Прямая и косвенная рекурсия. Проверяется умение анализировать рекурсивные алгоритмы." },
  { exam: "ege", subject: "informatics", number: 15, slug: "spiski-ege", title: "Списки", fgosRef: "Раздел 4.3 · Списки", description: "Динамические структуры данных: связные списки, очереди, стеки. Проверяется владение структурами." },
  { exam: "ege", subject: "informatics", number: 16, slug: "slovari-ege", title: "Словари и множества", fgosRef: "Раздел 4.4 · Словари", description: "Хеш-таблицы, словари, множества. Проверяется знание ассоциативных массивов." },
  { exam: "ege", subject: "informatics", number: 17, slug: "fayly-ege", title: "Файлы", fgosRef: "Раздел 4.5 · Файлы", description: "Чтение и запись файлов, текстовые и бинарные. Проверяется работа с файловой системой." },
  { exam: "ege", subject: "informatics", number: 18, slug: "elektronnye-tablitsy-ege", title: "Электронные таблицы", fgosRef: "Раздел 5.1 · Таблицы", description: "Формулы, функции, диаграммы в Excel-подобных средах. Проверяется практическая работа." },
  { exam: "ege", subject: "informatics", number: 19, slug: "bazy-dannykh-ege", title: "Базы данных", fgosRef: "Раздел 5.2 · Базы данных", description: "SQL-запросы, нормализация, ключи. Проверяется знание реляционных БД." },
  { exam: "ege", subject: "informatics", number: 20, slug: "seti-i-internet-ege", title: "Сети и интернет", fgosRef: "Раздел 6.1 · Сети", description: "Модель OSI, протоколы, IP-адресация. Проверяется знание сетевых технологий." },
  { exam: "ege", subject: "informatics", number: 21, slug: "operatsionnye-sistemy-ege", title: "Операционные системы", fgosRef: "Раздел 6.2 · ОС", description: "Файловые системы, процессы, управление памятью. Проверяется знание ОС." },
  { exam: "ege", subject: "informatics", number: 22, slug: "informatsionnaya-bezopasnost-ege", title: "Информационная безопасность", fgosRef: "Раздел 6.3 · Безопасность", description: "Шифрование, хеширование, цифровая подпись. Проверяется знание основ криптографии." },
  { exam: "ege", subject: "informatics", number: 23, slug: "kompyuternaya-grafika-ege", title: "Компьютерная графика", fgosRef: "Раздел 5.3 · Графика", description: "Растровая и векторная графика, цветовые модели. Проверяется знание графических форматов." },
  { exam: "ege", subject: "informatics", number: 24, slug: "modelirovanie-ege", title: "Моделирование", fgosRef: "Раздел 5.4 · Модели", description: "Математические и имитационные модели. Проверяется умение строить модели." },
  { exam: "ege", subject: "informatics", number: 25, slug: "diskretnaya-matematika-ege", title: "Дискретная математика", fgosRef: "Раздел 1.6 · Дискретка", description: "Графы, множества, комбинаторика. Проверяется знание дискретных структур." },
  { exam: "ege", subject: "informatics", number: 26, slug: "slozhnost-algoritmov-ege", title: "Сложность алгоритмов", fgosRef: "Раздел 7.1 · Алгоритмы", description: "О-нотация, временная и пространственная сложность. Проверяется знание теории сложности." },
  { exam: "ege", subject: "informatics", number: 27, slug: "mashinnoe-obuchenie-ege", title: "Основы машинного обучения", fgosRef: "Раздел 7.2 · ML", description: "Классификация, регрессия, нейронные сети. Проверяется общее представление о ML." },
];

// ====================== ЭКСПОРТ ======================

/**
 * Все 10 предметов ОГЭ/ЕГЭ с номерами ФИПИ.
 * 218 номеров суммарно. Использовать для генерации SEO-страниц `/exam/[exam]/[subject]/[number]`.
 */
export const EXAM_SUBJECTS: ExamSubject[] = [
  {
    slug: "oge-math",
    exam: "oge",
    subject: "math",
    title: "Математика ОГЭ",
    emoji: "🔢",
    numbers: ogeMathNumbers,
  },
  {
    slug: "oge-russian",
    exam: "oge",
    subject: "russian",
    title: "Русский язык ОГЭ",
    emoji: "📖",
    numbers: ogeRussianNumbers,
  },
  {
    slug: "oge-physics",
    exam: "oge",
    subject: "physics",
    title: "Физика ОГЭ",
    emoji: "⚛️",
    numbers: ogePhysicsNumbers,
  },
  {
    slug: "oge-informatics",
    exam: "oge",
    subject: "informatics",
    title: "Информатика ОГЭ",
    emoji: "💻",
    numbers: ogeInformaticsNumbers,
  },
  {
    slug: "oge-social",
    exam: "oge",
    subject: "social",
    title: "Обществознание ОГЭ",
    emoji: "⚖️",
    numbers: ogeSocialNumbers,
  },
  {
    slug: "ege-math-p",
    exam: "ege",
    subject: "math-p",
    title: "Математика ЕГЭ (профильная)",
    emoji: "🔢",
    numbers: egeMathPNumbers,
  },
  {
    slug: "ege-math-b",
    exam: "ege",
    subject: "math-b",
    title: "Математика ЕГЭ (базовая)",
    emoji: "🔢",
    numbers: egeMathBNumbers,
  },
  {
    slug: "ege-russian",
    exam: "ege",
    subject: "russian",
    title: "Русский язык ЕГЭ",
    emoji: "📖",
    numbers: egeRussianNumbers,
  },
  {
    slug: "ege-physics",
    exam: "ege",
    subject: "physics",
    title: "Физика ЕГЭ",
    emoji: "⚛️",
    numbers: egePhysicsNumbers,
  },
  {
    slug: "ege-informatics",
    exam: "ege",
    subject: "informatics",
    title: "Информатика ЕГЭ",
    emoji: "💻",
    numbers: egeInformaticsNumbers,
  },
];

// ====================== HELPERS ======================

/**
 * Найти номер экзамена по (exam, subject, number).
 * Возвращает undefined, если не найдено.
 */
export function getExamNumber(
  exam: ExamKind,
  subject: string,
  number: number,
): ExamNumber | undefined {
  for (const es of EXAM_SUBJECTS) {
    if (es.exam === exam && es.subject === subject) {
      return es.numbers.find((n) => n.number === number);
    }
  }
  return undefined;
}

/**
 * Найти предмет экзамена по slug.
 * Возвращает undefined, если не найдено.
 */
export function getExamSubject(slug: string): ExamSubject | undefined {
  return EXAM_SUBJECTS.find((es) => es.slug === slug);
}