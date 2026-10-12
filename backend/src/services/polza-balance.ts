/**
 * Баланс и пополнения на стороне polza.ai (ТЗ-24, раздел 6).
 *
 * ЗАЧЕМ
 * ----
 * Решение владельца от 12.10.2026: блок «затраты» показываем по счёту polza.ai,
 * а не по своему расчёту по прайсу. Плюс к этому — «пополнения», которых раньше
 * не было вообще.
 *
 * Провайдер отдаёт `GET https://polza.ai/api/v2/balance`:
 *   amount            — баланс кошелька, руб.
 *   available         — сколько доступно к трате (минус резерв под текущие запросы)
 *   reservedAmount    — зарезервировано под выполняющиеся запросы
 *   spentAmount       — потрачено организацией за всё время
 *   updatedAt         — момент, за который отвечает провайдер
 * (https://polza.ai/docs/api-reference/other/balance-v2)
 *
 * Все суммы — строки с восемью знаками после точки, поэтому парсим в number и
 * НЕ доверяем типу провайдера «на слово».
 *
 * ПОЧЕМУ СНИМОК, А НЕ РАЗНИЦА «ПОПОЛНЕНИЕ − ТРАТА»
 * -----------------------------------------------
 * Потому что деньги на балансе могут уйти и по другому адресу (ручная оплата,
 * сторнирование у провайдера). Рост баланса между двумя снимками — это
 * «сколько на кошельке стало больше», и называть его пополнением можно только
 * с оговоркой. Поэтому функция возвращает и прирост, и сам баланс, а экран
 * показывает оба числа.
 *
 * ЧТО ЗДЕСЬ НЕ ДЕЛАЕТСЯ
 * --------------------
 * Не дёргаем провайдера чаще раза в сутки (см. `shouldSkipSnapshot`), и не падаем,
 * если провайдер недоступен: снимок баланса — телеметрия, потеря одного снимка
 * не должна ронять генерацию у учителя.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import { logLlmEvent } from "../llm/log";

/** Базовый URL polza.ai для служебных эндпоинтов (не LLM-совместимый /api). */
const BALANCE_URL = "https://polza.ai/api/v2/balance";

export interface PolzaBalance {
  /** Баланс кошелька в рублях. */
  amountRub: number;
  /** Доступно к трате: минус резерв под выполняющиеся запросы. */
  availableRub: number | null;
  /** Зарезервировано под текущие запросы. */
  reservedRub: number | null;
  /** Потрачено организацией за всё время. */
  spentRub: number | null;
  /** Момент ответа провайдера (ISO). */
  providerUpdatedAt: string | null;
}

/**
 * Ответ провайдера. Поля опциональны: у ключа, выпущенного участником с
 * личным лимитом расходов, `reservedAmount` и `spentAmount` НЕ возвращаются
 * вовсе — это задокументированное поведение, а не ошибка.
 */
interface PolzaBalanceResponse {
  amount?: string | number;
  available?: string | number;
  reservedAmount?: string | number;
  spentAmount?: string | number;
  updatedAt?: string;
}

/**
 * Строка → number. Любое не-число (пустая строка, "—", null) даёт null, а не NaN:
 * NaN в базе потом показывает на экране как «NaN ₽».
 */
function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** Получить баланс у polza.ai. Бросает с текстом, если ключа нет. */
export async function fetchPolzaBalance(env: Env): Promise<PolzaBalance> {
  const apiKey = env.POLZA_API_KEY;
  if (!apiKey) {
    throw new Error("POLZA_API_KEY не задан — баланс polza.ai недоступен");
  }

  const res = await fetch(BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`polza.ai balance HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as PolzaBalanceResponse;

  // `amount` — единственное обязательное поле: без него снимок бессмыслен.
  const amount = toNumberOrNull(data.amount);
  if (amount === null) {
    throw new Error("polza.ai balance: в ответе нет числового amount");
  }

  return {
    amountRub: amount,
    availableRub: toNumberOrNull(data.available),
    reservedRub: toNumberOrNull(data.reservedAmount),
    spentRub: toNumberOrNull(data.spentAmount),
    providerUpdatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

/**
 * Нужно ли делать новый снимок сегодня.
 *
 * Один снимок в сутки — по решению владельца: положить деньги на кошелёк и
 * посмотреть баланс двадцать раз в день нельзя, а `/superpower` всё равно
 * показывает «сколько осталось» — суточная свежесть тут достаточна.
 *
 * Возвращает true, если последнего снимка нет либо он старше суток.
 */
export async function shouldSkipSnapshot(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT created_at FROM polza_balance_snapshots ORDER BY created_at DESC LIMIT 1`)
    .first<{ created_at: number }>();
  if (!row?.created_at) return false;
  return Date.now() / 1000 - row.created_at < 24 * 3600;
}

export interface BalanceSnapshotResult {
  /** Снимок записан. */
  recorded: boolean;
  /** Почему не записан, если не записан. */
  reason?: "recent" | "no-key" | "provider-error";
  balance?: PolzaBalance;
  /** На сколько вырос кошелёк с прошлого снимка. Рост = пополнение. */
  deltaRub?: number | null;
}

/**
 * Снять баланс и записать снимок, если сегодня ещё не снимали.
 *
 * Любая ошибка провайдера глотается: снимок — телеметрия, а не условие работы
 * генерации. Не пройти должно только одно — когда уже есть свежий снимок.
 */
export async function recordBalanceSnapshot(db: D1Database, env: Env): Promise<BalanceSnapshotResult> {
  if (await shouldSkipSnapshot(db)) {
    return { recorded: false, reason: "recent" };
  }
  if (!env.POLZA_API_KEY) {
    return { recorded: false, reason: "no-key" };
  }

  let balance: PolzaBalance;
  try {
    balance = await fetchPolzaBalance(env);
  } catch (e) {
    logLlmEvent("warn", "polza balance snapshot failed", { error: String(e) });
    return { recorded: false, reason: "provider-error" };
  }

  const now = Math.floor(Date.now() / 1000);
  const prev = await db
    .prepare(`SELECT amount_rub FROM polza_balance_snapshots ORDER BY created_at DESC LIMIT 1`)
    .first<{ amount_rub: number }>();

  await db
    .prepare(
      `INSERT INTO polza_balance_snapshots
         (id, amount_rub, available_rub, reserved_rub, spent_rub, provider_updated_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      `pbs_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      balance.amountRub,
      balance.availableRub,
      balance.reservedRub,
      balance.spentRub,
      balance.providerUpdatedAt,
      now,
    )
    .run();

  // Рост кошелька между снимками — и есть «пополнение» в понимании ТЗ-24.
  // Отрицательное значение означает не пополнение, а расход сверх внесённого.
  const deltaRub =
    prev && Number.isFinite(prev.amount_rub) ? balance.amountRub - prev.amount_rub : null;

  return { recorded: true, balance, deltaRub };
}