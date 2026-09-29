"use client";

import * as React from "react";

interface Props {
  children: React.ReactNode;
  /** Required role(s) для доступа. Если не задано — любая админка. */
  roles?: string[];
}

/**
 * Stub AdminGuard — реальная логика в TZ f07/f08.
 * Пока пропускает всех (TODO: проверять роль из auth-сессии).
 */
export function AdminGuard({ children }: Props) {
  return <>{children}</>;
}
