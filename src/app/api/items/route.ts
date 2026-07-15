// GET /api/items  — 一覧（クエリで絞り込み）
// POST /api/items — 作成（クイックキャプチャ含む。既定 kind='inbox'）
import type { NextRequest } from "next/server";
import { badRequest, handle, json, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { buildReminderRows, getReminders, insertReminders } from "@/lib/items";
import type { Item } from "@/lib/types";
import { createItemSchema } from "@/lib/validation";

export function GET(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    let query = db.from("items").select("*");

    const kind = q.get("kind");
    if (kind) query = query.eq("kind", kind);

    const status = q.get("status");
    if (status) query = query.eq("status", status);

    // parent_id=null で最上位のみ、UUID指定でその子
    const parentId = q.get("parent_id");
    if (parentId === "null") query = query.is("parent_id", null);
    else if (parentId) query = query.eq("parent_id", parentId);

    const isMemo = q.get("is_memo");
    if (isMemo === "true") query = query.eq("is_memo", true);
    else if (isMemo === "false") query = query.eq("is_memo", false);

    const dueOn = q.get("due_on");
    if (dueOn) query = query.eq("due_date", dueOn);

    const dueBefore = q.get("due_before");
    if (dueBefore) query = query.lte("due_date", dueBefore);

    const tag = q.get("tag");
    if (tag) query = query.contains("tags", [tag]);

    query = query.order("sort_order", { ascending: true }).order("created_at", { ascending: true });

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return json({ items: data ?? [] });
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const parsed = await parseBody(req, createItemSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const dueDate = body.due_date ?? null;
    const dueTime = body.due_time ?? null;

    // クロスフィールド制約（DBのCHECK制約と対応。ここで先に分かりやすいエラーを返す）
    if (dueTime && !dueDate) return badRequest("due_time には due_date が必要です");
    if (body.recurrence_rule && !dueDate) return badRequest("recurrence_rule には due_date が必要です");

    const insert = {
      kind: body.kind ?? "inbox",
      title: body.title,
      notes: body.notes ?? "",
      tags: body.tags ?? [],
      is_memo: body.is_memo ?? false,
      status: body.status ?? "todo",
      parent_id: body.parent_id ?? null,
      due_date: dueDate,
      due_time: dueTime,
      recurrence_rule: body.recurrence_rule ?? null,
      captured_raw: body.captured_raw ?? null,
    };

    const { data, error } = await db.from("items").insert(insert).select("*").single();
    if (error) throw new Error(error.message);
    const item = data as Item;

    if (body.reminders && body.reminders.length > 0) {
      const built = buildReminderRows(item.id, body.reminders, dueDate, dueTime);
      if (!built.ok) {
        // アイテムは作成済みなので、リマインダー不整合はロールバックして返す
        await db.from("items").delete().eq("id", item.id);
        return badRequest(built.message);
      }
      await insertReminders(built.rows);
    }

    const reminders = await getReminders(item.id);
    return json({ item, reminders }, 201);
  });
}
