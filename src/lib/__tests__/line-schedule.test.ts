import { describe, expect, it } from "vitest";
import { dueSlots, isRestDay, LATE_LIMIT_MIN, slotsFor, SLOT_TIME } from "@/lib/line/schedule";

describe("isRestDay", () => {
  it("平日は休みではない", () => {
    expect(isRestDay("2026-09-14")).toBe(false); // 月
    expect(isRestDay("2026-09-18")).toBe(false); // 金
  });

  it("土日は休み", () => {
    expect(isRestDay("2026-09-12")).toBe(true); // 土
    expect(isRestDay("2026-09-13")).toBe(true); // 日
  });

  it("祝日は休み", () => {
    expect(isRestDay("2026-09-21")).toBe(true); // 敬老の日（月）
    expect(isRestDay("2026-09-23")).toBe(true); // 秋分の日（水）
    expect(isRestDay("2027-01-01")).toBe(true); // 元日（金）
  });

  it("振替休日と国民の休日も休み", () => {
    expect(isRestDay("2026-05-06")).toBe(true); // 振替休日（水）
    expect(isRestDay("2026-09-22")).toBe(true); // 国民の休日（火）
  });
});

describe("slotsFor", () => {
  it("平日は夕と深夜だけ（朝は職場で見るので送らない）", () => {
    expect(slotsFor(false)).toEqual(["evening", "night"]);
  });

  it("休日は4枠", () => {
    expect(slotsFor(true)).toEqual(["morning", "noon", "evening", "night"]);
  });
});

describe("dueSlots", () => {
  it("枠の時刻より前は送らない", () => {
    expect(dueSlots("18:59", false)).toEqual([]);
    expect(dueSlots("08:59", true)).toEqual([]);
  });

  it("枠の時刻ちょうどで送る", () => {
    expect(dueSlots(SLOT_TIME.evening, false)).toEqual(["evening"]);
    expect(dueSlots(SLOT_TIME.morning, true)).toEqual(["morning"]);
  });

  it("2時間以内の遅れなら送る（cronが数回落ちても届く）", () => {
    expect(dueSlots("20:30", false)).toEqual(["evening"]);
    expect(dueSlots("21:00", false)).toEqual(["evening"]);
  });

  it("2時間を超えて遅れたら送らない（朝の分が夜に届くのを防ぐ）", () => {
    expect(dueSlots("21:01", false)).toEqual([]);
    expect(LATE_LIMIT_MIN).toBe(120);
  });

  it("平日の朝・昼は枠自体が無い", () => {
    expect(dueSlots("09:00", false)).toEqual([]);
    expect(dueSlots("13:00", false)).toEqual([]);
  });

  it("深夜枠は日付が変わると送らない（翌日の枠に切り替わる）", () => {
    expect(dueSlots("23:30", false)).toEqual(["night"]);
    expect(dueSlots("00:10", false)).toEqual([]);
  });

  it("枠同士は離れているので同時に2つ返らない", () => {
    for (const hm of ["09:00", "11:00", "13:00", "15:00", "18:00", "20:00", "23:00", "23:59"]) {
      expect(dueSlots(hm, true).length).toBeLessThanOrEqual(1);
    }
  });
});
