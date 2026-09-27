/**
 * Учебно-методические комплексы (УМК) по предметам.
 * Это teacher-intent killer: «Моро 3 класс рабочий лист» — точный long-tail.
 *
 * Источники: uchi.ru (обязательный выбор УМК), videouroki, ФПУ (федеральный
 * перечень учебников).
 */

export interface UMKEntry {
  id: string;
  name: string;
  short: string;
  author: string;
  // Для каких классов рекомендован. Если пусто — все классы этого предмета.
  grades?: number[];
}

export const umk: Record<string, UMKEntry[]> = {
  math: [
    { id: "moro", name: "Школа России (Моро)", short: "Моро", author: "Моро М.И., Бантова М.А." },
    { id: "vilenkin", name: "Виленкин Н.Я.", short: "Виленкин", author: "Виленкин Н.Я.", grades: [5, 6] },
    { id: "merzlyak", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г., Полонский В.Б.", grades: [5, 6] },
    { id: "nikolaev", name: "Никольский С.М.", short: "Никольский", author: "Никольский С.М.", grades: [5, 6] },
    { id: "petersburg", name: "Петерсон Л.Г.", short: "Петерсон", author: "Петерсон Л.Г.", grades: [1, 2, 3, 4] },
  ],
  algebra: [
    { id: "merzlyak-alg", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г., Полонский В.Б." },
    { id: "morozovich", name: "Мордкович А.Г.", short: "Мордкович", author: "Мордкович А.Г." },
    { id: "kolmogorov", name: "Колмогоров А.Н.", short: "Колмогоров", author: "Колмогоров А.Н.", grades: [10, 11] },
    { id: "alimov", name: "Алимов Ш.А.", short: "Алимов", author: "Алимов Ш.А." },
  ],
  geometry: [
    { id: "atanasyan", name: "Атанасян Л.С.", short: "Атанасян", author: "Атанасян Л.С." },
    { id: "pogorelov", name: "Погорелов А.В.", short: "Погорелов", author: "Погорелов А.В." },
    { id: "merzlyak-geo", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г." },
    { id: "sharygin", name: "Шарыгин И.Ф.", short: "Шарыгин", author: "Шарыгин И.Ф." },
  ],
  russian: [
    { id: "ladyzhenskaya", name: "Ладыженская Т.А.", short: "Ладыженская", author: "Ладыженская Т.А." },
    { id: "razumovskaya", name: "Разумовская М.М.", short: "Разумовская", author: "Разумовская М.М." },
    { id: "barkhudarov", name: "Бархударов С.Г.", short: "Бархударов", author: "Бархударов С.Г.", grades: [8, 9] },
    { id: "grozdev", name: "Греков В.Ф.", short: "Греков", author: "Греков В.Ф.", grades: [10, 11] },
    { id: "kanakina", name: "Канакина В.П.", short: "Канакина", author: "Канакина В.П.", grades: [1, 2, 3, 4] },
  ],
  literature: [
    { id: "korovina", name: "Коровина В.Я.", short: "Коровина", author: "Коровина В.Я." },
    { id: "merzlyak-lit", name: "Мерзляк А.Г.", short: "Мерзляк", author: "Мерзляк А.Г." },
  ],
  english: [
    { id: "kuzovlev", name: "Кузовлев В.П.", short: "Кузовлев", author: "Кузовлев В.П." },
    { id: "biboletova", name: "Биболетова М.З.", short: "Биболетова", author: "Биболетова М.З." },
    { id: "afanasieva", name: "Афанасьева О.В.", short: "Афанасьева", author: "Афанасьева О.В." },
    { id: "vereshchagina", name: "Верещагина И.Н.", short: "Верещагина", author: "Верещагина И.Н.", grades: [1, 2, 3, 4] },
    { id: "spotlight", name: "Spotlight (Афанасьева)", short: "Spotlight", author: "Афанасьева О.В., Дули Д." },
  ],
  german: [
    { id: "bim", name: "Бим И.Л.", short: "Бим", author: "Бим И.Л." },
    { id: "yakovleva", name: "Яковлева Л.Н.", short: "Яковлева", author: "Яковлева Л.Н." },
  ],
  informatics: [
    { id: "bosova", name: "Босова Л.Л.", short: "Босова", author: "Босова Л.Л." },
    { id: "polyakov", name: "Поляков К.Ю.", short: "Поляков", author: "Поляков К.Ю." },
  ],
  physics: [
    { id: "peryshkin", name: "Перышкин А.В.", short: "Перышкин", author: "Перышкин А.В.", grades: [7, 8, 9] },
    { id: "myakishev", name: "Мякишев Г.Я.", short: "Мякишев", author: "Мякишев Г.Я.", grades: [10, 11] },
    { id: "puri", name: "Пурышева Н.С.", short: "Пурышева", author: "Пурышева Н.С." },
  ],
  chemistry: [
    { id: "rudzitis", name: "Рудзитис Г.Е.", short: "Рудзитис", author: "Рудзитис Г.Е., Фельдман Ф.Г." },
    { id: "kuznetsova", name: "Кузнецова Н.Е.", short: "Кузнецова", author: "Кузнецова Н.Е." },
    { id: "garasimovich", name: "Габриелян О.С.", short: "Габриелян", author: "Габриелян О.С." },
  ],
  biology: [
    { id: "pasechnik", name: "Пасечник В.В.", short: "Пасечник", author: "Пасечник В.В." },
    { id: "ponomarev", name: "Пономарёв А.И.", short: "Пономарёв", author: "Пономарёв А.И." },
    { id: "zagorovskaya", name: "Загоровская Н.Б.", short: "Загоровская", author: "Загоровская Н.Б." },
  ],
  geography: [
    { id: "alekseev", name: "Алексеев А.И.", short: "Алексеев", author: "Алексеев А.И., Николина В.В." },
    { id: "dronov", name: "Дронов В.П.", short: "Дронов", author: "Дронов В.П., Савельева Л.Е." },
    { id: "klimanova", name: "Климанова О.А.", short: "Климанова", author: "Климанова О.А." },
  ],
  history: [
    { id: "arsentyev", name: "Арсентьев Н.М.", short: "Арсентьев", author: "Арсентьев Н.М., Данилевский И.Н." },
    { id: "zagladina", name: "Загладина Н.В.", short: "Загладина", author: "Загладина Н.В." },
    { id: "yakovlev", name: "Яковлев С.В.", short: "Яковлев", author: "Яковлев С.В.", grades: [10, 11] },
  ],
  social: [
    { id: "bogolyubov", name: "Боголюбов Л.Н.", short: "Боголюбов", author: "Боголюбов Л.Н." },
    { id: "krainova", name: "Крайнова Л.В.", short: "Крайнова", author: "Крайнова Л.В." },
  ],
  obzh: [
    { id: "smirnov", name: "Смирнов А.Т.", short: "Смирнов", author: "Смирнов А.Т., Хренников Б.О." },
    { id: "vladimirova", name: "Владимирова Л.Н.", short: "Владимирова", author: "Владимирова Л.Н." },
  ],
  technology: [
    { id: "geron", name: "Геронимус Т.М.", short: "Геронимус", author: "Геронимус Т.М." },
    { id: "sasim", name: "Сасова И.А.", short: "Сасова", author: "Сасова И.А." },
  ],
  finance: [
    { id: "chibisov", name: "Чибисова О.В.", short: "Чибисова", author: "Чибисова О.В." },
    { id: "golub", name: "Голуб Г.Б.", short: "Голуб", author: "Голуб Г.Б., Перепелица Д.Б." },
  ],
  music: [
    { id: "aleev", name: "Алеев В.В.", short: "Алеев", author: "Алеев В.В., Кичак Т.Н." },
    { id: "krichevskaya", name: "Критская Е.Д.", short: "Критская", author: "Критская Е.Д." },
  ],
  art: [
    { id: "gorm", name: "Горяева Н.А.", short: "Горяева", author: "Горяева Н.А., Островская О.В." },
    { id: "nemenskaya", name: "Неменский Б.М.", short: "Неменский", author: "Неменский Б.М." },
  ],
  pe: [
    { id: "lyakh", name: "Лях В.И.", short: "Лях", author: "Лях В.И., Зданевич А.А." },
    { id: "matveev", name: "Матвеев А.П.", short: "Матвеев", author: "Матвеев А.П." },
  ],
  okruzhaet: [
    { id: "pleshakov", name: "Плешаков А.А.", short: "Плешаков", author: "Плешаков А.А." },
    { id: "sokolova", name: "Соколова Н.А.", short: "Соколова", author: "Соколова Н.А." },
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
