"use client";

/**
 * Страница ученика по короткому коду — `/k/?c=XXXXXX` (TZ-28).
 *
 * ─── Почему одна статическая страница и чтение кода из query ───
 * Фронт собирается как `output: "export"`: динамических маршрутов с токеном в
 * пути здесь быть не может (никаких `generateStaticParams`). Поэтому код
 * приходит в query и читается в `useEffect`, а страница до этого момента
 * показывает скелетон — ровно как `src/app/form/FormRunner.tsx`.
 *
 * ─── Экраны ───
 *   loading     — «Загружаем задания…»;
 *   needName    — «Напишите фамилию и имя» (код уже с доски принят);
 *   tasks       — список работ: сдать / уже сдано + балл;
 *   error       — код не подошёл, нет сети.
 *
 * ─── Что НЕ делаем ───
 * Не кладём код в localStorage «на будущее»: код учителя меняется вместе с
 * классом, а ученик приходит по новому. Сохраняем только ЧЕРНОВИК ответов.
 */

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { loadClass, loginByName, type ClassTaskItem, type StudentApiError } from "./api";
import { clearDraft, draftHasContent, loadDraft, saveDraft } from "./draft";

type Phase = "loading" | "needName" | "tasks" | "error";

/** Тексты ошибок — как можно конкретнее: ученик не сможет уточнить у учителя. */
const ERROR_TEXT: Record<StudentApiError, string> = {
  network: "Не получается связаться с сервером. Проверьте интернет и попробуйте ещё раз",
  not_found: "Код не подошёл. Проверьте буквы и цифры с доски",
  ambiguous: "В классе несколько учеников с такой фамилией — напишите ещё и имя",
  validation: "Проверьте написание",
  rate_limited: "Слишком много попыток. Подождите минуту и попробуйте снова",
  closed: "Учитель закрыл это задание",
  photo_too_large: "Фото слишком большое — снимите его ещё раз",
  internal: "Что-то пошло не так. Попробуйте ещё раз",
};

export function StudentClassPage() {
  const [code, setCode] = React.useState<string | undefined>(undefined);
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [className, setClassName] = React.useState("");
  const [studentName, setStudentName] = React.useState("");
  const [tasks, setTasks] = React.useState<ClassTaskItem[]>([]);
  const [name, setName] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [errorText, setErrorText] = React.useState("");
  const [loggingIn, setLoggingIn] = React.useState(false);
  const [hasDraft, setHasDraft] = React.useState(false);

  const load = React.useCallback(async (currentCode: string) => {
    setPhase("loading");
    setErrorText("");
    const res = await loadClass(currentCode);
    if (!res.ok) {
      setErrorText(ERROR_TEXT[res.error]);
      setPhase("error");
      return;
    }
    if (res.needName) {
      setPhase("needName");
      return;
    }
    setClassName(res.className);
    setStudentName(res.studentName);
    setTasks(res.tasks);
    setPhase("tasks");
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("c") ?? "").trim().toUpperCase();
    if (!raw) {
      setErrorText("Откройте ссылку целиком: в ней должен быть код с доски");
      setPhase("error");
      return;
    }
    setCode(raw);
    setHasDraft(draftHasContent(loadDraft(raw)));
    void load(raw);
  }, [load]);

  const handleLogin = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError("Напишите фамилию и имя — например, Иванов Иван");
      return;
    }
    if (!code) return;

    setLoggingIn(true);
    setNameError(null);
    const res = await loginByName(code, trimmed);
    setLoggingIn(false);

    if (!res.ok) {
      setNameError(ERROR_TEXT[res.error]);
      return;
    }
    // Имя, которое подтвердил сервер, записываем в черновик: оно нужно экрану
    // «Готово» («Аня: 7 из 10»), а в ссылке имя быть не должно. Токен ученика
    // при этом НЕ сохраняется — он остался в httpOnly-cookie, и на странице
    // работы ученика узнаётся сервером по ней.
    saveDraft({
      code,
      studentName: res.studentName,
      answers: loadDraft(code)?.answers ?? {},
      photos: loadDraft(code)?.photos ?? {},
      updatedAt: Date.now(),
    });
    await load(code);
  };

  const discardDraft = () => {
    if (code) clearDraft(code);
    setHasDraft(false);
  };

  /**
   * Работа, к которой ведёт «Восстановить».
   *
   * Черновик лежит по коду класса и подставляется на странице работы сама
   * (`FormRunner.restoreDraft`), поэтому кнопка просто открывает первую работу,
   * которую ещё можно сдать. Отдельного механизма «применить черновик здесь»
   * не существует и не нужно: сервер о черновике не знает, а восстановление
   * целиком происходит на странице задания.
   */
  const restoreTask = tasks.find((t) => t.open && !t.answered) ?? tasks[0];

  if (phase === "loading") return <Shell><Loading /></Shell>;

  if (phase === "error") {
    return (
      <Shell>
        <Card className="text-center" data-testid="class-error">
          <h1 className="text-xl font-semibold text-warm-950">Не получилось открыть</h1>
          <p className="mt-2 text-sm text-warm-600">{errorText}</p>
          {code && (
            <div className="mt-5">
              <Button variant="secondary" onClick={() => void load(code)}>
                Попробовать ещё раз
              </Button>
            </div>
          )}
        </Card>
      </Shell>
    );
  }

  if (phase === "needName") {
    return (
      <Shell>
        <Card data-testid="class-need-name">
          <h1 className="text-xl font-semibold text-warm-950">Кто сдаёт работу?</h1>
          <p className="mt-2 mb-4 text-sm text-warm-600">
            Напишите фамилию и имя так же, как в журнале. Регистрация не нужна.
          </p>
          <Input
            label="Фамилия и имя"
            className="text-base"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleLogin();
            }}
            error={nameError ?? undefined}
            placeholder="Иванов Иван"
            autoComplete="name"
            data-testid="class-name"
          />
          <Button className="mt-4 w-full" size="lg" fullWidth loading={loggingIn} onClick={() => void handleLogin()}>
            Дальше
          </Button>
          {hasDraft && (
            <div className="mt-4 rounded-xl bg-warm-50 p-3" data-testid="class-draft-hint">
              <p className="text-sm text-warm-700">
                На этом телефоне есть неотправленные ответы по этому классу.
              </p>
              <Button variant="ghost" size="sm" className="mt-1 px-0" onClick={discardDraft}>
                Стереть их
              </Button>
            </div>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-warm-950 break-words">
          {className || "Ваши задания"}
        </h1>
        {studentName && <p className="mt-1 text-sm text-warm-500">{studentName}</p>}
      </div>

      {hasDraft && (
        <Card className="mb-3 border-brand-200 bg-brand-50" data-testid="class-draft">
          <p className="text-sm text-brand-900">У тебя есть неотправленные ответы.</p>
          {restoreTask && (
            <Link href={`/form/?t=${encodeURIComponent(restoreTask.token)}&c=${encodeURIComponent(code ?? "")}`}>
              <Button className="mt-2" fullWidth data-testid="class-draft-restore">
                Восстановить
              </Button>
            </Link>
          )}
        </Card>
      )}

      {tasks.length === 0 ? (
        <Card className="text-center" data-testid="class-empty">
          <p className="text-sm text-warm-600">
            Пока заданий нет. Учитель выдаст их на следующем уроке — эта ссылка останется рабочей.
          </p>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="class-tasks">
          {tasks.map((task) => (
            <TaskCard key={task.token} task={task} code={code ?? ""} />
          ))}
        </div>
      )}

      <InstallHint />
    </Shell>
  );
}

