import { describe, expect, it } from "vitest";
import { isPlannerCandidate } from "@/lib/frequency";

// 基準日: 2026-07-16（木）。週は月曜はじまり → 今週 = 07-13(月) 〜 07-19(日)
const TODAY = "2026-07-16";

describe("isPlannerCandidate: daily", () => {
  it("完了履歴に関わらず毎日候補", () => {
    expect(isPlannerCandidate({ type: "daily" }, TODAY, [])).toBe(true);
    expect(isPlannerCandidate({ type: "daily" }, TODAY, ["2026-07-15"])).toBe(true);
  });
});

describe("isPlannerCandidate: every_n_days (n=2)", () => {
  const rule = { type: "every_n_days", n: 2 } as const;

  it("完了実績ゼロなら候補", () => {
    expect(isPlannerCandidate(rule, TODAY, [])).toBe(true);
  });
  it("最終完了からn日経過していれば候補（7/14完了→7/16は候補）", () => {
    expect(isPlannerCandidate(rule, TODAY, ["2026-07-14"])).toBe(true);
  });
  it("n日経過していなければ候補外（7/15完了→7/16は候補外）", () => {
    expect(isPlannerCandidate(rule, TODAY, ["2026-07-15"])).toBe(false);
  });
  it("履歴が複数あるときは最新の完了日で判定", () => {
    expect(isPlannerCandidate(rule, TODAY, ["2026-07-10", "2026-07-15"])).toBe(false);
    expect(isPlannerCandidate(rule, TODAY, ["2026-07-15", "2026-07-10"])).toBe(false);
  });
});

describe("isPlannerCandidate: times_per_week (n=3)", () => {
  const rule = { type: "times_per_week", n: 3 } as const;

  it("今週の完了がn回未満なら候補", () => {
    expect(isPlannerCandidate(rule, TODAY, [])).toBe(true);
    expect(isPlannerCandidate(rule, TODAY, ["2026-07-13", "2026-07-14"])).toBe(true);
  });
  it("今週n回完了したら候補外", () => {
    expect(
      isPlannerCandidate(rule, TODAY, ["2026-07-13", "2026-07-14", "2026-07-15"]),
    ).toBe(false);
  });
  it("先週の完了は今週のカウントに入れない（週は月曜リセット）", () => {
    // 07-11(土)・07-12(日)は先週分。今週分は2回だけなので候補
    expect(
      isPlannerCandidate(rule, TODAY, ["2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"]),
    ).toBe(true);
  });
  it("週の境界: 月曜(07-13)は今週、日曜(07-12)は先週", () => {
    const twoThisWeekPlusSunday = ["2026-07-12", "2026-07-13", "2026-07-14"];
    expect(isPlannerCandidate(rule, TODAY, twoThisWeekPlusSunday)).toBe(true);
  });
});
