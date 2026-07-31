// POST /api/habits/[id]/instantiate — 習慣から当日分のToDoインスタンスを生成（デイリープランナーのピック）。
// body: { date?: 'YYYY-MM-DD' }（既定は今日JST）。実装は src/lib/habit-instance.ts（MCPと共用）。
import type { NextRequest } from "next/server";
import { handle, json, notFound, parseBody } from "@/lib/api";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { instantiateHabit } from "@/lib/habit-instance";
import type { Habit } from "@/lib/types";
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

    const result = await instantiateHabit(habit, date);
    return json(result, result.created ? 201 : 200);
  });
}
