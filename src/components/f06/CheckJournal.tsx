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
import { SOURCE_HINT, SOURCE_LABEL, journalBadge, type JournalBadge, type JournalEntry } from "@/lib/photo-check/journal";
import { plural } from "@/lib/photo-check/confidence";

const BADGE_TONE = {
  machine: "info",
  teacher: "brand",
  mixed: "warm",
  pending: "warm",
} as const satisfies Record<JournalBadge, "info" | "brand" | "warm">;

/**
 * «Ждёт вас» — жёлтый. В проекте amber уже занят под «нужно ваше решение»,
 * новое семейство цветов из-за одной метки не вводим.
 */
const PENDING_CLASS = "bg-amber-100 text-amber-900 ring-amber-200";

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
        const badge = journalBadge(e);
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
                <Badge
                  tone={BADGE_TONE[badge]}
                  title={SOURCE_HINT[badge]}
                  className={badge === "pending" ? PENDING_CLASS : undefined}
                >
                  {SOURCE_LABEL[badge]}
                </Badge>
                <Button as="link" href={`/journal/?check=${encodeURIComponent(e.checkId)}`} variant="secondary" size="sm">
                  Открыть
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      {/* Что значат метки — словами, а не в подсказке, которую никто не
          наведёт. Меток четыре: незакрытая работа ждёт учителя, и сказать об
          этом надо явно, а не прятать под «проверил ИИ». */}
      <Card className="p-4 sm:p-5">
        <p className="text-xs font-medium text-warm-800">Что значат метки</p>
        <ul className="mt-2 space-y-1.5">
          {(["machine", "teacher", "mixed", "pending"] as const).map((b) => (
            <li key={b} className="text-xs text-warm-600 flex flex-wrap items-center gap-2">
              <Badge
                tone={BADGE_TONE[b]}
                className={b === "pending" ? PENDING_CLASS : undefined}
              >
                {SOURCE_LABEL[b]}
              </Badge>
              <span>{SOURCE_HINT[b]}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
