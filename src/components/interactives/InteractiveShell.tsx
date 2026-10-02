"use client";

/**
 * `InteractiveShell` — оболочка прохождения интерактива (TZ-13 §4.3, пункт 1).
 *
 * Общая для всех шести форматов: имя, старт, прогресс, финальный экран, отправка
 * результата, восстановление сессии, `data-interactive-*` селекторы. Плеер НЕ
 * знает про сеть, про localStorage и про API — всё это здесь. Благодаря этому
 * добавление седьмого формата не трогает оболочку (DoD фазы 4).
 *
 * Экраны:
 *   name    — «Как тебя зовут?» (+ предупреждение про ПДн, ТЗ §7);
 *   resume  — «Вы уже начинали, продолжим?» (найдена попытка в localStorage);
 *   playing — сам плеер;
 *   done    — итог и кнопка «Отправить учителю»;
 *   sent    — «Учитель уже видит твой результат»;
 *   error   — сеть/5xx на отправке, результат НЕ теряется.
 *
 * Правила, которые нельзя нарушать:
 *   - клиентский счёт — предварительный: на отправке сервер пересчитывает его
 *     из `config_json` (ТЗ §4.7), и мы показываем ответ СЕРВЕРА;
 *   - одна попытка = один `attemptToken`: повторное «Начать» не заводит новую,
 *     а продолжает старую, иначе ученик насоздаёт себе попыток впритырку;
 *   - имя ограничено 60 символами и это НЕ ФИО: подсказка об этом стоит на
 *     экране ввода (ТЗ §7 — только имя, никаких почт и телефонов).
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { InteractivePlayer } from "./InteractivePlayer";
import { startAttempt, submitAttempt } from "@/lib/interactives/api";
import { scoreSummary } from "@/lib/interactives/scoring";
import { clearAttempt, loadAttempt, saveAttempt, type StoredAttempt } from "@/lib/interactives/storage";
import { formatMeta } from "@/lib/interactives/formats";
import {
  INTERACTIVE_ERROR_MESSAGE,
  STUDENT_NAME_MAX,
  type PublicInteractive,
  type PlayerResult,
  type SubmitAttemptOk,
} from "@/lib/interactives/types";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle, Check, RefreshCw, Send, User } from "lucide-react";

type Phase = "name" | "resume" | "playing" | "done" | "sent";

export interface InteractiveShellProps {
  /** Публичный токен интерактива (`?t=`). */
  token: string;
  interactive: PublicInteractive;
}

