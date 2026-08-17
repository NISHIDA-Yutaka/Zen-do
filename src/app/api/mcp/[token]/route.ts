// MCPエンドポイント（パス秘密方式）。claude.aiのカスタムコネクタはOAuthしか受け付けず
// ヘッダにトークンを付けられないため、URL自体を鍵にする（capability URL）。
// /api/mcp/<MCP_TOKEN> を知っている相手だけがアクセスできる。ツール定義は src/lib/mcp/server.ts。
// 秘密が漏れたら MCP_TOKEN をローテーションする。docs/mcp-integration.md。
import { mcpHandler } from "@/lib/mcp/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

// トークン不一致・未設定は存在を明かさず 404。一致したら MCP を処理。
async function guarded(req: Request, ctx: Ctx): Promise<Response> {
  const secret = process.env.MCP_TOKEN;
  const { token } = await ctx.params;
  if (!secret || token !== secret) {
    return new Response("Not Found", { status: 404 });
  }
  return mcpHandler(req);
}

export { guarded as GET, guarded as POST };
