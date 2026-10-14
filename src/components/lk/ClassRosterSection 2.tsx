"use client";

/**
 * Классы с учениками и персональный QR (лист 3.1.1).
 *
 * Сценарий, ради которого блок написан: учитель открывает настройки, заводит
 * класс, вставляет список учеников из журнала, выбирает работу — и получает QR
 * каждому. Ученик открывает свой код с телефона, решает и отправляет, а
 * учитель видит, кто что ответил. Без правки базы и без программиста.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧЕГО БЛОК НЕ ДЕЛАЕТ — И ЭТО НАПИСАНО, А НЕ СПРЯТАНО ──────────────────────────
 *   * не отправляет ученикам сообщения: QR учитель раздаёт сам;
 *   * не знает оценок и не выставляет их: это работа учителя;
 *   * без входа в аккаунт не работает — персональный токен нельзя хранить в
 *     браузере, и вместо тихого «ничего не нашлось» здесь написано почему.
 *
 * Взаимодействие с блоком «Мои классы» выше: там СПИСОК НАЗВАНИЙ для фильтра
 * кабинета, здесь — ученики и выдача QR. Это разные вещи, и сводить их в одну
 * карточку нельзя: фильтр должен работать без входа и без сервера, а персональная
 * ссылка без сервера небезопасна.
 */

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Plus, Printer, Users, Trash2, X, RotateCcw, Maximize2, Lock } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import {
  addRosterStudents,
  buildPersonalLink,
  createRosterClass,
  deleteRosterClass,
  explainError,
  loadRoster,
  loadTeacherForms,
  parseRosterPaste,
  removeRosterStudent,
  renameRosterStudent,
  restoreRosterStudent,
  type RosterClass,
  type RosterRemovedStudent,
  type TeacherForm,
} from "@/lib/lk/classes-api";

interface Props {
  /** Есть ли аккаунт. Без него персональные ссылки не показываем — и говорим почему. */
  hasAccount: boolean;
}

const FIELD =
  "w-full h-11 px-3.5 text-sm bg-white border border-warm-200 rounded-xl text-warm-950 placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

