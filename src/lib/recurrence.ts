// 繰り返しエンジン（純粋関数）。仕様は docs/database-design.md 4章。
//
// 中核設計: 次回インスタンスは「完了した瞬間」に1件だけ生成し、未消化の過去回は積み上げない。
// そのため「現在の回より後」かつ「期限がまだ過ぎていない」最初の1回を返す。
//
// 期限が過ぎたかの判定は、時刻付きなら日付＋時刻で見る（2026-09-16変更）。
// 日付だけで見ていた頃は、23:00期限のタスクを日付をまたいで完了すると
// 今夜の分がまだ来ていないのに「今日は消化済み」と扱われ、丸ごと飛んでいた。
// 時刻なしは従来どおり「今日より後」。完了した直後に同じタスクが今日に生え直すのを避ける。

import { addDays, clampDayToMonth, isoWeekday, maxYmd } from "@/lib/date";
import type { RecurrenceRule } from "@/lib/types";

/** base より後（strictly after）で最初に weekdays に該当する日。 */
function nextWeekdayAfter(base: string, weekdays: number[]): string {
  const set = new Set(weekdays);
  for (let i = 1; i <= 7; i++) {
    const cand = addDays(base, i);
    if (set.has(isoWeekday(cand))) return cand;
  }
  // weekdays が非空であればループ内で必ず返る（入力検証で担保）
  throw new Error("nextWeekdayAfter: empty or invalid weekdays");
}

/** base より後で最初の「day日（月末クランプ）」。 */
function nextMonthlyDayAfter(base: string, day: number): string {
  const [by, bm] = base.split("-").map(Number);
  let y = by;
  let m = bm;
  // 最大13ヶ月見れば必ず base より後の候補が見つかる
  for (let i = 0; i < 13; i++) {
    const cand = `${y}-${String(m).padStart(2, "0")}-${String(clampDayToMonth(y, m, day)).padStart(2, "0")}`;
    if (cand > base) return cand;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  throw new Error("nextMonthlyDayAfter: no candidate found");
}

/** due_date + k*n（k>=1）のうち base より後の最小のもの。位相（元のdue_date基準）を保つ。 */
function nextScheduleInterval(currentDueDate: string, n: number, base: string): string {
  let k = 1;
  let cand = addDays(currentDueDate, n * k);
  while (cand <= base) {
    k++;
    cand = addDays(currentDueDate, n * k);
  }
  return cand;
}

/**
 * 候補として許される最も早い日の「1日前」。各ヘルパーが「baseより後」を返すための下駄。
 * 時刻付きで今日の期限がまだ来ていなければ今日を許し、過ぎていれば明日以降にする。
 */
function floorFor(today: string, dueTime: string | null, nowHm: string): string {
  const todayStillOpen = dueTime !== null && nowHm <= dueTime.slice(0, 5);
  return todayStillOpen ? addDays(today, -1) : today;
}

/**
 * 現在の回を完了したときに生成すべき次回の due_date を返す。
 * @param rule 繰り返しルール
 * @param currentDueDate 現在の回の due_date（'YYYY-MM-DD'）
 * @param today JSTの今日（'YYYY-MM-DD'）
 * @param dueTime 現在の回の due_time（'HH:MM' / 'HH:MM:SS'）。nullなら時刻なし
 * @param nowHm JSTの現在時刻（'HH:MM'）
 */
export function computeNextDueDate(
  rule: RecurrenceRule,
  currentDueDate: string,
  today: string,
  dueTime: string | null = null,
  nowHm = "23:59",
): string {
  const base = maxYmd(floorFor(today, dueTime, nowHm), currentDueDate);
  switch (rule.type) {
    case "daily":
      return addDays(base, 1);
    case "weekly":
      return nextWeekdayAfter(base, rule.weekdays);
    case "monthly_day":
      return nextMonthlyDayAfter(base, rule.day);
    case "interval_days":
      // from=completion は「完了日（今日）からn日後」、from=schedule は元の位相を維持
      return rule.from === "completion"
        ? addDays(today, rule.n)
        : nextScheduleInterval(currentDueDate, rule.n, base);
  }
}
