// MCP参照ツールの読み取りヘルパ（server-only）。docs/mcp-implementation-plan.md 3。
// 業務ロジックは持たず、既存の db / date / habit-stats / frequency を組み合わせるだけ。
import "server-only";
import { nowHmInJst, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { computeHabitStats, type HabitStats } from "@/lib/habit-stats";
import { isPlannerCandidate } from "@/lib/frequency";
import { getReminders } from "@/lib/items";
import {
  serializeTaskDetail,
  serializeTaskSummary,
  staleDays,
  type McpTaskDetail,
  type McpTaskSummary,
} from "@/lib/mcp/serialize";
import type { Habit, Item, ItemStatus } from "@/lib/types";

const MEMO_TAG = "memo";
const LIST_LIMIT = 100;

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** 与えた item id 群のうち、dropではない子を持つものの id 集合を1クエリで返す。 */
async function childrenOwners(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = unwrap(
    await db.from("items").select("parent_id").in("parent_id", ids).neq("status", "dropped"),
  ) as { parent_id: string | null }[];
  return new Set(rows.map((r) => r.parent_id).filter((p): p is string => p !== null));
}

async function toSummaries(
  items: Item[],
  today: string,
  nowHM: string,
  opts: { withStale?: boolean } = {},
): Promise<McpTaskSummary[]> {
  const owners = await childrenOwners(items.map((i) => i.id));
  return items.map((item) =>
    serializeTaskSummary(item, {
      today,
      nowHM,
      hasChildren: owners.has(item.id),
      staleDays: opts.withStale ? staleDays(item.created_at, today) : undefined,
    }),
  );
}

/** 今日の未完了ToDo（期日<=今日）。並びは既存Todayと同じ。 */
async function todayTodos(today: string): Promise<Item[]> {
  return unwrap(
    await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "todo")
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .order("due_time", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true }),
  ) as Item[];
}

/** 今日(JST)完了したToDo。 */
async function doneTodayTodos(today: string): Promise<Item[]> {
  const todayStartIso = new Date(`${today}T00:00:00+09:00`).toISOString();
  return unwrap(
    await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "done")
      .gte("done_at", todayStartIso)
      .order("done_at", { ascending: false }),
  ) as Item[];
}

/** 未仕分け（Inboxビューと同条件）。 */
async function inboxTodos(): Promise<Item[]> {
  return unwrap(
    await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "todo")
      .is("parent_id", null)
      .is("due_date", null)
      .not("tags", "cs", `{${MEMO_TAG}}`)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ) as Item[];
}

export async function listToday(): Promise<{ today: string; todos: McpTaskSummary[]; done: McpTaskSummary[] }> {
  const today = todayInJst();
  const nowHM = nowHmInJst();
  const [todos, done] = await Promise.all([todayTodos(today), doneTodayTodos(today)]);
  return {
    today,
    todos: await toSummaries(todos, today, nowHM),
    done: await toSummaries(done, today, nowHM),
  };
}

export async function listInbox(): Promise<{ today: string; inbox: McpTaskSummary[] }> {
  const today = todayInJst();
  const nowHM = nowHmInJst();
  const items = await inboxTodos();
  return { today, inbox: await toSummaries(items, today, nowHM, { withStale: true }) };
}

export async function listUpcoming(days = 14): Promise<{ today: string; upcoming: McpTaskSummary[] }> {
  const today = todayInJst();
  const nowHM = nowHmInJst();
  const until = new Date(`${today}T00:00:00+09:00`);
  until.setUTCDate(until.getUTCDate() + days);
  const untilYmd = todayInJst(until);
  const items = unwrap(
    await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .eq("status", "todo")
      .gt("due_date", today)
      .lte("due_date", untilYmd)
      .order("due_date", { ascending: true })
      .order("due_time", { ascending: true, nullsFirst: false })
      .limit(LIST_LIMIT),
  ) as Item[];
  return { today, upcoming: await toSummaries(items, today, nowHM) };
}

