// LINEのボタン操作（docs/line-plan.md 3章）。
// 応答は reply（無料）なので、ここでの操作は無料枠を消費しない。
import "server-only";
import { completeItem } from "@/lib/complete";
import { breakdownTask } from "@/lib/gemini";
import { db } from "@/lib/db";
import { addDays, todayInJst } from "@/lib/date";
import { instantiateHabit } from "@/lib/habit-instance";
import { getItem, moveDueDate } from "@/lib/items";
import type { LineAction } from "@/lib/line/postback";
import { loadTodayData } from "@/lib/today-data";
import type { Habit } from "@/lib/types";

async function runDone(id: string): Promise<string> {
  const item = await getItem(id);
  if (!item) return "そのタスクは見つかりませんでした。";
  if (item.status === "done") return `「${item.title}」はすでに完了しています。`;
  const { next } = await completeItem(item);
  return next
    ? `「${item.title}」を完了しました。次回は${next.due_date}です。`
    : `「${item.title}」を完了しました。お疲れさまです。`;
}

async function runTomorrow(id: string): Promise<string> {
  const item = await getItem(id);
  if (!item) return "そのタスクは見つかりませんでした。";
  if (item.status !== "todo") return `「${item.title}」は未完了ではありません。`;
  const tomorrow = addDays(todayInJst(), 1);
  await moveDueDate(item, tomorrow);
  return `「${item.title}」を明日に回しました。`;
}

async function runAllTomorrow(): Promise<string> {
  const { todos } = await loadTodayData();
  if (todos.length === 0) return "残っているタスクはありません。";
  const tomorrow = addDays(todayInJst(), 1);
  // 習慣は日ごとに作られるもので、明日の分は明日また出る。動かすと一意制約にも当たる
  const movable = todos.filter((t) => !t.habit_id);
  const skipped = todos.length - movable.length;
  for (const t of movable) await moveDueDate(t, tomorrow);
  const head = `${movable.length}件を明日に回しました。ゆっくり休んでください。`;
  return skipped > 0 ? `${head}\n（習慣${skipped}件はそのままにしています）` : head;
}

async function runHabits(): Promise<string> {
  const { habitCandidates } = await loadTodayData();
  if (habitCandidates.length === 0) return "今日の習慣はもう全部そろっています。";
  const today = todayInJst();
  const added: Habit[] = [];
  for (const h of habitCandidates) {
    const { created } = await instantiateHabit(h, today);
    if (created) added.push(h);
  }
  if (added.length === 0) return "今日の習慣はもう全部そろっています。";
  return `習慣を${added.length}件追加しました（${added.map((h) => h.title).join("、")}）。`;
}

/**
 * 4択に答えたら先送り回数を0に戻す。
 * 「介入したのでここから数え直す」という意味。戻さないと翌日も同じ質問が来る。
 */
async function resetPostponeCount(id: string): Promise<void> {
  const { error } = await db.from("items").update({ postponed_count: 0 }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** 「大きすぎる」→ 分解して子ToDoにする（アプリの分解ボタンと同じ仕事） */
async function runBig(id: string): Promise<string> {
  const item = await getItem(id);
  if (!item) return "そのタスクは見つかりませんでした。";
  const parent = item.parent_id ? await getItem(item.parent_id) : null;
  const steps = await breakdownTask({
    title: item.title,
    notes: item.notes,
    projectTitle: parent?.title ?? null,
    projectNotes: parent?.notes ?? null,
    tags: item.tags,
    dueDate: item.due_date,
  });
  if (steps.length === 0) return "うまく分解できませんでした。少し時間をおいて試してください。";

  const rows = steps.map((title, i) => ({
    kind: "todo" as const,
    title,
    notes: "",
    tags: [],
    status: "todo" as const,
    parent_id: item.id,
    sort_order: i,
  }));
  const { error } = await db.from("items").insert(rows);
  if (error) throw new Error(error.message);

  await resetPostponeCount(id);
  // 定時報告の相棒（docs/gemini-digest-plan.md 0章）と同じ口調で返す
  return [
    `「${item.title}」を${steps.length}つの小さな手順に分けてみました。`,
    ...steps.map((s) => `・${s}`),
    "子タスクに入れてあります。まずは最初の1つだけで十分です。",
  ].join("\n");
}

/** 注目タスクの「今日はパス」→ 今日の残りの便では選ばない（docs/gemini-digest-plan.md 4章） */
async function runPass(id: string): Promise<string> {
  const item = await getItem(id);
  if (!item) return "そのタスクは見つかりませんでした。";
  const { error } = await db
    .from("line_focus_passes")
    .upsert({ item_id: id, pass_date: todayInJst() }, { ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return `承知しました。「${item.title}」は今日はお休みにしましょう。また別の日に。`;
}

/** 「気が乗らない」→ 最初の一歩の提案（docs/line-plan.md 9.4）。まだ未実装 */
async function runStuck(id: string): Promise<string> {
  const item = await getItem(id);
  if (!item) return "そのタスクは見つかりませんでした。";
  await resetPostponeCount(id);
  return `「${item.title}」、今日は置いておいて大丈夫です。\n最初の一歩を一緒に決められるようにするのは、これからの機能です。`;
}

/** 「もう要らない」→ 破棄（子孫ごと。アプリの削除と同じ） */
async function runDrop(id: string): Promise<string> {
  const item = await getItem(id);
  if (!item) return "そのタスクは見つかりませんでした。";
  const { error } = await db.from("items").update({ status: "dropped" }).eq("id", id);
  if (error) throw new Error(error.message);
  return `「${item.title}」を破棄しました。戻したくなったらアプリから戻せます。`;
}

async function getHabit(id: string): Promise<Habit | null> {
  const { data, error } = await db.from("habits").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Habit) ?? null;
}

/** 今日の分を作る（既にあればそれを使う） */
async function runHabitAdd(habitId: string): Promise<string> {
  const habit = await getHabit(habitId);
  if (!habit) return "その習慣は見つかりませんでした。";
  const { item, created } = await instantiateHabit(habit, todayInJst());
  if (item.status === "done") return `「${habit.title}」は今日もう終わっています。`;
  return created
    ? `「${habit.title}」を今日に追加しました。`
    : `「${habit.title}」は今日の分がもうあります。`;
}

/** 深夜用。今日の分を作って完了まで済ませる（23時に「追加」だけでは意味がない） */
async function runHabitDone(habitId: string): Promise<string> {
  const habit = await getHabit(habitId);
  if (!habit) return "その習慣は見つかりませんでした。";
  const { item } = await instantiateHabit(habit, todayInJst());
  if (item.status === "done") return `「${habit.title}」はもう完了しています。`;
  await completeItem(item);
  return `「${habit.title}」を完了しました。よく続いています。`;
}

/** ボタンを押された時の処理。返り値がそのまま返信の文面になる */
export function runAction(action: LineAction): Promise<string> {
  switch (action.kind) {
    case "done":
      return runDone(action.id);
    case "tmr":
      return runTomorrow(action.id);
    case "big":
      return runBig(action.id);
    case "stuck":
      return runStuck(action.id);
    case "drop":
      return runDrop(action.id);
    case "pass":
      return runPass(action.id);
    case "hab_add":
      return runHabitAdd(action.id);
    case "hab_done":
      return runHabitDone(action.id);
    case "alltmr":
      return runAllTomorrow();
    case "habits":
      return runHabits();
  }
}