function TaskCard({ task, code }: { task: ClassTaskItem; code: string }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-warm-950 break-words">{task.title}</p>
          <p className="mt-0.5 text-xs text-warm-500">
            {task.subject}
            {task.grade ? ` · ${task.grade} класс` : ""}
          </p>
        </div>
        {task.answered ? (
          <Badge tone="success">Сдано {task.scoreTotal ?? 0} из {task.scoreMax ?? 0}</Badge>
        ) : task.open ? (
          <Badge tone="info">К сдаче</Badge>
        ) : (
          <Badge>Закрыто</Badge>
        )}
      </div>

      <div className="mt-3">
        {task.open && !task.answered ? (
          <Link href={`/form/?t=${encodeURIComponent(task.token)}&c=${encodeURIComponent(code)}`}>
            <Button fullWidth size="lg">
              Открыть и сдать
            </Button>
          </Link>
        ) : (
          <p className="text-sm text-warm-600">
            {task.answered ? "Работа уже сдана — можно открыть и посмотреть." : "Учитель закрыл эту работу."}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Событие браузера, которым Chrome/Edge предлагают поставить приложение. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Приглашение поставить значок на главный экран.
 *
 * ─── Почему инструкция ДВЕ строками, а не одна ───
 * Установка на iOS идёт только из Safari («Поделиться» → «На экран „Домой“») и
 * кнопки у браузера там нет — сделать её нельзя, можно только сказать словами.
 * На Android Chrome умеет показать НАСТОЯЩУЮ кнопку установки, если страница
 * перехватит `beforeinstallprompt`. Одна строка «выберите в меню» была бы верна
 * только для Android и молчала бы на iPhone — ровно на телефоне, с которого
 * ученик сидит до ночи.
 *
 * Подсказка скрывается ТОЛЬКО когда приложение уже установлено (standalone).
 * Раньше условие было «не standalone и не iOS» — то есть на iPhone, где
 * установка единственная и нужна, подсказки не было вообще.
 */
function InstallHint() {
  const [show, setShow] = React.useState(false);
  const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
    setShow(!standalone);

    const onPrompt = (event: Event) => {
      // Событие можно обработать один раз: браузер ждёт именно `preventDefault`.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    setDeferred(null);
  };

  return (
    <Card className="mt-4 bg-warm-50" data-testid="install-hint">
      <p className="text-sm font-medium text-warm-800">
        Поставьте задания на главный экран — не придётся каждый раз искать ссылку в браузере.
      </p>
      <p className="mt-2 text-sm text-warm-700" data-testid="install-ios">
        <span className="font-medium">На iPhone:</span> нажмите «Поделиться» → «На экран „Домой“».
      </p>
      <div className="mt-2" data-testid="install-android">
        <p className="text-sm text-warm-700">
          <span className="font-medium">На Android:</span> в меню браузера выберите «Установить приложение».
        </p>
        {deferred && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void install()}
            data-testid="install-button"
          >
            Установить приложение
          </Button>
        )}
      </div>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-tight py-6 sm:py-10 max-w-2xl mx-auto">
      {children}
      <noscript>
        <p className="mt-6 text-sm text-warm-600">
          Для прохождения заданий нужен браузер с включённым JavaScript.
        </p>
      </noscript>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-3" data-testid="class-loading" aria-busy="true">
      <p className="text-center text-sm text-warm-500 mb-2">Загружаем задания…</p>
      {[0, 1].map((i) => (
        <Card key={i} className="animate-pulse">
          <div className="h-4 w-1/2 rounded bg-warm-100 mb-3" />
          <div className="h-11 w-full rounded-xl bg-warm-100" />
        </Card>
      ))}
    </div>
  );
}