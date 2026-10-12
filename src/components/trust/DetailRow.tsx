/**
 * Строка «реквизит → значение» для `/contact/` и `/about/`.
 *
 * Значение вида `{{ ИНН }}` — это пометка «владелец должен вписать», а не
 * данные. Показываем её заметно: пунктирная рамка и подпись под полем, чтобы
 * незаполненный реквизит нельзя было принять за готовый. Как только значение
 * приходит настоящее, рамка и подпись исчезают сами — здесь нет ветки,
 * которую надо было бы не забыть почистить.
 */

/** Значение-заглушка: плейсхолдер вида `{{ ... }}`. */
export function isPlaceholder(value: string): boolean {
  return value.trim().startsWith("{{") && value.trim().endsWith("}}");
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  const pending = isPlaceholder(value);

  return (
    <div className="flex flex-col gap-1 border-b border-warm-100 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-full shrink-0 text-sm font-medium text-warm-500 sm:w-56">{label}</dt>
      <dd>
        <span
          className={
            pending
              ? "inline-block rounded-md border border-dashed border-accent-300 bg-accent-50/60 px-2 py-0.5 font-mono text-sm text-accent-700"
              : "text-warm-900"
          }
        >
          {value}
        </span>
        {pending && (
          <span className="mt-1 block text-xs text-warm-500">
            Значение не задано — вписывает владелец сайта.
          </span>
        )}
      </dd>
    </div>
  );
}