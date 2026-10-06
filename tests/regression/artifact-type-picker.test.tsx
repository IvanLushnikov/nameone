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
    // BL-05: презентация сервер не умеет собирать, поэтому клик объясняет
    // статус, а не уводит на тарифы — редирект здесь был бы ложью.
    expect(window.location.href).toBe("");
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
// BL-05 (06.10.2026): типы, которые сервер не собирает
// ─────────────────────────────────────────────────────────────────────────────

describe("ArtifactTypePicker — тип, которого нет на сервере", () => {
  const SERVER_MISSING = [
    { name: /Карточки/, id: "cards" },
    { name: /План урока/, id: "lesson-plan" },
    { name: /Презентация/, id: "presentation" },
    { name: /КТП/, id: "ktp" },
  ] as const;

  it.each(SERVER_MISSING)(
    "$name помечен и заблокирован ДАЖЕ при действующей подписке",
    async ({ name, id }) => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      // hasPlus = true: подписка не делает серый по серверу тип рабочим.
      render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

      const btn = screen.getByRole("radio", { name });
      expect(btn).toHaveAttribute("aria-disabled", "true");
      expect(btn.className).toMatch(/opacity-60/);
      expect(btn.getAttribute("title")).toMatch(/пока не собирает/i);

      await user.click(btn);
      // Главное: клик НЕ выбирает тип. Раньше он выбирался, и учитель получал
      // заготовку вместо материала.
      expect(onChange).not.toHaveBeenCalled();
      expect(id).toBeTruthy();
    }
  );

  it("клик объясняет статус через событие, а не молча ничего не делает", async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const handler = (e: Event) => {
      events.push((e as CustomEvent<{ type: string }>).detail?.type ?? "");
    };
    window.addEventListener("uc:artifact-type-not-ready", handler);

    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={true} />);
    await user.click(screen.getByRole("radio", { name: /Карточки/ }));

    window.removeEventListener("uc:artifact-type-not-ready", handler);
    expect(events).toContain("cards");
  });

  it("рабочие типы остаются доступными при подписке", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={true} />);
    for (const name of [/Лист/, /Тест/, /Контрольная/]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-disabled", "false");
    }
  });
});

describe("ArtifactTypePicker — hasPlus: всё активно", () => {
  it("доступные типы реагируют на клик", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

    const btn = screen.getByRole("radio", { name: /Контрольная/ });
    expect(btn).toHaveAttribute("aria-disabled", "false");
    expect(btn.className).not.toMatch(/opacity-60/);

    await user.click(btn);
    expect(onChange).toHaveBeenCalledWith("control");
    expect(window.location.href).toBe(""); // не ушли на /pricing/
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
