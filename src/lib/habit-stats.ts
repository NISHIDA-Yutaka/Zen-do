// 習慣の継続指標（純粋関数）。docs/design.md 10.2。
// すべて完了ログ（done済みインスタンスの due_date 集合）から導出し、保存列は増やさない。
//
// おやすみ救済の解釈（design.md 10.2「1回逃してもOK・2連続で途切れ」）:
//   単発の未実施1回は許容（streakに数えない）。2連続の未実施で途切れ。
//   当日はまだ終わっていないため、未実施でも減点しない。
import { addDays, diffDays, weekStartMonday } from "@/lib/date";
import type { FrequencyRule } from "@/lib/types";

export type HabitStats = {
  streak: number;
  streakUnit: "日" | "週" | "回";
  resting: boolean; // おやすみ中（救済発動中）
  restDaysLeft: number | null; // あと何日でstreakが失われるか（警告用）
  weekDone: number;
  weekTarget: number; // 0 = 週バーなし（every_n_days）
  weekAchieved: boolean; // times_per_week の n/n 達成
  nextLabel: string | null; // every_n_days「次は今日/明日/M月D日」
  fourWeekRate: number; // 0-100
};

function countInRange(doneSet: Set<string>, start: string, end: string): number {
  let c = 0;
  for (const d of doneSet) if (d >= start && d <= end) c++;
  return c;
}

function fourWeekRate(doneSet: Set<string>, today: string, expected: number): number {
  if (expected <= 0) return 0;
  const done = countInRange(doneSet, addDays(today, -27), today);
  return Math.min(100, Math.round((done / expected) * 100));
}

export function computeHabitStats(
  rule: FrequencyRule,
  doneDates: string[],
  today: string,
): HabitStats {
  const doneSet = new Set(doneDates);

  if (rule.type === "daily") {
    return dailyStats(doneSet, today);
  }
  if (rule.type === "every_n_days") {
    return everyNStats(doneSet, today, rule.n);
  }
  return timesPerWeekStats(doneSet, today, rule.n);
}

function dailyStats(doneSet: Set<string>, today: string): HabitStats {
  // streak: 今日から遡って連続done数。単発miss1つは飛ばす、2連続missで停止。
  // 今日は未実施でも減点しない（数えるだけ）。遡りは常に昨日から。
  let streak = doneSet.has(today) ? 1 : 0;
  let prevWasMiss = false;
  let day = addDays(today, -1);
  for (let i = 0; i < 4000; i++) {
    if (doneSet.has(day)) {
      streak++;
      prevWasMiss = false;
    } else {
      if (prevWasMiss) break;
      prevWasMiss = true;
    }
    day = addDays(day, -1);
  }

  const yesterday = addDays(today, -1);
  const resting = !doneSet.has(today) && !doneSet.has(yesterday) && streak > 0;

  const weekStart = weekStartMonday(today);
  const weekDone = countInRange(doneSet, weekStart, today);

  return {
    streak,
    streakUnit: "日",
    resting,
    restDaysLeft: resting ? 1 : null,
    weekDone,
    weekTarget: 7,
    weekAchieved: false,
    nextLabel: null,
    fourWeekRate: fourWeekRate(doneSet, today, 28),
  };
}

function everyNStats(doneSet: Set<string>, today: string, n: number): HabitStats {
  const sorted = [...doneSet].sort();
  const rate = fourWeekRate(doneSet, today, Math.max(1, Math.round(28 / n)));

  if (sorted.length === 0) {
    return {
      streak: 0,
      streakUnit: "回",
      resting: false,
      restDaysLeft: null,
      weekDone: 0,
      weekTarget: 0,
      weekAchieved: false,
      nextLabel: "次は今日",
      fourWeekRate: rate,
    };
  }

  const last = sorted[sorted.length - 1];
  // 連続サイクル: 隣接完了が2n日以内なら継続
  let run = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (diffDays(sorted[i - 1], sorted[i]) <= 2 * n) run++;
    else break;
  }
  // 最新完了から2nを超えていればstreakは失効
  const sinceLast = diffDays(last, today);
  const streak = sinceLast > 2 * n ? 0 : run;

  // 次回予定日
  const nextDate = addDays(last, n);
  const nextLabel =
    nextDate <= today
      ? "次は今日"
      : nextDate === addDays(today, 1)
        ? "次は明日"
        : `次は${Number(nextDate.slice(5, 7))}月${Number(nextDate.slice(8))}日`;

  // おやすみ: 期日超過(>n)だが救済窓(<=2n)内で、今日未実施。
  // restDaysLeft=今日を含め残り何日行動できるか（deadline=last+2n。+1で今日を含める）
  const resting = streak > 0 && !doneSet.has(today) && sinceLast > n;
  const restDaysLeft = resting ? diffDays(today, addDays(last, 2 * n)) + 1 : null;

  return {
    streak,
    streakUnit: "回",
    resting,
    restDaysLeft,
    weekDone: 0,
    weekTarget: 0,
    weekAchieved: false,
    nextLabel,
    fourWeekRate: rate,
  };
}

function timesPerWeekStats(doneSet: Set<string>, today: string, n: number): HabitStats {
  const weekStart = weekStartMonday(today);
  const weekDone = countInRange(doneSet, weekStart, today);
  const weekAchieved = weekDone >= n;
  const weekAchievedAt = (k: number) => {
    const ws = addDays(weekStart, -7 * k);
    return countInRange(doneSet, ws, addDays(ws, 6)) >= n;
  };

  // 連続達成週。今週は在進行なので達成済みのみ+1（未達成でも減点しない）。
  // 過去週は達成が続く限り遡り、未達成週は1つまで許容・2連続で停止（救済。dailyと同じ流儀）
  let streak = weekAchieved ? 1 : 0;
  let prevWasMiss = false;
  for (let k = 1; k < 520; k++) {
    if (weekAchievedAt(k)) {
      streak++;
      prevWasMiss = false;
    } else {
      if (prevWasMiss) break;
      prevWasMiss = true;
    }
  }

  // おやすみ: 前週が未達成（＝救済使用中）で、今週まだ未達成
  const resting = streak > 0 && !weekAchieved && !weekAchievedAt(1);
  const restDaysLeft = resting ? diffDays(today, addDays(weekStart, 6)) + 1 : null;

  return {
    streak,
    streakUnit: "週",
    resting,
    restDaysLeft,
    weekDone,
    weekTarget: n,
    weekAchieved,
    nextLabel: null,
    fourWeekRate: fourWeekRate(doneSet, today, n * 4),
  };
}
