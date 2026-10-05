/**
 * Тесты ТЗ-21: страница личного кабинета (`src/app/dashboard/page.tsx`).
 *
 * Проверяется ровно то, что билось в интерфейсе:
 *   1. АНОНИМНЫЙ ПУТЬ. Учитель без входа открывает кабинет и видит свои
 *      материалы. Ни одного запроса в сеть (никакого 401 и мигания
 *      «Загрузка») и ни одного требования войти за свои же материалы.
 *   2. ЧЕТЫРЕ СОСТОЯНИЯ вкладки: загрузка / недоступно с кнопкой повтора /
 *      пусто с действием / данные.
 *   3. ПОИСК И ФИЛЬТРЫ работают на отрисованной странице, а не только в
 *      чистых функциях.
 *   4. Кнопка «Настройки» ведёт на /dashboard/settings.
 *   5. Плитка «С нами» показывает срок, а у пустой истории — прочерк,
 *      а не «только что».
 *
 * Формы (вкладка «Выданное») и нормы замоканы: они не относятся к ТЗ-21 и
 * тянут за собой сеть.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

/** Вкладка «Выданное» — серверные формы, к ТЗ-21 отношения не имеет. */
vi.mock("@/components/teacher/FormsTab", () => ({
  FormsTab: () => <div data-testid="forms-tab" />,
}));
/** Норма тарифа — тоже серверная вещь, вне скоупа. */
vi.mock("@/components/shared/UsageCard", () => ({
  UsageCard: () => <div data-testid="usage-card" />,
}));
vi.mock("@/lib/auth/api", () => ({
  fetchUsage: async () => null,
}));

import DashboardPage from "@/app/dashboard/page";
import { setProfile, type FavoriteArtifact } from "@/lib/utils/storage";
import type { UserProfile, Worksheet } from "@/lib/types";

const PROFILE: UserProfile = {
  id: "u1",
  name: "Иван",
  email: "ivan@example.com",
  plan: "free",
  used: 0,
  createdAt: new Date().toISOString(),
} as UserProfile;

const fetchMock = vi.fn();

function makeWorksheet(id: string, over: Partial<Worksheet> = {}): Worksheet {
  return {
    id,
    type: "worksheet",
    subject: "math",
    grade: 5,
    topic: `Тема ${id}`,
    difficulty: "medium",
    count: 2,
    title: `Лист ${id}`,
    createdAt: new Date().toISOString(),
    tasks: [
      { text: "Задание 1", answer: "1", explanation: "" },
      { text: "Задание 2", answer: "2", explanation: "" },
    ],
    ...over,
  } as Worksheet;
}

/** Кладёт листы в историю устройства (последние N хранят тело артефакта). */
function seedHistoryDevice(count: number, mk?: (i: number) => Partial<Worksheet>) {
  const { addToHistory } = require("@/lib/utils/storage");
  for (let i = count - 1; i >= 0; i--) {
    const ws = makeWorksheet(`w${i}`, mk?.(i));
    addToHistory({
      id: ws.id,
      type: "worksheet",
      title: ws.title,
      subject: ws.subject,
      grade: ws.grade,
      createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      isFavorite: false,
      artifact: i < 5 ? ws : undefined,
    });
  }
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  fetchMock.mockRejectedValue(new Error("сеть недоступна в тесте"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ─── Анонимный путь ──────────────────────────────────────────────────────── */

describe("Анонимный учитель (без входа)", () => {
  it("видит свою историю и НЕ отправляет запросов в сеть", async () => {
    seedHistoryDevice(3);
    render(<DashboardPage />);

    await screen.findByText("Лист w0");

    // Главное требование ТЗ-21: аноним не видит ни 401, ни мигания загрузки.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("не показывает требование войти за собственные материалы", async () => {
    seedHistoryDevice(2);
    render(<DashboardPage />);

    await screen.findByText("Лист w0");
    expect(screen.queryByText(/войдите, чтобы увидеть/i)).toBeNull();
    expect(screen.queryByText(/войдите, чтобы сохранять/i)).toBeNull();
  });

  it("пустая история приглашает создать лист, а не войти", async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("История пуста")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /создать первый лист/i })).toBeInTheDocument();
  });
});

