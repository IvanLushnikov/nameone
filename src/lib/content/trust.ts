/**
 * Контент страниц доверия: `/about/`, `/contact/`, `/methodology/`.
 *
 * ## Почему файл существует
 *
 * На сайте принимают оплату, но не было ни одной страницы, на которой видно,
 * кто стоит за сервисом. `/about/`, `/contact/` и `/methodology/` отдавали 404,
 * а `/register/` — тоже, хотя регистрация спрятана внутри `/login/`.
 *
 * ## Правило файла: никаких выдуманных значений
 *
 * Всё, чего у проекта нет (ИНН, адрес, дата запуска, фото команды, имена
 * методистов), лежит здесь НЕ как правдоподобная строка, а как явная пометка
 * «[вписывает владелец]» (`NEEDS_FILL_LABEL`). Правдоподобно выдуманный ИНН
 * опаснее пустого места: по нему плательщик пойдёт проверять платёж и не
 * найдёт ничего. Пометка читается словами, а не символами шаблона `{{ }}` —
 * иначе на бою она выглядит как недособранная вёрстка.
 *
 * Значение считается незаполненным, если переменная окружения пустая
 * (`NEXT_PUBLIC_OPERATOR_INN` и т.д.), и тогда на страницу попадает
 * плейсхолдер из `NEEDS_FILL`, а не пустая строка.
 *
 * ## Почему цифры считаются, а не вписаны
 *
 * Предметы, темы и примеры заданий лежат в таксономии (`subjects.ts`), и она
 * растёт каждым расширением. Вписанная руками цифра «21 предмет» через месяц
 * разойдётся с кодом, и страница доверия начнёт врать — а это худший из
 * возможных исходов именно для страницы про доверие. Поэтому все числа ниже
 * считаются из таксономии при сборке.
 */

import { subjects, allTopics } from "./subjects";
import { umk } from "./umk";
import { EXAM_SUBJECTS } from "./exam-taxonomy";
import {
  OPERATOR_ADDRESS,
  OPERATOR_INN,
  OPERATOR_NAME,
  SUPPORT_EMAIL,
} from "../site";
import { plural } from "../utils/cn";

/**
 * Помечает значение как «нужно вписать», если оно не задано.
 *
 * Пустая строка в реквизитах хуже любой пометки: пустую строку читатель
 * списывает как «опечатка».
 *
 * Б-3: раньше пометка была шаблонной скобкой — `{{ ИНН }}`. Такая строка
 * выглядит как недоделанная вёрстка, а не как честное «здесь нужно вписать»:
 * на бою `/contact/` и `/about/` показывали её как есть. Теперь пометка
 * читается словами — «[вписывает владелец]» — и её нельзя принять за данные.
 * Что именно не заполнено, видно по подписи строки: «ФИО», «ИНН»,
 * «Адрес регистрации».
 */
export function filled(value: string | undefined, placeholder: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : placeholder;
}

/**
 * Пометка незаполненного реквизита. Слова, а не символы шаблона: читатель
 * должен понять, что перед ним незаполненное поле, а не сбой вёрстки.
 */
export const NEEDS_FILL_LABEL = "[вписывает владелец]";

/* ------------------------------------------------------------------ */
/* ЦИФРЫ ПРОДУКТА — считаются из таксономии                            */
/* ------------------------------------------------------------------ */

