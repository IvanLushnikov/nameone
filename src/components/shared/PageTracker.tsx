"use client";

import * as React from "react";
import { trackPageView } from "@/lib/track";

interface Props {
  eventName: string;
  data?: Record<string, unknown>;
}

/**
 * Stub PageTracker: на клиенте шлёт page view в трекер.
 * Тут рендерит null — это просто обёртка для side-effect.
 */
export function PageTracker({ eventName, data }: Props) {
  React.useEffect(() => {
    trackPageView(eventName, data);
  }, [eventName, data]);
  return null;
}
