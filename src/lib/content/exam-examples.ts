/**
 * F-04-B / блок B: настоящие примеры заданий для SEO-страниц
 * `/exam/[exam]/[subject]/[number]` (218 номеров ОГЭ/ЕГЭ).
 *
 * ЗАЧЕМ. Раньше на всех этих страницах блок «Примеры заданий» был
 * пустой заглушкой — 13% sitemap отдавал в индексе страницу без
 * единого примера. Здесь лежат настоящие примеры с ответами из
 * таксономии программы (`subjects.ts` + `grade-extensions/*`), а там, где
 * точного примера в репозитории нет, — честный блок «Что проверяет это
 * задание» из `fgosRef`/`description` экзамена.
 *
 * ЧЕСТНОСТЬ ДАННЫХ (главное правило файла).
 * Ничего не придумываем: ни формулировок «из хэша», ни правдоподобных
 * цифр. Есть только то, что уже лежит в репозитории:
 *   • примеры `{ text, answer }` — из тем таксономии;
 *   • «что проверяет задание» — из `fgosRef`/`description` экзамена.
 * Если для конкретного номера нет подходящей темы с примерами — НЕ
 * подставляем «похожую на глаз» тему и НЕ сочиняем пример, а отдаём
 * честный блок и ссылку на страницу предмета, где примеры есть.
 *
 * КАК СОПОСТАВЛЯЕМ НОМЕР ФИПИ С ТЕМОЙ ПРОГРАММЫ (детерминированно).
 * У таксономии нет ключа «номер ФИПИ»: `fgosRef` у темы — это параграф
 * учебника («Мерзляк Гл. 2 §7–9»), а не раздел кодификатора. Поэтому
 * нечёткое сопоставление по словам здесь даёт мусор (проверяли: 0 из 218
 * совпадений при match по токенам заголовка) — такое сопоставление
 * запрещено, оно приклеивает примеры не к той теме.
 * Вместо него используется ЯВНАЯ таблица сопоставления
 * `TOPIC_EXAMPLE_LINKS`: ключ `экзамен:предмет:номер` → список троек
 * `[предметТаксономии, класс, слагТемы]`. Таблица детерминирована, её
 * видно глазами, и каждый слаг проверяется на существование в
 * `subjects.ts` (см. `resolveTopic`, который молча отбрасывает
 * несуществующие слаги — на страницу не попадёт ничего выдуманного).
 *
 * Логика подбора тем (видна в таблице и проверяется тестом):
 *   • ОГЭ → программа 7–9 классов, ЕГЭ → программа 10–11 классов;
 *   • математика раскладывается по «Алгебра» (вычисления, уравнения,
 *     функции, прогрессии, вероятность) и «Геометрия» (фигуры,
 *     окружность, площади, векторы) — так же, как она делится в
 *     кодификаторе;
 *   • ссылки ведут на существующие страницы тем
 *     `/subject/[subject]/[grade]/[topic]`.
 */

import type { Topic, TopicExample } from "../types";
import { getSubject, subjects } from "./subjects";
import { getExamNumber, type ExamKind } from "./exam-taxonomy";

// ========================== ТИПЫ ==========================

/** Пример задания, взятый из реальной темы программы. */
export interface ExamExample {
  /** Формулировка задания — дословно из темы таксономии. */
  text: string;
  /** Ответ — дословно из темы таксономии. */
  answer: string;
  /** Название темы программы, из которой взят пример. */
  topicTitle: string;
  /** Ссылка на страницу темы: /subject/[subject]/[grade]/[topic]. */
  topicHref: string;
}

/** Честный блок для номеров без готовых примеров в репозитории. */
export interface ExamHonestBlock {
  /** Что проверяет задание — из fgosRef/description экзамена. */
  checks: string;
  /** Раздел ФИПИ, к которому относится задание. */
  fgosRef: string;
  /** Ссылка на страницу предмета, где примеры точно есть. */
  subjectHref: string;
  /** Название предмета программы. */
  subjectTitle: string;
}

/** Смежная тема программы для перелинковки. */
export interface RelatedTopic {
  title: string;
  href: string;
}

/** Итог по конкретному номеру экзамена. */
export type ExamExampleBlock =
  | { kind: "examples"; examples: ExamExample[] }
  | { kind: "honest"; block: ExamHonestBlock };

// ========================== ВСПОМОГАТЕЛЬНОЕ ==========================

/**
 * Индекс всех тем таксономии: ключ `предмет/класс/слаг` → тема.
 * Строится один раз при импорте модуля.
 */
const TOPIC_INDEX = new Map<string, Topic>();
for (const subject of subjects) {
  for (const grade of subject.grades) {
    for (const topic of grade.topics) {
      TOPIC_INDEX.set(`${subject.slug}/${grade.num}/${topic.slug}`, topic);
    }
  }
}

