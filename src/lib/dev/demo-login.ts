"use client";

/**
 * Локальный демо-вход в личный кабинет — БЕЗ регистрации и БЕЗ почты.
 *
 * Зачем: /dashboard целиком работает на localStorage (`src/lib/utils/storage.ts`),
 * поэтому посмотреть ЛК локально не нужно ни бэкенда (Cloudflare Worker + D1),
 * ни реального magic-link письма. Достаточно записать профиль в localStorage —
 * и кабинет открывается как авторизованному учителю.
 *
 * Прод-вход (magic link, session cookie) при этом НЕ ломается: бэк уже умеет
 * отдавать `devMagicUrl` в ответе, когда нет RESEND_API_KEY
 * (backend/src/services/email.ts) — но только вне production, см. backend.
 * Этот модуль — про обход без бэкенда целиком.
 *
 * Кнопка показывается только локально (`next dev`, NODE_ENV=development).
 * В production-сборке (Cloudflare Pages) кнопки нет: NODE_ENV там всегда
 * "production", а флагом NEXT_PUBLIC_DEMO_LOGIN её больше нельзя включить.
 *
 * Раньше условие было `NODE_ENV !== "production" || NEXT_PUBLIC_DEMO_LOGIN === "1"`.
 * Ветка с NEXT_PUBLIC_* работала ровно так же на проде: достаточно было
 * оставить переменную в панели Cloudflare после локального эксперимента, и
 * вход без подтверждения по почте становился доступен всем. NEXT_PUBLIC_*
 * вшивается в бандл на этапе сборки, и проверить, «забыли» ли её убрать,
 * заранее нельзя.
 */

import {
  addTemplate,
  addToHistory,
  saveFavorite,
  setProfile,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";
import type {
  UserHistoryItem,
  UserProfile,
  UserTemplate,
  Worksheet,
} from "@/lib/types";

/** Кнопка демо-входа видна только локально. См. комментарий наверху. */
export function isDemoLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

const DEMO_NAME = "Иван Лушников";
const DEMO_EMAIL = "demo@uchlist.ru";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function demoProfile(): UserProfile {
  return {
    id: "usr_demo_local",
    email: DEMO_EMAIL,
    name: DEMO_NAME,
    plan: "base",
    generationsTotal: 47,
    generationsToday: 2,
    // -1 = безлимит для base/plus (конструктор трактует это сам).
    generationsLimit: -1,
    createdAt: daysAgo(34),
  };
}

/**
 * От СТАРЫХ к новым.
 *
 * `addToHistory` кладёт элемент в начало списка (unshift), поэтому если
 * скормить массив «от новых к старым», на дашборде порядок развернётся
 * (сверху окажется самое старое). Поэтому отдаём в обратном порядке —
 * после unshift в localStorage ляжет правильно: сверху самые новые.
 */
function demoHistory(): UserHistoryItem[] {
  return [
    {
      id: "hist-6",
      type: "exam",
      title: "ОГЭ, часть 1 — вариант 7",
      subject: "math",
      grade: 9,
      createdAt: daysAgo(5),
      isFavorite: false,
    },
    {
      id: "hist-5",
      type: "control",
      title: "Вписанные углы, 2 варианта",
      subject: "geometry",
      grade: 8,
      createdAt: daysAgo(4),
      isFavorite: false,
    },
    {
      id: "hist-4",
      type: "cards",
      title: "Склонение существительных",
      subject: "russian",
      grade: 6,
      createdAt: daysAgo(3),
      isFavorite: false,
    },
    {
      id: "hist-3",
      type: "lesson-plan",
      title: "План урока: Квадратные уравнения",
      subject: "algebra",
      grade: 8,
      createdAt: daysAgo(2),
      isFavorite: false,
    },
    {
      id: "hist-2",
      type: "test",
      title: "Present Simple: форма глагола",
      subject: "english",
      grade: 7,
      createdAt: daysAgo(1),
      isFavorite: false,
    },
    {
      id: "hist-1",
      type: "worksheet",
      title: "Дроби: сложение и вычитание",
      subject: "math",
      grade: 5,
      createdAt: daysAgo(0),
      isFavorite: false,
    },
  ];
}

/** Один избранный лист — чтобы вкладка «Избранное» была не пустой. */
function demoFavorite(): Worksheet {
  return {
    id: "fav-1",
    title: "Квадратные уравнения, 12 заданий с разбором",
    subject: "algebra",
    grade: 8,
    topic: "Квадратные уравнения",
    difficulty: "medium",
    createdAt: daysAgo(2),
    tasks: [
      {
        number: 1,
        text: "Решите уравнение: x² − 5x + 6 = 0",
        type: "computation",
        answer: "x = 2 или x = 3",
        explanation:
          "Ищем корни через дискриминант: D = 25 − 24 = 1, отсюда x = (5 ± 1) / 2.",
        points: 2,
      },
      {
        number: 2,
        text: "При каком значении k уравнение x² + kx + 8 = 0 не имеет корней?",
        type: "short-answer",
        answer: "k < −8 или k > 8",
        explanation: "Нет действительных корней, когда дискриминант отрицателен.",
        points: 2,
      },
      {
        number: 3,
        text: "Сколько целых значений n удовлетворяет неравенству n² − 6n + 5 < 0?",
        type: "short-answer",
        answer: "3 (n = 2, 3, 4)",
        explanation:
          "Корни при n = 1 и n = 5, парабола вверх → промежуток (1; 5), целые: 2, 3, 4.",
        points: 3,
      },
    ],
  };
}

function demoTemplates(): UserTemplate[] {
  return [
    {
      id: "tpl-1",
      name: "Математика 5 кл — дроби, средний",
      subject: "math",
      grade: 5,
      topic: "Дроби",
      difficulty: "medium",
      count: 15,
    },
    {
      id: "tpl-2",
      name: "Русский 6 кл — склонение, лёгкий",
      subject: "russian",
      grade: 6,
      topic: "Склонение существительных",
      difficulty: "easy",
      count: 10,
    },
    {
      id: "tpl-3",
      name: "Алгебра 8 кл — квадратные уравнения",
      subject: "algebra",
      grade: 8,
      topic: "Квадратные уравнения",
      difficulty: "medium",
      count: 12,
    },
  ];
}

/**
 * Записать демо-профиль + наполненный ЛК в localStorage.
 *
 * Без бэкенда: session-cookie не ставится, поэтому виджет дневного лимита
 * генераций (useUsage → GET /api/users/usage) останется скрытым. Для просмотра
 * самого кабинета это не нужно — счётчик хранится в профиле.
 */
export function enterDemoMode(): UserProfile {
  const profile = demoProfile();
  setProfile(profile);
  for (const item of demoHistory()) addToHistory(item);
  saveFavorite(demoFavorite() as FavoriteArtifact);
  for (const tpl of demoTemplates()) addTemplate(tpl);

  // Header слушает это событие, чтобы переключить «Войти» → «{имя} →»
  // без перезагрузки страницы.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  }
  return profile;
}

export const DEMO_USER_NAME = DEMO_NAME;
