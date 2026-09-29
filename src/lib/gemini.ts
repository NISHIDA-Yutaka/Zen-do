import "server-only";
import { db } from "@/lib/db";

// Google の Generative Language API をサーバ側から叩く。APIキー（GEMINI_API_KEY）はクライアントに出さない。
// 有料枠の flash 系を使う。呼び出しはすべて gemini_logs に残す（docs/gemini-digest-plan.md 5章）。
const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// digest_preview は送らない試し出し。直近に選んだタスクの判定（kind='digest'）に混ぜないため分ける
export type GeminiKind = "breakdown" | "digest" | "digest_preview" | "chat";

/** usageMetadata そのまま（promptTokenCount / candidatesTokenCount / thoughtsTokenCount など） */
export type GeminiUsage = Record<string, number>;

type LogRow = {
  kind: GeminiKind;
  ok: boolean;
  latency_ms: number;
  output?: unknown;
  error?: string;
  usage?: GeminiUsage | null;
};

// 記録の失敗で本来の処理（分解・定時報告・会話）を止めない
export async function logGemini(row: LogRow): Promise<void> {
  const { error } = await db.from("gemini_logs").insert(row);
  if (error) console.warn("[gemini] 呼び出しの記録に失敗:", error.message);
}

// usageMetadata には数値のほかに serviceTier（文字列）や内訳（配列）も混ざる。
// 足し合わせると文字列が連結されて壊れるので、トークン数（数値）だけを残す
function numericUsage(raw: unknown): GeminiUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const nums = Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === "number");
  return nums.length > 0 ? Object.fromEntries(nums) : null;
}

/** 複数回呼んだ分のトークン数を足し合わせる（会話は1発言で数回呼ぶため） */
export function addUsage(a: GeminiUsage | null, b: GeminiUsage | null): GeminiUsage | null {
  if (!a) return b;
  if (!b) return a;
  const sum: GeminiUsage = { ...a };
  for (const [k, v] of Object.entries(b)) sum[k] = (sum[k] ?? 0) + v;
  return sum;
}

class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Gemini API エラー (${status}): ${detail.slice(0, 200)}`);
  }
}

// 503（混雑）は一時的で、実測でも数秒後の呼び出しは通った。429（枠切れ）等はやり直しても無駄なので対象外
function isTransient(err: unknown): boolean {
  return err instanceof GeminiHttpError && (err.status === 500 || err.status === 503);
}

/** 応答の parts は加工せずに扱う（関数呼び出しの thoughtSignature を次の要求へそのまま返す必要があるため） */
export type GeminiPart = Record<string, unknown>;
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

async function post(body: object, timeoutMs: number): Promise<{ parts: GeminiPart[]; usage: GeminiUsage | null }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です");

  const res = await fetch(`${ENDPOINT}?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiHttpError(res.status, detail);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
    usageMetadata?: unknown;
  };
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) throw new Error("Gemini から有効な応答が得られませんでした");
  return { parts, usage: numericUsage(data.usageMetadata) };
}

async function postWithRetry(body: object, timeoutMs: number) {
  return post(body, timeoutMs).catch((err: unknown) => {
    if (isTransient(err)) return post(body, timeoutMs);
    throw err;
  });
}

/**
 * JSONで答えさせて返す。失敗時は記録してから throw。
 * toLog は成功時に残す形（参照名を実IDに引き直した後の値など、後から読んで意味の通る形にするため）
 */