export function InteractiveShell({ token, interactive }: InteractiveShellProps) {
  const meta = formatMeta(interactive.format);

  const [phase, setPhase] = React.useState<Phase>("name");
  const [name, setName] = React.useState("");
  const [studentClass, setStudentClass] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  const [attemptToken, setAttemptToken] = React.useState<string | null>(null);
  /** Снапшот плеера: переживает закрытие вкладки. */
  const [snapshot, setSnapshot] = React.useState<unknown>(null);
  const [result, setResult] = React.useState<PlayerResult | null>(null);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [serverResult, setServerResult] = React.useState<SubmitAttemptOk | null>(null);
  const [startError, setStartError] = React.useState<string | null>(null);

  /**
   * Ключ перемонтирования плеера. Нужен для «Сыграть ещё раз»: состояние
   * плеера инициализируется один раз (useState), поэтому без смены ключа
   * React не пересоздаст компонент и игра начнётся с финишного снапшота.
   */
  const [playKey, setPlayKey] = React.useState(0);

  /* ─── восстановление сессии ──────────────────────────────────────────── */

  React.useEffect(() => {
    const stored: StoredAttempt | null = loadAttempt(token);
    if (!stored) return;

    setName(stored.studentName);
    setStudentClass(stored.studentClass ?? "");
    setAttemptToken(stored.attemptToken);
    // Снапшот отдаём плееру только когда ученик подтвердит продолжение:
    // иначе тот, кто случайно открыл ссылку, сразу окажется в середине игры.
    setSnapshot(stored.snapshot ?? null);
    setPhase("resume");
  }, [token]);

  /* ─── старт ──────────────────────────────────────────────────────────── */

  const handleStart = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Напишите, как вас зовут — так учитель поймёт, чей это результат");
      return;
    }
    if (trimmed.length > STUDENT_NAME_MAX) {
      setNameError(`Слишком длинное имя — достаточно ${STUDENT_NAME_MAX} символов`);
      return;
    }
    if (starting) return;

    setNameError(null);
    setStartError(null);

    // Попытка уже заведена (восстановление) — новую не заводим.
    if (attemptToken) {
      setPhase("playing");
      return;
    }

    setStarting(true);
    const res = await startAttempt(token, {
      studentName: trimmed,
      studentClass: studentClass.trim() || undefined,
    });
    setStarting(false);

    if (!res.ok) {
      setStartError(INTERACTIVE_ERROR_MESSAGE[res.error]);
      return;
    }
    setAttemptToken(res.attemptToken);
    saveAttempt(token, {
      attemptToken: res.attemptToken,
      studentName: trimmed,
      studentClass: studentClass.trim() || undefined,
      snapshot: null,
    });
    setPhase("playing");
  };

  const handleResume = () => setPhase("playing");

  const handleRestart = () => {
    // «Заново» — честный сброс: старая попытка остаётся у учителя, ученик
    // начинает новую (сервер отдаст новый attemptToken).
    clearAttempt(token);
    setAttemptToken(null);
    setSnapshot(null);
    setResult(null);
    setServerResult(null);
    setSubmitError(null);
    setPlayKey((k) => k + 1);
    setPhase("playing");
  };

  /* ─── прогресс и финиш ───────────────────────────────────────────────── */

  const handleChange = React.useCallback(
    (next: unknown) => {
      setSnapshot(next);
      if (!attemptToken) return;
      saveAttempt(token, {
        attemptToken,
        studentName: name.trim(),
        studentClass: studentClass.trim() || undefined,
        snapshot: next,
      });
    },
    [attemptToken, token, name, studentClass],
  );

  const handleFinish = React.useCallback((res: PlayerResult) => {
    setResult(res);
    setPhase("done");
  }, []);

  /* ─── отправка ───────────────────────────────────────────────────────── */

  const handleSubmit = async () => {
    if (!attemptToken || !result || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const res = await submitAttempt(token, attemptToken, {
      studentName: name.trim(),
      studentClass: studentClass.trim() || undefined,
      score: result.score.score,
      maxScore: result.score.maxScore,
      percent: result.score.percent,
      stars: result.score.stars,
      durationS: result.durationS,
      answers: result.answers,
    });

    setSubmitting(false);
    if (!res.ok) {
      // Результат остаётся на экране: ученик жмёт «Попробовать ещё раз».
      setSubmitError(INTERACTIVE_ERROR_MESSAGE[res.error]);
      return;
    }

    setServerResult(res);
    setPhase("sent");
    // Попытка закрыта — хранить её нечего, чистим, чтобы «Начать» начало новое.
    clearAttempt(token);
  };

  /* ─── экраны ─────────────────────────────────────────────────────────── */

  const header = (
    <div className="mb-4">
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none mt-0.5" aria-hidden>
          {meta.emoji}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-warm-950 break-words">
            {interactive.title}
          </h1>
          <p className="text-sm text-warm-500 mt-0.5 break-words">
            {meta.title}
            {interactive.grade ? ` · ${interactive.grade} класс` : ""}
            {interactive.teacherLabel ? ` · ${interactive.teacherLabel}` : ""}
          </p>
        </div>
      </div>
    </div>
  );

  if (phase === "name" || phase === "resume") {
    const resume = phase === "resume";
    return (
      <div className="container-tight py-6 sm:py-10 max-w-lg mx-auto" data-interactive-shell="">
        <Card>
          {header}
          {resume && (
            <p className="text-sm text-warm-700 mb-4" data-testid="interactive-resume-hint">
              {name ? `${name}, ` : ""}вы уже начинали эту игру. Продолжить с того же
              места?
            </p>
          )}
          {!resume && (
            <p className="text-sm text-warm-600 mb-4">
              {meta.mechanic}. Отвечай с телефона — регистрация не нужна.
            </p>
          )}

          <Input
            label="Как тебя зовут?"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleStart();
            }}
            error={nameError ?? undefined}
            placeholder="Например, Аня"
            maxLength={STUDENT_NAME_MAX}
            autoComplete="off"
            data-testid="interactive-name"
          />
          <div className="mt-3">
            <Input
              label="Класс (если хочешь)"
              value={studentClass}
              onChange={(e) => setStudentClass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleStart();
              }}
              placeholder="Например, 5А"
              maxLength={20}
              autoComplete="off"
              data-testid="interactive-class"
            />
          </div>

          <p className="mt-3 text-xs text-warm-500 flex items-start gap-1.5">
            <User className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            Напишите только имя или ник. Мы не собираем фамилию, телефон или почту.
          </p>

          {startError && (
            <p className="mt-3 text-sm text-rose-600" role="alert">
              {startError}
            </p>
          )}

          {resume ? (
            <div className="mt-5 flex flex-col sm:flex-row gap-2">
              <Button
                className="flex-1"
                size="lg"
                onClick={handleResume}
                data-testid="interactive-resume"
              >
                Продолжить
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  clearAttempt(token);
                  setAttemptToken(null);
                  setSnapshot(null);
                  setPhase("name");
                }}
              >
                Начать сначала
              </Button>
            </div>
          ) : (
            <Button
              className="mt-5 w-full"
              size="lg"
              fullWidth
              loading={starting}
              onClick={() => void handleStart()}
              data-testid="interactive-start"
            >
              Начать
            </Button>
          )}
        </Card>
      </div>
    );
  }

  if (phase === "playing") {
    return (
      <div className="container-tight py-6 sm:py-10 max-w-2xl mx-auto" data-interactive-shell="">
        {header}
        <InteractivePlayer
          key={playKey}
          config={interactive}
          initial={snapshot}
          onChange={handleChange}
          onFinish={handleFinish}
        />
      </div>
    );
  }

  if ((phase === "done" || phase === "sent") && result) {
    // Числа показываем СЕРВЕРА, если он ответил: он пересчитал их из config_json
    // (ТЗ §4.7) и его версия — источник истины. Клиентский счёт нужен, только
    // чтобы показать итог мгновенно, до ответа сети.
    const final = serverResult
      ? {
          score: serverResult.score,
          maxScore: serverResult.maxScore,
          percent: serverResult.percent,
          stars: serverResult.stars,
        }
      : {
          score: result.score.score,
          maxScore: result.score.maxScore,
          percent: result.score.percent,
          stars: result.score.stars,
        };
    const summary = scoreSummary(interactive.format, { ...result.score, ...final });

    return (
      <div
        className="container-tight py-6 sm:py-10 max-w-lg mx-auto"
        data-interactive-shell=""
        data-interactive-finish=""
      >
        <Card className="text-center" data-testid="interactive-finish">
          <div
            className={cn(
              "w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-4",
              phase === "sent" ? "bg-brand-500 text-white shadow-brand" : "bg-brand-100 text-brand-700",
            )}
          >
            {phase === "sent" ? (
              <Check className="w-7 h-7" />
            ) : (
              <span className="text-2xl" aria-hidden>
                🏁
              </span>
            )}
          </div>

          <h2 className="text-2xl font-semibold text-warm-950">
            {phase === "sent" ? "Результат у учителя" : "Игра окончена"}
          </h2>
          <p className="mt-2 text-warm-700" data-testid="interactive-result-headline">
            {summary.headline}
          </p>

          <div className="mt-3 flex justify-center">
            <Stars count={final.stars} />
          </div>

          <ul className="mt-4 text-sm text-warm-600 space-y-1">
            {summary.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {result.durationS > 0 && <li>Время: {formatDuration(result.durationS)}</li>}
          </ul>

          {submitError && (
            <div
              className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                {submitError} Твой результат не потерян — нажми «Отправить ещё раз».
              </span>
            </div>
          )}

          <div className="mt-5 flex flex-col sm:flex-row gap-2">
            {phase === "done" ? (
              <Button
                className="flex-1"
                size="lg"
                loading={submitting}
                leftIcon={<Send className="w-4 h-4" />}
                onClick={() => void handleSubmit()}
                data-testid="interactive-submit"
              >
                {submitError ? "Отправить ещё раз" : "Отправить учителю"}
              </Button>
            ) : (
              <Button
                className="flex-1"
                size="lg"
                variant="secondary"
                leftIcon={<RefreshCw className="w-4 h-4" />}
                onClick={handleRestart}
                data-testid="interactive-restart"
              >
                Сыграть ещё раз
              </Button>
            )}
          </div>

          <p className="mt-3 text-xs text-warm-500">
            {phase === "sent"
              ? "Можно закрыть вкладку."
              : "Учитель увидит твой результат в своём кабинете."}
          </p>
        </Card>
      </div>
    );
  }

  return null;
}

/* ─── мелкие подкомпоненты ───────────────────────────────────────────────── */

export function Stars({ count }: { count: number }) {
  const safe = Math.max(0, Math.min(3, Math.round(count)));
  return (
    <div className="flex gap-1" aria-label={`Звёзды: ${safe} из 3`} data-testid="interactive-stars">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("text-2xl", i <= safe ? "" : "opacity-25 grayscale")}
          aria-hidden
        >
          ⭐
        </span>
      ))}
    </div>
  );
}

/** Секунды → «3 мин 12 с». */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} с`;
  const min = Math.floor(total / 60);
  const rest = total % 60;
  return rest > 0 ? `${min} мин ${rest} с` : `${min} мин`;
}
