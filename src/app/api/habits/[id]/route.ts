// GET    /api/habits/[id] — 単体取得
// PATCH  /api/habits/[id] — 更新
// DELETE /api/habits/[id] — 削除（既存インスタンスは items.habit_id が SET NULL で残る）
import type { NextRequest } from "next/server";
import { handle, json, notFound, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import type { Habit } from "@/lib/types";
import { updateHabitSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

async function getHabit(id: string): Promise<Habit | null> {
  const { data, error } = await db.from("habits").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Habit | null) ?? null;
}

export function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const habit = await getHabit(id);
    if (!habit) return notFound("habit が見つかりません");
    return json({ habit });
  });
}

export function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, updateHabitSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const habit = await getHabit(id);
    if (!habit) return notFound("habit が見つかりません");

    const update: Record<string, unknown> = {};
    for (const key of [
      "title",
      "notes",
      "tags",
      "frequency_rule",
      "default_reminder_rule",
      "is_paused",
      "sort_order",
    ] as const) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) return json({ habit });

    const { data, error } = await db.from("habits").update(update).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return json({ habit: data });
  });
}

export function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const habit = await getHabit(id);
    if (!habit) return notFound("habit が見つかりません");
    const { error } = await db.from("habits").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  });
}
