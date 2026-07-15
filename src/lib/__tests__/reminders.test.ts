import { describe, expect, it } from "vitest";
import { isRelativeReminderRule, resolveRemindAt } from "@/lib/reminders";
import type { ReminderRule } from "@/lib/types";

describe("isRelativeReminderRule", () => {
  it("at は絶対、それ以外は相対", () => {
    expect(isRelativeReminderRule({ kind: "at", at: "2026-07-20T15:00:00+09:00" })).toBe(false);
    expect(isRelativeReminderRule({ kind: "on_due_at", time: "08:00" })).toBe(true);
  });
});

describe("resolveRemindAt", () => {
  it("at: 絶対時刻をそのままUTC化", () => {
    const rule: ReminderRule = { kind: "at", at: "2026-07-20T15:00:00+09:00" };
    expect(resolveRemindAt(rule, null, null)).toBe("2026-07-20T06:00:00.000Z");
  });

  it("on_due_at: 当日の指定時刻（JST→UTC）", () => {
    const rule: ReminderRule = { kind: "on_due_at", time: "08:00" };
    // 2026-07-20 08:00 JST = 2026-07-19 23:00 UTC
    expect(resolveRemindAt(rule, "2026-07-20", null)).toBe("2026-07-19T23:00:00.000Z");
  });
  it("on_due_at: due_date が無ければ null", () => {
    expect(resolveRemindAt({ kind: "on_due_at", time: "08:00" }, null, null)).toBeNull();
  });

  it("day_before_at: 前日の指定時刻", () => {
    const rule: ReminderRule = { kind: "day_before_at", time: "20:00" };
    // 前日 2026-07-19 20:00 JST = 2026-07-19 11:00 UTC
    expect(resolveRemindAt(rule, "2026-07-20", null)).toBe("2026-07-19T11:00:00.000Z");
  });

  it("before_due_minutes: 期限のn分前", () => {
    const rule: ReminderRule = { kind: "before_due_minutes", minutes: 60 };
    // 期限 2026-07-20 15:00 JST の60分前 = 14:00 JST = 05:00 UTC
    expect(resolveRemindAt(rule, "2026-07-20", "15:00")).toBe("2026-07-20T05:00:00.000Z");
  });
  it("before_due_minutes: due_time が無ければ null", () => {
    expect(resolveRemindAt({ kind: "before_due_minutes", minutes: 60 }, "2026-07-20", null)).toBeNull();
  });
});
