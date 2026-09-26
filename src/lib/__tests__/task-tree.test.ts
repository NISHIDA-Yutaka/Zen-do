import { describe, expect, it } from "vitest";
import { nestChildren } from "@/lib/task-tree";
import type { Item } from "@/lib/types";

function task(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    kind: "todo",
    title: id,
    notes: "",
    tags: [],
    status: "todo",
    parent_id: null,
    habit_id: null,
    due_date: "2026-09-25",
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

const shape = (rows: ReturnType<typeof nestChildren>) =>
  rows.map((r) => [r.item.id, r.children.map((c) => c.id)]);

describe("nestChildren", () => {
  it("子を親の下にまとめ、子のない行は空配列", () => {
    const rows = nestChildren(
      [task("A"), task("B")],
      [task("a1", { parent_id: "A" }), task("a2", { parent_id: "A" })],
    );
    expect(shape(rows)).toEqual([
      ["A", ["a1", "a2"]],
      ["B", []],
    ]);
  });

  it("一覧に並ぶ子は、親も一覧にあれば単独の行にせず親の下にだけ出す", () => {
    const child = task("a1", { parent_id: "A" });
    const rows = nestChildren([task("A"), child, task("B")], [child]);
    expect(shape(rows)).toEqual([
      ["A", ["a1"]],
      ["B", []],
    ]);
  });

  it("親が一覧にない子（プロジェクトの子など）は最上位の行のまま", () => {
    const rows = nestChildren([task("x1", { parent_id: "P" })], []);
    expect(shape(rows)).toEqual([["x1", []]]);
  });

  it("children に無い子が一覧側にだけあっても親の下に入る", () => {
    const rows = nestChildren([task("A"), task("a1", { parent_id: "A" })], []);
    expect(shape(rows)).toEqual([["A", ["a1"]]]);
  });

  it("孫は親の下に入った子にはぶら下げず、最上位に残して一覧から消さない", () => {
    const rows = nestChildren(
      [task("A"), task("a1", { parent_id: "A" }), task("g1", { parent_id: "a1" })],
      [task("a1", { parent_id: "A" }), task("g1", { parent_id: "a1" })],
    );
    expect(shape(rows)).toEqual([
      ["A", ["a1"]],
      ["g1", []],
    ]);
  });

  it("最上位の並び順は items の順を保つ", () => {
    const rows = nestChildren([task("C"), task("A"), task("B")], []);
    expect(rows.map((r) => r.item.id)).toEqual(["C", "A", "B"]);
  });

  it("親子が循環した壊れたデータでも止まる", () => {
    const rows = nestChildren([task("A", { parent_id: "B" }), task("B", { parent_id: "A" })], []);
    expect(rows.length).toBeGreaterThan(0);
  });
});
