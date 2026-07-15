// リマインダー解決（純粋関数）。仕様は docs/database-design.md 6.1。
//
// ルール（相対/絶対）を実際の発火時刻（remind_at, UTCのISO文字列）へ解決する。
// due_date/due_time が変わったら、相対ルールのリマインダーはこの関数で再計算する。

import { addDays, jstWallClockToIso } from "@/lib/date";
import type { ReminderRule } from "@/lib/types";

/** 絶対時刻ルール（at）以外は、due_date に依存する相対ルール。 */
export function isRelativeReminderRule(rule: ReminderRule): boolean {
  return rule.kind !== "at";
}

/**
 * ルールを remind_at（UTCのISO文字列）へ解決する。
 * due_date/due_time が不足していて解決できない場合は null を返す。
 */
export function resolveRemindAt(
  rule: ReminderRule,
  dueDate: string | null,
  dueTime: string | null,
): string | null {
  switch (rule.kind) {
    case "at":
      return new Date(rule.at).toISOString();
    case "on_due_at":
      return dueDate ? jstWallClockToIso(dueDate, rule.time) : null;
    case "day_before_at":
      return dueDate ? jstWallClockToIso(addDays(dueDate, -1), rule.time) : null;
    case "before_due_minutes": {
      if (!dueDate || !dueTime) return null;
      const dueMs = new Date(jstWallClockToIso(dueDate, dueTime)).getTime();
      return new Date(dueMs - rule.minutes * 60_000).toISOString();
    }
  }
}
