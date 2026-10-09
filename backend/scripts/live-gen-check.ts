/**
 * ЖИВОЙ ПРОГОН ГЕНЕРАЦИИ (09.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * До этого правила промптов и серверный фильтр проверялись только на СВОИХ
 * текстах. Это проверка «правило написано», а не «продукт работает».
 *
 * Когда учительница написала «окружающий мир 4 класс, а там алгебра»,
 * тесты промпта проходили: правило 9 было в промпте. Проверять надо ЖИВЫМ
 * ответом модели на тех же параметрах, на которых жаловались.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ СКРИПТ ХОДИТ В ВООРКЕР, А НЕ К ПРОВАЙДЕРУ
 * ─────────────────────────────────────────────────────────────────────────────
 * `POLZA_API_KEY` лежит в Cloudflare как secret_text и не читается — это
 * правильно, его не должно быть на машине разработчика. Поэтому скрипт
 * обращается к СВОЕМУ же API (`/api/worksheets/generate`), а ключ использует
 * воркер. Второй вариант — вытащить ключ наружу и звать провайдера напрямую —
 * означал бы создать копию секрета, чего делать не надо.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ЗАПУСТИТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 *   cd backend
 *   npx wrangler dev --remote --port 8787     # в отдельном терминале
 *   npx tsx scripts/live-gen-check.ts
 *
 * `--remote` обязателен: локальный воркер не видит secrets из Cloudflare.
 * Он ходит в настоящий Polza и тратит реальные деньги — это ДЕСЯТОК секунд
 * и несколько копеек на запуск. Квоты D1 не трогаются: вызов идёт по
 * внутреннему маршруту без пользователя, а если попадёт в лимит — скрипт
 * об этом скажет, а не притворится, что проверил.
 *
 * Скрипт печатает нарушения и завершается с кодом 1, если что-то нашлось:
 * молчаливый «всё хорошо» от проверки, которая ничего не проверяет, хуже
 * молчаливого падения.
 */
import { filterTasks } from "../src/llm/validation/quality-filter.ts";

const BASE = process.env.LIVE_GEN_BASE_URL ?? "http://127.0.0.1:8787";

interface Case {
  name: string;
  subject: string;
  grade: number;
  topic: string;
  type: string;
  count: number;
}

/**
 * Сценарии взяты из жалоб учительницы дословно: «биология 9», «окружающий мир
 * 4 класс», «технология 10 класс, техника безопасности», «контрольная на 2
 * варианта». Если дефект был в промпте или в разборе — он всплывёт здесь.
 */
const CASES: Case[] = [
  { name: "Биология 9 (жалоба: «опять математика в заданиях»)", subject: "biology", grade: 9, topic: "Клеточное строение", type: "worksheet", count: 6 },
  { name: "Окружающий мир 4 (жалоба: «про берёзы И про алгебру»)", subject: "world", grade: 4, topic: "Природные зоны России", type: "worksheet", count: 6 },
  { name: "Технология 10, ТБ (жалоба: «задания для долбоебов»)", subject: "technology", grade: 10, topic: "Техника безопасности в мастерской", type: "worksheet", count: 6 },
];

const CONTROL_CASE: Case = {
  name: "Контрольная (жалоба: «генерится только 1 вариант»)",
  subject: "biology",
  grade: 9,
  topic: "Клеточное строение",
  type: "control",
  count: 5,
};

interface RawTask {
  number?: number;
  text?: string;
  answer?: string | null;
}

interface GenResult {
  ok: boolean;
  worksheet?: { title?: string; tasks?: RawTask[] };
  secondVariant?: { title?: string; tasks?: RawTask[] } | null;
  error?: string;
}

