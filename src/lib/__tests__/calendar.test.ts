import { describe, expect, it } from "vitest";
import {
  addMinutes,
  DEFAULT_BLOCK_MIN,
  durationFromRange,
  rangeQuery,
  toEvent,
  toEvents,
} from "@/lib/calendar";
import type { Item } from "@/lib/types";

const TODAY = "2026-08-28";

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
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("addMinutes", () => {
  it("同じ日の中で足す", () => {
    expect(addMinutes("2026-08-28", "09:00", 45)).toEqual({
      date: "2026-08-28",
      time: "09:45",
    });
  });

  it("時をまたぐ", () => {
    expect(addMinutes("2026-08-28", "09:40", 45)).toEqual({
      date: "2026-08-28",
      time: "10:25",
    });
  });

  it("日をまたぐと暦日が繰り上がる", () => {
    expect(addMinutes("2026-08-28", "23:30", 60)).toEqual({
      date: "2026-08-29",
      time: "00:30",
    });
  });

  it("月末をまたぐ", () => {
    expect(addMinutes("2026-08-31", "23:00", 120)).toEqual({
      date: "2026-09-01",
      time: "01:00",
    });
  });

  it("24時間を超える所要時間は複数日ぶん繰り上がる", () => {
    expect(addMinutes("2026-08-28", "10:00", 1440)).toEqual({
      date: "2026-08-29",
      time: "10:00",
    });
  });

  it("秒付きの時刻（DBの time 型）も受け付ける", () => {
    expect(addMinutes("2026-08-28", "09:00:00", 30)).toEqual({
      date: "2026-08-28",
      time: "09:30",
    });
  });
});

describe("toEvent", () => {
  it("期日なしは描けないので null", () => {
    expect(toEvent(makeItem({ due_date: null }), TODAY)).toBeNull();
  });

  it("時刻なしは終日イベント（時間ブロックにしない）", () => {
    const ev = toEvent(makeItem({ due_time: null }), TODAY);
    expect(ev).toMatchObject({ start: TODAY, allDay: true });
    expect(ev?.end).toBeUndefined();
  });

  it("時刻ありは所要時間ぶんの時間ブロック", () => {
    const ev = toEvent(makeItem({ due_time: "09:00:00", duration_min: 90 }), TODAY);
    expect(ev).toMatchObject({
      start: "2026-08-28T09:00:00",
      end: "2026-08-28T10:30:00",
      allDay: false,
    });
    expect(ev?.extendedProps.estimated).toBe(false);
  });

  it("所要時間が未設定なら既定の長さで仮描画し、estimated を立てる", () => {
    const ev = toEvent(makeItem({ due_time: "09:00:00" }), TODAY);
    expect(ev?.end).toBe("2026-08-28T09:30:00");
    expect(DEFAULT_BLOCK_MIN).toBe(30);
    expect(ev?.extendedProps.estimated).toBe(true);
  });

  it("完了済みは動かせない（履歴のため）", () => {
    const done = toEvent(makeItem({ status: "done" }), TODAY);
    expect(done?.editable).toBe(false);
    expect(toEvent(makeItem({}), TODAY)?.editable).toBe(true);
  });

  it("終日イベントは長さを変えられない（日をまたぐ長さを表現できないため）", () => {
    expect(toEvent(makeItem({ due_time: null }), TODAY)?.durationEditable).toBe(false);
    expect(toEvent(makeItem({ due_time: "09:00:00" }), TODAY)?.durationEditable).toBe(true);
    expect(
      toEvent(makeItem({ due_time: "09:00:00", status: "done" }), TODAY)?.durationEditable,
    ).toBe(false);
  });

  it("習慣は asagi、期限超過は beni で描き分ける", () => {
    expect(toEvent(makeItem({ habit_id: "h1" }), TODAY)?.classNames).toContain("zd-ev-habit");
    expect(toEvent(makeItem({ due_date: "2026-08-27" }), TODAY)?.classNames).toContain(
      "zd-ev-overdue",
    );
    expect(toEvent(makeItem({}), TODAY)?.classNames).toEqual(["zd-ev"]);
  });

  it("完了は習慣・期限超過より優先する（済んだものは履歴として一様に見せる）", () => {
    const ev = toEvent(makeItem({ status: "done", habit_id: "h1", due_date: "2026-08-20" }), TODAY);
    expect(ev?.classNames).toEqual(["zd-ev", "zd-ev-done"]);
  });
});

describe("durationFromRange", () => {
  const at = (h: number, m = 0) => new Date(2026, 7, 28, h, m);

  it("開始と終了の差を分で返す", () => {
    expect(durationFromRange(at(9), at(10, 30))).toBe(90);
  });

  it("0以下にはしない（DBのCHECK制約に合わせる）", () => {
    expect(durationFromRange(at(9), at(9))).toBe(1);
    expect(durationFromRange(at(10), at(9))).toBe(1);
  });

  it("24時間を超えたら丸める", () => {
    expect(durationFromRange(new Date(2026, 7, 28, 9), new Date(2026, 7, 30, 9))).toBe(1440);
  });
});

describe("toEvents", () => {
  it("描けないもの（期日なし）は落として詰める", () => {
    const events = toEvents(
      [makeItem({ id: "a" }), makeItem({ id: "b", due_date: null }), makeItem({ id: "c" })],
      TODAY,
    );
    expect(events.map((e) => e.id)).toEqual(["a", "c"]);
  });
});

describe("rangeQuery", () => {
  it("完了分も描くので statuses を明示する", () => {
    expect(rangeQuery("2026-08-23", "2026-08-29")).toBe(
      "/api/items?kind=todo&statuses=todo,done&due_from=2026-08-23&due_to=2026-08-29",
    );
  });
});