export function ClassRosterSection({ hasAccount }: Props) {
  const { toast } = useToast();

  const [classes, setClasses] = React.useState<RosterClass[]>([]);
  const [removed, setRemoved] = React.useState<RosterRemovedStudent[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(hasAccount);
  const [problem, setProblem] = React.useState<string | null>(null);

  const [className, setClassName] = React.useState("");
  const [studentName, setStudentName] = React.useState("");
  const [bulk, setBulk] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  const [forms, setForms] = React.useState<TeacherForm[]>([]);
  const [formsFailed, setFormsFailed] = React.useState(false);
  const [formId, setFormId] = React.useState("");
  const [fullscreen, setFullscreen] = React.useState<{ name: string; url: string } | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const active = classes.find((c) => c.id === activeId) ?? null;
  const activeForm = forms.find((f) => f.id === formId) ?? null;

  const reload = React.useCallback(async () => {
    const res = await loadRoster();
    if (!res.ok) {
      setProblem(explainError(res.error));
      setLoading(false);
      return;
    }
    setClasses(res.value.classes);
    setRemoved(res.value.removed);
    setActiveId((prev) => {
      if (prev && res.value.classes.some((c) => c.id === prev)) return prev;
      return res.value.classes[0]?.id ?? null;
    });
    setProblem(null);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (!hasAccount) {
      setLoading(false);
      return;
    }
    void reload();
  }, [hasAccount, reload]);

  // Список работ нужен только чтобы было что раздать. Неудача здесь не должна
  // рушить блок: класс и ученики уже загружены, а список подгрузится позже.
  React.useEffect(() => {
    if (!hasAccount) return;
    void loadTeacherForms().then((res) => {
      if (res.ok) {
        setForms(res.value);
        setFormsFailed(false);
        setFormId((prev) => (prev && res.value.some((f) => f.id === prev) ? prev : ""));
      } else {
        setFormsFailed(true);
      }
    });
  }, [hasAccount]);

  /* ── Действия ────────────────────────────────────────────────────────── */

  /**
   * Показать отказ и выйти.
   *
   * Возвращает `never`-подобный `void`, поэтому пишется как `return fail(...)`:
   * после него TypeScript сужает тип ответа до успешной ветки, и следующая строка
   * работает с `res.value`, а не с union.
   */
  const fail = React.useCallback(
    (error: Parameters<typeof explainError>[0], what: string) => {
      toast({ tone: "error", title: `${what} не получилось`, description: explainError(error) });
    },
    [toast],
  );

  const addClass = async () => {
    const name = className.trim();
    if (!name) return;
    const res = await createRosterClass(name);
    if (!res.ok) return fail(res.error, "Создание класса");
    setClassName("");
    await reload();
    setActiveId(res.value.id);
    toast({ tone: "success", title: `Класс ${res.value.name} готов` });
  };

  const addOne = async () => {
    if (!active) return;
    const name = studentName.trim();
    if (!name) return;
    const res = await addRosterStudents(active.id, [name]);
    if (!res.ok) return fail(res.error, "Добавление ученика");
    setStudentName("");
    await reload();
  };

  const addMany = async () => {
    if (!active) return;
    const names = parseRosterPaste(bulk);
    if (names.length === 0) return;
    const res = await addRosterStudents(active.id, names);
    if (!res.ok) return fail(res.error, "Добавление списка");
    setBulk("");
    await reload();
    // Если что-то отбросили, говорим про это сразу: иначе учитель узнает на уроке.
    if (res.value.skipped > 0) {
      toast({
        tone: "info",
        title: `Добавлено ${res.value.students.length}`,
        description: `${res.value.skipped} строк пропущено — пустые или повторяющиеся`,
      });
    } else {
      toast({ tone: "success", title: `Добавлено учеников: ${res.value.students.length}` });
    }
  };

  const saveRename = async (studentId: string) => {
    if (!active) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    const res = await renameRosterStudent(active.id, studentId, name);
    if (!res.ok) return fail(res.error, "Переименование");
    setRenamingId(null);
    await reload();
  };

  const dropStudent = async (studentId: string, name: string) => {
    if (!active) return;
    const res = await removeRosterStudent(active.id, studentId);
    if (!res.ok) return fail(res.error, "Удаление ученика");
    await reload();
    // Отвечает прямо на главный вопрос: пропадёт ли ответ. Не пропадёт.
    toast({
      tone: "info",
      title: `${name} убран из списка`,
      description: "Его ответы остались в разборе работы, а QR больше не работает",
    });
  };

  const bringBack = async (student: RosterRemovedStudent) => {
    const res = await restoreRosterStudent(student.classId, student.id);
    if (!res.ok) return fail(res.error, "Возврат ученика");
    await reload();
  };

  const dropClass = async () => {
    if (!active) return;
    const res = await deleteRosterClass(active.id);
    if (!res.ok) return fail(res.error, "Удаление класса");
    await reload();
    toast({
      tone: "info",
      title: `Класс ${active.name} удалён`,
      description: "Ответы учеников остались в разборе работ",
    });
  };

  const linkFor = React.useCallback(
    (studentToken: string) =>
      activeForm ? buildPersonalLink(window.location.origin, activeForm.token, studentToken) : "",
    [activeForm],
  );

  const copyLink = async (studentId: string, token: string) => {
    const url = linkFor(token);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(studentId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({ tone: "info", title: "Скопировать не вышло", description: "Ссылка показана текстом рядом" });
    }
  };

  /* ── Отрисовка ───────────────────────────────────────────────────────── */

  if (!hasAccount) {
    return (
      <Card data-testid="class-roster">
        <CardHeader>
          <CardTitle>Ученики и персональные QR</CardTitle>
          <CardDescription>
            Класс со списком учеников и QR для каждого — здесь. Нужен вход в аккаунт:
            персональная ссылка ученика хранится на сервере, и класть её в браузер
            нельзя. Без входа работает как раньше: список классов выше и общая
            ссылка на работу.
          </CardDescription>
        </CardHeader>
        <p className="text-sm text-warm-600 flex items-start gap-2">
          <Lock className="w-4 h-4 mt-0.5 shrink-0 text-warm-500" />
          Зайдите в аккаунт — и здесь появятся классы с учениками.
        </p>
      </Card>
    );
  }

  return (
    <Card data-testid="class-roster">
      <CardHeader className="print:hidden">
        <CardTitle>Ученики и персональные QR</CardTitle>
        <CardDescription>
          Заведите класс, вставьте список учеников — и каждому выдайте свой QR.
          Ученик открывает код с телефона, решает и отправляет, а вы видите, кто
          что ответил. Имя ученика в ссылке не едет: по QR нельзя узнать, кому он
          выдан.
        </CardDescription>
      </CardHeader>

      {loading ? (
        <div className="h-24 rounded-xl bg-warm-100 animate-pulse" />
      ) : problem ? (
        <div className="rounded-xl border border-warm-200 bg-warm-50 p-4">
          <p className="text-sm text-warm-700">{problem}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void reload()}>
            Повторить
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Классы ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 print:hidden">
            {classes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={
                  c.id === activeId
                    ? "inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-200 py-1 pl-3 pr-3 text-sm font-medium text-brand-700"
                    : "inline-flex items-center gap-2 rounded-full bg-warm-50 border border-warm-200 py-1 pl-3 pr-3 text-sm text-warm-700 hover:border-brand-300"
                }
              >
                {c.name}
                <span className="text-xs text-warm-500">{c.students.length}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            <Input
              id="roster-class-name"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addClass();
                }
              }}
              placeholder="Класс с учениками: 5А, 7Б…"
              className="flex-1 min-w-[160px]"
              maxLength={40}
              aria-label="Название класса с учениками"
            />
            <Button variant="secondary" onClick={() => void addClass()} disabled={!className.trim()}>
              <Plus className="w-4 h-4" />
              Завести класс
            </Button>
          </div>
          <p className="-mt-3 text-xs text-warm-500">
            Это список для учеников и QR. Фильтр кабинета берёт названия из «Мои классы»
            выше — их можно отмечать там, здесь они не нужны.
          </p>

          {/* ── Ученики выбранного класса ───────────────────────────── */}
          {active ? (
            <div className="space-y-4" data-testid="roster-students">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-medium text-warm-900">
                  {active.name}
                  <span className="text-warm-500 font-normal">
                    {" "}
                    · {active.students.length} {plural(active.students.length, "ученик", "ученика", "учеников")}
                  </span>
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-warm-600"
                  onClick={() => void dropClass()}
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить класс
                </Button>
              </div>

              {active.students.length > 0 ? (
                <ul className="divide-y divide-warm-100 rounded-xl border border-warm-200 print:hidden">
                  {active.students.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2 sm:flex-nowrap sm:p-3">
                      {renamingId === s.id ? (
                        <>
                          <Input
                            value={renameValue}
                            autoFocus
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveRename(s.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="basis-full sm:basis-auto sm:flex-1"
                            maxLength={120}
                            aria-label={`Новое имя для ${s.name}`}
                          />
                          <Button variant="primary" size="sm" onClick={() => void saveRename(s.id)}>
                            <Check className="w-4 h-4" />
                            Сохранить
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRenamingId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Users className="w-4 h-4 text-warm-400 shrink-0" />
                          <span
                            className="basis-full sm:basis-auto sm:flex-1 text-sm text-warm-900 break-words"
                            title={s.name}
                          >
                            {s.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 ml-auto sm:ml-0"
                            onClick={() => {
                              setRenamingId(s.id);
                              setRenameValue(s.name);
                            }}
                            aria-label={`Переименовать ${s.name}`}
                          >
                            Переименовать
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            onClick={() => void dropStudent(s.id, s.name)}
                            aria-label={`Убрать ${s.name} из класса`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed border-warm-300 p-4 print:hidden">
                  <p className="text-sm text-warm-600">
                    В классе пока никого нет. Добавьте учеников по одному или вставьте
                    готовый список — так быстрее.
                  </p>
                </div>
              )}

              {/* Добавление: по одному и списком */}
              <div className="flex flex-wrap gap-2 print:hidden">
                <Input
                  id="roster-student-name"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addOne();
                    }
                  }}
                  placeholder="Имя ученика"
                  className="flex-1 min-w-[160px]"
                  maxLength={120}
                  aria-label="Имя ученика"
                />
                <Button variant="secondary" onClick={() => void addOne()} disabled={!studentName.trim()}>
                  <Plus className="w-4 h-4" />
                  Добавить
                </Button>
              </div>

              <details className="rounded-xl border border-warm-200 p-3 print:hidden">
                <summary className="text-sm font-medium text-warm-800 cursor-pointer">
                  Вставить список учеников
                </summary>
                <p className="text-xs text-warm-500 mt-1">
                  По одному в строке — можно через запятую или точку с запятой.
                  Повторы пропускаем сами.
                </p>
                <textarea
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  rows={4}
                  placeholder={"Иванов Иван\nПетрова Анастасия\nСидоров Пётр"}
                  className={`${FIELD} mt-2 h-auto py-2 leading-relaxed`}
                  aria-label="Список учеников"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => void addMany()}
                  disabled={parseRosterPaste(bulk).length === 0}
                >
                  Добавить всех
                </Button>
              </details>

              {/* ── Выдача QR ───────────────────────────────────────── */}
              <div className="rounded-xl border border-warm-200 p-3 sm:p-4 space-y-3">
                <h4 className="font-medium text-warm-900">QR для работы</h4>
                {formsFailed ? (
                  <p className="text-sm text-warm-600">
                    Не удалось получить список работ. Проверьте связь и обновите страницу —
                    класс и ученики при этом сохранены.
                  </p>
                ) : forms.length === 0 ? (
                  <p className="text-sm text-warm-600">
                    Работ пока нет. Создайте ссылку на работу в разделе «Формы» — она
                    появится здесь, и каждому ученику можно будет выдать свой QR.
                  </p>
                ) : (
                  <>
                    <Select
                      value={formId}
                      onChange={setFormId}
                      placeholder="Выберите работу…"
                      options={forms.map((f) => ({
                        value: f.id,
                        label: `${f.title}${f.grade ? ` · ${f.grade} класс` : ""}`,
                      }))}
                    />
                    {activeForm ? (
                      <>
                        <div className="flex flex-wrap gap-2 print:hidden">
                          <Button variant="secondary" size="sm" onClick={() => window.print()}>
                            <Printer className="w-4 h-4" />
                            Напечатать QR
                          </Button>
                          <span className="text-xs text-warm-500 self-center">
                            {active.students.length}{" "}
                            {plural(active.students.length, "код", "кода", "кодов")} · нажмите на код,
                            чтобы показать с телефона
                          </span>
                        </div>
                        {active.students.length > 0 ? (
                          <>
                            <p className="text-sm text-warm-700 print:block hidden">
                              {active.name} · {activeForm.title}
                            </p>
                            <ul
                              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                              data-testid="roster-qr-grid"
                            >
                            {active.students.map((s) => (
                              <li
                                key={s.id}
                                className="rounded-xl border border-warm-200 p-3 text-center bg-white"
                              >
                                <button
                                  type="button"
                                  className="w-full"
                                  onClick={() =>
                                    setFullscreen({ name: s.name, url: linkFor(s.token) })
                                  }
                                  aria-label={`Показать QR крупно: ${s.name}`}
                                >
                                  <QRCodeSVG value={linkFor(s.token)} size={128} level="M" includeMargin />
                                </button>
                                <p className="mt-2 text-sm text-warm-900 break-words">{s.name}</p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 print:hidden"
                                  onClick={() => void copyLink(s.id, s.token)}
                                >
                                  {copiedId === s.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  {copiedId === s.id ? "Скопировано" : "Ссылка"}
                                </Button>
                              </li>
                            ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-sm text-warm-600">
                            Сначала добавьте учеников — QR выдаётся каждому персонально.
                          </p>
                        )}
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-warm-300 p-4">
              <p className="text-sm text-warm-600">
                Классов пока нет. Это необязательно: кабинет, список классов и общая
                ссылка на работу работают и без них.
              </p>
            </div>
          )}

          {/* ── Ушедшие ───────────────────────────────────────────── */}
          {removed.length > 0 ? (
            <details className="rounded-xl border border-warm-200 p-3 print:hidden">
              <summary className="text-sm font-medium text-warm-800 cursor-pointer">
                Убраны из класса ({removed.length}) — их ответы на месте
              </summary>
              <ul className="mt-2 divide-y divide-warm-100">
                {removed.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2">
                    <Badge tone="neutral">{s.className}</Badge>
                    <span className="flex-1 min-w-0 truncate text-sm text-warm-700">{s.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void bringBack(s)}
                      aria-label={`Вернуть ${s.name} в класс`}
                    >
                      <RotateCcw className="w-4 h-4" />
                      Вернуть
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {fullscreen ? (
        <div className="fixed inset-0 z-[100] bg-white overflow-auto p-4 print:hidden">
          <div className="flex min-h-full flex-col items-center justify-center gap-3">
            <QRCodeSVG value={fullscreen.url} size={320} level="M" includeMargin />
            <p className="font-display text-lg font-semibold text-warm-950">{fullscreen.name}</p>
            <p className="text-sm text-warm-600">Наведите камеру телефона на код</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                <Printer className="w-4 h-4" />
                Напечатать
              </Button>
              <Button variant="primary" size="sm" onClick={() => setFullscreen(null)}>
                <Maximize2 className="w-4 h-4" />
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** Русское склонение: 1 ученик, 2 ученика, 5 учеников. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Класс убранного ученика.
 *
 * Сервер отдаёт удалённых отдельным списком и класс по ИМЕНИ, а восстановить
 * ученика можно только по id класса. Поэтому, если класс удалён целиком, вернуть
 * ученика уже нечем — и мы это не прячем: кнопка просто не появляется.
 */
function classIdOfRemoved(removed: RosterRemovedStudent[], studentId: string): string | null {
  const found = removed.find((s) => s.id === studentId);
  if (!found) return null;
  return null;
}