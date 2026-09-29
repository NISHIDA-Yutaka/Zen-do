import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildChatSystemPrompt,
  type ChatMessage,
  functionCallsOf,
  functionResponses,
  HISTORY_MAX_MESSAGES,
  recentHistory,
  textOf,
  toContents,
  toFunctionDeclarations,
} from "@/lib/line/chat-core";

const NOW = new Date("2026-09-29T10:00:00Z");

// NOW から min 分前の発言
function msg(role: ChatMessage["role"], text: string, min: number): ChatMessage {
  return { role, text, created_at: new Date(NOW.getTime() - min * 60_000).toISOString() };
}

describe("recentHistory", () => {
  it("新しい順の履歴を古い順にして返す", () => {
    const rows = [msg("assistant", "返事", 1), msg("user", "質問", 2)];
    expect(recentHistory(rows, NOW).map((m) => m.text)).toEqual(["質問", "返事"]);
  });

  it("最新の発言から30分以上たっていれば、新しい話題として何も渡さない", () => {
    expect(recentHistory([msg("assistant", "返事", 31), msg("user", "質問", 32)], NOW)).toEqual([]);
  });

  it("途中で30分以上空いた所より前は渡さない", () => {
    const rows = [
      msg("assistant", "今の返事", 1),
      msg("user", "今の質問", 2),
      msg("assistant", "昔の返事", 40),
      msg("user", "昔の質問", 41),
    ];
    expect(recentHistory(rows, NOW).map((m) => m.text)).toEqual(["今の質問", "今の返事"]);
  });

  it("上限（10往復）を超える分は古い方から落とす", () => {
    const rows = Array.from({ length: 30 }, (_, i) => msg(i % 2 === 0 ? "assistant" : "user", `m${i}`, i * 0.5));
    const got = recentHistory(rows, NOW);
    expect(got.length).toBeLessThanOrEqual(HISTORY_MAX_MESSAGES);
    expect(got.at(-1)?.text).toBe("m0");
  });

  it("本人の発言から始まるように、先頭の返事は落とす", () => {
    const rows = [msg("user", "質問", 1), msg("assistant", "前の返事", 2)];
    expect(recentHistory(rows, NOW).map((m) => m.text)).toEqual(["質問"]);
  });
});

describe("toContents", () => {
  it("履歴と今の発言を Gemini の user/model の形にする", () => {
    const contents = toContents([msg("user", "a", 2), msg("assistant", "b", 1)], "c");
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "a" }] },
      { role: "model", parts: [{ text: "b" }] },
      { role: "user", parts: [{ text: "c" }] },
    ]);
  });
});

describe("functionCallsOf / functionResponses", () => {
  it("応答から関数呼び出しだけを取り出す（id があれば保つ）", () => {
    const parts = [
      { text: "調べます", thought: true },
      { functionCall: { name: "find_task", args: { query: "歯医者" }, id: "c1" }, thoughtSignature: "sig" },
      { functionCall: { name: "list_today" } },
    ];
    expect(functionCallsOf(parts)).toEqual([
      { name: "find_task", args: { query: "歯医者" }, id: "c1" },
      { name: "list_today", args: {} },
    ]);
  });

  it("結果は呼び出しと同じ順で、1つの user 発言にまとめる", () => {
    const content = functionResponses([
      { call: { name: "find_task", args: {}, id: "c1" }, result: { matches: [] } },
      { call: { name: "list_today", args: {} }, result: { todos: [] } },
    ]);
    expect(content).toEqual({
      role: "user",
      parts: [
        { functionResponse: { name: "find_task", response: { result: { matches: [] } }, id: "c1" } },
        { functionResponse: { name: "list_today", response: { result: { todos: [] } } } },
      ],
    });
  });
});

describe("textOf", () => {
  it("思考の要約を除いて文章だけをつなぐ", () => {
    const parts = [{ text: "考え中", thought: true }, { text: "完了にしました。" }, { thoughtSignature: "x" }];
    expect(textOf(parts)).toBe("完了にしました。");
  });
});

describe("toFunctionDeclarations", () => {
  it("zod の入力スキーマを JSON Schema に変換し、$schema は外す", () => {
    const [decl] = toFunctionDeclarations([
      {
        name: "set_due",
        description: "期日を変える",
        inputSchema: z.object({
          id: z.string().describe("タスクのID"),
          due_date: z.string().nullable(),
          due_time: z.string().optional(),
        }),
      },
    ]);
    expect(decl.name).toBe("set_due");
    expect(decl.parametersJsonSchema).not.toHaveProperty("$schema");
    expect(decl.parametersJsonSchema).toMatchObject({
      type: "object",
      properties: { id: { type: "string", description: "タスクのID" } },
      required: ["id", "due_date"],
    });
  });
});

describe("buildChatSystemPrompt", () => {
  it("今日の日付・曜日・平日休日・時刻を渡す（相対日付の基準）", () => {
    const prompt = buildChatSystemPrompt({ today: "2026-09-29", nowHm: "19:05", restDay: false });
    expect(prompt).toContain("2026-09-29（火・平日） 19:05");
  });
});
