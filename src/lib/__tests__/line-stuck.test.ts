import { describe, expect, it } from "vitest";
import {
  buildDigest,
  type DigestInput,
  digestActions,
  STUCK_LIMIT,
  STUCK_THRESHOLD,
  stuckOf,
} from "@/lib/line/messages";
import type { Item } from "@/lib/types";

const TODAY = "2026-09-16";

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
    priority: null,
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

function input(over: Partial<DigestInput>): DigestInput {
  return {
    slot: "night",
    today: TODAY,
    nowHm: "23:00",
    todos: [],
    done: [],
    habitCandidates: [],
    habitAlerts: [],
    inboxCount: 0,
    ...over,
  };
}

describe("stuckOf", () => {
  it("閾値に満たないものは選ばない", () => {
    const todos = [task({ title: "1回", postponed_count: STUCK_THRESHOLD - 1 })];
    expect(stuckOf(todos)).toEqual([]);
  });

  it("先送りが重なった順に選ぶ", () => {
    const todos = [
      task({ title: "2回", postponed_count: 2 }),
      task({ title: "5回", postponed_count: 5 }),
      task({ title: "3回", postponed_count: 3 }),
    ];
    expect(stuckOf(todos).map((t) => t.title)).toEqual(["5回", "3回"]);
  });

  it("1通で聞く数を絞る（答えるのが億劫にならないように）", () => {
    const todos = Array.from({ length: 6 }, (_, i) => task({ postponed_count: 9 - i }));
    expect(stuckOf(todos)).toHaveLength(STUCK_LIMIT);
  });

  it("習慣は選ばない（日ごとに作られるもので先送りの概念が合わない）", () => {
    const todos = [task({ title: "習慣", habit_id: "h1", postponed_count: 9 })];
    expect(stuckOf(todos)).toEqual([]);
  });
});

describe("質問ブロックの出し方", () => {
  const stuck = task({ title: "眼科に予約する", postponed_count: 4 });
  const normal = task({ title: "買い物" });

  it("何度動いたかは書かない（回数を突きつけても行動に繋がらない）", () => {
    const text = buildDigest(input({ todos: [stuck] })) ?? "";
    expect(text).toContain("眼科に予約する");
    expect(text).not.toContain("4回");
    expect(text).toContain("何が引っかかっていますか");
  });

  it("質問したものは通常の一覧に重ねて出さない", () => {
    const text = buildDigest(input({ todos: [stuck, normal] })) ?? "";
    expect(text).toContain("残りは1件です");
    expect(text.match(/眼科に予約する/g)).toHaveLength(1);
  });

  it("朝は聞かない（出勤前に重い問いを投げない）", () => {
    const text = buildDigest(input({ slot: "morning", todos: [stuck] })) ?? "";
    expect(text).not.toContain("何が引っかかっていますか");
    expect(digestActions(input({ slot: "morning", todos: [stuck] })).stuck).toEqual([]);
  });

  it("夕と深夜では聞く", () => {
    for (const slot of ["evening", "night"] as const) {
      expect(digestActions(input({ slot, todos: [stuck] })).stuck.map((t) => t.title)).toEqual([
        "眼科に予約する",
      ]);
    }
  });

  it("質問がある便では通常一覧のボタンを減らす（Flexの容量を空ける）", () => {
    const many = Array.from({ length: 8 }, (_, i) => task({ title: `t${i}` }));
    const without = digestActions(input({ todos: many }));
    const withStuck = digestActions(input({ todos: [stuck, ...many] }));
    expect(without.tasks).toHaveLength(5);
    expect(withStuck.tasks).toHaveLength(3);
    expect(withStuck.tasks.every((t) => t.id !== stuck.id)).toBe(true);
  });
});

describe("Geminiの注目タスクへの統合（noStuck）", () => {
  const stuck = task({ title: "眼科に予約する", postponed_count: 4 });
  const many = Array.from({ length: 8 }, (_, i) => task({ title: `t${i}` }));

  it("4択を出さず、文面にも問いかけを書かない", () => {
    const i = input({ todos: [stuck, ...many], noStuck: true });
    expect(digestActions(i).stuck).toEqual([]);
    expect(buildDigest(i) ?? "").not.toContain("何が引っかかっていますか");
  });

  it("4択が消えた分は通常の一覧に戻す", () => {
    const text = buildDigest(input({ todos: [stuck], noStuck: true })) ?? "";
    expect(text).toContain("眼科に予約する");
  });

  it("注目タスクのブロックが増える分、ボタンは4択の便と同じ上限に抑える", () => {
    expect(digestActions(input({ todos: many, noStuck: true })).tasks).toHaveLength(3);
  });
});
