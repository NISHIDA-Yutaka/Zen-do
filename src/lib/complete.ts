// ToDo完了/取り消しの中核ロジック（server-only）。docs/database-design.md 4.3〜4.5。
// 既存の complete/uncomplete ルートと MCP から共用する。HTTP関心事は持たない
// （呼び出し側が item を取得済みで渡す）。挙動は元のルート実装と同一。
import "server-only";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { copyDescendantsForRecurrence, getReminders, insertReminders } from "@/lib/items";
import { computeNextDueDate } from "@/lib/recurrence";
import { isRelativeReminderRule, resolveRemindAt } from "@/lib/reminders";
import type { Item } from "@/lib/types";

export async function findGeneratedChild(parentCompletedId: string): Promise<Item | null> {
  const { data, error } = await db
    .from("items")
    .select("*")
    .eq("generated_from", parentCompletedId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Item | null) ?? null;
}

/**
 * ToDoを完了する。繰り返しがあれば次回を1件だけ生成し、子孫（チェックリスト）を複製する。
 * 手順は「次回生成 → 完了マーク」。generated_from の部分ユニークindexで二重生成を防ぐ（冪等）。
 */
export async function completeItem(item: Item): Promise<{ item: Item; next: Item | null }> {
  // 既に完了済みなら冪等に返す（次回は既存の生成分を探す）
  if (item.status === "done") {
    const existing = await findGeneratedChild(item.id);
    return { item, next: existing };
  }

  let next: Item | null = null;

  // 繰り返しがあれば次回を生成（due_date は制約により recurrence があれば必ず存在）
  if (item.recurrence_rule && item.due_date) {
    const nextDue = computeNextDueDate(item.recurrence_rule, item.due_date, todayInJst());
    const insertRow = {
      kind: "todo" as const,
      title: item.title,
      notes: item.notes,
      tags: item.tags,
      parent_id: item.parent_id,
      habit_id: item.habit_id,
      due_date: nextDue,
      due_time: item.due_time,
      recurrence_rule: item.recurrence_rule,
      sort_order: item.sort_order,
      status: "todo" as const,
      generated_from: item.id,
      postponed_count: 0,
    };
    const { data, error } = await db.from("items").insert(insertRow).select("*").single();
    if (error) {
      // 23505 = unique_violation: 既に生成済み（二重完了リクエスト）。既存を採用しリマインダー複製はしない
      if (error.code === "23505") {
        next = await findGeneratedChild(item.id);
      } else {
        throw new Error(error.message);
      }
    } else {
      next = data as Item;
      // 相対ルールのリマインダーのみ、新しい期日で複製（絶対時刻 at は複製しない）
      const original = await getReminders(item.id);
      const rows = original
        .filter((r) => isRelativeReminderRule(r.rule))
        .map((r) => ({
          item_id: next!.id,
          rule: r.rule,
          remind_at: resolveRemindAt(r.rule, nextDue, item.due_time),
        }))
        .filter((row): row is { item_id: string; rule: typeof row.rule; remind_at: string } =>
          row.remind_at !== null,
        );
      await insertReminders(rows);
    }
    // 子孫（チェックリスト等）を次回インスタンスへ複製する（docs/database-design.md 4.4）。
    // 23505経路で既存を採用した場合も、複製自体が冪等なので再実行して取りこぼしを防ぐ。
    if (next) await copyDescendantsForRecurrence(item.id, next.id);
  }

  // 完了マーク
  const { data: done, error: doneErr } = await db
    .from("items")
    .update({ status: "done", done_at: new Date().toISOString() })
    .eq("id", item.id)
    .select("*")
    .single();
  if (doneErr) throw new Error(doneErr.message);

  return { item: done as Item, next };
}

/**
 * 完了を取り消す。繰り返しで生成された次回が「未着手・未編集」なら削除して巻き戻す
 * （docs/database-design.md 4.5）。着手/編集済みなら残す。
 */
export async function uncompleteItem(item: Item): Promise<{ item: Item; rolledBack: boolean }> {
  // 完了していなければ何もしない（二重クリックに寛容に）
  if (item.status !== "done") return { item, rolledBack: false };

  let rolledBack = false;
  const { data: child, error } = await db
    .from("items")
    .select("*")
    .eq("generated_from", item.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const next = child as Item | null;
  if (next && next.status === "todo" && next.created_at === next.updated_at) {
    const { error: delErr } = await db.from("items").delete().eq("id", next.id);
    if (delErr) throw new Error(delErr.message);
    rolledBack = true;
  }

  const { data: reopened, error: upErr } = await db
    .from("items")
    .update({ status: "todo", done_at: null })
    .eq("id", item.id)
    .select("*")
    .single();
  if (upErr) throw new Error(upErr.message);

  return { item: reopened as Item, rolledBack };
}
