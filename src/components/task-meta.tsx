"use client";

import { MEMO_TAG } from "@/lib/client";
import { nowHmInJst } from "@/lib/date";
import { formatDueLabel } from "@/lib/format";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

// タスク行のタイトル＋メタ行（docs/design.md 2章）。Today と Inboxの「この先の予定」で共用。
// メタ行は「時刻 → 期限超過 → タグ（無彩色） → 繰り返し/習慣（asagi）」の順。
export function TaskMeta({ item, today }: { item: Item; today: string }) {
  const due = formatDueLabel(item.due_date, item.due_time, today, nowHmInJst());
  // #memo は内部マーカー（Notes用）なのでチップ表示しない
  const tags = item.tags.filter((t) => t !== MEMO_TAG);
  const chips: { text: string; tone: "beni" | "tag" | "asagi" }[] = [];
  if (due?.late) chips.push({ text: "期限超過", tone: "beni" });
  for (const t of tags) chips.push({ text: `#${t}`, tone: "tag" });
  if (item.recurrence_rule) chips.push({ text: "繰り返し", tone: "asagi" });
  if (item.habit_id) chips.push({ text: "習慣", tone: "asagi" });

  return (
    <span className="block min-w-0">
      <span className="block text-sm font-medium break-words">{item.title}</span>
      {(due || chips.length > 0) && (
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {due && (
            <span className={cn("text-[11px]", due.overdue ? "text-beni font-semibold" : "text-nibi")}>
              {due.text}
            </span>
          )}
          {chips.map((c) => (
            <span
              key={c.text}
              className={cn(
                "rounded-full px-2 py-px text-[10.5px] font-semibold",
                c.tone === "beni"
                  ? "bg-beni-soft text-beni"
                  : c.tone === "asagi"
                    ? "bg-asagi-soft text-asagi"
                    : "bg-kinari text-foreground/80",
              )}
            >
              {c.text}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
