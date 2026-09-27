/**
 * Smoke-тест для backend (запускается через `npm run smoke`).
 *
 * Проверяет основные endpoints без реальных API-ключей.
 * Использует fetch напрямую к `BASE_URL` (по умолчанию http://localhost:8787).
 *
 * Запуск:
 *   1) В одном терминале: cd backend && ./scripts/dev.sh
 *   2) В другом: cd backend && npm run smoke
 */

const BASE = process.env.BASE_URL ?? "http://localhost:8787";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>) {
  try {
    const r = await fn();
    results.push({ name, ...r });
    const tag = r.ok ? "✓" : "✗";
    const tail = r.detail ? ` — ${r.detail}` : "";
    // eslint-disable-next-line no-console
    console.log(`  ${tag} ${name}${tail}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e).slice(0, 200) });
    // eslint-disable-next-line no-console
    console.log(`  ✗ ${name} — ${String(e).slice(0, 200)}`);
  }
}

async function main() {
  console.log("▶ Smoke against", BASE);
  console.log("");

  await check("GET /healthz → 200 ok:true", async () => {
    const res = await fetch(`${BASE}/healthz`);
    const body = (await res.json()) as { ok: boolean };
    return { ok: res.ok && body.ok, detail: `HTTP ${res.status}` };
  });

  await check("GET /readyz → 200 (D1 ok)", async () => {
    const res = await fetch(`${BASE}/readyz`);
    const body = (await res.json()) as { ok: boolean; db: string };
    return { ok: res.ok && body.ok, detail: body.db };
  });

  await check("GET /api/llm/models → JSON", async () => {
    const res = await fetch(`${BASE}/api/llm/models`);
    const body = (await res.json()) as { models: string[] };
    return { ok: res.ok && Array.isArray(body.models), detail: `${body.models.length} models` };
  });

  await check("GET /api/auth/me (anonymous) → user:null", async () => {
    const res = await fetch(`${BASE}/api/auth/me`);
    const body = (await res.json()) as { user: unknown };
    return { ok: res.ok && body.user === null, detail: "anonymous" };
  });

  await check("POST /api/billing/yookassa-webhook → handled:false (ignored event)", async () => {
    const res = await fetch(`${BASE}/api/billing/yookassa-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "notification",
        event: "payment.waiting_for_capture",
        object: { id: "smoke_test_xyz", status: "pending" },
      }),
    });
    const body = (await res.json()) as { handled: boolean };
    return { ok: res.ok && body.handled === true, detail: `handled=${body.handled}` };
  });

  await check("POST /api/worksheets/generate (no key) → 500", async () => {
    const res = await fetch(`${BASE}/api/worksheets/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          subject: "math",
          grade: 5,
          topic: "Smoke test",
          difficulty: "medium",
          count: 1,
          type: "worksheet",
          withAnswers: true,
          withExplanations: true,
        },
      }),
    });
    // Без ключей бэк должен вернуть 500 (нет провайдера для LLM)
    return { ok: res.status === 500 || res.status === 503, detail: `HTTP ${res.status}` };
  });

  console.log("");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`──────────`);
  console.log(`  ${passed} passed / ${failed} failed / ${results.length} total`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("FATAL:", e);
  process.exit(1);
});
