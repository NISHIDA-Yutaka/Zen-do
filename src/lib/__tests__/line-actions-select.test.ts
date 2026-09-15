import { describe, expect, it } from "vitest";
import { BUTTON_LIMIT, digestActions, type DigestInput } from "@/lib/line/messages";
import type { Habit, Item } from "@/lib/types";

const TODAY = "2026-09-15";

function task(over: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(),
    kind: "todo",
    title: "タスク",
    notes: "",
    tags: [],
    status: "todo",
    parent_id: null,
    habit_id: null,
    due_date: TODAY,
    due_time: null,
    duration_min: null,
    recurrence_rule: null,
    generated_from: null,
    postponed_count: 0,
    sort_order: 0,
    done_at: null,
    captured_raw: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function habit(): Habit {
  return {
    id: crypto.randomUUID(),
    title: "ストレッチ",
    notes: "",
    tags: [],
    frequency_rule: { type: "daily" },
    default_reminder_rule: null,
    default_due_time: null,
    is_paused: false,
    sort_order: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function input(over: Partial<DigestInput>): DigestInput {
  return {
    slot: "night",
    today: TODAY,
    nowHm: "18:00",
    todos: [],
    done: [],
    habitCandidates: [],
    inboxCount: 0,
    ...over,
  };
}

describe("digestActions", () => {
  it("催促は時間を過ぎたものだけを操作対象にする", () => {
    const past = task({ title: "過ぎた", due_time: "09:00:00" });
    const future = task({ title: "これから", due_time: "20:00:00" });
    const { tasks, global } = digestActions(input({ slot: "evening", todos: [past, future] }));
    expect(tasks.map((t) => t.title)).toEqual(["過ぎた"]);
    expect(global).toBeNull();
  });

  it("夜は残り全部が対象で「全部明日へ」が付く", () => {
    const todos = [task(), task()];
    const { tasks, global } = digestActions(input({ slot: "night", todos }));
    expect(tasks).toHaveLength(2);
    expect(global).toBe("alltmr");
  });

  it("残りが無ければ全体ボタンも出さない", () => {
    expect(digestActions(input({ slot: "night" })).global).toBeNull();
  });

  it("朝は習慣候補がある時だけ「習慣を追加」が付く", () => {
    expect(digestActions(input({ slot: "morning", todos: [task()] })).global).toBeNull();
    expect(digestActions(input({ slot: "morning", habitCandidates: [habit()] })).global).toBe(
      "habits",
    );
  });

  it("ボタンは先頭から上限件数まで（Flexの10KB上限を超えないため）", () => {
    const todos = ["A", "B", "C", "D", "E", "F", "G"].map((t) => task({ title: t }));
    const { tasks } = digestActions(input({ slot: "night", todos }));
    expect(tasks).toHaveLength(BUTTON_LIMIT);
    expect(tasks.map((t) => t.title)).toEqual(["A", "B", "C", "D", "E"]);
  });
});
