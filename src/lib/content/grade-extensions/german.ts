/**
 * Немецкий язык — классы 5–11.
 * УМК: Бим, Голицынский, Зверлова. Темы — по разделам учебника и ФРП.
 * Классы 5–6 — вводный уровень (алфавит, числа, время, Present Simple),
 * 7–11 — грамматика и лексика с нарастающей сложностью.
 */

import type { Grade } from "../../types";

export const germanExtra: Grade[] = [
  {
    num: 5,
    title: "5 класс",
    topics: [
      {
        slug: "alphabet-i-chtenie",
        title: "Алфавит и правила чтения",
        fgosRef: "Основы немецкого языка",
        examples: [
          { text: "Сколько букв в немецком алфавите?", answer: "26" },
          { text: "Как читается немецкое «ß»?", answer: "двойное «с» (или долгое «с» после долгого гласного)" },
          { text: "Прочитайте: das Buch — «___»", answer: "дас бух (книга)" },
        ],
      },
      {
        slug: "zahlen-1-12",
        title: "Числа от 1 до 12 и счёт",
        fgosRef: "Лексика: числа",
        examples: [
          { text: "Как будет «5»?", answer: "fünf" },
          { text: "Как будет «11»?", answer: "elf" },
          { text: "Wie viele Bücher? — ___ Bücher. (12)", answer: "zwölf" },
        ],
      },
      {
        slug: "jahreszeiten-wochentage",
        title: "Времена года и дни недели",
        fgosRef: "Лексика: время",
        examples: [
          { text: "Как будет «лето»?", answer: "der Sommer" },
          { text: "Какой день недели первый?", answer: "Montag (понедельник)" },
          { text: "Wie ist das Wetter im Winter? — Es ist ___.", answer: "kalt / weiß / verschneit" },
        ],
      },
      {
        slug: "farben-i-odezhda",
        title: "Цвета и одежда",
        fgosRef: "Лексика: одежда",
        examples: [
          { text: "Wie heißt «красный»?", answer: "rot" },
          { text: "Как будет «футболка»?", answer: "das T-Shirt" },
          { text: "Вставьте: ___ Hemd ist weiß. (das)", answer: "Das" },
        ],
      },
      {
        slug: "present-simple-e",
        title: "Present Simple: ich, du, er/sie/es и глаголы на -e",
        fgosRef: "Грамматика: настоящее время",
        examples: [
          { text: "ich ___ (spielen) — «я играю»", answer: "spiele" },
          { text: "du ___ (lernen) — «ты учишься»", answer: "lernst" },
          { text: "Wie heißt «она делает»?", answer: "sie macht" },
        ],
      },
      {
        slug: "spielzeug-schulsachen",
        title: "Лексика: игрушки и школьные принадлежности",
        fgosRef: "Лексика: учебная деятельность",
        examples: [
          { text: "Как будет «мяч»?", answer: "der Ball" },
          { text: "Как будет «ручка»?", answer: "der Kugelschreiber / der Stift" },
          { text: "Составьте: Ich habe ___ Ball. (ein)", answer: "einen Ball" },
        ],
      },
    ],
  },
  {
    num: 6,
    title: "6 класс",
    topics: [
      {
        slug: "monate-und-daten",
        title: "Месяцы и даты",
        fgosRef: "Лексика: время",
        examples: [
          { text: "Как будет «январь»?", answer: "der Januar" },
          { text: "Какой месяц идёт после August?", answer: "September" },
          { text: "Heute ist ___. (1 September)", answer: "der erste September" },
        ],
      },
      {
        slug: "lebensmittel",
        title: "Продукты и еда",
        fgosRef: "Лексика: бытовая сфера",
        examples: [
          { text: "Как будет «хлеб»?", answer: "das Brot" },
          { text: "Как будет «молоко»?", answer: "die Milch" },
          { text: "Was trinkst du gern? — ___ Milch. (die)", answer: "die Milch" },
        ],
      },
      {
        slug: "einkaufen-und-geld",
        title: "Покупки и деньги",
        fgosRef: "Лексика: сфера услуг",
        examples: [
          { text: "Как будет «магазин»?", answer: "der Laden / das Geschäft" },
          { text: "Как будет «цена»?", answer: "der Preis" },
          { text: "Was kostet der Ball? — ___ Euro. (5)", answer: "fünf" },
        ],
      },
      {
        slug: "in-der-stadt",
        title: "В городе",
        fgosRef: "Лексика: город",
        examples: [
          { text: "Как будет «вокзал»?", answer: "der Bahnhof" },
          { text: "Как будет «улица»?", answer: "die Straße" },
          { text: "Составьте: Der Bahnhof ist neben ___. (das Postamt)", answer: "dem Postamt" },
        ],
      },
      {
        slug: "verkehrsmittel",
        title: "Транспорт",
        fgosRef: "Лексика: транспорт",
        examples: [
          { text: "Как будет «велосипед»?", answer: "das Fahrrad" },
          { text: "Как будет «автобус»?", answer: "der Bus" },
          { text: "Ich fahre mit dem ___. (автобус)", answer: "Bus" },
        ],
      },
      {
        slug: "hobbys",
        title: "Хобби и увлечения",
        fgosRef: "Лексика: досуг",
        examples: [
          { text: "Как будет «плавать» (о человеке)?", answer: "schwimmen" },
          { text: "Что значит «Mein Hobby ist Lesen»?", answer: "«Моё хобби — читать»" },
          { text: "Was macht sie in der Freizeit?", answer: "Sie spielt Gitarre / Sie tanzt gern" },
        ],
      },
    ],
  },
  {
    num: 7,
    title: "7 класс",
    topics: [
      {
        slug: "lichliche-pronomina",
        title: "Личные и притяжательные местоимения",
        fgosRef: "Грамматика: местоимения",
        examples: [
          { text: "Как будет «я читаю» (Ich ___ Buch)?", answer: "lese" },
          { text: "Как переводится «мой друг»?", answer: "mein Freund" },
          { text: "Вставьте: Das ist ___ Buch. (ein)", answer: "ein" },
        ],
      },
      {
        slug: "gessen-trinken",
        title: "Глаголы essen, trinken, nehmen",
        fgosRef: "Лексика: бытовые действия",
        examples: [
          { text: "ich ___ (essen) — «я ем»", answer: "esse" },
          { text: "Was ___ du? (trinken) — «Что ты пьёшь?»", answer: "trinkst" },
          { text: "Как будет «мы берём»?", answer: "wir nehmen" },
        ],
      },
      {
        slug: "artikel",
        title: "Артикли: определённый и неопределённый",
        fgosRef: "Грамматика: имя существительное",
        examples: [
          { text: "Вставьте артикль: ___ Tisch (ein)", answer: "ein" },
          { text: "Вставьте артикль: ___ Katze (die)", answer: "die" },
          { text: "Как будет «это мой дом»?", answer: "Das ist mein Haus" },
        ],
      },
      {
        slug: "akkusativ",
        title: "Аккузатив: der/die/das → den/die/das",
        fgosRef: "Грамматика: падеж",
        examples: [
          { text: "Ich sehe ___ Hund. (der)", answer: "den" },
          { text: "Ich kaufe ___ Buch. (das)", answer: "das" },
          { text: "Вставьте: Wir essen ___ Suppe. (die)", answer: "die" },
        ],
      },
      {
        slug: "wohnbestimmungen",
        title: "Глаголы sein и haben в настоящем времени",
        fgosRef: "Грамматика: глагол-связка",
        examples: [
          { text: "ich ___ müde (sein)", answer: "bin" },
          { text: "er ___ ein Lehrer (sein)", answer: "ist" },
          { text: "Wir ___ Hausaufgaben. (machen)", answer: "machen" },
        ],
      },
      {
        slug: "zahlwoerter",
        title: "Числительные и счёт от 1 до 100",
        fgosRef: "Лексика: числа",
        examples: [
          { text: "Как будет «23»?", answer: "dreiundzwanzig" },
          { text: "Как будет «40»?", answer: "vierzig" },
          { text: "Сколько будет 30 + 7?", answer: "37 (siebenunddreißig)" },
        ],
      },
      {
        slug: "haushalt-wohnen",
        title: "Лексика: дом и семья",
        fgosRef: "Лексика: бытовая сфера",
        examples: [
          { text: "Как будет «комната»?", answer: "das Zimmer" },
          { text: "Составь предложение: ich / wohnen / in / Berlin", answer: "Ich wohne in Berlin" },
          { text: "Как будет «мама»?", answer: "die Mutter" },
        ],
      },
    ],
  },
  {
    num: 8,
    title: "8 класс",
    topics: [
      {
        slug: "perfekt",
        title: "Прошедшее время Perfekt",
        fgosRef: "Грамматика: времена глагола",
        examples: [
          { text: "ich ___ (machen) — «я сделал»", answer: "habe gemacht" },
          { text: "er ___ (gehen) — «он пошёл»", answer: "ist gegangen" },
          { text: "Вставьте: Wir ___ gestern im Kino. (sein)", answer: "waren" },
        ],
      },
      {
        slug: "modalverben",
        title: "Модальные глаголы können, müssen, dürfen, wollen, mögen",
        fgosRef: "Грамматика: модальные глаголы",
        examples: [
          { text: "ich ___ (können) — «я умею»", answer: "kann" },
          { text: "Du ___ nicht laut singen. (dürfen)", answer: "darfst" },
          { text: "Wie heißt «я должен»?", answer: "ich muss" },
        ],
      },
      {
        slug: "reflexive-verben",
        title: "Возвратные глаголы",
        fgosRef: "Грамматика: возвратные глаголы",
        examples: [
          { text: "Wie heißt «я умываюсь»?", answer: "ich wasche mich" },
          { text: "Вставьте: Er freut ___ (sich)", answer: "sich" },
          { text: "Как будет «они радуются»?", answer: "sie freuen sich" },
        ],
      },
      {
        slug: "dativ",
        title: "Дательный падеж (Dativ)",
        fgosRef: "Грамматика: падеж",
        examples: [
          { text: "Ich gebe ___ Lehrerin das Buch. (der)", answer: "der" },
          { text: "Ich helfe ___ Kind. (das)", answer: "dem" },
          { text: "Вставьте: mit ___ Freund. (der)", answer: "meinem" },
        ],
      },
      {
        slug: "adjektiv-dekination",
        title: "Согласование прилагательных с артиклями",
        fgosRef: "Грамматика: прилагательные",
        examples: [
          { text: "ein ___ Hund (groß)", answer: "großer" },
          { text: "eine ___ Katze (klein)", answer: "kleine" },
          { text: "Вставьте: Das ist ___ Buch. (interessant)", answer: "interessante" },
        ],
      },
      {
        slug: "vergleichsstufen",
        title: "Сравнительная и превосходная степени",
        fgosRef: "Грамматика: степени сравнения",
        examples: [
          { text: "groß → größer → am größten (дайте форму превосходной)", answer: "am größten" },
          { text: "gut → besser → am besten", answer: "am besten" },
          { text: "Вставьте: Der Hund ist ___ als die Katze. (groß)", answer: "größer" },
        ],
      },
      {
        slug: "schule-alltag",
        title: "Лексика: школа и уроки",
        fgosRef: "Лексика: учебная деятельность",
        examples: [
          { text: "Как будет «урок»?", answer: "die Stunde" },
          { text: "Составьте: Ich / lernen / Deutsch / in / der Schule", answer: "Ich lerne Deutsch in der Schule" },
          { text: "Как будет «расписание уроков»?", answer: "der Stundenplan" },
        ],
      },
    ],
  },
  {
    num: 9,
    title: "9 класс",
    topics: [
      {
        slug: "konjunktiv-i",
        title: "Сослагательное наклонение Konjunktiv I",
        fgosRef: "Грамматика: сослагательное наклонение",
        examples: [
          { text: "ich ___ (sein) — Konjunktiv I, первое лицо: ___", answer: "sei" },
          { text: "er ___ (haben) — Konjunktiv I, третье лицо: ___", answer: "habe" },
          { text: "Как будет «он, что он читает»?", answer: "dass er liest" },
        ],
      },
      {
        slug: "passiv",
        title: "Passiv: страдательный залог",
        fgosRef: "Грамматика: залог",
        examples: [
          { text: "Der Brief ___ (schreiben) — пассив", answer: "wird geschrieben" },
          { text: "Die Rechnung ___ (bezahlen) — прошедшее пассив", answer: "wurde bezahlt" },
          { text: "Как будет «на неё смотрят»?", answer: "sie wird angesehen" },
        ],
      },
      {
        slug: "relativsaetze",
        title: "Придаточные предложения с относительными местоимениями",
        fgosRef: "Грамматика: сложные предложения",
        examples: [
          { text: "Der Mann, ___ ich sehe, ist mein Vater. (подставь)", answer: "den" },
          { text: "Die Stadt, in ___ ich wohne, ... (подставь)", answer: "der" },
          { text: "Das Buch, ___ ich lese, ist interessant. (подставь)", answer: "das" },
        ],
      },
      {
        slug: "indirekte-rede",
        title: "Косвенная речь",
        fgosRef: "Грамматика: косвенная речь",
        examples: [
          { text: "Er sagt: «Ich habe Zeit.» → Er sagt, dass er ___ Zeit hat.", answer: "habe" },
          { text: "Sie sagt: «Ich komme.» → Sie sagt, dass sie ___.", answer: "kommt" },
          { text: "Вопрос: «Wo ist er?» → Er fragt, wo er ___", answer: "ist" },
        ],
      },
      {
        slug: "praepositionalausdruecke",
        title: "Предложные сочетания",
        fgosRef: "Грамматика: предлоги",
        examples: [
          { text: "___ Schule gehen (в школу)", answer: "in die" },
          { text: "___ Haus arbeiten (дома)", answer: "zu Hause" },
          { text: "___ Freund sprechen (с другом)", answer: "mit einem" },
        ],
      },
      {
        slug: "reisen-verkehr",
        title: "Лексика: путешествие и транспорт",
        fgosRef: "Лексика: транспорт",
        examples: [
          { text: "Как будет «поезд»?", answer: "der Zug" },
          { text: "Составьте: Wir fahren mit dem Bus nach ___.", answer: "Berlin / Moskau / etc." },
          { text: "Как будет «билет»?", answer: "die Fahrkarte" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "konjunktiv-ii",
        title: "Сослагательное наклонение Konjunktiv II",
        fgosRef: "Грамматика: сослагательное наклонение",
        examples: [
          { text: "ich ___ (haben) — Konjunktiv II, первое лицо: ___", answer: "hätte" },
          { text: "er ___ (sein) — Konjunktiv II, третье лицо: ___", answer: "wäre" },
          { text: "An deiner Stelle ___ ich mehr Zeit. (haben)", answer: "hätte" },
        ],
      },
      {
        slug: "infinitiv-mit-zu",
        title: "Инфинитив с zu",
        fgosRef: "Грамматика: инфинитивные конструкции",
        examples: [
          { text: "Ich habe Lust, ___ ins Kino zu gehen.", answer: "ins Kino zu gehen" },
          { text: "Bitte, nicht ___! (rauchen)", answer: "zu rauchen" },
          { text: "Er hat vergessen, ___ die Hausaufgaben zu machen.", answer: "die Hausaufgaben zu machen" },
        ],
      },
      {
        slug: "passiv-zeitformen",
        title: "Passiv во всех временах",
        fgosRef: "Грамматика: залог",
        examples: [
          { text: "Präsens Passiv: Das Buch ___ gelesen.", answer: "wird" },
          { text: "Futur I Passiv: Die Arbeit ___ gemacht werden.", answer: "wird" },
          { text: "Plusquamperfekt Passiv: Er ___ worden.", answer: "war ... worden" },
        ],
      },
      {
        slug: "komparative-saetze",
        title: "Сравнительные конструкции",
        fgosRef: "Грамматика: сложные предложения",
        examples: [
          { text: "___ Grammatik als Russisch (сравнивается содержание)", answer: "Die deutsche Grammatik ist schwieriger als die russische" },
          { text: "Der Film war so schön, ___ ich ihn zweimal sah.", answer: "dass" },
          { text: "Je mehr man übt, ___ besser wird man.", answer: "desto" },
        ],
      },
      {
        slug: "beruf-arbeit",
        title: "Лексика: профессии и работа",
        fgosRef: "Лексика: профессиональная сфера",
        examples: [
          { text: "Как будет «врач»?", answer: "der Arzt / die Ärztin" },
          { text: "Составьте: Er arbeitet als ___.", answer: "Lehrer / Arzt / Ingenieur" },
          { text: "Как будет «зарплата»?", answer: "der Lohn / das Gehalt" },
        ],
      },
      {
        slug: "medien-gesellschaft",
        title: "Лексика: СМИ и интернет",
        fgosRef: "Лексика: средства массовой информации",
        examples: [
          { text: "Как будет «новость»?", answer: "die Nachricht" },
          { text: "Как будет «компьютер»?", answer: "der Computer" },
          { text: "Составьте: Ich lese Nachrichten im ___.", answer: "Internet" },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "partizipien",
        title: "Причастия настоящего и прошедшего времени",
        fgosRef: "Грамматика: причастия",
        examples: [
          { text: "das ___ Buch (lesen) — читаемая книга", answer: "lesende" },
          { text: "das ___ Haus (bauen) — построенный дом", answer: "gebaute" },
          { text: "der ___ Mann (arbeiten) — работающий мужчина", answer: "arbeitende" },
        ],
      },
      {
        slug: "komplexe-saetze",
        title: "Сложные предложения с придаточными",
        fgosRef: "Грамматика: синтаксис",
        examples: [
          { text: "Wenn ich Zeit ___, gehe ich ins Kino.", answer: "habe" },
          { text: "Obwohl es regnet, ___ wir spazieren.", answer: "gehen" },
          { text: "Damit du die Prüfung ___, musst du lernen.", answer: "bestehst" },
        ],
      },
      {
        slug: "kenntnisse-pruefung",
        title: "Подготовка к экзамену: лексика по темам",
        fgosRef: "Лексика: экзаменационные темы",
        examples: [
          { text: "Как будет «здоровье»?", answer: "die Gesundheit" },
          { text: "Как будет «окружающая среда»?", answer: "die Umwelt" },
          { text: "Составьте: Umweltschutz ist sehr ___.", answer: "wichtig" },
        ],
      },
      {
        slug: "ausdrucke-feste",
        title: "Устойчивые выражения и идиомы",
        fgosRef: "Лексика: устойчивые сочетания",
        examples: [
          { text: "Как будет «идти в кино» (устно)?", answer: "ins Kino gehen" },
          { text: "Как будет «у меня есть время»?", answer: "Ich habe Zeit" },
          { text: "Как будет «прийти в себя»?", answer: "zu sich kommen" },
        ],
      },
      {
        slug: "wetter-umwelt",
        title: "Лексика: погода и окружающая среда",
        fgosRef: "Лексика: природа и экология",
        examples: [
          { text: "Wie ist das Wetter? — Es ___.", answer: "regnet / schneit / ist sonnig" },
          { text: "Как будет «мусор»?", answer: "der Müll" },
          { text: "Составьте: Wir müssen die Umwelt ___.", answer: "schützen" },
        ],
      },
      {
        slug: "schreiben-essay",
        title: "Письмо-эссе: структура и связки",
        fgosRef: "Письмо: эссе",
        examples: [
          { text: "Вставьте связку: Zuerst ..., dann ..., zum Schluss ...", answer: "Zuerst schreibe ich ..., dann ..., zum Schluss ..." },
          { text: "Вставьте: ___erseits ..., andererseits ...", answer: "Einerseits ... andererseits" },
          { text: "Как закончить эссе?", answer: "Zusammenfassend kann man sagen, dass ..." },
        ],
      },
    ],
  },
];