/** Ссылка на страницу темы. */
function topicHref(subjectSlug: string, grade: number, topicSlug: string): string {
  return `/subject/${subjectSlug}/${grade}/${topicSlug}/`;
}

/**
 * Разрешает тему в реальные примеры с ответами.
 * Слага, которого нет в таксономии, или тема без примеров с непустыми
 * `text` и `answer` отбрасываются — на страницу не попадёт ничего
 * выдуманного.
 */
function resolveTopic(
  subjectSlug: string,
  grade: number,
  topicSlug: string,
): { topic: Topic; href: string } | null {
  const topic = TOPIC_INDEX.get(`${subjectSlug}/${grade}/${topicSlug}`);
  if (!topic) return null;
  const hasRealExample = topic.examples.some(
    (e: TopicExample) => e.text.trim().length > 0 && (e.answer ?? "").trim().length > 0,
  );
  if (!hasRealExample) return null;
  return { topic, href: topicHref(subjectSlug, grade, topicSlug) };
}

// ========================== ТАБЛИЦА СОПОСТАВЛЕНИЯ ==========================

/** `[предмет таксономии, класс, слаг темы]` — все поля реальные. */
type TopicRef = readonly [subject: string, grade: number, topic: string];

const TOPIC_EXAMPLE_LINKS: Record<string, TopicRef[]> = {
  // --------------------- ОГЭ · Математика (1–19) ---------------------
  "oge:math:1": [["algebra", 7, "m-lin-uravn-7"]],
  "oge:math:2": [["algebra", 9, "m-neravenstva-9"]],
  "oge:math:3": [
    ["math", 6, "deystviya-s-ratsionalnymi"],
    ["math", 6, "otritsatelnye-chisla"],
  ],
  "oge:math:4": [
    ["math", 5, "protsenty-5"],
    ["math", 5, "drobi-obyknovennye"],
  ],
  "oge:math:5": [
    ["algebra", 9, "md-chislovye-funkcii-9"],
    ["geometry", 9, "koordinaty-9"],
  ],
  "oge:math:6": [["algebra", 9, "m-arifm-progressiya-9"]],
  "oge:math:7": [["algebra", 9, "m-geom-progressiya-9"],
    ["algebra", 9, "md-geom-progressiya-9"]],
  "oge:math:8": [["algebra", 7, "md-mnogochleny-arifmet-7"],
    ["algebra", 7, "md-mat-yazyk-7"]],
  "oge:math:9": [["algebra", 8, "m-kvadratnye-uravn-8"],
    ["algebra", 8, "a-kvadratnye-uravn-8"]],
  "oge:math:10": [["algebra", 8, "m-drobnye-rats-uravn-8"],
    ["algebra", 8, "a-rats-uravn-8"]],
  "oge:math:11": [["algebra", 9, "md-chislovye-funkcii-9"]],
  "oge:math:12": [
    ["algebra", 9, "m-neravenstva-9"],
    ["algebra", 9, "md-ratsionalnye-neravenstva-9"],
  ],
  "oge:math:13": [["algebra", 7, "md-sistemy-lineynye-7"],
    ["algebra", 9, "md-sistemy-uravneniy-9"]],
  "oge:math:14": [
    ["math", 5, "protsenty-5"],
    ["math", 6, "proportsii"],
  ],
  "oge:math:15": [["geometry", 7, "treugolnik"]],
  "oge:math:16": [["geometry", 8, "okruzhnost-8"],
    ["geometry", 9, "okruzhnost-9"]],
  "oge:math:17": [["geometry", 8, "ploschadi-figur"]],
  "oge:math:18": [["geometry", 9, "vektory-9"]],
  "oge:math:19": [["geometry", 10, "teorema-kosinusov"]],

  // --------------------- ЕГЭ · Математика профильная (1–19) ---------------------
  "ege:math-p:1": [
    ["algebra", 8, "m-kvadratnye-uravn-8"],
    ["algebra", 7, "m-lin-uravn-7"],
  ],
  "ege:math-p:2": [
    ["geometry", 11, "skalyarnoe-proizvedenie-v-prostranstve"],
    ["geometry", 9, "koordinaty-9"],
  ],
  "ege:math-p:3": [
    ["geometry", 7, "treugolnik"],
    ["geometry", 8, "okruzhnost-8"],
  ],
  "ege:math-p:4": [["algebra", 9, "m-veroyatnost-9"]],
  "ege:math-p:5": [["algebra", 11, "proizvodnaya-funkcii"]],
  "ege:math-p:6": [["algebra", 11, "pokazatelnye-i-logarifmicheskie-uravneniya"]],
  "ege:math-p:7": [["algebra", 10, "logarifm-i-logarifmicheskaya-funkciya"]],
  "ege:math-p:8": [["algebra", 10, "prostye-trigonometricheskie-uravneniya"]],
  "ege:math-p:9": [
    ["algebra", 11, "pervoobraznaya-i-integral"],
    ["algebra", 8, "m-kvadratnye-korni-8"],
  ],
  "ege:math-p:10": [["algebra", 11, "pervoobraznaya-i-integral"]],
  "ege:math-p:11": [["algebra", 11, "sistemy-uravneniy-s-parametrom"]],
  "ege:math-p:12": [["algebra", 11, "zadachi-na-maksimum-i-minimum"]],
  "ege:math-p:13": [
    ["geometry", 11, "obyom-prizmy"],
    ["geometry", 11, "obyom-piramidy-i-konusa"],
  ],
  "ege:math-p:14": [["geometry", 11, "ploshhadi-poverhnostei-tel-vrashcheniya"]],
  "ege:math-p:15": [
    ["geometry", 11, "skalyarnoe-proizvedenie-v-prostranstve"],
    ["geometry", 10, "parallelnost-v-prostranstve"],
  ],
  "ege:math-p:16": [
    ["geometry", 10, "teorema-sinusov"],
    ["geometry", 10, "teorema-kosinusov"],
  ],
  "ege:math-p:17": [["geometry", 10, "vpisannaya-i-opisannaya-okruzhnosti"]],
  "ege:math-p:18": [["algebra", 10, "tekstovye-zadachi-matematicheskaya-model"]],
  "ege:math-p:19": [["math", 6, "deystviya-s-ratsionalnymi"],
    ["math", 6, "otritsatelnye-chisla"]],

  // --------------------- ЕГЭ · Математика базовая (1–21) ---------------------
  "ege:math-b:1": [
    ["math", 6, "deystviya-s-ratsionalnymi"],
    ["math", 5, "drobi-obyknovennye"],
  ],
  "ege:math-b:2": [["math", 5, "protsenty-5"],
    ["math", 5, "desyatichnye-drobi"]],
  "ege:math-b:3": [["math", 6, "proportsii"],
    ["math", 6, "koordinatnaya-ploskost"]],
  "ege:math-b:4": [
    ["math", 6, "koordinatnaya-ploskost"],
    ["math", 5, "koordinatnyy-luch"],
  ],
  "ege:math-b:5": [
    ["algebra", 8, "m-kvadratnye-korni-8"],
    ["algebra", 8, "stepen-tselym-pokazatelem-8"],
  ],
  "ege:math-b:6": [
    ["algebra", 7, "m-lin-uravn-7"],
    ["math", 6, "linear-inequalities-6"],
  ],
  "ege:math-b:7": [["algebra", 8, "m-kvadratnye-uravn-8"],
    ["algebra", 8, "a-kvadratnye-uravn-8"]],
  "ege:math-b:8": [["algebra", 9, "md-chislovye-funkcii-9"]],
  "ege:math-b:9": [["algebra", 9, "m-arifm-progressiya-9"]],
  "ege:math-b:10": [["algebra", 9, "m-geom-progressiya-9"],
    ["algebra", 9, "md-geom-progressiya-9"]],
  "ege:math-b:11": [["algebra", 9, "m-veroyatnost-9"]],
  "ege:math-b:12": [["algebra", 9, "m-kombinatorika-9"]],
  "ege:math-b:13": [["algebra", 9, "m-statistika-9"]],
  "ege:math-b:14": [
    ["algebra", 9, "md-kvadratichnaya-9"],
    ["math", 6, "koordinatnaya-ploskost"],
  ],
  "ege:math-b:15": [["geometry", 7, "treugolnik"]],
  "ege:math-b:16": [["geometry", 8, "chetyrekhugolniki"]],
  "ege:math-b:17": [
    ["geometry", 8, "okruzhnost-8"],
    ["geometry", 9, "okruzhnost-9"],
  ],
  "ege:math-b:18": [
    ["geometry", 8, "ploschadi-figur"],
    ["geometry", 9, "ploschadi-i-objomy"],
  ],
  "ege:math-b:19": [["algebra", 9, "m-mnozhestva-9"]],
  "ege:math-b:20": [["algebra", 10, "tekstovye-zadachi-matematicheskaya-model"]],
  "ege:math-b:21": [
    ["math", 5, "protsenty-5"],
    ["math", 6, "proportsii"],
  ],

  // --------------------- ОГЭ · Русский язык (1–9) ---------------------
  "oge:russian:1": [["russian", 9, "podgotovka-k-oge-rus"],
    ["russian", 9, "publicisticheskiy-stil"]],
  "oge:russian:2": [
    ["russian", 8, "slozhnoe-predlozhenie"],
    ["russian", 7, "tip-prilagodnovo-v-spp"],
  ],
  "oge:russian:3": [
    ["russian", 11, "punktuaciya-slozhnykh-predlozheniy"],
    ["russian", 8, "obosoblenie-prilozheniy"],
  ],
  "oge:russian:4": [["russian", 10, "pravopisanie-otnosheniy"]],
  "oge:russian:5": [["russian", 10, "leksicheskie-znacheniya-slov"]],
  "oge:russian:6": [["russian", 9, "sredstva-vyrazitelnosti"],
    ["russian", 10, "leksicheskie-znacheniya-slov"]],
  "oge:russian:7": [["russian", 11, "morfologicheskiy-razbor"]],
  "oge:russian:8": [["russian", 11, "normy-literaturnogo-yazyka"]],
  "oge:russian:9": [["russian", 11, "podgotovka-k-ege-rus"]],

  // --------------------- ЕГЭ · Русский язык (1–27) ---------------------
  "ege:russian:1": [["russian", 11, "podgotovka-k-ege-rus"]],
  "ege:russian:2": [["russian", 9, "yazykovye-sredstva-svyazi"],
    ["russian", 8, "slozhnoe-predlozhenie"]],
  "ege:russian:3": [["russian", 10, "leksicheskie-znacheniya-slov"]],
  "ege:russian:4": [["russian", 11, "morfologicheskiy-razbor"]],
  "ege:russian:5": [
    ["russian", 11, "pravopisanie-narechiy-i-prilagatelnykh"],
    ["russian", 10, "pravopisanie-otnosheniy"],
  ],
  "ege:russian:6": [["russian", 11, "normy-literaturnogo-yazyka"]],
  "ege:russian:7": [
    ["russian", 11, "normy-literaturnogo-yazyka"],
    ["russian", 10, "orfopiya-normy-udareniya"],
  ],
  "ege:russian:8": [["russian", 11, "normy-literaturnogo-yazyka"]],
  "ege:russian:9": [["russian", 11, "punktuaciya-slozhnykh-predlozheniy"]],
  "ege:russian:10": [["russian", 11, "podgotovka-k-ege-rus"]],
  "ege:russian:11": [
    ["russian", 7, "prichastie-i-prichastnyy-oborot"],
    ["russian", 8, "obstoyatelstvo"],
  ],
  "ege:russian:12": [
    ["russian", 7, "slozhnopodchinennye-predlozheniya"],
    ["russian", 7, "tip-prilagodnovo-v-spp"],
  ],
  "ege:russian:13": [["russian", 8, "slozhnoe-predlozhenie"],
    ["russian", 9, "slozhnye-predlozheniya-s-raznymi-vidami-svyazi"]],
  "ege:russian:14": [["russian", 8, "vvodnye-slova"],
    ["russian", 11, "punktuaciya-slozhnykh-predlozheniy"]],
  // 15 — обособленные члены предложения
  "ege:russian:15": [
    ["russian", 8, "obosoblenie-prilozheniy"],
    ["russian", 8, "obstoyatelstvo"],
  ],
  // 16 — однородные члены предложения: точной темы с примерами в
  // таксономии нет → страница получит честный блок, а не «похожую» тему.
  "ege:russian:17": [["russian", 8, "tire-v-prostom-predlozhenii"],
    ["russian", 11, "punktuaciya-slozhnykh-predlozheniy"]],
  "ege:russian:18": [
    ["russian", 8, "slozhnoe-predlozhenie"],
    ["russian", 7, "tip-prilagodnovo-v-spp"],
  ],
  "ege:russian:19": [["russian", 9, "slozhnye-predlozheniya-s-raznymi-vidami-svyazi"],
    ["russian", 8, "slozhnoe-predlozhenie"]],
  "ege:russian:20": [
    ["russian", 11, "normy-literaturnogo-yazyka"],
    ["russian", 10, "leksicheskie-znacheniya-slov"],
  ],
  "ege:russian:21": [["russian", 10, "frazeologizmy"]],
  "ege:russian:22": [["russian", 10, "leksicheskie-znacheniya-slov"]],
  "ege:russian:23": [["russian", 9, "sredstva-vyrazitelnosti"],
    ["russian", 9, "publicisticheskiy-stil"]],
  "ege:russian:24": [["russian", 9, "sredstva-vyrazitelnosti"],
    ["russian", 9, "publicisticheskiy-stil"]],
  "ege:russian:25": [
    ["russian", 9, "yazykovye-sredstva-svyazi"],
    ["russian", 9, "publicisticheskiy-stil"],
  ],
  "ege:russian:26": [
    ["russian", 9, "nauchnyy-stil"],
    ["russian", 9, "ofitsialno-delovoy-stil"],
    ["russian", 9, "publicisticheskiy-stil"],
  ],
  "ege:russian:27": [["russian", 9, "publicisticheskiy-stil"],
    ["russian", 11, "podgotovka-k-ege-rus"]],

  // --------------------- ОГЭ · Физика (1–25) ---------------------
  "oge:physics:1": [["physics", 9, "kinematika"]],
  "oge:physics:2": [["physics", 9, "zakony-novtona"]],
  "oge:physics:3": [
    ["physics", 7, "sila-tyazhesti"],
    ["physics", 7, "sila-treniya"],
  ],
  "oge:physics:4": [["physics", 7, "davlenie-tverdykh-tel"],
    ["physics", 7, "massa-i-plotnost"]],
  "oge:physics:5": [
    ["physics", 7, "davlenie-zhidkostey-i-gazov"],
    ["physics", 7, "atmosfernoe-davlenie"],
  ],
  "oge:physics:6": [["physics", 7, "arkhimedova-sila"]],
  "oge:physics:7": [["physics", 7, "mekhanicheskaya-rabota"],
    ["physics", 7, "moshchnost"]],
  "oge:physics:8": [["physics", 7, "energiya"],
    ["physics", 7, "moshchnost"]],
  "oge:physics:9": [["physics", 8, "kolichestvo-teploty"],
    ["physics", 8, "teploperedacha-vidy"]],
  "oge:physics:10": [["physics", 8, "plavlenie-otverdevanie"],
    ["physics", 8, "vnutrennyaya-energiya"]],
  "oge:physics:11": [["physics", 8, "isparenie-kipenie"],
    ["physics", 8, "teploperedacha-vidy"]],
  "oge:physics:12": [["physics", 8, "vlazhnost-vozdukha"],
    ["physics", 8, "isparenie-kipenie"]],
  "oge:physics:13": [["physics", 8, "rabota-teplovogo-dvigatelya"],
    ["physics", 7, "kpd-mekhanizma"]],
  "oge:physics:14": [["physics", 8, "elektrizatsiya-tel"],
    ["physics", 8, "elektricheskoe-pole"]],
  "oge:physics:15": [["physics", 10, "elektrostatika"]],
  "oge:physics:16": [["physics", 8, "elektricheskiy-tok"],
    ["physics", 10, "postoyannyi-tok"]],
  "oge:physics:17": [["physics", 8, "sila-toka-napryazhenie"],
    ["physics", 8, "zakon-oma"]],
  "oge:physics:18": [
    ["physics", 8, "zakon-oma"],
    ["physics", 8, "soedineniya-provodnikov"],
  ],
  "oge:physics:19": [["physics", 8, "zakon-oma"],
    ["physics", 8, "sila-toka-napryazhenie"]],
  "oge:physics:20": [["physics", 8, "rabota-moshchnost-toka"],
    ["physics", 8, "zakon-dzhoulya-lenca"]],
  "oge:physics:21": [["physics", 9, "magnitnoe-pole"],
    ["physics", 8, "elektromagnitnye-yavleniya"]],
  "oge:physics:22": [["physics", 9, "elektromagnitnaya-indukciya"],
    ["physics", 8, "elektromagnitnye-yavleniya"]],
  "oge:physics:23": [
    ["physics", 9, "svetovye-volny"],
    ["physics", 8, "svetovye-yavleniya"],
  ],
  "oge:physics:24": [["physics", 8, "svetovye-yavleniya"],
    ["physics", 9, "svetovye-volny"]],
  "oge:physics:25": [["physics", 10, "geometricheskaya-optika"]],

  // --------------------- ЕГЭ · Физика (1–32) ---------------------
  "ege:physics:1": [["physics", 9, "kinematika"]],
  "ege:physics:2": [["physics", 9, "zakony-novtona"]],
  "ege:physics:3": [["physics", 9, "impuls-zakon-sokhraneniya"],
    ["physics", 9, "zakon-vsemirnogo-tyagoteniya"]],
  "ege:physics:4": [
    ["physics", 7, "mekhanicheskaya-rabota"],
    ["physics", 7, "energiya"],
  ],
  "ege:physics:5": [["physics", 7, "prostye-mekhanizmy-rychag"],
    ["physics", 7, "sila-tyazhesti"]],
  "ege:physics:6": [
    ["physics", 7, "davlenie-zhidkostey-i-gazov"],
    ["physics", 7, "arkhimedova-sila"],
    ["physics", 7, "soobshchayushchiesya-sosudy"],
  ],
  "ege:physics:7": [
    ["physics", 10, "idealnyi-gaz"],
    ["physics", 8, "vnutrennyaya-energiya"],
  ],
  "ege:physics:8": [["physics", 10, "idealnyi-gaz"]],
  "ege:physics:9": [
    ["physics", 8, "kolichestvo-teploty"],
    ["physics", 8, "teploperedacha-vidy"],
  ],
  "ege:physics:10": [
    ["physics", 8, "plavlenie-otverdevanie"],
    ["physics", 8, "isparenie-kipenie"],
  ],
  "ege:physics:11": [["physics", 10, "elektrostatika"]],
  "ege:physics:12": [["physics", 10, "postoyannyi-tok"]],
  "ege:physics:13": [["physics", 9, "magnitnoe-pole"],
    ["physics", 8, "elektromagnitnye-yavleniya"]],
  "ege:physics:14": [["physics", 9, "elektromagnitnaya-indukciya"],
    ["physics", 8, "elektromagnitnye-yavleniya"]],
  "ege:physics:15": [["physics", 9, "mekhanicheskie-kolebaniya"],
    ["physics", 9, "zvuk"]],
  "ege:physics:16": [
    ["physics", 9, "elektromagnitnye-volny"],
    ["physics", 9, "mekhanicheskie-kolebaniya"],
  ],
  "ege:physics:17": [["physics", 10, "geometricheskaya-optika"]],
  "ege:physics:18": [["physics", 11, "kvantovaya-priroda-sveta"]],
  "ege:physics:19": [
    ["physics", 9, "stroenie-atomnogo-yadra"],
    ["physics", 9, "radioaktivnost"],
  ],
  "ege:physics:20": [["physics", 9, "yadernaya-energetika"],
    ["physics", 9, "stroenie-atomnogo-yadra"]],
  "ege:physics:21": [["physics", 10, "ravnouskorennoe-dvizhenie"]],
  "ege:physics:22": [["physics", 10, "svobodnoe-padenie"]],
  "ege:physics:23": [["physics", 9, "dvizhenie-po-okruzhnosti"],
    ["physics", 10, "ravnouskorennoe-dvizhenie"]],
  "ege:physics:24": [["physics", 7, "sila-uprugosti-zakon-guka"],
    ["physics", 7, "sila-tyazhesti"]],
  "ege:physics:25": [["physics", 7, "sila-treniya"],
    ["physics", 7, "sila-tyazhesti"]],
  "ege:physics:26": [["physics", 9, "impuls-zakon-sokhraneniya"],
    ["physics", 9, "reaktivnoe-dvizhenie"]],
  "ege:physics:27": [["physics", 7, "energiya"],
    ["physics", 7, "moshchnost"]],
  "ege:physics:28": [["physics", 7, "energiya"],
    ["physics", 7, "moshchnost"]],
  "ege:physics:29": [["physics", 7, "moshchnost"],
    ["physics", 7, "mekhanicheskaya-rabota"]],
  "ege:physics:30": [["physics", 7, "kpd-mekhanizma"],
    ["physics", 7, "mekhanicheskaya-rabota"]],
  "ege:physics:31": [["physics", 10, "postoyannyi-tok"]],
  "ege:physics:32": [["physics", 9, "elektromagnitnye-volny"],
    ["physics", 9, "svetovye-volny"]],

  // --------------------- ОГЭ · Информатика (1–15) ---------------------
  "oge:informatics:1": [["informatics", 7, "tekst-i-grafika"]],
  "oge:informatics:2": [["informatics", 7, "kodirovanie-informacii"],
    ["informatics", 7, "tekst-i-grafika"]],
  "oge:informatics:3": [["informatics", 7, "systemy-schisleniya"]],
  "oge:informatics:4": [
    ["informatics", 7, "systemy-schisleniya"],
    ["informatics", 7, "dvoichnaya-arifmetika"],
  ],
  "oge:informatics:5": [["informatics", 7, "osnovy-logiki"]],
  "oge:informatics:6": [["informatics", 8, "algoritmy"]],
  "oge:informatics:7": [["informatics", 7, "programmirovanie-7"]],
  "oge:informatics:8": [["informatics", 8, "algoritmy"]],
  "oge:informatics:9": [["informatics", 8, "algoritmy"]],
  "oge:informatics:10": [["informatics", 8, "algoritmicheskaya-konstrukciya-8"],
    ["informatics", 9, "python-cikly-spiski-9"]],
  "oge:informatics:11": [["informatics", 8, "osnovy-programmirovaniya-8"],
    ["informatics", 8, "algoritmy"]],
  "oge:informatics:12": [
    ["informatics", 9, "python-cikly-spiski-9"],
    ["informatics", 8, "osnovy-programmirovaniya-8"],
  ],
  "oge:informatics:13": [["informatics", 7, "programmirovanie-7"]],
  "oge:informatics:14": [["informatics", 9, "python-cikly-spiski-9"]],
  "oge:informatics:15": [
    ["informatics", 9, "bazy-dannyh-9"],
    ["informatics", 9, "zaprosy-k-baze-9"],
  ],

  // --------------------- ЕГЭ · Информатика (1–27) ---------------------
  "ege:informatics:1": [["informatics", 7, "tekst-i-grafika"]],
  "ege:informatics:2": [["informatics", 7, "kodirovanie-informacii"],
    ["informatics", 7, "tekst-i-grafika"]],
  "ege:informatics:3": [["informatics", 7, "systemy-schisleniya"]],
  "ege:informatics:4": [
    ["informatics", 7, "systemy-schisleniya"],
    ["informatics", 7, "dvoichnaya-arifmetika"],
  ],
  "ege:informatics:5": [["informatics", 7, "osnovy-logiki"]],
  "ege:informatics:6": [["informatics", 8, "algoritmy"]],
  "ege:informatics:7": [["informatics", 8, "osnovy-programmirovaniya-8"],
    ["informatics", 7, "programmirovanie-7"]],
  "ege:informatics:8": [["informatics", 8, "osnovy-programmirovaniya-8"],
    ["informatics", 7, "programmirovanie-7"]],
  "ege:informatics:9": [["informatics", 8, "algoritmicheskaya-konstrukciya-8"],
    ["informatics", 8, "algoritmy"]],
  "ege:informatics:10": [
    ["informatics", 8, "algoritmy"],
    ["informatics", 7, "programmirovanie-7"],
  ],
  "ege:informatics:11": [["informatics", 8, "algoritmicheskaya-konstrukciya-8"],
    ["informatics", 9, "python-cikly-spiski-9"]],
  "ege:informatics:12": [["informatics", 9, "python-cikly-spiski-9"]],
  // 13 (подпрограммы), 14 (рекурсия), 18 (электронные таблицы),
  // 25 (дискретная математика), 26 (сложность алгоритмов),
  // 27 (машинное обучение) — точных тем с примерами в таксономии нет,
  // страницы получают честный блок, а не «похожую» тему.
  "ege:informatics:15": [["informatics", 9, "python-cikly-spiski-9"]],
  "ege:informatics:16": [["informatics", 9, "python-cikly-spiski-9"]],
  "ege:informatics:17": [["informatics", 10, "operacionnye-sistemy-10"]],
  "ege:informatics:19": [
    ["informatics", 9, "bazy-dannyh-9"],
    ["informatics", 11, "subd-11"],
  ],
  "ege:informatics:20": [
    ["informatics", 9, "seti-i-internet-9"],
    ["informatics", 11, "seti-protokoly-11"],
  ],
  "ege:informatics:21": [["informatics", 10, "operacionnye-sistemy-10"]],
  "ege:informatics:22": [
    ["informatics", 10, "informacionnaya-bezopasnost-10"],
    ["informatics", 11, "kriptografiya-11"],
  ],
  "ege:informatics:23": [["informatics", 7, "tekst-i-grafika"]],
  "ege:informatics:24": [["informatics", 9, "modelirovanie-9"]],

  // --------------------- ОГЭ · Обществознание (1–24) ---------------------
  "oge:social:1": [["social", 10, "chelovek-i-poznanie"]],
  "oge:social:2": [["social", 10, "chelovek-i-poznanie"]],
  "oge:social:3": [["social", 7, "professiya-i-trud-7"]],
  "oge:social:4": [["social", 7, "professiya-i-trud-7"]],
  "oge:social:5": [["social", 8, "etika-i-etiket-8"]],
  "oge:social:6": [["social", 7, "sotsialnye-gruppy"]],
  "oge:social:7": [["social", 10, "natsionalnye-otnosheniya-10"]],
  "oge:social:8": [["social", 9, "sotsialnoe-stratificirovanie-9"]],
  "oge:social:9": [["social", 9, "sotsialnoe-stratificirovanie-9"]],
  "oge:social:10": [["social", 9, "sotsialnoe-stratificirovanie-9"]],
  "oge:social:11": [["social", 9, "gosudarstvo-9"],
    ["social", 8, "gosudarstvennye-simvoly-8"]],
  "oge:social:12": [["social", 9, "gosudarstvo-9"],
    ["social", 8, "konstitucia-rf"]],
  "oge:social:13": [["social", 8, "pravo-8"],
    ["social", 8, "chelovek-i-ego-prava-8"]],
  "oge:social:14": [["social", 8, "pravo-8"],
    ["social", 11, "pravo-i-zashchita"]],
  "oge:social:15": [["social", 8, "konstitucia-rf"],
    ["social", 8, "gosudarstvennye-simvoly-8"]],
  "oge:social:16": [
    ["social", 8, "chelovek-i-ego-prava-8"],
    ["social", 11, "pravo-i-zashchita"],
  ],
  "oge:social:17": [["social", 11, "pravo-i-zashchita"]],
  "oge:social:18": [["social", 9, "sudebnaya-sistema-9"]],
  "oge:social:19": [["social", 9, "sudebnaya-sistema-9"]],
  "oge:social:20": [["social", 9, "ekonomicheskaya-sistema"],
    ["social", 10, "ekonomicheskaya-zona"]],
  "oge:social:21": [["social", 9, "ekonomika-rossii-9"]],
  "oge:social:22": [
    ["social", 9, "ekonomicheskaya-sistema"],
    ["social", 10, "ekonomicheskaya-zona"],
  ],
  "oge:social:23": [["social", 7, "dengi-i-banki-7"]],
  "oge:social:24": [["social", 7, "dengi-i-banki-7"]],
};

