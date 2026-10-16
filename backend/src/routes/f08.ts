/**
 * /api/worksheets/:id/edit (PATCH) — правка сгенерированного листа учителем.
 *
 * Файл раньше был заглушкой F-08 и отдавал 501 на любом пути. Теперь здесь
 * живёт настоящая ручка правки — см. ТЗ-30, AD-2 и AD-3.
 *
 * ─── ПОЧЕМУ РОУТ ПОД /api/worksheets, А НЕ ОТДЕЛЬНЫЙ ПРЕФИКС ──────────────
 * Ручка уже смонтирована на `/api/worksheets` в `src/index.ts`, и менять
 * монтирование — значит трогать чужой файл. Путь внутри роутера при этом
 * объявлен как `/:id/edit`, то есть снаружи это `PATCH /api/worksheets/:id/edit`.
 *
 * ─── AD-2: ПЕРЕСБОРКА, А НЕ РЕГЕНЕРАЦИЯ ───────────────────────────────────
 * Мы НЕ зовём LLM. Берём сохранённый `payload_json`, подменяем в нём
 * `tasks[]` присланным и перезаписываем строку. Причина продуктовая:
 * регенерация = другой лист И ещё одна платная генерация за опечатку,
 * которую учитель уже оплатил. Поэтому здесь нет ни `consumeGenerationQuota`,
 * ни `guardGeneration` — квота не трогается вообще, и это проверяется тестом
 * по счётчику в `usage_counters`/`rate_limits`.
 *
 * ─── AD-3: ПРАВКА ЗАКРЫТА ПОСЛЕ ПРОВЕРКИ ──────────────────────────────────
 * Если по листу уже есть работа с отметками (`photo_checks` по этому
 * worksheet_id), правка запрещена: 409 с понятным объяснением. Лист в работе
 * ученика и отметка учителя — это то, что нельзя менять задним числом, иначе
 * ученик принесёт сдачу, а учитель увидит другой текст.
 *
 * ─── ПОЧЕМУ ЧУЖОЙ ЛИСТ — 404, А НЕ 403 ───────────────────────────────────
 * Ровно как в `interactives.ts`: по коду ответа нельзя отличить «нет такого
 * листа» от «есть, но не твой», а по перебору id это лазейка проверить,
 * какие id вообще существуют.
 *
 * ─── ПОЧЕМУ ПУСТЫЕ ПОЛЯ НЕ СОХРАНЯЮТСЯ ───────────────────────────────────
 * Пустое задание — это не задание, а мусор, который учитель потом увидит в
 * DOCX. Пустые ответ и пояснение разрешены (их может не быть by design), но
 * пустой `text` — ошибка 400 с указанием номера задания, чтобы под полем
 * было что показать.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
} from "../lib/errors";
import { getWorksheetById, getWorksheetOwnerId } from "../services/worksheet";

const f08Router = new Hono<AppEnv>();

/**
 * Тело правки: список заданий целиком.
 *
 * Список, а не точечный `PATCH {taskId, text}`: учитель правит лист
 * последовательно (нашёл опечатку → поправил → нашёл вторую), и список
 * позволяет сохранить весь результат одним нажатием, не теряя правок из-за
 * гонки двух вкладок. `skill` сохраняется, если пришёл: метка темы — часть
 * задания, и терять её при правке текста нельзя.
 */
const EditBody = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        number: z.number().int().positive().optional(),
        // Текст задания обязателен и не может состоять из одних пробелов.
        // zod проверяет `.min(1)` ДО обрезки, поэтому «   » прошло бы как
        // непустая строка, а учитель увидел бы в DOCX пустое задание.
        // Поэтому обрезаем здесь же, а не молча чистим при сохранении:
        // пустое задание — это ошибка ввода с причиной под полем.
        text: z
          .string()
          .max(2000)
          .transform((s) => s.trim())
          .refine((s) => s.length > 0, "текст задания не может быть пустым"),
        type: z
          .enum(["computation", "multiple-choice", "short-answer", "essay", "fill-blank"])
          .optional(),
        options: z.array(z.string().max(500)).max(20).optional(),
        // Ответ и пояснение можно не присылать — тогда лист их не имеет.
        // Пустая строка и undefined сохраняются одинаково: поля нет.
        answer: z.string().max(2000).optional(),
        explanation: z.string().max(2000).optional(),
        points: z.number().int().nonnegative().max(100).optional(),
        skill: z.string().max(120).optional(),
      }),
    )
    .min(1, "нужно хотя бы одно задание")
    .max(100),
});

