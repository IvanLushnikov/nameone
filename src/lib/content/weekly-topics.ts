import type { Season } from "./calendar";

/**
 * «Тема недели» — заранее заданные темы по сезонам.
 * Используются на главной (виджет) и на /theme/<seoSlug>/ (SEO-страницы).
 */

export interface WeeklyTopic {
  slug: string;
  season: Season;
  weekLabel: string;
  subject: string;
  grade: number;
  topicSlug: string;
  title: string;
  whyText: string;
  seoSlug: string;
}

export function getWeeklyTopicBySeoSlug(slug: string): WeeklyTopic | undefined {
  return WEEKLY_TOPICS.find((t) => t.seoSlug === slug);
}

export const WEEKLY_TOPICS: WeeklyTopic[] = [
  {
    slug: "drobi-5-oktyabr-w1",
    season: "autumn-1",
    weekLabel: "Октябрь · 1-2 неделя",
    subject: "math",
    grade: 5,
    topicSlug: "drobi-obyknovennye",
    title: "Дроби в 5 классе — самое время потренироваться",
    whyText:
      "В октябре пятиклассники начинают тему «Обыкновенные дроби» по ФГОС 2021. Учителя ищут рабочие листы на сложение и вычитание дробей — мы даём их за 30 секунд.",
    seoSlug: "drobi-5-klass-osen",
  },
  {
    slug: "otritsatelnye-6-oktyabr",
    season: "autumn-1",
    weekLabel: "Октябрь · 3 неделя",
    subject: "math",
    grade: 6,
    topicSlug: "otritsatelnye-chisla",
    title: "Отрицательные числа и координатная прямая",
    whyText: "По ФГОС в 6 классе в октябре начинается тема отрицательных чисел. Листы с числовой прямой и сравнением — самые востребованные у учителей.",
    seoSlug: "otritsatelnye-chisla-6-klass-oktyabr",
  },
  {
    slug: "chereduyushchiesya-korni-5",
    season: "autumn-1",
    weekLabel: "Октябрь · 4 неделя",
    subject: "russian",
    grade: 5,
    topicSlug: "orfografiya-korney",
    title: "Чередующиеся гласные в корне слова",
    whyText: "Топовый запрос учителей русского в октябре — карточки на -гор-/-гар-, -зор-/-зар-, -раст-/-ращ-. Генерим за 30 секунд с ответами.",
    seoSlug: "chereduyushchiesya-glasnye-5-klass-oktyabr",
  },
  {
    slug: "smeshannye-5-noyabr",
    season: "autumn-2",
    weekLabel: "Ноябрь · 1-2 неделя",
    subject: "math",
    grade: 5,
    topicSlug: "smeshannye-chisla",
    title: "Смешанные числа — сложение и вычитание",
    whyText: "После обыкновенных дробей в 5 классе идут смешанные числа. Самый сложный момент — перевод из неправильной дроби.",
    seoSlug: "smeshannye-chisla-5-klass-noyabr",
  },
  {
    slug: "proportsii-6-noyabr",
    season: "autumn-2",
    weekLabel: "Ноябрь · 3 неделя",
    subject: "math",
    grade: 6,
    topicSlug: "proportsii",
    title: "Пропорции в 6 классе",
    whyText: "В ноябре шестиклассники проходят прямую и обратную пропорциональность. Листы с задачами на пропорции — частый запрос.",
    seoSlug: "proportsii-6-klass-noyabr",
  },
  {
    slug: "lineynye-7-dekabr",
    season: "autumn-2",
    weekLabel: "Декабрь · 1-2 неделя",
    subject: "algebra",
    grade: 7,
    topicSlug: "m-lin-uravn-7",
    title: "Линейные уравнения в 7 классе",
    whyText: "Конец четверти — учителя закрывают тему линейных уравнений. Карточки на 10-12 уравнений с ответами.",
    seoSlug: "lineynye-uravneniya-7-klass-dekabr",
  },
  {
    slug: "protsenty-5-fevral",
    season: "spring-1",
    weekLabel: "Февраль · 1-2 неделя",
    subject: "math",
    grade: 5,
    topicSlug: "protsenty-5",
    title: "Проценты в 5 классе",
    whyText: "В феврале пятиклассники начинают тему процентов — главный запрос среди родителей и репетиторов в это время.",
    seoSlug: "protsenty-5-klass-fevral",
  },
  {
    slug: "koord-ploskost-6-fevral",
    season: "spring-1",
    weekLabel: "Февраль · 3 неделя",
    subject: "math",
    grade: 6,
    topicSlug: "koordinatnaya-ploskost",
    title: "Координатная плоскость в 6 классе",
    whyText: "Координатная плоскость — тема, которая плохо ищется в шаблонах. Учителя ценят готовые листы с разметкой и заданиями.",
    seoSlug: "koordinatnaya-ploskost-6-klass-fevral",
  },
  {
    slug: "fsu-7-fevral",
    season: "spring-1",
    weekLabel: "Февраль · 4 неделя",
    subject: "algebra",
    grade: 7,
    topicSlug: "m-fsu-7",
    title: "Формулы сокращённого умножения",
    whyText: "ФСУ — первая серьёзная тема по алгебре в 7 классе. Учителя ищут карточки-тренажёры.",
    seoSlug: "fsu-formuly-7-klass-fevral",
  },
  {
    slug: "kvadratnye-8-aprel",
    season: "spring-2",
    weekLabel: "Апрель · 1-2 неделя",
    subject: "algebra",
    grade: 8,
    topicSlug: "m-kvadratnye-uravn-8",
    title: "Квадратные уравнения в 8 классе",
    whyText: "Квадратные уравнения — главная тема 8 класса по ФГОС. Учителя тренируют учеников карточками на дискриминант.",
    seoSlug: "kvadratnye-uravneniya-8-klass-aprel",
  },
  {
    slug: "treugolniki-7-may",
    season: "spring-2",
    weekLabel: "Май · 1-2 неделя",
    subject: "geometry",
    grade: 7,
    topicSlug: "treugolnik",
    title: "Треугольники и признаки равенства",
    whyText: "Геометрия в 7 классе начинается с треугольников. Конец года — учителя подтягивают отстающих листами.",
    seoSlug: "treugolniki-7-klass-may",
  },
  {
    slug: "sistemy-lineynye-7-may",
    season: "spring-2",
    weekLabel: "Май · 3-4 неделя",
    subject: "algebra",
    grade: 7,
    topicSlug: "m-sistemy-lineynye-7",
    title: "Системы линейных уравнений",
    whyText: "В конце 7 класса — итоговая тема по алгебре. Карточки на метод подстановки и сложения.",
    seoSlug: "sistemy-lineynye-7-klass-may",
  },
  {
    slug: "povtor-drobi-leto",
    season: "summer",
    weekLabel: "Лето",
    subject: "math",
    grade: 5,
    topicSlug: "drobi-obyknovennye",
    title: "Повторяем дроби за лето",
    whyText: "Летом родители и репетиторы возвращаются к дробям — повторяем то, что забыли за учебный год.",
    seoSlug: "povtoryaem-drobi-letom",
  },
  {
    slug: "povtor-tablitsa-leto",
    season: "summer",
    weekLabel: "Лето",
    subject: "math",
    grade: 2,
    topicSlug: "tablitsa-umnozheniya",
    title: "Повторяем таблицу умножения за лето",
    whyText: "Топовый летний запрос — карточки на таблицу умножения для повторения перед 3 классом.",
    seoSlug: "tablica-umnozheniya-leto-povtor",
  },
];
