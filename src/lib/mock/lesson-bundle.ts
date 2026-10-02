/**
 * TZ-16 §3.4: «Урок целиком» — комплект из 4 артефактов одной темы.
 *
 * КЛЮЧЕВОЕ ПРОЕКТНОЕ РЕШЕНИЕ — параллельно, а не последовательно.
 *
 * Четыре слота запускаются одним `Promise.allSettled`, а НЕ циклом с `await`
 * и НЕ `Promise.all`. Причина из ТЗ:
 *   • последовательно: учитель ждёт 4 × 15 = 60 сек, и при первом же отказе
 *     (429 / 5xx / таймаут) не получает НИЧЕГО — `Promise.all` и последовательный
 *     цикл теряют успешные слоты вместе с упавшим;
 *   • параллельно: всё, что успело, возвращается за ~20 сек (столько же, сколько
 *     самый долгий из 4 вызовов), а неудачные слоты попадают в `failed`
 *     вместе с причиной и показываются в UI.
 *
 * Именно поэтому `failed` — часть контракта `LessonBundle`, а не исключение:
 * частичный результат для учителя полезнее пустого экрана с «попробуйте ещё раз».
 *
 * Этот файл собирает 4 готовых мока из уже существующих мок-генераторов
 * (`lesson-plan.ts` / `presentation.ts` / `generator.ts`) — своего копипаста
 * логики генерации здесь нет намеренно.
 *
 * Edge case: тема не нашлась в таксономии → моки-генераторы не падают, а отдают
 * содержимое по общим шаблонам предмета. Комплект собирается, `failed: []`.
 */
import type {
  GenerationRequest,
  LessonBundle,
  LessonPlan,
  Presentation,
  Worksheet,
} from "@/lib/types";
import { generateLessonPlan } from "@/lib/mock/lesson-plan";
import { generatePresentation } from "@/lib/mock/presentation";
import { generateWorksheet } from "@/lib/mock/generator";
import { getTopic } from "@/lib/content/subjects";
import { shortId } from "@/lib/utils/cn";

/** Порядок слотов фиксирован — он же порядок файлов в ZIP и блоков в превью. */
export const BUNDLE_SLOTS = ["lesson-plan", "presentation", "worksheet", "test"] as const;

export type BundleSlotKey = (typeof BUNDLE_SLOTS)[number];

/**
 * Таймаут пакета (ТЗ §10, DoD): 90 сек. Что не успело — уходит в `failed`
 * с причиной, остальное отдаётся учителю.
 */
export const BUNDLE_TIMEOUT_MS = 90_000;

/** Фабрики слотов. Отдельная сигнатура нужна, чтобы тест мог подсунуть падающий слот. */
export interface BundleFactories {
  "lesson-plan": () => Promise<LessonPlan>;
  presentation: () => Promise<Presentation>;
  worksheet: () => Promise<Worksheet>;
  test: () => Promise<Worksheet>;
}

/** Причина отказа в человеческих словах — её показывают в UI без перевода. */
function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string" && err) return err;
  return "неизвестная ошибка";
}

/**
 * Один слот с таймаутом. Отказ по таймауту — такой же отказ, как и отказ LLM:
 * разницы для учителя нет, поэтому и в `failed` причина одна и та же.
 */
function withTimeout<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`превышено время ожидания (${Math.round(timeoutMs / 1000)} сек)`)),
      timeoutMs,
    );
    // Если слот упал раньше таймаута, таймер всё равно живёт — снимаем его,
    // иначе тесты иконка-приложения держали бы 90 сек на закрытом слоте.
    Promise.resolve()
      .then(factory)
      .then(
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

/**
 * Собирает комплект из 4 слотов ПАРАЛЛЕЛЬНО.
 *
 * `factories` можно подменить (тест частичного отказа). Все четыре вызова
 * стартуют в одном тике — между ними нет ни одного `await`, иначе это был бы
 * последовательный цикл под видом параллельного.
 */
export function buildLessonBundle(
  request: GenerationRequest,
  factories: BundleFactories,
  timeoutMs: number = BUNDLE_TIMEOUT_MS
): Promise<LessonBundle> {
  const started = Date.now();

  // Запускаем все 4 слота одним allSettled. Ни одного await до этого места —
  // это и есть «параллельно» из ТЗ.
  // Фабрики приводим к общей сигнатуре `() => Promise<unknown>`: у слотов
  // разные типы результата (LessonPlan / Presentation / Worksheet), а
  // конкретный тип достаётся ниже через `at<T>(slot)`.
  const runSlot = factories as Record<BundleSlotKey, () => Promise<unknown>>;
  const pending = Promise.allSettled(
    BUNDLE_SLOTS.map((slot) => withTimeout(runSlot[slot], timeoutMs))
  );

  return pending.then((settled) => {
    const failed: LessonBundle["failed"] = [];
    const at = <T,>(slot: BundleSlotKey): T | null => {
      const res = settled[BUNDLE_SLOTS.indexOf(slot)];
      if (!res || res.status === "rejected") return null;
      return res.value as T;
    };

    // allSettled сохраняет порядок, поэтому failed тоже идёт в порядке слотов.
    settled.forEach((res, i) => {
      if (res.status === "rejected") {
        failed.push({ slot: BUNDLE_SLOTS[i], reason: reasonOf(res.reason) });
      }
    });

    const topic = getTopic(request.subject, request.grade, request.topic);
    const topicTitle = topic?.title ?? request.topic;

    return {
      id: shortId(),
      title: `Урок целиком: ${topicTitle}, ${request.grade} класс`,
      subject: request.subject,
      grade: request.grade,
      topic: topic?.slug ?? request.topic,
      lessonPlan: at<LessonPlan>("lesson-plan"),
      presentation: at<Presentation>("presentation"),
      worksheet: at<Worksheet>("worksheet"),
      test: at<Worksheet>("test"),
      failed,
      totalMs: Date.now() - started,
      createdAt: new Date().toISOString(),
    };
  });
}

/**
 * Контракт мока: GenerationRequest → LessonBundle из 4 готовых артефактов,
 * `failed: []`. Реальный LLM-вызов для пакета в бэке не создаётся (TZ-16 §11) —
 * фасад `generateBundleSmart` откатывается сюда через `smartGenerate`.
 */
export async function mockLessonBundle(request: GenerationRequest): Promise<LessonBundle> {
  return buildLessonBundle(request, {
    "lesson-plan": () => generateLessonPlan({ ...request, type: "lesson-plan" }),
    presentation: () => generatePresentation({ ...request, type: "presentation" }),
    worksheet: () => generateWorksheet({ ...request, type: "worksheet" }),
    // Тест — тот же рабочий лист, но задания перепакованы в multiple-choice
    // (adaptTasksForType в mock/generator.ts). Это НЕ второй идентичный лист:
    // иначе в ZIP лежали бы два одинаковых файла.
    test: () => generateWorksheet({ ...request, type: "test" }),
  });
}