/** 今日＋期限超過＋Inbox のサマリ。会話の起点用。 */
export async function getStatus(): Promise<{
  today: string;
  today_tasks: McpTaskSummary[];
  overdue: McpTaskSummary[];
  inbox: McpTaskSummary[];
  counts: { today: number; overdue: number; inbox: number; done_today: number };
}> {
  const today = todayInJst();
  const nowHM = nowHmInJst();
  const [todos, done, inbox] = await Promise.all([todayTodos(today), doneTodayTodos(today), inboxTodos()]);

  // 期限超過 = 過去日 or 当日で時刻超過
  const overdueItems = todos.filter((i) => {
    if (!i.due_date) return false;
    if (i.due_date < today) return true;
    return i.due_date === today && i.due_time !== null && i.due_time.slice(0, 5) < nowHM;
  });
  const todayOnly = todos.filter((i) => !overdueItems.includes(i));

  const [todayTasks, overdue, inboxSummaries] = await Promise.all([
    toSummaries(todayOnly, today, nowHM),
    toSummaries(overdueItems, today, nowHM),
    toSummaries(inbox, today, nowHM, { withStale: true }),
  ]);

  return {
    today,
    today_tasks: todayTasks,
    overdue,
    inbox: inboxSummaries,
    counts: { today: todayOnly.length, overdue: overdueItems.length, inbox: inbox.length, done_today: done.length },
  };
}

export async function getTaskDetail(id: string): Promise<{ today: string; task: McpTaskDetail } | null> {
  const today = todayInJst();
  const nowHM = nowHmInJst();
  const item = (unwrap(await db.from("items").select("*").eq("id", id).maybeSingle()) as Item | null) ?? null;
  if (!item) return null;
  const [children, reminders] = await Promise.all([
    db.from("items").select("*").eq("parent_id", id).neq("status", "dropped")
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true })
      .then((r) => unwrap(r) as Item[]),
    getReminders(id),
  ]);
  const childHasChildren = await childrenOwners(children.map((c) => c.id));
  return {
    today,
    task: serializeTaskDetail(item, { today, nowHM, reminders, children, childHasChildren }),
  };
}

/** タイトル部分一致で候補を複数返す（自動で1件に絞らない）。未完了を優先。 */
export async function findTask(query: string): Promise<{ today: string; matches: McpTaskSummary[] }> {
  const today = todayInJst();
  const nowHM = nowHmInJst();
  const escaped = query.replace(/[%_,()]/g, (c) => `\\${c}`);
  const items = unwrap(
    await db
      .from("items")
      .select("*")
      .eq("kind", "todo")
      .neq("status", "dropped")
      .ilike("title", `%${escaped}%`)
      // 未完了(todo)を先に、その後 done。各内で新しい順
      .order("status", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT),
  ) as Item[];
  return { today, matches: await toSummaries(items, today, nowHM) };
}

export type McpHabit = {
  id: string;
  title: string;
  frequency: Habit["frequency_rule"];
  streak: number;
  streak_unit: HabitStats["streakUnit"];
  resting: boolean;
  period_done: number;
  period_target: number;
  period_achieved: boolean;
  four_week_rate: number;
  today_instance: ItemStatus | null; // null=未生成 / todo=追加済み / done=完了
  is_today_candidate: boolean; // 今日のプランナー候補か
  is_paused: boolean;
};

export async function listHabits(): Promise<{ today: string; habits: McpHabit[] }> {
  const today = todayInJst();
  const habits = unwrap(
    await db.from("habits").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
  ) as Habit[];

  const instances = unwrap(
    await db.from("items").select("habit_id, status, due_date").not("habit_id", "is", null),
  ) as { habit_id: string; status: ItemStatus; due_date: string | null }[];

  const doneByHabit = new Map<string, string[]>();
  const todayByHabit = new Map<string, ItemStatus>();
  const instantiated = new Set<string>();
  for (const it of instances) {
    if (it.status === "done" && it.due_date) {
      const arr = doneByHabit.get(it.habit_id) ?? [];
      arr.push(it.due_date);
      doneByHabit.set(it.habit_id, arr);
    }
    if (it.due_date === today && it.status !== "dropped") {
      todayByHabit.set(it.habit_id, it.status);
      instantiated.add(it.habit_id);
    }
  }

  const rows: McpHabit[] = habits.map((h) => {
    const doneDates = doneByHabit.get(h.id) ?? [];
    const stats = computeHabitStats(h.frequency_rule, doneDates, today);
    const candidate =
      !h.is_paused && !instantiated.has(h.id) && isPlannerCandidate(h.frequency_rule, today, doneDates);
    return {
      id: h.id,
      title: h.title,
      frequency: h.frequency_rule,
      streak: stats.streak,
      streak_unit: stats.streakUnit,
      resting: stats.resting,
      period_done: stats.weekDone,
      period_target: stats.weekTarget,
      period_achieved: stats.weekAchieved,
      four_week_rate: stats.fourWeekRate,
      today_instance: todayByHabit.get(h.id) ?? null,
      is_today_candidate: candidate,
      is_paused: h.is_paused,
    };
  });

  return { today, habits: rows };
}
