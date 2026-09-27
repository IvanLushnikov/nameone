"use client";

import type { UserHistoryItem, UserTemplate, UserProfile, Worksheet, LessonPlan, Presentation, Ktp } from "@/lib/types";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";

const KEY_HISTORY = "listai.history";
const KEY_TEMPLATES = "listai.templates";
const KEY_PROFILE = "listai.profile";
const KEY_FAVORITES = "listai.favorites";

/**
 * Дискриминированный union всех артефактов, которые можно класть в избранное.
 * Q1-2027: storage исторически писал только `Worksheet`, но `saveFavorite`
 * давно принимает все 4 типа. После фикса B-3 / B-4 контракт один — этот union.
 *
 * Discriminator — уникальное поле каждого типа:
 *   - Worksheet     → `tasks: WorksheetTask[]`
 *   - LessonPlan    → `stages: LessonStage[]`
 *   - Presentation  → `slides: Slide[]`
 *   - Ktp           → `weeks: { weekNum; entries }[]`
 */
export type FavoriteArtifact = Worksheet | LessonPlan | Presentation | Ktp;

/**
 * Простое хранилище на localStorage. В production будет заменено на API.
 * Все методы безопасны для SSR (если нет window — noop).
 */

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Квота превышена — игнорируем
  }
}

// ===== История генераций =====

export function getHistory(): UserHistoryItem[] {
  return read<UserHistoryItem[]>(KEY_HISTORY, []);
}

export function addToHistory(item: UserHistoryItem) {
  const list = [item, ...getHistory().filter((x) => x.id !== item.id)].slice(0, 50);
  write(KEY_HISTORY, list);
}

export function removeFromHistory(id: string) {
  write(KEY_HISTORY, getHistory().filter((x) => x.id !== id));
}

/**
 * F-06 B-3 fix: унифицирует «избранное» между history[i].isFavorite и KEY_FAVORITES.
 *
 * - Если передан `item` (конструктор знает полный артефакт) → управляет обоими списками:
 *     - если `id` уже в KEY_FAVORITES → удаляет (toggle off);
 *     - если нет → добавляет через `saveFavorite`.
 *   Плюс всегда флипает флаг в истории (для синхронизации UI).
 *
 * - Если `item` НЕ передан (например, дашборд кликнул по сердечку на карточке
 *   истории, не имея под рукой полного артефакта) → fallback: только флаг,
 *   как раньше. Двух независимых списков больше нет в конструкторе — там всегда
 *   передаётся `item`. На дашборде click из history, если артефакт уже в
 *   favorites, можно передать его через `getFavorites().find(x => x.id === id)`.
 */
export function toggleFavorite(id: string, item?: FavoriteArtifact) {
  // 1. Флипаем флаг в истории (всегда — для UI синхронизации).
  const list = getHistory().map((x) =>
    x.id === id ? { ...x, isFavorite: !x.isFavorite } : x
  );
  write(KEY_HISTORY, list);

  // 2. Управляем KEY_FAVORITES, если есть полный артефакт.
  if (item) {
    const current = getFavorites();
    const exists = current.some((x) => x.id === id);
    if (exists) {
      write(KEY_FAVORITES, current.filter((x) => x.id !== id));
    } else {
      saveFavorite(item);
    }
  }
}

// ===== Шаблоны =====

export function getTemplates(): UserTemplate[] {
  return read<UserTemplate[]>(KEY_TEMPLATES, []);
}

export function addTemplate(t: UserTemplate) {
  write(KEY_TEMPLATES, [t, ...getTemplates()]);
}

export function removeTemplate(id: string) {
  write(KEY_TEMPLATES, getTemplates().filter((t) => t.id !== id));
}

// ===== Профиль =====

export function getProfile(): UserProfile | null {
  return read<UserProfile | null>(KEY_PROFILE, null);
}

export function setProfile(p: UserProfile) {
  write(KEY_PROFILE, p);
}

export function signOut() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_PROFILE);
  window.localStorage.removeItem(KEY_HISTORY);
  window.localStorage.removeItem(KEY_TEMPLATES);
  // Уведомляем Header (и других подписчиков в той же вкладке), что профиль
  // исчез — `storage` event выстреливает только cross-tab, поэтому без явного
  // dispatchEvent UI не обновится до перезагрузки.
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

// ===== Сохранение артефактов в избранное (отдельно от истории) =====

export function getFavorites(): FavoriteArtifact[] {
  return read<FavoriteArtifact[]>(KEY_FAVORITES, []);
}

export function saveFavorite(w: FavoriteArtifact) {
  const list = [w, ...getFavorites().filter((x) => x.id !== w.id)].slice(0, 30);
  write(KEY_FAVORITES, list);
}

export function removeFavorite(id: string) {
  write(KEY_FAVORITES, getFavorites().filter((x) => x.id !== id));
}

export function isFavorited(id: string): boolean {
  return getFavorites().some((x) => x.id === id);
}

// ===== Аналитика событий =====

const KEY_EVENTS = "listai.events";

export interface AnalyticsEvent {
  name: string;
  data?: Record<string, unknown>;
  ts: string;
}

/**
 * Локальная аналитика: пишет событие в localStorage (FIFO, до 500 записей).
 * В production будет заменено на серверный API.
 */
export function getEvents(): AnalyticsEvent[] {
  return read<AnalyticsEvent[]>(KEY_EVENTS, []);
}

export function logEvent(name: string, data?: Record<string, unknown>): void {
  const evt: AnalyticsEvent = { name, data, ts: new Date().toISOString() };
  const list = [evt, ...getEvents()].slice(0, 500);
  write(KEY_EVENTS, list);
}

export function trackPresetSelected(presetId: string): void {
  logEvent("preset_selected", { preset_id: presetId });
}

/** F-04-C: выбор режима конструктора («По теме» / «По номеру ОГЭ/ЕГЭ»). */
export function trackExamModeSelected(mode: "topic" | "exam"): void {
  logEvent("exam_mode_selected", { mode });
}