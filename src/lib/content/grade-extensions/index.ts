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

import type { SubjectSlug } from "../../types";
import type { GradeExtensions } from "./types";

import { algebraExtra } from "./algebra";
import { artExtra } from "./art";
import { biologyExtra } from "./biology";
import { chemistryExtra } from "./chemistry";
import { englishExtra } from "./english";
import { financeExtra } from "./finance";
import { fgosProgramExtra } from "./fgos-program";
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

/**
 * Темы из федеральных рабочих программ дописываются после тем, которые уже
 * заведены руками. Порядок важен: если у темы из программы случится тот же
 * slug, что у ручной, `withExtensions` оставит ручную — и это правильно:
 * написанную учителем тему нельзя вытеснить сгенерированной.
 */
const merge = (
  manual: GradeExtensions[SubjectSlug],
  fromProgram: GradeExtensions[SubjectSlug],
): GradeExtensions[SubjectSlug] => {
  if (!manual) return fromProgram ?? [];
  if (!fromProgram || fromProgram.length === 0) return manual;
  return [...manual, ...fromProgram];
};

export const GRADE_EXTENSIONS: GradeExtensions = {
  algebra: merge(algebraExtra, fgosProgramExtra.algebra),
  art: merge(artExtra, fgosProgramExtra.art),
  biology: merge(biologyExtra, fgosProgramExtra.biology),
  chemistry: merge(chemistryExtra, fgosProgramExtra.chemistry),
  english: merge(englishExtra, fgosProgramExtra.english),
  finance: merge(financeExtra, fgosProgramExtra.finance),
  geography: merge(geographyExtra, fgosProgramExtra.geography),
  geometry: merge(geometryExtra, fgosProgramExtra.geometry),
  german: merge(germanExtra, fgosProgramExtra.german),
  history: merge(historyExtra, fgosProgramExtra.history),
  informatics: merge(informaticsExtra, fgosProgramExtra.informatics),
  literature: merge(literatureExtra, fgosProgramExtra.literature),
  // Математики в ручных расширениях нет — темы приходят только из программы.
  math: fgosProgramExtra.math ?? [],
  music: merge(musicExtra, fgosProgramExtra.music),
  obzh: merge(obzhExtra, fgosProgramExtra.obzh),
  okruzhaet: merge(okruzhaetExtra, fgosProgramExtra.okruzhaet),
  pe: merge(peExtra, fgosProgramExtra.pe),
  physics: merge(physicsExtra, fgosProgramExtra.physics),
  russian: merge(russianExtra, fgosProgramExtra.russian),
  social: merge(socialExtra, fgosProgramExtra.social),
  technology: merge(technologyExtra, fgosProgramExtra.technology),
};
