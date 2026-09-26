"use client";

import { MEMO_TAG } from "@/lib/client";
import { nowHmInJst } from "@/lib/date";
import { formatDueLabel, formatDuration, PRIORITY_MEANING } from "@/lib/format";
import { notesPreview } from "@/lib/markdown";
import type { Item, Priority } from "@/lib/types";
import { cn } from "@/lib/utils";

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="inline-block shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 所要時間は砂時計で示す。時計（期限）と同じ大きさにして、形だけで種類が分かるようにする。
// 字形は時計の円（3〜21）と同じ幅に広げてある。狭いと枠内の余白ぶん文字が離れて見える
function HourglassIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block shrink-0"
      aria-hidden
    >
      <path d="M4 3h16M4 21h16M5 3v4l7 5-7 5v4M19 3v4l-7 5 7 5v4" />
    </svg>
  );
}

/** 所要時間の表示。Todayの一覧とInboxの未仕分けで同じ見た目にするため部品にしてある */
export function DurationLabel({ minutes }: { minutes: number }) {
  return (
    <span className="text-nibi inline-flex items-center gap-1 text-[11px]">
      <HourglassIcon />
      {formatDuration(minutes)}
    </span>
  );
}

/** 重要度のチップ。入力の書き方（!1）と同じ表記にし、意味はツールチップで補う。1だけ目立たせる */
export function PriorityChip({ priority }: { priority: Priority }) {
  return (
    <span
      title={`重要度${priority}（${PRIORITY_MEANING[priority]}）`}
      className={cn(
        "rounded-full px-2 py-px text-[10.5px] font-semibold",
        priority === 1 ? "bg-mikan-soft text-mikan" : "bg-kinari text-foreground/80",
      )}
    >
      !{priority}
    </span>
  );
}

// タスク行のタイトル＋メタ行（docs/design.md 2章）。Today と Inboxの「この先の予定」で共用。
// メタ行は「時刻 → 所要時間 → 重要度 → 期限超過 → タグ（無彩色） → 繰り返し/習慣（asagi）」の順。
// compact は親の下に展開した子タスク用。文字を一段小さく・細くして親と見分けられるようにする
export function TaskMeta({
  item,
  today,
  compact = false,
}: {
  item: Item;
  today: string;
  compact?: boolean;
}) {
  const due = formatDueLabel(item.due_date, item.due_time, today, nowHmInJst());
  // #memo は内部マーカー（Notes用）なのでチップ表示しない
  const tags = item.tags.filter((t) => t !== MEMO_TAG);
  const notePreview = notesPreview(item.notes);
  const chips: { text: string; tone: "beni" | "tag" | "asagi" }[] = [];
  if (due?.late) chips.push({ text: "期限超過", tone: "beni" });
  for (const t of tags) chips.push({ text: `#${t}`, tone: "tag" });
  if (item.recurrence_rule) chips.push({ text: "繰り返し", tone: "asagi" });
  if (item.habit_id) chips.push({ text: "習慣", tone: "asagi" });

  return (
    <span className="block min-w-0">
      <span
        className={cn("block break-words", compact ? "text-[13px]" : "text-sm font-medium")}
      >
        {item.title}
      </span>
      {notePreview && (
        <span className="text-nibi/80 mt-0.5 block truncate text-[11px]">{notePreview}</span>
      )}
      {(due || item.duration_min !== null || item.priority !== null || chips.length > 0) && (
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px]",
                due.overdue ? "text-beni font-semibold" : "text-nibi",
              )}
            >
              <ClockIcon />
              {due.text}
            </span>
          )}
          {item.duration_min !== null && <DurationLabel minutes={item.duration_min} />}
          {item.priority !== null && <PriorityChip priority={item.priority} />}
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
