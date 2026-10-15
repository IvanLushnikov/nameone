/// <reference types="@cloudflare/vitest-plugin" />
/**
 * Материалы учителей: сдача на публикацию, модерация, чужие материалы (лист 5.1.1).
 *
 * Проверяем сквозной путь через настоящие роуты (SELF.fetch) и настоящий D1:
 *
 *   S1  Учитель сдаёт материал — он принят, но В ОБЩЕМ БАНКЕ НЕ ПОЯВЛЯЕТСЯ.
 *       Это главный тест листа: чужая работа не должна разойтись раньше, чем её
 *       посмотрит человек.
 *   S2  Чужой материал нельзя ни поправить, ни снять, ни удалить — 403, а не 404
 *       (иначе «не твоё» неотличимо от «нет такого»).
 *   S3  Опубликованное не правится и не удаляется молча: сначала снять с публикации.
 *   S4  Отказ без причины невозможен; с причиной — учитель её видит.
 *   S5  Модерацию делает владелец: обычный учитель публиковать не может.
 *   S6  В банке видно, кто принёс материал, и НЕ видно почты автора.
 *   S7  Чужие черновики не видны: в «моих» материалах нет чужих строк.
 *   S8  Счётчик скачиваний настоящий: растёт по опубликованному, черновик не
 *       скачивается вовсе.
 *   S9  Без входа нельзя ни сдать материал, ни посмотреть свои.
 *
 * LLM не вызывается НИГДЕ: на пути листа нет генерации, все решения принимает
 * человек, поэтому ключ провайдера тесту не нужен.
 *
 * Схема D1 зашита в SCHEMA_SQL: workerd не имеет fs.readFileSync.
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * DDL листа взят ДОСЛОВНО из `db/migrations/0003_user_materials.ts` и из
 * `db/schema.sql`-эпохи: таблицы пользователей и сессий нужны мидлваре входа,
 * `rate_limits` — лимиту на чтение списков. Остальное листу не требуется.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT,
  plan                TEXT NOT NULL DEFAULT 'free',
  generations_total   INTEGER NOT NULL DEFAULT 0,
  generations_today   INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  stripe_customer_id  TEXT,
  yookassa_customer_id TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_materials (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name    TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  subject        TEXT NOT NULL,
  grade          INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('worksheet','cards','bundle')),
  content_json   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','published','rejected','withdrawn')),
  reject_reason  TEXT,
  moderated_by   TEXT,
  moderated_at   INTEGER,
  downloads      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_materials_owner ON user_materials(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_materials_public ON user_materials(status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_material_downloads (
  id          TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES user_materials(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_umd_material ON user_material_downloads(material_id, created_at DESC);
`;

/* ───────────────────────────────────────────────────────────────────────────
 * Фикстуры
 * ─────────────────────────────────────────────────────────────────────────── */

const TEACHER = "usr_teacherone1";
const OTHER_TEACHER = "usr_teachertwo1";
const OWNER = "usr_siteowner1";
const SESSION_A = "sess_materials_teacher_a";
const SESSION_B = "sess_materials_teacher_b";
const SESSION_OWNER = "sess_materials_owner";

/** Почта автора не должна попасть в общий банк ни при каких условиях. */
const TEACHER_EMAIL = "author-private@example.test";

function auth(session: string): Record<string, string> {
  return { Cookie: `session=${session}`, "Content-Type": "application/json" };
}

function anon(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

/** Тело сдачи материала — то, что присылает форма учителя. */
function materialBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Рабочий лист по дробям",
    description: "Лист на один урок: пять заданий на дроби с разными знаками.",
    subject: "math",
    grade: 5,
    kind: "worksheet",
    tasks: [
      { text: "Сравните 3/7 и 5/9." },
      { text: "Найдите разность 7/8 − 2/8." },
      { text: "Сократите дробь 18/24." },
    ],
    ...overrides,
  };
}

interface MaterialView {
  id: string;
  title: string;
  authorName: string;
  status?: string;
  rejectReason?: string | null;
  downloads: number;
  tasks: Array<{ number: number; text: string }>;
  canEdit?: boolean;
  canWithdraw?: boolean;
  canDelete?: boolean;
}

async function submit(
  session: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { material?: MaterialView } }> {
  const res = await SELF.fetch("https://worker.test/api/materials/user", {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify(materialBody(overrides)),
  });
  return { status: res.status, body: (await res.json()) as { material?: MaterialView } };
}

