// Stub для f06/f07/f08 tracking (не реализовано, см. TZ f06/f07/f08).
// Минимальный API, который не ломает компиляцию остального кода.

export type TrackEventName = string;
export type TrackEventData = Record<string, unknown> | undefined;

export function trackEvent(name: TrackEventName, data?: TrackEventData): void {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug(`[track] ${name}`, data);
  }
}

export function trackPageView(name: TrackEventName, data?: TrackEventData): void {
  trackEvent(name, data);
}
