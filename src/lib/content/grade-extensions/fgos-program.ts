/**
 * Темы, добавленные из федеральной рабочей программы.
 *
 * ЧТО ЭТО. Содержание тем берётся из федеральных рабочих программ
 * (приказы Минпросвещения № 372/370/371), собирается скриптом
 * `scripts/fgos/harvest-fgos.mjs` в `data/fgos/topics.json`. Названия тем и
 * два задания к каждой написаны по этому содержанию и лежат в
 * `data/fgos/authored/`. Скрипт `scripts/fgos/build-extension.mjs` сводит
 * вместе plan, авторские файлы и уже существующую таксономию и кладёт
 * результат в `fgos-program/data.json`.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ В `subjects.ts`. Тем тут тысячи, и они
 * генерируются из внешнего источника: правки в `subjects.ts` каждый раз
 * конфликтовали бы с любым другим изменением таксономии. Файл собирается
 * целиком и пересобирается одной командой.
 *
 * ПОЧЕМУ JSON, А НЕ TS. Данных много, а проверять их типами нечем: они
 * приходят извне и проверяются не типами, а скриптом сборки — он не даёт
 * записать тему без двух заданий или с повторяющимся slug.
 *
 * Файл `fgos-program.ts` обязан быть импортирован в `./index` — этого
 * требует тест «все файлы расширений подключены».
 */

import raw from "./fgos-program/data.json";
import type { Grade, SubjectSlug } from "../../types";
import type { GradeExtensions } from "./types";

const data = raw as Partial<Record<SubjectSlug, Grade[]>>;

/** Раскладка ключ → предмет; предметы без тем в файле не попадают. */
export const fgosProgramExtra: GradeExtensions = (() => {
  const out: GradeExtensions = {};
  for (const [slug, grades] of Object.entries(data) as Array<[SubjectSlug, Grade[]?]>) {
    if (Array.isArray(grades) && grades.length > 0) out[slug] = grades;
  }
  return out;
})();

/** Предметы, которым этот файл добавляет темы. */
export const fgosProgramSubjects = Object.keys(fgosProgramExtra) as SubjectSlug[];