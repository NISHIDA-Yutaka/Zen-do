import { describe, expect, it } from "vitest";
import {
  addDays,
  clampDayToMonth,
  isoWeekday,
  jstWallClockToIso,
  maxYmd,
  todayInJst,
  weekStartMonday,
} from "@/lib/date";

describe("todayInJst", () => {
  it("日本の朝はUTCではまだ前日でも、JSTの当日を返す", () => {
    // 2026-07-15 01:00 JST = 2026-07-14 16:00 UTC
    expect(todayInJst(new Date("2026-07-14T16:00:00Z"))).toBe("2026-07-15");
  });
  it("JST深夜0時直後", () => {
    // 2026-07-15 00:00 JST = 2026-07-14 15:00 UTC
    expect(todayInJst(new Date("2026-07-14T15:00:00Z"))).toBe("2026-07-15");
  });
  it("JST 23:59 はまだ当日", () => {
    // 2026-07-15 23:59 JST = 2026-07-15 14:59 UTC
    expect(todayInJst(new Date("2026-07-15T14:59:00Z"))).toBe("2026-07-15");
  });
});

describe("addDays", () => {
  it("月をまたぐ", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("年をまたぐ", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("負の加算", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("うるう年", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("isoWeekday", () => {
  it("2026-07-15 は水曜(3)", () => {
    expect(isoWeekday("2026-07-15")).toBe(3);
  });
  it("日曜は7", () => {
    expect(isoWeekday("2026-07-19")).toBe(7);
  });
});

describe("clampDayToMonth", () => {
  it("2月31日は28に丸まる（平年）", () => {
    expect(clampDayToMonth(2026, 2, 31)).toBe(28);
  });
  it("うるう年2月は29", () => {
    expect(clampDayToMonth(2028, 2, 31)).toBe(29);
  });
  it("31日ある月はそのまま", () => {
    expect(clampDayToMonth(2026, 1, 31)).toBe(31);
  });
});

describe("maxYmd", () => {
  it("遅い方を返す", () => {
    expect(maxYmd("2026-07-14", "2026-07-15")).toBe("2026-07-15");
    expect(maxYmd("2026-07-15", "2026-07-14")).toBe("2026-07-15");
  });
});

describe("weekStartMonday", () => {
  it("木曜(2026-07-16) → その週の月曜(07-13)", () => {
    expect(weekStartMonday("2026-07-16")).toBe("2026-07-13");
  });
  it("月曜は当日を返す", () => {
    expect(weekStartMonday("2026-07-13")).toBe("2026-07-13");
  });
  it("日曜は6日前の月曜を返す", () => {
    expect(weekStartMonday("2026-07-19")).toBe("2026-07-13");
  });
});

describe("jstWallClockToIso", () => {
  it("JST 15:00 は UTC 06:00", () => {
    expect(jstWallClockToIso("2026-07-20", "15:00")).toBe("2026-07-20T06:00:00.000Z");
  });
  it("秒付きも扱える", () => {
    expect(jstWallClockToIso("2026-07-20", "08:00:00")).toBe("2026-07-19T23:00:00.000Z");
  });
});
