// Item / Reminder のデータ層ヘルパー（server-only）。API Routes から使う。
import "server-only";
import { db } from "@/lib/db";
import { isRelativeReminderRule, resolveRemindAt } from "@/lib/reminders";
import type { Item, Reminder, ReminderRule } from "@/lib/types";

/** Supabase の error を throw に変換（handle() が500に変換する）。 */
function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function getItem(id: string): Promise<Item | null> {
  const { data, error } = await db.from("items").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Item | null) ?? null;
}

export async function getReminders(itemId: string): Promise<Reminder[]> {
  const { data, error } = await db
    .from("reminders")
    .select("*")
    .eq("item_id", itemId)
    .order("remind_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Reminder[]) ?? [];
}

type ReminderRow = { item_id: string; rule: ReminderRule; remind_at: string };

/**
 * リマインダールール群を、DB行（remind_at 解決済み）へ変換する。
 * 解決できないルール（例: before_due_minutes なのに due_time が無い）があれば失敗を返す。
 */
export function buildReminderRows(
  itemId: string,
  rules: ReminderRule[],
  dueDate: string | null,
  dueTime: string | null,
): { ok: true; rows: ReminderRow[] } | { ok: false; message: string } {
  const rows: ReminderRow[] = [];
  for (const rule of rules) {
    const remindAt = resolveRemindAt(rule, dueDate, dueTime);
    if (remindAt === null) {
      return {
        ok: false,
        message: `リマインダー(${rule.kind})を解決できません。期日/時刻が不足しています`,
      };
    }
    rows.push({ item_id: itemId, rule, remind_at: remindAt });
  }
  return { ok: true, rows };
}

export async function insertReminders(rows: ReminderRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from("reminders").insert(rows);
  if (error) throw new Error(error.message);
}

export async function deleteReminders(itemId: string): Promise<void> {
  const { error } = await db.from("reminders").delete().eq("item_id", itemId);
  if (error) throw new Error(error.message);
}

/**
 * due_date / due_time 変更後に、相対ルールのリマインダーを再計算する（docs/database-design.md 6.1）。
 * 絶対時刻(at)は据え置き。相対ルールが解決不能になった場合はそのリマインダーを削除する。
 */
export async function recalcRelativeReminders(item: Item): Promise<void> {
  const reminders = await getReminders(item.id);
  for (const r of reminders) {
    if (!isRelativeReminderRule(r.rule)) continue;
    const remindAt = resolveRemindAt(r.rule, item.due_date, item.due_time);
    if (remindAt === null) {
      await db.from("reminders").delete().eq("id", r.id);
    } else if (remindAt !== r.remind_at) {
      const { error } = await db.from("reminders").update({ remind_at: remindAt }).eq("id", r.id);
      if (error) throw new Error(error.message);
    }
  }
}

export { unwrap };