/* ─── Четыре состояния вкладки ────────────────────────────────────────────── */

describe("Четыре состояния вкладки", () => {
  it("состояние 1 — загрузка показывается скелетоном, а не пустотой", async () => {
    seedHistoryDevice(1);
    let release: (() => void) | null = null;
    fetchMock.mockImplementation(
      () => new Promise((_r, reject) => {
        release = () => reject(new Error("offline"));
      })
    );
    // Даже во время загрузки скелетон есть, а не «ничего не найдено».
    render(<DashboardPage />);

    expect(await screen.findByTestId("tab-loading")).toBeInTheDocument();
    expect(screen.queryByText("История пуста")).toBeNull();
    release?.();
  });

  it("состояние 2 — недоступно с кнопкой «Попробовать ещё раз»", async () => {
    setProfile(PROFILE);
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("tab-unavailable")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /попробовать ещё раз/i })
    ).toBeInTheDocument();
  });

  it("состояние 2 не появляется, если на устройстве есть данные", async () => {
    setProfile(PROFILE);
    seedHistoryDevice(2);
    render(<DashboardPage />);

    await screen.findByText("Лист w0");
    // Сервер не ответил, но показаны данные устройства + пометка.
    expect(screen.queryByTestId("tab-unavailable")).toBeNull();
    expect(screen.getByTestId("device-only-note")).toBeInTheDocument();
  });

  it("состояние 3 — пусто с рабочим действием", async () => {
    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("История пуста")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /создать первый лист/i })).toBeInTheDocument();
  });

  it("состояние 4 — данные с карточками", async () => {
    seedHistoryDevice(3);
    render(<DashboardPage />);

    await screen.findByText("Лист w0");
    expect(screen.getAllByTestId("history-card").length).toBe(3);
  });

  it("кнопка повтора действительно перезапрашивает данные", async () => {
    setProfile(PROFILE);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId("tab-unavailable")).toBeInTheDocument());

    const before = fetchMock.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /попробовать ещё раз/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
  });
});

/* ─── Поиск и фильтры на странице ─────────────────────────────────────────── */

describe("Поиск и фильтры в кабинете", () => {
  beforeEach(() => {
    seedHistoryDevice(4, (i) =>
      i % 2 === 0
        ? { subject: "math", title: "Дроби", grade: 5 }
        : { subject: "english", title: "Времена", grade: 6 }
    );
  });

  it("поиск сужает список", async () => {
    render(<DashboardPage />);
    await screen.findByText("Дроби");

    await userEvent.type(screen.getByTestId("history-search"), "времена");

    await waitFor(() => {
      expect(screen.getByText("Времена")).toBeInTheDocument();
      expect(screen.queryByText("Дроби")).toBeNull();
    });
  });

  it("пустой результат поиска предлагает сбросить фильтры", async () => {
    render(<DashboardPage />);
    await screen.findByText("Дроби");

    await userEvent.type(screen.getByTestId("history-search"), "щщщ");

    await waitFor(() => {
      expect(screen.getByText("Ничего не нашлось")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /сбросить поиск и фильтры/i })
    ).toBeInTheDocument();
  });

  it("фильтр по предмету", async () => {
    render(<DashboardPage />);
    await screen.findByText("Дроби");

    await userEvent.selectOptions(screen.getByTestId("filter-subject"), "english");

    await waitFor(() => {
      expect(screen.queryByText("Дроби")).toBeNull();
      expect(screen.getByText("Времена")).toBeInTheDocument();
    });
  });

  it("фильтр по классу", async () => {
    render(<DashboardPage />);
    await screen.findByText("Дроби");

    await userEvent.selectOptions(screen.getByTestId("filter-grade"), "5");

    await waitFor(() => {
      expect(screen.queryByText("Времена")).toBeNull();
    });
    expect(screen.getByText("Дроби")).toBeInTheDocument();
  });

  it("карточка показывает тип и размер, а не только эмодзи", async () => {
    render(<DashboardPage />);
    await screen.findByText("Дроби");

    const card = screen.getAllByTestId("history-card")[0];
    // Тип материала текстом + размер «2 задания» из тела артефакта.
    expect(within(card).getByText("Рабочий лист")).toBeInTheDocument();
    expect(within(card).getByText("2 задания")).toBeInTheDocument();
  });

  it("карточка ведёт в превью с ?id", async () => {
    render(<DashboardPage />);
    const card = await screen.findByTestId("history-card");
    const link = within(card).getByRole("link", { name: /открыть/i });
    expect(link).toHaveAttribute("href", "/preview?id=w0");
  });

  it("PDF скачивается прямо из карточки", async () => {
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    render(<DashboardPage />);
    const card = await screen.findByTestId("history-card");

    await userEvent.click(within(card).getByTestId("download-pdf"));

    expect(printSpy).toHaveBeenCalled();
  });

  it("группировка по дате: есть заголовок группы", async () => {
    render(<DashboardPage />);
    await screen.findByText("Дроби");
    expect(screen.getByText("Сегодня")).toBeInTheDocument();
  });
});

