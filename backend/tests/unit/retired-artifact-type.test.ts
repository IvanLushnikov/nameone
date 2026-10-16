/// <reference types="@cloudflare/vitest-plugin" />
/**
 * ТЗ-30 AD-4, ПРОБЕЛ 2: серверная защита от типа артефакта, снятого с продукта.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 *
 * Тип «картинки» убран с продукта: провайдера генерации изображений нет, а
 * шесть типов артефактов, из которых один не работает, хуже пяти рабочих. На
 * бэке ключ убрали из `ARTIFACT_TASK` — и этого оказалось НЕДОСТАТОЧНО.
 *
 * Дыра была в `taskForArtifact`: `ARTIFACT_TASK[type] ?? "worksheet-gen"`.
 * То есть запрос `{"request": {..., "type": "image"}}` не падал, а тихо
 * ехал на генерацию рабочего листа, отвечал 200 листом и СПИСЫВАЛ квоту.
 * Для учителя это выглядело как «картинка не получилась, попробуй ещё раз»,
 * а на деле он платил за рабочий лист, которого не просил.
 *
 * Что проверяем по-разному, потому что цена ошибки разная:
 *
 *   1) HTTP-уровень (главное): запрос со снятым типом отклоняется ДО генерации
 *      и ДО списания квоты. Проверяем не только код ответа, но и то, что в
 *      базе не появилось ни строки листа, ни события, ни расхода токенов —
 *      потому что «отказ с кодом 400, но квоту уже списал» — это тот же баг.
 *
 *   2) Юнит-уровень на `taskForArtifact`: снятый тип обязан бросать, а НЕ
 *      отдавать `worksheet-gen`. Неизвестный тип (новый, которого ещё нет в
 *      таблице) по-прежнему трактуется как рабочий лист — иначе каждый новый
 *      тип артефакта, добавленный на фронте раньше бэка, ронял бы генерацию.
 *
 * Схема — настоящая `src/db/schema.sql`, как в `freeQuotaAccounting.test.ts`:
 * проверка «квота не списалась» без таблиц была бы проверкой ничего.
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { taskForArtifact, isRetiredArtifactType } from "../../src/llm/router";

beforeAll(async () => {
  await applyD1Migrations(env.DB, [
    { name: "tz30-retired-artifact-type", queries: [schemaSql] },
  ]);
});

const db = env.DB as unknown as D1Database;

/** Тело запроса листа, где меняется только `type`. */
function bodyWithType(type: string) {
  return {
    request: {
      subject: "math",
      grade: 5,
      topic: "Обыкновенные дроби",
      difficulty: "medium",
      count: 3,
      type,
      withAnswers: true,
      withExplanations: true,
    },
  };
}

async function postWorksheet(type: string) {
  const res = await SELF.fetch("https://uchlist.test/api/worksheets/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyWithType(type)),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Сколько строк в таблице `table` — общий снимок расхода до/после запроса. */
async function countRows(table: string): Promise<number> {
  const res = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return res?.n ?? -1;
}

describe("снятый тип артефакта отклоняется сервером", () => {
  it("POST /api/worksheets/generate с type=image → 400, а не рабочий лист", async () => {
    const { status, json } = await postWorksheet("image");

    expect(status).toBe(400);
    // Клиент должен получить внятную причину, а не «500, попробуйте позже».
    expect(JSON.stringify(json)).toContain("image");
    expect(json).toMatchObject({ ok: false });
  });

  it("отказ не создаёт расхода: ни листа, ни события, ни токенов", async () => {
    // Снимок ДО. Таблицы берём те же, куда пишет путь генерации.
    const tables = ["worksheets", "events", "llm_logs", "usage_counters"];
    const before = await Promise.all(tables.map(countRows));

    const { status } = await postWorksheet("image");
    expect(status).toBe(400);

    const after = await Promise.all(tables.map(countRows));
    // Главное здесь — не длина ответа, а расход. Запрос, который отклонён
    // ДО генерации, не должен оставить след ни в одной из таблиц: иначе
    // учителю показали отказ, а списали квоту.
    for (let i = 0; i < tables.length; i++) {
      expect(after[i], `в ${tables[i]} появилась запись после отказа`).toBe(before[i]);
    }
  });

  it("тот же запрос с рабочим типом доходит до генерации (тест не проходит «всегда 400»)", async () => {
    // Контроль: с `worksheet` запрос не должен отсекаться нашей проверкой.
    // Ожидаемый код здесь не фиксируем — до провайдера дело дойдёт или нет в
    // зависимости от окружения, — но это точно НЕ 400 про «больше не доступен».
    const { status, json } = await postWorksheet("worksheet");
    const body = JSON.stringify(json);
    expect(status === 400 && body.includes("больше не доступен")).toBe(false);
  });
});

describe("taskForArtifact: снятый тип бросает, неизвестный — нет", () => {
  it("снятый тип не подменяется рабочим листом", () => {
    expect(() => taskForArtifact("image")).toThrowError();
    expect(isRetiredArtifactType("image")).toBe(true);
  });

  it("неизвестный тип по-прежнему трактуется как рабочий лист", () => {
    // Граница: «не знаю такой тип» и «этот тип отключён осознанно» — разные
    // вещи. Первое случается с каждым новым типом артефакта, добавленным на
    // фронте раньше бэка, и не должно ронять генерацию.
    expect(taskForArtifact("что-то-новое")).toBe("worksheet-gen");
    expect(isRetiredArtifactType("что-то-новое")).toBe(false);
  });

  it("рабочие типы не объявлены снятыми", () => {
    for (const t of ["worksheet", "test", "cards", "lesson-plan", "materials", "interactive"]) {
      expect(isRetiredArtifactType(t), `${t} не должен считаться снятым`).toBe(false);
    }
  });
});