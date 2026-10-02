/**
 * Тесты retention-политики для онлайн-форм (TZ-12 §5.4, ПДн).
 *
 * Что тут проверяется и почему это важно:
 *  • ответы ученика — персональные данные ребёнка, они не должны лежать вечно;
 *  • САМА форма при этом не удаляется — учитель не должен терять список
 *    выданных листов из-за retention-политики;
 *  • активная форма (есть свежие отправки) под нож не попадает;
 *  • флаг ставится ПОСЛЕ удаления данных, иначе упавший процесс навсегда
 *    «потерял» бы форму, оставив ПДн в базе.
 *
 * Запуск: `npx vitest run backend/tests/unit/purgeExpiredForms.test.ts`
 */

import { describe, it, expect } from "vitest";
import { purgeExpiredForms, RETENTION_SEC, BATCH_LIMIT } from "../../src/jobs/purgeExpiredForms";

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

/**
 * Минимальный фейк D1: понимает только те три запроса, которые делает
 * purgeExpiredForms. Нам важна не работа SQLite, а порядок операций и
 * правильность отбора форм.
 */
interface FakeD1Opts {
  forms: Array<{
    id: string;
    responses_purged: number;
    /** Время последней отправки по этой форме; null — ответов нет. */
    last_submitted_at: number | null;
    responses: number;
    answers: number;
  }>;
  /** id форм, на которых DELETE бросает исключение. */
  failOn?: string[];
}

function makeFakeD1(opts: FakeD1Opts) {
  const calls: Array<{ sql: string; phase: string }> = [];
  const state = opts.forms.map((f) => ({ ...f }));

  /** Записать вызов в лог. Вызывается в момент РЕАЛЬНОГО выполнения запроса. */
  const record = (sql: string, phase: string) =>
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), phase });

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all<T>() {
              if (sql.includes("FROM forms")) {
                record(sql, "select-forms");
                const cutoff = args[0] as number;
                const limit = args[1] as number;
                // Точное соответствие SQL: ответы ЕСТЬ, и ни один не свежее
                // отсечки. Свежая отправка должна навсегда исключить форму
                // из очистки, пока учитель её разбирает.
                const rows = state
                  .filter(
                    (f) =>
                      f.responses_purged === 0 &&
                      f.responses > 0 &&
                      f.last_submitted_at !== null &&
                      f.last_submitted_at <= cutoff,
                  )
                  .slice(0, limit);
                return { results: rows.map((r) => ({ id: r.id })) as T[] };
              }
              return { results: [] as T[] };
            },
            async first<T>() {
              record(sql, "count");
              const id = args[0] as string;
              const row = state.find((f) => f.id === id);
              return (
                row
                  ? ({ answers: row.answers, responses: row.responses } as T)
                  : null
              );
            },
            async run() {
              const id = args[0] as string;
              if (sql.includes("DELETE FROM form_answers")) {
                record(sql, "delete-answers");
                const row = state.find((f) => f.id === id);
                if (row) row.answers = 0;
              } else if (sql.includes("DELETE FROM form_responses")) {
                record(sql, "delete-responses");
                const row = state.find((f) => f.id === id);
                if (row) {
                  if (opts.failOn?.includes(id)) {
                    throw new Error("D1_BUSY: database is locked");
                  }
                  row.responses = 0;
                  row.last_submitted_at = null;
                }
              } else if (sql.includes("UPDATE forms")) {
                record(sql, "update-flag");
                const row = state.find((f) => f.id === id);
                if (row) row.responses_purged = 1;
              }
              return { success: true };
            },
          };
        },
      };
    },
  };

  return { db: db as never, state, calls };
}

