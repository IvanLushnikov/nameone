/**
 * Дополнения примерами заданий.
 *
 * Слой нужен для тем, у которых изначально был один пример: блок
 * «Примеры заданий» на странице темы — первое, на что смотрит учитель,
 * и с одним примером он выглядит пустым.
 *
 * Ключ карты — `предмет/класс/slug`, значение — примеры, которые
 * ДОПИСЫВАЮТСЯ к уже существующим (см. `withExtensions` в subjects.ts).
 * Существующие примеры не меняются: они могут быть в индексе поисковика.
 *
 * Чтобы добавить дополнение:
 *  1. создать `extra-<slug>.ts` с экспортом `ExtraExamplesMap`
 *  2. добавить импорт и строку в `mergeExtras(...)` ниже
 *  3. прогнать `npx tsx scripts/check-taxonomy.ts`
 *
 * Пересечение ключей между файлами — опечатка, `mergeExtras` падает.
 * Незакрытый ключ (тема с <2 примерами) ловит `check-taxonomy.ts`.
 */

import { mergeExtras, type ExtraExamplesMap } from "./helpers";

import { extraBioGeo } from "./extra-bio-geo";
import { extraHistSocial } from "./extra-hist-social";
import { extraInfChemOkr } from "./extra-inf-chem-okr";
import { extraMathLit } from "./extra-math-lit";

export type { ExtraExamplesMap };

export const EXTRA_EXAMPLES: ExtraExamplesMap = mergeExtras(
  ["extra-bio-geo.ts", extraBioGeo],
  ["extra-hist-social.ts", extraHistSocial],
  ["extra-inf-chem-okr.ts", extraInfChemOkr],
  ["extra-math-lit.ts", extraMathLit],
);
