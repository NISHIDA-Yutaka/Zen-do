// LINEの会話の純粋な部分（docs/line-plan.md 10章）。履歴の切り出し、Gemini への要求の組み立て、
// 応答からの関数呼び出し・文章の取り出し、ツール定義の変換。DBにもAPIにも触らないのでテストする。
import { z } from "zod";
import { CHARACTER, RELATION } from "@/lib/line/persona";

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; text: string; created_at: string };

/** これ以上空いたら新しい話題とみなす */
export const HISTORY_GAP_MIN = 30;
/** 渡す履歴の上限（10往復） */
export const HISTORY_MAX_MESSAGES = 20;

type Part = Record<string, unknown>;
export type ChatContent = { role: "user" | "model"; parts: Part[] };

/**
 * 新しい順に並んだ履歴から、今の会話の続きとして渡す分を古い順で返す。
 * 最新の発言から30分以上たっている、または発言どうしが30分以上空いた所で打ち切る
 */
export function recentHistory(newestFirst: ChatMessage[], now: Date): ChatMessage[] {
  const gapMs = HISTORY_GAP_MIN * 60_000;
  const picked: ChatMessage[] = [];
  let later = now.getTime();
  for (const m of newestFirst.slice(0, HISTORY_MAX_MESSAGES)) {
    const t = new Date(m.created_at).getTime();
    if (later - t > gapMs) break;
    picked.push(m);
    later = t;
  }
  const oldestFirst = picked.reverse();
  // Gemini には本人の発言から始まる形で渡す（返事から始まると誰への返事か分からないため）
  const firstUser = oldestFirst.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : oldestFirst.slice(firstUser);
}

export function toContents(history: ChatMessage[], userText: string): ChatContent[] {
  return [
    ...history.map(
      (m): ChatContent => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }),
    ),
    { role: "user", parts: [{ text: userText }] },
  ];
}

export type FunctionCall = { name: string; args: unknown; id?: string };

export function functionCallsOf(parts: Part[]): FunctionCall[] {
  return parts.flatMap((p) => {
    const fc = p.functionCall;
    if (typeof fc !== "object" || fc === null) return [];
    const { name, args, id } = fc as { name?: unknown; args?: unknown; id?: unknown };
    if (typeof name !== "string") return [];
    return [{ name, args: args ?? {}, ...(typeof id === "string" ? { id } : {}) }];
  });
}

/** 関数呼び出しの結果を、呼び出しと同じ順で1つの user 発言にまとめる（id があれば返す） */
export function functionResponses(results: { call: FunctionCall; result: unknown }[]): ChatContent {
  return {
    role: "user",
    parts: results.map(({ call, result }) => ({
      functionResponse: { name: call.name, response: { result }, ...(call.id ? { id: call.id } : {}) },
    })),
  };
}

/** 返事の文章。思考の要約（thought）は除く */
export function textOf(parts: Part[]): string {
  return parts
    .filter((p) => typeof p.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("")
    .trim();
}

export type DeclarableTool = { name: string; description: string; inputSchema: z.ZodObject };

/** MCP と同じツール定義（zod）を Gemini の関数宣言に変換する（docs/line-plan.md 10.3） */
export function toFunctionDeclarations(tools: DeclarableTool[]) {
  return tools.map((t) => {
    const schema = { ...(z.toJSONSchema(t.inputSchema) as Record<string, unknown>) };
    // $schema は JSON Schema の版の宣言で、Gemini には不要
    delete schema.$schema;
    return { name: t.name, description: t.description, parametersJsonSchema: schema };
  });
}

const WEEKDAYS = "日月火水木金土";

export function buildChatSystemPrompt(now: { today: string; nowHm: string; restDay: boolean }): string {
  const [y, m, d] = now.today.split("-").map(Number);
  const youbi = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return [
    "あなたはタスク管理アプリ「Zendo」の相棒として、LINEで本人とやり取りします。",
    RELATION,
    "",
    CHARACTER,
    "",
    "# 返事",
    "- 1〜3文で短く。挨拶から始めない",
    "- Markdownの記号（** や # など）は使わない（LINEでは記号のまま表示されるため）",
    "",
    "# 判断",
    // 試しで、直前の質問（履歴）にもう一度答え直してから本題に入った
    "- 答えるのは最後の発言だけ。それより前のやり取りは文脈として読むだけで、もう一度答え直さない",
    "- 発言の意図を読み取り、必要ならツールで調べたり操作したりする。タスクの有無・状態・期日は必ずツールで確かめ、推測で答えない",
    // 以前のLINEは「やること＋日時」をそのまま登録していた。その使い方で毎回確認されると手間が増える
    "- やることと日時だけを書いた短い発言、または登録を頼む発言は、タスクの登録として確認せずに create_task する",
    "- タスクの登録・完了・期日の変更・メモの更新をしたら、何をしたかをタスク名つきで返事に書く。期日を変えた時は元の期日も書く（取り消しに備えるため）",
    "- 対象の候補が複数ある、登録してほしいのか話しかけているだけなのか分からない、といった時は操作せずに聞き返す",
    "- 「取り消して」と言われたら、直前に行った操作を元に戻す",
    "- 削除・破棄はできない。頼まれたらアプリから行うよう伝える",
    "- 日付は下の「今」を基準に YYYY-MM-DD に直してツールに渡す",
    "",
    "# 今",
    `${now.today}（${youbi}・${now.restDay ? "休日" : "平日"}） ${now.nowHm}`,
  ].join("\n");
}
