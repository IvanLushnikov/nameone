/**
 * Яндекс.Метрика — счётчик посещений.
 *
 * TZ-10 §8.1, §9.1: подключение в корневом layout, счётчик работает на всех
 * страницах сайта (root layout оборачивает в т.ч. /oge/ и /admin/).
 *
 * ПОЧЕМУ ИНЛАЙН-<script>, А НЕ next/script
 * ---------------------------------------
 * Сайт собирается статическим экспортом (`next.config.mjs` → `output: "export"`)
 * и выкатывается на Cloudflare Pages папкой `out/`. С `next/script` сборка
 * упиралась в таймауты, поэтому счётчик ранее был отключён в layout.
 * Обычный `<script dangerouslySetInnerHTML>` попадает прямо в готовый HTML
 * при билде: на статике это ровно то, что нужно — код есть в исходнике
 * страницы, без гидрации и без зависимости от рантайма Next.
 *
 * ПОЧЕМУ ID ЗАШИТ КОНСТАНТОЙ, А НЕ ТОЛЬКО ИЗ .env
 * ----------------------------------------------
 * ID счётчика не секрет: он всё равно лежит открытым в HTML на каждой
 * странице сайта. А вот `.env` в этот репозиторий НЕ попадает (в `.gitignore`,
 * строка 44), и в CI-сборке (`.github/workflows/deploy.yml`) переменной
 * `NEXT_PUBLIC_YM_ID` нет. Если бы ID читался только из env, прод собрался бы
 * с пустым счётчиком — тихо, без ошибок, и метрика просто не заработала бы.
 * Поэтому: константа как значение по умолчанию + env как переопределение.
 *
 * РЕЖИМ COOKIES
 * -------------
 * По умолчанию стандартный режим (webvisor/clickmap/trackLinks) — он же
 * прописан в юридических страницах: cookies `_ym_uid` и `_ym_d` перечислены
 * в /legal/cookies. Проп `cookieless` оставлен как безопасная альтернатива,
 * если позже понадобится отключить cookies (точность вебвизора при этом падает).
 */

/**
 * ID счётчика «УчЛист» на https://metrika.yandex.ru.
 * Публичное значение: попадает в HTML каждой страницы, скрыть его нельзя.
 * Переопределяется переменной NEXT_PUBLIC_YM_ID (для стендов и тестов).
 */
export const DEFAULT_YM_ID = "113327591";

export interface YandexMetrikaProps {
  /** 8-значный ID счётчика. Пустая строка = счётчик отключён (компонент не рендерит ничего). */
  counterId?: string;
  /**
   * Режим без cookies (ФЗ-152, GDPR). По умолчанию выключен — стандартный режим,
   * согласованный с текстом на /legal/cookies.
   */
  cookieless?: boolean;
}

/**
 * Код счётчика — официальный сниппет Яндекс.Метрики.
 *
 * `ecommerce: "dataLayer"` требует, чтобы массив dataLayer существовал, иначе
 * Яндекс ругается в консоль на пустые ecommerce-события. Инициализируем его
 * здесь же, до `ym(..., "init", ...)`.
 */
function buildSnippet(counterId: string, cookieless: boolean): string {
  const options = [
    "ssr:true",
    `webvisor:${cookieless ? "false" : "true"}`,
    "clickmap:true",
    "trackLinks:true",
    "accurateTrackBounce:true",
    'ecommerce:"dataLayer"',
    "referrer:document.referrer",
    "url:location.href",
    ...(cookieless ? ["disableCookies:true"] : []),
  ].join(", ");

  return `
(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for (var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${counterId}','ym');

window.dataLayer=window.dataLayer||[];
ym(${counterId},'init',{${options}});
`.trim();
}

export function YandexMetrika({ counterId, cookieless = false }: YandexMetrikaProps) {
  // env — переопределение, константа — рабочее значение по умолчанию.
  const id = (counterId ?? process.env.NEXT_PUBLIC_YM_ID ?? DEFAULT_YM_ID).trim();

  if (!id) return null;

  return (
    <>
      {/* Намеренно обычный <script>, а не next/script: при статическом экспорте
          он кладётся в HTML на этапе сборки, без гидрации и без зависимости
          от клиентского рантайма Next. */}
      <script dangerouslySetInnerHTML={{ __html: buildSnippet(id, cookieless) }} />
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://mc.yandex.ru/watch/${id}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}

export default YandexMetrika;
