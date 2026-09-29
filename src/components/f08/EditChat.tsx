"use client";

import * as React from "react";

interface Props {
  initialMessage?: string;
  onSend?: (message: string) => void | Promise<void>;
  // Stubs accept any extra props used by tracked pages until TZ f08 lands.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Stub EditChat — реальная логика в TZ f08 (chat-based editing).
 */
export function EditChat(props: Props) {
  const { initialMessage, onSend, ...rest } = props;
  const [value, setValue] = React.useState("");
  return (
    <div className="rounded-xl border border-warm-100 bg-white p-4">
      <p className="font-medium text-sm mb-2">EditChat (stub, f08 TZ)</p>
      <p className="text-xs text-warm-500 mb-2">{initialMessage ?? ""}</p>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full border rounded px-2 py-1 text-sm"
        placeholder="Stub input"
      />
      <button
        type="button"
        onClick={() => {
          if (typeof onSend === "function") onSend(value);
          setValue("");
        }}
        className="mt-2 px-3 py-1 bg-brand-500 text-white text-sm rounded"
      >
        Send
      </button>
      {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
      {Object.keys(rest).length > 0 ? null : null}
    </div>
  );
}