/** Непустая после обрезки строка — иначе поле считаем пустым. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Проверка: по листу уже проверяли работу?
 *
 * Смотрим ЛЮБУЮ строку photo_checks по этому листу со статусом 'ok' или
 * 'partial' — то есть работа уже загружена и по ней выставлены баллы.
 * Проверенную работу видно учителю и ученику, и менять текст задания после
 * этого — значит переписать то, что уже состоялось.
 */
async function hasCheckedWork(db: D1Database, worksheetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM photo_checks
       WHERE worksheet_id = ?1 AND status IN ('ok', 'partial')
       LIMIT 1`,
    )
    .bind(worksheetId)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

/**
 * Загрузить лист и убедиться, что он учителя.
 *
 * Бросает 404, если листа нет или он чужой: по ответу нельзя перебрать чужие
 * id (та же причина, что в interactives.ts и в GET /api/worksheets/:id).
 */
async function loadOwnWorksheet(c: Context<AppEnv>, userId: string) {
  // `c.req.param` типизирован как опциональный, хотя при совпадении маршрута
  // значение всегда есть. Проверяем явно: пустой id не должен доходить до
  // запроса в базу, где он просто ничего не найдёт.
  const id = c.req.param("id");
  if (!id) throw new NotFoundError("Worksheet not found");
  const ws = await getWorksheetById(c.env.DB, id);
  // Отсутствие листа и чужой лист отвечают одинаково — иначе разные коды
  // выдают переборщику список существующих id.
  if (!ws) throw new NotFoundError("Worksheet not found");

  // Владелец лежит в колонке `worksheets.user_id`, а не в payload: payload —
  // это сам артефакт, и он же переписывается правкой. Ровно так же проверяет
  // владельца GET /api/worksheets/:id (см. getWorksheetOwnerId).
  //
  // Анонимный лист (user_id IS NULL) править нельзя: подписаться под ним
  // некому, и правка ушла бы в никуда.
  const ownerId = await getWorksheetOwnerId(c.env.DB, id);
  if (ownerId !== userId) throw new NotFoundError("Worksheet not found");
  return { id, ws };
}

/**
 * Основной путь правки — `PATCH /api/worksheets/:id`, как в контракте ТЗ-30
 * §7. Ниже этот же обработчик продублирован на `/:id/edit`: историческое
 * имя F-08, которым роут смонтирован, и его уже могли закешировать клиенты.
 * Оба адреса отвечают одинаково — расхождение путей было бы неловким
 * «работает, но не там» для учителя.
 */
f08Router.patch("/:id", editWorksheet);
// Тот же обработчик под историческим именем F-08.
f08Router.patch("/:id/edit", editWorksheet);

/**
 * Сам обработчик правки. Вынесен функцией, потому что на него зарегистрированы
 * два адреса (см. выше).
 */
async function editWorksheet(c: Context<AppEnv>) {
  const user = requireAuth(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }

  const { id, ws } = await loadOwnWorksheet(c, user.id);

  // Правка возможна только у рабочего листа: у плана урока, презентации и КТП
  // нет tasks[], и такой список пришёл бы в поле, которое никто не читает.
  if (!Array.isArray(ws.tasks) || ws.tasks.length === 0) {
    throw new BadRequestError("Редактировать можно только рабочий лист с заданиями");
  }

  // AD-3: проверка ДО разбора тела. Порядок важен: при разбирах тела учителю
  // показали бы «невалидный JSON» там, где честный ответ — «правка закрыта,
  // по листу уже проверена работа».
  if (await hasCheckedWork(c.env.DB, id)) {
    throw new ConflictError(
      "по этому листу уже проверена работа — правка закрыта",
      { code: "WORKSHEET_LOCKED_BY_GRADING" },
    );
  }

  const parsed = EditBody.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError("Проверьте задания: текст задания не может быть пустым", {
      issues: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
  }

  // Пересборка структуры: сохраняем ТОЛЬКО непустые поля. Пустой ответ или
  // пустое пояснение в базу не пишутся, иначе DOCX зря занимает строку
  // «Ответ: —», а учитель будет думать, что ответ стёрт ошибкой.
  const previous = ws.tasks as unknown as Array<Record<string, unknown>>;
  const tasks = parsed.data.tasks.map((t, i) => {
    const old = previous[i] ?? {};
    const merged: Record<string, unknown> = {
      ...old,
      id: t.id ?? (typeof old.id === "string" ? old.id : `t${i + 1}`),
      number: t.number ?? (typeof old.number === "number" ? old.number : i + 1),
      text: t.text.trim(),
    };
    // Значения, которые правящий мог не прислать, берём из старого задания.
    for (const key of ["type", "options", "points", "skill", "verified", "verifiedExplanation"] as const) {
      const incoming = (t as Record<string, unknown>)[key];
      if (incoming !== undefined) merged[key] = incoming;
    }
    // Ответ и пояснение: пришли непустыми — пишем; пришли пустыми — УДАЛЯЕМ.
    // Раньше здесь стояло «пустое значит не прислал, берём старый», и это было
    // неправильно: учитель, который стёр ответ, видел бы на следующем
    // открытии старый ответ и не мог понять, сохранилась ли правка. Явное
    // пустое — это «убери», а «не прислал поле совсем» — это «оставь как
    // было». Разница видна учителю и потому не должна быть скрыта.
    const answer = nonEmpty(t.answer);
    const explanation = nonEmpty(t.explanation);
    if (answer !== undefined) merged.answer = answer;
    else delete merged.answer;
    if (explanation !== undefined) merged.explanation = explanation;
    else delete merged.explanation;
    return merged;
  });

  const updated = { ...ws, tasks };

  // Одна запись: payload_json — источник для GET /api/worksheets/:id и для
  // DOCX, а count обязан совпадать с числом заданий, иначе карточка в кабинете
  // покажет старое количество.
  await c.env.DB
    .prepare(`UPDATE worksheets SET payload_json = ?2, count = ?3 WHERE id = ?1`)
    .bind(id, JSON.stringify(updated), tasks.length)
    .run();

  return c.json({
    ok: true,
    worksheet: updated,
    // Явно возвращаем факт: квота не списана. Это и обещание продукта, и
    // то, что учитель может проверить, не дожидаясь звонка в поддержку.
    quotaCharged: false,
    // Причина, по которой правка закрыта, отдаётся кодом: фронт по нему
    // показывает текст, а не молча прячет кнопку.
    lockedByGrading: false,
  });
}

/**
 * GET /api/worksheets/:id/edit — можно ли править этот лист и почему.
 *
 * Отдельный эндпоинт нужен фронту для одного решения: показывать кнопку
 * «Редактировать» активной или с объяснением. Без него кнопка либо всегда
 * активна (и учитель упирается в 409 уже после правки), либо всегда неактивна.
 * Ответ — чтение, LLM и квоты он не касается.
 */
f08Router.get("/:id/edit", async (c) => {
  const user = requireAuth(c);
  const { id } = await loadOwnWorksheet(c, user.id);
  const locked = await hasCheckedWork(c.env.DB, id);
  return c.json({
    ok: true,
    editable: !locked,
    // null — правка разрешена. Не пустая строка, чтобы фронт отличал
    // «можно» от «неизвестно».
    reason: locked ? "по этому листу уже проверена работа — правка закрыта" : null,
  });
});

export { f08Router };