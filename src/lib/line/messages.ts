// 定時配信の文面（docs/line-plan.md 2章）。
// 方針: 責めない・命令しない。完了があれば先に触れる。件数で圧をかけない。
// フェーズ4でGeminiに生成させる時も、この関数の入出力（DigestInput -> string|null）は保つ。
import type { HabitAlert } from "@/lib/habit-alerts";
import type { Slot } from "@/lib/line/schedule";
import type { Habit, Item } from "@/lib/types";

export type DigestInput = {
  slot: Slot;
  today: string;
  /** 現在時刻 'HH:MM'（期限時刻を過ぎたかの判定に使う） */
  nowHm: string;
  todos: Item[];
  done: Item[];
  habitCandidates: Habit[];
  habitAlerts: HabitAlert[];
  inboxCount: number;
};

/** 習慣候補だけは名前を並べすぎないよう抑える（未完了タスクは全件出す） */
const HABIT_NAME_LIMIT = 3;

/**
 * ボタンを付ける上限。本文は全件出すが、ボタンまで全件付けると
 * Flexメッセージの10KB上限を超えて送信ごと弾かれるため、ここで頭打ちにする。
 */
export const BUTTON_LIMIT = 5;

function hm(time: string): string {
  return time.slice(0, 5);
}

/**
 * 期限の時刻が来ている、または期日が今日より前のもの。
 * 同時刻ちょうどを含める（<= にする）のは、19:00の便が19:00のタスクを落としていたため。
 * cronは毎時ちょうどに届くので、厳密な不等号だと境界のタスクが必ず漏れる。
 */
export function overdueOf(todos: Item[], today: string, nowHm: string): Item[] {
  return todos.filter((t) => {
    if (t.due_date && t.due_date < today) return true;
    return t.due_time ? hm(t.due_time) <= nowHm : false;
  });
}

function bullet(item: Item): string {
  return item.due_time ? `・${hm(item.due_time)} ${item.title}` : `・${item.title}`;
}

/** 未完了は省略せず全部並べる（何が残っているか分からないと動けないため） */
function listOf(items: Item[]): string[] {
  return items.map(bullet);
}

function joinLines(lines: (string | null)[]): string {
  return lines.filter((l): l is string => l !== null && l !== "").join("\n");
}

/**
 * 習慣の催促。事実だけを言い、できるかどうかの判断は本人に返す。
 * 「途切れます」は救済を使い切っている時だけ書く（週n回は1週落としても即切れではないため）。
 */
export function habitAlertLines(alerts: HabitAlert[]): string[] {
  return alerts.map((a) => {
    const period = a.habit.frequency_rule.type === "times_per_month" ? "今月" : "今週";
    if (a.habit.frequency_rule.type === "daily" || a.habit.frequency_rule.type === "every_n_days") {
      return a.daysLeft <= 1
        ? `${a.habit.title}、今日やれば途切れません。`
        : `${a.habit.title}、あと${a.daysLeft}日以内にやれば途切れません。`;
    }
    const head = `${a.habit.title}、${period}あと${a.remaining}回。残り${a.daysLeft}日です。`;
    // 届かない時に「切れます」と畳みかけない。次に繋がる行動を示す
    if (a.remaining > a.daysLeft) return `${head}${period}の目標には届きませんが、1回でもやれば次に繋がります。`;
    const room =
      a.remaining === a.daysLeft ? "残り全部の日でやれば届きます。" : "余裕は1日だけです。";
    return a.breaksStreak ? `${head}${room}ここで落とすと連続が切れます。` : `${head}${room}`;
  });
}

