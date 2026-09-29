// LINEのテキストを Gemini＋ツールで処理する（docs/line-plan.md 10章）。
// 失敗しても捕捉登録には戻さない（誤登録が一番困る）。返す文面はそのまま reply に使う。
import "server-only";
import { nowHmInJst, todayInJst } from "@/lib/date";
import { db } from "@/lib/db";
import {
  addUsage,
  type GeminiContent,
  type GeminiUsage,
  generateWithTools,
  logGemini,
} from "@/lib/gemini";
import {
  buildChatSystemPrompt,
  type ChatMessage,
  type FunctionCall,
  functionCallsOf,
  functionResponses,
  recentHistory,
  textOf,
  toContents,
  toFunctionDeclarations,
} from "@/lib/line/chat-core";
import { isRestDay } from "@/lib/line/schedule";
import { TOOLS } from "@/lib/mcp/tools";

/** reply トークンは受信から1分。返信・保存の分を残してここまでに Gemini を終える */
const TIME_BUDGET_MS = 50_000;
/** 1回の呼び出しの上限（定時報告と同じ） */
const CALL_TIMEOUT_MS = 25_000;
/** これより残りが少なければ呼ばずに打ち切る（呼んでも間に合わない） */
const MIN_CALL_MS = 3_000;
/** ツールのやり取りの上限。超えたらツールを使わせずに文章で答えさせる */
const MAX_TOOL_ROUNDS = 3;
/** LINEのテキストメッセージの上限は5000字 */
const REPLY_MAX = 4000;

export const FAILED_REPLY = "うまく処理できませんでした。少し時間をおいてもう一度送ってください。";
export const TIMEOUT_REPLY = "時間がかかってしまいました。もう一度送ってください。";

const DECLARATIONS = toFunctionDeclarations(TOOLS);

class OutOfTimeError extends Error {}

async function loadHistory(userId: string, now: Date): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from("line_messages")
    .select("role, text, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return recentHistory((data ?? []) as ChatMessage[], now);
}

async function saveTurn(userId: string, userText: string, reply: string): Promise<void> {
  const { error } = await db.from("line_messages").insert([
    { user_id: userId, role: "user", text: userText },
    { user_id: userId, role: "assistant", text: reply },
  ]);
  // 保存に失敗しても返事は届ける（次の発言で文脈が1つ欠けるだけ）
  if (error) console.warn("[line] 会話の保存に失敗:", error.message);
}

type ToolLog = { name: string; args: unknown; error?: string };

// ツールの失敗（引数の不備・取り違え防止での拒否など）は Gemini に結果として返し、
// 聞き返しや言い直しを Gemini に任せる。会話全体は止めない
async function runTool(call: FunctionCall): Promise<{ result: unknown; log: ToolLog }> {
  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    const error = `不明なツールです: ${call.name}`;
    return { result: { error }, log: { name: call.name, args: call.args, error } };
  }
  try {
    const result = await tool.run(call.args);
    const failed =
      typeof result === "object" && result !== null && "error" in result
        ? String((result as { error: unknown }).error)
        : undefined;
    return { result, log: { name: call.name, args: call.args, ...(failed ? { error: failed } : {}) } };
  } catch (err) {
    const error = (err as Error).message;
    return { result: { error }, log: { name: call.name, args: call.args, error } };
  }
}

/**
 * 1発言ぶんの処理。Gemini がツールを呼ぶ→結果を返す、を最大3往復してから文章を受け取る。
 * startedAt は LINE がイベントを受けた時刻（reply トークンの期限の起点）
 */
export async function runChat(userId: string, userText: string, startedAt: number): Promise<string> {
  const now = new Date();
  const today = todayInJst(now);
  const system = buildChatSystemPrompt({ today, nowHm: nowHmInJst(now), restDay: isRestDay(today) });
  const toolLogs: ToolLog[] = [];
  let usage: GeminiUsage | null = null;

  try {
    const contents: GeminiContent[] = toContents(await loadHistory(userId, now), userText);
    let reply = "";
    for (let round = 0; ; round++) {
      const remaining = startedAt + TIME_BUDGET_MS - Date.now();
      if (remaining < MIN_CALL_MS) throw new OutOfTimeError("時間切れ");
      const res = await generateWithTools({
        systemInstruction: system,
        contents,
        tools: DECLARATIONS,
        toolMode: round >= MAX_TOOL_ROUNDS ? "NONE" : "AUTO",
        temperature: 0.7,
        timeoutMs: Math.min(CALL_TIMEOUT_MS, remaining),
      });
      usage = addUsage(usage, res.usage);
      // 応答は加工せずに積む（thoughtSignature を次の要求へ返すため。docs/line-plan.md 10.3）
      contents.push({ role: "model", parts: res.parts });

      const calls = functionCallsOf(res.parts);
      if (calls.length === 0) {
        reply = textOf(res.parts);
        break;
      }
      // 書き込みの順序を保つため、同時に呼ばれても1つずつ実行する
      const results: { call: FunctionCall; result: unknown }[] = [];
      for (const call of calls) {
        const { result, log } = await runTool(call);
        toolLogs.push(log);
        results.push({ call, result });
      }
      contents.push(functionResponses(results));
    }

    if (!reply) throw new Error("Gemini の返事が空でした");
    const clipped = reply.length > REPLY_MAX ? `${reply.slice(0, REPLY_MAX - 1)}…` : reply;
    await logGemini({
      kind: "chat",
      ok: true,
      latency_ms: Date.now() - startedAt,
      output: { tool_calls: toolLogs, reply: clipped },
      usage,
    });
    await saveTurn(userId, userText, clipped);
    return clipped;
  } catch (err) {
    const timedOut = err instanceof OutOfTimeError || (err as Error).name === "TimeoutError";
    console.warn("[line] 会話の処理に失敗:", err);
    await logGemini({
      kind: "chat",
      ok: false,
      latency_ms: Date.now() - startedAt,
      output: { tool_calls: toolLogs },
      usage,
      error: (err as Error).message,
    });
    return timedOut ? TIMEOUT_REPLY : FAILED_REPLY;
  }
}
