// 定時配信の文面（docs/line-plan.md 2章）。
// 方針: 責めない・命令しない。完了があれば先に触れる。件数で圧をかけない。
// フェーズ4でGeminiに生成させる時も、この関数の入出力（DigestInput -> string|null）は保つ。
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
  inboxCount: number;
};

/** 名前を出す上限。これを超えたら「ほかn件」にまとめる */
const NAME_LIMIT = 3;

function hm(time: string): string {
  return time.slice(0, 5);
}

/** 期限時刻を過ぎた、または期日が今日より前のもの */
export function overdueOf(todos: Item[], today: string, nowHm: string): Item[] {
  return todos.filter((t) => {
    if (t.due_date && t.due_date < today) return true;
    return t.due_time ? hm(t.due_time) < nowHm : false;
  });
}

function bullet(item: Item): string {
  return item.due_time ? `・${hm(item.due_time)} ${item.title}` : `・${item.title}`;
}

/** 箇条書き。多すぎる時は件数にまとめて圧をかけない */
function listOf(items: Item[]): string[] {
  const shown = items.slice(0, NAME_LIMIT).map(bullet);
  if (items.length > NAME_LIMIT) shown.push(`・ほか${items.length - NAME_LIMIT}件`);
  return shown;
}

function joinLines(lines: (string | null)[]): string {
  return lines.filter((l): l is string => l !== null && l !== "").join("\n");
}

function morning(input: DigestInput): string | null {
  const { todos, habitCandidates } = input;
  if (todos.length === 0 && habitCandidates.length === 0) return null;

  const overdue = overdueOf(todos, input.today, input.nowHm);
  const habits = habitCandidates.slice(0, NAME_LIMIT).map((h) => h.title);
  return joinLines([
    "おはようございます。",
    todos.length > 0 ? `今日は${todos.length}件あります。` : "今日のタスクはありません。",
    ...listOf(todos),
    overdue.length > 0 ? `うち${overdue.length}件は期限を過ぎています。急がなくて大丈夫です。` : null,
    habitCandidates.length > 0 ? `習慣も待ってます（${habits.join("、")}）。` : null,
    "いい一日になりますように。",
  ]);
}

function nudge(input: DigestInput): string | null {
  const { todos, done } = input;
  const overdue = overdueOf(todos, input.today, input.nowHm);
  // 過ぎたものも残りも無ければ、わざわざ声をかけない
  if (overdue.length === 0 && todos.length === 0) return null;

  const praise = done.length > 0 ? `今日はもう${done.length}件片付いてますね。` : null;
  if (overdue.length === 0) {
    return joinLines([praise, `残りは${todos.length}件です。無理のない範囲で。`]);
  }
  return joinLines([
    praise,
    `時間を過ぎたものが${overdue.length}件あります。`,
    ...listOf(overdue),
    "もう終わっていたらアプリで完了にしてください。あとに回しても大丈夫です。",
  ]);
}

function night(input: DigestInput): string | null {
  const { todos, done, inboxCount } = input;
  if (todos.length === 0 && done.length === 0) return null;

  const praise = done.length > 0 ? `お疲れさまでした。今日は${done.length}件完了です。` : "お疲れさまでした。";
  if (todos.length === 0) {
    return joinLines([praise, "今日の分は全部片付きました。ゆっくり休んでください。"]);
  }
  return joinLines([
    praise,
    `残りは${todos.length}件です。`,
    ...listOf(todos),
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