function morning(input: DigestInput): string | null {
  const { todos, habitCandidates, habitAlerts } = input;
  if (todos.length === 0 && habitCandidates.length === 0 && habitAlerts.length === 0) return null;

  const overdue = overdueOf(todos, input.today, input.nowHm);
  const habits = habitCandidates.slice(0, HABIT_NAME_LIMIT).map((h) => h.title);
  return joinLines([
    "おはようございます。",
    todos.length > 0 ? `今日は${todos.length}件あります。` : "今日のタスクはありません。",
    ...listOf(todos),
    overdue.length > 0 ? `うち${overdue.length}件は期限を過ぎています。急がなくて大丈夫です。` : null,
    habitCandidates.length > 0 ? `習慣も待ってます（${habits.join("、")}）。` : null,
    ...habitAlertLines(habitAlerts),
    "いい一日になりますように。",
  ]);
}

function nudge(input: DigestInput): string | null {
  const { todos, habitAlerts } = input;
  const overdue = overdueOf(todos, input.today, input.nowHm);
  const habitLines = habitAlertLines(habitAlerts);
  // 過ぎたものも残りも習慣の催促も無ければ、わざわざ声をかけない
  if (overdue.length === 0 && todos.length === 0 && habitLines.length === 0) return null;

  if (overdue.length === 0) {
    const head = todos.length > 0 ? `残りは${todos.length}件です。無理のない範囲で。` : null;
    return joinLines([head, ...habitLines]);
  }
  return joinLines([
    `時間が来ているものが${overdue.length}件あります。`,
    ...listOf(overdue),
    "もう終わっていたら下のボタンで完了にできます。あとに回しても大丈夫です。",
    ...habitLines,
  ]);
}

function night(input: DigestInput): string | null {
  const { todos, done, inboxCount, habitAlerts } = input;
  const habitLines = habitAlertLines(habitAlerts);
  if (todos.length === 0 && done.length === 0 && habitLines.length === 0) return null;

  if (todos.length === 0) {
    return joinLines([
      "お疲れさまでした。",
      ...habitLines,
      "今日の分は全部片付きました。ゆっくり休んでください。",
    ]);
  }
  return joinLines([
    "お疲れさまでした。",
    `残りは${todos.length}件です。`,
    ...listOf(todos),
    ...habitLines,
    inboxCount >= 5 ? `Inboxに${inboxCount}件たまっています。手が空いた時に仕分けましょう。` : null,
    "明日に回しても大丈夫。ゆっくり休んでください。",
  ]);
}

/** 送る文面。言うことが無い枠は null（＝送らない＝無料枠を使わない） */
export function buildDigest(input: DigestInput): string | null {
  switch (input.slot) {
    case "morning":
      return morning(input);
    case "noon":
    case "evening":
      return nudge(input);
    case "night":
      return night(input);
  }
}

/** その枠で全体に効くボタン（1つだけ） */
export type GlobalAction = "alltmr" | "habits" | null;

/**
 * 文面に添えるボタンの対象。本文に出したものの先頭からBUTTON_LIMIT件。
 * 本文に無いタスクは対象にしない（見えていないものを操作させない）。
 */
export function digestActions(input: DigestInput): {
  tasks: Item[];
  global: GlobalAction;
  /** 習慣のボタン。深夜は「やった」まで済ませる（23時に追加だけでは意味がない） */
  habits: { habit: Habit; action: "hab_add" | "hab_done" }[];
} {
  const habitAction = input.slot === "night" ? ("hab_done" as const) : ("hab_add" as const);
  const habits = input.habitAlerts.map((a) => ({ habit: a.habit, action: habitAction }));
  switch (input.slot) {
    case "morning":
      return {
        tasks: input.todos.slice(0, BUTTON_LIMIT),
        global: input.habitCandidates.length > 0 ? "habits" : null,
        habits,
      };
    case "noon":
    case "evening":
      return {
        tasks: overdueOf(input.todos, input.today, input.nowHm).slice(0, BUTTON_LIMIT),
        global: null,
        habits,
      };
    case "night":
      return {
        tasks: input.todos.slice(0, BUTTON_LIMIT),
        global: input.todos.length > 0 ? "alltmr" : null,
        habits,
      };
  }
}
