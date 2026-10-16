"use client";

/**
 * Личный кабинет учителя (`/dashboard`) — ТЗ-21.
 *
 * ЧТО БЫЛО СЛОМАНО (см. docs/21-lk-flow-review-2026-10-05.md):
 *   1. Бэкенд давно умеет отдавать историю, избранное и шаблоны постранично,
 *      а фронт не дёргал ни один из этих эндпоинтов — всё читалось из
 *      localStorage, то есть терялось при смене устройства.
 *   2. Кнопка «Открыть» в истории вела в `/preview`, который искал артефакт
 *      только в избранном → «Лист не найден». Чинится в `src/lib/lk/artifact.ts`.
 *   3. У пустых вкладок «Избранное» и «Шаблоны» стоял `action={null}` — тупик.
 *   4. Одна лента из 50 одинаковых карточек: найти лист было нельзя, отличить
 *      два листа одного предмета — тоже. На мобильном 12 карточек давали ленту
 *      высотой 14 368 px.
 *   5. Плитка «С нами» брала `timeAgo` от САМОГО СТАРОГО листа, то есть
 *      показывала «2 месяца назад» — дату вместо срока.
 *   6. В кабинете не было входа в настройки.
 *
 * ГЛАВНОЕ ПРАВИЛО, КОТОРОЕ ДЕРЖИТ ВЕСЬ ФАЙЛ: кабинет не имеет права требовать
 * входа, чтобы показать то, что у учителя и так есть на устройстве. Отсюда:
 *   - `hasServerSession()` проверяется ДО запроса — анонимный учитель не видит
 *     ни мигания «Загрузка», ни 401 в консоли, его данные читаются с устройства;
 *   - любая ошибка сервера (401/5xx/обрыв) НЕ превращается в отказ: читаем
 *     устройство и помечаем, что эти материалы живут только здесь;
 *   - экран «недоступно» с кнопкой «Попробовать ещё раз» появляется только
 *     когда показать нечего: сервер молчит И на устройстве пусто.
 * Источник по умолчанию — сервер для залогиненного, устройство для анонимного
 * и при недоступности сервера.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { FormsTab } from "@/components/teacher/FormsTab";
import { useToast } from "@/components/ui/Toast";
import {
  getFavorites,
  getHistory,
  getProfile,
  removeFromHistory,
  toggleFavorite,
  saveFavorite,
  removeFavorite,
  signOut,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import {
  hasServerSession,
  loadFavorites,
  loadHistoryPage,
  loadTemplates,
  DEVICE_ONLY_NOTE,
  NOTE_DEGRADED,
} from "@/lib/lk/materials-source";
import {
  applyHistoryView,
  countLabel,
  dateGroupLabel,
  EMPTY_FILTERS,
  gradesOf,
  groupByDate,
  isFilterActive,
  kindsOf,
  kindLabel,
  subjectsOf,
  type HistoryFilters,
} from "@/lib/lk/history-view";
import { MATERIAL_KIND_LABEL, type HistoryItem } from "@/lib/lk/types";
import { addFavoriteRemote, removeFavoriteRemote } from "@/lib/lk/materials-api";
import { removeTemplateEverywhere } from "@/lib/lk/templates";
import type {
  UserTemplate,
  UserProfile,
  UserHistoryItem,
  SubjectSlug,
} from "@/lib/types";
import {
  Sparkles,
  History,
  Heart,
  LayoutTemplate,
  User,
  LogOut,
  Trash2,
  ArrowRight,
  Send,
  Camera,
  ClipboardList,
  Download,
  Search,
  Settings,
  X,
  AlertCircle,
  RotateCcw,
  Gamepad2,
  MessageCircleQuestion,
} from "lucide-react";
import Link from "next/link";
import { ShareFormDialog } from "@/components/teacher/ShareFormDialog";
// `timeAgo` и `plural` убраны вместе с плиткой «С нами» (ТЗ-32, D4) —
// больше нигде в файле не используются.
import { pluralizeTasks } from "@/lib/utils/cn";
import { PLANS, priceShort } from "@/lib/content/plans";
import { getSubject } from "@/lib/content/subjects";
import { trackEvent } from "@/lib/track";
import { UsageCard, type UsagePayload } from "@/components/shared/UsageCard";
import { FREE_QUOTA_SCOPE_NOTE } from "@/lib/content/landing-seo";
import { fetchUsage, signOutFromApi } from "@/lib/auth/api";

/** Размер порции истории: 20 карточек, дальше — «Показать ещё». */
const PAGE_SIZE = 20;

/**
 * Любой артефакт, который может лежать в истории: `FavoriteArtifact` плюс
 * карточки и комплекты. Им заполняется поле `artifact` у последних записей
 * истории (см. `ARTIFACT_KEEP` в `utils/storage.ts`).
 */
