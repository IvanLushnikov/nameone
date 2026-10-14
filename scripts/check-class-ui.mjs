/**
 * Проверка интерфейса классов (лист 3.1.5).
 *
 * Запуск: node scripts/check-class-ui.mjs
 *
 * ЧТО ПРОВЕРЯЕМ
 *   1. Имя ученика переносится, а не режется: в карточке ученика есть
 *      `break-words`, и рядом нет `truncate`, который на телефоне превращает
 *      соседей в неразличимые обрезки.
 *   2. Дубля нет: блок учеников НЕ содержит своего поля «назовите класс»,
 *      а названия классов приходят из соседней карточки «Мои классы».
 *   3. Страница настроек передаёт `knownClassNames` — иначе компонент падает
 *      с «Property 'knownClassNames' is missing».
 *   4. `activeForm` объявлен ДО первого использования. Обратный порядок — это
 *      не стилистика: в JS это «ReferenceError» во время первого рендера,
 *      то есть белый экран в настройках кабинета.
 *   5. Панель действий переносится на узком экране (`flex-wrap`).
 *
 * Скрипт читает исходники, ничего не запускает и не ходит в сеть.
 */

import { readFileSync } from "node:fs";

const COMPONENT = "src/components/lk/ClassRosterSection.tsx";
const SETTINGS = "src/app/dashboard/settings/page.tsx";

let failed = 0;
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  if (!ok) failed++;
}

const component = readFileSync(COMPONENT, "utf8");
const settings = readFileSync(SETTINGS, "utf8");

// 1. Имя переносится, а не обрезается.
const studentRow = component.slice(
  component.indexOf("min-w-0 break-words"),
  component.indexOf("min-w-0 break-words") + 400,
);
check(
  "имя ученика переносится по словам",
  component.includes("min-w-0 break-words"),
  "ожидался класс `min-w-0 break-words` на имени",
);
check(
  "имя ученика не обрезается многоточием",
  !studentRow.includes("truncate"),
  "в карточке ученика найден `truncate` — на телефоне соседи станут неразличимы",
);

// 2. Своего поля «назовите класс» в блоке учеников нет.
const ownClassInput = /placeholder="[^"]*класс/i.test(component);
check(
  "в блоке учеников нет своего поля для названия класса",
  !ownClassInput,
  "найден placeholder со словом «класс»: учитель завёл бы класс дважды",
);

// 3. Названия приходят из соседней карточки.
check(
  "страница настроек передаёт knownClassNames",
  /knownClassNames=\{view\.classes\}/.test(settings),
  "ожидалось `knownClassNames={view.classes}`",
);
check(
  "компонент объявляет knownClassNames обязательным",
  /knownClassNames:\s*string\[\]/.test(component),
);

// 4. Порядок объявления activeForm.
const declaredAt = component.search(/const activeForm = forms\.find/);
const firstUseAt = component.search(/activeForm \? buildPersonalLink/);
check(
  "activeForm объявлен до первого использования",
  declaredAt !== -1 && firstUseAt !== -1 && declaredAt < firstUseAt,
  declaredAt === -1
    ? "не найдено объявление activeForm"
    : firstUseAt === -1
      ? "не найдено использование activeForm"
      : `объявление на ${declaredAt + 1}, первое использование на ${firstUseAt + 1}`,
);

// 5. Панель действий переносится.
check(
  "панель действий переносится на узком экране",
  /flex[^"`]*flex-wrap[^"`]*"/.test(component),
  "ожидался `flex-wrap` на панели действий",
);

const width = Math.max(...checks.map((c) => c.name.length));
console.log(`[check-class-ui] проверок: ${checks.length}\n`);
for (const c of checks) {
  console.log(`  ${c.ok ? "ok  " : "ПЛОХО"} ${c.name.padEnd(width)}`);
  if (!c.ok && c.detail) console.log(`       → ${c.detail}`);
}

if (failed > 0) {
  console.error(`\n[check-class-ui] Нарушено правил: ${failed}.`);
  process.exit(1);
}
console.log("\n[check-class-ui] Интерфейс классов: одно поле, имена переносятся, порядок объявлений верный.");
console.log("CLASS_UI_OK");
