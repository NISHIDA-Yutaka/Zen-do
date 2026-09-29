// MCPハンドラ本体（ツールの登録とJSON整形）。ツールの定義は tools.ts（LINEの会話と共用）。
// Web標準 (Request) => Promise<Response>。マウント位置は呼び出し側のルートが決める（mcp-handler v2）。
// 認証はルート側で行う（/api/mcp=Bearer / /api/mcp/[token]=パス秘密。docs/mcp-integration.md）。
import { createMcpHandler } from "mcp-handler";
import { TOOLS } from "@/lib/mcp/tools";

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

// 会話の運び方はツール説明ではなくここに置く。ツール説明は「何を返し、どう呼ぶか」の契約に保つ
const INSTRUCTIONS = [
  "Zendo はユーザー本人（ADHDの当事者）が使う個人用のタスク管理アプリ。",
  "Inbox に7日以上放置されているタスク（stale_days が7以上）があれば話題に出し、いつやるかを尋ねる。決まったら set_due で期日を付ける。",
  "習慣の継続記録（list_habits の streak）が伸びていれば、会話の中で触れてよい。",
].join("\n");

export const mcpHandler = createMcpHandler(
  (server) => {
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
        async (args: unknown) => ok(await tool.run(args)),
      );
    }
  },
  { instructions: INSTRUCTIONS },
);
