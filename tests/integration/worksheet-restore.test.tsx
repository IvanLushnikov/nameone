/**
 * З1: восстановление листа после перезагрузки — `src/app/constructor/page.tsx`.
 *
 * Жалоба (дословно): учительница обновила страницу (на iPad это ещё и
 * pull-to-refresh) и потеряла сгенерированный лист ВМЕСТЕ с бесплатной
 * попыткой. Т.е. страдают две вещи сразу — результат и лимит. Тест закрывает
 * обе половины.
 *
 * КАК СМОДЕЛИРОВАНА ПЕРЕЗАГРУЗКА. Настоящий `location.reload()` в jsdom
 * невозможен, поэтому «перезагрузка» = `unmount()` + `render()` поверх
 * ТОГО ЖЕ localStorage: React-стейт обнуляется, хранилище — нет. Это ровно
 * то состояние, в котором оказывается браузер после F5/pull-to-refresh.
 *
 * ЧТО ПРОВЕРЯЕМ (обе половины жалобы + обе ветки решения):
 *   1) свежая запись (age ≤ RESTORE_WINDOW_MS) → лист вернулся на экран;
 *   2) показан тост «Лист восстановлен» с обещанием «попытка не потеряна»;
 *   3) бесплатный счётчик НЕ срос — вторая половина жалобы;
 *   4) запись старше окна (3 часа) → НЕ восстанавливается (вчерашний лист
 *      показывать не надо);
 *   5) битая запись (тип в истории ≠ тип артефакта) → не восстанавливается,
 *      а не кладётся в чужой слот;
 *   6) deep-link (`?topic=`) → восстановление отключено: юзер сам пришёл
 *      собирать новый лист;
 *   7) `artifactKindOf` на не-`worksheet`: КТП (`weeks`) восстанавливается
 *      в свой слот, а не в слот рабочего листа.
 *
 * ПРО ТОСТ — ЧЕСТНО. Тест мокает только `useToast` и смотрит, ЧТО страница
 * попросила показать (tone/title/description). Отрисовку самого тоста он не
 * проверяет, и на то есть причина, вскрытая этим же тестом: в
 * `src/app/layout.tsx` `<Toaster />` стоит СОСЕДОМ с `<main>`, а не его
 * предком, поэтому ни одна страница приложения не попадает в
 * `ToastContext` и `useToast()` всегда срабатывает soft-fallback в
 * `console.warn`. То есть в проде тост восстановления (как и все остальные
 * тосты) сейчас НЕ виден учителю. См. describe «ДИАГНОСТИКА» в конце файла —
 * там это зафиксировано явно. Продуктовый код не трогаем.
 *
 * Сеть не используется (см. `mockApi` в хелпере), таймеры — только штатные
 * 200-400 мс страницы.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, useEffect, type ComponentType } from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import ConstructorPage from "@/app/constructor/page";
import { addToHistory, getHistory } from "@/lib/utils/storage";
import { getRemaining } from "@/lib/utils/limit";
import type { Ktp, UserHistoryItem, Worksheet } from "@/lib/types";
import {
  flushPageTimers,
  generateWorksheet,
  goToTopicStep,
  mockApi,
  setDevice,
} from "./helpers/constructor-flow";

/**
 * Query задаётся через НАСТОЯЩИЙ `window.location.search`: конструктор больше
 * не читает `useSearchParams()` (хук требовал границу <Suspense> при статическом
 * экспорте, а её fallback закрывал страницу до гидратации). Один файл проверяет
 * и обычный заход, и deep-link (?topic=…), который отключает восстановление.
 */
function setSearch(value: string): void {
  window.history.replaceState(
    {},
    "",
    value ? `/constructor?${value}` : "/constructor"
  );
}
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
}));

// canvas-confetti рисует частицы через rAF/canvas; в jsdom getContext → null,
// и ошибка прилетает уже ПОСЛЕ теста. К логике восстановления отношения не
// имеет — глушим.
vi.mock("canvas-confetti", () => ({ default: () => {} }));

