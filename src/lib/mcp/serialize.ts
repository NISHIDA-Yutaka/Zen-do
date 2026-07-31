// MCP返却用のタスク整形（純粋関数）。docs/mcp-implementation-plan.md 3.1。
// Item を、AIが状況を語れる派生値付きのプレーンオブジェクトへ変換する。
import { diffDays, todayInJst } from "@/lib/date";
import { formatDueLabel, formatRecurrenceRule } from "@/lib/format";
import type { Item, Reminder } from "@/lib/types";

/** 期限超過の判定と超過日数。当日で due_time を過ぎた場合は overdue かつ 0日。 */
export function overdueInfo(
  dueDate: string | null,
  dueTime: string | null,
  today: string,
  nowHM: string,
): { overdue: boolean; overdue_days: number | null } {
  const due = formatDueLabel(dueDate, dueTime, today, nowHM);
  if (!due || !due.overdue || !dueDate) return { overdue: false, overdue_days: null };
  // 過去日は today との差、当日の時刻超過は 0
  const days = dueDate < today ? diffDays(dueDate, today) : 0;
  return { overdue: true, overdue_days: days };
}

/** Inbox滞留日数（created_at のJST暦日から today までの経過日数）。 */
export function staleDays(createdAtIso: string, today: string): number {
  const createdDate = todayInJst(new Date(createdAtIso));
  return diffDays(createdDate, today);
}

export type McpTaskSummary = {
  id: string;
  title: string;
  status: Item["status"];
  due_date: string | null;
  due_time: string | null;
  overdue: boolean;
  overdue_days: number | null;
  tags: string[];
  has_notes: boolean;
  is_recurring: boolean;
  is_habit: boolean;
  has_children: boolean;
  parent_id: string | null;
  postponed_count: number;
  recurrence?: string;
  stale_days?: number;
};

type SummaryContext = {
  today: string;
  nowHM: string;
  hasChildren: boolean;
  staleDays?: number;
};

export function serializeTaskSummary(item: Item, ctx: SummaryContext): McpTaskSummary {
  const { overdue, overdue_days } = overdueInfo(item.due_date, item.due_time, ctx.today, ctx.nowHM);
  const summary: McpTaskSummary = {
    id: item.id,
    title: item.title,
    status: item.status,
    due_date: item.due_date,
    due_time: item.due_time ? item.due_time.slice(0, 5) : null,
    overdue,
    overdue_days,
    tags: item.tags,
    has_notes: item.notes.trim() !== "",
    is_recurring: item.recurrence_rule !== null,
    is_habit: item.habit_id !== null,
    has_children: ctx.hasChildren,
    parent_id: item.parent_id,
    postponed_count: item.postponed_count,
  };
  if (item.recurrence_rule) summary.recurrence = formatRecurrenceRule(item.recurrence_rule);
  if (ctx.staleDays !== undefined) summary.stale_days = ctx.staleDays;
  return summary;
}

export type McpTaskDetail = McpTaskSummary & {
  notes: string;
  reminders: string[];
  children: McpTaskSummary[];
};

type DetailContext = {
  today: string;
  nowHM: string;
  reminders: Reminder[];
  children: Item[];
  childHasChildren: Set<string>;
};

export function serializeTaskDetail(item: Item, ctx: DetailContext): McpTaskDetail {
  const base = serializeTaskSummary(item, {
    today: ctx.today,
    nowHM: ctx.nowHM,
    hasChildren: ctx.children.length > 0,
  });
  return {
    ...base,
    notes: item.notes,
    reminders: ctx.reminders.map((r) => formatReminderText(r)),
    children: ctx.children.map((c) =>
      serializeTaskSummary(c, {
        today: ctx.today,
        nowHM: ctx.nowHM,
        hasChildren: ctx.childHasChildren.has(c.id),
      }),
    ),
  };
}

// リマインダーは「表記＋発火予定(JST)」で返す
function formatReminderText(r: Reminder): string {
  const jst = new Date(new Date(r.remind_at).getTime() + 9 * 3600_000);
  const at = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
  return r.sent_at ? `${at}（送信済み）` : at;
}
