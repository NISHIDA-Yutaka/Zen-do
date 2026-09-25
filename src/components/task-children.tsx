"use client";

import { TaskMeta } from "@/components/task-meta";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";

// 一覧の子タスク展開（docs/design.md 2章）。Today・Inboxの未仕分け・この先の予定で同じ見た目にする

// 子のない行にも同じ幅の空きを置き、完了の丸の位置を全行で揃える。
// 左の余白へはみ出させて、行の字下げが増えすぎないようにしている
export function ExpandToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return <span aria-hidden className="-mx-1.5 w-4 shrink-0" />;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? `子タスク${count}件を畳む` : `子タスク${count}件を開く`}
      onClick={onToggle}
      className="text-nibi hover:text-foreground hit-y -mx-1.5 flex w-4 shrink-0 justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("transition-transform", open && "rotate-90")}
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

export function ChildTaskRows({
  items,
  today,
  busyIds,
  onComplete,
  onOpen,
}: {
  items: Item[];
  today: string;
  busyIds: Set<string>;
  onComplete: (item: Item) => void;
  onOpen: (id: string) => void;
}) {
  return items.map((child, i) => (
    <li
      key={child.id}
      className={cn(
        "flex items-center gap-2.5 py-2 pl-10",
        i === items.length - 1 && "border-keisen border-b pb-3",
      )}
    >
      <button
        type="button"
        aria-label={`${child.title}を完了`}
        disabled={busyIds.has(child.id)}
        onClick={() => onComplete(child)}
        className="border-wakuiro hover:border-tokiwa hit size-[18px] shrink-0 rounded-full border-[1.5px] disabled:opacity-40"
      />
      <button type="button" onClick={() => onOpen(child.id)} className="min-w-0 flex-1 text-left">
        <TaskMeta item={child} today={today} compact />
      </button>
    </li>
  ));
}

export function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
