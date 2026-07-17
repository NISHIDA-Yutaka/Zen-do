// 習慣のTodayプランナー候補判定（純粋関数）。docs/design.md 10.1。
// 頻度3種はすべて「完了ログ（done済みインスタンスのdue_date集合）」から判定する。
// 「当日インスタンスが未生成であること」は呼び出し側（/api/today）が担保する。
import { addDays, weekStartMonday } from "@/lib/date";
import type { FrequencyRule } from "@/lib/types";

export function isPlannerCandidate(
  rule: FrequencyRule,
  today: string,
  doneDates: string[],
): boolean {
  switch (rule.type) {
    case "daily":
      return true;
    case "every_n_days": {
      // 最後に完了した日からn日経過で候補。完了実績ゼロなら毎日候補
      const last = doneDates.reduce<string | null>((a, d) => (a === null || d > a ? d : a), null);
      return last === null || today >= addDays(last, rule.n);
    }
    case "times_per_week": {
      // 今週(月〜日)の完了数がn未満なら毎日候補
      const weekStart = weekStartMonday(today);
      const doneThisWeek = doneDates.filter((d) => d >= weekStart && d <= today).length;
      return doneThisWeek < rule.n;
    }
  }
}
