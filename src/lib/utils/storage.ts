"use client";

import type { UserHistoryItem, UserTemplate, UserProfile, Worksheet, LessonPlan, Presentation, Ktp } from "@/lib/types";

const KEY_HISTORY = "listai.history";
const KEY_TEMPLATES = "listai.templates";
const KEY_PROFILE = "listai.profile";
const KEY_FAVORITES = "listai.favorites";

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

export function toggleFavorite(id: string) {
  const list = getHistory().map((x) =>
    x.id === id ? { ...x, isFavorite: !x.isFavorite } : x
  );
  write(KEY_HISTORY, list);
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
}

// ===== Сохранение листов в избранное (отдельно от истории) =====

export function getFavorites(): Worksheet[] {
  return read<Worksheet[]>(KEY_FAVORITES, []);
}

export function saveFavorite(w: Worksheet | LessonPlan | Presentation | Ktp) {
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