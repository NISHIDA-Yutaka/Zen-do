// GET    /api/items/[id] — 単体取得（reminders・子ToDo・親付き）
// PATCH  /api/items/[id] — 更新（トリアージ=kind変更、期日変更時はリマインダー再計算）
// DELETE /api/items/[id] — 削除（子・リマインダーはFKでカスケード）
import type { NextRequest } from "next/server";
import { badRequest, handle, json, notFound, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import {
  buildReminderRows,
  deleteReminders,
  getItem,
  getReminders,
  insertReminders,
  recalcRelativeReminders,
} from "@/lib/items";
import type { Item } from "@/lib/types";
import { updateItemSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");

    const reminders = await getReminders(id);
    const { data: children, error } = await db
      .from("items")
      .select("*")
      .eq("parent_id", id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // 親（プロジェクト行の表示用）
    const parent = item.parent_id ? await getItem(item.parent_id) : null;

    return json({ item, reminders, children: children ?? [], parent });
  });
}

export function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, updateItemSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");

    // マージ後の実効値で制約チェック
    const effDueDate = body.due_date !== undefined ? body.due_date : item.due_date;
    const effDueTime = body.due_time !== undefined ? body.due_time : item.due_time;
    const effRecurrence =
      body.recurrence_rule !== undefined ? body.recurrence_rule : item.recurrence_rule;
    if (effDueTime && !effDueDate) return badRequest("due_time には due_date が必要です");
    if (effRecurrence && !effDueDate) return badRequest("recurrence_rule には due_date が必要です");

    // 提供されたフィールドのみ更新
    const update: Record<string, unknown> = {};
    for (const key of [
      "kind",
      "title",
      "notes",
      "tags",
      "status",
      "parent_id",
      "due_date",
      "due_time",
      "recurrence_rule",
      "sort_order",
    ] as const) {
      if (body[key] !== undefined) update[key] = body[key];
    }

    let updated = item;
    if (Object.keys(update).length > 0) {
      const { data, error } = await db
        .from("items")
        .update(update)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      updated = data as Item;
    }

    // リマインダー: reminders 指定があれば全置換、なければ期日変更時に相対ルールを再計算
    if (body.reminders !== undefined) {
      await deleteReminders(id);
      if (body.reminders.length > 0) {
        const built = buildReminderRows(id, body.reminders, effDueDate, effDueTime);
        if (!built.ok) return badRequest(built.message);
        await insertReminders(built.rows);
      }
    } else {
      const dueChanged =
        (body.due_date !== undefined && body.due_date !== item.due_date) ||
        (body.due_time !== undefined && body.due_time !== item.due_time);
      if (dueChanged) await recalcRelativeReminders(updated);
    }

    const reminders = await getReminders(id);
    return json({ item: updated, reminders });
  });
}

export function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");
    const { error } = await db.from("items").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  });
}