async function generate(c: Case): Promise<GenResult> {
  const res = await fetch(`${BASE}/api/worksheets/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "uchlist-live-check/1.0" },
    body: JSON.stringify({
      request: {
        subject: c.subject,
        grade: c.grade,
        topic: c.topic,
        difficulty: "medium",
        count: c.count,
        type: c.type,
        withAnswers: true,
        withExplanations: true,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  try {
    return JSON.parse(text) as GenResult;
  } catch {
    return { ok: false, error: `не JSON: ${text.slice(0, 200)}` };
  }
}

function clip(s: string, n = 90): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

/**
 * Что именно ловим в ЖИВОМ ответе.
 *
 * Важная деталь: считается не «сколько заданий выкинул фильтр», а совпало ли
 * что-нибудь. Если модель сама ответила по правилам — это хорошо и значит,
 * что правило в промпте работает. Если что-то выкинуто — значит, что промпт
 * не сработал и вопрос держит код. Оба исхода полезны, но их надо различать.
 */
function inspect(tasks: RawTask[], subject: string): { problems: string[]; notes: string[] } {
  const { tasks: kept, report } = filterTasks(tasks, subject);
  const problems: string[] = [];
  const notes: string[] = [];

  if (report.droppedPatternRef.length) {
    problems.push(`«по образцу» без образца — задания ${report.droppedPatternRef.join(", ")}`);
  }
  if (report.droppedForeignMath.length) {
    problems.push(`чужая математика — задания ${report.droppedForeignMath.join(", ")}`);
  }
  if (report.cleanedAnswer.length) {
    problems.push(`ответ-заглушка — задания ${report.cleanedAnswer.join(", ")}`);
  }
  if (kept.length === tasks.length && tasks.length > 0) {
    notes.push("модель сама ответила по правилам — фильтр не понадобился");
  }
  return { problems, notes };
}

async function main(): Promise<void> {
  let failed = false;

  console.log(`Прогон против ${BASE}\n`);

  for (const c of CASES) {
    console.log(`── ${c.name} ──`);
    const r = await generate(c);
    if (!r.ok || !r.worksheet) {
      failed = true;
      console.log(`  ОШИБКА: ${r.error ?? "лист не вернулся"}\n`);
      continue;
    }
    const tasks = r.worksheet.tasks ?? [];
    const { problems, notes } = inspect(tasks, c.subject);
    console.log(`  заданий: ${tasks.length}`);
    for (const t of tasks.slice(0, 3)) {
      console.log(`  · ${clip(t.text ?? "")}`);
      console.log(`    ответ: ${clip(String(t.answer ?? "—"), 70)}`);
    }
    for (const n of notes) console.log(`  ок: ${n}`);
    if (problems.length) {
      failed = true;
      console.log("  НАРУШЕНИЯ (значит, правило в промпте не сработало):");
      for (const p of problems) console.log(`    ${p}`);
    }
    console.log();
  }

  console.log(`── ${CONTROL_CASE.name} ──`);
  const ctrl = await generate(CONTROL_CASE);
  if (!ctrl.ok || !ctrl.worksheet) {
    failed = true;
    console.log(`  ОШИБКА: ${ctrl.error ?? "лист не вернулся"}\n`);
  } else {
    const v1 = ctrl.worksheet.tasks ?? [];
    const v2 = ctrl.secondVariant?.tasks ?? [];
    console.log(`  вариант 1: ${v1.length} заданий, вариант 2: ${v2.length} заданий`);

    if (v2.length === 0) {
      failed = true;
      console.log("  НАРУШЕНИЕ: второго варианта нет — переключатель не покажется.");
    } else {
      const same = v1.map((t) => t.text).join("|") === v2.map((t) => t.text).join("|");
      if (same) {
        failed = true;
        console.log("  НАРУШЕНИЕ: варианты идентичны — сравнивать результаты класса нечем.");
      } else {
        console.log("  ок: варианты различаются");
      }
      for (const [i, v] of [[1, v1], [2, v2]] as const) {
        const { problems } = inspect(v, CONTROL_CASE.subject);
        if (problems.length) {
          failed = true;
          console.log(`  НАРУШЕНИЯ в варианте ${i}:`);
          for (const p of problems) console.log(`    ${p}`);
        }
      }
    }
  }

  console.log(failed ? "\nИТОГ: есть нарушения — см. выше." : "\nИТОГ: все проверки чистые.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Прогон не удался:", err instanceof Error ? err.message : String(err));
  console.error(`Проверь, что воркер поднят: npx wrangler dev --remote --port 8787 (в папке backend)`);
  process.exit(2);
});