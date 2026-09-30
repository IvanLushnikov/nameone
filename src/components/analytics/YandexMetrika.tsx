import Script from 'next/script';

/**
 * Яндекс.Метрика — счётчик посещений.
 *
 * TZ-10 §8.1, §9.1: подключение в layout, ID берётся из NEXT_PUBLIC_YM_ID.
 * Без заданного ID компонент ничего не рендерит (безопасно для билда).
 *
 * TODO(legal): по §11.1 риски TZ-152 сейчас используется стандартный режим
 * (с cookies: webvisor/clickmap/trackLinks). После консультации с юристом —
 * переключить на cookieless-режим через проп `cookieless`, либо отказаться
 * от Метрики в пользу Plausible/Topvisor (см. §11.1 риск «сайд-эффект на
 * Privacy / 152-ФЗ»). До решения юриста — НЕ использовать в production без
 * cookie-баннера.
 */

export interface YandexMetrikaProps {
  /** 8-значный ID счётчика из https://metrika.yandex.ru. Пустая строка = отключено. */
  counterId: string;
  /**
   * Режим без cookies (ФЗ-152, GDPR). По умолчанию выключен — стандартный режим.
   * Когда включён — отключает webvisor и отправляет данные без cookies
   * (точность отслеживания падает, но юридических рисков меньше).
   */
  cookieless?: boolean;
}

export function YandexMetrika({ counterId, cookieless = false }: YandexMetrikaProps) {
  if (!counterId) return null;

  const initOptions = cookieless
    ? 'ssr:true, webvisor:false, clickmap:true, trackLinks:true, accurateTrackBounce:true, disableCookies:true'
    : 'ssr:true, webvisor:true, clickmap:true, trackLinks:true, accurateTrackBounce:true';

  return (
    <>
      <Script id="ym-counter" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
        (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
        ym(${counterId}, "init", { ${initOptions} });`}
      </Script>
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://mc.yandex.ru/watch/${counterId}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}

export default YandexMetrika;