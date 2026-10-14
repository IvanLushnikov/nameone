"use client";

/**
 * Ученики и персональный QR для класса учителя (лист 3.1.5).
 *
 * Сценарий, ради которого блок написан: учитель открывает настройки, называет
 * класс, вставляет список учеников из журнала, выбирает работу — и получает QR
 * каждому. Ученик открывает свой код с телефона, решает и отправляет, а
 * учитель видит, кто что ответил.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ОДИН СПОСОБ ДОБАВИТЬ КЛАСС И ОДИН — ДОБАВИТЬ УЧЕНИКА ────────────────────────
 *
 * Название класса набирается ОДИН РАЗ — в блоке «Мои классы» на этой же
 * странице, который нужен ещё и фильтру кабинета. Здесь своего поля для
 * названия нет намеренно: два поля «назовите класс» рядом на одном экране —
 * это ровно тот дефект, который закрывает лист 3.1.5 (учитель не понимает,
 * куда вводить, и заводит класс дважды). Этот блок берёт названия из
 * `knownClassNames` и показывает их списком; класс на сервере появляется сам,
 * когда учитель добавляет первого ученика.
 *
 * Ученика добавляет одно поле: одна строка — Enter, много строк — вставка
 * списка из журнала. Двух полей («одного» и «списком») здесь намеренно нет.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ЧЕГО БЛОК НЕ ДЕЛАЕТ — И ЭТО НАПИСАНО, А НЕ СПРЯТАНО ────────────────────────
 *   * не отправляет ученикам сообщения: QR учитель раздаёт сам;
 *   * не знает оценок и не выставляет их: это работа учителя;
 *   * не показывает «кто сдал, а кто ждёт» поимённо: сервер отдаёт число
 *     ответов по работе, а не по ученику. Число ответов показано честно, как
 *     число ответов; поимённый список — во вкладке «Выданное»;
 *   * без входа в аккаунт не работает — персональный токен нельзя хранить в
 *     браузере, и вместо тихого «ничего не нашлось» здесь написано почему.
 */

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  Lock,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Users,
  X,
  RotateCcw,
  Maximize2,
} from "lucide-react";
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
  MAX_STUDENTS_PER_CLASS,
  MAX_STUDENTS_PER_IMPORT,
  MAX_STUDENT_NAME,
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
  /**
   * Названия классов из блока «Мои классы» на этой же странице — единственное
   * место, где учитель называет класс. Пустой массив бывает: классов ещё нет.
   */
  knownClassNames: string[];
}

/** Поле ввода списка учеников. Та же строка, что у соседних карточек. */
const FIELD =
  "w-full px-3.5 py-2.5 text-sm bg-white border border-warm-200 rounded-xl text-warm-950 placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

/** Ключ сравнения названий: регистр и лишние пробелы не должны плодить классы. */
function key(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
}

