// 習慣の頻度判定（純粋関数）。docs/database-design.md 5.1。
import { isoWeekday } from "@/lib/date";
import type { FrequencyRule } from "@/lib/types";

/** その日付（'YYYY-MM-DD'）が頻度ルールの該当日かどうか。 */
export function frequencyMatchesDate(rule: FrequencyRule, ymd: string): boolean {
  switch (rule.type) {
    case "daily":
      return true;
    case "weekly":
      return rule.weekdays.includes(isoWeekday(ymd));
  }
}
