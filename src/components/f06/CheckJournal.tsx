"use client";

/**
 * Список проверок в журнале (ТЗ-19 §5.1).
 *
 * Отдельный компонент, а не разметка прямо в `app/journal/page.tsx`: тот же
 * список потом понадобится в дашборде и, возможно, в мобильной вёрстке, и
 * таблица должна остаться одна.
 *
 * Что учитель обязан увидеть в каждой строке и почему:
 *   дата/время  — «когда я это проверял», главный вопрос при разборе;
 *   предмет/класс — работы лежат стопкой, без класса они неразличимы;
 *   отметка      — либо число, либо честное «не разобрано»;
 *   бейдж        — ЧЬЁ это решение: модель или человек. Без него журнал через
 *                  месяц не отличить от «ИИ всех завалил», и доверие к фиче
 *                  уйдёт вместе с первой обидной ошибкой.
 */

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SOURCE_HINT, SOURCE_LABEL, type JournalEntry } from "@/lib/photo-check/journal";
import { plural } from "@/lib/photo-check/confidence";

const SOURCE_TONE = {
  machine: "info",
  teacher: "brand",
  mixed: "warm",
} as const;

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export function CheckJournal({ entries }: { entries: JournalEntry[] }) {
  return (
    <div className="space-y-3">
      {entries.map((e) => {
        // Неразобранная работа — это не «двойка». Пишем словами, иначе
        // учитель решит, что отметка потерялась.
        const markText = e.mark ? `отметка ${e.mark}` : "не разобрано";
        const pendingText =
          e.pendingTasks > 0
            ? ` · ждут вас: ${e.pendingTasks} ${plural(e.pendingTasks, "задание", "задания", "заданий")}`
            : "";
        return (
          <Card key={e.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-warm-900">
                  {DATE_FMT.format(new Date(e.occurredAt * 1000))}
                </p>
                <p className="text-sm text-warm-600 mt-0.5">
                  {e.subject ?? "предмет не указан"}
                  {e.grade ? ` · ${e.grade} класс` : ""} ·{" "}
                  {e.earnedPoints} из {e.totalPoints} баллов
                </p>
                <p className="text-sm mt-1">
                  <span className="font-medium text-warm-950">
                    {e.percentage !== null ? `${e.percentage}% · ` : ""}
                  </span>
                  <span className={e.mark ? "text-warm-900" : "text-amber-800"}>
                    {markText}
                    {pendingText}
                  </span>
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <Badge tone={SOURCE_TONE[e.source]} title={SOURCE_HINT[e.source]}>
                  {SOURCE_LABEL[e.source]}
                </Badge>
                <Button as="link" href={`/journal/?check=${encodeURIComponent(e.checkId)}`} variant="secondary" size="sm">
                  Открыть
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      {/* Что значат бейджи — один раз словами, а не в подсказке, которую никто
          не наведёт. */}
      <Card className="p-4 sm:p-5">
        <p className="text-xs font-medium text-warm-800">Что значат бейджи</p>
        <ul className="mt-1.5 space-y-1">
          {(["machine", "teacher", "mixed"] as const).map((s) => (
            <li key={s} className="text-xs text-warm-600">
              <span className="text-warm-800">{SOURCE_LABEL[s]}</span> — {SOURCE_HINT[s].toLowerCase()}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
