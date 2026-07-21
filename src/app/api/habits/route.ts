// GET  /api/habits — 習慣一覧＋継続指標＋今日のインスタンス状態（docs/design.md 10章）
// POST /api/habits — 習慣マスター作成
import type { NextRequest } from "next/server";
import { handle, json, parseBody } from "@/lib/api";
import { todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import { computeHabitStats, type HabitStats } from "@/lib/habit-stats";
import type { Habit, ItemStatus } from "@/lib/types";
import { createHabitSchema } from "@/lib/validation";

export type HabitRow = Habit & {
  stats: HabitStats;
  todayInstance: ItemStatus | null; // null=未生成 / 'todo'=追加済み / 'done'=完了
  todayItemId: string | null; // 今日インスタンスのitem id（完了/取消の対象）
};

export function GET(): Promise<Response> {
  return handle(async () => {
    const today = todayInJst();

    const { data, error } = await db
      .from("habits")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const habits = (data ?? []) as Habit[];

    // 全習慣インスタンスを一括取得（完了ログ＋今日の状態）
    const { data: instData, error: instErr } = await db
      .from("items")
      .select("id, habit_id, status, due_date")
      .not("habit_id", "is", null);
    if (instErr) throw new Error(instErr.message);
    const instances = (instData ?? []) as {
      id: string;
      habit_id: string;
      status: ItemStatus;
      due_date: string | null;
    }[];

    const doneByHabit = new Map<string, string[]>();
    const todayByHabit = new Map<string, { status: ItemStatus; id: string }>();
    for (const it of instances) {
      if (it.status === "done" && it.due_date) {
        const arr = doneByHabit.get(it.habit_id) ?? [];
        arr.push(it.due_date);
        doneByHabit.set(it.habit_id, arr);
      }
      if (it.due_date === today && it.status !== "dropped") {
        todayByHabit.set(it.habit_id, { status: it.status, id: it.id });
      }
    }

    const rows: HabitRow[] = habits.map((h) => {
      const inst = todayByHabit.get(h.id);
      return {
        ...h,
        stats: computeHabitStats(h.frequency_rule, doneByHabit.get(h.id) ?? [], today),
        todayInstance: inst?.status ?? null,
        todayItemId: inst?.id ?? null,
      };
    });

    return json({ habits: rows, date: today });
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const parsed = await parseBody(req, createHabitSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const insert = {
      title: body.title,
      notes: body.notes ?? "",
      tags: body.tags ?? [],
      frequency_rule: body.frequency_rule,
      default_reminder_rule: body.default_reminder_rule ?? null,
      is_paused: body.is_paused ?? false,
      sort_order: body.sort_order ?? 0,
    };
    const { data, error } = await db.from("habits").insert(insert).select("*").single();
    if (error) throw new Error(error.message);
    return json({ habit: data }, 201);
  });
}