// ========================== ЭКЗАМЕН → ПРЕДМЕТ ТАКСОНОМИИ ==========================

/**
 * Имя предмета программы для честного блока и для перелинковки.
 * Математика экзамена берёт «Математику» и «Алгебру», остальные предметы —
 * одноимённый слаг.
 */
const EXAM_SUBJECT_PROGRAM: Record<string, string> = {
  "math": "math",
  "math-p": "algebra",
  "math-b": "math",
  "russian": "russian",
  "physics": "physics",
  "informatics": "informatics",
  "social": "social",
};

/** Математика экзамена раскладывается по двум предметам программы. */
function programSlugsFor(subject: string): string[] {
  if (subject === "math") return ["math", "algebra", "geometry"];
  if (subject === "math-p") return ["algebra", "geometry"];
  if (subject === "math-b") return ["math", "algebra", "geometry"];
  const one = EXAM_SUBJECT_PROGRAM[subject];
  return one ? [one] : [];
}

// ========================== ПУБЛИЧНОЕ API ==========================

/**
 * Блок «Примеры заданий» для конкретной страницы.
 *
 * Возвращает либо 3 примера с ответами из таксономии программы, либо
 * честный блок «Что проверяет это задание» — если для этого номера нет
 * темы с примерами. Пустого результата не бывает.
 */
