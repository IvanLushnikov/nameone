/**
 * Обращение к модели для сверки короткого ответа (лист 3.1.6).
 *
 * ── Почему этот файл существует отдельно ──────────────────────────────────────
 * Сервис разбора `services/formGrading.ts` обязан оставаться ЧИСТЫМ: ни D1, ни
 * env, ни HTTP. Когда импорт `../llm/router` стоял в самом сервисе, тестовый
 * пул workerd переставал собирать граф модулей и падал с «No such module» на
 * случайном пакете — 781 зелёный тест превращались в ноль. Ленивый
 * `await import` не помогает: сборщик поднимает динамический импорт обратно в
 * статический граф.
 *
 * Поэтому сеть живёт здесь, а разбор ответа — в сервисе. Модуль собирает
 * промпт, зовёт модель и отдаёт СЫРОЙ ответ в чистый `gradeFromModel`.
 * Роут отправки формы склеивает оба слоя.
 *
 * ── Правило, которое здесь главное ────────────────────────────────────────────
 * Функция НИКОГДА не бросает и никогда не возвращает «неправильно» из-за
 * собственной поломки. Нет ключа, нет сети, 5xx, таймаут, мусор вместо JSON —
 * всё это обычная ручная проверка учителю. Ученик не должен получать ноль в
 * журнале из-за того, что у нас закончились деньги на провайдера.
 *
 * `checkMethod === "llm"` означает, что решение приняла машина, `=== "manual"` —
 * что вердикта у машины нет.
 */

import type { Env } from "../env";
import type { WorksheetTask } from "../types";
import { pickModel, callWithFallback } from "./router";
import { buildShortAnswerPrompt } from "./prompts/form-grading";
import {
  gradeFromModel,
  gradeManual,
  gradeManualByType,
  rawToString,
  type ShortAnswerGrade,
  type StudentValue,
} from "../services/formGrading";

/** Контекст для вызова модели. Всё необязательное — кроме env. */
export interface GradeWithModelArgs {
  task: WorksheetTask;
  value: StudentValue;
  env: Env;
  subject?: string;
  grade?: number;
  /** Кто просит сверку — для логов LLM-слоя. */
  userId?: string | null;
  plan?: string;
  /**
   * Сколько ждать модель. По умолчанию SHORT_ANSWER_LLM_TIMEOUT_MS.
   * Отдельный параметр — чтобы тест проверил таймаут за миллисекунды, а не за
   * двенадцать секунд ожидания.
   */
  timeoutMs?: number;
}

/**
 * Потолок ожидания модели на ОДИН ответ.
 *
 * В провайдере таймаута нет, и это осознанно: там общий клиент на все задачи.
 * Но ученик стоит с телефоном и ждёт «Отправлено» — висящий запрос провайдера
 * для него выглядит как сломанная кнопка. 12 секунд: дольше обычного ответа,
 * короче терпения человека перед уроком.
 */
export const SHORT_ANSWER_LLM_TIMEOUT_MS = 12_000;

/**
 * Обернуть промис потолком ожидания.
 *
 * `Promise.race` с таймером здесь не годится: он оставляет висящий таймер и
 * «съеденное» отклонение оригинального промиса, из-за чего workerd начинает
 * писать про unhandled rejection. Поэтому таймер гасится в обеих ветках.
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SHORT_ANSWER_LLM_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Ответ модели без вердикта: «модель позвали, но решения от неё нет». */
function modelFailed(reason: string): ShortAnswerGrade {
  return {
    ...gradeManual(reason),
    modelVerdict: null,
    confidence: null,
    comment: null,
    decidedBy: "model",
  };
}

/** Сверить короткий ответ ученика моделью. Никогда не бросает. */
export async function gradeShortAnswerWithLlm(args: GradeWithModelArgs): Promise<ShortAnswerGrade> {
  const { task, value, env } = args;

  // Эссе и не-short-answer сюда не попадают по контракту, но проверка дешёвая
  // и защищает от вызова модели там, где она не нужна.
  if (task.type !== "short-answer") {
    return {
      ...gradeManualByType(task.type),
      modelVerdict: null,
      confidence: null,
      comment: null,
      decidedBy: "model",
    };
  }

  const studentAnswer = rawToString(value).trim();
  const expected = (task.answer ?? "").trim();
  const points = Number.isFinite(task.points) ? Math.max(0, Math.trunc(task.points)) : 0;

  // Пустой ответ и пустой эталон — до модели. Платить за сверку пустоты
  // незачем, и «нет ответа» ≠ «неправильно»: это решение учителя.
  if (studentAnswer === "") {
    return modelFailed("Ученик не ответил на короткий вопрос");
  }
  if (expected === "") {
    return modelFailed("Пустой эталон — сверять не с чем");
  }

  const decision = pickModel("short-answer-check", env);
  if (!decision.primary) {
    // Нет ключа polza — это штатная конфигурация демо, а не авария.
    return modelFailed("Модель недоступна — проверьте ответ сами");
  }

  const { system, user } = buildShortAnswerPrompt(
    { number: task.number, taskText: task.text, expected, studentAnswer, points },
    { subject: args.subject, grade: args.grade },
  );

  const timeoutMs =
    typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
      ? Math.trunc(args.timeoutMs)
      : SHORT_ANSWER_LLM_TIMEOUT_MS;

  try {
    const result = await withDeadline(
      callWithFallback(
        {
          model: decision.primary.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          responseFormat: "json",
          temperature: 0.1, // сверка — почти детерминированная задача
          maxTokens: 300,
          // Системный промпт один и тот же для всех ответов класса: кэш
          // провайдера делает 2-й..30-й ответ почти бесплатными.
          cacheSystemPrompt: true,
        },
        decision,
        env,
        { task: "short-answer-check", userId: args.userId ?? null, plan: args.plan ?? "free" },
      ),
      timeoutMs,
    );

    return gradeFromModel(result.response.content, points);
  } catch {
    // Провайдер упал, ответ не пришёл, сеть отвалилась, истёк таймаут — без
    // разницы. Учителю всё равно нужен ответ, а не код ошибки от polza.
    return modelFailed("Модель не ответила — проверьте ответ сами");
  }
}