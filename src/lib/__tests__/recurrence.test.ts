import { describe, expect, it } from "vitest";
import { computeNextDueDate } from "@/lib/recurrence";
import type { RecurrenceRule } from "@/lib/types";

// 参照: docs/database-design.md 4.3 の具体例

describe("daily", () => {
  const rule: RecurrenceRule = { type: "daily" };
  it("期日通り完了 → 翌日", () => {
    expect(computeNextDueDate(rule, "2026-07-15", "2026-07-15")).toBe("2026-07-16");
  });
  it("3日放置して完了 → 明日1件のみ（過去分を積まない）", () => {
    // due=07-12, today=07-15 → base=07-15 → 翌日=07-16
    expect(computeNextDueDate(rule, "2026-07-12", "2026-07-15")).toBe("2026-07-16");
  });
});

describe("weekly", () => {
  const tue: RecurrenceRule = { type: "weekly", weekdays: [2] }; // 火曜
  it("毎週火曜を木曜に遅れて完了 → 来週の火曜（今週分は巻き戻さない）", () => {
    // 2026-07-14=火, 2026-07-16=木, 次の火曜=2026-07-21
    expect(computeNextDueDate(tue, "2026-07-14", "2026-07-16")).toBe("2026-07-21");
  });
  it("期日通り完了でも次は翌週（same-day は含めない）", () => {
    expect(computeNextDueDate(tue, "2026-07-14", "2026-07-14")).toBe("2026-07-21");
  });
  it("複数曜日（月水金）は直近の該当日", () => {
    const mwf: RecurrenceRule = { type: "weekly", weekdays: [1, 3, 5] };
    // 2026-07-15=水に完了 → 次は金=2026-07-17
    expect(computeNextDueDate(mwf, "2026-07-15", "2026-07-15")).toBe("2026-07-17");
  });
});

describe("monthly_day", () => {
  it("毎月31日は短い月で月末にクランプ", () => {
    // due=01-31 完了 → base=01-31 → 次は2月末(28)
    expect(computeNextDueDate({ type: "monthly_day", day: 31 }, "2026-01-31", "2026-01-31")).toBe(
      "2026-02-28",
    );
  });
  it("通常の月内進行", () => {
    expect(computeNextDueDate({ type: "monthly_day", day: 15 }, "2026-07-15", "2026-07-15")).toBe(
      "2026-08-15",
    );
  });
});

describe("interval_days from=schedule", () => {
  const rule: RecurrenceRule = { type: "interval_days", n: 3, from: "schedule" };
  it("期日通り → due+3", () => {
    expect(computeNextDueDate(rule, "2026-07-15", "2026-07-15")).toBe("2026-07-18");
  });
  it("大幅遅延でも位相（due+3k）を維持し過去分を積まない", () => {
    // due=07-01, today=07-10 → 07-01+3k で 07-10 を超える最小 = 07-13 (k=4)
    expect(computeNextDueDate(rule, "2026-07-01", "2026-07-10")).toBe("2026-07-13");
  });
});

describe("interval_days from=completion", () => {
  const rule: RecurrenceRule = { type: "interval_days", n: 3, from: "completion" };
  it("完了日（今日）からn日後", () => {
    // due がいつであれ today 基準
    expect(computeNextDueDate(rule, "2026-07-01", "2026-07-10")).toBe("2026-07-13");
  });
});