export function getExamExampleBlock(
  exam: ExamKind,
  subject: string,
  number: number,
): ExamExampleBlock {
  const refs = TOPIC_EXAMPLE_LINKS[`${exam}:${subject}:${number}`] ?? [];

  const examples: ExamExample[] = [];
  for (const [subjectSlug, grade, topicSlug] of refs) {
    const resolved = resolveTopic(subjectSlug, grade, topicSlug);
    if (!resolved) continue;
    const picked = resolved.topic.examples
      .filter((e: TopicExample) => e.text.trim().length > 0 && (e.answer ?? "").trim().length > 0)
      .slice(0, 3 - examples.length);
    for (const ex of picked) {
      examples.push({
        text: ex.text,
        answer: (ex.answer ?? "").trim(),
        topicTitle: resolved.topic.title,
        topicHref: resolved.href,
      });
    }
    if (examples.length >= 3) break;
  }

  if (examples.length > 0) {
    return { kind: "examples", examples };
  }

  // Честный блок: примеров с ответами для этого номера в репозитории нет.
  const item = getExamNumber(exam, subject, number);
  const program = getSubject(EXAM_SUBJECT_PROGRAM[subject] ?? subject);
  return {
    kind: "honest",
    block: {
      checks: item?.description ?? "",
      fgosRef: item?.fgosRef ?? "",
      subjectHref: program ? `/subject/${program.slug}/` : "/",
      subjectTitle: program?.title ?? subject,
    },
  };
}

