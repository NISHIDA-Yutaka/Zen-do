import { describe, expect, it } from "vitest";
import { frequencyMatchesDate } from "@/lib/frequency";

describe("frequencyMatchesDate", () => {
  it("daily は常に該当", () => {
    expect(frequencyMatchesDate({ type: "daily" }, "2026-07-15")).toBe(true);
  });
  it("weekly は指定曜日のみ該当", () => {
    // 2026-07-15 は水曜(3)
    expect(frequencyMatchesDate({ type: "weekly", weekdays: [1, 3, 5] }, "2026-07-15")).toBe(true);
    expect(frequencyMatchesDate({ type: "weekly", weekdays: [2, 4] }, "2026-07-15")).toBe(false);
  });
});
