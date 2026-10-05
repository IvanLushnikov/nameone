/**
 * Тесты управления сессиями (ТЗ-21, блок 5, пункт 3).
 *
 * Покрывает `src/lib/lk/profile-api.ts`:
 *   1. список активных устройств грузится и помечает текущее;
 *   2. завершение одной сессии уходит в DELETE с её коротким id;
 *   3. «выйти на всех остальных» удаляет всё, кроме текущей;
 *   4. 401 и обрыв связи не выдаются за «устройств нет» молча.
 *
 * Отдельно проверяется, что клиент НИКОГДА не получает полный токен сессии:
 * в списке приходит только короткий суффикс (см. backend/src/services/account.ts).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import {
  listServerSessions,
  revokeOtherServerSessions,
  revokeServerSession,
} from "@/lib/lk/profile-api";

const okResponse = (body: unknown, status = 200) =>
  ({
    ok: true,
    status,
    statusText: "OK",
    json: async () => body,
  }) as unknown as Response;

const failResponse = (status: number, body: unknown = {}) =>
  ({
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  }) as unknown as Response;

const nowSec = Math.floor(Date.now() / 1000);

const SESSIONS = [
  { id: "aaaabbbbcccc", createdAt: nowSec - 400, expiresAt: nowSec + 86400, current: true },
  { id: "ddddeeeeffff", createdAt: nowSec - 8000, expiresAt: nowSec + 86400, current: false },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("список устройств", () => {
  it("грузит сессии и помечает текущую", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(String(url));
        return okResponse({ ok: true, sessions: SESSIONS });
      }),
    );

    const res = await listServerSessions();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sessions).toHaveLength(2);
    expect(res.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(asked[0]).toContain("/api/account/sessions");
  });

  it("не раскрывает полный токен: приходит только короткий id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          ok: true,
          sessions: [
            { id: "aaaabbbbcccc", createdAt: nowSec, expiresAt: nowSec + 60, current: true },
          ],
        }),
      ),
    );

    const res = await listServerSessions();
    if (!res.ok) throw new Error("ожидался успех");
    expect(Object.keys(res.sessions[0]).sort()).toEqual([
      "createdAt",
      "current",
      "expiresAt",
      "id",
    ]);
    // Ровно 12 символов: суффиксом токена нельзя войти в аккаунт.
    expect(res.sessions[0].id).toHaveLength(12);
  });

  it("истёкший вход отличается от пустого списка", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failResponse(401, { error: "Unauthorized" })));
    const res = await listServerSessions();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("unauthorized");
  });
});

describe("завершение сессии", () => {
  it("удаляет одну сессию по её короткому id", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method });
        return okResponse({ ok: true });
      }),
    );

    const res = await revokeServerSession("ddddeeeeffff");
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("/api/account/sessions/ddddeeeeffff");
  });

  it("«выйти на всех остальных» — один DELETE без id, текущая сессия не трогается", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(url)}`);
        return okResponse({ ok: true, revoked: 1 });
      }),
    );

    const res = await revokeOtherServerSessions();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revoked).toBe(1);
    expect(calls).toHaveLength(1);
    // Идентификатор в URL не дописан — значит это «все, кроме текущей».
    expect(calls[0]).toBe("DELETE https://api.example.test/api/account/sessions");
  });

  it("ошибка сети не выдаётся за успешный выход", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const res = await revokeServerSession("aaaabbbbcccc");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("network");
  });
});
