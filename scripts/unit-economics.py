#!/usr/bin/env python3
"""Юнит-экономика тарифов РабочиеЛисты AI при реальной нагрузке учителя.

Запуск:  python3 scripts/unit-economics.py
Документ с выводами: docs/04-pricing-economics-v2.md

Цены берутся из кода: backend/src/llm/config.ts (MODEL_COSTS, polza.ai), курс 85 ₽/$.
При смене цен на polza.ai править нужно ТАМ, потом синхронизировать сюда —
либо вынести в общий конфиг. Прайс-источник один, иначе расчёт разъедется с продом.

Что здесь моделируется:
  ART   — сколько out-токенов стоит один артефакт каждого типа (взято из промптов)
  SCEN  — сколько раз в неделю учитель делает каждый тип (ГИПОТЕЗА, проверить аналитикой)
  роут  — "opus_all": Opus на всём для тарифа Плюс (как было ДО 2026-10-02)
          "shipped": то, что в коде сейчас — Luna на массовых типах,
                     Sonnet 5.5 на контрольных/ОГЭ/ЕГЭ/КТП/презентациях
"""
RUB = 85.0
LUNA_IN, LUNA_OUT = 0.07, 0.35
SOL_IN, SOL_OUT = 1.39, 6.95
SONNET_IN, SONNET_OUT, SONNET_CACHE = 2.75, 13.75, 0.275
OPUS_IN, OPUS_OUT, OPUS_CACHE = 5.56, 27.80, 0.28
DS_IN, DS_OUT = 0.065, 0.13
SYS, USER = 1800, 250
FEE = 0.035
ACADEMIC_YEAR_MONTHS = 9

def validation_cost(out):
    """Пост-валидация на DeepSeek (задачи + инструкция → вердикт)."""
    return ((SYS + USER + out + 300) / 1e6 * DS_IN + 400 / 1e6 * DS_OUT) * RUB

def gen_cost(model, out):
    if model == "luna":   # +5% уходит в fallback Sol
        c = (SYS + USER) / 1e6 * LUNA_IN + out / 1e6 * LUNA_OUT
        c += 0.05 * ((SYS + USER) / 1e6 * SOL_IN + out / 1e6 * SOL_OUT)
        return c * RUB
    if model == "sonnet":  # system prompt в кэше → платим за cache-read
        return (SYS / 1e6 * SONNET_CACHE + USER / 1e6 * SONNET_IN
                + out / 1e6 * SONNET_OUT) * RUB
    c = SYS / 1e6 * OPUS_CACHE + USER / 1e6 * OPUS_IN + out / 1e6 * OPUS_OUT
    return c * RUB

# ─────────────────────────────────────────────────────────────────────────────
# Артефакты: (out-токены, ключ нагрузки)
# ─────────────────────────────────────────────────────────────────────────────
ART = {
    "Лист-домашка 10 зад.":        (1600, "home"),
    "Лист-тренировка 15-20 зад.":  (2600, "drill"),
    "Лист-карточка 5-8 зад.":      (900, "card"),
    "Карточки flashcards 8-40":    (1800, "cards"),
    "Контрольная (2 варианта)":   (3600, "control"),
    "Тест с автопроверкой":       (1400, "test"),
    "План урока ФГОС":            (1900, "plan"),
    "Презентация 10-15 слайдов":  (3500, "pres"),
    "Вариант ОГЭ/ЕГЭ":            (6500, "oge"),
    "КТП на год":                 (8000, "ktp"),
}

# Роутинг из backend/src/llm/router.ts (PRIMARY_BY_TASK).
# Задачи, которые отдаются Sonnet: сложные структурированные и экзаменационные.
SONNET_KEYS = {"control", "oge", "ktp", "pres"}

def model_for(key, routing):
    if routing == "opus_all":
        return "opus"
    return "sonnet" if key in SONNET_KEYS else "luna"

# ─────────────────────────────────────────────────────────────────────────────
# Нагрузка учителя: сколько раз в неделю делается каждый тип
#
# ГЛАВНОЕ ДОПУЩЕНИЕ (озвучено владельцем продукта, 2026-10-02): домашка
# задаётся на КАЖДЫЙ урок. Ставка 20-24 урока/нед. 34 учебные недели.
# Это гипотеза до первых 100 платящих — проверять через events(name='generate')
# и агрегат /api/admin/usage?month=...
# ─────────────────────────────────────────────────────────────────────────────
SCEN = {
    "A. Лёгкий (10 ген/нед)": dict(
        home=8, drill=2, card=2, cards=2, control=2, test=0, plan=2, pres=2, oge=0, ktp=0.0),
    "B. 20 уроков/нед": dict(
        home=14, drill=6, card=4, cards=3, control=3, test=2, plan=3, pres=3, oge=2, ktp=0.2),
    "C. 24 урока/нед (тяжёлый)": dict(
        home=20, drill=10, card=6, cards=4, control=4, test=3, plan=4, pres=4, oge=4, ktp=0.3),
}

