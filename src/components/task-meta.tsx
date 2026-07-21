"use client";

import { formatDueLabel } from "@/lib/format";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

// タスク行のタイトル＋メタ行（docs/design.md 2章）。Today と Inboxの「この先の予定」で共用。
// メタ行は「先頭に期限、その後にチップ」の順。
export function TaskMeta({ item, today }: { item: Item; today: string }) {
  const due = formatDueLabel(item.due_date, item.due_time, today);
  const chips: { text: string; tone: "beni" | "asagi" }[] = [];
  if (due?.late) chips.push({ text: "期限超過", tone: "beni" });
  if (item.recurrence_rule) chips.push({ text: "繰り返し", tone: "asagi" });
  if (item.habit_id) chips.push({ text: "習慣", tone: "asagi" });

  return (
    <span className="block min-w-0">
      <span className="block truncate text-sm font-medium">{item.title}</span>
      {(due || chips.length > 0) && (
        <span className="mt-0.5 flex items-center gap-2">
          {due && (
            <span className={cn("text-[11px]", due.late ? "text-beni font-semibold" : "text-nibi")}>
              {due.text}
            </span>
          )}
          {chips.map((c) => (
            <span
              key={c.text}
              className={cn(
                "rounded-full px-2 py-px text-[10.5px] font-semibold",
                c.tone === "beni" ? "bg-beni-soft text-beni" : "bg-asagi-soft text-asagi",
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
