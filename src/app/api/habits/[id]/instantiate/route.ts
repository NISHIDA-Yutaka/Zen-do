// POST /api/habits/[id]/instantiate — 習慣から当日分のToDoインスタンスを生成（デイリープランナーのピック）。
// body: { date?: 'YYYY-MM-DD' }（既定は今日JST）。docs/database-design.md 5.2。
// (habit_id, due_date) のユニーク制約により同日二重生成は不可。既存があれば冪等に返す。
import type { NextRequest } from "next/server";
import { handle, json, notFound, parseBody } from "@/lib/api";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { buildReminderRows, getReminders, insertReminders } from "@/lib/items";
import type { Habit, Item } from "@/lib/types";
import { instantiateHabitSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const { id } = await ctx.params;
    const parsed = await parseBody(req, instantiateHabitSchema);
    if (!parsed.ok) return parsed.response;
    const date = parsed.data.date ?? todayInJst();

    const { data: habitData, error: habitErr } = await db
      .from("habits")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (habitErr) throw new Error(habitErr.message);
    const habit = habitData as Habit | null;
    if (!habit) return notFound("habit が見つかりません");

    const insertRow = {
      kind: "todo" as const,
      title: habit.title,
      notes: habit.notes,
      tags: habit.tags,
      habit_id: habit.id,
      due_date: date,
      status: "todo" as const,
    };
    const { data, error } = await db.from("items").insert(insertRow).select("*").single();

    if (error) {
      // 23505 = 既に当日分が生成済み → 既存を冪等に返す
      if (error.code === "23505") {
        const { data: existing, error: exErr } = await db
          .from("items")
          .select("*")
          .eq("habit_id", id)
          .eq("due_date", date)
          .maybeSingle();
        if (exErr) throw new Error(exErr.message);
        const item = existing as Item;
        return json({ item, reminders: await getReminders(item.id), created: false });
      }
      throw new Error(error.message);
    }

    const item = data as Item;
    // 既定リマインダーがあれば付与
    if (habit.default_reminder_rule) {
      const built = buildReminderRows(item.id, [habit.default_reminder_rule], date, null);
      if (built.ok) await insertReminders(built.rows);
    }
    return json({ item, reminders: await getReminders(item.id), created: true }, 201);
  });
}