WEEKS, MONTHS = 34.0, 9.0
PRICE = {"base": 3800 / MONTHS, "plus": 11000 / MONTHS}

# ─────────────────────────────────────────────────────────────────────────────
# Нормы тарифа — из plans.ts и backend/src/services/usage.ts
# ─────────────────────────────────────────────────────────────────────────────
PLAN_NORM = {"base": 1_440_000, "plus": 16_000_000}

def count_of(m, key):
    return m[key] * WEEKS

def cost_of_scenario(scn, routing):
    """Возвращает (cogs_base, cogs_plus, cogs_plus_shipped, артефактов/год)."""
    m = SCEN[scn]
    c_base = c_plus_opus = c_plus_shipped = 0.0
    total = 0.0
    for name, (out, key) in ART.items():
        n = count_of(m, key)
        total += n
        v = validation_cost(out)
        c_base += (gen_cost("luna", out) + v) * n
        c_plus_opus += (gen_cost("opus", out) + v) * n
        c_plus_shipped += (gen_cost(model_for(key, "shipped"), out) + v) * n
    return c_base, c_plus_opus, c_plus_shipped, total

print("=" * 92)
print("1. ЦЕНА ОДНОГО АРТЕФАКТА, ₽")
print("=" * 92)
print(f"{'Артефакт':<32}{'Luna':>9}{'Sonnet':>9}{'Opus':>9}{'экономия Opus→Sonnet':>22}")
print("-" * 92)
for name, (out, _) in ART.items():
    l = gen_cost("luna", out) + validation_cost(out)
    s = gen_cost("sonnet", out) + validation_cost(out)
    o = gen_cost("opus", out) + validation_cost(out)
    saving = (1 - s / o) * 100
    print(f"{name:<32}{l:>9.2f}{s:>9.2f}{o:>9.2f}{saving:>21.0f}%")

print()
print("=" * 92)
print("2. COGS ПО ТАРИФАМ, ₽/мес  (учебный год 34 недели, оплата за 9 мес, эквайринг 3,5%)")
print("=" * 92)
print(f"Выручка: Базовый {PRICE['base']:.0f} ₽/мес · Плюс {PRICE['plus']:.0f} ₽/мес")
print()
hdr = (f"{'Сценарий':<26}{'арт/мес':>8}{'Базовый':>10}{'маржа':>8}"
       f"{'Плюс (было)':>12}{'маржа':>8}{'Плюс (стало)':>13}{'маржа':>8}")
print(hdr); print("-" * 92)
for scn in SCEN:
    c_base, c_opus, c_shipped, total = cost_of_scenario(scn, "opus_all")
    f_base = c_base / MONTHS + FEE * PRICE["base"]
    f_opus = c_opus / MONTHS + FEE * PRICE["plus"]
    f_ship = c_shipped / MONTHS + FEE * PRICE["plus"]
    m_base = (PRICE["base"] - f_base) / PRICE["base"] * 100
    m_opus = (PRICE["plus"] - f_opus) / PRICE["plus"] * 100
    m_ship = (PRICE["plus"] - f_ship) / PRICE["plus"] * 100
    print(f"{scn:<26}{total/MONTHS:>8.0f}{f_base:>10,.0f}{m_base:>7.0f}%"
          f"{f_opus:>12,.0f}{m_opus:>7.0f}%{f_ship:>13,.0f}{m_ship:>7.0f}%")

print()
print("  «Плюс (было)» = Opus на всём, как было до 2026-10-02.")
print("  «Плюс (стало)» = Luna на массовых + Sonnet на экзаменах/КТП (что в коде сейчас).")

print()
print("=" * 92)
print("3. НОРМЫ ТАРИФА: покрывают ли они реальную нагрузку")
print("=" * 92)
for plan, norm in PLAN_NORM.items():
    per_token = LUNA_OUT / 1e6 * RUB
    cogs = norm * per_token
    revenue = PRICE[plan]
    print(f"  {plan:<6} норма {norm:>11,} взв. токенов/мес  →  COGS {cogs:>6.0f} ₽/мес  "
          f"при выручке {revenue:>6.0f} ₽  → маржа {(revenue-cogs-FEE*revenue)/revenue*100:>3.0f}%")
print()
for scn in SCEN:
    _, _, shipped_year, total = cost_of_scenario(scn, "shipped")
    # cost_of_scenario отдаёт COGS за ВЕСЬ учебный год, а норма — за месяц.
    # Забытое деление на MONTHS даёт завышение в 9 раз — так что явно.
    rub_per_token = LUNA_OUT / 1e6 * RUB
    weighted_per_month = shipped_year / MONTHS / rub_per_token
    ratio = weighted_per_month / PLAN_NORM["plus"]
    print(f"  {scn:<26} Плюс-эквивалент {weighted_per_month:>11,.0f} токенов/мес  "
          f"= {ratio:>5.0%} нормы «Плюс»")
