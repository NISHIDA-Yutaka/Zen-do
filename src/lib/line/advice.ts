// 定時報告の Gemini 部分（docs/gemini-digest-plan.md 2章）。プロンプトの組み立てと、応答の検証・引き直し。
// DBにもAPIにも触らない純粋な処理にしてテストする。呼び出しは advice-source.ts。
import { diffDays, todayInJst } from "@/lib/date";
import { formatDuration, PRIORITY_MEANING } from "@/lib/format";
import type { HabitAlert } from "@/lib/habit-alerts";
import { habitAlertLines, overdueOf } from "@/lib/line/messages";
import type { Slot } from "@/lib/line/schedule";
import type { Item } from "@/lib/types";

export type AdviceCandidate = {
  item: Item;
  place: "today" | "inbox";
  openChildren: number;
  /** 直近の便で②に選んだもの（続けて同じものを選ばせないため） */
  recentlyPicked: boolean;
};

export type AdviceContext = {
  slot: Slot;
  restDay: boolean;
  today: string;
  nowHm: string;
  candidates: AdviceCandidate[];
  /** 今日の未完了（期限切れ込み・習慣や繰り返しも含む）。残りの重さを気にかける材料 */
  todos: Item[];
  done: Item[];
  habitAlerts: HabitAlert[];
};

export type FocusNext = "hearing" | "breakdown";

export type Advice = {
  greeting: string;
  focus: { item: Item; reason: string; next: FocusNext } | null;
};

/** メモは充実度の判断に使うので渡すが、長いものは頭だけで足りる */
export const NOTE_LIMIT = 500;
/** 候補が多すぎるとプロンプトが膨らむ。Today→Inboxの順に並べた頭から */
export const CANDIDATE_LIMIT = 40;
// 表示側の上限。指示で短くさせているが、守られなかった時にFlexやaltTextを溢れさせない
const GREETING_MAX = 300;
const REASON_MAX = 150;

export const ADVICE_SCHEMA = {
  type: "OBJECT",
  properties: {
    greeting: { type: "STRING" },
    focus: {
      type: "OBJECT",
      nullable: true,
      properties: {
        ref: { type: "STRING" },
        reason: { type: "STRING" },
        next: { type: "STRING", enum: ["hearing", "breakdown"] },
      },
      required: ["ref", "reason", "next"],
    },
  },
  required: ["greeting"],
  propertyOrdering: ["greeting", "focus"],
};

const SLOT_NAME: Record<Slot, string> = {
  morning: "朝",
  noon: "昼",
  evening: "夕方",
  night: "深夜（1日の締め）",
};

const PERSONA = [
  "あなたはタスク管理アプリ「Zendo」の相棒として、LINEで定時の声かけをします。",
  "相手はADHDの当事者です。あなたは先生でも上司でもなく、隣で一緒にタスクを回している対等な友人です。",
  "",
  "# キャラクター",
  "- 20〜30代の女性。です・ます調で、落ち着いた柔らかい話し方。明るさは保つが、はしゃがない",
  "- 言葉を丁寧に選ぶ。ありきたりな褒め言葉や誇張（「すごすぎる」「天才」「神」など）は使わない",
  "- 絵文字は気持ちが伝わるように自由に使ってよい",
  // 語尾の具体例を書くと毎回その語尾で終わる（試し出しで理由が全部「〜してみませんか？」になった）
  "- 上から指示せず、誘う形で話す。語尾や言い回しは毎回変える",
].join("\n");

