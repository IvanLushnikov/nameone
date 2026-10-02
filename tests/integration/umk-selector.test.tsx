/**
 * З9: селектор учебника (УМК) показывается только там, где он что-то меняет.
 *
 * Логика (`TopicStep` в `src/app/constructor/page.tsx`):
 *   `showUmkChips = umkList.length > 1 && hasMarkedTopics`,
 * где `hasMarkedTopics` — есть ли в выбранном классе темы с проставленными
 * метками `Topic.umk`. Сейчас такие метки есть ТОЛЬКО у алгебры 7–9 классов.
 * Для остальных предметов переключатель автора ничего не менял, но учительница
 * его видела — отсюда жалоба «зачем мне это выбирать».
 *
 * Тест прямой: гоняем настоящий визард и смотрим на DOM шага «Выберите тему».
 * Если метки `umk` появятся у новых предметов, тест начнёт падать — это
 * правильный сигнал: значит, селектор надо будет включить и там.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  goToTopicStep,
  mockApi,
  openConstructor,
  setDevice,
} from "./helpers/constructor-flow";
import { getUMK } from "@/lib/content/umk";
import { getSubject, getGrade } from "@/lib/content/subjects";
import type { SubjectSlug } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/constructor/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  mockApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1600 });
});

/** Чипы УМК — кнопки с `title={u.author}` внутри блока «Учебник». */
function umkChips(): HTMLElement[] {
  const heading = screen.queryByText("Учебник");
  if (!heading) return [];
  const block = heading.parentElement!;
  return Array.from(block.querySelectorAll("button"));
}

describe("селектор учебника (УМК) — З9", () => {
  it("у алгебры 7 класса селектор есть: метки УМК проставлены", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    expect(screen.getByText("Учебник")).toBeInTheDocument();

    const chips = umkChips();
    const umkList = getUMK("algebra", 7);
    expect(chips).toHaveLength(umkList.length);
    expect(chips.length).toBeGreaterThan(1);
    // Подпись чипа — короткое имя учебника, в title — автор.
    expect(chips.map((c) => c.textContent?.trim())).toEqual(
      umkList.map((u) => u.short)
    );
    expect(chips[0].getAttribute("title")).toBe(umkList[0].author);
  });

  it.each([
    ["geometry", 8],
    ["math", 5],
    ["physics", 8],
  ] as Array<[SubjectSlug, number]>)(
    "у %s %d класса селектора нет: темы без меток УМК",
    async (slug, grade) => {
      const user = await openConstructor();
      await goToTopicStep(user, slug, grade);

      expect(screen.queryByText("Учебник")).not.toBeInTheDocument();
      // Список тем при этом на месте — шаг не сломан, чипов просто нет.
      expect(screen.getByTestId("topics-list")).toBeInTheDocument();
    }
  );

  it("инвариант данных: метки УМК есть только у алгебры 7–9", () => {
    const withMarks: string[] = [];
    for (const subject of ["math", "geometry", "physics", "algebra"] as SubjectSlug[]) {
      const data = getSubject(subject);
      for (const grade of data?.grades ?? []) {
        if (grade.topics.some((t) => t.umk && t.umk.length > 0)) {
          withMarks.push(`${subject}:${grade.num}`);
        }
      }
    }

    expect(withMarks).toEqual(["algebra:7", "algebra:8", "algebra:9"]);
  });

  it("предмет без размеченных тем не ломает шаг: список и счётчик на месте", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "physics", 8);

    const grade = getGrade("physics", 8)!;
    const counter = screen.getByText(/^Показано (\d+) из (\d+)$/);
    const [, shown, total] = counter.textContent!.match(/^Показано (\d+) из (\d+)$/)!;

    expect(Number(shown)).toBeGreaterThan(0);
    expect(Number(shown)).toBeLessThanOrEqual(Number(total));
    expect(Number(total)).toBeLessThanOrEqual(grade.topics.length);
  });
});