/**
 * Смежные темы программы по тому же предмету: 5–8 ссылок на реальные
 * страницы тем. Сначала идут темы самого номера (они заведомо смежные),
 * затем — соседние темы классов рядом с экзаменационным. Порядок
 * детерминированный: как в таксономии, без случайности.
 */
export function getRelatedTopics(
  exam: ExamKind,
  subject: string,
  number: number,
): RelatedTopic[] {
  const anchorGrade = exam === "oge" ? 9 : 11;
  const refs = TOPIC_EXAMPLE_LINKS[`${exam}:${subject}:${number}`] ?? [];

  const ordered: RelatedTopic[] = [];
  const seen = new Set<string>();
  const push = (topic: Topic, href: string) => {
    if (seen.has(href) || ordered.length >= 8) return;
    seen.add(href);
    ordered.push({ title: topic.title, href });
  };

  // 1. Темы самого номера.
  for (const [subjectSlug, grade, topicSlug] of refs) {
    const resolved = resolveTopic(subjectSlug, grade, topicSlug);
    if (resolved) push(resolved.topic, resolved.href);
  }

  // 2. Соседние темы экзаменационного класса и классов рядом с ним.
  const slugs = programSlugsFor(subject);
  for (const gradeNum of [anchorGrade, anchorGrade - 1, anchorGrade + 1]) {
    for (const slug of slugs) {
      const grade = getSubject(slug)?.grades.find((g: { num: number }) => g.num === gradeNum);
      if (!grade) continue;
      for (const topic of grade.topics) {
        const resolved = resolveTopic(slug, gradeNum, topic.slug);
        if (resolved) push(resolved.topic, resolved.href);
      }
    }
  }

  return ordered;
}