type StoredArtifact = NonNullable<UserHistoryItem["artifact"]>;

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  // Остаток нормы тарифа. Считает сервер (взвешенные токены), клиент только
  // показывает. null = не пришло/не залогинен, тогда карточка не рисуется.
  const [usage, setUsage] = React.useState<UsagePayload | null>(null);
  const [usageLoading, setUsageLoading] = React.useState(true);
  const [tab, setTab] = React.useState("history");

  /* ─── История: сервер ⇄ устройство, постранично ────────────────────────── */

  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [historyState, setHistoryState] = React.useState<
    "loading" | "data" | "empty" | "unavailable"
  >("loading");
  /** true = показаны данные с устройства, потому что сервер не ответил. */
  const [historyDegraded, setHistoryDegraded] = React.useState(false);
  const [historyCursor, setHistoryCursor] = React.useState<string | null>(null);
  const [historyMoreLoading, setHistoryMoreLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState(false);

  const [query, setQuery] = React.useState("");
  /**
   * Какой лист учитель выдаёт классу из кабинета. Само задание сервер
   * возьмёт из листа по id, поэтому здесь только данные для шапки.
   */
  const [shareTarget, setShareTarget] = React.useState<{
    id: string;
    title: string;
    subject: string;
    grade: number;
  } | null>(null);
  const [filters, setFilters] = React.useState<HistoryFilters>(EMPTY_FILTERS);

  /* ─── Избранное и шаблоны ──────────────────────────────────────────────── */

  const [favorites, setFavorites] = React.useState<FavoriteArtifact[]>([]);
  const [favoriteRemoteIds, setFavoriteRemoteIds] = React.useState<Map<string, string>>(
    new Map(),
  );
  const [favState, setFavState] = React.useState<
    "loading" | "data" | "empty" | "unavailable"
  >("loading");
  const [favDegraded, setFavDegraded] = React.useState(false);
  const [favError, setFavError] = React.useState(false);

  const [templates, setTemplates] = React.useState<UserTemplate[]>([]);
  const [tplState, setTplState] = React.useState<
    "loading" | "data" | "empty" | "unavailable"
  >("loading");
  const [tplDegraded, setTplDegraded] = React.useState(false);
  const [tplError, setTplError] = React.useState(false);

  React.useEffect(() => {
    setProfile(getProfile());
  }, []);

  /**
   * Загрузка первой порции истории.
   *
   * Для анонимного учителя запрос к серверу не уходит вовсе (проверка сессии
   * внутри `loadHistoryPage`) — сразу читается устройство, поэтому вкладка не
   * мигает «Загрузка» и в консоли нет 401.
   */
  const loadHistory = React.useCallback(async () => {
    setHistoryState((prev) => (prev === "data" ? prev : "loading"));
    setHistoryError(false);
    const res = await loadHistoryPage({ limit: PAGE_SIZE });
    setHistory(res.items);
    setHistoryCursor(res.nextCursor);
    setHistoryDegraded(res.degraded);
    setHistoryState(res.state);
  }, []);

  const loadFav = React.useCallback(async () => {
    setFavState((prev) => (prev === "data" ? prev : "loading"));
    setFavError(false);
    const res = await loadFavorites();
    setFavorites(res.items);
    setFavoriteRemoteIds(res.remoteIds);
    setFavDegraded(res.degraded);
    setFavState(res.state);
  }, []);

  const loadTpl = React.useCallback(async () => {
    setTplState((prev) => (prev === "data" ? prev : "loading"));
    setTplError(false);
    const res = await loadTemplates();
    setTemplates(res.items);
    setTplDegraded(res.degraded);
    setTplState(res.state);
  }, []);

  React.useEffect(() => {
    void loadHistory();
    void loadFav();
    void loadTpl();
    trackEvent("dashboard_view", { session: hasServerSession() ? "server" : "device" });
  }, [loadHistory, loadFav, loadTpl]);

  // Норма приходит с сервера. Ошибка здесь НЕ должна ломать кабинет:
  // карточка просто не рисуется, остальное работает как раньше.
  //
  // Б-9: гостю запрос уходил всегда и всегда получал 401. Экран при этом жил,
  // но в консоли у каждого нового посетителя висела ошибка 401 — на ровном
  // месте. Эндпоинт требует входа, поэтому без сессии его не зовём вовсе:
  // поведение экрана прежнее (usage = null, карточка не рисуется), а лишней
  // ошибки в консоли нет.
  React.useEffect(() => {
    if (!hasServerSession()) {
      setUsageLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const u = await fetchUsage();
        if (!cancelled && u) setUsage(u);
      } catch {
        // Тишина — см. комментарий выше.
      } finally {
        if (!cancelled) setUsageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTabChange = (next: string) => {
    setTab(next);
    // ТЗ-21, блок 3: сколько вкладок реально открывают, а какие остаются
    // нетронутыми функцией-призраком.
    trackEvent("dashboard_subsection_entered", { subsection: next });
  };

  /** Догрузить следующую порцию истории («Показать ещё»). */
  const handleLoadMore = async () => {
    if (!historyCursor || historyMoreLoading) return;
    setHistoryMoreLoading(true);
    const res = await loadHistoryPage({ cursor: historyCursor, limit: PAGE_SIZE });
    setHistory((prev) => {
      // Курсор сервера возвращает новую порцию; устройство — следующий срез.
      // Дубли схлопываем по id, чтобы «Показать ещё» не показывал дубли.
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
    });
    setHistoryCursor(res.nextCursor);
    setHistoryMoreLoading(false);
  };

  /* ─── Действия с карточками ────────────────────────────────────────────── */

  const handleRemove = (id: string) => {
    removeFromHistory(id);
    setHistory((prev) => prev.filter((i) => i.id !== id));
    if (history.length <= 1) setHistoryState("empty");
    toast({ tone: "info", title: "Удалено из истории" });
  };

  /**
   * Избранное. Локальная запись идёт ВСЕГДА (чтобы материал не потерялся и
   * был виден анонимно), серверная — дополнительно, когда есть сессия и
   * артефакт является рабочим листом: только такие бэк и принимает.
   */
  const handleToggleFav = async (item: HistoryItem) => {
    const artifact = findLocalArtifact(item.id);
    if (item.isFavorite) {
      removeFavorite(item.id);
      const remoteId = favoriteRemoteIds.get(item.id);
      if (remoteId) await removeFavoriteRemote(remoteId);
      setFavorites((prev) => prev.filter((f) => f.id !== item.id));
      setHistory((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, isFavorite: false } : i))
      );
      return;
    }
    // Флаг в истории синхронизируется всегда; полный артефакт — когда он есть.
    toggleFavorite(item.id, artifact ?? undefined);
    if (artifact) {
      saveFavorite(artifact);
      setFavorites((prev) => [...prev, artifact]);
    }
    setHistory((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, isFavorite: true } : i))
    );
    // Сервер умеет хранить избранным только рабочий лист.
    if (artifact && "tasks" in artifact && hasServerSession()) {
      const res = await addFavoriteRemote(artifact);
      if (res.ok) {
        setFavoriteRemoteIds((prev) => {
          const next = new Map(prev);
          next.set(artifact.id, res.data.favoriteId);
          return next;
        });
      }
    }
  };

  const handleRemoveFavorite = async (artifact: FavoriteArtifact) => {
    removeFavorite(artifact.id);
    setFavorites((prev) => prev.filter((f) => f.id !== artifact.id));
    const remoteId = favoriteRemoteIds.get(artifact.id);
    if (remoteId) await removeFavoriteRemote(remoteId);
    trackEvent("dashboard_artifact_downloaded", { action: "unfavorite" });
    toast({ tone: "info", title: "Удалено из избранного" });
  };

  const handleRemoveTemplate = async (id: string) => {
    await removeTemplateEverywhere(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (templates.length <= 1) setTplState("empty");
    toast({ tone: "info", title: "Шаблон удалён" });
  };

  const handleUseTemplate = (t: UserTemplate) => {
    trackEvent("dashboard_use_template", { subject: t.subject, grade: t.grade });
    const params = new URLSearchParams({
      subject: t.subject,
      grade: String(t.grade),
      topic: t.topic,
      difficulty: t.difficulty,
      count: String(t.count),
    });
    router.push(`/constructor?${params}`);
  };

  /**
   * Выход — логический И серверный.
   *
   * Раньше здесь был только локальный выход: кабинет закрывался на экране, а
   * сессия на сервере жила. Cookie оставалась в браузере, и на том же
   * компьютере кабинет открывался снова — «Выйти» закрывал дверь, не вынимая
   * ключ. Для учителя, который закрывает доступ на чужом столе перед уходом,
   * это ровно тот случай, ради которого пароль и заводится. Проверено на живом
   * сайте 12.10.2026.
   *
   * Порядок такой:
   * 1. локально выходим сразу — интерфейс не должен ждать сеть;
   * 2. серверную сессию снимаем обязательно, но не бесконечно: если связь
   *    пропала молча, запрос может висеть дольше, чем человек готов ждать
   *    кнопку «Выйти», поэтому ждём не дольше 4 секунд и уходим в любом
   *    случае. Запрос при этом не прерывается — если сервер жив, он дойдёт.
   *
   * Вариант из origin/main ждал сервер без ограничения: при пропаже сети
   * кнопка «Выйти» висела бы бесконечно. Отсюда и порядок — локально сразу,
   * сервер параллельно и с потолком.
   */
  const handleSignOut = async () => {
    signOut();    signOut();
    await Promise.race([
      signOutFromApi(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);
    router.push("/");
    toast({ tone: "info", title: "Вы вышли из аккаунта" });
  };

  /* ─── Производные данные для истории ────────────────────────────────────── */

  const visibleHistory = React.useMemo(
    () => applyHistoryView(history, query, filters),
    [history, query, filters]
  );
  const groups = React.useMemo(
    () => groupByDate(visibleHistory),
    [visibleHistory]
  );
  const filterActive = isFilterActive(filters) || query.trim() !== "";

  // Плитки «С нами» больше нет (ТЗ-32, D4). Не «сегодня» и не «пока нет
  // данных»: показывать учителю срок, который ничего не решает, незачем, а
  // прочерк у нового посетителя читается как недогрузилось. Метрика удалена
  // вместе с плиткой, а не спрятана под настройку.

  // ЗДЕСЬ БОЛЬШЕ НЕТ СТЕНЫ «ВОЙДИТЕ, ЧТОБЫ УВИДЕТЬ ИСТОРИЮ».
  //
  // Стену убрали целиком, а не сузили до «пока нет ни одного материала». Причина:
  // профиль создаётся только при входе, а лист, избранное и шаблон анонимный
  // учитель создаёт БЕЗ входа. Значит условие `if (!profile)` ловило в том числе
  // учителя с 12 своими листами: он открывал кабинет и видел требование войти,
  // хотя история лежала в этом же браузере. Это ровно тот дефект, который ТЗ-21
  // запрещает — требовать вход, чтобы показать то, что уже есть.
  //
  // Теперь кабинет открыт всегда. Совсем новому посетителю он показывает пустые
  // вкладки с действиями («Создать первый лист»), а не требование зарегистрироваться.
  // Вход предлагается, но не как условие доступа. Разница между анонимом и
  // залогиненным одна и проговаривается прямо: «хранится на этом устройстве».

  return (
    <div className="container-tight py-8 sm:py-12">
      <ProfileHeader profile={profile} onSignOut={handleSignOut} />

      <StatsRow
        history={history}
        favorites={favorites}
        templates={templates}
      />

      {/* Остаток нормы: для free — сколько осталось бесплатных генераций,
          для base/plus — взвешенные токены + «≈ N листов». При превышении
          показывает предложение, а не блокировку: порог мягкий. */}
      <div className="mt-6">
        <UsageCard usage={usage} loading={usageLoading} />
        {/* Блок Ф: счётчик сам по себе не говорит, на что тратятся
            генерации. UsageCard общий — правим строку здесь, рядом с ним.
            Текст общий с лендингом и `/oge/` (FREE_QUOTA_SCOPE_NOTE).
            Показываем только там, где квота вообще применяется: на base/plus
            её нет, и строка про «3 генерации» была бы шумом. */}
        {usage?.plan === "free" && (
          <p className="mt-2 text-xs text-warm-500">{FREE_QUOTA_SCOPE_NOTE}</p>
        )}
      </div>

      {/* F-06.1: точка входа в проверку домашки из ЛК.
          Ведёт в конструктор с `?photo=1` — секция проверки раскрывается сразу.
          Отдельная карточка, а не ещё одна кнопка в шапке: у учителя два разных
          намерения — «создать лист» и «проверить, что ученик сделал сам». */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-xl bg-accent-50 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5 text-accent-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-warm-950">
                Проверить домашку и задать вопросы
              </h2>
              <p className="text-sm text-warm-600 mt-1">
                Сфотографируйте тетрадь — будет балл и оценка. Если что-то
                вызывает вопросы, составьте 3–5 вопросов для беседы с учеником.
              </p>
            </div>
          </div>
          <Button as="link" href="/constructor?photo=1" variant="secondary" size="md">
            Проверить фото
          </Button>
        </div>
      </Card>

      {/* Журнал проверок (ТЗ-19). Отдельная карточка рядом с фото-проверкой,
          а не ещё одна кнопка в той же: это другое намерение — не «проверить
          сейчас», а «вспомнить, что я уже проверил». Без неё результаты
          проверок остаются вкладкой, которую закрыли. */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-warm-950">Журнал проверок</h2>
              <p className="text-sm text-warm-600 mt-1">
                Все ранее проверенные работы с отметками — и меткой, кто их поставил: ИИ
                или вы.
              </p>
            </div>
          </div>
          <Button as="link" href="/journal" variant="secondary" size="md">
            Открыть журнал
          </Button>
        </div>
      </Card>

      {/* Интерактивы. 15.10.2026.

          ЗАЧЕМ ЭТА КАРТОЧКА. На главной есть блок «Лист превращается в игру»
          со ссылкой на /dashboard/interactives, а из кабинета туда не было
          входа вообще: ни в одной из четырёх вкладок. То есть мы сами
          предлагали учителю кликнуть туда, куда из кабинета не попасть.

          ПОЧЕМУ ОТДЕЛЬНОЙ КАРТОЧКОЙ, А НЕ ПЯТОЙ ВКЛАДКОЙ. Вкладки читаются
          как «где лежат мои материалы». Интерактив — это не место хранения,
          а способ работы с листом, как проверка по фото и журнал. Он должен
          стоять рядом с ними, а не прятаться за счётчиком вкладки. */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-xl bg-warm-100 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-5 h-5 text-warm-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-warm-950">
                Игра для класса
              </h2>
              <p className="text-sm text-warm-600 mt-1">
                Из готового листа собирается игра: ученик отвечает с телефона, вы видите
                время на ответ и сводку по классу.
              </p>
            </div>
          </div>
          <Button as="link" href="/dashboard/interactives" variant="secondary" size="md">
            Открыть игры
          </Button>
        </div>
      </Card>

      {/* Что кабинет умеет. 15.10.2026.

          ЗАЧЕМ. Пустой кабинет показывал три счётчика в нуле и надпись
          «История пуста». Это честно, но бесполезно: учитель не знает, что
          кабинет вообще для чего. Главная про это рассказывает — но решение
          на главной принимают до регистрации, а в кабинет человек приходит
          уже с листом и хочет понять, что с ним делать дальше.

          ПОКАЗЫВАЕМ ТОЛЬКО КОГДА ПУСТО. С листами этот блой — шум. Исчезает
          сам, как только появляется первая запись. */}
      {historyState === "empty" && <CabinetGuide />}

      <Tabs value={tab} onValueChange={handleTabChange} className="mt-10">
        <TabsList>
          <TabsTrigger value="history">
            <History className="w-3.5 h-3.5 mr-1.5" />
            История · {history.length}
          </TabsTrigger>
          <TabsTrigger value="favorites">
            <Heart className="w-3.5 h-3.5 mr-1.5" />
            Избранное · {favorites.length}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutTemplate className="w-3.5 h-3.5 mr-1.5" />
            Шаблоны · {templates.length}
          </TabsTrigger>
          {/* TZ-12: первая серверная вкладка. Остальные три живут в localStorage,
              формы — на сервере, поэтому вкладка своя и грузится отдельно. */}
          <TabsTrigger value="forms" data-testid="tab-forms">
            <Send className="w-3.5 h-3.5 mr-1.5" />
            Выданное
          </TabsTrigger>
        </TabsList>

        {/* ─── История ─────────────────────────────────────────────────────── */}
        <TabsContent value="history">
          {/* Одна ненавязчивая пометка на всю вкладку: данные только здесь. */}
          {historyDegraded && <DeviceOnlyNote degraded onRetry={() => void loadHistory()} />}

          {historyState === "loading" && <TabSkeleton label="Загружаем историю…" />}

          {historyState === "unavailable" && (
            <TabError
              title="Не удалось показать историю"
              description="Кабинет не ответил, и на этом устройстве пока ничего не сохранено. Попробуйте ещё раз — если интернета нет, материалы появятся после подключения."
              onRetry={() => void loadHistory()}
            />
          )}

          {historyState === "empty" && (
            <EmptyTab
              icon={History}
              title="История пуста"
              description="Здесь появятся все листы, которые вы создали, — с поиском по названию и теме."
              action={
                <Button as="link" href="/constructor" variant="primary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
                  Создать первый лист
                </Button>
              }
            />
          )}

          {historyState === "data" && (
            <>
              <HistoryToolbar
                query={query}
                onQueryChange={setQuery}
                filters={filters}
                onFiltersChange={setFilters}
                items={history}
                resultCount={visibleHistory.length}
              />

              {visibleHistory.length === 0 ? (
                <EmptyTab
                  icon={Search}
                  title="Ничего не нашлось"
                  description="Под ваш запрос не подошёл ни один материал. Попробуйте другое слово или сбросьте фильтры."
                  action={
                    <Button
                      variant="secondary"
                      size="md"
                      leftIcon={<RotateCcw className="w-4 h-4" />}
                      onClick={() => {
                        setQuery("");
                        setFilters(EMPTY_FILTERS);
                      }}
                    >
                      Сбросить поиск и фильтры
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-8" data-testid="history-groups">
                  {groups.map((group) => (
                    <section key={group.label} data-testid="history-group">
                      <h3 className="text-sm font-semibold text-warm-600 mb-3 flex items-center gap-2">
                        {group.label}
                        <span className="text-warm-400 font-normal">
                          {group.items.length}
                        </span>
                      </h3>
                      {/* Компактная сетка: на мобильном карточка занимает одну
                          строку, а не половину экрана. На 13" Air лента из
                          12 карточек теперь прокручивается двумя экранами. */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {group.items.map((item) => (
                          <HistoryCard
                            key={item.id}
                            item={item}
                            onRemove={() => handleRemove(item.id)}
                            onToggleFav={() => void handleToggleFav(item)}
                            onDownload={() => {
                              trackEvent("dashboard_artifact_downloaded", {
                                kind: item.type,
                                from: "history",
                              });
                              window.print();
                            }}
                            onShare={() => setShareTarget({
                              id: item.id,
                              title: item.title,
                              subject: item.subject as string,
                              grade: item.grade ?? 5,
                            })}
                          />
                        ))}
                      </div>
                    </section>
                  ))}

                  {historyCursor && (
                    <div className="flex justify-center">
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => void handleLoadMore()}
                        loading={historyMoreLoading}
                      >
                        Показать ещё
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── Избранное ───────────────────────────────────────────────────── */}
        <TabsContent value="favorites">
          {favDegraded && <DeviceOnlyNote degraded onRetry={() => void loadFav()} />}

          {favState === "loading" && <TabSkeleton label="Загружаем избранное…" />}

          {favState === "unavailable" && (
            <TabError
              title="Не удалось показать избранное"
              description="Кабинет не ответил. Попробуйте ещё раз."
              onRetry={() => void loadFav()}
            />
          )}

          {favState === "empty" && (
            <EmptyTab
              icon={Heart}
              title="Нет избранных листов"
              description="Нажмите на сердечко в истории — материал сохранится здесь и не потеряется при следующем заходе."
              action={
                <Button as="link" href="/constructor" variant="primary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
                  Создать лист
                </Button>
              }
            />
          )}

          {favState === "data" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {favorites.map((artifact) => (
                <FavoriteCard
                  key={artifact.id}
                  artifact={artifact}
                  onRemove={() => void handleRemoveFavorite(artifact)}
                  onDownload={() => {
                    trackEvent("dashboard_artifact_downloaded", {
                      from: "favorites",
                    });
                    window.print();
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Шаблоны ─────────────────────────────────────────────────────── */}
        <TabsContent value="templates">
          {tplDegraded && <DeviceOnlyNote degraded onRetry={() => void loadTpl()} />}

          {tplState === "loading" && <TabSkeleton label="Загружаем шаблоны…" />}

          {tplState === "unavailable" && (
            <TabError
              title="Не удалось показать шаблоны"
              description="Кабинет не ответил. Попробуйте ещё раз."
              onRetry={() => void loadTpl()}
            />
          )}

          {tplState === "empty" && (
            <EmptyTab
              icon={LayoutTemplate}
              title="Нет шаблонов"
              description="Шаблон — это готовая настройка: предмет, класс, тема и число заданий. Сохраните удачный лист кнопкой «Как шаблон» прямо в конструкторе — и повторяйте его в один клик."
              action={
                <Button as="link" href="/constructor" variant="primary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
                  Создать лист и сохранить как шаблон
                </Button>
              }
            />
          )}

          {tplState === "data" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onUse={() => handleUseTemplate(t)}
                  onRemove={() => void handleRemoveTemplate(t.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="forms">
          <FormsTab />
        </TabsContent>
      </Tabs>

      {/* Выдача листа, выбранного в истории. Модалка одна на все карточки —
          открывается та, по которой кликнули. */}
      <ShareFormDialog
        open={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        worksheetId={shareTarget?.id}
        title={shareTarget?.title ?? ""}
        subject={shareTarget?.subject ?? ""}
        grade={shareTarget?.grade ?? 5}
      />
    </div>
  );
}

/* ─── Мелкие помощники страницы ───────────────────────────────────────────── */

/**
 * Ищет полный артефакт среди локальных хранилищ.
 *
 * Нужен для избранного: сервер принимает туда только рабочий лист, а значит
 * нужно передать ему тело, а не id.
 */
/**
 * Полный артефакт из локальных хранилищ, если он вообще есть.
 *
 * В истории лежат все типы (включая карточки и комплекты), а локальное
 * избранное умеет хранить только четыре «превью-совместимых» типа, и сервер
 * принимает туда только рабочий лист. Поэтому наверх отдаётся лишь то, что
 * можно положить в избранное, — остальные типы учитель всё равно откроет и
 * скачает, просто без записи в избранное.
 */
function findLocalArtifact(id: string): FavoriteArtifact | null {
  const candidate =
    getFavorites().find((a) => a.id === id) ??
    getHistory().find((h) => h.id === id)?.artifact ??
    null;
  return isStorableInFavorites(candidate) ? candidate : null;
}

/** Отсекает карточки/комплекты: их локальное избранное не поддерживает. */
function isStorableInFavorites(a: StoredArtifact | null): a is FavoriteArtifact {
  return (
    a !== null &&
    ("tasks" in a || "stages" in a || "slides" in a || "weeks" in a)
  );
}

// `daysWithUs` удалён вместе с плиткой «С нами» (ТЗ-32, D4). Метрика без
// плитки — мёртвый код, который однажды посчитает не то, что показывает.

// =============== Profile ===============

function ProfileHeader({
  profile,
  onSignOut,
}: {
  profile: UserProfile | null;
  onSignOut: () => void;
}) {
  const planBadge =
    profile &&
    {
      free: { tone: "neutral" as const, label: "Бесплатный план" },
      base: { tone: "brand" as const, label: `${PLANS.base.name} · ${priceShort("base", "month")}` },
      standard: { tone: "brand" as const, label: `${PLANS.standard.name} · ${priceShort("standard", "month")}` },
      plus: { tone: "accent" as const, label: `${PLANS.plus.name} · ${priceShort("plus", "month")}` },
    }[profile.plan];

  // Анонимный учитель (профиля в браузере нет, но материалы есть) — не заглушка:
  // имени у него нет, и называть его «Мария» было бы враньём. Зато у него есть его
  // собственные листы, и кабинет их показывает.
  const displayName = profile?.name ?? "Мои материалы";
  const initial = profile ? profile.name.charAt(0).toUpperCase() : "?";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-warm-200">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white grid place-items-center text-xl font-bold">
          {initial}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-display font-bold text-warm-950">{displayName}</h1>
            {planBadge && <Badge tone={planBadge.tone}>{planBadge.label}</Badge>}
          </div>
          <p className="text-sm text-warm-500 mt-0.5">
            {profile ? profile.email : "хранятся на этом устройстве"}
          </p>
        </div>
      </div>
      {/* ТЗ-21: вход в настройки. Страницу настроек делает другой разработчик,
          поэтому здесь только ссылка — она заработает, как только страница
          появится, и не блокирует ничего до этого момента. */}
      <div className="flex items-center gap-2">
        <Button as="link" href="/dashboard/settings" variant="ghost" size="md" leftIcon={<Settings className="w-4 h-4" />}>
          Настройки
        </Button>
        {profile ? (
          <Button variant="ghost" size="md" onClick={onSignOut} leftIcon={<LogOut className="w-4 h-4" />}>
            Выйти
          </Button>
        ) : (
          // Не «Выйти» — анониму не из чего выходить, и кнопка с таким словом
          // вводила бы в заблуждение. Предлагаем вход, он необязателен.
          <Button as="link" href="/login" variant="ghost" size="md" leftIcon={<User className="w-4 h-4" />}>
            Войти
          </Button>
        )}
      </div>
    </div>
  );
}

// =============== Stats ===============

function StatsRow({
  history,
  favorites,
  templates,
}: {
  history: HistoryItem[];
  favorites: FavoriteArtifact[];
  templates: UserTemplate[];
}) {
  const items = [
    {
      icon: Sparkles,
      label: "Сгенерировано",
      value: String(history.length),
      color: "text-brand-600",
    },
    {
      icon: Heart,
      label: "В избранном",
      value: String(favorites.length),
      color: "text-accent-600",
    },
    {
      icon: LayoutTemplate,
      label: "Шаблонов",
      value: String(templates.length),
      color: "text-blue-600",
    },
  ];

  return (
    // Сетка на 3 колонки, а не на 4: плиток стало три, и при `sm:grid-cols-4`
    // четвёртая ячейка осталась бы пустым провалом справа (ТЗ-32, D4).
    // На телефоне две колонки и третья плитка встаёт в ряд сама.
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
      {items.map((it) => (
        <Card key={it.label} padded={false} className="p-4 sm:p-5">
          <div className={`w-9 h-9 rounded-lg bg-warm-100 grid place-items-center mb-2 ${it.color}`}>
            <it.icon className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-warm-950">{it.value}</div>
          <div className="text-xs text-warm-500 mt-0.5">{it.label}</div>
        </Card>
      ))}
    </div>
  );
}

// =============== History toolbar ===============

/**
 * Поиск и фильтры истории (ТЗ-21, блок 3).
 *
 * Список предметов и классов строится по фактическим данным, а не по всему
 * справочнику: учителю не нужно выбирать из пустого списка.
 */
function HistoryToolbar({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  items,
  resultCount,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  filters: HistoryFilters;
  onFiltersChange: (f: HistoryFilters) => void;
  items: HistoryItem[];
  resultCount: number;
}) {
  const subjects = subjectsOf(items);
  const grades = gradesOf(items);
  const kinds = kindsOf(items);
  const active = isFilterActive(filters);

  const reportFilter = (patch: Partial<HistoryFilters>) => {
    onFiltersChange({ ...filters, ...patch });
    trackEvent("dashboard_filter_used", {
      field: Object.keys(patch)[0],
      value: Object.values(patch)[0],
    });
  };

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Поиск по названию или теме"
            aria-label="Поиск по названию или теме"
            data-testid="history-search"
            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-warm-200 bg-white text-warm-950 placeholder:text-warm-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <span className="text-xs text-warm-500 tabular-nums">
          {resultCount} из {items.length}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.subject}
          onChange={(e) => reportFilter({ subject: e.target.value })}
          aria-label="Предмет"
          data-testid="filter-subject"
          className="px-3 py-2 text-sm rounded-lg border border-warm-200 bg-white text-warm-800 focus:border-brand-400 focus:outline-none"
        >
          <option value="">Все предметы</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={filters.grade === null ? "" : String(filters.grade)}
          onChange={(e) =>
            reportFilter({ grade: e.target.value ? Number(e.target.value) : null })
          }
          aria-label="Класс"
          data-testid="filter-grade"
          className="px-3 py-2 text-sm rounded-lg border border-warm-200 bg-white text-warm-800 focus:border-brand-400 focus:outline-none"
        >
          <option value="">Все классы</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g} класс
            </option>
          ))}
        </select>

        <select
          value={filters.kind ?? ""}
          onChange={(e) =>
            reportFilter({ kind: e.target.value ? (e.target.value as HistoryFilters["kind"]) : null })
          }
          aria-label="Тип материала"
          data-testid="filter-kind"
          className="px-3 py-2 text-sm rounded-lg border border-warm-200 bg-white text-warm-800 focus:border-brand-400 focus:outline-none"
        >
          <option value="">Все типы</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {MATERIAL_KIND_LABEL[k]}
            </option>
          ))}
        </select>

        {active && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="w-3.5 h-3.5" />}
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          >
            Сбросить фильтры
          </Button>
        )}
      </div>
    </div>
  );
}

// =============== History card ===============

/**
 * Карточка материала в истории.
 *
 * Узнаваемость вместо эмодзи (ТЗ-21, блок 3): раньше карточка отличалась
 * только эмодзи предмета, поэтому лист по математике и тест по математике
 * выглядели одинаково. Теперь сверху — тип материала текстом, рядом —
 * предмет, класс и размер («12 заданий»), а PDF скачивается прямо отсюда.
 */
function HistoryCard({
  item,
  onRemove,
  onToggleFav,
  onDownload,
  onShare,
}: {
  item: HistoryItem;
  onRemove: () => void;
  onToggleFav: () => void;
  onDownload: () => void;
  onShare: () => void;
}) {
  const subject = getSubject(item.subject as SubjectSlug);
  const count = countLabel(item);

  return (
    <Card padded={false} hover className="overflow-hidden h-full flex flex-col" data-testid="history-card">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="w-10 h-10 rounded-xl bg-warm-100 grid place-items-center text-xl shrink-0">
          {subject?.emoji ?? "📄"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Тип материала — главный признак карточки. */}
            <Badge tone="brand">{kindLabel(item)}</Badge>
            {count && <span className="text-xs text-warm-500">{count}</span>}
          </div>
          <h3 className="font-semibold text-sm text-warm-950 line-clamp-2 mt-1.5">
            {item.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-warm-500 flex-wrap">
            <span>{subject?.shortTitle ?? item.subject}</span>
            {item.grade && <span>· {item.grade} класс</span>}
            <span>· {dateGroupLabel(item.createdAt)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleFav}
          aria-label={item.isFavorite ? "Убрать из избранного" : "В избранное"}
          className="shrink-0 w-8 h-8 rounded-full grid place-items-center hover:bg-warm-100 transition"
        >
          <Heart
            className={`w-4 h-4 ${
              item.isFavorite ? "fill-accent-500 text-accent-500" : "text-warm-600"
            }`}
          />
        </button>
      </div>
      <div className="mt-auto flex items-center gap-1.5 px-4 pb-4">
        {/* Выдать классу прямо из кабинета. Раньше кнопка жила только в
            конструкторе, и лист, сделанный вчера, было негде выдать: из
            истории вели только «Открыть» в предпросмотр, где такой кнопки
            нет. Забытый лист в итоге нельзя было отдать классу вообще. */}
        {item.type === "worksheet" && (
          <Button
            variant="primary"
            size="sm"
            fullWidth
            onClick={onShare}
            leftIcon={<Send className="w-4 h-4" />}
            data-testid="history-share"
          >
            Выдать классу
          </Button>
        )}
        <Button
          as="link"
          href={`/preview?id=${encodeURIComponent(item.id)}`}
          variant="secondary"
          size="sm"
          className={item.type === "worksheet" ? "shrink-0" : "flex-1"}
        >
          Открыть
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownload}
          aria-label="Скачать PDF"
          data-testid="download-pdf"
          className="shrink-0 w-9 px-0"
        >
          <Download className="w-4 h-4" />
        </Button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 w-9 h-9 rounded-lg grid place-items-center text-warm-600 hover:text-rose-500 hover:bg-rose-50 transition-colors"
          aria-label="Удалить"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </Card>
  );
}

// =============== Favorite card ===============

function FavoriteCard({
  artifact,
  onRemove,
  onDownload,
}: {
  artifact: FavoriteArtifact;
  onRemove: () => void;
  onDownload: () => void;
}) {
  // F-06 B-4: карточка рендерится для всех 4 типов артефактов,
  // показываем релевантные метаданные (заголовок + короткое summary).
  const summary = describeArtifact(artifact);

  return (
    <Card hover className="h-full flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge tone="brand">Избранное</Badge>
          <Badge tone="neutral">{kindLabelOfArtifact(artifact)}</Badge>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="w-7 h-7 rounded-lg grid place-items-center text-warm-600 hover:text-rose-500 hover:bg-rose-50 transition-colors"
          aria-label="Удалить"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <h3 className="font-semibold text-warm-950">{artifact.title}</h3>
      <p className="text-sm text-warm-500 mt-0.5">
        {artifact.subject} · {artifact.grade} класс · {summary.line}
      </p>
      <div className="mt-3 text-xs text-warm-600 line-clamp-2">
        {summary.preview}
      </div>
      <div className="mt-auto pt-4 flex items-center gap-1.5">
        <Button
          as="link"
          href={`/preview?id=${encodeURIComponent(artifact.id)}`}
          variant="secondary"
          size="sm"
          rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          fullWidth
        >
          Открыть
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownload}
          aria-label="Скачать PDF"
          className="shrink-0 w-9 px-0"
        >
          <Download className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}

/** Тип артефакта текстом — тот же словарь, что и в истории. */
function kindLabelOfArtifact(a: FavoriteArtifact): string {
  if ("tasks" in a) return MATERIAL_KIND_LABEL.worksheet;
  if ("stages" in a) return MATERIAL_KIND_LABEL["lesson-plan"];
  if ("slides" in a) return MATERIAL_KIND_LABEL.presentation;
  if ("weeks" in a) return MATERIAL_KIND_LABEL.ktp;
  return MATERIAL_KIND_LABEL.other;
}

/**
 * Возвращает «{count, line}» и короткий текст-превью для дашбордной карточки.
 * Безопасно работает с любым из 4 типов артефактов (discriminated union).
 */
function describeArtifact(a: FavoriteArtifact): { line: string; preview: string } {
  if ("tasks" in a) {
    return {
      // Склонение, а не жёсткое «заданий»: один лист читался «1 заданий».
      line: `${a.tasks.length} ${pluralizeTasks(a.tasks.length)}`,
      preview: a.tasks[0]?.text ?? "",
    };
  }
  if ("stages" in a) {
    return {
      line: `${a.stages.length} шагов · ${a.stages.reduce((s, st) => s + st.durationMin, 0)} мин`,
      preview: a.stages[0]?.title ?? "",
    };
  }
  if ("slides" in a) {
    return {
      line: `${a.slides.length} слайдов`,
      preview: a.slides[0]?.title ?? "",
    };
  }
  if ("weeks" in a) {
    const totalLessons = a.weeks.reduce((acc, w) => acc + w.entries.length, 0);
    return {
      line: `${a.totalHours} ч · ${a.weeks.length} недель · ${totalLessons} уроков`,
      preview: a.weeks[0]?.entries[0]?.topic ?? "",
    };
  }
  return { line: "", preview: "" };
}

// =============== Template card ===============

function TemplateCard({
  template,
  onUse,
  onRemove,
}: {
  template: UserTemplate;
  onUse: () => void;
  onRemove: () => void;
}) {
  const subject = getSubject(template.subject as SubjectSlug);
  return (
    <Card className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-warm-100 grid place-items-center text-xl shrink-0">
        {subject?.emoji ?? "📄"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-semibold text-warm-950 truncate">{template.name}</h3>
        </div>
        <p className="text-xs text-warm-500">
          {subject?.shortTitle ?? template.subject} · {template.grade} класс ·{" "}
          {template.difficulty === "easy" ? "лёгкая" : template.difficulty === "medium" ? "средняя" : "сложная"} · {template.count} зад.
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" onClick={onUse} leftIcon={<Sparkles className="w-3.5 h-3.5" />}>
            Использовать
          </Button>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-warm-600 hover:text-rose-500 hover:bg-rose-50 transition-colors"
            aria-label="Удалить"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

// =============== Состояния вкладки ===============

/** Состояние 1 из 4: загрузка. Скелетон, а не текст, чтобы не мигало. */
function TabSkeleton({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="tab-loading">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} padded={false} className="p-4">
          <div className="h-4 w-24 rounded bg-warm-100 animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-warm-100 animate-pulse mt-3" />
          <div className="h-3 w-1/2 rounded bg-warm-50 animate-pulse mt-2" />
          <div className="h-8 w-full rounded-lg bg-warm-50 animate-pulse mt-4" />
        </Card>
      ))}
    </div>
  );
}

/**
 * Состояние 2 из 4: недоступно. Показывается ТОЛЬКО когда показать нечего —
 * сервер не ответил и на устройстве пусто. Иначе данные берутся с устройства.
 */
function TabError({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <Card className="text-center py-12" data-testid="tab-unavailable">
      <div className="w-12 h-12 rounded-2xl bg-warm-100 text-warm-500 grid place-items-center mx-auto mb-4">
        <AlertCircle className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-semibold text-warm-950">{title}</h3>
      <p className="text-sm text-warm-500 mt-1.5 max-w-sm mx-auto">{description}</p>
      <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
        <Button variant="primary" size="md" onClick={onRetry} leftIcon={<RotateCcw className="w-4 h-4" />}>
          Попробовать ещё раз
        </Button>
        <Button as="link" href="/constructor" variant="secondary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
          Создать лист
        </Button>
      </div>
    </Card>
  );
}

/** Состояние 3 из 4: пусто. Всегда с действием — тупика быть не должно. */
function EmptyTab({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <Card className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-warm-100 text-warm-500 grid place-items-center mx-auto mb-4">
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="text-lg font-semibold text-warm-950">{title}</h3>
      <p className="text-sm text-warm-500 mt-1.5 max-w-sm mx-auto">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

/**
 * Что кабинет умеет с готовым листом. Показывается только при пустой истории.
 *
 * Тон блока — как на главной (HiddenFeatures): не «мы умеем X», а что
 * учитель получит и куда нажмёт. Каждая карточка ведёт в рабочее место.
 */
function CabinetGuide() {
  const items = [
    {
      href: "/dashboard?tab=forms",
      icon: Send,
      title: "Выдать лист классу",
      description:
        "Ученик заходит по ссылке или QR-коду с телефона, без регистрации. Вы видите, кто выполнил и где ошибся, ответы выгружаете в Excel.",
    },
    {
      href: "/dashboard/interactives",
      icon: Gamepad2,
      title: "Собрать игру из листа",
      description:
        "Задания выходят по одному, ученик отвечает с телефона. Видно время на ответ — сразу видно, кто угадывает.",
    },
    {
      href: "/constructor?photo=1",
      icon: MessageCircleQuestion,
      title: "Задать вопросы для беседы",
      description:
        "После проверки по фото собираются 3–5 вопросов по конкретным заданиям работы. Переписавший у соседа на них не ответит.",
    },
  ];

  return (
    <Card className="mt-4 p-5" data-testid="cabinet-guide">
      <h2 className="font-semibold text-warm-950">Что можно сделать с листом в кабинете</h2>
      <p className="text-sm text-warm-600 mt-1">
        Кабинет не создаёт листы — он хранит их и доводит до учеников.
      </p>
      <div className="grid gap-4 sm:grid-cols-3 mt-4">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="rounded-xl border border-warm-200 bg-warm-50 p-4 transition-colors hover:border-warm-300 hover:bg-warm-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <div className="w-9 h-9 rounded-lg bg-white text-warm-700 grid place-items-center mb-3">
              <it.icon className="w-4 h-4" />
            </div>
            <div className="text-sm font-semibold text-warm-950">{it.title}</div>
            <p className="text-xs text-warm-600 mt-1">{it.description}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** Пометка «данные только на этом устройстве» — одна на вкладку. */
/**
 * Пометка под вкладкой. Два разных случая — и раньше это была одна строка на
 * оба, из-за чего обе формулировки оказывались неверными.
 *
 * 1) `degraded` — сервер не ответил, показываем устройство. Здесь повтор
 *    осмыслен: сеть могла вернуться.
 * 2) обычный случай — входа нет, данные и так только на устройстве.
 *
 * В тексте НЕТ обещания «войдите в аккаунт»: вход по ссылке из письма сейчас
 * выключен (нет домена), и обещать вход, которого нет, — ровно тот дефект,
 * который ТЗ-21 запрещает. Формулировка описывает факт и ничего не сулит.
 */
function DeviceOnlyNote({ degraded = false, onRetry }: { degraded?: boolean; onRetry?: () => void }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-warm-500"
      data-testid="device-only-note"
      data-degraded={degraded ? "1" : undefined}
    >
      <p className="flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
        {degraded ? NOTE_DEGRADED : DEVICE_ONLY_NOTE}
      </p>
      {degraded && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 hover:text-warm-800 shrink-0"
        >
          Попробовать снова
        </button>
      ) : null}
    </div>
  );
}