const catalog = (() => {
  let subjectGrades = 0;
  let topics = 0;
  let examples = 0;
  let topicsWithSection = 0;
  const gradeNums = new Set<number>();

  for (const subject of subjects) {
    subjectGrades += subject.grades.length;
    for (const grade of subject.grades) {
      gradeNums.add(grade.num);
      topics += grade.topics.length;
      for (const topic of grade.topics) {
        examples += topic.examples.length;
        // `fgosRef` — ссылка на раздел ФГОС, см. `Topic` в src/lib/types.ts.
        if (topic.fgosRef) topicsWithSection += 1;
      }
    }
  }

  const nums = [...gradeNums].sort((a, b) => a - b);
  const umkEntries = Object.values(umk).reduce((sum, list) => sum + list.length, 0);

  return {
    subjects: subjects.length,
    subjectGrades,
    topics,
    // Сверка с `allTopics()`: если расширения в `subjects.ts` перестанут
    // подмешиваться, цифры выше разойдутся с этой — тест это поймает.
    topicsByAllTopics: allTopics().length,
    examples,
    topicsWithSection,
    umkEntries,
    umkSubjects: Object.keys(umk).length,
    examTasks: EXAM_SUBJECTS.reduce((sum, s) => sum + s.numbers.length, 0),
    gradeFrom: nums[0],
    gradeTo: nums[nums.length - 1],
  };
})();

export const catalogStats = catalog;

/** «1–11» — диапазон классов из таксономии, в коде не вписан строкой. */
export const gradeRange = `${catalog.gradeFrom}–${catalog.gradeTo}`;

/** «1–11 класс» — как подпись диапазона. */
export const gradeRangeLabel = `${gradeRange} класс`;

/*
 * Формы слов под числами.
 *
 * Числа приходят из кода, поэтому и падежи приходят из кода: строка
 * «21 предметов» в description — это ровно та мелкая небрежность, ради которой
 * страницу доверия перестают читать внимательно. Считаем теми же числами,
 * что выводятся на страницу, иначе подпись и значение разойдутся при первом
 * же расширении таксономии.
 */
export const subjectsWord = plural(catalog.subjects, "предмет", "предмета", "предметов");
export const topicsWord = plural(catalog.topics, "тема", "темы", "тем");
export const examplesWord = plural(catalog.examples, "пример", "примера", "примеров");
export const examTasksWord = plural(catalog.examTasks, "страница", "страницы", "страниц");
export const subjectGradesWord = plural(
  catalog.subjectGrades,
  "сочетание",
  "сочетания",
  "сочетаний",
);
/** Дательный падеж: «по 126 учебникам». */
export const umkDative = plural(catalog.umkEntries, "учебнику", "учебникам", "учебникам");

/* ------------------------------------------------------------------ */
/* КОНТАКТЫ                                                             */
/* ------------------------------------------------------------------ */

/**
 * Telegram-канал проекта. Адрес взят из подвала (`Footer.tsx`) — это
 * единственное место в коде, где канал объявлен, поэтому он и есть источник
 * истины для `/contact/`.
 */
export const TELEGRAM_URL = "https://t.me/uchlist";

/** Почта: из `NEXT_PUBLIC_SUPPORT_EMAIL`, дефолт `hello@uchlist.ru` (src/lib/site.ts). */
export const supportEmail = SUPPORT_EMAIL;

