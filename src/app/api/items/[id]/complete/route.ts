// POST /api/items/[id]/complete — ToDoを完了し、繰り返しがあれば次回を1件だけ生成する。
// セマンティクス: docs/database-design.md 4.3/4.4/4.5。
// 手順は「次回生成 → 完了マーク」の順。generated_from の部分ユニークindexが二重生成を防ぐため、
// 途中失敗して再試行されても重複しない（idempotent）。
import type { NextRequest } from "next/server";
import { badRequest, handle, json, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { getItem, getReminders, insertReminders } from "@/lib/items";
import { isRelativeReminderRule, resolveRemindAt } from "@/lib/reminders";
import { computeNextDueDate } from "@/lib/recurrence";
import { todayInJst } from "@/lib/date";
import type { Item } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const item = await getItem(id);
    if (!item) return notFound("item が見つかりません");
    if (item.kind === "inbox") return badRequest("Inbox項目は完了できません。先に仕分けしてください");

    // 既に完了済みなら冪等に返す（次回は既存の生成分を探す）
    if (item.status === "done") {
      const existing = await findGeneratedChild(id);
      return json({ item, next: existing });
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
          next = await findGeneratedChild(id);
        } else {
          throw new Error(error.message);
        }
      } else {
        next = data as Item;
        // 相対ルールのリマインダーのみ、新しい期日で複製（絶対時刻 at は複製しない）
        const original = await getReminders(id);
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
    }

    // 完了マーク
    const { data: done, error: doneErr } = await db
      .from("items")
      .update({ status: "done", done_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (doneErr) throw new Error(doneErr.message);

    return json({ item: done as Item, next });
  });
}

async function findGeneratedChild(parentCompletedId: string): Promise<Item | null> {
  const { data, error } = await db
    .from("items")
    .select("*")
    .eq("generated_from", parentCompletedId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Item | null) ?? null;
}
