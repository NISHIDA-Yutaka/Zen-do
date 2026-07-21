import { describe, expect, it } from "vitest";
import { computeHabitStats } from "@/lib/habit-stats";
import { addDays } from "@/lib/date";

// 基準日 2026-07-16（木）。週=07-13(月)〜07-19(日)
const TODAY = "2026-07-16";
const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(from, -i));

describe("daily", () => {
  const rule = { type: "daily" } as const;

  it("今日含む連続7日 → streak 7", () => {
    const s = computeHabitStats(rule, days(TODAY, 7), TODAY);
    expect(s.streak).toBe(7);
    expect(s.streakUnit).toBe("日");
    expect(s.resting).toBe(false);
  });

  it("今日未実施でも昨日までの連続は保つ（減点しない）", () => {
    // 昨日07-15まで5日連続、今日未実施
    const s = computeHabitStats(rule, days("2026-07-15", 5), TODAY);
    expect(s.streak).toBe(5);
    expect(s.resting).toBe(false); // 昨日done・今日未実施は通常
  });

  it("昨日休み・一昨日までdone・今日未実施 → おやすみ中(救済)", () => {
    // 07-14まで連続、07-15休み、今日07-16未実施
    const s = computeHabitStats(rule, days("2026-07-14", 4), TODAY);
    expect(s.streak).toBe(4);
    expect(s.resting).toBe(true);
    expect(s.restDaysLeft).toBe(1);
  });

  it("2連続休みで途切れ", () => {
    // 07-13まで連続、07-14/07-15休み、今日未実施 → 途切れ
    const s = computeHabitStats(rule, days("2026-07-13", 3), TODAY);
    expect(s.streak).toBe(0);
    expect(s.resting).toBe(false);
  });

  it("今週の進捗 n/7", () => {
    // 07-13,07-14,07-16 の3日
    const s = computeHabitStats(rule, ["2026-07-13", "2026-07-14", "2026-07-16"], TODAY);
    expect(s.weekDone).toBe(3);
    expect(s.weekTarget).toBe(7);
  });
});

describe("every_n_days (n=3)", () => {
  const rule = { type: "every_n_days", n: 3 } as const;

  it("実績ゼロ → streak0・次は今日", () => {
    const s = computeHabitStats(rule, [], TODAY);
    expect(s.streak).toBe(0);
    expect(s.nextLabel).toBe("次は今日");
    expect(s.streakUnit).toBe("回");
  });

  it("07-10,07-13,07-16 の等間隔 → streak3", () => {
    const s = computeHabitStats(rule, ["2026-07-10", "2026-07-13", "2026-07-16"], TODAY);
    expect(s.streak).toBe(3);
    expect(s.resting).toBe(false);
  });

  it("最終完了から2n(6日)超過 → streak失効", () => {
    // 最後が07-09（今日まで7日）→ 2n=6 超過
    const s = computeHabitStats(rule, ["2026-07-06", "2026-07-09"], TODAY);
    expect(s.streak).toBe(0);
  });

  it("期日超過だが救済窓内 → おやすみ中", () => {
    // 最後が07-12（4日前, n=3なので1日超過, 2n=6以内）→ resting
    const s = computeHabitStats(rule, ["2026-07-09", "2026-07-12"], TODAY);
    expect(s.streak).toBe(2);
    expect(s.resting).toBe(true);
    expect(s.restDaysLeft).toBe(3); // 07-16..07-18(=07-12+2n) の3日
  });

  it("次回予定表記（明日）", () => {
    // 最後が07-14 → 次は07-17=明日
    const s = computeHabitStats(rule, ["2026-07-14"], TODAY);
    expect(s.nextLabel).toBe("次は明日");
  });
});

describe("times_per_week (n=3)", () => {
  const rule = { type: "times_per_week", n: 3 } as const;

  it("今週3回 → 達成・streakに含む", () => {
    const s = computeHabitStats(rule, ["2026-07-13", "2026-07-14", "2026-07-15"], TODAY);
    expect(s.weekAchieved).toBe(true);
    expect(s.weekDone).toBe(3);
    expect(s.streak).toBe(1);
  });

  it("今週3回＋先週3回 → 連続2週", () => {
    const s = computeHabitStats(
      rule,
      ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-13", "2026-07-14", "2026-07-15"],
      TODAY,
    );
    expect(s.streak).toBe(2);
  });

  it("今週未達成でも先週達成なら途切れない", () => {
    // 先週3回、今週1回
    const s = computeHabitStats(
      rule,
      ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-13"],
      TODAY,
    );
    expect(s.weekAchieved).toBe(false);
    expect(s.streak).toBe(1); // 先週分
    expect(s.resting).toBe(false); // 前週は達成しているので救済発動なし
  });

  it("前週未達成・今週未達成 → おやすみ中（救済）", () => {
    // 2週前3回、先週0回、今週0回
    const s = computeHabitStats(
      rule,
      ["2026-06-29", "2026-06-30", "2026-07-01"],
      TODAY,
    );
    expect(s.streak).toBe(1); // 2週前分
    expect(s.resting).toBe(true);
  });

  it("2週連続未達成で途切れ", () => {
    // 3週前3回、先週2週とも未達成、今週未達成
    const s = computeHabitStats(
      rule,
      ["2026-06-22", "2026-06-23", "2026-06-24"],
      TODAY,
    );
    expect(s.streak).toBe(0);
  });
});
