/**
 * Агрегатор расширений таксономии.
 *
 * Каждый файл предмета экспортирует `<subject>Extra: Grade[]`: новые классы
 * и/или дополнительные темы для уже существующих классов. Здесь они
 * собираются в одну карту, которую `subjects.ts` подмешивает к базовым
 * массивам (см. `withExtensions`).
 *
 * Чтобы добавить предмет:
 *  1. создать `src/lib/content/grade-extensions/<slug>.ts`
 *  2. добавить импорт и строку в `GRADE_EXTENSIONS` ниже
 *  3. прогнать `npx tsx scripts/check-taxonomy.ts`
 *
 * ВАЖНО: импорт тут не опционален. Файл, который создали, но не записали
 * сюда, молча не попадёт в сборку — предмет останется с дырами. За это
 * отвечает тест «все файлы расширений подключены» в
 * tests/taxonomy-completeness.test.ts.
 *
 * Инварианты (типы, уникальность slug, покрытие классов, ссылочная
 * целостность «Темы недели») проверяет тот же тест.
 */

import type { GradeExtensions } from "./types";

import { algebraExtra } from "./algebra";
import { artExtra } from "./art";
import { biologyExtra } from "./biology";
import { chemistryExtra } from "./chemistry";
import { englishExtra } from "./english";
import { financeExtra } from "./finance";
import { historyExtra } from "./history";
import { geographyExtra } from "./geography";
import { geometryExtra } from "./geometry";
import { germanExtra } from "./german";
import { informaticsExtra } from "./informatics";
import { literatureExtra } from "./literature";
import { musicExtra } from "./music";
import { obzhExtra } from "./obzh";
import { okruzhaetExtra } from "./okruzhaet";
import { peExtra } from "./pe";
import { physicsExtra } from "./physics";
import { russianExtra } from "./russian";
import { socialExtra } from "./social";
import { technologyExtra } from "./technology";

export type { GradeExtensions };

export const GRADE_EXTENSIONS: GradeExtensions = {
  algebra: algebraExtra,
  art: artExtra,
  biology: biologyExtra,
  chemistry: chemistryExtra,
  english: englishExtra,
  finance: financeExtra,
  geography: geographyExtra,
  geometry: geometryExtra,
  german: germanExtra,
  history: historyExtra,
  informatics: informaticsExtra,
  literature: literatureExtra,
  music: musicExtra,
  obzh: obzhExtra,
  okruzhaet: okruzhaetExtra,
  pe: peExtra,
  physics: physicsExtra,
  russian: russianExtra,
  social: socialExtra,
  technology: technologyExtra,
};
