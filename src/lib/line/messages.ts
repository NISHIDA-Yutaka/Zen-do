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
  /**
   * 引っかかっているタスクの4択を出さない。Gemini が注目タスクを選んだ便では
   * そちらに統合するため（docs/gemini-digest-plan.md 0章）
   */
  noStuck?: boolean;
};

/** 習慣候補だけは名前を並べすぎないよう抑える（未完了タスクは全件出す） */
const HABIT_NAME_LIMIT = 3;

/**
 * ボタンを付ける上限。本文は全件出すが、ボタンまで全件付けると
 * Flexメッセージの10KB上限を超えて送信ごと弾かれるため、ここで頭打ちにする。
 */
export const BUTTON_LIMIT = 5;

/** 質問ブロックがある便では通常一覧のボタンを減らす（Flexの10KB上限に収めるため） */
const BUTTON_LIMIT_WITH_STUCK = 3;

/** 何回動かされたら「引っかかっている」とみなすか */
export const STUCK_THRESHOLD = 2;

/** 1通で質問する上限。多いと答えるのが億劫になるし、Flexの容量も食う */
export const STUCK_LIMIT = 2;

/**
 * 引っかかっているタスク。先送りが重なった順に少しだけ。
 * 習慣は日ごとに作られるもので「先送り」の概念が合わないため除く。
 */
export function stuckOf(todos: Item[]): Item[] {
  return todos
    .filter((t) => !t.habit_id && t.postponed_count >= STUCK_THRESHOLD)
    .sort((a, b) => b.postponed_count - a.postponed_count)
    .slice(0, STUCK_LIMIT);
}

function askingOf(input: DigestInput): Item[] {
  return input.noStuck ? [] : stuckOf(input.todos);
}

/**
 * 引っかかっているタスクへの問いかけ。
 * 何回動かしたかは出さない（回数を突きつけても行動には繋がらない）。
 */
function stuckLines(stuck: Item[]): string[] {
  if (stuck.length === 0) return [];
  return [
    stuck.length === 1
      ? `「${stuck[0].title}」は何度か先に延びています。`
      : "何度か先に延びているものがあります。",
    ...(stuck.length === 1 ? [] : stuck.map((t) => `・${t.title}`)),
    "何が引っかかっていますか？ 下のボタンで教えてください。",
  ];
}

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
  const stuck = askingOf(input);
  const stuckIds = new Set(stuck.map((t) => t.id));
  // 質問ブロックに出したものは通常の一覧から外す（同じ名前が二度出ないように）
  const rest = todos.filter((t) => !stuckIds.has(t.id));
  const overdue = overdueOf(rest, input.today, input.nowHm);
  const habitLines = habitAlertLines(habitAlerts);
  if (overdue.length === 0 && rest.length === 0 && habitLines.length === 0 && stuck.length === 0) {
    return null;
  }

  const body =
    overdue.length > 0
      ? [
          `時間が来ているものが${overdue.length}件あります。`,
          ...listOf(overdue),
          "もう終わっていたら下のボタンで完了にできます。あとに回しても大丈夫です。",
        ]
      : [rest.length > 0 ? `残りは${rest.length}件です。無理のない範囲で。` : null];

  return joinLines([...stuckLines(stuck), ...body, ...habitLines]);
}

function night(input: DigestInput): string | null {
  const { todos, done, inboxCount, habitAlerts } = input;
  const stuck = askingOf(input);
  const stuckIds = new Set(stuck.map((t) => t.id));
  const rest = todos.filter((t) => !stuckIds.has(t.id));
  const habitLines = habitAlertLines(habitAlerts);
  if (todos.length === 0 && done.length === 0 && habitLines.length === 0) return null;

  if (rest.length === 0 && stuck.length === 0) {
    return joinLines([
      "お疲れさまでした。",
      ...habitLines,
      "今日の分は全部片付きました。ゆっくり休んでください。",
    ]);
  }
  return joinLines([
    "お疲れさまでした。",
    ...stuckLines(stuck),
    rest.length > 0 ? `残りは${rest.length}件です。` : null,
    ...listOf(rest),
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
  /** 引っかかっているタスク（4択で聞く）。催促の枠だけ */
  stuck: Item[];
} {
  const habitAction = input.slot === "night" ? ("hab_done" as const) : ("hab_add" as const);
  const habits = input.habitAlerts.map((a) => ({ habit: a.habit, action: habitAction }));
  const asking = input.slot === "morning" ? [] : askingOf(input);
  const askingIds = new Set(asking.map((t) => t.id));
  const rest = input.todos.filter((t) => !askingIds.has(t.id));
  // 注目タスク（noStuck）の便も4択と同じくブロックが1つ増えるので、同じ上限に抑える
  const limit = asking.length > 0 || input.noStuck ? BUTTON_LIMIT_WITH_STUCK : BUTTON_LIMIT;
  switch (input.slot) {
    case "morning":
      return {
        tasks: rest.slice(0, limit),
        global: input.habitCandidates.length > 0 ? "habits" : null,
        habits,
        stuck: asking,
      };
    case "noon":
    case "evening":
      return {
        tasks: overdueOf(rest, input.today, input.nowHm).slice(0, limit),
        global: null,
        habits,
        stuck: asking,
      };
    case "night":
      return {
        tasks: rest.slice(0, limit),
        global: input.todos.length > 0 ? "alltmr" : null,
        habits,
        stuck: asking,
      };
  }
}
