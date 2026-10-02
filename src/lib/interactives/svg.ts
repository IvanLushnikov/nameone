/**
 * Санитайзер SVG для `InteractiveItem.svg` (ТЗ §4.8).
 *
 * КОНТЕКСТ РИСКА. `InteractiveItem.svg` — это строка SVG, которую на БЭКЕНДЕ
 * собрал `renderChart()` и положил в `config_json`. Она едет в браузер ученика
 * и вставляется через `dangerouslySetInnerHTML` — единственный способ отдать
 * векторную графику в статический экспорт.
 *
 * Шаблоны рендерера экранируют текст через `escapeXml`
 * (`src/lib/llm/svg-templates/*.ts`), то есть «чистый» путь безопасен. Но:
 *   - правила экранирования живут в семи шаблонах, а не в одном месте;
 *   - строка целиком кладётся в JSON и приходит извне — доверять границе
 *     «мы сами сгенерили» нельзя;
 *   - ТЗ §4.8 и DoD требуют обязательный тест на `</script>` и `onload=`.
 *
 * ПОЭТОМУ это вторая линия защиты, а не «на всякий случай»: allowlist тегов,
 * удаление обработчиков событий, проверка URL-атрибутов и FAIL-CLOSED на
 * финальной проверке (если после чистки осталось что-то подозрительное —
 * отдаём пустую строку, а не «надеемся, что браузер справится»).
 *
 * Проверка текста из LLM: текст НИКОГДА не вставляется вручную — он либо уже
 * экранирован внутри SVG, либо рендерится React'ом как обычный текст
 * (`{item.prompt}`), а React экранирует `<`, `>`, `&` сам.
 */

/** Теги, которые рендерер реально производит + близкие безопасные соседи. */
const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "desc",
  "title",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "marker",
  "clippath",
  "mask",
  "pattern",
  "lineargradient",
  "radialgradient",
  "stop",
]);

/**
 * Теги, которые выкидываем ВМЕСТЕ С СОДЕРЖИМОМ.
 *
 * `use` — тянет внешний документ по `href`; `image` — грузит внешний ресурс;
 * `animate`/`set`/`handler` — могут дописать атрибут (в том числе `onload`)
 * уже после нашей проверки; `foreignObject` — вставляет произвольный HTML.
 */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "use",
  "image",
  "animate",
  "animatetransform",
  "animatemotion",
  "set",
  "handler",
  "listener",
  "audio",
  "video",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
]);

/** Атрибуты-ссылки: пропускаем только фрагмент `#id` внутри того же документа. */
const URL_ATTRS = new Set(["href", "xlink:href", "xlink:hrefs", "src", "from", "to", "values", "begin", "attributename"]);

