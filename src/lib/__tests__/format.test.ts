import { describe, expect, it } from "vitest";
import { formatDueLabel } from "@/lib/format";

describe("formatDueLabel", () => {
  const today = "2026-07-30";

  it("期日なしは null", () => {
    expect(formatDueLabel(null, null, today)).toBeNull();
  });

  it("当日・時刻なしは表示しない（null）", () => {
    expect(formatDueLabel(today, null, today)).toBeNull();
  });

  it("当日・時刻ありで現在時刻より前＝まだ超過でない", () => {
    // now=10:00、期限 12:00 → 未超過
    expect(formatDueLabel(today, "12:00", today, "10:00")).toEqual({
      text: "12:00",
      late: false,
      overdue: false,
    });
  });

  it("当日・時刻ありで現在時刻を過ぎたら overdue（チップ用 late は立てない）", () => {
    // now=12:48、期限 10:00 → 超過
    expect(formatDueLabel(today, "10:00", today, "12:48")).toEqual({
      text: "10:00",
      late: false,
      overdue: true,
    });
  });

  it("当日・時刻ちょうどは未超過（time < now が false）", () => {
    expect(formatDueLabel(today, "12:00", today, "12:00")?.overdue).toBe(false);
  });

  it("nowHM 省略時は当日時刻の超過判定をしない", () => {
    expect(formatDueLabel(today, "10:00", today)).toEqual({
      text: "10:00",
      late: false,
      overdue: false,
    });
  });

  it("過去日は late も overdue も true（時刻の有無を問わず）", () => {
    expect(formatDueLabel("2026-07-28", null, today)).toEqual({
      text: "7月28日",
      late: true,
      overdue: true,
    });
    expect(formatDueLabel("2026-07-28", "09:30", today)).toEqual({
      text: "7月28日 09:30",
      late: true,
      overdue: true,
    });
  });

  it("未来日は late も overdue も false", () => {
    expect(formatDueLabel("2026-08-05", "09:30", today)).toEqual({
      text: "8月5日 09:30",
      late: false,
      overdue: false,
    });
  });
});
