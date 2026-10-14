#!/usr/bin/env node
/**
 * Здоровье карты сайта: все ли URL из sitemap.xml отдают страницу.
 *
 * Зачем. Из плана действий: «1641 URL в sitemap — но сколько из них реально в
 * индексе, никто не проверял». Индексацию без Вебмастера не посмотреть, а вот
 * МЁРТВЫЕ URL проверить можно: поисковик обходит их краулером, тратит лимит
 * обхода и ничего не находит. Это и есть поломка индексации, которую видно без
 * доступа к панели.
 *
 * Проверяются адреса ИЗ КАРТЫ, а не из исходников сборки: нас интересует то,
 * что реально отдаётся по www-адресам.
 *
 *   node scripts/check-sitemap-health.mjs --sitemap out/sitemap.xml --report report.json
 *
 * Успех — `SITEMAP_ALL_OK`. Любой не-2xx/3xx ответ, таймаут или ошибка сети
 * роняют проверку и печатаются списком.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const SITEMAP = argOf("--sitemap", "out/sitemap.xml");
const REPORT = argOf("--report", null);
const CONCURRENCY = Number(argOf("--concurrency", "15"));
const TIMEOUT_MS = Number(argOf("--timeout-ms", "20000"));

/** Коды, при которых URL считается живым: страница отдалась или ушла на каноник. */
const OK_CODES = new Set([200, 204, 301, 302, 307, 308]);

function readSitemap() {
  let xml;
  try {
    xml = readFileSync(join(process.cwd(), SITEMAP), "utf8");
  } catch {
    console.error(`ПРОВАЛ: не прочитан ${SITEMAP} — сначала соберите проект (npm run build)`);
    process.exit(1);
  }
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!locs.length) {
    console.error(`ПРОВАЛ: в ${SITEMAP} нет ни одного <loc>`);
    process.exit(1);
  }
  return locs;
}

/** Сколько раз пробуем адрес, прежде чем признать его недоступным. */
const ATTEMPTS = Number(argOf("--attempts", "3"));

/**
 * Один запрос с таймаутом. Не роняет весь прогон, а возвращает причину.
 *
 * Транспортный сбой (`fetch failed`) — это НЕ битая страница: это наша сеть.
 * Первый прогон 13.10.2026 так и выдал 7 «битых» адресов из 1641, которые при
 * повторной проверке по одному отвечали 200. Поэтому сетевой сбой повторяется,
 * а настоящий код ответа — нет.
 */
async function probe(url) {
  let lastError = "неизвестная ошибка";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // HEAD дешевле, но не все хостинги его корректно отдают: если HEAD вернул
      // 405/501, повторяем GET — иначе «битых» URL будет ровно столько, сколько
      // сервер не умеет HEAD, а это ничего не говорит о сайте.
      let res = await fetch(url, { method: "HEAD", redirect: "manual", signal: ctrl.signal });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
      }
      return { url, status: res.status, attempts: attempt };
    } catch (e) {
      lastError = e?.name === "AbortError" ? `таймаут ${TIMEOUT_MS} мс` : String(e?.message ?? e);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return { url, status: 0, attempts: ATTEMPTS, error: lastError };
}

async function main() {
  const locs = readSitemap();
  console.log(`Проверяю ${locs.length} URL из ${SITEMAP} (параллельность ${CONCURRENCY})…`);

  const broken = [];   // сайт ответил кодом, который означает поломку
  const unreachable = []; // сеть не дала ответа даже после попыток
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < locs.length) {
      const url = locs[cursor++];
      const r = await probe(url);
      if (r.status === 0) unreachable.push(r);
      else if (!OK_CODES.has(r.status)) broken.push(r);
      done++;
      if (done % 250 === 0 || done === locs.length) {
        process.stdout.write(`  ${done}/${locs.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const summary = {
    checkedAt: new Date().toISOString(),
    sitemap: SITEMAP,
    total: locs.length,
    ok: locs.length - broken.length,
    broken: broken.map((b) => ({ url: b.url, status: b.status, error: b.error ?? null })),
    unreachable: unreachable.map((b) => ({ url: b.url, attempts: b.attempts, error: b.error ?? null })),
  };

  if (REPORT) {
    try {
      writeFileSync(join(process.cwd(), REPORT), JSON.stringify(summary, null, 2), "utf8");
    } catch (e) {
      console.error(`ПРОВАЛ: не записался отчёт ${REPORT}: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  if (unreachable.length) {
    console.error(
      `\nПРОВАЛ: ${unreachable.length} адресов не удалось проверить даже с ${ATTEMPTS} попытками.`,
    );
    for (const b of unreachable.slice(0, 20)) console.error(`  сеть: ${b.url} — ${b.error}`);
    if (unreachable.length > 20) console.error(`  …ещё ${unreachable.length - 20}`);
    console.error("Это сеть, а не поломка сайта: перегони проверку, когда связь устойчивая.");
    console.error("SITEMAP_ALL_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }

  if (broken.length) {
    console.error(`\nПРОВАЛ: не отвечают ${broken.length} из ${locs.length}:`);
    for (const b of broken.slice(0, 40)) {
      console.error(`  ${b.status || "ошибка"}  ${b.url}${b.error ? ` — ${b.error}` : ""}`);
    }
    if (broken.length > 40) console.error(`  …ещё ${broken.length - 40}`);
    console.error("SITEMAP_ALL_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }

  console.log(`Все ${locs.length} URL отвечают.`);
  console.log("SITEMAP_ALL_OK");
}

await main();