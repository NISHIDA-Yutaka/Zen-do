import "server-only";

// タスクをベイビーステップに分解する（テスト機能）。Google の Generative Language API を
// サーバ側から叩く。APIキー（GEMINI_API_KEY）はクライアントに出さない。無料枠の flash 系を使う。
const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type BreakdownContext = {
  title: string;
  notes: string;
  projectTitle?: string | null;
  projectNotes?: string | null;
  tags?: string[];
  dueDate?: string | null;
};

function buildPrompt(ctx: BreakdownContext): string {
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

// 文脈（タイトル・メモ・プロジェクト・タグ・期日）からステップ配列を返す。失敗時は throw。
export async function breakdownTask(ctx: BreakdownContext): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です");

  const res = await fetch(`${ENDPOINT}?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(ctx) }] }],
      generationConfig: {
        temperature: 0.4,
        // JSON配列で受け取り、パースを安定させる
        responseMimeType: "application/json",
        responseSchema: { type: "ARRAY", items: { type: "STRING" } },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API エラー (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini から有効な応答が得られませんでした");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini の応答をJSONとして解釈できませんでした");
  }
  if (!Array.isArray(parsed)) throw new Error("Gemini の応答が配列ではありません");

  return parsed
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
