import { describe, expect, it } from "vitest";
import { buildDigest, type DigestInput, overdueOf } from "@/lib/line/messages";
import type { Habit, Item } from "@/lib/types";

const TODAY = "2026-09-14";

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

function habit(title: string): Habit {
  return {
    id: crypto.randomUUID(),
    title,
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
    nowHm: "12:00",
    todos: [],
    done: [],
    habitCandidates: [],
    inboxCount: 0,
    ...over,
  };
}

describe("overdueOf", () => {
  it("期日が今日より前なら時刻に関係なく超過", () => {
    const old = task({ due_date: "2026-09-13" });
    expect(overdueOf([old], TODAY, "00:01")).toEqual([old]);
  });

  it("今日の指定時刻を過ぎたものだけ超過", () => {
    const past = task({ due_time: "09:00:00" });
    const future = task({ due_time: "15:00:00" });
    expect(overdueOf([past, future], TODAY, "12:00")).toEqual([past]);
  });

  it("時刻のないタスクは超過にしない", () => {
    expect(overdueOf([task({ due_time: null })], TODAY, "23:59")).toEqual([]);
  });
});

describe("buildDigest", () => {
  it("言うことが無ければ送らない（無料枠を空振りで消費しない）", () => {
    expect(buildDigest(input({ slot: "morning" }))).toBeNull();
    expect(buildDigest(input({ slot: "evening" }))).toBeNull();
    expect(buildDigest(input({ slot: "night" }))).toBeNull();
  });

  it("朝は習慣だけでも送る", () => {
    const text = buildDigest(input({ slot: "morning", habitCandidates: [habit("ストレッチ")] }));
    expect(text).toContain("ストレッチ");
  });

  it("完了した件数には触れない（残っているものだけ伝える）", () => {
    const done = [task({ status: "done" }), task({ status: "done" })];
    const evening = buildDigest(input({ slot: "evening", todos: [task()], done })) ?? "";
    const night = buildDigest(input({ slot: "night", todos: [task()], done })) ?? "";
    for (const text of [evening, night]) {
      expect(text).not.toContain("2件完了");
      expect(text).not.toContain("片付いてますね");
    }
  });

  it("未完了は省略せず全部並べる（何が残っているか分からないと動けない）", () => {
    const titles = ["A", "B", "C", "D", "E"];
    const text = buildDigest(input({ slot: "night", todos: titles.map((t) => task({ title: t })) })) ?? "";
    for (const t of titles) expect(text).toContain(`・${t}`);
    expect(text).not.toContain("ほか");
  });

  it("催促は超過があれば名前を出し、なければ件数だけにとどめる", () => {
    const past = task({ title: "歯医者", due_time: "09:00:00" });
    const withOverdue = buildDigest(input({ slot: "evening", nowHm: "18:00", todos: [past] })) ?? "";
    expect(withOverdue).toContain("歯医者");

    const future = task({ title: "買い物", due_time: "20:00:00" });
    const noOverdue = buildDigest(input({ slot: "evening", nowHm: "18:00", todos: [future] })) ?? "";
    expect(noOverdue).toContain("残りは1件");
    expect(noOverdue).not.toContain("買い物");
  });

  it("夜は残り0件なら労って終わる", () => {
    const text = buildDigest(input({ slot: "night", done: [task({ status: "done" })] })) ?? "";
    expect(text).toContain("全部片付きました");
  });

  it("Inboxは溜まっている時だけ触れる", () => {
    const todos = [task()];
    expect(buildDigest(input({ slot: "night", todos, inboxCount: 4 }))).not.toContain("Inbox");
    expect(buildDigest(input({ slot: "night", todos, inboxCount: 5 }))).toContain("Inboxに5件");
  });

  it("責める言い回しを使わず、逃げ道を示す", () => {
    const text =
      buildDigest(input({ slot: "evening", nowHm: "18:00", todos: [task({ due_time: "09:00:00" })] })) ??
      "";
    for (const ng of ["まだ", "早く", "遅れて", "ください！"]) {
      expect(text).not.toContain(ng);
    }
    expect(text).toContain("大丈夫");
  });
});
