import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Объединяет className с поддержкой tailwind-merge (без конфликтов).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Форматирует дату в человекочитаемый формат на русском.
 *
 * Принимает `number` как **unix-время в миллисекундах** — так его отдаёт D1
 * (`created_at` в секундах, поэтому вызовы умножают на 1000). Раньше сигнатура
 * была `Date | string`, и три места с числом (`FormsTab`, `InteractiveList`,
 * `InteractiveDetail`) не компилировались: пришлось бы кастовать в каждом.
 */
export function formatDate(date: Date | string | number): string {
  const d =
    typeof date === "string" ? new Date(date) : date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Относительная дата: "только что", "2 часа назад", "вчера".
 */
export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "только что";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return formatDate(d);
}

/**
 * Русское склонение: plural(1, "предмет", "предмета", "предметов") → "предмет",
 * plural(21, ...) → "предмет", plural(2, ...) → "предмета", plural(5, ...) → "предметов".
 *
 * Возвращает СЛОВО, а не число: вызывающий сам склеивает «21 предмет».
 * Экспортируется, потому что числа в интерфейсе считаются динамически
 * (каталог предметов, счётчики лимитов) — подпись нельзя зашивать строкой.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Короткий id для генераций (8 символов, URL-safe).
 */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Slug-ify для URL: "Сложение дробей" → "slozhenie-drobey".
 */
export function slugify(s: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return s
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Склонение для количества заданий: 1 задание, 2 задания, 5 заданий.
 */
export function pluralizeTasks(n: number): string {
  return plural(n, "задание", "задания", "заданий");
}

/**
 * Склонение для минут: 1 минута, 5 минут.
 */
export function pluralizeMinutes(n: number): string {
  return plural(n, "минута", "минуты", "минут");
}

/**
 * Склонение для количества файлов в комплекте материалов (TZ-16 §3.2):
 * 1 файл, 2 файла, 5 файлов.
 */
export function pluralizeFiles(n: number): string {
  return plural(n, "файл", "файла", "файлов");
}
/**
 * Заголовок темы с указанием УМК — только когда в одном классе есть
 * одноимённые темы под разные учебники («Квадратные корни» по Мерзляку
 * и по Алимову). Без автора УМК такие страницы делили один title, и
 * поисковик не мог их различить.
 *
 * Автор берётся из `fgosRef` («Мерзляк Гл. 2 §13-19» → «Мерзляк»).
 * Одинарные темы возвращаются без изменений — там суффикс только шумит.
 */
export function topicTitleWithUmk(
  title: string,
  sameNameCount: number,
  fgosRef?: string,
): string {
  if (sameNameCount < 2) return title;
  const author = fgosRef?.trim().split(/[\s,]+/)[0];
  return author ? `${title} (${author})` : title;
}
