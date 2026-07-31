// MCP操作ツールのガードレール（server-only）。docs/mcp-integration.md 4章 / plan 4.3。
// AIが別タスクを取り違えて操作しないよう、UUID＋expected_title の突き合わせで防ぐ。
import "server-only";
import { db } from "@/lib/db";
import { getItem } from "@/lib/items";
import type { Habit, Item } from "@/lib/types";

export type TaskGuard = { ok: true; item: Item } | { ok: false; message: string };

/**
 * 書き込み対象のタスクを取得し、事前条件と expected_title の一致を検証する。
 * 不一致・存在しない・破棄済みは ok:false（AIに再確認させるメッセージ付き）。
 */
export async function loadTaskForWrite(id: string, expectedTitle: string): Promise<TaskGuard> {
  const item = await getItem(id);
  if (!item) {
    return { ok: false, message: `指定IDのタスクが見つかりません（id=${id}）。find_task で探し直してください。` };
  }
  if (item.status === "dropped") {
    return { ok: false, message: `「${item.title}」は破棄済みのため操作できません。` };
  }
  if (item.title.trim() !== expectedTitle.trim()) {
    return {
      ok: false,
      message:
        `対象が一致しません。指定IDの実際のタスクは「${item.title}」です` +
        `（expected_title は「${expectedTitle}」）。意図したタスクか確認してから再実行してください。`,
    };
  }
  return { ok: true, item };
}

export type HabitGuard = { ok: true; habit: Habit } | { ok: false; message: string };

export async function loadHabitForWrite(id: string, expectedTitle: string): Promise<HabitGuard> {
  const { data, error } = await db.from("habits").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const habit = data as Habit | null;
  if (!habit) {
    return { ok: false, message: `指定IDの習慣が見つかりません（id=${id}）。list_habits で確認してください。` };
  }
  if (habit.title.trim() !== expectedTitle.trim()) {
    return {
      ok: false,
      message: `対象が一致しません。指定IDの実際の習慣は「${habit.title}」です。確認してください。`,
    };
  }
  return { ok: true, habit };
}