export function ClassRosterSection({ hasAccount, knownClassNames }: Props) {
  const { toast } = useToast();

  const [classes, setClasses] = React.useState<RosterClass[]>([]);
  const [removed, setRemoved] = React.useState<RosterRemovedStudent[]>([]);
  /** Выбран класс по НАЗВАНИЮ, а не по id: до первого ученика класса на сервере ещё нет. */
  const [activeName, setActiveName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(hasAccount);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** Одно поле на всех: одна строка — один ученик, много строк — список. */
  const [draft, setDraft] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [confirmDrop, setConfirmDrop] = React.useState(false);

  const [forms, setForms] = React.useState<TeacherForm[]>([]);
  const [formsFailed, setFormsFailed] = React.useState(false);
  const [formId, setFormId] = React.useState("");
  const [fullscreen, setFullscreen] = React.useState<{ name: string; url: string } | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const res = await loadRoster();
    if (!res.ok) {
      setProblem(explainError(res.error));
      setLoading(false);
      return null;
    }
    setClasses(res.value.classes);
    setRemoved(res.value.removed);
    setProblem(null);
    setLoading(false);
    return res.value.classes;
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

  /* ── Что показываем ───────────────────────────────────────────────────── */

  /** Названия из «Мои классов» + те, что остались на сервере после правок. */
  const chips = React.useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const name of [...knownClassNames, ...classes.map((c) => c.name)]) {
      const clean = name.replace(/\s+/g, " ").trim();
      if (!clean) continue;
      const k = key(clean);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(clean);
    }
    return out;
  }, [knownClassNames, classes]);

  const rosterByName = React.useMemo(() => {
    const map = new Map<string, RosterClass>();
    for (const c of classes) map.set(key(c.name), c);
    return map;
  }, [classes]);

  // Выбранный класс: показываем название из «Мои классов» всегда, учеников —
  // если серверный класс с таким названием уже есть.
  const activeKey = activeName ? key(activeName) : null;
  const active = activeKey ? (rosterByName.get(activeKey) ?? null) : null;
  const activeLabel = activeName ?? "";
  const students = active?.students ?? [];

  /**
   * Класс выбран всегда: первый, если выбора ещё нет. Если учитель только что
   * назвал новый класс в «Мои классах» выше — выбираем именно его, чтобы путь
   * «назвал класс → вставил список» не требовал лишнего нажатия.
   */
  const knownRef = React.useRef<string[]>([]);
  React.useEffect(() => {
    const prev = knownRef.current;
    knownRef.current = knownClassNames;
    if (chips.length === 0) {
      setActiveName(null);
      return;
    }
    if (activeName && chips.some((c) => key(c) === key(activeName))) {
      // Класс на месте. Если добавили новый — переходим на него.
      const fresh = knownClassNames.find((n) => !prev.some((p) => key(p) === key(n)));
      if (fresh) setActiveName(fresh);
      return;
    }
    setActiveName(prev.length === 0 ? knownClassNames[0] ?? chips[0] : chips[0]);
  }, [chips, knownClassNames, activeName]);

  /* ── Действия ────────────────────────────────────────────────────────── */

  const fail = React.useCallback(
    (error: Parameters<typeof explainError>[0], what: string) => {
      toast({ tone: "error", title: `${what} не получилось`, description: explainError(error) });
    },
    [toast],
  );

  /**
   * Класс на сервере — с тем же названием, иначе создаём.
   *
   * Нужен ровно один раз: учитель назвал класс в «Мои классах», а серверной
   * копии с учениками ещё нет. Возвращает id класса, к которому и кладём
   * учеников. При 409 (класс создан другим устройством) перечитываем список и
   * берём существующий — иначе второй телефон учителя ломал бы путь.
   */
  const ensureClass = async (name: string): Promise<RosterClass | null> => {
    const existing = rosterByName.get(key(name));
    if (existing) return existing;

    const created = await createRosterClass(name);
    if (created.ok) return created.value;

    if (created.error === "conflict") {
      const fresh = await reload();
      const found = fresh?.find((c) => key(c.name) === key(name));
      if (found) return found;
    }
    fail(created.error, "Создание класса");
    return null;
  };

  /** Одно поле — один путь: и одна строка, и вставленный список. */
  const addStudents = async () => {
    if (!activeName || busy) return;

    const parsed = parseRosterPaste(draft);
    if (parsed.length === 0) return;
    // Длиннее 120 символов сервер не примет. Молча выкидывать нельзя — учитель
    // узнает об этом на уроке, когда ученика не окажется в списке.
    const tooLong = parsed.filter((n) => n.length > MAX_STUDENT_NAME).length;
    const names = parsed.filter((n) => n.length <= MAX_STUDENT_NAME);
    const overLimit = names.length > MAX_STUDENTS_PER_IMPORT;
    const take = overLimit ? names.slice(0, MAX_STUDENTS_PER_IMPORT) : names;
    const dropped = tooLong + (names.length - take.length);
    const room = active ? MAX_STUDENTS_PER_CLASS - active.students.length : MAX_STUDENTS_PER_CLASS;
    const batch = take.length > room ? take.slice(0, room) : take;
    const notFitted = dropped + (take.length - batch.length);

    if (batch.length === 0) {
      toast({
        tone: "error",
        title: "Не добавлено",
        description: tooLong
          ? `Все имена длиннее ${MAX_STUDENT_NAME} символов — проверьте список`
          : `В классе уже ${MAX_STUDENTS_PER_CLASS} учеников — больше не помещается`,
      });
      return;
    }

    setBusy(true);
    try {
      const cls = await ensureClass(activeName);
      if (!cls) return;
      const res = await addRosterStudents(cls.id, batch);
      if (!res.ok) return fail(res.error, "Добавление ученика");
      setDraft("");
      await reload();

      const parts: string[] = [];
      if (res.value.skipped > 0) parts.push(`${res.value.skipped} повторов пропущено`);
      if (notFitted > 0) parts.push(`${notFitted} не поместились`);
      if (tooLong > 0) parts.push(`${tooLong} длиннее ${MAX_STUDENT_NAME} символов`);

      toast({
        tone: parts.length > 0 ? "info" : "success",
        title:
          batch.length === 1
            ? `Добавлен ученик: ${res.value.students[0]?.name ?? batch[0]}`
            : `Добавлено учеников: ${res.value.students.length}`,
        description: parts.length > 0 ? parts.join(" · ") : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (studentId: string) => {
    if (!active) return;
    const name = renameValue.trim().replace(/\s+/g, " ");
    if (!name) {
      setRenamingId(null);
      return;
    }
    if (name.length > MAX_STUDENT_NAME) {
      toast({ tone: "error", title: `Имя длиннее ${MAX_STUDENT_NAME} символов сервер не примет` });
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
    setConfirmDrop(false);
    if (!res.ok) return fail(res.error, "Удаление класса");
    await reload();
    toast({
      tone: "info",
      title: `Ученики класса ${active.name} удалены`,
      description: "Ответы остались в разборе работ. Название класса осталось в «Мои классы»",
    });
  };

  const draftNames = parseRosterPaste(draft);
  const activeForm = forms.find((f) => f.id === formId) ?? null;

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
            нельзя. Без входа работает как раньше: список классов и общая ссылка на
            работу.
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
          Назовите класс в «Мои классы» выше — здесь он появится сразу. Вставьте
          список учеников — и каждому выдайте свой QR: ученик открывает код с телефона,
          решает и отправляет, а вы видите, кто что ответил. Имя ученика в ссылке не
          едет: по QR нельзя узнать, кому он выдан.
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
      ) : chips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-warm-300 p-4 print:hidden">
          <p className="text-sm text-warm-600">
            Назовите класс в «Мои классы» выше — он появится здесь, и останется вставить
            учеников. Это необязательно: кабинет и общая ссылка на работу работают и без
            классов с учениками.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Классы: названия из «Мои классов», без второго ввода ─────── */}
          <div className="flex flex-wrap gap-2 print:hidden">
            {chips.map((name) => {
              const isActive = activeName !== null && key(name) === key(activeName);
              const count = rosterByName.get(key(name))?.students.length ?? 0;
              return (
                <button
                  key={key(name)}
                  type="button"
                  onClick={() => {
                    setActiveName(name);
                    setConfirmDrop(false);
                  }}
                  title={name}
                  className={
                    isActive
                      ? "max-w-full inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-200 py-1 pl-3 pr-3 text-sm font-medium text-brand-700"
                      : "max-w-full inline-flex items-center gap-2 rounded-full bg-warm-50 border border-warm-200 py-1 pl-3 pr-3 text-sm text-warm-700 hover:border-brand-300"
                  }
                >
                  {/* Длинное название переносится, а не режется: два соседних
                      класса, обрезанные до «7…», не отличить. */}
                  <span className="min-w-0 break-words">{name}</span>
                  <span className="text-xs text-warm-500 shrink-0">{count}</span>
                </button>
              );
            })}
          </div>

          {/* ── Выбранный класс ──────────────────────────────────────────── */}
          <div className="space-y-4" data-testid="roster-students">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <h4 className="font-medium text-warm-900 break-words">
                  {activeLabel}
                  <span className="text-warm-500 font-normal">
                    {" "}
                    · {students.length}{" "}
                    {plural(students.length, "ученик", "ученика", "учеников")}
                  </span>
                </h4>
                {/* Честное состояние: сколько учеников и сколько ответов
                    сервер уже видел по выбранной работе. Чего нет — того не
                    показываем: «кто сдал» поимённо живёт во вкладке
                    «Выданное», здесь его взять неоткуда. */}
                {activeForm && activeForm.responsesCount > 0 ? (
                  <p className="text-xs text-warm-600 mt-0.5">
                    Ответов получено: {activeForm.responsesCount} по работе «
                    {activeForm.title}». Кто ответил — во вкладке «Выданное».
                  </p>
                ) : null}
              </div>

              {active ? (
                confirmDrop ? (
                  <div className="w-full sm:w-auto rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
                    <p className="text-sm text-rose-800">
                      Удалить {students.length}{" "}
                      {plural(students.length, "ученика", "учеников", "учеников")} вместе с их
                      QR? Ответы останутся.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="accent" size="sm" onClick={() => void dropClass()}>
                        <Trash2 className="w-4 h-4" />
                        Удалить
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDrop(false)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-warm-600 shrink-0"
                    onClick={() => setConfirmDrop(true)}
                  >
                    <Trash2 className="w-4 h-4" />
                    Удалить класс
                  </Button>
                )
              ) : null}
            </div>

            {students.length > 0 ? (
              <ul className="divide-y divide-warm-100 rounded-xl border border-warm-200 print:hidden">
                {students.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 p-2 sm:p-3">
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
                          className="min-w-0 flex-1"
                          maxLength={MAX_STUDENT_NAME}
                          aria-label={`Новое имя для ${s.name}`}
                        />
                        <Button variant="primary" size="sm" onClick={() => void saveRename(s.id)}>
                          <Check className="w-4 h-4" />
                          <span className="sr-only sm:not-sr-only">Сохранить</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRenamingId(null)}
                          aria-label="Отменить переименование"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Users className="w-4 h-4 text-warm-400 shrink-0" />
                        {/* Имя целиком: `min-w-0` даёт возможность сжаться,
                            `break-words` — перенести длинное слово. Две
                            строки у «удалённых» вместо обрезки: соседей по
                            началу имени иначе не отличить. */}
                        <span className="min-w-0 flex-1 text-sm text-warm-900 break-words">
                          {s.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            setRenamingId(s.id);
                            setRenameValue(s.name);
                          }}
                          aria-label={`Переименовать ${s.name}`}
                          title="Переименовать"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => void dropStudent(s.id, s.name)}
                          aria-label={`Убрать ${s.name} из класса`}
                          title="Убрать из класса"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed border-warm-300 p-4 print:hidden">
                <p className="text-sm text-warm-600">
                  В классе пока никого нет. Вставьте список из журнала — можно хоть сразу
                  всех, хоть по одному.
                </p>
              </div>
            )}

            {/* ── Одно поле на добавление ──────────────────────────────── */}
            <div className="space-y-2 print:hidden">
              <label htmlFor="roster-draft" className="text-sm font-medium text-warm-800">
                Добавить учеников в {activeLabel}
              </label>
              <textarea
                id="roster-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Одна строка — Enter добавляет. Несколько строк — это
                  // вставленный список, и Enter в нём должен переносить
                  // строку, иначе список не вставить вообще.
                  if (e.key === "Enter" && !e.shiftKey && !draft.includes("\n")) {
                    e.preventDefault();
                    void addStudents();
                  }
                }}
                rows={2}
                placeholder={"Иванов Иван\nПетрова Анастасия\nСидоров Пётр"}
                className={`${FIELD} resize-y leading-relaxed`}
                aria-label={`Имя или список учеников для класса ${activeLabel}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void addStudents()}
                  disabled={busy || draftNames.length === 0}
                >
                  <Plus className="w-4 h-4" />
                  {draftNames.length > 1 ? `Добавить ${draftNames.length} учеников` : "Добавить"}
                </Button>
                <span className="text-xs text-warm-500">
                  {draftNames.length > 1
                    ? `В списке ${draftNames.length} ${plural(draftNames.length, "имя", "имени", "имён")}`
                    : "Одно имя — Enter. Список — вставьте из журнала, добавим всех."}
                </span>
              </div>
            </div>

            {/* ── Выдача QR ─────────────────────────────────────────────── */}
            <div className="rounded-xl border border-warm-200 p-3 sm:p-4 space-y-3">
              <h4 className="font-medium text-warm-900">QR для работы</h4>
              {formsFailed ? (
                <p className="text-sm text-warm-600">
                  Не удалось получить список работ. Проверьте связь и обновите страницу —
                  класс и ученики при этом сохранены.
                </p>
              ) : forms.length === 0 ? (
                <p className="text-sm text-warm-600">
                  Работ пока нет. Создайте ссылку на работу в разделе «Выданное» — она
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
                      label: `${f.title}${f.grade ? ` · ${f.grade} класс` : ""}${
                        f.responsesCount > 0 ? ` · ответов: ${f.responsesCount}` : ""
                      }`,
                    }))}
                  />
                  {activeForm ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 print:hidden">
                        <Button variant="secondary" size="sm" onClick={() => window.print()}>
                          <Printer className="w-4 h-4" />
                          Напечатать QR
                        </Button>
                        <span className="text-xs text-warm-500">
                          {students.length}{" "}
                          {plural(students.length, "код", "кода", "кодов")} · нажмите на код,
                          чтобы показать с телефона
                        </span>
                      </div>
                      {students.length > 0 ? (
                        <>
                          <p className="text-sm text-warm-700 print:block hidden">
                            {activeLabel} · {activeForm.title}
                          </p>
                          {/* Два код�� в ряд на телефоне: колонка узкая, и код
                              фиксированного размера в ней не помещался — QR
                              уезжал за край. Размер задаёт ширина ячейки. */}
                          <ul
                            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3"
                            data-testid="roster-qr-grid"
                          >
                            {students.map((s) => (
                              <li
                                key={s.id}
                                className="min-w-0 rounded-xl border border-warm-200 p-2 sm:p-3 text-center bg-white"
                              >
                                <button
                                  type="button"
                                  className="block w-full"
                                  onClick={() =>
                                    setFullscreen({ name: s.name, url: linkFor(s.token) })
                                  }
                                  aria-label={`Показать QR крупно: ${s.name}`}
                                >
                                  <QRCodeSVG
                                    value={linkFor(s.token)}
                                    size={128}
                                    level="M"
                                    includeMargin
                                    className="w-full h-auto mx-auto max-w-[150px]"
                                  />
                                </button>
                                <p
                                  className="mt-2 text-sm text-warm-900 break-words line-clamp-2"
                                  title={s.name}
                                >
                                  {s.name}
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 print:hidden"
                                  onClick={() => void copyLink(s.id, s.token)}
                                >
                                  {copiedId === s.id ? (
                                    <Check className="w-4 h-4" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
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

          {/* ── Ушедшие ───────────────────────────────────────────────── */}
          {removed.length > 0 ? (
            <details className="rounded-xl border border-warm-200 p-3 print:hidden">
              <summary className="text-sm font-medium text-warm-800 cursor-pointer">
                Убраны из класса ({removed.length}) — их ответы на месте
              </summary>
              <ul className="mt-2 divide-y divide-warm-100">
                {removed.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2">
                    <Badge tone="neutral" className="max-w-[40%] truncate">
                      {s.className}
                    </Badge>
                    <span
                      className="min-w-0 flex-1 text-sm text-warm-700 break-words line-clamp-2"
                      title={s.name}
                    >
                      {s.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
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
            <div className="w-full max-w-[320px]">
              <QRCodeSVG
                value={fullscreen.url}
                size={320}
                level="M"
                includeMargin
                className="w-full h-auto"
              />
            </div>
            <p className="font-display text-lg font-semibold text-warm-950 text-center break-words px-2">
              {fullscreen.name}
            </p>
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