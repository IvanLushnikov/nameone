import * as React from "react";

interface Props {
  children: React.ReactNode;
}

/**
 * Stub AdminLayout — реальная навигация/хлебные крошки в TZ f07/f08.
 */
export function AdminLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-warm-50">
      <div className="container-tight py-8">
        <div className="rounded-2xl bg-white border border-warm-100 p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
