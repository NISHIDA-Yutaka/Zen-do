import { describe, expect, it } from "vitest";
import { habitAlert } from "@/lib/habit-alerts";
import type { FrequencyRule, Habit } from "@/lib/types";

// 2026-09-14(月)〜09-20(日) が「今週」。9/15=火 9/18=金 9/19=土 9/20=日
const MON = "2026-09-14";
const FRI = "2026-09-18";
const SAT = "2026-09-19";
const SUN = "2026-09-20";
const TUE = "2026-09-15";

function habit(rule: FrequencyRule): Habit {
  return {
    id: "h1",
    title: "Study Korean",
    notes: "",
    tags: [],
    frequency_rule: rule,
    default_reminder_rule: null,
    default_due_time: null,
    is_paused: false,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const weekly2 = habit({ type: "times_per_week", n: 2 });

/** 連続記録を生かすため、先週分は達成させておく（救済の有無で文面が変わるので分けて検証する） */
const lastWeekDone = ["2026-09-08", "2026-09-10"];

describe("habitAlert: 週n回", () => {
  it("余裕が2日以上あるうちは黙る（毎日言われるのは催促ではなく雑音）", () => {
    // 火曜・0/2。残り6日で2回なので余裕4日
    expect(habitAlert(weekly2, lastWeekDone, TUE)).toBeNull();
  });

  it("余裕1日になったら声をかける（金曜・0/2）", () => {
    const a = habitAlert(weekly2, lastWeekDone, FRI);
    expect(a).toMatchObject({ remaining: 2, daysLeft: 3, tight: true });
  });

  it("残り回数と残り日数が並んだら毎日必須（土曜・0/2）", () => {
    expect(habitAlert(weekly2, lastWeekDone, SAT)).toMatchObject({ remaining: 2, daysLeft: 2 });
  });

  it("もう届かない時も黙らない（日曜・0/2）", () => {
    const a = habitAlert(weekly2, lastWeekDone, SUN);
    expect(a).toMatchObject({ remaining: 2, daysLeft: 1 });
  });

  it("今週の目標を満たしていれば黙る", () => {
    const done = [...lastWeekDone, MON, TUE];
    expect(habitAlert(weekly2, done, FRI)).toBeNull();
  });

  it("1回済ませてあれば余裕が増えて黙る（金曜・1/2）", () => {
    // 残り1回に対して残り3日なので余裕2日
    expect(habitAlert(weekly2, [...lastWeekDone, MON], FRI)).toBeNull();
  });

  it("先週も落としていたら、ここで落とすと連続が切れる", () => {
    const a = habitAlert(weekly2, ["2026-09-01", "2026-09-03"], FRI);
    expect(a?.breaksStreak).toBe(true);
  });

  it("先週を達成していれば救済が残っているので、切れる扱いにしない", () => {
    expect(habitAlert(weekly2, lastWeekDone, FRI)?.breaksStreak).toBe(false);
  });
});

describe("habitAlert: 月n回", () => {
  const monthly2 = habit({ type: "times_per_month", n: 2 });

  it("月末まで余裕があれば黙る", () => {
    expect(habitAlert(monthly2, ["2026-08-05", "2026-08-20"], "2026-09-10")).toBeNull();
  });

  it("月末が迫って残り回数が並んだら声をかける（9/29・0/2）", () => {
    const a = habitAlert(monthly2, ["2026-08-05", "2026-08-20"], "2026-09-29");
    expect(a).toMatchObject({ remaining: 2, daysLeft: 2, tight: true });
  });
});

describe("habitAlert: 日課", () => {
  const daily = habit({ type: "daily" });

  it("今日やっていないだけでは言わない（毎日の催促にしない）", () => {
    const done = ["2026-09-12", "2026-09-13", MON, TUE];
    expect(habitAlert(daily, done, "2026-09-16")).toBeNull();
  });

  it("昨日も落としていたら、今日が最後の日として声をかける", () => {
    const done = ["2026-09-12", "2026-09-13", MON, TUE];
    const a = habitAlert(daily, done, "2026-09-17");
    expect(a).toMatchObject({ remaining: 1, daysLeft: 1, breaksStreak: true });
  });

  it("すでに連続が切れているなら蒸し返さない", () => {
    const done = ["2026-09-12", "2026-09-13", MON, TUE];
    expect(habitAlert(daily, done, "2026-09-18")).toBeNull();
  });
});
