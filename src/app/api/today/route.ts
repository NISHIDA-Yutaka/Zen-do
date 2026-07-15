// GET /api/today — Todayビュー用データ。
//  - todos: 未完了ToDo（期日が今日以前＝今日分＋期限超過）。習慣インスタンスも含む
//  - habitCandidates: 今日が該当日で、まだ当日インスタンス未生成の非pause習慣（デイリープランナー候補）
//  - done: 今日(JST)完了したToDo（「完了済み n件」折りたたみ用。docs/design.md 2章）
import { handle, json } from "@/lib/api";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { frequencyMatchesDate } from "@/lib/frequency";
import type { Habit, Item } from "@/lib/types";

export function GET(): Promise<Response> {
  return handle(async () => {
    const today = todayInJst();

    const { data: todoData, error: todoErr } = await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .in("status", ["todo", "doing"])
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .order("sort_order", { ascending: true });
    if (todoErr) throw new Error(todoErr.message);
    const todos = (todoData ?? []) as Item[];

    const todayStartIso = new Date(`${today}T00:00:00+09:00`).toISOString();
    const { data: doneData, error: doneErr } = await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "done")
      .gte("done_at", todayStartIso)
      .order("done_at", { ascending: false });
    if (doneErr) throw new Error(doneErr.message);
    const done = (doneData ?? []) as Item[];

    // 今日該当の非pause習慣
    const { data: habitData, error: habitErr } = await db
      .from("habits")
      .select("*")
      .eq("is_paused", false);
    if (habitErr) throw new Error(habitErr.message);
    const matching = (habitData as Habit[]).filter((h) =>
      frequencyMatchesDate(h.frequency_rule, today),
    );

    // 今日分が既に生成済みの habit_id を除外
    const { data: todayInstances, error: instErr } = await db
      .from("items")
      .select("habit_id")
      .eq("due_date", today)
      .not("habit_id", "is", null);
    if (instErr) throw new Error(instErr.message);
    const instantiated = new Set(
      (todayInstances ?? []).map((r) => (r as { habit_id: string }).habit_id),
    );
    const habitCandidates = matching.filter((h) => !instantiated.has(h.id));

    return json({ date: today, todos, habitCandidates, done });
  });
}