async function publicList(): Promise<MaterialView[]> {
  const res = await SELF.fetch("https://worker.test/api/materials/user", { headers: anon() });
  const body = (await res.json()) as { materials: MaterialView[] };
  return body.materials;
}

async function ownList(session: string): Promise<MaterialView[]> {
  const res = await SELF.fetch("https://worker.test/api/materials/user/mine", { headers: auth(session) });
  const body = (await res.json()) as { materials: MaterialView[] };
  return body.materials;
}

async function approve(session: string, id: string): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/materials/moderation/${id}/approve`, {
    method: "POST",
    headers: auth(session),
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * Тесты
 * ─────────────────────────────────────────────────────────────────────────── */

describe("материалы учителей: сдача, модерация, чужие материалы (лист 5.1.1)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    const now = Math.floor(Date.now() / 1000);
    const people = [
      [TEACHER, TEACHER_EMAIL, "Учитель Обычный", 0, SESSION_A],
      [OTHER_TEACHER, "other@example.test", "Учитель Другой", 0, SESSION_B],
      [OWNER, "owner@example.test", "Владелец сайта", 1, SESSION_OWNER],
    ] as const;

    for (const [id, email, name, isAdmin, session] of people) {
      await env.DB
        .prepare(
          `INSERT INTO users (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'base', 0, 0, ?4, ?5, ?5)`,
        )
        .bind(id, email, name, isAdmin, now)
        .run();
      await env.DB
        .prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind(session, id, now + 86400, now)
        .run();
    }
  });

  // ── S1. ГЛАВНЫЙ ТЕСТ ЛИСТА: сдал ≠ опубликовано ───────────────────────────
  it("S1: сданный материал ждёт решения и не появляется в общем банке", async () => {
    const res = await submit(SESSION_A);
    expect(res.status).toBe(201);
    const material = res.body.material!;
    expect(material.status).toBe("pending");

    // Общий банк — пуст: материал учителя никто не видит.
    expect(await publicList()).toHaveLength(0);

    // И по прямой ссылке он тоже не открывается: «отдал автору» ≠ «доступен всем».
    const direct = await SELF.fetch(`https://worker.test/api/materials/user/${material.id}`, {
      headers: anon(),
    });
    expect(direct.status).toBe(404);

    // Но автор видит его у себя — вместе со словарём статуса.
    const mine = await ownList(SESSION_A);
    const found = mine.find((m) => m.id === material.id)!;
    expect(found).toBeDefined();
    expect(found.status).toBe("pending");
    expect(found.rejectReason).toBeNull();

    // И в базе он лежит именно как `pending`, а не «где-то ещё статус».
    const row = await env.DB
      .prepare("SELECT status FROM user_materials WHERE id = ?1")
      .bind(material.id)
      .first<{ status: string }>();
    expect(row!.status).toBe("pending");
  });

  // ── S2. ЧУЖОЙ МАТЕРИАЛ НЕ ТРОГАЕМ ────────────────────────────────────────
  it("S2: чужой материал нельзя поправить, снять и удалить — 403, а не 404", async () => {
    const created = await submit(SESSION_A);
    const id = created.body.material!.id;

    const patch = await SELF.fetch(`https://worker.test/api/materials/user/${id}`, {
      method: "PATCH",
      headers: auth(SESSION_B),
      body: JSON.stringify(materialBody({ title: "Чужое название" })),
    });
    // Именно 403: 404 означал бы «нет такого», и учитель решил бы, что выдумал.
    expect(patch.status).toBe(403);

    const withdraw = await SELF.fetch(`https://worker.test/api/materials/user/${id}/withdraw`, {
      method: "POST",
      headers: auth(SESSION_B),
    });
    expect(withdraw.status).toBe(403);

    const remove = await SELF.fetch(`https://worker.test/api/materials/user/${id}`, {
      method: "DELETE",
      headers: auth(SESSION_B),
    });
    expect(remove.status).toBe(403);

    // Материал учителя Б после всех попыток — нет: чужой не создался.
    expect((await ownList(SESSION_B))).toHaveLength(0);
    // Материал учителя А цел и не тронут.
    const row = await env.DB
      .prepare("SELECT title, status FROM user_materials WHERE id = ?1")
      .bind(id)
      .first<{ title: string; status: string }>();
    expect(row!.title).toBe("Рабочий лист по дробям");
    expect(row!.status).toBe("pending");
  });

  // ── S3. ОПУБЛИКОВАННОЕ НЕ ПРАВИТСЯ МОЛЧА ─────────────────────────────────
  it("S3: опубликованное сначала снимают с публикации, потом правят и удаляют", async () => {
    const created = await submit(SESSION_A, { title: "Карточки по природе" });
    const id = created.body.material!.id;
    expect((await approve(SESSION_OWNER, id)).status).toBe(200);

    // Опубликованное не редактируется и не удаляется на месте.
    const patch = await SELF.fetch(`https://worker.test/api/materials/user/${id}`, {
      method: "PATCH",
      headers: auth(SESSION_A),
      body: JSON.stringify(materialBody({ title: "Тихо исправленное" })),
    });
    expect(patch.status).toBe(409);

    const remove = await SELF.fetch(`https://worker.test/api/materials/user/${id}`, {
      method: "DELETE",
      headers: auth(SESSION_A),
    });
    expect(remove.status).toBe(409);

    // Снял с публикации — теперь можно и править, и удалить.
    const withdrawn = await SELF.fetch(`https://worker.test/api/materials/user/${id}/withdraw`, {
      method: "POST",
      headers: auth(SESSION_A),
    });
    expect(withdrawn.status).toBe(200);
    expect((await withdrawn.json()) as { material: MaterialView }).toMatchObject({
      material: { status: "withdrawn" },
    });

    const deleted = await SELF.fetch(`https://worker.test/api/materials/user/${id}`, {
      method: "DELETE",
      headers: auth(SESSION_A),
    });
    expect(deleted.status).toBe(200);
    const gone = await env.DB.prepare("SELECT id FROM user_materials WHERE id = ?1").bind(id).first();
    expect(gone).toBeNull();
  });

  // ── S4. ОТКАЗ ВСЕГДА С ПРИЧИНОЙ ───────────────────────────────────────────
  it("S4: отказ без причины невозможен, с причиной — учитель её видит", async () => {
    const created = await submit(SESSION_A, { title: "Конспект урока" });
    const id = created.body.material!.id;

    // Пустая причина — 400, а не «отказ без объяснения».
    const noReason = await SELF.fetch(`https://worker.test/api/materials/moderation/${id}/reject`, {
      method: "POST",
      headers: auth(SESSION_OWNER),
      body: JSON.stringify({ reason: "   " }),
    });
    expect(noReason.status).toBe(400);

    const rejected = await SELF.fetch(`https://worker.test/api/materials/moderation/${id}/reject`, {
      method: "POST",
      headers: auth(SESSION_OWNER),
      body: JSON.stringify({ reason: "В материале нет заданий — только текст." }),
    });
    expect(rejected.status).toBe(200);

    // Учитель видит и статус, и причину — молчаливого отказа в листе нет.
    const mine = (await ownList(SESSION_A)).find((m) => m.id === id)!;
    expect(mine.status).toBe("rejected");
    expect(mine.rejectReason).toBe("В материале нет заданий — только текст.");

    // И отклонённый в общий банк не попадает.
    expect((await publicList()).some((m) => m.id === id)).toBe(false);

    // Поправленный отказ уходит на модерацию заново, а старая причина снимается.
    const fixed = await SELF.fetch(`https://worker.test/api/materials/user/${id}`, {
      method: "PATCH",
      headers: auth(SESSION_A),
      body: JSON.stringify(materialBody({ title: "Конспект урока", tasks: [{ text: "Расскажите о круге." }] })),
    });
    expect(fixed.status).toBe(200);
    const afterFix = ((await fixed.json()) as { material: MaterialView }).material;
    expect(afterFix.status).toBe("pending");
    expect(afterFix.rejectReason).toBeNull();
  });

  // ── S5. МОДЕРАЦИЮ ДЕЛАЕТ ВЛАДЕЛЕЦ ─────────────────────────────────────────
  it("S5: обычный учитель публиковать не может, владелец — может", async () => {
    const created = await submit(SESSION_A, { title: "Презентация к теме" });
    const id = created.body.material!.id;

    // Учитель не может одобрить сам — ни свой, ни чужой.
    const selfApprove = await approve(SESSION_A, id);
    expect(selfApprove.status).toBe(403);

    // С чужим материалом учитель тоже ничего не решает.
    const otherApprove = await approve(SESSION_B, id);
    expect(otherApprove.status).toBe(403);

    // Владелец публикует — и только теперь материал виден всем.
    const approved = await approve(SESSION_OWNER, id);
    expect(approved.status).toBe(200);

    const published = (await publicList()).find((m) => m.id === id);
    expect(published).toBeDefined();
    expect(published!.title).toBe("Презентация к теме");

    // Повторное решение по уже решённому материалу — 409, а не «успех».
    expect((await approve(SESSION_OWNER, id)).status).toBe(409);
  });

  // ── S6. ВИДНО, КТО ПРИНЁС, И НЕ ВИДНО ПОЧТУ ──────────────────────────────
  it("S6: в банке виден автор материала, а почта автора не утекает", async () => {
    // Материал сдаётся и публикуется ЗДЕСЬ: тест не должен зависеть от того,
    // что осталось в базе от предыдущего (storage изолирован по тестам).
    const created = await submit(SESSION_A, { title: "Материал с подписью" });
    const id = created.body.material!.id;
    expect((await approve(SESSION_OWNER, id)).status).toBe(200);

    const raw = await (
      await SELF.fetch("https://worker.test/api/materials/user", { headers: anon() })
    ).text();

    // Подпись автора есть — учитель, взявший чужой материал, понимает, от кого он.
    expect(raw).toContain("Учитель Обычный");
    // А почты в общем списке нет: авторство не должно превращаться в раздачу адресов.
    expect(raw).not.toContain(TEACHER_EMAIL);
    expect(raw).not.toContain(TEACHER);
  });

  // ── S7. ЧУЖИЕ ЧЕРНОВИКИ НЕ ВИДНЫ ──────────────────────────────────────────
  it("S7: в «моих материалах» нет чужих строк", async () => {
    // Учитель А сдаёт материал. Он остаётся ЧЕРНОВИКОМ: так мы проверяем, что
    // у учителя Б не видно даже чужого неопубликованного, а не только опубликованного.
    const created = await submit(SESSION_A, { title: "Чужой черновик" });
    expect(created.body.material!.status).toBe("pending");

    const mineA = await ownList(SESSION_A);
    const mineB = await ownList(SESSION_B);

    expect(mineA.map((m) => m.id)).toContain(created.body.material!.id);
    // У второго учителя в «своих» — пусто: его материалы не подмешались.
    expect(mineB).toHaveLength(0);

    // И чужой черновик не открывается по прямой ссылке даже по id из чужой ссылки.
    const direct = await SELF.fetch(
      `https://worker.test/api/materials/user/${created.body.material!.id}`,
      { headers: anon() },
    );
    expect(direct.status).toBe(404);
  });

  // ── S8. СЧЁТЧИК СКАЧИВАНИЙ НАСТОЯЩИЙ ──────────────────────────────────────
  it("S8: счётчик растёт по опубликованному, черновик не скачивается", async () => {
    const created = await submit(SESSION_A, { title: "Комплект на четверть" });
    const id = created.body.material!.id;

    // Черновик скачать нельзя: 404, счётчик не растёт.
    const draft = await SELF.fetch(`https://worker.test/api/materials/user/${id}/download`, {
      method: "POST",
      headers: anon(),
    });
    expect(draft.status).toBe(404);

    await approve(SESSION_OWNER, id);

    const first = await SELF.fetch(`https://worker.test/api/materials/user/${id}/download`, {
      method: "POST",
      headers: anon(),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { downloads: number }).downloads).toBe(1);

    const second = await SELF.fetch(`https://worker.test/api/materials/user/${id}/download`, {
      method: "POST",
      headers: anon(),
    });
    expect(((await second.json()) as { downloads: number }).downloads).toBe(2);

    // Счётчик в самом материале совпадает с ответом: одно и то же число.
    const published = (await publicList()).find((m) => m.id === id)!;
    expect(published.downloads).toBe(2);
  });

  // ── S9. БЕЗ ВХОДА НИЧЕГО НЕ СДЕЛАТЬ ──────────────────────────────────────
  it("S9: без входа нельзя сдать материал и нельзя посмотреть свои", async () => {
    const res = await SELF.fetch("https://worker.test/api/materials/user", {
      method: "POST",
      headers: anon(),
      body: JSON.stringify(materialBody()),
    });
    expect(res.status).toBe(401);

    const mine = await SELF.fetch("https://worker.test/api/materials/user/mine", { headers: anon() });
    expect(mine.status).toBe(401);

    // Публичный банк при этом открыт: каталог materials и до входа виден.
    expect((await SELF.fetch("https://worker.test/api/materials/user", { headers: anon() })).status).toBe(200);
  });
});