const TASKS = [
  "# やること",
  "JSONで greeting と focus を返す。",
  "",
  "## greeting（この便の声かけ。2〜4文、150字程度まで）",
  "- 挨拶（おはようございます・こんにちは・お疲れさまです 等）で始めない。最初の一文から中身を書く（LINEの通知欄には冒頭しか出ないため）",
  "- 今日完了したものがあれば、件数や中身に具体的に触れて労う。褒めるときは事実に即して、過大にならない言葉で",
  "- 完了がまだ無ければ、責めずに気持ちが軽くなる一言にする",
  "- 残っているタスクの件数で圧をかけない。「まだ」「早く」「〜しなきゃ」は使わない",
  // 例文を置くと言い回しも数字もそのまま写される（試し出しで3回とも「2つくらいだけ〜休みませんか」になった）。
  // 意図と判断材料だけを書く
  "- ただし残りの重さは気にかける。夕方・深夜の便で、今日の残り時間に対して未完了や期限切れが多いと判断したら、",
  "  今日は量を絞って休むという選択肢もあることを、本人が選べる問いかけの形で添える。",
  "  いくつに絞るか・どれを残すかは、残り時間・見積もり・重要度から判断する（挙げるなら今日の未完了から）。",
  "  決まった言い回しにせず、その日の状況（完了の中身・残っているものの顔ぶれ・時間帯）に合わせた言葉で書く",
  "- 時間帯に合った言葉にする。深夜は休むことを肯定する",
  "- タスクの一覧はこの後に別途表示されるので、greeting の中で列挙しない",
  "",
  "## focus（候補から「今こそ手をつけ始めたい1件」）",
  "次を総合して選ぶ:",
  "- 重要度が高い（1が最も高い。未設定は判断材料にしない）",
  "- 長く放置されている（放置日数）",
  "- メモが薄い、または何から始めればいいか分からない書き方",
  "- 何度も先送りされている",
  "- 期限が近い、または過ぎている",
  "深夜の便では、今夜のうちに動けないもの（外出・買い物・店や人の都合が要る用事、時刻の過ぎた今日の予定）は選ばない。",
  "どれも順調で特に引っかかる理由が見当たらなければ null にする。無理に選ばない。",
  "「直近に選んだ」印のある候補は、他に良い候補がある限り避ける。",
  "- ref: 候補の参照名（t1 など）をそのまま書く",
  "- reason: なぜこれを選んだか。相手に向けて1〜2文、60字程度まで。キャラクターの口調で。責める言い方にしない",
  "- next: 次の一手",
  "  - hearing: 情報が足りず何から始めるか決まらない（メモが薄い・内容が漠然としている）→ 話を聞いて整理する",
  "  - breakdown: やることは見えているが大きくて手が止まっている → 小さな手順に分ける",
  "    未完了の子タスクが既にあるもの（もう分けてある）には breakdown を選ばない",
  "",
  "候補に無いタスクや、書かれていない事実（締切・事情）を作らない。",
].join("\n");

function staleDays(item: Item, today: string): number {
  return Math.max(0, diffDays(todayInJst(new Date(item.created_at)), today));
}

function dueText(item: Item, today: string): string {
  if (!item.due_date) return "期日なし";
  const [, m, d] = item.due_date.split("-").map(Number);
  const time = item.due_time ? ` ${item.due_time.slice(0, 5)}` : "";
  const late = item.due_date < today ? "（期限切れ）" : "";
  return `${m}/${d}${time}${late}`;
}

function notesText(notes: string): string {
  const t = notes.trim();
  if (!t) return "（なし）";
  return t.length > NOTE_LIMIT ? `${t.slice(0, NOTE_LIMIT)}…（以下略）` : t;
}

function candidateBlock(ref: string, c: AdviceCandidate, today: string): string {
  const { item } = c;
  const lines = [
    `[${ref}] ${item.title}${c.recentlyPicked ? "（直近に選んだ）" : ""}`,
    `  場所: ${c.place === "today" ? `Today（${dueText(item, today)}）` : "Inbox（未仕分け）"}`,
    `  重要度: ${item.priority ? `${item.priority}（${PRIORITY_MEANING[item.priority]}）` : "未設定"}`,
    `  所要時間: ${item.duration_min ? formatDuration(item.duration_min) : "未設定"}`,
    `  先送り: ${item.postponed_count}回 / 放置: ${staleDays(item, today)}日 / 未完了の子タスク: ${c.openChildren}件`,
    `  メモ: ${notesText(item.notes).replace(/\n/g, "\n    ")}`,
  ];
  return lines.join("\n");
}

