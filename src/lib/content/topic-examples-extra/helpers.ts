/**
 * Дополнения примерами — общий вид ключа и сборка карты.
 * Сами дополнения лежат в файлах `extra-<slug>.ts` и собираются в index.ts.
 */

import type { ExtraExamplesMap } from "./types";

export type { ExtraExamplesMap };

/**
 * Собирает карты дополнений из нескольких файлов и падает при пересечении
 * ключей: два предмета дописывают примеры к одной теме — почти всегда
 * опечатка в slug, и без этой проверки один из файлов молча перекроет другой.
 *
 * Дубли заданий внутри одной темы отсекаются при склейке в `withExtensions`
 * (`subjects.ts`) — здесь только проверка ключей.
 */
export function mergeExtras(
  ...parts: Array<[file: string, map: ExtraExamplesMap]>
): ExtraExamplesMap {
  const out: ExtraExamplesMap = {};
  const origin: Record<string, string> = {};
  for (const [file, map] of parts) {
    for (const key of Object.keys(map)) {
      if (key in out) {
        throw new Error(
          `[topic-examples-extra] ключ "${key}" объявлен и в ${origin[key]}, и в ${file}`,
        );
      }
      out[key] = map[key];
      origin[key] = file;
    }
  }
  return out;
}