describe("purgeExpiredForms (TZ-12 §5.4, retention ПДн)", () => {
  it("удаляет ответы формы, у которой последняя отправка старше 90 дней", async () => {
    const { db, state } = makeFakeD1({
      forms: [
        {
          id: "frm_old",
          responses_purged: 0,
          last_submitted_at: NOW - RETENTION_SEC - 5 * DAY,
          responses: 12,
          answers: 47,
        },
      ],
    });

    const result = await purgeExpiredForms(db, NOW);

    expect(result.formsFlagged).toBe(1);
    expect(result.responsesDeleted).toBe(12);
    expect(result.answersDeleted).toBe(47);
    expect(result.failed).toBe(0);
    expect(state[0]!.responses).toBe(0);
    expect(state[0]!.answers).toBe(0);
  });

  it("САМУ форму не удаляет — она остаётся в кабинете учителя", async () => {
    const { db, state } = makeFakeD1({
      forms: [
        {
          id: "frm_old",
          responses_purged: 0,
          last_submitted_at: NOW - RETENTION_SEC - DAY,
          responses: 3,
          answers: 8,
        },
      ],
    });

    await purgeExpiredForms(db, NOW);

    // Строка формы на месте — ищем её среди state, а не среди удалённых.
    expect(state).toHaveLength(1);
    expect(state[0]!.id).toBe("frm_old");
    expect(state[0]!.responses_purged).toBe(1);
  });

  it("не трогает форму со свежими отправками", async () => {
    const { db, state, calls } = makeFakeD1({
      forms: [
        {
          id: "frm_fresh",
          responses_purged: 0,
          last_submitted_at: NOW - 3 * DAY,
          responses: 30,
          answers: 120,
        },
      ],
    });

    const result = await purgeExpiredForms(db, NOW);

    expect(result.scanned).toBe(0);
    expect(result.formsFlagged).toBe(0);
    expect(state[0]!.responses).toBe(30);
    expect(state[0]!.responses_purged).toBe(0);
    // Ни одного DELETE не ушло — форма даже не выбиралась.
    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
  });

  it("не трогает форму, уже помеченную как очищенную (идемпотентность)", async () => {
    const { db } = makeFakeD1({
      forms: [
        {
          id: "frm_done",
          responses_purged: 1,
          last_submitted_at: NOW - RETENTION_SEC - 10 * DAY,
          responses: 0,
          answers: 0,
        },
      ],
    });

    const result = await purgeExpiredForms(db, NOW);
    expect(result.scanned).toBe(0);
  });

  it("форму без ответов пропускает — нечего удалять", async () => {
    const { db } = makeFakeD1({
      forms: [
        {
          id: "frm_empty",
          responses_purged: 0,
          last_submitted_at: null,
          responses: 0,
          answers: 0,
        },
      ],
    });

    const result = await purgeExpiredForms(db, NOW);
    expect(result.scanned).toBe(0);
  });

  it("одна сбойная форма не роняет весь проход", async () => {
    const { db, state } = makeFakeD1({
      forms: [
        {
          id: "frm_bad",
          responses_purged: 0,
          last_submitted_at: NOW - RETENTION_SEC - DAY,
          responses: 5,
          answers: 9,
        },
        {
          id: "frm_good",
          responses_purged: 0,
          last_submitted_at: NOW - RETENTION_SEC - 2 * DAY,
          responses: 4,
          answers: 11,
        },
      ],
      failOn: ["frm_bad"],
    });

    const result = await purgeExpiredForms(db, NOW);

    expect(result.failed).toBe(1);
    expect(result.formsFlagged).toBe(1);
    // Сбойная форма НЕ помечена очищенной → следующий прогон её подберёт.
    expect(state[0]!.responses_purged).toBe(0);
    expect(state[1]!.responses_purged).toBe(1);
  });

  it("ставит флаг ПОСЛЕ удаления данных, а не до", async () => {
    const { db, calls } = makeFakeD1({
      forms: [
        {
          id: "frm_x",
          responses_purged: 0,
          last_submitted_at: NOW - RETENTION_SEC - DAY,
          responses: 1,
          answers: 1,
        },
      ],
    });

    await purgeExpiredForms(db, NOW);

    const order = calls
      .filter((c) => c.phase.startsWith("delete") || c.phase === "update-flag")
      .map((c) => c.phase);
    expect(order).toEqual([
      "delete-answers",
      "delete-responses",
      "update-flag",
    ]);
  });

  it("RETENTION_SEC = 90 суток, BATCH_LIMIT защищает cron от длинного запроса", () => {
    expect(RETENTION_SEC).toBe(90 * 24 * 60 * 60);
    expect(BATCH_LIMIT).toBeGreaterThan(0);
    expect(BATCH_LIMIT).toBeLessThanOrEqual(200);
  });
});