export async function generateJson(opts: {
  kind: GeminiKind;
  prompt: string;
  schema: object;
  temperature: number;
  timeoutMs?: number;
  toLog?: (value: unknown) => unknown;
}): Promise<unknown> {
  const started = Date.now();
  try {
    const { parts, usage } = await postWithRetry(
      {
        contents: [{ parts: [{ text: opts.prompt }] }],
        // JSONで受け取り、パースを安定させる
        generationConfig: {
          temperature: opts.temperature,
          responseMimeType: "application/json",
          responseSchema: opts.schema,
        },
      },
      opts.timeoutMs ?? 30_000,
    );
    const text = parts.find((p) => typeof p.text === "string" && !p.thought)?.text;
    if (typeof text !== "string") throw new Error("Gemini から有効な応答が得られませんでした");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Gemini の応答をJSONとして解釈できませんでした");
    }
    await logGemini({
      kind: opts.kind,
      ok: true,
      latency_ms: Date.now() - started,
      output: opts.toLog ? opts.toLog(value) : value,
      usage,
    });
    return value;
  } catch (err) {
    await logGemini({
      kind: opts.kind,
      ok: false,
      latency_ms: Date.now() - started,
      error: (err as Error).message,
    });
    throw err;
  }
}

export type FunctionDeclaration = { name: string; description: string; parametersJsonSchema: object };

/**
 * ツール付きで1回呼ぶ（記録は呼び出し側が会話1往復ぶんまとめて行う）。
 * toolMode "NONE" は「もうツールを使わず文章で答えて」の合図（往復の上限に達した時）
 */
export function generateWithTools(opts: {
  systemInstruction: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
  toolMode: "AUTO" | "NONE";
  temperature: number;
  timeoutMs: number;
}): Promise<{ parts: GeminiPart[]; usage: GeminiUsage | null }> {
  return postWithRetry(
    {
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: opts.contents,
      tools: [{ functionDeclarations: opts.tools }],
      toolConfig: { functionCallingConfig: { mode: opts.toolMode } },
      // 会話の返事は定時報告ほど考え込まなくてよい。思考を抑えて速さと費用を取る（docs/line-plan.md 10.0-5）
      generationConfig: { temperature: opts.temperature, thinkingConfig: { thinkingLevel: "low" } },
    },
    opts.timeoutMs,
  );
}

export type BreakdownContext = {
  title: string;
  notes: string;
  projectTitle?: string | null;
  projectNotes?: string | null;
  tags?: string[];
  dueDate?: string | null;
};

function buildBreakdownPrompt(ctx: BreakdownContext): string {
  const lines = [
    "あなたはADHDのユーザーのタスク管理を助けるアシスタントです。",
    "次のタスクを、着手のハードルが下がる具体的で小さな「ベイビーステップ」に分解してください。",
    "制約:",
    "- 各ステップは1つの小さな行動だけ（目安5〜15分で終わる粒度）",
    "- 具体的な動詞で始める（例:「〜を開く」「〜に電話する」「〜を1つ書き出す」）",
    "- 3〜6個程度。多すぎない。抽象的な言い換えや自明な確認は入れない",
    "- 与えた文脈（プロジェクト・メモ・タグ・期日）を必ず考慮する",
    "- ユーザーと同じ言語で書く",
    "",
    "# 文脈",
    `タスク: ${ctx.title}`,
    `メモ: ${ctx.notes.trim() || "（なし）"}`,
  ];
  if (ctx.projectTitle) {
    lines.push(`所属プロジェクト: ${ctx.projectTitle}`);
    if (ctx.projectNotes?.trim()) lines.push(`プロジェクトのメモ: ${ctx.projectNotes.trim()}`);
  }
  if (ctx.tags && ctx.tags.length > 0) lines.push(`タグ: ${ctx.tags.join(", ")}`);
  if (ctx.dueDate) lines.push(`期日: ${ctx.dueDate}`);
  return lines.join("\n");
}

// タスクをベイビーステップに分解する。文脈（タイトル・メモ・プロジェクト・タグ・期日）からステップ配列を返す。失敗時は throw。
export async function breakdownTask(ctx: BreakdownContext): Promise<string[]> {
  const parsed = await generateJson({
    kind: "breakdown",
    prompt: buildBreakdownPrompt(ctx),
    schema: { type: "ARRAY", items: { type: "STRING" } },
    temperature: 0.4,
  });
  if (!Array.isArray(parsed)) throw new Error("Gemini の応答が配列ではありません");

  return parsed
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
