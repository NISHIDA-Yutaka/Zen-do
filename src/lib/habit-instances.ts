import "server-only";
import { db } from "@/lib/db";
import type { ItemStatus } from "@/lib/types";

export type HabitInstanceRow = {
  id: string;
  habit_id: string;
  status: ItemStatus;
  due_date: string | null;
};

// 習慣インスタンス（habit_id 付きの item）を全件取得する。
// Supabase は 1 回の select を既定で最大 1000 行に切り詰めるため、range() で
// ページングして全件そろえる。Duolingo のバックフィルで習慣インスタンス総数が
// 1000 を超え、無制限 select だと最新の完了が黙って欠落してストリーク・週次進捗・
// プランナー候補が壊れる不具合への対処（1006件で発覚・2026-08-18）。
export async function loadHabitInstances(): Promise<HabitInstanceRow[]> {
  const PAGE = 1000;
  const rows: HabitInstanceRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("items")
      .select("id, habit_id, status, due_date")
      .not("habit_id", "is", null)
      // ページ間で安定した並びにするため主キーで固定（range だけだと境界がずれ得る）
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as HabitInstanceRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}