/**
 * Перехватываем ТОЛЬКО `useToast`, сам `Toaster` оставляем настоящим.
 * Нужно, чтобы увидеть полный payload тоста (tone + title + description):
 * soft-fallback без провайдера логирует только `title` и теряет обещание
 * «генерация не потерялась», а ради него тост и нужен.
 */
interface ToastCall {
  tone?: string;
  title?: string;
  description?: string;
}
let toastCalls: ToastCall[] = [];
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/Toast")>(
    "@/components/ui/Toast"
  );
  return {
    ...actual,
    useToast: () => ({
      toast: (t: ToastCall) => {
        toastCalls.push(t);
      },
    }),
  };
});

/** Ключ бесплатного счётчика в localStorage (`src/lib/utils/limit.ts`). */
const QUOTA_KEY = "uchlist_gens_v1";

/** Окно восстановления из продукта: 2 часа. */
const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;

const RESTORE_TOAST = "Лист восстановлен";

/** Рендер конструктора. */
function renderConstructor(): ReturnType<typeof render> {
  return render(createElement(ConstructorPage as ComponentType));
}

/** Заходит на конструктор и дожидается первого шага. */
async function openConstructorWithUser(): Promise<{
  user: UserEvent;
  view: ReturnType<typeof render>;
}> {
  const view = renderConstructor();
  await screen.findByText("Что и для кого");
  return { user: userEvent.setup(), view };
}

/** Прогоняет визард до готового листа (предмет → класс → тема → генерация). */
async function generateOne(): Promise<{ user: UserEvent; view: ReturnType<typeof render> }> {
  const opened = await openConstructorWithUser();
  await goToTopicStep(opened.user, "algebra", 7);
  await generateWorksheet(opened.user);
  return opened;
}

/** Первая запись истории — та самая, из которой конструктор берёт лист. */
function topHistory(): UserHistoryItem {
  const [first] = getHistory();
  if (!first) throw new Error("История пуста — генерация не попала в localStorage");
  return first;
}

/** КТП для проверки ветки `artifactKindOf` → "ktp" (дискриминатор `weeks`). */
const KTP_ARTIFACT: Ktp = {
  id: "ktp-restore-1",
  title: "КТП по алгебре 7 класс",
  subject: "algebra",
  grade: 7,
  schoolYear: "2026/2027",
  totalHours: 68,
  createdAt: new Date().toISOString(),
  weeks: [
    {
      weekNum: 1,
      entries: [
        {
          num: 1,
          dates: "01.09–05.09",
          topic: "Повторение дробей",
          kind: "lesson",
          hours: 1,
        },
      ],
    },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  setSearch("");
  toastCalls = [];
  mockApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1600 });
});

