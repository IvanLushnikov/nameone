/**
 * Определение типа устройства: тач (планшет/телефон) или десктоп.
 *
 * Зачем: на iPad с подключённой мышью `matchMedia("(pointer: coarse)")` ВРАЖТ —
 * браузер переключается на `pointer: fine`, и устройство ошибочно считается
 * десктопом. Именно этот случай чиним (жалоба учительницы: «не поняла, где
 * жмакать, чтоб скачать или распечатать» — на iPad это выглядело как
 * «ничего не скачивается»). Поэтому iPad/iOS проверяем ЯВНО, до `pointer`.
 *
 * Файл безопасен для SSR: проект собирается как static export, поэтому
 * без `window`/`navigator` возвращаем безопасное значение по умолчанию
 * (`false` = «десктоп»), а не падаем.
 */

/**
 * Значение по умолчанию, когда определить нельзя (SSR, старый браузер без
 * `matchMedia`). «Десктоп» — более консервативный выбор: показываем оба
 * варианта экспорта (PDF + DOCX) вместо того, чтобы отобрать у пользователя
 * кнопку печати на компьютере.
 */
const DEFAULT_IS_TOUCH = false;

/** Ниже этой ширины шансов на десктоп уже нет — даже без сенсорного экрана. */
const TOUCH_VIEWPORT_MAX_PX = 1024;

function isIpadOrIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ притворяется десктопом (Macintosh + maxTouchPoints > 1).
  // Именно поэтому проверка идёт по тач-точкам, а не только по UA.
  const maxTouchPoints =
    typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
  const isDesktopMasquerade = /Macintosh|Mac OS X/i.test(ua);
  if (isDesktopMasquerade && maxTouchPoints > 1) return true;
  return /iPad|iPhone|iPod/i.test(ua);
}

/** `pointer: coarse` — основной признак тач-устройства, если API доступен. */
function hasCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function hasTouchPoints(): boolean {
  if (typeof navigator === "undefined") return false;
  return (typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0) > 0;
}

function viewportWidth(): number | null {
  if (typeof window === "undefined") return null;
  const w = window.innerWidth || 0;
  return w > 0 ? w : null;
}

/**
 * Синхронное определение тач-устройства. SSR-safe.
 *
 * Порядок проверок важен: явная проверка iPad/iOS идёт ПЕРВОЙ, потому что
 * подключённая мышь на iPad ломает `pointer: coarse` и `hover: none`.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return DEFAULT_IS_TOUCH;
  }
  // 1. iPad/iOS — единственный случай, где pointer-медиа врёт.
  if (isIpadOrIos()) return true;
  // 2. Настоящий тач: coarse-указатель ИЛИ несколько точек касания.
  if (hasCoarsePointer() || hasTouchPoints()) return true;
  // 3. Фолбэк по ширине окна — на случай если оба media/тач-признака молчат.
  const w = viewportWidth();
  if (w !== null && w <= TOUCH_VIEWPORT_MAX_PX) return true;
  return DEFAULT_IS_TOUCH;
}

/**
 * Подписка на смену типа устройства (планшет подключили к монитору,
 * пользователь перевернул iPad, окно перетащили на узкий экран).
 *
 * Возвращает функцию отписки. Внутри — только `resize` и смена
 * `pointer`-медиа; никаких таймеров, поэтому безопасно вызывать в useEffect.
 */
export function subscribeToDeviceChange(onChange: (isTouch: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const notify = () => onChange(isTouchDevice());

  window.addEventListener("resize", notify);

  let mql: MediaQueryList | null = null;
  if (typeof window.matchMedia === "function") {
    try {
      mql = window.matchMedia("(pointer: coarse)");
      // addEventListener — современный API, addListener — легаси для старых Safari.
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", notify);
      } else if (typeof mql.addListener === "function") {
        mql.addListener(notify);
      }
    } catch {
      mql = null;
    }
  }

  return () => {
    window.removeEventListener("resize", notify);
    if (mql && typeof mql.removeEventListener === "function") {
      mql.removeEventListener("change", notify);
    } else if (mql && typeof mql.removeListener === "function") {
      mql.removeListener(notify);
    }
  };
}
