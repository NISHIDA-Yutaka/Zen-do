// LINEのボタン操作（docs/line-plan.md 3章）。
// 応答は reply（無料）なので、ここでの操作は無料枠を消費しない。
import "server-only";
import { completeItem } from "@/lib/complete";
import { addDays, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { instantiateHabit } from "@/lib/habit-instance";
import { getItem, recalcRelativeReminders } from "@/lib/items";
import type { LineAction } from "@/lib/line/postback";
import { loadTodayData } from "@/lib/today-data";
import type { Habit, Item } from "@/lib/types";

/** 期日を付け替える（Today画面の「明日へ」と同じ扱い。相対リマインダーも追従させる） */
async function moveDue(item: Item, date: string): Promise<void> {
  const { data, error } = await db
    .from("items")
    .update({ due_date: date })
    .eq("id", item.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await recalcRelativeReminders(data as Item);
}

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
  await moveDue(item, tomorrow);
  return `「${item.title}」を明日に回しました。`;
}

async function runAllTomorrow(): Promise<string> {
  const { todos } = await loadTodayData();
  if (todos.length === 0) return "残っているタスクはありません。";
  const tomorrow = addDays(todayInJst(), 1);
  // 習慣は日ごとに作られるもので、明日の分は明日また出る。動かすと一意制約にも当たる
  const movable = todos.filter((t) => !t.habit_id);
  const skipped = todos.length - movable.length;
  for (const t of movable) await moveDue(t, tomorrow);
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

/** ボタンを押された時の処理。返り値がそのまま返信の文面になる */
export function runAction(action: LineAction): Promise<string> {
  switch (action.kind) {
    case "done":
      return runDone(action.id);
    case "tmr":
      return runTomorrow(action.id);
    case "alltmr":
      return runAllTomorrow();
    case "habits":
      return runHabits();
  }
}
