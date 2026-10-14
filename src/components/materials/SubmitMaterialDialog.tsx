"use client";

import * as React from "react";
import { Download, Eye, Loader2, Trash2, Undo2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import {
  KIND_WORDS,
  MAX_DESCRIPTION,
  MAX_TASKS,
  MAX_TASK_TEXT,
  MAX_TITLE,
  STATUS_HINT,
  STATUS_TONE,
  countUserMaterialDownload,
  deleteUserMaterial,
  explainError,
  loadOwnMaterials,
  loadUserMaterials,
  statusWords,
  submitUserMaterial,
  withdrawUserMaterial,
  type OwnUserMaterial,
  type PublicUserMaterial,
  type UserMaterialDraft,
  type UserMaterialKind,
  type UserMaterialResult,
} from "@/lib/materials/user-api";

/**
 * Авторская часть банка материалов (лист 5.1.1): сдача материала и общий список.
 *
 * ─── ПОЧЕМУ ДВА ЭКСПОРТА В ОДНОМ ФАЙЛЕ ─────────────────────────────────────
 * Лист владеет ровно одним клиентским компонентом в каталоге материалов, поэтому
 * «сдать своё» и «посмотреть чужие» живут здесь. Разносить их по двум файлам
 * означало бы либо выйти за владение, либо оставить половину фичи без экрана.
 * Логика при этом раздельная: две независимые части с общей загрузкой данных.
 *
 * ─── ЧТО ГОВОРИТ ЭКРАН И ЧЕГО НЕ ГОВОРИТ ───────────────────────────────────
 * Говорит: «на модерации», «опубликован», «отклонён — вот причина», «снят с
 * публикации». Это весь ответ на вопрос «что с моим материалом».
 * Не говорит: «ваш материал увидят все», «популярно», «уже скачали N учителей».
 * Счётчик скачиваний — настоящий (он растёт на нажатии «Скачать»), поэтому и
 * подписан он честно: «столько раз скачали», а не «столько учителей используют».
 *
 * ─── ПОЧЕМУ СПИСОК ГРУЗИТСЯ В БРАУЗЕРЕ ────────────────────────────────────
 * Сайт собирается статическим экспортом (`next.config.mjs` → `output: "export"`),
 * базы на сборке нет. Материалы учителей появляются после модерации, то есть
 * ПОСЛЕ сборки, — поэтому общий банк приезжает клиентским запросом, а редакционный
 * каталог остаётся статикой.
 */

/** Предмет для выпадающего списка. Приходит со страницы: список предметов — общий. */
export interface SubjectOption {
  value: string;
  label: string;
}

export interface SubmitMaterialDialogProps {
  subjectOptions?: SubjectOption[];
}

/** Классы — как в конструкторе: 1–11. */
const GRADES = Array.from({ length: 11 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} класс` }));

const KIND_OPTIONS = (Object.keys(KIND_WORDS) as UserMaterialKind[]).map((kind) => ({
  value: kind,
  label: KIND_WORDS[kind],
}));

/** Сколько символов показывать вместо всего текста в карточке. */
const DESCRIPTION_PREVIEW = 180;

const EMPTY_DRAFT: UserMaterialDraft = {
  title: "",
  description: "",
  subject: "",
  grade: 5,
  kind: "worksheet",
  tasks: [""],
};

/**
 * Собирает черновик из формы и говорит, чего не хватает.
 *
 * Проверка здесь — чтобы учитель узнал о пустом названии сразу, а не после
 * похода на сервер и ответа «проверьте материал».
 */
function validate(draft: UserMaterialDraft): string | null {
  if (!draft.title.trim()) return "Впишите название — так материал найдут другие учителя";
  if (!draft.description.trim()) return "Опишите материал: что в нём и для какого урока";
  if (!draft.subject) return "Выберите предмет";
  const tasks = draft.tasks.map((t) => t.trim()).filter(Boolean);
  if (tasks.length === 0) return "Добавьте хотя бы одно задание — по одному на строку";
  if (tasks.length > MAX_TASKS) return `Заданий не больше ${MAX_TASKS}`;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. СДАЧА МАТЕРИАЛА И СПИСОК СВОИХ
 * ═══════════════════════════════════════════════════════════════════════════ */

export function SubmitMaterialDialog({ subjectOptions = [] }: SubmitMaterialDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"submit" | "mine">("submit");
  const [draft, setDraft] = React.useState<UserMaterialDraft>(EMPTY_DRAFT);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mine, setMine] = React.useState<OwnUserMaterial[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  /** Перечитать свои материалы. Ошибка чтения не должна выглядеть как «у вас пусто». */
  const reload = React.useCallback(async () => {
    const res = await loadOwnMaterials();
    setLoaded(true);
    if (res.ok) setMine(res.value);
  }, []);

  React.useEffect(() => {
    if (!open || loaded) return;
    void reload();
  }, [open, loaded, reload]);

  const setTask = (index: number, value: string) =>
    setDraft((prev) => ({ ...prev, tasks: prev.tasks.map((t, i) => (i === index ? value : t)) }));

  const addTask = () =>
    setDraft((prev) =>
      prev.tasks.length >= MAX_TASKS ? prev : { ...prev, tasks: [...prev.tasks, ""] },
    );

  const removeTask = (index: number) =>
    setDraft((prev) => ({
      ...prev,
      // Последнее задание не убираем: пустая форма без единого поля выглядит
      // как поломка, и учитель не поймёт, куда вписать текст.
      tasks: prev.tasks.length <= 1 ? prev.tasks : prev.tasks.filter((_, i) => i !== index),
    }));

  async function send() {
    const complaint = validate(draft);
    if (complaint) {
      setProblem(complaint);
      return;
    }
    setBusy(true);
    setProblem(null);
    const res = await submitUserMaterial({
      ...draft,
      tasks: draft.tasks.map((t) => t.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!res.ok) {
      setProblem(explainError(res.error));
      return;
    }
    setDraft(EMPTY_DRAFT);
    setTab("mine");
    await reload();
  }

  async function act(run: () => Promise<UserMaterialResult<true>>) {
    setBusy(true);
    setProblem(null);
    const res = await run();
    setBusy(false);
    if (!res.ok) setProblem(explainError(res.error));
    await reload();
  }

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        leftIcon={<Upload className="w-4 h-4" />}
        onClick={() => setOpen(true)}
      >
        Опубликовать свой материал
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Свои материалы в общем каталоге"
        description="Материал попадёт в общий каталог только после того, как его посмотрит владелец сайта. До этого его видите только вы."
      >
        <div className="flex gap-2 mb-5" role="tablist" aria-label="Что сделать с материалом">
          <Button
            variant={tab === "submit" ? "primary" : "ghost"}
            size="sm"
            role="tab"
            aria-selected={tab === "submit"}
            onClick={() => setTab("submit")}
          >
            Сдать новый
          </Button>
          <Button
            variant={tab === "mine" ? "primary" : "ghost"}
            size="sm"
            role="tab"
            aria-selected={tab === "mine"}
            onClick={() => setTab("mine")}
          >
            Мои материалы
          </Button>
        </div>

        {tab === "submit" ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-warm-900">Название</span>
              <input
                type="text"
                value={draft.title}
                maxLength={MAX_TITLE}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                placeholder="Например: Рабочий лист по дробям"
                className="mt-1 w-full h-11 px-3 rounded-xl border border-warm-200 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-warm-900">Описание</span>
              <textarea
                value={draft.description}
                maxLength={MAX_DESCRIPTION}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                placeholder="Что в материале, на сколько минут и для какого этапа урока"
                rows={3}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-warm-200 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-sm font-medium text-warm-900">Предмет</span>
                <div className="mt-1">
                  <Select
                    options={subjectOptions}
                    value={draft.subject}
                    onChange={(value) => setDraft((p) => ({ ...p, subject: value }))}
                    placeholder="Выберите предмет"
                    size="sm"
                  />
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-warm-900">Класс</span>
                <div className="mt-1">
                  <Select
                    options={GRADES}
                    value={String(draft.grade)}
                    onChange={(value) => setDraft((p) => ({ ...p, grade: Number(value) || 5 }))}
                    size="sm"
                  />
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-warm-900">Вид материала</span>
                <div className="mt-1">
                  <Select
                    options={KIND_OPTIONS}
                    value={draft.kind}
                    onChange={(value) => setDraft((p) => ({ ...p, kind: value as UserMaterialKind }))}
                    size="sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <span className="text-sm font-medium text-warm-900">Задания — по одному на строку</span>
              <div className="mt-1 space-y-2">
                {draft.tasks.map((task, index) => (
                  // Ключ по индексу — здесь нельзя переставлять строки, а значение
                  // всё равно живёт в состоянии формы, а не в React.
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={task}
                      maxLength={MAX_TASK_TEXT}
                      onChange={(e) => setTask(index, e.target.value)}
                      placeholder={`Задание ${index + 1}`}
                      className="flex-1 h-11 px-3 rounded-xl border border-warm-200 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    />
                    {draft.tasks.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Убрать задание ${index + 1}`}
                        onClick={() => removeTask(index)}
                      >
                        Убрать
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-2" onClick={addTask} disabled={draft.tasks.length >= MAX_TASKS}>
                Добавить задание
              </Button>
            </div>

            {problem && <p className="text-sm text-accent-800">{problem}</p>}

            <Button variant="primary" fullWidth loading={busy} onClick={() => void send()}>
              Отдать на модерацию
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!loaded && (
              <p className="text-sm text-warm-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                Загружаем ваши материалы…
              </p>
            )}
            {loaded && mine.length === 0 && (
              // Пустое состояние объясняет, что делать, а не показывает «0».
              <p className="text-sm text-warm-500">
                Вы ещё ничего не сдавали. Нажмите «Сдать новый» — материал попадёт в общий
                каталог после того, как его посмотрит владелец сайта.
              </p>
            )}
            {mine.map((material) => (
              <OwnMaterialRow
                key={material.id}
                material={material}
                busy={busy}
                onWithdraw={() => act(() => withdrawUserMaterial(material.id))}
                onDelete={() => act(() => deleteUserMaterial(material.id))}
              />
            ))}
            {problem && <p className="text-sm text-accent-800">{problem}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * Свой материал: что с ним происходит — словами, и что можно с ним сделать.
 *
 * Подпись статуса и пояснение под ней — это ответ на вопрос «что с моим
 * материалом». Кнопки рисуются по флагам СЕРВЕРА: если сервер решил, что
 * опубликованное править нельзя, экран не должен предлагать это сам.
 */
function OwnMaterialRow({
  material,
  busy,
  onWithdraw,
  onDelete,
}: {
  material: OwnUserMaterial;
  busy: boolean;
  onWithdraw: () => void;
  onDelete: () => void;
}) {
  const status = statusWords(material.status);

  return (
    <div className="rounded-2xl border border-warm-200 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-warm-950">{material.title}</p>
          <p className="text-xs text-warm-500 mt-0.5">
            {KIND_WORDS[material.kind as UserMaterialKind] ?? "Материал"} · {material.grade} класс
          </p>
        </div>
        <Badge tone={STATUS_TONE[material.status as keyof typeof STATUS_TONE] ?? "info"}>
          {status}
        </Badge>
      </div>

      {/* Пояснение нужно ровно там, где решение ещё не принято или было отрицательным. */}
      <p className="text-sm text-warm-600">{STATUS_HINT[material.status as keyof typeof STATUS_HINT] ?? STATUS_HINT.pending}</p>

      {material.status === "rejected" && material.rejectReason && (
        <p className="text-sm text-accent-800 bg-accent-50 rounded-xl px-3 py-2">
          <span className="font-medium">Причина отказа: </span>
          {material.rejectReason}
        </p>
      )}

      {material.status === "published" && (
        <p className="text-sm text-warm-600">Скачали {material.downloads} раз.</p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {material.canWithdraw && (
          <Button variant="secondary" size="sm" disabled={busy} leftIcon={<Undo2 className="w-4 h-4" />} onClick={onWithdraw}>
            Снять с публикации
          </Button>
        )}
        {material.canDelete && (
          <Button variant="ghost" size="sm" disabled={busy} leftIcon={<Trash2 className="w-4 h-4" />} onClick={onDelete}>
            Удалить
          </Button>
        )}
        {!material.canWithdraw && !material.canDelete && (
          <p className="text-xs text-warm-500">
            Чтобы поправить опубликованный материал, сначала снимите его с публикации.
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. ОБЩИЙ БАНК МАТЕРИАЛОВ УЧИТЕЛЕЙ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Опубликованные материалы учителей.
 *
 * Отдача приезжает из браузера: сайт собран статически, и материалы появляются
 * после модерации — уже после сборки. Пока учитель не вошёл, список всё равно
 * показывается: общий банк открыт, как и сам каталог.
 */
export function UserMaterialsList() {
  const [items, setItems] = React.useState<PublicUserMaterial[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const [downloaded, setDownloaded] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void loadUserMaterials().then((res) => {
      // Компонент мог размонтироваться, пока шёл запрос: ответ тогда не рисуем.
      if (!alive) return;
      if (res.ok) {
        setItems(res.value);
        setState("ready");
      } else {
        setState("failed");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  async function download(material: PublicUserMaterial) {
    const res = await countUserMaterialDownload(material.id);
    if (res.ok) {
      setItems((prev) => prev.map((m) => (m.id === material.id ? { ...m, downloads: res.value } : m)));
      setDownloaded(material.id);
    }
  }

  if (state === "loading") {
    return (
      <p className="text-sm text-warm-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        Загружаем материалы учителей…
      </p>
    );
  }

  if (state === "failed") {
    // Молчаливое «пусто» выглядело бы как «у нас нет материалов учителей».
    return (
      <p className="text-sm text-warm-500">
        Не удалось загрузить материалы учителей. Обновите страницу или попробуйте позже.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-warm-500">
        Здесь появятся материалы, которые учители сдали и которые посмотрел владелец
        сайта. Сейчас таких ещё нет.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((material) => (
        <article key={material.id} className="rounded-2xl border border-warm-100 bg-white p-5 shadow-soft">
          <div className="flex items-center gap-2 mb-2">
            {/* Метка «от учителя» — прямо на карточке: чужую работу нельзя выдать за редакционную. */}
            <Badge tone="brand">От учителя</Badge>
            <Badge tone="neutral">{KIND_WORDS[material.kind as UserMaterialKind] ?? "Материал"}</Badge>
          </div>
          <h3 className="font-semibold text-warm-950 text-balance">{material.title}</h3>
          <p className="mt-1 text-xs text-warm-500">
            {material.grade} класс · заданий: {material.tasks.length}
          </p>
          <p className="mt-2 text-sm text-warm-600">
            {material.description.length > DESCRIPTION_PREVIEW
              ? `${material.description.slice(0, DESCRIPTION_PREVIEW)}…`
              : material.description}
          </p>

          <div className="mt-4 pt-3 border-t border-warm-100 flex items-center justify-between gap-3">
            {/* Кто принёс — учитель должен понимать, от кого материал. */}
            <p className="text-xs text-warm-600 flex items-center gap-1.5 min-w-0">
              <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="truncate">{material.authorName}</span>
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={() => void download(material)}
            >
              Скачать
            </Button>
          </div>
          {/* Подпись честная: это нажатия, а не аудитория — сколько учителей читает
              каталог, мы не считали. */}
          <p className="mt-2 text-xs text-warm-500">
            Скачали {material.downloads} раз.
            {downloaded === material.id && " Спасибо!"}
          </p>
        </article>
      ))}
    </div>
  );
}