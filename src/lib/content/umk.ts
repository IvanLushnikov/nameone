/**
 * Учебно-методические комплексы (УМК) по предметам.
 *
 * Это teacher-intent killer: «Моро 3 класс рабочий лист» — точный long-tail.
 *
 * Источники: uchi.ru (обязательный выбор УМК), videouroki, ФПУ
 * (федеральный перечень учебников, fpu.edu.ru).
 *
 * ## Поле `grades`
 * Диапазон классов, для которых учебник реально используется. Заполняем
 * ВСЕГДА: без него учебник «висел» бы на классах, где предмета не
 * существует (например, литература на 1 классе) — фильтр в UI врал бы
 * учителю, а пустая выдача выглядит как баг.
 *
 * ## Правило
 * Диапазон УМК предмета ⊆ диапазён классов самого предмета в таксономии
 * (`src/lib/content/subjects.ts`). Проверяется `scripts/audit-umk.ts`
 * и тестом `tests/taxonomy-completeness.test.ts`.
 */

export interface UMKEntry {
  id: string;
  name: string;
  short: string;
  author: string;
  // Для каких классов используется. Пусто — не рекомендуем.
  grades?: number[];
}

const g = (...blocks: [number, number][]): number[] => {
  const out: number[] = [];
  for (const [from, to] of blocks) for (let i = from; i <= to; i++) out.push(i);
  return out;
};

/** 1-4 — начальная школа. */
const PRIMARY = g([1, 4]);
/** 1-6 — математика. */
const MATH_G = g([1, 6]);
/** 1-11 — предмет без «начальной» специфики. */
const ALL_G = g([1, 11]);
/** 5-8 — гуманитарные и творческие предметы с отдельной программой 1-4. */
const G58 = g([5, 8]);
/** 5-11. */
const G511 = g([5, 11]);
/** 5-9. */
const G59 = g([5, 9]);
/** 6-11. */
const G611 = g([6, 11]);
/** 7-11. */
const G711 = g([7, 11]);
/** 7-9. */
const G79 = g([7, 9]);
/** 8-11. */
const G811 = g([8, 11]);
/** 9-11. */
const G911 = g([9, 11]);
/** 10-11. */
const G1011 = g([10, 11]);

