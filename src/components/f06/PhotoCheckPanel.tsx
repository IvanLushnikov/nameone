"use client";

interface Props {
  imageUrl?: string;
  expectedAnswer?: string;
  // Stubs accept any extra props used by tracked pages until TZ f06 lands.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Stub PhotoCheckPanel — реальная логика в TZ f06 (photo-based grading).
 */
export function PhotoCheckPanel(props: Props) {
  const { imageUrl, expectedAnswer, ...rest } = props;
  return (
    <div className="rounded-xl border border-warm-100 bg-white p-4 text-sm text-warm-600">
      <p className="font-medium mb-2">PhotoCheckPanel (stub, f06 TZ)</p>
      <p>imageUrl: {String(imageUrl ?? "—")}</p>
      <p>expectedAnswer: {String(expectedAnswer ?? "—")}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
      {Object.keys(rest).length > 0 ? null : null}
    </div>
  );
}
