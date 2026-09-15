// 習慣の「今動かないと落とす」検出（docs/line-plan.md 9.1）。
// 完了ログから導く純関数。保存列は増やさない（habit-stats.ts と同じ方針）。
//
// 黙っている条件を厳しめにしている。毎日「やってない」と言われるのは催促ではなく雑音なので、
// 「救済を使い切っている」か「残り回数と残り日数が並んだ」時だけ声をかける。
import { addDays, daysInMonth, diffDays, weekStartMonday } from "@/lib/date";
import { computeHabitStats } from "@/lib/habit-stats";
import type { Habit } from "@/lib/types";

export type HabitAlert = {
  habit: Habit;
  /** 期間の目標に届くまであと何回。日課・n日おきは1 */
  remaining: number;
  /** 今日を含む、期間の残り日数 */
  daysLeft: number;
  /** 期間内に届くための余裕が1日以下（残り回数 >= 残り日数 - 1） */
  tight: boolean;
  /** ここで落とすと連続記録が切れる（救済を使い切っている） */
  breaksStreak: boolean;
};

/** 今日を含む、その期間の残り日数 */
function periodDaysLeft(type: "times_per_week" | "times_per_month", today: string): number {
  if (type === "times_per_week") {
    return diffDays(today, addDays(weekStartMonday(today), 6)) + 1;
  }
  const [y, m] = today.split("-").map(Number);
  return diffDays(today, `${today.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`) + 1;
}

export function habitAlert(habit: Habit, doneDates: string[], today: string): HabitAlert | null {
  const stats = computeHabitStats(habit.frequency_rule, doneDates, today);
  const rule = habit.frequency_rule;

  if (rule.type === "times_per_week" || rule.type === "times_per_month") {
    if (stats.weekAchieved) return null; // 今期はもう達成している
    const remaining = stats.weekTarget - stats.weekDone;
    if (remaining <= 0) return null;
    const daysLeft = periodDaysLeft(rule.type, today);
    // 余裕1日で声をかける。ちょうど並ぶ（=毎日必須）まで待つと、
    // 週2回を金曜に0/2で迎えても土曜まで黙ってしまい、打つ手が減る
    const tight = remaining >= daysLeft - 1;
    // 余裕があり、救済も使っていないなら黙る
    if (!tight && !stats.resting) return null;
    return { habit, remaining, daysLeft, tight, breaksStreak: stats.resting };
  }

  // daily / every_n_days は救済中（次に落とすと切れる状態）の時だけ
  if (!stats.resting) return null;
  const daysLeft = stats.restDaysLeft ?? 1;
  return { habit, remaining: 1, daysLeft, tight: daysLeft <= 1, breaksStreak: true };
}

/** 声をかけるべき習慣。切羽詰まっている順（残り日数が少ない順）に並べる */
export function habitAlerts(
  habits: Habit[],
  doneDatesByHabit: Map<string, string[]>,
  today: string,
): HabitAlert[] {
  return habits
    .flatMap((h) => habitAlert(h, doneDatesByHabit.get(h.id) ?? [], today) ?? [])
    .sort((a, b) => a.daysLeft - b.daysLeft || b.remaining - a.remaining);
}