describe("восстановление листа после перезагрузки (З1)", () => {
  it("сгенерированный лист переживает перезагрузку: возвращается на экран, показан тост, счётчик не срос", async () => {
    // --- До «перезагрузки»: учительница сгенерировала лист ---
    const { view } = await generateOne();

    const record = topHistory();
    const artifact = record.artifact as Worksheet;
    expect(Array.isArray(artifact?.tasks)).toBe(true);

    const quotaBefore = getRemaining();
    const rawQuotaBefore = window.localStorage.getItem(QUOTA_KEY);
    // Одна генерация из трёх бесплатных потрачена.
    expect(quotaBefore).toBe(2);
    expect(rawQuotaBefore).not.toBeNull();
    // Генерация не сама принесла тост восстановления.
    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(0);

    // --- «Перезагрузка»: React-стейт уходит вниз, localStorage остаётся ---
    view.unmount();
    toastCalls = [];

    renderConstructor();
    await screen.findByText("Новый вариант");

    // 1) Лист вернулся на экран — по заголовку и тексту задания.
    expect(screen.getAllByText(artifact.title).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain(artifact.tasks[0].text);
    // Экран результата на месте — это не пустой визард, а восстановленный лист.
    expect(screen.getByRole("button", { name: /Новый вариант/ })).toBeInTheDocument();

    // 2) Тост про восстановление — с обещанием, что попытка не потрачена.
    const restoreToasts = toastCalls.filter((t) => t.title === RESTORE_TOAST);
    expect(restoreToasts).toHaveLength(1);
    expect(restoreToasts[0].tone).toBe("info");
    expect(restoreToasts[0].description).toBe(
      "Вот ваши PDF и DOCX — генерация не потерялась"
    );

    // 3) ВТОРАЯ ПОЛОВИНА ЖАЛОБЫ: счётчик не срос.
    expect(getRemaining()).toBe(quotaBefore);
    expect(window.localStorage.getItem(QUOTA_KEY)).toBe(rawQuotaBefore);

    await flushPageTimers();
  }, 30_000);

  it("восстановление не жжёт бесплатную попытку при нескольких перезагрузках подряд", async () => {
    // iPad-реальность: pull-to-refresh учительница дёрнула несколько раз.
    const opened = await generateOne();
    const quotaBefore = getRemaining();
    const rawQuotaBefore = window.localStorage.getItem(QUOTA_KEY);

    // Каждый круг — честная перезагрузка: размонтировать ТЕКУЩИЙ view и
    // смонтировать новый. (unmount старого, уже размонтированного view не
    // убирает свежий контейнер — на этом тест ловил «Found multiple elements».)
    let view = opened.view;
    for (let i = 0; i < 3; i++) {
      view.unmount();
      view = renderConstructor();
      await screen.findByText("Новый вариант");
    }
    view.unmount();

    expect(getRemaining()).toBe(quotaBefore);
    expect(getRemaining()).toBe(2);
    expect(window.localStorage.getItem(QUOTA_KEY)).toBe(rawQuotaBefore);
    // Тост показали на КАЖДЫЙ reload (это 3 перезагрузки) — но ни одна из них
    // не списала попытку. Проверяем именно количество вызовов, а не ноль.
    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(3);

    await flushPageTimers();
  }, 40_000);

  it("запись старше окна в 2 часа не восстанавливается — вчерашний лист не показываем", async () => {
    const { view } = await generateOne();
    const record = topHistory();
    const artifact = record.artifact as Worksheet;

    // Запись остаётся в localStorage, но она «вчерашняя»: подменяем createdAt
    // у настоящей сгенерированной записи, а не пишем фейковый артефакт.
    addToHistory({
      ...record,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });
    expect(Date.now() - new Date(topHistory().createdAt).getTime()).toBeGreaterThan(
      RESTORE_WINDOW_MS
    );

    view.unmount();
    toastCalls = [];

    renderConstructor();
    // Страница открылась на первом шаге визарда, а не на листе.
    await screen.findByText("Что и для кого");

    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(0);
    expect(screen.queryAllByText(artifact.title)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Новый вариант/ })).not.toBeInTheDocument();

    await flushPageTimers();
  }, 30_000);

  it("запись на границе окна (2 часа минус 5 секунд) ещё восстанавливается", async () => {
    // Граница включена: в продукте `age > RESTORE_WINDOW_MS` отбрасывает,
    // `age ===` — нет. Отступ 5 секунд защищает от «тест прошёл на границе
    // из-за round-trip времени», но всё ещё проверяет именно эту ветку.
    const artifact: Worksheet = {
      id: "boundary-1",
      title: "Лист на границе окна",
      subject: "Алгебра",
      grade: 7,
      topic: "drobi",
      difficulty: "medium",
      createdAt: new Date().toISOString(),
      tasks: [
        { number: 1, text: "Задание на границе", type: "short-answer", answer: "1", points: 1 },
      ],
    };
    addToHistory({
      id: "boundary-1",
      type: "worksheet",
      title: artifact.title,
      subject: "algebra",
      grade: 7,
      createdAt: new Date(Date.now() - RESTORE_WINDOW_MS + 5_000).toISOString(),
      isFavorite: false,
      artifact,
    });

    renderConstructor();

    expect(await screen.findAllByText("Лист на границе окна")).not.toHaveLength(0);
    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(1);

    await flushPageTimers();
  });

  it("битая запись (тип истории ≠ тип артефакта) не восстанавливается", async () => {
    const { view } = await generateOne();
    const record = topHistory();
    const artifact = record.artifact as Worksheet;

    // Тип в истории — «ktp», а сам артефакт — рабочий лист. Такой mismatch
    // сверка `historyTypeToKind(item.type) === artifactKindOf(item.artifact)`
    // обязана отбросить, а не положить лист в слот КТП.
    addToHistory({ ...record, type: "ktp" });
    view.unmount();
    toastCalls = [];

    renderConstructor();
    await screen.findByText("Что и для кого");

    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(0);
    expect(screen.queryAllByText(artifact.title)).toHaveLength(0);

    await flushPageTimers();
  }, 30_000);

  it("старая запись без поля artifact (до перехода на хранение листа) не ломает страницу", async () => {
    const { view } = await generateOne();
    const record = topHistory();
    const { artifact: _dropped, ...legacy } = record;
    view.unmount();
    toastCalls = [];

    // Запись из прошлой версии: метаданные есть, самого листа нет.
    addToHistory(legacy as UserHistoryItem);

    renderConstructor();
    await screen.findByText("Что и для кого");

    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(0);
    // Мусор в DOM означал бы, что в state попалось `undefined`.
    expect(document.body.textContent).not.toContain("undefined");

    await flushPageTimers();
  }, 30_000);

  it("deep-link с ?topic= отключает восстановление: юзер сам пришёл за новым листом", async () => {
    const { view } = await generateOne();
    const record = topHistory();
    const artifact = record.artifact as Worksheet;
    view.unmount();
    toastCalls = [];

    // Тот же самый localStorage, но приход по рекламной ссылке на тему.
    setSearch("topic=drobi");
    renderConstructor();
    await screen.findByText("Что и для кого");
    // Эффект восстановления обязан отработать ДО проверки. Раньше проверка шла
    // сразу за findByText и опиралась на то, что эффект уже успел выполниться.
    // В CI это не гарантировано, и тест падал: восстановление отрабатывало
    // после проверки, флака по таймингу.
    await flushPageTimers();

    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(0);
    expect(screen.queryAllByText(artifact.title)).toHaveLength(0);
  }, 30_000);

  it("КТП из истории восстанавливается в свой слот, а не как рабочий лист", async () => {
    addToHistory({
      id: KTP_ARTIFACT.id,
      type: "ktp",
      title: KTP_ARTIFACT.title,
      subject: KTP_ARTIFACT.subject,
      grade: KTP_ARTIFACT.grade,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      artifact: KTP_ARTIFACT,
    });

    renderConstructor();
    await screen.findByText("Новый вариант");

    expect(toastCalls.filter((t) => t.title === RESTORE_TOAST)).toHaveLength(1);
    // Подпись в тулбаре превью — ровно та, что для КТП.
    expect(screen.getByText(/КТП · 2026\/2027 · 68 ч/)).toBeInTheDocument();
    // Заголовок КТП на месте, и это именно КТП-таблица, а не нумерованный
    // список заданий рабочего листа.
    expect(
      screen.getByRole("heading", { level: 1, name: KTP_ARTIFACT.title })
    ).toBeInTheDocument();
    expect(screen.getByText("Повторение дробей")).toBeInTheDocument();

    await flushPageTimers();
  });
});

