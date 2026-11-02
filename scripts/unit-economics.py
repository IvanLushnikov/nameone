#!/usr/bin/env python3
"""Юнит-экономика тарифов УчЛист при реальной нагрузке учителя.

Запуск:
  node --import tsx scripts/economics-inputs.mts > /tmp/uchlist-economics-inputs.json
  python3 scripts/unit-economics.py --inputs /tmp/uchlist-economics-inputs.json

Документ с выводами: docs/04-pricing-economics-v2.md

ЦЕНЫ, НОРМЫ, КВОТА И ЦЕНЫ МОДЕЛЕЙ ЖИВУТ НЕ ЗДЕСЬ.
Входы приходят из scripts/economics-inputs.mts, который читает канонический код
продукта (src/lib/content/plans.ts, backend/src/services/usage.ts,
backend/src/llm/config.ts). Раньше Python держал свои копии (цена 3800/9,
норма 1 440 000, три бесплатные генерации) — и расчёт разъезжался с продуктом:
в коде уже было 249/499/999 ₽, нормы 2,4/4,8/9,7 млн и 5 листов.

Что остаётся допущением ЗДЕСЬ (и это честно сказано в выводе):
  ART  — сколько out-токенов стоит артефакт (оценка по промптам);
  SCEN — сколько раз в неделю учитель делает каждый тип (гипотеза владельца);
  WEEKS — 34 учебные недели в году.
Курс, комиссия и исторические замеры приходят во входах с явной пометкой.

Никаких сетевых запросов: скрипт читает один JSON-файл.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Входы
# ─────────────────────────────────────────────────────────────────────────────

EXPECTED_VERSION = 1


def fail(message: str) -> "NoReturn":  # type: ignore[valid-type]
    """Понятная ошибка и ненулевой код. Молчаливого отката к старым
    константам нет: расчёт на устаревших числах опаснее, чем отсутствие
    расчёта."""
    print(f"ОШИБКА: {message}", file=sys.stderr)
    sys.exit(2)


def load_inputs(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        fail(
            f"файл входов не найден: {path}. Соберите его командой:\n"
            f"  node --import tsx scripts/economics-inputs.mts > {path}"
        )
    except json.JSONDecodeError as exc:
        fail(f"файл входов не читается как JSON: {path} ({exc})")
    except OSError as exc:
        fail(f"файл входов не прочитать: {path} ({exc})")

    if not isinstance(data, dict):
        fail(f"файл входов должен быть JSON-объектом: {path}")

    version = data.get("version")
    if version != EXPECTED_VERSION:
        fail(
            f"неподдерживаемая версия входов: {version} (ожидалась {EXPECTED_VERSION}). "
            "Обновите scripts/economics-inputs.mts и этот скрипт вместе."
        )

    units = data.get("units")
    if not isinstance(units, dict):
        fail("в файле входов нет блока units — непонятно, в чём измерены числа")
    for key, expected in (("money", "RUB"), ("norm", "weighted tokens per month")):
        if units.get(key) != expected:
            fail(
                f"единицы входов не совпадают: {key} = {units.get(key)!r}, "
                f"ожидалось {expected!r}. Расчёт не запускается на чужих единицах."
            )

    for key in ("plans", "free", "modelCosts", "fx", "paymentFee", "academicYear"):
        if key not in data:
            fail(f"в файле входов нет блока {key!r}")

    return data


def plan_by_id(inputs: dict[str, Any], plan_id: str) -> dict[str, Any]:
    for plan in inputs["plans"]:
        if plan["id"] == plan_id:
            return plan
    fail(f"в файле входов нет тарифа {plan_id!r}")


# ─────────────────────────────────────────────────────────────────────────────
# Модельные ставки из входов
# ─────────────────────────────────────────────────────────────────────────────

# Идентификаторы моделей в коде → ключи в MODEL_COSTS.
MODEL_KEYS = {
    "luna": "gpt-6-luna",
    "sol": "gpt-6-sol",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5",
    "deepseek": "deepseek-v4-flash",
}


def model_cost(inputs: dict[str, Any], name: str) -> dict[str, Any]:
    by_model = inputs["modelCosts"]["byModel"]
    key = MODEL_KEYS[name]
    if key not in by_model:
        fail(f"в файле входов нет цен модели {key!r} (модель {name!r})")
    return by_model[key]


# ─────────────────────────────────────────────────────────────────────────────
# Допущения расчёта (здесь, а не в коде продукта)
# ─────────────────────────────────────────────────────────────────────────────

# Сколько out-токенов стоит артефакт каждого типа. ОЦЕНКА по промптам.
ART = {
    "Лист-домашка 10 зад.": (1600, "home"),
    "Лист-тренировка 15-20 зад.": (2600, "drill"),
    "Лист-карточка 5-8 зад.": (900, "card"),
    "Карточки flashcards 8-40": (1800, "cards"),
    "Контрольная (2 варианта)": (3600, "control"),
    "Тест с автопроверкой": (1400, "test"),
    "План урока ФГОС": (1900, "plan"),
    "Презентация 10-15 слайдов": (3500, "pres"),
    "Вариант ОГЭ/ЕГЭ": (6500, "oge"),
    "КТП на год": (8000, "ktp"),
}

# Роутинг из backend/src/llm/router.ts (PRIMARY_BY_TASK).
SONNET_KEYS = {"control", "oge", "ktp", "pres"}

# Нагрузка учителя — ГИПОТЕЗА владельца (2026-10-02): домашка задаётся на
# КАЖДЫЙ урок, ставка 20-24 урока/нед, 34 учебные недели.
SCEN = {
    "A. Лёгкий (10 ген/нед)": dict(
        home=8, drill=2, card=2, cards=2, control=2, test=0, plan=2, pres=2, oge=0, ktp=0.0),
    "B. 20 уроков/нед": dict(
        home=14, drill=6, card=4, cards=3, control=3, test=2, plan=3, pres=3, oge=2, ktp=0.2),
    "C. 24 урока/нед (тяжёлый)": dict(
        home=20, drill=10, card=6, cards=4, control=4, test=3, plan=4, pres=4, oge=4, ktp=0.3),
}

WEEKS = 34.0

SYS, USER = 1800, 250  # токены системного и пользовательского промпта (оценка)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Юнит-экономика тарифов УчЛист (входы — из scripts/economics-inputs.mts)."
    )
    parser.add_argument(
        "--inputs",
        required=True,
        help="путь к JSON со входами (node --import tsx scripts/economics-inputs.mts > file.json)",
    )
    args = parser.parse_args()

    inputs = load_inputs(args.inputs)

    rub = float(inputs["fx"]["rubPerUsd"])
    fee = float(inputs["paymentFee"]["rate"])
    months = int(inputs["academicYear"]["months"])
    free_limit = int(inputs["free"]["generationsPerMonth"])
    tokens_per_worksheet = float(inputs["tokensPerWorksheet"]["value"])

    luna_out = model_cost(inputs, "luna")["outputPer1MUsd"]
    luna_in = model_cost(inputs, "luna")["inputPer1MUsd"]
    sol_in = model_cost(inputs, "sol")["inputPer1MUsd"]
    sol_out = model_cost(inputs, "sol")["outputPer1MUsd"]
    sonnet_in = model_cost(inputs, "sonnet")["inputPer1MUsd"]
    sonnet_out = model_cost(inputs, "sonnet")["outputPer1MUsd"]
    sonnet_cache = model_cost(inputs, "sonnet")["cacheReadPer1MUsd"] or sonnet_in
    opus_in = model_cost(inputs, "opus")["inputPer1MUsd"]
    opus_out = model_cost(inputs, "opus")["outputPer1MUsd"]
    opus_cache = model_cost(inputs, "opus")["cacheReadPer1MUsd"] or opus_in
    ds_in = model_cost(inputs, "deepseek")["inputPer1MUsd"]
    ds_out = model_cost(inputs, "deepseek")["outputPer1MUsd"]

    def validation_cost(out: float) -> float:
        """Пост-валидация на DeepSeek (задачи + инструкция → вердикт)."""
        return ((SYS + USER + out + 300) / 1e6 * ds_in + 400 / 1e6 * ds_out) * rub

    def gen_cost(model: str, out: float) -> float:
        if model == "luna":  # +5 % уходит в fallback Sol
            c = (SYS + USER) / 1e6 * luna_in + out / 1e6 * luna_out
            c += 0.05 * ((SYS + USER) / 1e6 * sol_in + out / 1e6 * sol_out)
            return c * rub
        if model == "sonnet":  # system prompt в кэше → платим за cache-read
            return (
                SYS / 1e6 * sonnet_cache + USER / 1e6 * sonnet_in + out / 1e6 * sonnet_out
            ) * rub
        return (
            SYS / 1e6 * opus_cache + USER / 1e6 * opus_in + out / 1e6 * opus_out
        ) * rub

    def model_for(key: str, routing: str) -> str:
        if routing == "opus_all":
            return "opus"
        return "sonnet" if key in SONNET_KEYS else "luna"

    def cost_of_scenario(scn: str, routing: str) -> tuple[float, float, float, float]:
        """(cogs_base, cogs_plus_opus, cogs_plus_shipped, артефактов/год)."""
        m = SCEN[scn]
        c_base = c_plus_opus = c_plus_shipped = 0.0
        total = 0.0
        for _name, (out, key) in ART.items():
            n = m[key] * WEEKS
            total += n
            v = validation_cost(out)
            c_base += (gen_cost("luna", out) + v) * n
            c_plus_opus += (gen_cost("opus", out) + v) * n
            c_plus_shipped += (gen_cost(model_for(key, "shipped"), out) + v) * n
        return c_base, c_plus_opus, c_plus_shipped, total

    # ─────────────────────────────────────────────────────────────────────────
    print("=" * 92)
    print("0. ВХОДЫ (откуда взяты числа)")
    print("=" * 92)
    print(f"  версия входов: {inputs['version']}   курс: {rub} ₽/$   комиссия: {fee * 100:.1f} %")
    print(f"  учебный год: {months} мес   бесплатно: {free_limit} генераций/мес")
    for plan in inputs["plans"]:
        print(
            f"  {plan['id']:<9} месяц {plan['monthly']['amountRub']:>6} ₽   "
            f"учебный год {plan['academicYear']['amountRub']:>6} ₽   "
            f"норма {plan['normPerMonth']['value']:>10,} взв. токенов/мес"
        )
    print(f"  нормы и квота — из: {inputs['plans'][0]['normPerMonth']['source']}")
    print(f"  цены — из: {inputs['plans'][0]['monthly']['source']}")
    print(f"  ставки моделей — из: {inputs['modelCosts']['source']}")
    print(f"  курс и комиссия — ДОПУЩЕНИЯ: {inputs['fx']['source']}")
    print(f"  фактические замеры — ИСТОРИЧЕСКИЕ ({inputs['historicalActualCosts']['measuredAt']}):")
    print(f"    {inputs['historicalActualCosts']['source']}")

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("1. ЦЕНА ОДНОГО АРТЕФАКТА, ₽")
    print("=" * 92)
    print(f"{'Артефакт':<32}{'Luna':>9}{'Sonnet':>9}{'Opus':>9}{'экономия Opus→Sonnet':>22}")
    print("-" * 92)
    for name, (out, _key) in ART.items():
        l = gen_cost("luna", out) + validation_cost(out)
        s = gen_cost("sonnet", out) + validation_cost(out)
        o = gen_cost("opus", out) + validation_cost(out)
        saving = (1 - s / o) * 100
        print(f"{name:<32}{l:>9.2f}{s:>9.2f}{o:>9.2f}{saving:>21.0f}%")

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("2. ВЫРУЧКА ПО ТАРИФАМ (канонические цены из кода)")
    print("=" * 92)
    print(f"{'Тариф':<12}{'в месяц, ₽':>14}{'за учебный год, ₽':>21}{'₽/мес за год':>16}")
    print("-" * 92)
    for plan in inputs["plans"]:
        print(
            f"{plan['id']:<12}{plan['monthly']['amountRub']:>14,}"
            f"{plan['academicYear']['amountRub']:>21,}"
            f"{plan['academicYear']['perMonthRub']:>16,}"
        )
    school = inputs.get("school")
    if school:
        print(
            f"{school['id']:<12}{school['monthly']['amountRub']:>14,}"
            f"{'—':>21}{'—':>16}   (у класса учебного года нет)"
        )

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("3. COGS ПО ТАРИФАМ, ₽/мес  (учебный год 34 недели, оплата за 9 мес, эквайринг 3,5 %)")
    print("=" * 92)
    for plan in inputs["plans"]:
        price = float(plan["monthly"]["amountRub"])
        print(f"  Тариф «{plan['id']}»: выручка {price:,.0f} ₽/мес")
        print(
            f"    {'Сценарий':<26}{'арт/мес':>8}{'COGS':>10}{'комиссия':>11}{'всего':>10}{'вклад':>10}"
        )
        for scn in SCEN:
            if plan["id"] == "base":
                cogs_year = cost_of_scenario(scn, "opus_all")[0]
            elif plan["id"] == "plus":
                cogs_year = cost_of_scenario(scn, "shipped")[2]
            else:
                # «Стандарт» считаем тем же роутингом, что и «Плюс»: модель
                # выбирается по типу артефакта, а не по тарифу.
                cogs_year = cost_of_scenario(scn, "shipped")[2]
            cogs = cogs_year / months
            commission = fee * price
            total_cost = cogs + commission
            contribution = price - total_cost
            print(
                f"    {scn:<26}{cogs_year / WEEKS:>8.0f}{cogs:>10,.0f}{commission:>11,.0f}"
                f"{total_cost:>10,.0f}{contribution:>+11,.0f}"
            )
        print()

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("4. НОРМЫ ТАРИФА: покрывают ли они реальную нагрузку")
    print("=" * 92)
    rub_per_token = luna_out / 1e6 * rub
    for plan in inputs["plans"]:
        norm = float(plan["normPerMonth"]["value"])
        revenue = float(plan["monthly"]["amountRub"])
        cogs = norm * rub_per_token
        margin = (revenue - cogs - fee * revenue) / revenue * 100
        print(
            f"  {plan['id']:<9} норма {norm:>11,} взв. токенов/мес → COGS {cogs:>7,.0f} ₽/мес  "
            f"при выручке {revenue:>6,.0f} ₽ → маржа {margin:>4.0f} %"
        )
    print()
    for scn in SCEN:
        _b, _o, shipped_year, _total = cost_of_scenario(scn, "shipped")
        weighted_per_month = shipped_year / months / rub_per_token
        plus_norm = float(plan_by_id(inputs, "plus")["normPerMonth"]["value"])
        print(
            f"  {scn:<26} Плюс-эквивалент {weighted_per_month:>11,.0f} токенов/мес  "
            f"= {weighted_per_month / plus_norm:>5.0%} нормы «Плюс»"
        )
    print()
    heavy_year = cost_of_scenario("C. 24 урока/нед (тяжёлый)", "shipped")[2]
    heavy = heavy_year / months / rub_per_token
    base_norm = float(plan_by_id(inputs, "base")["normPerMonth"]["value"])
    base_norm_used = cost_of_scenario("C. 24 урока/нед (тяжёлый)", "shipped")[0] / months / rub_per_token
    plus_norm = float(plan_by_id(inputs, "plus")["normPerMonth"]["value"])
    print(f"  Норма «Плюс» = {plus_norm:,} токенов/мес.")
    print(
        f"  Сценарий C (24 урока/нед) = {heavy:,.0f} токенов/мес → "
        f"{'влезает с запасом' if heavy < plus_norm else 'НЕ ВЛЕЗАЕТ, норму поднять!'}."
    )
    print(
        f"  Та же нагрузка на «Базовом» (всё на Luna) = {base_norm_used:,.0f} токенов/мес "
        f"= {base_norm_used / base_norm:>5.0%} нормы «Базового»."
    )

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("5. БЕЗЛИМИТ НА БАЗОВОМ: сколько выдерживает")
    print("=" * 92)
    per_list = gen_cost("luna", 1600) + validation_cost(1600)
    base_price = float(plan_by_id(inputs, "base")["monthly"]["amountRub"])
    for n in (50, 150, 400, 800, 1600, 3200):
        c = n * per_list
        margin = (base_price - c - fee * base_price) / base_price * 100
        print(f"  {n:>5} листов/мес → {c:>7,.0f} ₽/мес LLM   маржа {margin:>5.0f}%")
    print(f"\n  Один лист-домашка стоит {per_list:.2f} ₽. Тариф в {base_price / per_list:,.0f} раз дороже листа.")

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("6. ТАРИФ «ШКОЛА»")
    print("=" * 92)
    if school:
        school_price = float(school["monthly"]["amountRub"])
        school_norm = float(school["normPerMonth"]["value"])
        cogs = school_norm * luna_out / 1e6 * rub
        margin = (school_price - cogs - fee * school_price) / school_price * 100
        print(f"  Норма {school_norm:,} взв. токенов/мес → COGS {cogs:.0f} ₽ при выручке {school_price:,.0f} ₽ → маржа {margin:.0f}%")
        print(f"  Норма класса — ДОПУЩЕНИЕ: {school['normPerMonth']['source']}")
    print("  Ученикам генерация НЕ выдаётся (роль student в user_roles), поэтому")
    print("  в норме класса сидит только учитель. Если ученики всё же начнут")
    print("  генерировать, норму надо пересчитать — см. risks в docs/04-pricing-economics-v2.md.")

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("7. БЕСПЛАТНЫЙ ТАРИФ")
    print("=" * 92)
    cheapest = min(gen_cost("luna", out) + validation_cost(out) for out, _ in ART.values())
    dearest = max(gen_cost("luna", out) + validation_cost(out) for out, _ in ART.values())
    cheap_kvota = free_limit * cheapest
    dear_kvota = free_limit * dearest
    print(
        f"  Квота: {free_limit} генерации в месяц (сбрасывается 1-го числа). "
        f"Себестоимость всей квоты: {cheap_kvota:.2f}–{dear_kvota:.2f} ₽ в месяц."
    )
    print(f"  1 000 бесплатных пользователей съедят максимум {dear_kvota * 1000:,.0f} ₽/мес.")
    print("  Считать, что на бесплатном тарифе можно заработать, нельзя.")
    print()
    print("  Следствие для антифрода: деньгами фрод не съедает, он съедает статистику")
    print("  и репутацию. Отсюда мягкая реакция (капча, а не блокировка) — она дешёвая")
    print("  и при этом не отрубает реального учителя.")

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("8. ВКЛАД ПО ФАКТИЧЕСКОЙ СЕБЕЙТОИМОСТИ (может быть отрицательным)")
    print("=" * 92)
    hist = inputs["historicalActualCosts"]
    actual_per_worksheet = float(hist["perWorksheetRub"])
    print(f"  Источник замера: {hist['source']}")
    print(f"  Замер: {hist['measuredAt']}, {actual_per_worksheet} ₽ за лист (без проверки).")
    print("  Формула: вклад = выручка за месяц − (листов в норме × факт за лист) − комиссия")
    print("  Листов в норме = норма (взв. токенов) ÷ токенов на лист")
    print(f"  Токенов на лист: {tokens_per_worksheet:.0f} — {inputs['tokensPerWorksheet']['label'].upper()}, "
          f"{inputs['tokensPerWorksheet']['source']}")
    print()
    print(f"  {'Тариф':<10}{'норма':>12}{'листов':>10}{'себестоимость':>16}{'выручка':>10}{'вклад':>11}")
    print("  " + "-" * 88)
    negative = []
    for plan in inputs["plans"]:
        norm = float(plan["normPerMonth"]["value"])
        price = float(plan["monthly"]["amountRub"])
        sheets = norm / tokens_per_worksheet
        cost = sheets * actual_per_worksheet
        contribution = price - cost - fee * price
        if contribution < 0:
            negative.append((plan["id"], contribution))
        print(
            f"  {plan['id']:<10}{int(norm):>12,}{sheets:>10,.0f}{cost:>16,.0f}{price:>10,.0f}"
            f"{contribution:>+11,.0f}"
        )
    print()
    if negative:
        print("  ВКЛАД ОТРИЦАТЕЛЬНЫЙ (при полном расходе нормы по историческому замеру):")
        for plan_id, contribution in negative:
            print(f"    · «{plan_id}»: {contribution:,.0f} ₽/мес")
        print("  Это не «запас на рост», а отрицательная маржа на полном расходе нормы.")
        print("  Что с этим делать — решение владельца (цена, норма, потолок тарифа).")
        print("  Расчёт НЕ блокирует сборку: отрицательная экономика — это факт, а не ошибка.")
    else:
        print("  Вклад по историческому замеру положительный на всех тарифах.")

    # ─────────────────────────────────────────────────────────────────────────
    print()
    print("=" * 92)
    print("9. ЧТО НЕ ВХОДИТ В РАСЧЁТ")
    print("=" * 92)
    for line in [
        "налоги (УСН/патент) и зарплата разработки — при такой марже не влияют на выводы,",
        "поддержка — считается отдельно, на тарифы не влияет,",
        "платёжная комиссия за СБП — может отличаться от принятой здесь 3,5 % по карте,",
        "домен, почта, Cloudflare — копейки при наших объёмах,",
        "self-verification — в коде её нет; при включении на Sonnet COGS вырастет примерно",
        "  в 1,6 раза (проверка каждого задания = ещё один вызов). На Opus — минус в марже.",
    ]:
        print(f"  · {line}")
    print()
    print("  Допущения этого расчёта (меняются без правки кода продукта):")
    print("    · нагрузка учителя SCEN — гипотеза владельца, проверяется аналитикой;")
    print("    · токенов на артефакт ART — оценка по промптам;")
    print("    · 34 учебные недели в году;")
    print(f"    · курс {rub} ₽/$ и комиссия {fee * 100:.1f} % — допущения, не измерения;")
    print(f"    · фактические цены — замер {hist['measuredAt']}, а не «живая» цена сегодня.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
