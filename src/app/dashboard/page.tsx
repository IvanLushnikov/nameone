"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { FormsTab } from "@/components/teacher/FormsTab";
import { useToast } from "@/components/ui/Toast";
import {
  getHistory,
  getFavorites,
  getTemplates,
  getProfile,
  removeFromHistory,
  toggleFavorite,
  removeFavorite,
  removeTemplate,
  signOut,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import type {
  UserHistoryItem,
  UserTemplate,
  UserProfile,
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
  Calendar,
  Send,
} from "lucide-react";
import { timeAgo } from "@/lib/utils/cn";
import { PLANS, priceShort } from "@/lib/content/plans";
import { getSubject } from "@/lib/content/subjects";
import { trackEvent } from "@/lib/track";
import { UsageCard, type UsagePayload } from "@/components/shared/UsageCard";
import { fetchUsage } from "@/lib/auth/api";

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [history, setHistory] = React.useState<UserHistoryItem[]>([]);
  const [favorites, setFavorites] = React.useState<FavoriteArtifact[]>([]);
  const [templates, setTemplates] = React.useState<UserTemplate[]>([]);
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  // Остаток нормы тарифа. Считает сервер (взвешенные токены), клиент только
  // показывает. null = не пришло/не залогинен, тогда карточка не рисуется.
  const [usage, setUsage] = React.useState<UsagePayload | null>(null);
  const [usageLoading, setUsageLoading] = React.useState(true);
  // Активная вкладка. Раньше Tabs получал жёсткий value="history" и пустой
  // onValueChange={() => {}} — вкладки «Избранное» и «Шаблоны» не переключались.
  const [tab, setTab] = React.useState("history");

  React.useEffect(() => {
    const h = getHistory();
    setHistory(h);
    setFavorites(getFavorites());
    setTemplates(getTemplates());
    setProfile(getProfile());
    trackEvent("dashboard_view", {
      historyCount: h.length,
      favoritesCount: getFavorites().length,
      templatesCount: getTemplates().length,
    });
  }, []);

  // Норма приходит с сервера. Ошибка здесь НЕ должна ломать профиль: карточка
  // просто не рисуется, а остальное работает как раньше.
  React.useEffect(() => {
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

  const refresh = () => {
    setHistory(getHistory());
    setFavorites(getFavorites());
    setTemplates(getTemplates());
  };

  const handleRemove = (id: string) => {
    removeFromHistory(id);
    refresh();
    toast({ tone: "info", title: "Удалено из истории" });
  };

  const handleToggleFav = (id: string) => {
    // F-06 B-3: если артефакт уже лежит в KEY_FAVORITES, передаём его —
    // toggleFavorite синхронизирует и флаг, и сам список. Если нет
    // (юзер кликнул на «несохранённой» карточке) — fallback на флаг.
    const existing = getFavorites().find((x) => x.id === id);
    toggleFavorite(id, existing);
    refresh();
  };

  const handleRemoveFavorite = (id: string) => {
    removeFavorite(id);
    refresh();
    toast({ tone: "info", title: "Удалено из избранного" });
  };

  const handleRemoveTemplate = (id: string) => {
    removeTemplate(id);
    refresh();
    toast({ tone: "info", title: "Шаблон удалён" });
  };

  const handleUseTemplate = (t: UserTemplate) => {
    trackEvent("dashboard_use_template", { subject: t.subject, grade: t.grade });
    // Переход в конструктор с предзаполненными параметрами
    const params = new URLSearchParams({
      subject: t.subject,
      grade: String(t.grade),
      topic: t.topic,
      difficulty: t.difficulty,
      count: String(t.count),
    });
    router.push(`/constructor?${params}`);
  };

  const handleSignOut = () => {
    signOut();
    router.push("/");
    toast({ tone: "info", title: "Вы вышли из аккаунта" });
  };

  // Демо: если профиля нет, показать CTA на регистрацию
  if (!profile) {
    return <NoProfilePrompt />;
  }

  return (
    <div className="container-tight py-8 sm:py-12">
      <ProfileHeader profile={profile} onSignOut={handleSignOut} />

      <StatsRow history={history} favorites={favorites} templates={templates} />

      {/* Остаток нормы: для free — сколько осталось бесплатных генераций,
          для base/plus — взвешенные токены + «≈ N листов». При превышении
          показывает предложение, а не блокировку: порог мягкий. */}
      <div className="mt-6">
        <UsageCard usage={usage} loading={usageLoading} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-10">
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

        <TabsContent value="history">
          {history.length === 0 ? (
            <EmptyTab
              icon={History}
              title="История пуста"
              description="Сгенерированные листы будут появляться здесь"
              action={
                <Button as="link" href="/constructor" variant="primary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
                  Создать первый лист
                </Button>
              }
            />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {history.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  onRemove={() => handleRemove(item.id)}
                  onToggleFav={() => handleToggleFav(item.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="favorites">
          {favorites.length === 0 ? (
            <EmptyTab
              icon={Heart}
              title="Нет избранных листов"
              description="Добавляйте удачные листы в избранное, чтобы вернуться к ним"
              action={null}
            />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {favorites.map((artifact) => (
                <FavoriteCard
                  key={artifact.id}
                  artifact={artifact}
                  onRemove={() => handleRemoveFavorite(artifact.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates">
          {templates.length === 0 ? (
            <EmptyTab
              icon={LayoutTemplate}
              title="Нет шаблонов"
              description="Сохраняйте любимые настройки (предмет, класс, тема), чтобы быстро повторять удачные листы"
              action={null}
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onUse={() => handleUseTemplate(t)}
                  onRemove={() => handleRemoveTemplate(t.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="forms">
          <FormsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============== Profile ===============

function ProfileHeader({
  profile,
  onSignOut,
}: {
  profile: UserProfile;
  onSignOut: () => void;
}) {
  const planBadge = {
    free: { tone: "neutral" as const, label: "Бесплатный план" },
    base: { tone: "brand" as const, label: `${PLANS.base.name} · ${priceShort("base", "month")}` },
    plus: { tone: "accent" as const, label: `${PLANS.plus.name} · ${priceShort("plus", "month")}` },
  }[profile.plan];

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-warm-200">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white grid place-items-center text-xl font-bold">
          {profile.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-display font-bold text-warm-950">{profile.name}</h1>
            <Badge tone={planBadge.tone}>{planBadge.label}</Badge>
          </div>
          <p className="text-sm text-warm-500 mt-0.5">{profile.email}</p>
        </div>
      </div>
      <Button variant="ghost" size="md" onClick={onSignOut} leftIcon={<LogOut className="w-4 h-4" />}>
        Выйти
      </Button>
    </div>
  );
}

// =============== Stats ===============

function StatsRow({
  history,
  favorites,
  templates,
}: {
  history: UserHistoryItem[];
  favorites: FavoriteArtifact[];
  templates: UserTemplate[];
}) {
  const items = [
    {
      icon: Sparkles,
      label: "Сгенерировано",
      value: history.length,
      color: "text-brand-600",
    },
    {
      icon: Heart,
      label: "В избранном",
      value: favorites.length,
      color: "text-accent-600",
    },
    {
      icon: LayoutTemplate,
      label: "Шаблонов",
      value: templates.length,
      color: "text-blue-600",
    },
    {
      icon: Calendar,
      label: "С нами",
      value: timeAgo(history[history.length - 1]?.createdAt ?? new Date()),
      color: "text-warm-700",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
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

// =============== History card ===============

function HistoryCard({
  item,
  onRemove,
  onToggleFav,
}: {
  item: UserHistoryItem;
  onRemove: () => void;
  onToggleFav: () => void;
}) {
  const subject = getSubject(item.subject);
  return (
    <Card padded={false} hover className="overflow-hidden">
      <div className="aspect-[4/3] bg-gradient-to-br from-brand-50 to-warm-50 grid place-items-center relative">
        <div className="text-5xl">{subject?.emoji ?? "📄"}</div>
        <button
          type="button"
          onClick={onToggleFav}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 grid place-items-center hover:bg-white transition shadow-soft"
        >
          <Heart
            className={`w-4 h-4 ${
              item.isFavorite ? "fill-accent-500 text-accent-500" : "text-warm-400"
            }`}
          />
        </button>
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-white/80 text-[10px] text-warm-600 backdrop-blur">
          {timeAgo(item.createdAt)}
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm text-warm-950 line-clamp-1">{item.title}</h3>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-warm-500">
          <Badge tone="neutral">{subject?.shortTitle ?? item.subject}</Badge>
          {item.grade && <span>{item.grade} класс</span>}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Button
            as="link"
            href={`/preview?id=${encodeURIComponent(item.id)}`}
            variant="secondary"
            size="sm"
            fullWidth
          >
            Открыть
          </Button>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-warm-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
            aria-label="Удалить"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

// =============== Favorite card ===============

function FavoriteCard({
  artifact,
  onRemove,
}: {
  artifact: FavoriteArtifact;
  onRemove: () => void;
}) {
  // F-06 B-4: карточка рендерится для всех 4 типов артефактов,
  // показываем релевантные метаданные (заголовок + короткое summary).
  const summary = describeArtifact(artifact);

  return (
    <Card hover className="h-full flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-3">
        <Badge tone="brand">Избранное</Badge>
        <button
          type="button"
          onClick={onRemove}
          className="w-7 h-7 rounded-lg grid place-items-center text-warm-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
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
      <div className="mt-auto pt-4">
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
      </div>
    </Card>
  );
}

/**
 * Возвращает «{count, line}» и короткий текст-превью для дашбордной карточки.
 * Безопасно работает с любым из 4 типов артефактов (discriminated union).
 */
function describeArtifact(a: FavoriteArtifact): { line: string; preview: string } {
  if ("tasks" in a) {
    return {
      line: `${a.tasks.length} заданий`,
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
            className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-warm-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
            aria-label="Удалить"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

// =============== Empty / No profile ===============

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

function NoProfilePrompt() {
  return (
    <div className="container-tight py-12 sm:py-20 max-w-md mx-auto text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white grid place-items-center mx-auto mb-5 shadow-brand">
        <User className="w-8 h-8" />
      </div>
      <h1 className="text-3xl font-display font-bold text-warm-950">Личный кабинет</h1>
      <p className="text-warm-600 mt-3">
        Войдите, чтобы сохранять историю генераций, избранное и шаблоны. Без регистрации — 3 бесплатных листа уже работают.
      </p>
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button as="link" href="/login" variant="primary" size="lg" leftIcon={<User className="w-4 h-4" />}>
          Войти по email
        </Button>
        <Button as="link" href="/constructor" variant="secondary" size="lg" leftIcon={<Sparkles className="w-4 h-4" />}>
          Создать лист без регистрации
        </Button>
      </div>
    </div>
  );
}