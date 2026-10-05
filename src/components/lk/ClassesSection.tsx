"use client";

/**
 * «Мои классы» (ТЗ-21, блок 5).
 *
 * У учителя 5–6 параллельных классов, и кабинет обязан их знать: отмеченный
 * класс — это то, что фильтр истории показывает по умолчанию.
 *
 * Границы продукта (сознательно узкие): это СПИСОК НАЗВАНИЙ, без учеников,
 * распределений и приглашений. «Классы с учениками» — отдельное решение
 * (ТЗ-21, блок 6), и здесь его быть не должно.
 *
 * Источник данных: устройство — у всех, сервер — у залогиненных. Список
 * сохраняется локально сразу (чтобы фильтр работал мгновенно и без входа), и
 * уходит на сервер, когда аккаунт есть. Расхождение невозможно по построению:
 * сервер — усилитель, устройство — источник правды для анонимного.
 */

import * as React from "react";
import { GraduationCap, Plus, X } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import {
  MAX_CLASSES,
  patchServerProfile,
  setDefaultClass,
  toggleLocalClass,
  type TeacherProfileView,
} from "@/lib/lk/profile-api";

interface Props {
  view: TeacherProfileView;
  onChange: (view: TeacherProfileView) => void;
}

/** Быстрый выбор из типовых — учителю не нужно придумывать «5а» или «5А». */
const SUGGESTIONS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

export function ClassesSection({ view, onChange }: Props) {
  const { toast } = useToast();
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const isServer = view.source === "account";

  // На сервер отправляем весь список целиком: PATCH /profile идемпотентен, а
  // «какой класс добавили» бэк всё равно не знает.
  const persist = async (next: string[]) => {
    if (!isServer) return;
    setSaving(true);
    try {
      const res = await patchServerProfile({ classes: next });
      if (!res.ok) {
        toast({
          tone: "error",
          title: "Классы сохранены на этом устройстве, но не в аккаунте",
        });
        return;
      }
      onChange({ ...view, classes: res.profile.classes });
    } finally {
      setSaving(false);
    }
  };

  const add = (raw: string) => {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) return;
    if (view.classes.length >= MAX_CLASSES) {
      toast({ tone: "error", title: `Больше ${MAX_CLASSES} классов не нужно` });
      return;
    }
    if (view.classes.some((c) => c.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))) {
      toast({ tone: "info", title: "Такой класс уже есть" });
      return;
    }
    const next = toggleLocalClass(name).map((c) => c.id);
    onChange({ ...view, classes: next });
    setValue("");
    void persist(next);
  };

  const remove = (name: string) => {
    const next = toggleLocalClass(name).map((c) => c.id);
    const wasDefault = view.defaultClass?.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru");
    if (wasDefault) setDefaultClass(null);
    onChange({
      ...view,
      classes: next,
      defaultClass: wasDefault ? null : view.defaultClass,
    });
    void persist(next);
  };

  const makeDefault = (name: string) => {
    const isDefault = view.defaultClass?.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru");
    setDefaultClass(isDefault ? null : name);
    onChange({ ...view, defaultClass: isDefault ? null : name });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Мои классы</CardTitle>
        <CardDescription>
          Отметьте свои параллели — кабинет откроется на выбранном классе, и его можно будет
          поменять в один клик. Без учеников и распределений: только названия.
        </CardDescription>
      </CardHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            id="lk-class-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(value);
              }
            }}
            placeholder="5А, 7Б…"
            className="flex-1 min-w-[180px]"
            maxLength={16}
            aria-label="Название класса"
          />
          <Button variant="primary" onClick={() => add(value)} disabled={!value.trim()}>
            <Plus className="w-4 h-4" />
            Добавить класс
          </Button>
        </div>

        {view.classes.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {view.classes.map((name) => {
              const isDefault =
                view.defaultClass?.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru");
              return (
                <li key={name}>
                  <div
                    className={
                      isDefault
                        ? "inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-200 py-1 pl-3 pr-1.5"
                        : "inline-flex items-center gap-2 rounded-full bg-warm-50 border border-warm-200 py-1 pl-3 pr-1.5"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => makeDefault(name)}
                      className="text-sm font-medium text-warm-900 hover:text-brand-700"
                      title={
                        isDefault
                          ? "Класс по умолчанию. Нажмите, чтобы сбросить"
                          : "Показывать кабинет на этом классе"
                      }
                    >
                      {name}
                    </button>
                    {isDefault ? <Badge tone="brand">по умолчанию</Badge> : null}
                    <button
                      type="button"
                      onClick={() => remove(name)}
                      aria-label={`Убрать класс ${name}`}
                      className="w-6 h-6 rounded-full hover:bg-warm-100 flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5 text-warm-500" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-warm-300 p-4 flex items-start gap-3">
            <GraduationCap className="w-5 h-5 text-warm-500 shrink-0 mt-0.5" />
            <p className="text-sm text-warm-600">
              Классов пока нет. Это необязательно: кабинет работает и без них, фильтр по классу
              просто будет пустым.
            </p>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-warm-700 mb-2">Часто используемые классы</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((g) => {
              const used = view.classes.some(
                (c) => c.toLocaleLowerCase("ru") === g.toLocaleLowerCase("ru"),
              );
              return (
                <button
                  key={g}
                  type="button"
                  disabled={used || view.classes.length >= MAX_CLASSES}
                  onClick={() => add(g)}
                  className="px-2.5 h-8 rounded-lg border border-warm-200 text-sm text-warm-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-40 disabled:hover:border-warm-200 disabled:hover:text-warm-700"
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-warm-500">
          {isServer
            ? "Классы сохраняются в аккаунте и видны на любом устройстве."
            : "Классы хранятся на этом устройстве. Чтобы они переезжали между устройствами, нужен вход в аккаунт."}
          {saving ? " Сохраняем…" : ""}
        </p>
      </div>
    </Card>
  );
}
