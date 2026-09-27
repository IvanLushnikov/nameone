/**
 * Regression: F-LK — Header реагирует на профиль в localStorage.
 *
 * Покрывает:
 *   1. Без профиля → показывает «Войти».
 *   2. С профилем → показывает имя (имя + стрелка в dashboard).
 *   3. После диспатча PROFILE_CHANGED_EVENT → Header перечитывает профиль.
 *
 * Использует @testing-library/react (render + screen). Next.js `usePathname`
 * замокан через vi.mock, потому что jsdom не имеет настоящего app router.
 *
 * localStorage-jsdom подключён через `environment: 'jsdom'` (см. vitest.config.ts).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Mock next/navigation ДО импорта Header, иначе usePathname упадёт.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { Header } from "@/components/layout/Header";
import { setProfile, signOut } from "@/lib/utils/storage";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";
import type { UserProfile } from "@/lib/types";

const FIXED_TS = "2026-09-27T10:00:00.000Z";

function mkProfile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u-1",
    email: "teacher@school.ru",
    name: "Test User",
    plan: "free",
    generationsTotal: 0,
    generationsToday: 0,
    generationsLimit: 3,
    createdAt: FIXED_TS,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Header: реактивность на профиль", () => {
  it("без профиля → показывает «Войти»", () => {
    render(<Header />);

    // На десктопе есть «Войти» как button link
    expect(screen.getByText(/^Войти$/)).toBeInTheDocument();
    // Имени юзера быть не должно
    expect(screen.queryByText(/Test User/)).not.toBeInTheDocument();
  });

  it("с профилем → показывает имя юзера", () => {
    setProfile(mkProfile({ name: "Test User" }));

    render(<Header />);

    // Профиль уже в localStorage на момент рендера → Header читает в useEffect.
    expect(screen.getByText(/Test User/)).toBeInTheDocument();
    // Кнопки «Войти» больше нет
    expect(screen.queryByText(/^Войти$/)).not.toBeInTheDocument();
  });

  it("диспатч PROFILE_CHANGED_EVENT после signOut → Header перерисовывается (БЕЗ имени)", () => {
    // 1. Рендерим Header с залогиненным профилем.
    setProfile(mkProfile({ name: "Test User" }));
    render(<Header />);
    expect(screen.getByText(/Test User/)).toBeInTheDocument();

    // 2. signOut чистит localStorage и диспатчит событие.
    act(() => {
      signOut();
    });

    // 3. Header должен среагировать и показать «Войти».
    expect(screen.queryByText(/Test User/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Войти$/)).toBeInTheDocument();
  });

  it("диспатч PROFILE_CHANGED_EVENT после setProfile → Header появляется имя", () => {
    // 1. Без профиля.
    render(<Header />);
    expect(screen.queryByText(/New User/)).not.toBeInTheDocument();

    // 2. setProfile + dispatchEvent (имитация AuthCallbackInner).
    act(() => {
      setProfile(mkProfile({ name: "New User" }));
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
    });

    // 3. Header обновился.
    expect(screen.getByText(/New User/)).toBeInTheDocument();
    expect(screen.queryByText(/^Войти$/)).not.toBeInTheDocument();
  });
});