import { describe, expect, it } from "vitest";
import { overdueInfo, serializeTaskSummary, staleDays } from "@/lib/mcp/serialize";
import type { Item } from "@/lib/types";

const TODAY = "2026-07-31";
const NOW = "13:00";

describe("overdueInfo", () => {
  it("過去日は超過・日数は今日との差", () => {
    expect(overdueInfo("2026-07-28", null, TODAY, NOW)).toEqual({ overdue: true, overdue_days: 3 });
    expect(overdueInfo("2026-07-30", "09:00", TODAY, NOW)).toEqual({ overdue: true, overdue_days: 1 });
  });
  it("当日で時刻を過ぎたら超過・日数は0", () => {
    expect(overdueInfo(TODAY, "10:00", TODAY, NOW)).toEqual({ overdue: true, overdue_days: 0 });
  });
  it("当日で時刻がまだなら未超過", () => {
    expect(overdueInfo(TODAY, "15:00", TODAY, NOW)).toEqual({ overdue: false, overdue_days: null });
  });
  it("当日・時刻なしは未超過", () => {
    expect(overdueInfo(TODAY, null, TODAY, NOW)).toEqual({ overdue: false, overdue_days: null });
  });
  it("未来日は未超過", () => {
    expect(overdueInfo("2026-08-05", "09:00", TODAY, NOW)).toEqual({ overdue: false, overdue_days: null });
  });
  it("期日なしは未超過", () => {
    expect(overdueInfo(null, null, TODAY, NOW)).toEqual({ overdue: false, overdue_days: null });
  });
});

describe("staleDays", () => {
  it("作成からの経過日数（JST暦日ベース）", () => {
    // 2026-07-28 14:00 JST 作成 → today との差は3日
    expect(staleDays("2026-07-28T05:00:00Z", TODAY)).toBe(3);
    // 当日作成 → 0
    expect(staleDays("2026-07-31T01:00:00Z", TODAY)).toBe(0);
  });
  it("JSTの日付境界で数える", () => {
    // 2026-07-30 15:30Z = JST 2026-07-31 00:30 → today と同日 → 0
    expect(staleDays("2026-07-30T15:30:00Z", TODAY)).toBe(0);
    // 2026-07-30 14:30Z = JST 2026-07-30 23:30 → 前日 → 1
    expect(staleDays("2026-07-30T14:30:00Z", TODAY)).toBe(1);
  });
});

function makeItem(over: Partial<Item>): Item {
  return {
    id: "id-1",
    kind: "todo",
    title: "タスク",
    notes: "",
    tags: [],
    status: "todo",
    parent_id: null,
    habit_id: null,
    due_date: null,
    due_time: null,
    recurrence_rule: null,
    generated_from: null,
    postponed_count: 0,
    sort_order: 0,
    done_at: null,
    captured_raw: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...over,
  };
}

describe("serializeTaskSummary", () => {
  const ctx = { today: TODAY, nowHM: NOW, hasChildren: false };

  it("フラグと派生値を付ける", () => {
    const s = serializeTaskSummary(
      makeItem({ notes: "メモあり", recurrence_rule: { type: "daily" }, habit_id: "h1", due_time: "09:00:00", due_date: "2026-07-31" }),
      { ...ctx, hasChildren: true },
    );
    expect(s.has_notes).toBe(true);
    expect(s.is_recurring).toBe(true);
    expect(s.is_habit).toBe(true);
    expect(s.has_children).toBe(true);
    expect(s.due_time).toBe("09:00"); // HH:MM に丸める
    expect(s.recurrence).toBe("毎日");
    expect(s.overdue).toBe(true); // 当日09:00 < now13:00
  });

  it("空メモ・非繰り返し・非習慣は false、stale_days は指定時のみ", () => {
    const s = serializeTaskSummary(makeItem({}), { ...ctx, staleDays: 5 });
    expect(s.has_notes).toBe(false);
    expect(s.is_recurring).toBe(false);
    expect(s.is_habit).toBe(false);
    expect(s.recurrence).toBeUndefined();
    expect(s.stale_days).toBe(5);
  });
});