export const contactChannels = [
  {
    id: "email",
    label: supportEmail,
    href: `mailto:${supportEmail}`,
    note: "Вопросы по сервису, оплате и документам.",
  },
  {
    id: "telegram",
    label: "Telegram",
    href: TELEGRAM_URL,
    note: "Канал проекта: там выкладываем, что изменилось в продукте.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* РЕКВИЗИТЫ                                                           */
/* ------------------------------------------------------------------ */

/**
 * Реквизиты оператора.
 *
 * Режим — самозанятость (НПД, гл. 23 НК РФ): он прямо назван в разделе 2
 * публичной оферты (`src/app/legal/[slug]/page.tsx`), то есть это уже
 * опубликованная и действующая формулировка, а не наша догадка.
 *
 * ОГРН/ОГРНИП здесь нет намеренно. Самозанятость не образует юрлица и ОГРНИП
 * не присваивает: плательщик идентифицирует исполнителя по ИНН из «Мой налог»
 * (обоснование — комментарий в `src/lib/site.ts`). Писать «ОГРН» сюда значило
 * бы либо выдумать номер, либо пообещать реквизит, которого у режима нет.
 */
export const operator = {
  regime: "самозанятый, налог на профессиональный доход (глава 23 НК РФ)",
  regimeNote:
    "Самозанятость не образует юридического лица, поэтому у исполнителя нет ОГРН и ОГРНИП. Проверить статус можно по ИНН в приложении «Мой налог».",
  name: filled(OPERATOR_NAME, NEEDS_FILL_LABEL),
  inn: filled(OPERATOR_INN, NEEDS_FILL_LABEL),
  address: filled(OPERATOR_ADDRESS, NEEDS_FILL_LABEL),
};

/**
 * Дата запуска сервиса. Не выдумывается: точной даты в коде нет, а дата
 * «примерно в 2026-м» в разделе «Кто мы» читается как уверенное обещание.
 * Значение должен проставить владелец (см. `NEEDS_FILL`).
 */
export const launchDate = NEEDS_FILL_LABEL;

/**
 * СПИСОК ВСЕГО, ЧТО ДОЛЖЕН ВПИСАТЬ ВЛАДЕЛЕЦ ПЕРЕД ПУБЛИКАЦИЕЙ.
 *
 * Один список на все три страницы, чтобы нельзя было заполнить `/contact/`
 * и забыть про `/about/`. Тест `tests/trust-pages.test.ts` проверяет, что
 * каждая пометка из списка действительно отрисована на своей странице.
 *
 * `placeholder` у всех полей один и тот же — смысл несёт `label`: по подписи
 * строки («ИНН», «Адрес регистрации») видно, что именно не заполнено.
 */
export const NEEDS_FILL = [
  { page: "/about/", label: "Дата запуска сервиса", placeholder: launchDate },
  { page: "/about/", label: "Имя и роль автора проекта", placeholder: NEEDS_FILL_LABEL },
  { page: "/about/", label: "Фото автора проекта", placeholder: NEEDS_FILL_LABEL },
  { page: "/contact/", label: "ИНН исполнителя", placeholder: NEEDS_FILL_LABEL },
  { page: "/contact/", label: "Адрес регистрации", placeholder: NEEDS_FILL_LABEL },
] as const;

/** Собирает все пометки страницы — используется тестом. */
export function placeholdersOf(page: string): string[] {
  return NEEDS_FILL.filter((item) => item.page === page).map((item) => item.placeholder);
}

/* ------------------------------------------------------------------ */
/* МЕТОДИКА                                                             */
/* ------------------------------------------------------------------ */

/**
 * Критерии сложности.
 *
 * Формулировки взяты из системного промпта генерации
 * (`backend/src/llm/prompts/worksheet-gen.ts`, правило 4): модель обязана
 * держать эти рамки, и страница не должна обещать учителю критерий, который
 * в коде не задан.
 */
export const difficultyLevels = [
  {
    id: "easy",
    label: "Лёгкий",
    criterion: "1 балл, один навык в лоб",
  },
  {
    id: "medium",
    label: "Средний",
    criterion: "2 балла, два шага или приём в знакомой ситуации",
  },
  {
    id: "hard",
    label: "Сложный",
    criterion: "3 балла, несколько шагов и рассуждение",
  },
] as const;

/** Типы заданий, между которыми модель обязана чередовать формулировки. */
export const taskTypes = [
  { id: "computation", label: "расчёт" },
  { id: "multiple-choice", label: "выбор из вариантов, ровно 4 варианта" },
  { id: "short-answer", label: "краткий ответ" },
  { id: "essay", label: "развёрнутый ответ" },
  { id: "fill-blank", label: "вставь в пропуск" },
] as const;

/** Шаги регистрации — по фактическому механизму входа (magic link). */
export const registrationSteps = [
  {
    step: "1",
    title: "Оставьте почту",
    text: "Пароля нет. Мы присылаем одноразовую ссылку на вход.",
  },
  {
    step: "2",
    title: "Откройте письмо",
    text: "Ссылка работает один раз и ведёт в кабинет. Если не пришла — проверьте папку «Спам».",
  },
  {
    step: "3",
    title: "Пользуйтесь кабинетом",
    text: "История генераций, избранное и шаблоны хранятся в аккаунте, а не в браузере.",
  },
] as const;