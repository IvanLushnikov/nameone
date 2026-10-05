/**
 * Поиск артефакта по `?id` для страницы превью (ТЗ-21, блок 2).
 *
 * БЫЛО: `src/app/preview/page.tsx` искал артефакт только в избранном
 * (`getFavorites()`), а карточка истории ведёт именно сюда. Учитель кликал
 * «Открыть» и получал «Лист не найден». Это была самая заметная мёртвая
 * кнопка кабинета.
 *
 * СТАЛО — четыре шага по убыванию бесплатности:
 *   1. серверный `GET /api/worksheets/:id` — если есть сессия (единственный
 *      источник, который переживает чужое устройство);
 *   2. история на устройстве, включая поле `artifact` у последних записей;
 *   3. избранное на устройстве;
 *   4. понятный экран «Лист не найден» с CTA, а не тишина.
 *
 * Проверка сессии — до запроса: у анонимного учителя шаг 1 не выполняется
 * вообще, поэтому ни мигания «Загрузка», ни 401 в консоли.
 *
 * Функция не бросает наружу: любой сбой сети или разбора ответа превращается
 * в `null` — вызывающий покажет «Лист не найден» с кнопкой «Попробовать ещё
 * раз», а не белый экран.
 */

import { fetchArtifact } from "./materials-api";
import {
  getFavorites,
  getHistory,
  getProfile,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import { countOfArtifact } from "./materials-source";

/** Откуда нашли артефакт — для аналитики `dashboard_artifact_opened`. */
export type ArtifactOrigin = "server" | "history" | "favorites";

export interface FoundArtifact {
  artifact: FavoriteArtifact;
  origin: ArtifactOrigin;
}

export async function findArtifact(id: string): Promise<FoundArtifact | null> {
  if (!id) return null;

  // 1. Сервер — только при наличии сессии (профиль пишет /auth/callback).
  if (getProfile() !== null) {
    const res = await fetchArtifact(id);
    if (res.ok) {
      const artifact = toFavoriteArtifact(res.data);
      if (artifact) return { artifact, origin: "server" };
    }
    // 404 здесь — не приговор: лист мог остаться только на устройстве
    // (например, учитель зашёл на другом устройстве без интернета).
  }

  // 2. История устройства. Поле `artifact` есть у последних записей
  //    (ARTIFACT_KEEP в utils/storage.ts), у остальных — только метаданные.
  const fromHistory = getHistory().find((item) => item.id === id)?.artifact;
  if (fromHistory) {
    const artifact = toFavoriteArtifact(
      fromHistory as unknown as Record<string, unknown>
    );
    if (artifact) return { artifact, origin: "history" };
  }

  // 3. Избранное устройства.
  const fromFavorites = getFavorites().find((a) => a.id === id);
  if (fromFavorites) {
    return { artifact: fromFavorites, origin: "favorites" };
  }

  return null;
}

/**
 * Приводит ответ сервера (`payload_json` листа) к артефакту превью.
 *
 * Сервер кладёт в payload весь объект, который прислал конструктор, поэтому
 * у листа есть `tasks`, у плана урока — `stages`, у презентации — `slides`,
 * у КТП — `weeks`. Ответ без `id` или без единицы содержания — мусор, такой
 * показывать нечего: возвращаем null и уходим к следующему шагу поиска.
 */
function toFavoriteArtifact(
  raw: Record<string, unknown>,
): FavoriteArtifact | null {
  const a = raw as Record<string, unknown> & { id?: unknown };
  if (typeof a.id !== "string" || !a.id) return null;
  if (countOfArtifact(a) === null) return null;
  if (typeof a.title !== "string" || !a.title) return null;
  return a as unknown as FavoriteArtifact;
}