export const umk: Record<string, UMKEntry[]> = {
  math: [
    { id: "moro", name: "Школа России (Моро)", short: "Моро", author: "Моро М.И., Бантова М.А.", grades: MATH_G },
    { id: "petersburg", name: "Петерсон Л.Г.", short: "Петерсон", author: "Петерсон Л.Г.", grades: PRIMARY },
    { id: "kozlov", name: "Козлов С.А.", short: "Козлов", author: "Козлов С.А.", grades: PRIMARY },
    { id: "dorofeev", name: "Дорофеев Г.В.", short: "Дорофеев", author: "Дорофеев Г.В., Миракова Т.И.", grades: MATH_G },
    { id: "vilenkin", name: "Виленкин Н.Я.", short: "Виленкин", author: "Виленкин Н.Я.", grades: g([5, 6]) },
    { id: "merzlyak", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г., Полонский В.Б.", grades: g([5, 6]) },
    { id: "nikolaev", name: "Никольский С.М.", short: "Никольский", author: "Никольский С.М.", grades: g([5, 6]) },
  ],
  algebra: [
    { id: "merzlyak-alg", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г., Полонский В.Б.", grades: G711 },
    { id: "morozovich", name: "Мордкович А.Г.", short: "Мордкович", author: "Мордкович А.Г.", grades: G79 },
    { id: "makarychev", name: "Макарычев Ю.Н.", short: "Макарычев", author: "Макарычев Ю.Н., Миндюк Н.Г.", grades: G79 },
    { id: "dorofeev-alg", name: "Дорофеев Г.В.", short: "Дорофеев", author: "Дорофеев Г.В., Баврама Г.А.", grades: G79 },
    { id: "alimov", name: "Алимов Ш.А.", short: "Алимов", author: "Алимов Ш.А.", grades: G1011 },
    { id: "kolmogorov", name: "Колмогоров А.Н.", short: "Колмогоров", author: "Колмогоров А.Н.", grades: G1011 },
  ],
  geometry: [
    { id: "atanasyan", name: "Атанасян Л.С.", short: "Атанасян", author: "Атанасян Л.С., Бутузов В.Ф.", grades: G711 },
    { id: "pogorelov", name: "Погорелов А.В.", short: "Погорелов", author: "Погорелов А.В.", grades: G711 },
    { id: "merzlyak-geo", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г., Полонский В.Б.", grades: G711 },
    { id: "sharygin", name: "Шарыгин И.Ф.", short: "Шарыгин", author: "Шарыгин И.Ф.", grades: G711 },
    { id: "ziv", name: "Зив Б.Г.", short: "Зив", author: "Зив Б.Г.", grades: G79 },
    { id: "alexandrov", name: "Александров В.В.", short: "Александров", author: "Александров В.В., Вернер А.Г.", grades: G1011 },
  ],
  russian: [
    { id: "kanakina", name: "Канакина В.П.", short: "Канакина", author: "Канакина В.П., Горецкий В.Г.", grades: PRIMARY },
    { id: "larionova", name: "Ларионова Т.В.", short: "Ларионова", author: "Ларионова Т.В., Седова С.И.", grades: PRIMARY },
    { id: "smirnov-rus", name: "Смирнов В.Г.", short: "Смирнов", author: "Смирнов В.Г.", grades: PRIMARY },
    { id: "kruglikova", name: "Кругликова Г.А.", short: "Кругликова", author: "Кругликова Г.А.", grades: PRIMARY },
    { id: "polivanova", name: "Поливанова Т.Я.", short: "Поливанова", author: "Поливанова Т.Я.", grades: PRIMARY },
    { id: "ladyzhenskaya", name: "Ладыженская Т.А.", short: "Ладыженская", author: "Ладыженская Т.А., Баранов Л.А.", grades: G511 },
    { id: "razumovskaya", name: "Разумовская М.М.", short: "Разумовская", author: "Разумовская М.М.", grades: G511 },
    { id: "larsen", name: "Ларин Б.А.", short: "Ларин", author: "Ларин Б.А.", grades: G59 },
    { id: "mordkovich-rus", name: "Мордкович Н.М.", short: "Мордкович", author: "Мордкович Н.М.", grades: G59 },
    { id: "barkhudarov", name: "Бархударов С.Г.", short: "Бархударов", author: "Бархударов С.Г., Пожидаев В.П.", grades: g([8, 9]) },
    { id: "grozdev", name: "Греков В.Ф.", short: "Греков", author: "Греков В.Ф., Крюков Г.М.", grades: G1011 },
    { id: "shmeleva", name: "Шмелёва Ф.Е.", short: "Шмелёва", author: "Шмелёва Ф.Е.", grades: G1011 },
  ],
  literature: [
    { id: "korovina", name: "Коровина В.Я.", short: "Коровина", author: "Коровина В.Я.", grades: G511 },
    { id: "kurdyumova", name: "Курдюмова Т.Ф.", short: "Курдюмова", author: "Курдюмова Т.Ф.", grades: G511 },
    { id: "lanin", name: "Ланин Б.А.", short: "Ланин", author: "Ланин Б.А.", grades: G511 },
    { id: "moskvin", name: "Москвин Г.В.", short: "Москвин", author: "Москвин Г.В.", grades: G611 },
    { id: "merzlyak-lit", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г., Курдюмова Т.Ф.", grades: G511 },
  ],
  english: [
    { id: "vereshchagina", name: "Верещагина И.Н.", short: "Верещагина", author: "Верещагина И.Н., Афанасьева О.В.", grades: PRIMARY },
    { id: "kuzovlev", name: "Кузовлев В.П.", short: "Кузовлев", author: "Кузовлев В.П.", grades: ALL_G },
    { id: "biboletova", name: "Биболетова М.З.", short: "Биболетова", author: "Биболетова М.З.", grades: ALL_G },
    { id: "afanasieva", name: "Афанасьева О.В.", short: "Афанасьева", author: "Афанасьева О.В., Михеева И.В.", grades: ALL_G },
    { id: "wood", name: "Wood D.", short: "Wood", author: "Wood D., Willis J.", grades: G79 },
    { id: "murphy", name: "Murphy R.", short: "Murphy", author: "Murphy R.", grades: G79 },
    { id: "evgenova", name: "Евгенова Н.А.", short: "Евгенова", author: "Евгенова Н.А., Бондарева Т.Ю.", grades: G1011 },
    { id: "golitsynsky-eng", name: "Голицынский Ю.Б.", short: "Голицынский", author: "Голицынский Ю.Б.", grades: G1011 },
    { id: "spotlight", name: "Spotlight (Афанасьева)", short: "Spotlight", author: "Афанасьева О.В., Дули Д.", grades: ALL_G },
  ],
  german: [
    { id: "bim", name: "Бим И.Л.", short: "Бим", author: "Бим И.Л., Жилина О.В.", grades: G511 },
    { id: "yakovleva", name: "Яковлева Л.Н.", short: "Яковлева", author: "Яковлева Л.Н.", grades: G511 },
    { id: "golitsynsky-de", name: "Голицынский Н.И.", short: "Голицынский", author: "Голицынский Н.И.", grades: G511 },
    { id: "zverlova", name: "Зверлова М.Н.", short: "Зверлова", author: "Зверлова М.Н.", grades: G511 },
    { id: "voronin", name: "Воронин М.В.", short: "Воронин", author: "Воронин М.В.", grades: G511 },
  ],
  informatics: [
    { id: "bosova", name: "Босова Л.Л.", short: "Босова", author: "Босова Л.Л.", grades: G511 },
    { id: "polyakov", name: "Поляков К.Ю.", short: "Поляков", author: "Поляков К.Ю., Ерёмин Е.А.", grades: G511 },
    { id: "makarova", name: "Макарова М.Г.", short: "Макарова", author: "Макарова М.Г.", grades: G59 },
    { id: "bilitina", name: "Билетина Е.Б.", short: "Билетина", author: "Билетина Е.Б.", grades: G59 },
    { id: "romanov", name: "Романов И.А.", short: "Романов", author: "Романов И.А.", grades: G911 },
  ],
  physics: [
    { id: "peryshkin", name: "Перышкин А.В.", short: "Перышкин", author: "Перышкин А.В.", grades: G79 },
    { id: "lukashik", name: "Лукашик Р.А.", short: "Лукашик", author: "Лукашик Р.А.", grades: G79 },
    { id: "purysheva", name: "Пурышева Н.С.", short: "Пурышева", author: "Пурышева Н.С.", grades: G711 },
    { id: "myakishev", name: "Мякишев Г.Я.", short: "Мякишев", author: "Мякишев Г.Я., Буховцев Б.Б.", grades: G1011 },
    { id: "kabardin", name: "Кабардин К.А.", short: "Кабардин", author: "Кабардин К.А.", grades: G1011 },
    { id: "rymkevich", name: "Рымкевич Г.П.", short: "Рымкевич", author: "Рымкевич Г.П.", grades: G711 },
  ],
  chemistry: [
    { id: "rudzitis", name: "Рудзитис Г.Е.", short: "Рудзитис", author: "Рудзитис Г.Е., Фельдман Ф.Г.", grades: G811 },
    { id: "gabrielyan", name: "Габриелян О.С.", short: "Габриелян", author: "Габриелян О.С.", grades: G811 },
    { id: "kuznetsova", name: "Кузнецова Н.Е.", short: "Кузнецова", author: "Кузнецова Н.Е., Еремин Е.В.", grades: G811 },
    { id: "eremin", name: "Еремин Е.В.", short: "Еремин", author: "Еремин Е.В., Кузьменко Н.Е.", grades: G1011 },
    { id: "kuzmenko", name: "Кузьменко Н.Е.", short: "Кузьменко", author: "Кузьменко Н.Е., Еремин Е.В.", grades: G1011 },
  ],
  biology: [
    { id: "pasechnik", name: "Пасечник В.В.", short: "Пасечник", author: "Пасечник В.В., Скоряга Т.В.", grades: G79 },
    { id: "kaminsky", name: "Каменский А.А.", short: "Каменский", author: "Каменский А.А., Бичева И.Б.", grades: G511 },
    { id: "ponomarev", name: "Пономарёв А.И.", short: "Пономарёв", author: "Пономарёв А.И.", grades: G511 },
    { id: "sokolova", name: "Соколова Н.И.", short: "Соколова", author: "Соколова Н.И., Соколова С.В.", grades: G511 },
    { id: "tikhonova", name: "Тихонова Н.И.", short: "Тихонова", author: "Тихонова Н.И., Агафонова А.В.", grades: G1011 },
    { id: "zagorovskaya", name: "Загоровская Н.Б.", short: "Загоровская", author: "Загоровская Н.Б.", grades: G511 },
  ],
  geography: [
    { id: "alekseev", name: "Алексеев А.И.", short: "Алексеев", author: "Алексеев А.И., Николина В.В.", grades: G511 },
    { id: "holina", name: "Холина О.В.", short: "Холина", author: "Холина О.В.", grades: g([5, 6]) },
    { id: "dronov", name: "Дронов В.П.", short: "Дронов", author: "Дронов В.П., Савельева Л.Е.", grades: G611 },
    { id: "klimanova", name: "Климанова О.А.", short: "Климанова", author: "Климанова О.А.", grades: G611 },
    { id: "glazkov", name: "Глазков Ю.Я.", short: "Глазков", author: "Глазков Ю.Я., Кахиани В.П.", grades: G1011 },
    { id: "nikolskiy-geo", name: "Никольский В.И.", short: "Никольский", author: "Никольский В.И., Алексашенко О.В.", grades: G511 },
  ],
  history: [
    { id: "arsentyev", name: "Арсентьев Н.М.", short: "Арсентьев", author: "Арсентьев Н.М., Данилевский И.Н.", grades: G511 },
    { id: "zagladina", name: "Загладина Н.В.", short: "Загладина", author: "Загладина Н.В.", grades: G511 },
    { id: "danilevsky", name: "Данилевский И.Н.", short: "Данилевский", author: "Данилевский И.Н.", grades: G511 },
    { id: "yudovskaya", name: "Юдовская С.В.", short: "Юдовская", author: "Юдовская С.В.", grades: G511 },
    { id: "saharov", name: "Сахаров А.В.", short: "Сахаров", author: "Сахаров А.В., Загладина Н.В.", grades: G1011 },
    { id: "yakovlev", name: "Яковлев С.В.", short: "Яковлев", author: "Яковлев С.В.", grades: G1011 },
  ],
  social: [
    { id: "bogolyubov", name: "Боголюбов Л.Н.", short: "Боголюбов", author: "Боголюбов Л.Н.", grades: G611 },
    { id: "krainova", name: "Крайнова Л.В.", short: "Крайнова", author: "Крайнова Л.В.", grades: G611 },
    { id: "sobyulev", name: "Собюлев В.Н.", short: "Собюлев", author: "Собюлев В.Н.", grades: G611 },
    { id: "koroleva", name: "Королёва Г.П.", short: "Королёва", author: "Королёва Г.П.", grades: G1011 },
  ],
  okruzhaet: [
    { id: "pleshakov", name: "Плешаков А.А.", short: "Плешаков", author: "Плешаков А.А.", grades: PRIMARY },
    { id: "ivchenkova", name: "Ивченкова Г.А.", short: "Ивченкова", author: "Ивченкова Г.А.", grades: PRIMARY },
    { id: "shishkova", name: "Шишкова И.А.", short: "Шишкова", author: "Шишкова И.А.", grades: PRIMARY },
    { id: "sokolova-okr", name: "Соколова Н.А.", short: "Соколова", author: "Соколова Н.А.", grades: PRIMARY },
  ],
  obzh: [
    { id: "smirnov", name: "Смирнов А.Т.", short: "Смирнов", author: "Смирнов А.Т., Хренников Б.О.", grades: G59 },
    { id: "egorov", name: "Егоров Т.А.", short: "Егоров", author: "Егоров Т.А.", grades: G59 },
    { id: "vladimirova", name: "Владимирова Л.Н.", short: "Владимирова", author: "Владимирова Л.Н.", grades: G1011 },
    { id: "myasnikova", name: "Мясникова Ю.С.", short: "Мясникова", author: "Мясникова Ю.С.", grades: G1011 },
    { id: "korenev", name: "Коренёв Г.И.", short: "Коренёв", author: "Коренёв Г.И.", grades: G1011 },
    { id: "kobukhova", name: "Кобухова О.С.", short: "Кобухова", author: "Кобухова О.С.", grades: G59 },
  ],
  technology: [
    { id: "geronimus", name: "Геронимус Т.М.", short: "Геронимус", author: "Геронимус Т.М.", grades: G59 },
    { id: "sasova", name: "Сасова И.А.", short: "Сасова", author: "Сасова И.А.", grades: G59 },
    { id: "symonenko", name: "Симоненко В.Я.", short: "Симоненко", author: "Симоненко В.Я.", grades: G59 },
    { id: "tishchenko", name: "Тищенко А.Т.", short: "Тищенко", author: "Тищенко А.Т., Питигин С.Н.", grades: G59 },
  ],
  finance: [
    { id: "chibisov", name: "Чибисова О.В.", short: "Чибисова", author: "Чибисова О.В.", grades: g([7, 9]) },
    { id: "golub", name: "Голуб Г.Б.", short: "Голуб", author: "Голуб Г.Б., Перепелица Д.Б.", grades: g([7, 9]) },
    { id: "moiseeva", name: "Моисеева О.В.", short: "Моисеева", author: "Моисеева О.В.", grades: g([7, 9]) },
    { id: "shleikov", name: "Шлейков Г.И.", short: "Шлейков", author: "Шлейков Г.И.", grades: g([7, 9]) },
  ],
  music: [
    { id: "aleev", name: "Алеев В.В.", short: "Алеев", author: "Алеев В.В., Кичак Т.Н.", grades: G58 },
    { id: "krichevskaya", name: "Критская Е.Д.", short: "Критская", author: "Критская Е.Д., Медведева И.Г.", grades: G58 },
    { id: "kabalevskaya", name: "Кабалевская Е.Д.", short: "Кабалевская", author: "Кабалевская Е.Д.", grades: PRIMARY },
    { id: "dmitrieva", name: "Дмитриева Е.Г.", short: "Дмитриева", author: "Дмитриева Е.Г.", grades: PRIMARY },
    { id: "kolmykov", name: "Калмыков Г.М.", short: "Калмыков", author: "Калмыков Г.М., Фридкин Г.А.", grades: PRIMARY },
    { id: "britvina", name: "Бритвина Т.Ц.", short: "Бритвина", author: "Бритвина Т.Ц., Бритвина О.А.", grades: PRIMARY },
    { id: "smirnova-mus", name: "Смирнова Т.А.", short: "Смирнова", author: "Смирнова Т.А., Критская Е.Д.", grades: G58 },
  ],
  art: [
    { id: "gorm", name: "Горяева Н.А.", short: "Горяева", author: "Горяева Н.А., Островская О.В.", grades: G58 },
    { id: "nemensky", name: "Неменский Б.М.", short: "Неменский", author: "Неменский Б.М.", grades: G58 },
    { id: "shpikalova", name: "Шпикалова Т.Я.", short: "Шпикалова", author: "Шпикалова Т.Я., Ершова Л.В.", grades: PRIMARY },
    { id: "klassova", name: "Классова Т.А.", short: "Классова", author: "Классова Т.А.", grades: PRIMARY },
    { id: "boguslavskaya", name: "Богуславская И.Я.", short: "Богуславская", author: "Богуславская И.Я.", grades: PRIMARY },
    { id: "komarova", name: "Комарова Т.С.", short: "Комарова", author: "Комарова Т.С.", grades: PRIMARY },
    { id: "sominskaya", name: "Соминская Е.А.", short: "Соминская", author: "Соминская Е.А.", grades: G58 },
  ],
  pe: [
    { id: "lyakh", name: "Лях В.И.", short: "Лях", author: "Лях В.И., Зданевич А.А.", grades: ALL_G },
    { id: "matveev", name: "Матвеев А.П.", short: "Матвеев", author: "Матвеев А.П., Матвеев А.А.", grades: ALL_G },
    { id: "terentyev", name: "Терентьев В.А.", short: "Терентьев", author: "Терентьев В.А.", grades: G79 },
    { id: "dorovinkin", name: "Дорожин Ю.Г.", short: "Дорожин", author: "Дорожин Ю.Г.", grades: G58 },
    { id: "neumov", name: "Неумоев Б.К.", short: "Неумоев", author: "Неумоев Б.К., Нехорошева Н.Г.", grades: PRIMARY },
    { id: "kashchenkov", name: "Кащенков Ю.Д.", short: "Кащенков", author: "Кащенков Ю.Д.", grades: G1011 },
  ],
};

/**
 * Возвращает список УМК для предмета, опционально фильтруя по классу.
 */
export function getUMK(
  subjectSlug: string,
  grade?: number | null
): UMKEntry[] {
  const list = umk[subjectSlug] ?? [];
  if (grade == null) return list;
  return list.filter((u) => !u.grades || u.grades.includes(grade));
}

export function getUMKById(subjectSlug: string, id: string): UMKEntry | undefined {
  return (umk[subjectSlug] ?? []).find((u) => u.id === id);
}