function minutesUntilMidnight(nowHm: string): number {
  const [h, m] = nowHm.split(":").map(Number);
  return Math.max(0, 24 * 60 - (h * 60 + m));
}

// 残りの重さの判断材料。件数だけでなく、残り時間と見積もり（入っている分だけ）も並べる
function remainingLines(ctx: AdviceContext): string[] {
  const overdue = overdueOf(ctx.todos, ctx.today, ctx.nowHm);
  const estimated = ctx.todos.filter((t) => t.duration_min !== null);
  const total = estimated.reduce((sum, t) => sum + (t.duration_min ?? 0), 0);
  const left = minutesUntilMidnight(ctx.nowHm);
  return [
    `今日の未完了: ${ctx.todos.length}件（うち期限切れ・時刻を過ぎたもの ${overdue.length}件）`,
    ...ctx.todos.map((t) => `・${t.title}${t.due_time ? `（${t.due_time.slice(0, 5)}）` : ""}`),
    estimated.length > 0
      ? `所要時間の見積もり: ${estimated.length}件で合計${formatDuration(total)}（見積もりのない${ctx.todos.length - estimated.length}件は含まない）`
      : "所要時間の見積もり: なし",
    `今日の残り時間（24時まで）: ${left > 0 ? formatDuration(left) : "0分"}`,
  ];
}

function situation(ctx: AdviceContext): string {
  const doneTitles = ctx.done.map((d) => `・${d.title}`);
  const habits = habitAlertLines(ctx.habitAlerts).map((l) => `・${l}`);
  return [
    "# 状況",
    `今: ${ctx.today}（${ctx.restDay ? "休日" : "平日"}）${ctx.nowHm}・${SLOT_NAME[ctx.slot]}の便`,
    ...remainingLines(ctx),
    `今日完了したもの: ${ctx.done.length}件`,
    ...doneTitles,
    habits.length > 0 ? "声をかけたい習慣:" : "声をかけたい習慣: なし",
    ...habits,
  ].join("\n");
}

/** 候補は t1, t2… の参照名で渡す（UUIDの写し間違い・存在しないIDの捏造を避けるため） */
export function buildAdvicePrompt(ctx: AdviceContext): { prompt: string; refs: Map<string, Item> } {
  const refs = new Map<string, Item>();
  const blocks = ctx.candidates.slice(0, CANDIDATE_LIMIT).map((c, i) => {
    const ref = `t${i + 1}`;
    refs.set(ref, c.item);
    return candidateBlock(ref, c, ctx.today);
  });
  const prompt = [
    PERSONA,
    "",
    TASKS,
    "",
    situation(ctx),
    "",
    "# 候補",
    blocks.length > 0 ? blocks.join("\n") : "（なし。focus は null にする）",
  ].join("\n");
  return { prompt, refs };
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 応答を検証して実在のタスクに引き直す。greeting が無ければ全体を失敗（null）にする。
 * focus は参照名が候補に無い・形が崩れている時だけ捨て、greeting は活かす
 */
export function resolveAdvice(raw: unknown, refs: Map<string, Item>): Advice | null {
  if (!isRecord(raw) || typeof raw.greeting !== "string") return null;
  const greeting = raw.greeting.trim();
  if (!greeting) return null;

  const f = raw.focus;
  const item = isRecord(f) && typeof f.ref === "string" ? refs.get(f.ref.trim()) : undefined;
  const valid =
    item &&
    isRecord(f) &&
    typeof f.reason === "string" &&
    f.reason.trim() !== "" &&
    (f.next === "hearing" || f.next === "breakdown");
  return {
    greeting: clip(greeting, GREETING_MAX),
    focus: valid
      ? { item, reason: clip((f.reason as string).trim(), REASON_MAX), next: f.next as FocusNext }
      : null,
  };
}
