// Todayビューのデータ取得（docs/design.md 2章）。
// 画面用の /api/today と、LINEの定時配信（docs/line-plan.md）で同じ集計を使うため切り出した。
import "server-only";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { isPlannerCandidate } from "@/lib/frequency";
import { type HabitAlert, habitAlerts } from "@/lib/habit-alerts";
import { loadHabitInstances } from "@/lib/habit-instances";
import type { Habit, Item } from "@/lib/types";

export type TodayData = {
  date: string;
  /** 未完了ToDo（期日が今日以前＝今日分＋期限超過）。習慣インスタンスも含む */
  todos: Item[];
  /** 今日(JST)完了したToDo */
  done: Item[];
  /** 今日が該当日で、まだ当日インスタンス未生成の非pause習慣 */
  habitCandidates: Habit[];
  /** 声をかけるべき習慣（救済中・残り回数が残り日数に並んだもの。docs/line-plan.md 9.1） */
  habitAlerts: HabitAlert[];
};

// GETは副作用がないので、失敗したら一度だけ取り直す。
// 本番でコールドスタート直後の1回目だけ500になる事象があり（2回目以降は同じインスタンスで成功する）、
// アプリ起動直後にエラー画面が出ていた。原因の特定にはサーバーログが要るため、まずは緩和策。
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[today] 1回目の取得に失敗したため再試行します:", err);
    return fn();
  }
}

// 独立クエリを並列実行する（docs/design.md 17章。直列だと往復が積み上がる）。
// 習慣インスタンスは全件必要（完了ログ＋今日の生成状態）で1000行を越えるためページング取得。
async function fetchTodayData(today: string, todayStartIso: string) {
  const [todoRes, doneRes, habitRes, instances] = await Promise.all([
    db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "todo")
      .lte("due_date", today)
      // 期限の早い順に上から並べる。同日内は時刻指定ありを昇順で先に、
      // 時刻指定なし(NULL)は下にまとめ、その中は登録順(sort_order)
      .order("due_date", { ascending: true })
      .order("due_time", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true }),
    db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "done")
      .gte("done_at", todayStartIso)
      .order("done_at", { ascending: false }),
    db.from("habits").select("*").eq("is_paused", false),
    loadHabitInstances(),
  ]);

  for (const res of [todoRes, doneRes, habitRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  return {
    todos: (todoRes.data ?? []) as Item[],
    done: (doneRes.data ?? []) as Item[],
    habits: (habitRes.data ?? []) as Habit[],
    instances,
  };
}

export async function loadTodayData(now: Date = new Date()): Promise<TodayData> {
  const today = todayInJst(now);
  const todayStartIso = new Date(`${today}T00:00:00+09:00`).toISOString();

  const { todos, done, habits, instances } = await retryOnce(() =>
    fetchTodayData(today, todayStartIso),
  );

  // 完了ログ = 完了済み習慣インスタンスの due_date 集合（habit_idごと）
  const doneDatesByHabit = new Map<string, string[]>();
  for (const r of instances) {
    if (r.status !== "done" || !r.due_date) continue;
    const arr = doneDatesByHabit.get(r.habit_id) ?? [];
    arr.push(r.due_date);
    doneDatesByHabit.set(r.habit_id, arr);
  }

  // 今日分が既に生成済みの habit_id を除外（当日 due_date のインスタンスが存在するもの）
  const instantiated = new Set(
    instances.filter((r) => r.due_date === today).map((r) => r.habit_id),
  );

  // 非pause習慣のうち、完了ログ由来の頻度判定（docs/design.md 10.1）で今日が候補のもの
  const habitCandidates = habits.filter(
    (h) =>
      !instantiated.has(h.id) &&
      isPlannerCandidate(h.frequency_rule, today, doneDatesByHabit.get(h.id) ?? []),
  );

  return { date: today, todos, done, habitCandidates, habitAlerts: habitAlerts(habits, doneDatesByHabit, today) };
}
