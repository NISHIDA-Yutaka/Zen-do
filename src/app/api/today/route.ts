// GET /api/today — Todayビュー用データ。
//  - todos: 未完了ToDo（期日が今日以前＝今日分＋期限超過）。習慣インスタンスも含む
//  - habitCandidates: 今日が該当日で、まだ当日インスタンス未生成の非pause習慣（デイリープランナー候補）
//  - done: 今日(JST)完了したToDo（「完了済み n件」折りたたみ用。docs/design.md 2章）
import { handle, json } from "@/lib/api";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { isPlannerCandidate } from "@/lib/frequency";
import type { Habit, Item } from "@/lib/types";

export function GET(): Promise<Response> {
  return handle(async () => {
    const today = todayInJst();
    const todayStartIso = new Date(`${today}T00:00:00+09:00`).toISOString();

    // 独立した5クエリを並列実行する（docs/design.md 17章。直列だと往復が積み上がる）
    const [todoRes, doneRes, habitRes, logRes, instRes] = await Promise.all([
      db
        .from("items")
        .select("*")
        .eq("kind", "todo")
        .eq("status", "todo")
        .lte("due_date", today)
        .order("due_date", { ascending: true })
        .order("sort_order", { ascending: true }),
      db
        .from("items")
        .select("*")
        .eq("kind", "todo")
        .eq("status", "done")
        .gte("done_at", todayStartIso)
        .order("done_at", { ascending: false }),
      db.from("habits").select("*").eq("is_paused", false),
      db.from("items").select("habit_id, due_date").eq("status", "done").not("habit_id", "is", null),
      db.from("items").select("habit_id").eq("due_date", today).not("habit_id", "is", null),
    ]);

    for (const res of [todoRes, doneRes, habitRes, logRes, instRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    const todos = (todoRes.data ?? []) as Item[];
    const done = (doneRes.data ?? []) as Item[];
    // 非pause習慣のうち、完了ログ由来の頻度判定（docs/design.md 10.1）で今日が候補のもの
    const habits = (habitRes.data ?? []) as Habit[];

    // 完了ログ = 完了済み習慣インスタンスの due_date 集合（habit_idごと）
    const doneDatesByHabit = new Map<string, string[]>();
    for (const r of (logRes.data ?? []) as { habit_id: string; due_date: string | null }[]) {
      if (!r.due_date) continue;
      const arr = doneDatesByHabit.get(r.habit_id) ?? [];
      arr.push(r.due_date);
      doneDatesByHabit.set(r.habit_id, arr);
    }

    // 今日分が既に生成済みの habit_id を除外
    const instantiated = new Set(
      (instRes.data ?? []).map((r) => (r as { habit_id: string }).habit_id),
    );

    const habitCandidates = habits.filter(
      (h) =>
        !instantiated.has(h.id) &&
        isPlannerCandidate(h.frequency_rule, today, doneDatesByHabit.get(h.id) ?? []),
    );

    return json({ date: today, todos, habitCandidates, done });
  });
}
