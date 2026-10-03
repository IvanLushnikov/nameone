/**
 * Английский язык — классы 1, 3, 10, 11.
 * Класс 3 в базе уже есть (4 темы) — здесь только 2 НОВЫЕ, дозаполняющие
 * его до 6. Остальные классы в базе отсутствуют и добавляются целиком.
 * УМК: 1 класс — Spotlight / Starter; 10-11 — Билингвальный, профориентация.
 */

import type { Grade } from "../../types";

export const englishExtra: Grade[] = [
  {
    num: 1,
    title: "1 класс",
    topics: [
      {
        slug: "alphabet",
        title: "Алфавит. Буквы A–Z",
        fgosRef: "Лексика. Алфавит",
        examples: [
          { text: "Which letter comes after B?", answer: "C" },
          { text: "How many letters are in the English alphabet?", answer: "26" },
          { text: "Write the English letter: кот", answer: "K" },
        ],
      },
      {
        slug: "greetings-introductions",
        title: "Приветствия и знакомство",
        fgosRef: "Лексика. Речевые формулы",
        examples: [
          { text: "Как будет «Доброе утро»?", answer: "Good morning" },
          { text: "Вставьте: My name ___ Anna.", answer: "is" },
          { text: "Ответьте на приветствие: Hello! — __", answer: "Hi! / Hello!" },
        ],
      },
      {
        slug: "numbers-1-10",
        title: "Числа от 1 до 10",
        fgosRef: "Лексика. Числительные",
        examples: [
          { text: "Which number is «семь»?", answer: "7" },
          { text: "Write in digits: three", answer: "3" },
          { text: "Which number comes after 9?", answer: "10" },
        ],
      },
      {
        slug: "colors-basic",
        title: "Цвета",
        fgosRef: "Лексика. Цвета",
        examples: [
          { text: "Which colour is «красный»?", answer: "red" },
          { text: "Choose the word: an ___ (apple, book)", answer: "apple" },
          { text: "Как будет «жёлтый»?", answer: "yellow" },
        ],
      },
      {
        slug: "to-be-am-is-are",
        title: "Глагол to be: am, is, are",
        fgosRef: "Грамматика: глагол-связка",
        examples: [
          { text: "Вставьте: I ___ a pupil.", answer: "am" },
          { text: "Вставьте: She ___ my friend.", answer: "is" },
          { text: "Вставьте: We ___ at school.", answer: "are" },
        ],
      },
    ],
  },
  {
    // В базе уже есть 5 тем 3 класса (present-simple-beginner,
    // present-continuous, modal-can-cant, school-things, weather-vocabulary).
    // Дописываем только новые.
    num: 3,
    title: "3 класс",
    topics: [
      {
        slug: "present-simple-1",
        title: "Present Simple: глаголы 1-го лица и my / your",
        fgosRef: "Грамматика: Present Simple",
        examples: [
          { text: "Поставьте глагол: I ___ (play) football.", answer: "play" },
          { text: "Вставьте: This is ___ (my) pen.", answer: "my" },
          { text: "Поставьте глагол: My mum ___ (read) books.", answer: "reads" },
        ],
      },
      {
        slug: "numbers-11-100",
        title: "Числа от 11 до 100",
        fgosRef: "Лексика. Числительные",
        examples: [
          { text: "Which number is «двенадцать»?", answer: "12" },
          { text: "Write in digits: thirty-five", answer: "35" },
          { text: "Which number comes after 19?", answer: "20" },
        ],
      },
      {
        slug: "questions-wh-3",
        title: "Вопросы: What, Where, How many, How old",
        fgosRef: "Грамматика: вопросы с вопросительными словами",
        examples: [
          { text: "Задайте вопрос: «___ is your name?»", answer: "What" },
          { text: "Вставьте: ___ books do you have? — Five.", answer: "How many" },
          { text: "Вставьте: ___ is my bag? — It is on the desk.", answer: "Where" },
        ],
      },
    ],
  },
  {
    num: 10,
    title: "10 класс",
    topics: [
      {
        slug: "gerund-infinitive",
        title: "Герундий и инфинитив (verb + -ing / to)",
        fgosRef: "Грамматика: неличные формы глагола",
        examples: [
          { text: "Выберите: enjoy ___ (read)", answer: "reading" },
          { text: "Вставьте: I promise ___ (help) you.", answer: "to help" },
          { text: "Выберите: stop ___ (talk)", answer: "talking" },
        ],
      },
      {
        slug: "relative-clauses",
        title: "Придаточные предложения с who, which, that",
        fgosRef: "Грамматика: сложное предложение",
        examples: [
          { text: "Вставьте: The man ___ lives next door is a doctor.", answer: "who" },
          { text: "Вставьте: The girl ___ is playing the piano is my sister.", answer: "who" },
          { text: "Вставьте: This is the book ___ I told you about.", answer: "that (which)" },
        ],
      },
      {
        slug: "reported-speech-backshift",
        title: "Косвенная речь: сдвиг времён",
        fgosRef: "Грамматика: косвенная речь",
        examples: [
          { text: "He said, «I am busy.» → He said that he ___ busy.", answer: "was" },
          { text: "She said, «I have finished.» → She said that she ___ finished.", answer: "had" },
          { text: "They said, «We are leaving.» → They said that they ___ leaving.", answer: "were" },
        ],
      },
      {
        slug: "narrative-tense-linking",
        title: "Согласование времён в повествовании (Past Perfect)",
        fgosRef: "Грамматика: Past Perfect",
        examples: [
          { text: "Вставьте: By the time we arrived, the film ___ (already / start).", answer: "had started" },
          { text: "Вставьте: I ___ (finish) my homework before he called.", answer: "had finished" },
        ],
      },
      {
        slug: "modal-inference-deduction",
        title: "Модальные глаголы предположения: must, may not",
        fgosRef: "Грамматика: модальные глаголы",
        examples: [
          { text: "Вставьте: He has been running for an hour. He ___ be tired.", answer: "must" },
          { text: "Вставьте: She is very quiet now. She ___ be at work.", answer: "must" },
          { text: "Вставьте: He didn't come. He ___ be busy.", answer: "may not" },
        ],
      },
      {
        slug: "poriadok-prilagatelnykh",
        title: "Порядок прилагательных",
        fgosRef: "Грамматика: имя прилагательное",
        examples: [
          { text: "Put in order: a ___ car (big, black, beautiful)", answer: "a beautiful big black car" },
          { text: "Вставьте артикль: It's ___ interesting book.", answer: "an" },
          { text: "Put in order: a ___ table (wooden, small)", answer: "a small wooden table" },
        ],
      },
    ],
  },
  {
    num: 11,
    title: "11 класс",
    topics: [
      {
        slug: "slovoobrazovanie-ege",
        title: "Словообразование для ЕГЭ",
        fgosRef: "Лексика: словообразование",
        examples: [
          { text: "Образуйте прилагательное от «differ»", answer: "different" },
          { text: "Образуйте существительное от «decide» (суффикс -ion)", answer: "decision" },
          { text: "От какой основы образовано «information»?", answer: "inform" },
        ],
      },
      {
        slug: "inversion-formal",
        title: "Инверсия и формальные конструкции",
        fgosRef: "Грамматика: условные и инверсия",
        examples: [
          { text: "Поставьте слова: Never ___ such a beautiful sunset.", answer: "have I seen" },
          { text: "Поставьте слова: Only when we arrived ___ the news.", answer: "did we learn" },
          { text: "Were I rich, I ___ travel the world.", answer: "would" },
        ],
      },
      {
        slug: "aspect-continuous-vs-permanent",
        title: "Длительное и продолжённое время",
        fgosRef: "Грамматика: категория времени",
        examples: [
          { text: "Выберите: He ___ (live) in London since 2010.", answer: "lives (постоянно)" },
          { text: "Вставьте: Listen! Someone ___ (call).", answer: "is calling" },
          { text: "Вставьте: She isn't working now. She ___ (finish) her project.", answer: "has finished" },
        ],
      },
      {
        slug: "causative-construction",
        title: "Конструкции should, would, have",
        fgosRef: "Грамматика: конструкции с модальными глаголами",
        examples: [
          { text: "Вставьте: I want you ___ repair the car.", answer: "to have" },
          { text: "Вставьте: I would like ___ (pack) my suitcase for me.", answer: "you to pack" },
          { text: "He had his hair cut. → He had a barber ___ his hair.", answer: "cut" },
        ],
      },
      {
        slug: "ege-topic-environment",
        title: "Лексика по теме «Окружающая среда» (ЕГЭ)",
        fgosRef: "Лексика: тематические блоки ЕГЭ",
        examples: [
          { text: "Как переводится «загрязнение воздуха»?", answer: "air pollution" },
          { text: "Как переводится «возобновляемые источники энергии»?", answer: "renewable energy sources" },
          { text: "Вставьте: We must ___ (save) water and energy.", answer: "save" },
        ],
      },
      {
        slug: "ege-writing-essay",
        title: "Письмо: эссе-рассуждение ЕГЭ",
        fgosRef: "Письмо. Формат ЕГЭ",
        examples: [
          { text: "Сколько слов должно содержать эссе ЕГЭ?", answer: "250–275" },
          { text: "Начните эссе-рассуждение на тему «Should people use public transport?» со слов __", answer: "In my opinion, / I strongly believe that" },
          { text: "В какой части эссе приводятся аргументы?", answer: "в основной части (body), 2-й и 3-й абзацы" },
        ],
      },
    ],
  },
];