print()
heavy_year = cost_of_scenario("C. 24 урока/нед (тяжёлый)", "shipped")[2]
heavy = heavy_year / MONTHS / (LUNA_OUT / 1e6 * RUB)
base_norm_used = cost_of_scenario("C. 24 урока/нед (тяжёлый)", "shipped")[0] / MONTHS / (LUNA_OUT / 1e6 * RUB)
print(f"  Норма «Плюс» = {PLAN_NORM['plus']:,} токенов/мес.")
print(f"  Сценарий C (24 урока/нед) = {heavy:,.0f} токенов/мес → "
      f"{'влезает с запасом' if heavy < PLAN_NORM['plus'] else 'НЕ ВЛЕЗАЕТ, норму поднять!'}.")
print(f"  Та же нагрузка на «Базовом» (всё на Luna) = {base_norm_used:,.0f} токенов/мес "
      f"= {base_norm_used/PLAN_NORM['base']:>5.0%} нормы «Базового».")
print()
print("  ВАЖНО. Норма «Плюса» (16 млн) втрое выше «Базового» (1,44 млн), хотя тариф")
print("  дороже в 2,9 раза, — и это не опечатка. Тариф «Плюс» тратит Sonnet там, где")
print("  «Базовый» тратит Luna, а Sonnet весит в 39 раз больше по выходным токенам.")
print("  Показывать эти цифры рядом можно только с пояснением: иначе «Плюс» выглядит")
print("  хуже, а он лучше по объёму.")

print()
print("=" * 92)
print("4. БЕЗЛИМИТ НА БАЗОВОМ: сколько выдерживает")
print("=" * 92)
per_list = gen_cost("luna", 1600) + validation_cost(1600)
for n in (50, 150, 400, 800, 1600, 3200):
    c = n * per_list
    print(f"  {n:>5} листов/мес → {c:>7,.0f} ₽/мес LLM   "
          f"маржа {(PRICE['base']-c-FEE*PRICE['base'])/PRICE['base']*100:>5.0f}%")
print(f"\n  Один лист-домашка стоит {per_list:.2f} ₽. Тариф в {PRICE['base']/per_list:,.0f} раз дороже листа.")

print()
print("=" * 92)
print("5. ТАРИФ «ШКОЛА» — 3 000 ₽/мес за класс, норма 3 × базовая")
print("=" * 92)
norm_school = PLAN_NORM["base"] * 3
cogs = norm_school * LUNA_OUT / 1e6 * RUB
print(f"  Норма {norm_school:,} взв. токенов/мес → COGS {cogs:.0f} ₽ при выручке 3 000 ₽ "
      f"→ маржа {(3000-cogs-0.035*3000)/3000*100:.0f}%")
print("  Примечание: ученикам генерация НЕ выдаётся (роль student в user_roles),")
print("  поэтому в норме класса сидит только учитель. Если ученики всё же начнут")
print("  генерировать, норму надо пересчитать — см. risks в docs/04-pricing-economics-v2.md.")

print()
print("=" * 92)
print("6. БЕСПЛАТНЫЙ ТАРИФ — 3 генерации всего, без сброса")
print("=" * 92)
free_limit = 3
cheapest = min(gen_cost("luna", out) + validation_cost(out) for out, _ in ART.values())
dearest = max(gen_cost("luna", out) + validation_cost(out) for out, _ in ART.values())
cheap_kvota = free_limit * cheapest
dear_kvota = free_limit * dearest
print(f"  Квота: {free_limit} генерации. Себестоимость всей квоты: "
      f"{cheap_kvota:.2f}–{dear_kvota:.2f} ₽ за ВСЮ жизнь пользователя.")
print(f"  1 000 бесплатных пользователей съедят максимум {dear_kvota * 1000:,.0f} ₽.")
print("  Считать, что на бесплатном тарифе можно заработать, нельзя.")
print()
print("  Следствие для антифрода: деньгами фрод не съедает, он съедает статистику")
print("  и репутацию. Отсюда мягкая реакция (капча, а не блокировка) — она дешёвая")
print("  и при этом не отрубает реального учителя.")

print()
print("=" * 92)
print("7. ЧТО НЕ ВХОДИТ В РАСЧЁТ")
print("=" * 92)
for line in [
    "налоги (УСН/патент) и зарплата разработки — при марже 73-90% не влияют на выводы,",
    "поддержка — считается отдельно, на тарифы не влияет,",
    "платёжная комиссия за СБП — может отличаться от 3,5% по карте; здесь 3,5% плоско,",
    "домен, почта, Cloudflare — копейки при наших объёмах,",
    "self-verification — в коде её нет; при включении на Sonnet COGS вырастет примерно",
    "  в 1,6 раза (проверка каждого задания = ещё один вызов). На Opus — минус в марже.",
]:
    print(f"  · {line}")
print()
print("  При марже Базового 86% и Плюса 73% (сценарий C) эти статьи не меняют выводы.")
print("  Но при марже Плюса 38% на 400 артефактов/мес — уже могут. Следить за первыми")
print("  100 платящими через GET /api/admin/usage?month=YYYY-MM.")