/* ─── Вкладки, избранное, шаблоны ─────────────────────────────────────────── */

describe("Остальные вкладки кабинета", () => {
  it("пустое избранное предлагает действие (был тупик action={null})", async () => {
    setProfile(PROFILE);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId("tab-unavailable")).toBeInTheDocument());

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("offline"));
    await userEvent.click(screen.getByRole("tab", { name: /избранное/i }));

    await waitFor(() => {
      expect(screen.getByText("Нет избранных листов")).toBeInTheDocument();
    });
    // Действие есть — это и было поломкой.
    expect(screen.getByRole("link", { name: /создать лист/i })).toBeInTheDocument();
  });

  it("пустые шаблоны объясняют, как их создать, и дают действие", async () => {
    setProfile(PROFILE);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId("tab-unavailable")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /шаблоны/i }));

    await waitFor(() => {
      expect(screen.getByText("Нет шаблонов")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /создать лист и сохранить как шаблон/i })
    ).toBeInTheDocument();
  });

  it("избранное устройства показывается анонимному учителю", async () => {
    const { saveFavorite } = await import("@/lib/utils/storage");
    saveFavorite(makeWorksheet("f1") as FavoriteArtifact);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId("tab-loading")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: /избранное/i }));

    expect(await screen.findByText("Лист f1")).toBeInTheDocument();
  });
});

/* ─── Плитка «С нами» и настройки ─────────────────────────────────────────── */

describe("Прочее", () => {
  it("«С нами» у пустой истории показывает прочерк, а не «только что»", async () => {
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText("История пуста")).toBeInTheDocument());

    const tile = screen.getByText("С нами").closest("div")?.parentElement;
    expect(within(tile as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(within(tile as HTMLElement).queryByText("только что")).toBeNull();
  });

  it("«С нами» показывает число дней, а не дату", async () => {
    seedHistoryDevice(1);
    render(<DashboardPage />);
    await screen.findByText("Лист w0");

    const tile = screen.getByText("С нами").closest("div")?.parentElement;
    const text = (tile as HTMLElement).textContent ?? "";
    expect(text).toMatch(/сегодня|дн/);
    expect(text).not.toMatch(/назад/);
  });

  it("есть кнопка «Настройки» со ссылкой на страницу настроек", async () => {
    seedHistoryDevice(1);
    render(<DashboardPage />);
    await screen.findByText("Лист w0");

    const link = screen.getByRole("link", { name: /настройки/i });
    expect(link).toHaveAttribute("href", "/dashboard/settings");
  });
});
