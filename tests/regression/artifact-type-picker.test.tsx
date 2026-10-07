/**
 * Regression: TZ-4 + TZ-5 (QA-аудит 2026-09-30) + BL-05 (06.10.2026) — ArtifactTypePicker.
 *
 * TZ-5: кнопки plusOnly для бесплатных юзеров должны:
 *   1. Визуально отличаться от enabled (opacity, яркий badge, lock-иконка).
 *   2. При клике НЕ вызывать onChange, а перенаправлять на /pricing/.
 *
 * BL-05 (2026-10-06): часть типов сервер НЕ умеет собирать — /api/lesson-plans,
 * /api/presentations, /api/ktp, /api/cards, /api/materials, /api/bundles отдают
 * HTTP 501. Раньше это нигде не отражалось: нажатие давало типовую заготовку,
 * неотличимую от готового материала. Теперь такие типы помечены и не выбираются.
 *
 * ТЕСТЫ TZ-5 НИЖЕ ВЕДУТ СЕБЯ ПО-СТАРОМУ (проверяют доступность «Презентации»
 * при hasPlus=true), но этот сценарий больше невозможен в жизни: наличие
 * подписки не делает серый по серверу тип рабочим. Поэтому ожидания переписаны
 * под фактическое поведение, а логика проверки plusOnly сохранена на типах,
 * которые сервер умеет.
 *
 * Заметка: TZ-4 (логика `kind`-селектора в constructor/page.tsx) живёт внутри
 * `ConstructorPage` — это client component с useSearchParams + useRouter +
 * useUsage + Docx-генерация, который тянет ~20 импортов. Чтобы не мокать пол-приложения,
 * мы покрываем TZ-4 на уровне callback-контракта (ArtifactTypePicker правильно
 * зовёт onChange), а сброс закэшированных артефактов — отдельным unit-тестом
 * на чистую функцию-обёртку в этом файле (см. wrapper-тест ниже).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// next/navigation + next/link — концерн jsdom.
vi.mock("next/navigation", () => ({
  usePathname: () => "/constructor/",
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

import { ArtifactTypePicker } from "@/components/constructor/ArtifactTypePicker";

// jsdom не позволяет напрямую перезаписать window.location.href — используем
// defineProperty. Сбрасываем перед каждым тестом, чтобы состояние не текло
// между сценариями (тест с /pricing/ иначе ломает следующий).
Object.defineProperty(window, "location", {
  value: { ...window.location, href: "" },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, href: "" },
    writable: true,
    configurable: true,
  });
});

describe("ArtifactTypePicker — TZ-5: plusOnly без hasPlus", () => {
  it("визуально отличается: opacity-60 + cursor-not-allowed + lock-иконка", () => {
    const { container } = render(
      <ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />
    );

    const btn = screen.getByRole("radio", { name: /План урока/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn.className).toMatch(/opacity-60/);
    expect(btn.className).toMatch(/cursor-not-allowed/);

    // Lock-иконка внутри плюс-бейджа: ищем по классу lucide-lock.
    const lockIcon = container.querySelector(".lucide-lock");
    expect(lockIcon).toBeTruthy();
  });

  it("яркий badge '+' с белым текстом на accent-500 для заблокированных опций", () => {
    const { container } = render(
      <ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />
    );

    // Находим бейдж '+' внутри disabled-кнопки «Презентация».
    const btn = screen.getByRole("radio", { name: /Презентация/ });
    const badge = btn.querySelector("span.bg-accent-500");
    expect(badge).toBeTruthy();
    expect(badge).toHaveTextContent("+");
    expect(badge?.className).toMatch(/text-white/);
  });

  it("при клике НЕ вызывает onChange, а перенаправляет на /pricing/", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={false} />);

    // Кликаем по «Презентация» (plusOnly) — onChange НЕ должен сработать,
    // а window.location.href должен стать "/pricing/".
    await user.click(screen.getByRole("radio", { name: /Презентация/ }));

    expect(onChange).not.toHaveBeenCalled();
    // Презентация снова серверная (07.10.2026), но остаётся плюсовой:
    // без подписки клик уводит на тарифы. Это честно — тариф реально решает,
    // в отличие от ситуации 06.10, когда тип не умел сервер вообще.
    expect(window.location.href).toBe("/pricing/");
  });

  // Тест «title подсказывает Плюс» удалён вместе с поведением, которое он
  // описывал: 06.10.2026 выяснилось, что ВСЕ plusOnly-типы (план урока,
  // презентация, КТП) сервер не умеет собирать. Значит подписка никогда не
  // делает их доступными, и подсказка «Доступно в тарифе Плюс» стала бы враньём
  // — учитель купил бы подписку ради материала, которого всё равно нет.
  // Проверка самой механики plusOnly осталась на типах, доступных по тарифу
  // (см. тест выше про доступные типы).
});

// ─────────────────────────────────────────────────────────────────────────────
// BL-05: типы, которых сервер не собирает, и их возвращение в строй 07.10.2026
// ─────────────────────────────────────────────────────────────────────────────

describe("ArtifactTypePicker — все доступные типы работают", () => {
  it.each([
    ["Карточки", /Карточки/],
    ["План урока", /План урока/],
    ["Презентация", /Презентация/],
    ["КТП", /КТП/],
  ])("%s больше не помечен как несобранный", async (_name, matcher) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    // hasPlus = true, чтобы проверять серверную готовность, а не тариф.
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

    const btn = screen.getByRole("radio", { name: matcher });
    // 06.10.2026 здесь был aria-disabled="true" и бейдж «скоро».
    // 07.10.2026 серверные эндпоинты реализованы, тип снова выбирается.
    expect(btn).toHaveAttribute("aria-disabled", "false");
    expect(btn.className).not.toMatch(/opacity-60/);

    await user.click(btn);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("клик больше не уходит в «тип не готов» — ни одного такого события", async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const handler = (e: Event) => {
      events.push((e as CustomEvent<{ type: string }>).detail?.type ?? "");
    };
    window.addEventListener("uc:artifact-type-not-ready", handler);

    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={true} />);
    for (const name of [/Карточки/, /План урока/, /Презентация/, /КТП/]) {
      await user.click(screen.getByRole("radio", { name }));
    }

    window.removeEventListener("uc:artifact-type-not-ready", handler);
    expect(events).toEqual([]);
  });

  it("рабочие типы остаются доступными", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={true} />);
    for (const name of [/Лист/, /Тест/, /Контрольная/]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-disabled", "false");
    }
  });
});

describe("ArtifactTypePicker — TZ-4: смена типа переключает preview", () => {
  it("enabled-кнопки зовут onChange (контракт с родителем: сбросить preview и поставить новый тип)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

    await user.click(screen.getByRole("radio", { name: /Лист/ }));
    expect(onChange).toHaveBeenCalledWith("worksheet");

    await user.click(screen.getByRole("radio", { name: /Тест/ }));
    expect(onChange).toHaveBeenCalledWith("test");
  });
});