const EVENT_ATTR = /^on/i;
const ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
const DANGEROUS_VALUE = /(javascript|vbscript|data:text\/html|expression\s*\()/i;
const STYLE_DANGEROUS = /(@import|expression\s*\(|javascript:|url\s*\()/i;

/** Парсер одного тега: `name="v"`, `name='v'`, `name=v`, `name`. */
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/** Экранирование текста для XML/SVG-атрибутов. React делает то же сам. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Почистить одну SVG-строку. Возвращает безопасную строку или `""`.
 *
 * Правила:
 *   1. вырезаем HTML-комментарии и CDATA;
 *   2. вырезаем опасные элементы вместе с содержимым;
 *   3. неизвестные теги РАЗВОРАЧИВАЕМ (оставляем текст, убираем обвязку) —
 *      так подпись из «чужого» шаблона не исчезает целиком;
 *   4. у разрешённых тегов чистим атрибуты: события, URL-атрибуты, опасные
 *      значения, `style` с `@import`/`url()`;
 *   5. FAIL-CLOSED: если в результате осталось хоть что-то из чёрного списка —
 *      возвращаем пустую строку.
 */
export function sanitizeSvg(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";

  // ВАЖНО: здесь НЕТ предварительной вырезки `</script`. Раньше она стояла, но
  // ломала главное правило: `<script>alert(1)</script>` после вырезки превращался
  // в `<script>alert(1)>`, где закрывающего тега уже нет — `skipUntilTag` не
  // закрывался, и `alert(1)` утекал в выход как обычный текст.
  // Элемент идёт в `DROP_WITH_CONTENT`, а «висячий» `</script` в тексте парсер
  // и так отбрасывает как неизвестный закрывающий тег.
  const source = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

  let out = "";
  let cursor = 0;
  // Индекс в `source`, с которого возобновляем обход после вырезанного элемента.
  let skipUntilTag: string | null = null;
  let depth = 0;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(source)) !== null) {
    const [full, closing, rawName, rawAttrs = "", selfClosing] = match;
    const name = rawName.toLowerCase();

    // Пропускаем всё, пока не закроется вырезаемый элемент.
    if (skipUntilTag !== null) {
      if (name === skipUntilTag) {
        if (closing) {
          depth -= 1;
          if (depth <= 0) {
            skipUntilTag = null;
            // Всё вырезанное считаем обработанным — иначе оно попадёт в хвост.
            cursor = match.index + full.length;
          }
        } else if (!selfClosing) {
          depth += 1;
        }
      }
      continue;
    }

    // Внутри элемента — только его содержимое, без текста «до» и «после».
    if (closing) {
      if (DROP_WITH_CONTENT.has(name) || !ALLOWED_TAGS.has(name)) continue;
      out += source.slice(cursor, match.index) + `</${name}>`;
      cursor = match.index + full.length;
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      // ВАЖНО: для `script` и `style` самозакрывающийся вид НЕ уважается.
      // В HTML `<script/>alert(1)</script>` — это НЕ пустой скрипт: парсер
      // игнорирует слэш и читает `alert(1)` как тело скрипта, то есть
      // `alert(1)` выполнится. Поэтому для них всегда ждём закрывающий тег.
      //
      // Остальные вырезаемые элементы (`image`, `use`, `animate`…) — настоящие
      // SVG-конструкции, которые пишутся самозакрывающимися и закрывающего тега
      // не имеют. Если ждать его для них, то `<image …/>` съел бы весь
      // остаток картинки — поэтому для них `/>` означает «вырезать и идти дальше».
      const isHtmlVoidless = name === "script" || name === "style";
      if (!selfClosing || isHtmlVoidless) {
        skipUntilTag = name;
        depth = 1;
      }
      // Курсор двигаем В ОБОИХ случаях. Раньше он двигался только при
      // незакрытом теге, и самозакрывающийся `<image …/>` выпадал из вывода
      // один, но `cursor` оставался на нём — следующая же вставка
      // `source.slice(cursor, match.index)` возвращала вырезанный тег обратно
      // как обычный текст. Внешний ресурс уезжал в `dangerouslySetInnerHTML`.
      cursor = match.index + full.length;
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) {
      // Неизвестный тег: разворачиваем — текст внутри остаётся, обвязка нет.
      cursor = match.index + full.length;
      continue;
    }

    out +=
      source.slice(cursor, match.index) +
      `<${name}${sanitizeAttributes(rawAttrs)}${selfClosing ? " /" : ""}>`;
    cursor = match.index + full.length;
  }

  out += source.slice(cursor);

  // FAIL-CLOSED: после чистки не должно остаться ничего исполняемого.
  if (/<\s*script|<\s*iframe|<\s*object|<\s*embed|<\s*foreignObject|javascript:|\son[a-z]+\s*=/i.test(out)) {
    return "";
  }
  return out;
}

/** Чистит набор атрибутов одного разрешённого тега. */
function sanitizeAttributes(raw: string): string {
  if (!raw) return "";
  const kept: string[] = [];
  let match: RegExpExecArray | null;

  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    const lower = name.toLowerCase();

    // Обработчики событий: onload=, onclick=, onerror= — точка XSS в SVG.
    if (EVENT_ATTR.test(lower)) continue;
    if (!ATTR_NAME.test(name)) continue;
    if (value.includes("<") || value.includes(">")) continue;
    if (DANGEROUS_VALUE.test(value)) continue;

    if (lower === "style") {
      if (STYLE_DANGEROUS.test(value)) continue;
      kept.push(`${name}="${escapeXml(value)}"`);
      continue;
    }

    // Ссылки — только внутрь того же документа.
    if (URL_ATTRS.has(lower) && !value.startsWith("#")) continue;

    kept.push(value === "" ? name : `${name}="${escapeXml(value)}"`);
  }

  return kept.length > 0 ? ` ${kept.join(" ")}` : "";
}

/**
 * Безопасная вставка SVG в React: `dangerouslySetInnerHTML` только здесь,
 * и только с прогнанным через `sanitizeSvg` значением.
 */
export function safeSvgHtml(raw: unknown): { __html: string } {
  return { __html: sanitizeSvg(raw) };
}