/**
 * ДИАГНОСТИКА (не проверка фичи, а зафиксированная находка).
 *
 * Найдено этим файлом: `<Toaster />` в `src/app/layout.tsx` отрисован
 * РЯДОМ с блоком, где лежит `<main>` — то есть не является его предком.
 * Плюс сам `Toaster` вообще не принимает `children` (`components/ui/Toast.tsx`).
 * Следствие: ни одна страница приложения не получает `ToastContext`, и
 * `useToast()` всегда уходит в soft-fallback `console.warn`.
 * Практический эффект: тост «Лист восстановлен» (и все остальные ~10
 * тостов конструктора) учителю НЕ показывается — она видит только то,
 * что вернулось в localStorage. То есть половина жалобы «потеряла лист»
 * закрыта, а вторая половина («и не понимает, что попытка вернулась»)
 * сейчас не закрыта вовсе.
 *
 * Эти два теста — «канарейки»: они упадут, когда баг починят, и это
 * правильно. Чинить продуктовый код здесь нельзя, поэтому только фиксируем.
 */
describe("ДИАГНОСТИКА: тосты в приложении не доходят до UI", () => {
  const LAYOUT = fs.readFileSync(
    path.resolve(__dirname, "../../src/app/layout.tsx"),
    "utf8"
  );

  it("useToast без провайдера уходит в console.warn, а не рисует тост", async () => {
    // Проверяем soft-fallback как есть — это тот путь, по которому сейчас
    // идёт КАЖДЫЙ тост в приложении. Берём НАСТОЯЩИЙ `useToast`: в этом файле
    // он замокан (нужно, чтобы видеть payload тоста восстановления).
    const { useToast: realUseToast } = await vi.importActual<
      typeof import("@/components/ui/Toast")
    >("@/components/ui/Toast");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Probe() {
      realUseToast().toast({ tone: "info", title: "Проба тоста" });
      return null;
    }
    render(createElement(Probe));

    expect(warn).toHaveBeenCalledWith("[toast]", "Проба тоста");
    // В DOM тоста нет — UI его показать не может.
    expect(screen.queryByText("Проба тоста")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("layout.tsx: <Toaster> оборачивает <main>, иначе тосты не показываются", () => {
    // Регрессия: <Toaster /> стоял СОСЕДОМ с <main>, а Provider живёт внутри
    // Toaster — значит ни одна страница не попадала в ToastContext, и
    // useToast() всегда уходил в console.warn. Тост «Лист восстановлен»
    // (половина фикса жалобы №1) при этом не появлялся на экране.
    const mainOpen = LAYOUT.indexOf("<main");
    const mainClose = LAYOUT.indexOf("</main>");
    expect(mainOpen).toBeGreaterThan(-1);
    expect(mainClose).toBeGreaterThan(mainOpen);

    const toasterOpen = LAYOUT.indexOf("<Toaster>");
    expect(toasterOpen).toBeGreaterThan(-1);
    // Toaster открывается ДО <main> и закрывается ПОСЛЕ него.
    expect(toasterOpen).toBeLessThan(mainOpen);
    expect(LAYOUT.indexOf("</Toaster>")).toBeGreaterThan(mainClose);
  });

  it("Toaster принимает children и провайдер накрывает отрисованные тосты", async () => {
    // Проверяем на настоящем компоненте, без моков: рендерим Toaster с
    // потомком, который дёргает useToast(), и ждём появления текста в DOM.
    const { Toaster: RealToaster, useToast: realUseToast } = await vi.importActual<
      typeof import("@/components/ui/Toast")
    >("@/components/ui/Toast");

    function Child() {
      const { toast } = realUseToast();
      useEffect(() => {
        toast({ tone: "info", title: "Тост из контекста" });
      }, [toast]);
      return null;
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(createElement(RealToaster, null, createElement(Child)));

    // Тост реально отрисован, а не ушёл в console.
    expect(await screen.findByText("Тост из контекста")).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalledWith("[toast]", "Тост из контекста");
    warn.mockRestore();
  });
});
