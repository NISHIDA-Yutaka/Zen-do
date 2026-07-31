// MCP操作ツールの実処理（server-only）。docs/mcp-integration.md 2章 / plan 4.2。
// 完了/取り消し/習慣生成の中核は既存libを共用（挙動を本体と揃える）。
// 各関数は { error } か { message, task } を返す。message は副作用の説明を含める。
import "server-only";
import { completeItem, uncompleteItem } from "@/lib/complete";
import { nowHmInJst, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { computeHabitStats } from "@/lib/habit-stats";
import { instantiateHabit } from "@/lib/habit-instance";
import {
  buildReminderRows,
  getReminders,
  insertReminders,
  recalcRelativeReminders,
} from "@/lib/items";
import { loadHabitForWrite, loadTaskForWrite } from "@/lib/mcp/guard";
import { serializeTaskSummary, type McpTaskSummary } from "@/lib/mcp/serialize";
import { autoDueTimeReminders } from "@/lib/reminders";
import type { Item } from "@/lib/types";

export type MutationResult = { error: string } | { message: string; task: McpTaskSummary };

function summarize(item: Item, message: string): MutationResult {
  return {
    message,
    task: serializeTaskSummary(item, { today: todayInJst(), nowHM: nowHmInJst(), hasChildren: false }),
  };
}

export async function createTask(args: {
  title: string;
  due_date?: string | null;
  due_time?: string | null;
  tags?: string[];
  parent_id?: string | null;
}): Promise<MutationResult> {
  const dueDate = args.due_date ?? null;
  const dueTime = args.due_time ?? null;
  if (dueTime && !dueDate) return { error: "due_time を指定するには due_date が必要です。" };

  const insert = {
    kind: "todo" as const,
    title: args.title,
    notes: "",
    tags: args.tags ?? [],
    status: "todo" as const,
    parent_id: args.parent_id ?? null,
    due_date: dueDate,
    due_time: dueTime,
  };
  const { data, error } = await db.from("items").insert(insert).select("*").single();
  if (error) throw new Error(error.message);
  const item = data as Item;

  // 期限時刻があれば期限ちょうどの通知を自動付与（本体の POST /api/items と同じ）
  const auto = autoDueTimeReminders(dueDate, dueTime, 0);
  if (auto.length > 0) {
    const built = buildReminderRows(item.id, auto, dueDate, dueTime);
    if (built.ok) await insertReminders(built.rows);
  }

  const where = dueDate ? `${dueDate}${dueTime ? ` ${dueTime}` : ""}` : "Inbox（期日なし）";
  return summarize(item, `タスク「${item.title}」を作成しました（${where}）。`);
}

export async function completeTask(id: string, expectedTitle: string): Promise<MutationResult> {
  const g = await loadTaskForWrite(id, expectedTitle);
  if (!g.ok) return { error: g.message };
  if (g.item.status === "done") return { error: `「${g.item.title}」は既に完了しています。` };

  const { item, next } = await completeItem(g.item);
  let message = `「${item.title}」を完了しました。`;
  if (next) message += ` 繰り返しの次回（${next.due_date}）を作成しました。`;
  if (item.habit_id) {
    const streak = await habitStreakText(item.habit_id);
    if (streak) message += ` ${streak}`;
  }
  return summarize(item, message);
}

export async function uncompleteTask(id: string, expectedTitle: string): Promise<MutationResult> {
  const g = await loadTaskForWrite(id, expectedTitle);
  if (!g.ok) return { error: g.message };
  if (g.item.status !== "done") {
    return { error: `「${g.item.title}」はまだ完了していません。取り消す必要はありません。` };
  }

  const { item, rolledBack } = await uncompleteItem(g.item);
  let message = `「${item.title}」の完了を取り消しました。`;
  if (rolledBack) message += " 繰り返しで生成された次回分も巻き戻しました。";
  return summarize(item, message);
}

export async function setDue(
  id: string,
  expectedTitle: string,
  dueDate: string | null,
  dueTime?: string | null,
): Promise<MutationResult> {
  const g = await loadTaskForWrite(id, expectedTitle);
  if (!g.ok) return { error: g.message };
  const item = g.item;

  // 繰り返しガード: 期日クリアは繰り返し設定も外すため、繰り返しタスクには拒否
  if (dueDate === null && item.recurrence_rule) {
    return {
      error:
        `「${item.title}」は繰り返しタスクです。期日を外すと繰り返し設定も消えてしまうため、この操作はできません。` +
        `具体的な日付への変更は可能です。`,
    };
  }

  // 期日クリア時は due_time / recurrence_rule も外す（本体の期日クリアと同じ。繰り返しはガード済みで既にnull）
  // 日付変更時は due_time を明示指定があれば更新、なければ既存を保持
  const newTime = dueDate === null ? null : dueTime !== undefined ? dueTime : item.due_time;
  const update =
    dueDate === null
      ? { due_date: null, due_time: null, recurrence_rule: null }
      : { due_date: dueDate, due_time: newTime };

  const { data, error } = await db.from("items").update(update).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  const updated = data as Item;

  // 期日/時刻が変わったので相対リマインダーを再計算（本体の PATCH と同じ）
  await recalcRelativeReminders(updated);
  // 時刻を新規付与（なし→あり）＆リマインダーが無ければ期限ちょうどの通知を自動付与
  if (dueDate !== null && !!newTime && !item.due_time) {
    const existing = await getReminders(id);
    const auto = autoDueTimeReminders(updated.due_date, updated.due_time, existing.length);
    if (auto.length > 0) {
      const built = buildReminderRows(id, auto, updated.due_date, updated.due_time);
      if (built.ok) await insertReminders(built.rows);
    }
  }

  const message =
    dueDate === null
      ? `「${updated.title}」の期日を外し、Inbox（未仕分け）へ戻しました。`
      : `「${updated.title}」の期日を ${dueDate}${newTime ? ` ${newTime}` : ""} に変更しました。`;
  return summarize(updated, message);
}

export async function addHabitToday(habitId: string, expectedTitle: string): Promise<MutationResult> {
  const g = await loadHabitForWrite(habitId, expectedTitle);
  if (!g.ok) return { error: g.message };

  const { item, created } = await instantiateHabit(g.habit, todayInJst());
  const message = created
    ? `習慣「${item.title}」を今日のタスクに追加しました。`
    : `習慣「${item.title}」は既に今日追加済みです。`;
  return summarize(item, message);
}

// 習慣完了後の「◯日連続」を組み立てる（会話用の副作用説明）。失敗しても致命ではないので握りつぶす。
async function habitStreakText(habitId: string): Promise<string | null> {
  try {
    const { data: habitData } = await db.from("habits").select("*").eq("id", habitId).maybeSingle();
    if (!habitData) return null;
    const habit = habitData as { frequency_rule: Parameters<typeof computeHabitStats>[0] };
    const { data: doneData } = await db
      .from("items")
      .select("due_date")
      .eq("habit_id", habitId)
      .eq("status", "done");
    const dates = ((doneData ?? []) as { due_date: string | null }[])
      .map((d) => d.due_date)
      .filter((d): d is string => d !== null);
    const stats = computeHabitStats(habit.frequency_rule, dates, todayInJst());
    return `習慣の記録に加算されました（${stats.streak}${stats.streakUnit}連続）。`;
  } catch {
    return null;
  }
}
